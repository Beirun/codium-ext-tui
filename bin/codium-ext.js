#!/usr/bin/env node
import { spawn } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const main = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "main.ts")
const args = ["--experimental-ffi", "--disable-warning=ExperimentalWarning", main, ...process.argv.slice(2)]
const child = spawn(process.execPath, args, { stdio: "inherit" })
child.on("error", (error) => {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
})
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
