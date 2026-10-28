import { spawn } from "node:child_process"
import { mkdir, readdir, rm, stat } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { CACHE_ROOT, log } from "./log.ts"
import { runCommand } from "./installed.ts"
import type { CodiumOptions } from "./installed.ts"
import { listInstalled } from "./installed.ts"
import type { Cancellation } from "./marketplace.ts"
import type { MarketplaceClient } from "./marketplace.ts"
import { splitExtensionId, type ExtensionCandidate, type VersionEntry } from "./models.ts"

export const WORK_ROOT = join(CACHE_ROOT, "work")

export class InstallError extends Error {}
export class CorruptVsix extends InstallError {}
export class InstallCancelled extends InstallError {}
export class CodiumError extends InstallError {
  readonly code: number
  constructor(code: number, tail: string) {
    super(`codium exited with ${code}${tail.length > 0 ? `: ${tail}` : ""}`)
    this.code = code
  }
}

export interface InstallResult {
  extensionId: string
  version: string
  installed: boolean
  message: string
}

export interface InstallCallbacks {
  onPhase?: (phase: string) => void
  onProgress?: (received: number, total: number | null) => void
  onLog?: (line: string) => void
}

const MANIFEST_ENTRY = "extension.vsixmanifest"

async function extractManifest(path: string): Promise<string> {
  const attempts: Array<[string, string[]]> = [
    ["bsdtar", ["-xOf", path, MANIFEST_ENTRY]],
    ["unzip", ["-p", path, MANIFEST_ENTRY]],
  ]
  let lastError: unknown = null
  for (const [command, args] of attempts) {
    try {
      const result = await runCommand(command, args, { timeoutMs: 60_000 })
      if (result.code === 0 && result.stdout.includes("<Identity")) return result.stdout
      lastError = new Error(`${command} exit ${result.code}: ${result.stderr.trim()}`)
    } catch (error) {
      lastError = error
    }
  }
  throw new CorruptVsix(`cannot read ${MANIFEST_ENTRY}: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

export async function validateVsix(path: string, extensionId: string, version: string): Promise<void> {
  const [publisher, name] = splitExtensionId(extensionId)
  const manifest = await extractManifest(path)
  const identity = manifest.match(/<Identity\b[^>]*>/)
  if (!identity) throw new CorruptVsix("vsix manifest has no Identity element")
  const attributes = new Map<string, string>()
  for (const match of identity[0].matchAll(/([A-Za-z]+)="([^"]*)"/g)) {
    const key = match[1] as string
    attributes.set(key, match[2] as string)
  }
  const manifestId = attributes.get("Id")
  const manifestPublisher = attributes.get("Publisher")
  const manifestVersion = attributes.get("Version")
  if (manifestId?.toLowerCase() !== name.toLowerCase()) {
    throw new CorruptVsix(`manifest id ${JSON.stringify(manifestId)} does not match ${JSON.stringify(name)}`)
  }
  if (manifestPublisher?.toLowerCase() !== publisher.toLowerCase()) {
    throw new CorruptVsix(`manifest publisher ${JSON.stringify(manifestPublisher)} does not match ${JSON.stringify(publisher)}`)
  }
  if (manifestVersion !== version) {
    throw new CorruptVsix(`manifest version ${JSON.stringify(manifestVersion)} does not match ${JSON.stringify(version)}`)
  }
}

async function sweepStaleWorkDirs(root: string, maxAgeMs = 60 * 60 * 1000): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    return
  }
  const cutoff = Date.now() - maxAgeMs
  for (const entry of entries) {
    const path = join(root, entry)
    try {
      const info = await stat(path)
      if (info.mtimeMs < cutoff) await rm(path, { recursive: true, force: true })
    } catch {
      // A concurrent install may have removed it first.
    }
  }
}

function runCodiumCommand(
  codium: string,
  args: string[],
  callbacks: InstallCallbacks,
  cancellation: Cancellation,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(codium, args, { stdio: ["ignore", "pipe", "pipe"] })
    const tail: string[] = []
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill("SIGKILL")
      reject(new CodiumError(-1, "codium install timed out after 5 minutes"))
    }, 300_000)

    const onLine = (line: string) => {
      const text = line.trimEnd()
      if (text.length === 0) return
      tail.push(text)
      if (tail.length > 20) tail.shift()
      callbacks.onLog?.(text)
    }

    let buffer = ""
    const consume = (chunk: string) => {
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ""
      for (const line of lines) onLine(line)
    }

    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", consume)
    child.stderr.on("data", consume)

    const cancelPoll = setInterval(() => {
      if (!cancellation.cancelled) return
      clearInterval(cancelPoll)
      child.kill("SIGTERM")
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref()
    }, 200)

    child.on("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(cancelPoll)
      reject(new InstallError(`failed to run ${codium}: ${error.message}`))
    })
    child.on("close", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(cancelPoll)
      if (buffer.trim().length > 0) onLine(buffer)
      if (cancellation.cancelled) {
        reject(new InstallCancelled("install cancelled"))
        return
      }
      if (code !== 0) {
        reject(new CodiumError(code ?? -1, tail.slice(-5).join(" | ")))
        return
      }
      resolve()
    })
  })
}

export class CodiumInstaller {
  private readonly client: MarketplaceClient
  private readonly codium: string
  private readonly options: CodiumOptions
  private readonly pollTimeoutMs: number
  private readonly workRoot: string
  private lock: Promise<void> = Promise.resolve()

  constructor(client: MarketplaceClient, options: CodiumOptions & { pollTimeoutMs?: number; workRoot?: string } = {}) {
    this.client = client
    this.codium = options.codium ?? "codium"
    this.options = options
    this.pollTimeoutMs = options.pollTimeoutMs ?? 60_000
    this.workRoot = options.workRoot ?? WORK_ROOT
  }

  private flags(): string[] {
    const flags: string[] = []
    if (this.options.userDataDir) flags.push("--user-data-dir", this.options.userDataDir)
    if (this.options.extensionsDir) flags.push("--extensions-dir", this.options.extensionsDir)
    return flags
  }

  async install(
    candidate: ExtensionCandidate,
    entry: VersionEntry,
    callbacks: InstallCallbacks = {},
    cancellation: Cancellation = { cancelled: false },
  ): Promise<InstallResult> {
    const previous = this.lock
    let release!: () => void
    this.lock = new Promise<void>((resolve) => (release = resolve))
    await previous
    try {
      return await this.doInstall(candidate, entry, callbacks, cancellation)
    } finally {
      release()
    }
  }

  private async doInstall(
    candidate: ExtensionCandidate,
    entry: VersionEntry,
    callbacks: InstallCallbacks,
    cancellation: Cancellation,
  ): Promise<InstallResult> {
    const id = `${candidate.publisher}.${candidate.name}`
    await mkdir(this.workRoot, { recursive: true })
    await sweepStaleWorkDirs(this.workRoot)
    const workDir = join(this.workRoot, randomUUID())
    const vsixPath = join(workDir, `${id}-${entry.version}-${entry.targetPlatform}.vsix`)
    log(`install start ${id}@${entry.version} (${entry.targetPlatform})`)

    try {
      await mkdir(workDir, { recursive: true })
      callbacks.onPhase?.(`Downloading ${entry.version}`)
      await this.client.download(entry, vsixPath, {
        cancellation,
        onProgress: (progress) => callbacks.onProgress?.(progress.received, progress.total),
      })
      if (cancellation.cancelled) throw new InstallCancelled("install cancelled")

      callbacks.onPhase?.("Validating package")
      await validateVsix(vsixPath, id, entry.version)
      callbacks.onLog?.(`validated ${vsixPath.split("/").pop()}`)

      callbacks.onPhase?.("Installing with codium")
      await runCodiumCommand(this.codium, [...this.flags(), "--install-extension", vsixPath, "--force"], callbacks, cancellation)

      callbacks.onPhase?.("Verifying installation")
      const verified = await this.waitForInstall(id, entry.version)
      const message = verified ? `installed ${id}@${entry.version}` : `codium reported success but ${id}@${entry.version} is not listed yet`
      log(message)
      return { extensionId: id, version: entry.version, installed: verified, message }
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch((error: Error) => log(`cleanup failed: ${error.message}`))
    }
  }

  async uninstall(
    extensionId: string,
    callbacks: InstallCallbacks = {},
    cancellation: Cancellation = { cancelled: false },
  ): Promise<InstallResult> {
    const previous = this.lock
    let release!: () => void
    this.lock = new Promise<void>((resolve) => (release = resolve))
    await previous
    try {
      callbacks.onPhase?.("Uninstalling")
      await runCodiumCommand(this.codium, [...this.flags(), "--uninstall-extension", extensionId], callbacks, cancellation)
      callbacks.onPhase?.("Verifying removal")
      const removed = await this.waitForRemoval(extensionId)
      const message = removed
        ? `uninstalled ${extensionId}`
        : `codium reported success but ${extensionId} is still installed`
      log(message)
      return { extensionId, version: "", installed: false, message }
    } finally {
      release()
    }
  }

  private async waitForRemoval(id: string): Promise<boolean> {
    const deadline = Date.now() + this.pollTimeoutMs
    while (Date.now() < deadline) {
      try {
        const installed = await listInstalled({ ...this.options, codium: this.codium })
        if (!installed.some((entry) => entry.id.toLowerCase() === id.toLowerCase())) return true
      } catch (error) {
        log(`poll failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 1_500))
    }
    return false
  }

  private async waitForInstall(id: string, version: string): Promise<boolean> {
    const deadline = Date.now() + this.pollTimeoutMs
    while (Date.now() < deadline) {
      try {
        const installed = await listInstalled({ ...this.options, codium: this.codium })
        const match = installed.find((entry) => entry.id.toLowerCase() === id.toLowerCase())
        if (match?.version === version) return true
      } catch (error) {
        log(`poll failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 1_500))
    }
    return false
  }
}
