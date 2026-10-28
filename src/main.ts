#!/usr/bin/env node
import { parseArgs } from "node:util"
import { MarketplaceClient } from "./marketplace.ts"
import { CodiumInstaller } from "./installer.ts"
import { listInstalled } from "./installed.ts"
import { latestStable, selectCompatible } from "./models.ts"
import { App } from "./ui/app.ts"
import { MainScreen } from "./ui/main-screen.ts"
import { log } from "./log.ts"

process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0)
})

const USAGE = `codium-ext — VSCodium extension installer TUI

Usage:
  codium-ext                          open the TUI
  codium-ext --probe <publisher.name> list compatible versions
  codium-ext --install <id[@version]> install non-interactively
  codium-ext --list                   print installed extensions

Options:
  --dry-run            with --install: resolve and validate, do not install
  --extensions-dir DIR forward an isolated extensions directory to codium
  --user-data-dir DIR  forward an isolated profile directory to codium
  -h, --help           show this help
`

function fail(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

async function runProbe(client: MarketplaceClient, id: string): Promise<void> {
  const candidate = await client.getVersions(id)
  process.stdout.write(`${candidate.displayName}  ${candidate.publisher}.${candidate.name}\n`)
  process.stdout.write(`${candidate.versions.length} compatible versions\n`)
  for (const entry of candidate.versions.slice(0, 25)) {
    const tags = [entry.targetPlatform]
    if (entry.prerelease) tags.push("pre-release")
    process.stdout.write(`  ${entry.version.padEnd(18)} ${tags.join(" ")}\n`)
  }
}

async function runInstall(
  client: MarketplaceClient,
  installer: CodiumInstaller,
  target: string,
  dryRun: boolean,
): Promise<void> {
  const at = target.lastIndexOf("@")
  const id = at > 0 ? target.slice(0, at) : target
  const requested = at > 0 ? target.slice(at + 1) : null
  const candidate = await client.getVersions(id)
  let entry = requested
    ? selectCompatible(candidate.versions, { includePrerelease: true }).find((version) => version.version === requested)
    : latestStable(candidate.versions)
  if (!entry) fail(`version ${requested} is not available for linux-x64/universal`)
  process.stdout.write(`${candidate.publisher}.${candidate.name}@${entry.version} (${entry.targetPlatform})\n`)
  if (dryRun) {
    process.stdout.write(`${entry.downloadUrl}\n`)
    return
  }
  const result = await installer.install(
    candidate,
    entry,
    {
      onPhase: (phase) => process.stdout.write(`${phase}\n`),
      onProgress: (received, total) =>
        process.stdout.write(`  ${received}${total ? `/${total}` : ""} bytes\r`),
      onLog: (line) => process.stdout.write(`  ${line}\n`),
    },
  )
  process.stdout.write(`\n${result.message}\n`)
  if (!result.installed) process.exit(2)
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      probe: { type: "string" },
      install: { type: "string" },
      list: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      "extensions-dir": { type: "string" },
      "user-data-dir": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  })

  if (values.help) {
    process.stdout.write(USAGE)
    return
  }

  const codiumOptions = {
    extensionsDir: values["extensions-dir"],
    userDataDir: values["user-data-dir"],
  }
  const client = new MarketplaceClient()
  const installer = new CodiumInstaller(client, codiumOptions)

  if (values.probe) {
    await runProbe(client, values.probe)
    return
  }
  if (values.install) {
    await runInstall(client, installer, values.install, values["dry-run"] ?? false)
    return
  }
  if (values.list) {
    const installed = await listInstalled(codiumOptions)
    process.stdout.write(installed.map((entry) => `${entry.id}@${entry.version}`).join("\n") + (installed.length ? "\n" : ""))
    return
  }
  if (positionals.length > 0) {
    fail(`unexpected argument: ${positionals[0]}\n\n${USAGE}`)
  }

  log("tui start")
  const app = await App.create()
  app.push(new MainScreen(app, { client, installer }))
  await new Promise<void>((resolve) => {
    app.renderer.once("destroy", () => resolve())
  })
  log("tui exit")
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  log(`fatal ${message}`)
  process.stderr.write(`${message}\n`)
  process.exit(1)
})
