import { appendFile, mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export const CACHE_ROOT = join(homedir(), ".cache", "codium-ext-tui")
export const LOG_PATH = join(CACHE_ROOT, "app.log")

let ready: Promise<void> | null = null

export function log(message: string): void {
  const stamp = new Date().toISOString()
  ready ??= mkdir(dirname(LOG_PATH), { recursive: true }).then(() => undefined)
  void ready.then(() => appendFile(LOG_PATH, `${stamp} ${message}\n`)).catch(() => undefined)
}
