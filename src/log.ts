import { appendFile, mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

function cacheRoot(): string {
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "codium-ext-tui", "cache")
  }
  if (process.platform === "darwin") return join(homedir(), "Library", "Caches", "codium-ext-tui")
  return join(homedir(), ".cache", "codium-ext-tui")
}

export const CACHE_ROOT = cacheRoot()
export const LOG_PATH = join(CACHE_ROOT, "app.log")

let ready: Promise<void> | null = null

export function log(message: string): void {
  const stamp = new Date().toISOString()
  ready ??= mkdir(dirname(LOG_PATH), { recursive: true }).then(() => undefined)
  void ready.then(() => appendFile(LOG_PATH, `${stamp} ${message}\n`)).catch(() => undefined)
}
