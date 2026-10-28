import assert from "node:assert/strict"
import { test } from "node:test"
import {
  compareVersions,
  latestStable,
  parseCodiumList,
  selectCompatible,
  splitExtensionId,
  type VersionEntry,
} from "../src/models.ts"

function entry(version: string, targetPlatform: string, prerelease = false): VersionEntry {
  return { version, targetPlatform, downloadUrl: `https://example.invalid/${version}/${targetPlatform}`, prerelease, sha256: null }
}

test("splitExtensionId splits on the first dot only", () => {
  assert.deepEqual(splitExtensionId("dbaeumer.vscode-eslint"), ["dbaeumer", "vscode-eslint"])
  assert.deepEqual(splitExtensionId("a.b.c.d"), ["a", "b.c.d"])
  assert.throws(() => splitExtensionId("nodots"))
  assert.throws(() => splitExtensionId(".leading"))
  assert.throws(() => splitExtensionId("trailing."))
})

test("compareVersions orders numerically and puts prereleases below releases", () => {
  assert.ok(compareVersions("3.0.24", "3.0.4") > 0)
  assert.ok(compareVersions("2026.1.2", "2025.4.0") > 0)
  assert.ok(compareVersions("3.0.34", "3.0.34-beta.1") > 0)
  assert.equal(compareVersions("1.2.3", "1.2.3"), 0)
  assert.ok(compareVersions("1.2.3-alpha.2", "1.2.3-alpha.1") > 0)
})

test("selectCompatible keeps only universal and linux-x64", () => {
  const result = selectCompatible([
    entry("1.0.0", "linux-arm64"),
    entry("1.0.0", "darwin-x64"),
    entry("0.9.0", "universal"),
  ])
  assert.deepEqual(result.map((item) => item.version), ["0.9.0"])
  assert.equal(result[0]!.targetPlatform, "universal")
})

test("selectCompatible prefers linux-x64 when a version has both builds", () => {
  const result = selectCompatible([entry("2.0.0", "universal"), entry("2.0.0", "linux-x64")])
  assert.equal(result.length, 1)
  assert.equal(result[0]!.targetPlatform, "linux-x64")
})

test("selectCompatible treats a missing platform as universal", () => {
  const result = selectCompatible([{ ...entry("1.0.0", "universal"), targetPlatform: null as unknown as string }])
  assert.equal(result[0]!.targetPlatform, "universal")
})

test("selectCompatible drops prereleases unless asked", () => {
  const entries = [entry("3.0.34", "universal"), entry("3.0.33", "universal", true)]
  assert.deepEqual(selectCompatible(entries).map((item) => item.version), ["3.0.34"])
  assert.deepEqual(selectCompatible(entries, { includePrerelease: true }).map((item) => item.version), ["3.0.34", "3.0.33"])
})

test("selectCompatible sorts newest first", () => {
  const result = selectCompatible([entry("1.0.0", "universal"), entry("10.0.0", "universal"), entry("2.0.0", "universal")])
  assert.deepEqual(result.map((item) => item.version), ["10.0.0", "2.0.0", "1.0.0"])
})

test("latestStable falls back to a prerelease when that is all there is", () => {
  assert.equal(latestStable([entry("1.0.1", "universal", true)])?.version, "1.0.1")
  assert.equal(latestStable([entry("1.0.0", "universal"), entry("1.0.1", "universal", true)])?.version, "1.0.0")
  assert.equal(latestStable([]), null)
})

test("parseCodiumList reads publisher.name@version pairs", () => {
  const parsed = parseCodiumList("dbaeumer.vscode-eslint@3.0.24\nESBenp.Prettier-VSCode@12.4.0\n\n")
  assert.equal(parsed.get("dbaeumer.vscode-eslint"), "3.0.24")
  assert.equal(parsed.get("esbenp.prettier-vscode"), "12.4.0")
  assert.equal(parsed.size, 2)
})
