import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import type { InstalledExtension } from "./models.ts"
import { parseCodiumList } from "./models.ts"

export const DEFAULT_EXTENSIONS_DIR = join(homedir(), ".vscode-oss", "extensions")

export interface CodiumOptions {
  codium?: string
  extensionsDir?: string
  userDataDir?: string
  timeoutMs?: number
}

export interface CommandResult {
  code: number
  stdout: string
  stderr: string
}

function quoteWindowsArgument(argument: string): string {
  if (argument.length === 0) return '""'
  return /^[^\s"&|<>^]*$/.test(argument) ? argument : `"${argument.replace(/"/g, '""')}"`
}

/** Spawns an executable, going through cmd.exe on Windows so `.cmd` shims like codium.cmd resolve. */
export function spawnCommand(command: string, args: string[], options: { cwd?: string } = {}) {
  const stdio: ["ignore", "pipe", "pipe"] = ["ignore", "pipe", "pipe"]
  if (process.platform === "win32") {
    const line = [command, ...args].map(quoteWindowsArgument).join(" ")
    return spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", line], { cwd: options.cwd, stdio })
  }
  return spawn(command, args, { cwd: options.cwd, stdio })
}

export function runCommand(command: string, args: string[], options: { timeoutMs?: number; cwd?: string } = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(command, args, { cwd: options.cwd })
    let stdout = ""
    let stderr = ""
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill("SIGTERM")
      reject(new Error(`${command} timed out after ${options.timeoutMs ?? 60_000}ms`))
    }, options.timeoutMs ?? 60_000)

    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => (stdout += chunk))
    child.stderr.on("data", (chunk: string) => (stderr += chunk))
    child.on("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on("close", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

interface RawMetadataEntry {
  identifier?: { id?: string }
  relativeLocation?: string
  version?: string
  metadata?: {
    installedTimestamp?: number
    pinned?: boolean
    source?: string
    targetPlatform?: string | null
  }
}

export async function readExtensionMetadata(extensionsDir: string): Promise<Map<string, RawMetadataEntry>> {
  const result = new Map<string, RawMetadataEntry>()
  try {
    const text = await readFile(join(extensionsDir, "extensions.json"), "utf8")
    const parsed = JSON.parse(text) as unknown
    if (!Array.isArray(parsed)) return result
    for (const entry of parsed as RawMetadataEntry[]) {
      const id = entry.identifier?.id
      if (!id) continue
      result.set(id.toLowerCase(), entry)
    }
  } catch {
    // The CLI listing is authoritative; metadata only enriches it.
  }
  return result
}

function codiumFlags(options: CodiumOptions): string[] {
  const flags: string[] = []
  if (options.userDataDir) flags.push("--user-data-dir", options.userDataDir)
  if (options.extensionsDir) flags.push("--extensions-dir", options.extensionsDir)
  return flags
}

export async function listInstalled(options: CodiumOptions = {}): Promise<InstalledExtension[]> {
  const codium = options.codium ?? "codium"
  const extensionsDir = options.extensionsDir ?? DEFAULT_EXTENSIONS_DIR
  const args = [...codiumFlags(options), "--list-extensions", "--show-versions"]
  const result = await runCommand(codium, args, { timeoutMs: options.timeoutMs ?? 60_000 })
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`
    throw new Error(`codium --list-extensions failed: ${detail}`)
  }
  const versions = parseCodiumList(result.stdout)
  if (versions.size === 0) return []
  const metadata = await readExtensionMetadata(extensionsDir)
  const installed: InstalledExtension[] = []
  for (const [id, version] of versions) {
    const meta = metadata.get(id)
    installed.push({
      id: id,
      displayName: await readDisplayName(extensionsDir, meta?.relativeLocation),
      version: version,
      source: meta?.metadata?.source ?? null,
      pinned: meta?.metadata?.pinned ?? false,
      installedAt: meta?.metadata?.installedTimestamp ?? null,
      targetPlatform: meta?.metadata?.targetPlatform ?? null,
    })
  }
  return installed.sort((a, b) => a.id.localeCompare(b.id))
}

async function readDisplayName(extensionsDir: string, relativeLocation: string | undefined): Promise<string | null> {
  if (!relativeLocation) return null
  try {
    const text = await readFile(join(extensionsDir, relativeLocation, "package.json"), "utf8")
    const manifest = JSON.parse(text) as { displayName?: unknown }
    return typeof manifest.displayName === "string" && manifest.displayName.length > 0 ? manifest.displayName : null
  } catch {
    return null
  }
}

export function installedVersionMap(extensions: readonly InstalledExtension[]): Map<string, string> {
  return new Map(extensions.map((entry) => [entry.id.toLowerCase(), entry.version]))
}
