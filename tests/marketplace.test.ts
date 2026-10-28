import assert from "node:assert/strict"
import { test } from "node:test"
import { candidateFromRaw } from "../src/marketplace.ts"

const universal = {
  publisher: { publisherName: "dbaeumer" },
  extensionName: "vscode-eslint",
  displayName: "ESLint",
  shortDescription: "Integrates ESLint",
  lastUpdated: "2026-10-01T00:00:00.000Z",
  statistics: [
    { statisticName: "install", value: 53478220 },
    { statisticName: "averagerating", value: 4 },
  ],
  versions: [
    {
      version: "3.0.34",
      targetPlatform: null,
      properties: [
        { key: "Microsoft.VisualStudio.Services.VsixSha256", value: "ABC123" },
        { key: "Microsoft.VisualStudio.Code.PreRelease", value: "false" },
      ],
    },
    { version: "3.0.33", targetPlatform: "linux-x64", properties: [] },
    { version: "3.0.32", targetPlatform: "linux-arm64", properties: [] },
  ],
}

test("candidateFromRaw maps publisher, statistics and versions", () => {
  const candidate = candidateFromRaw(universal)
  assert.ok(candidate)
  assert.equal(candidate.publisher, "dbaeumer")
  assert.equal(candidate.name, "vscode-eslint")
  assert.equal(candidate.displayName, "ESLint")
  assert.equal(candidate.installCount, 53478220)
  assert.equal(candidate.versions.length, 3)
})

test("universal versions use a download URL without a targetPlatform parameter", () => {
  const version = candidateFromRaw(universal)!.versions[0]!
  assert.equal(version.targetPlatform, "universal")
  assert.equal(
    version.downloadUrl,
    "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/dbaeumer/vsextensions/vscode-eslint/3.0.34/vspackage",
  )
  assert.equal(version.sha256, "ABC123")
  assert.equal(version.prerelease, false)
})

test("platform-specific versions append the targetPlatform parameter", () => {
  const [, linux] = candidateFromRaw(universal)!.versions
  assert.equal(linux!.targetPlatform, "linux-x64")
  assert.match(linux!.downloadUrl, /\?targetPlatform=linux-x64$/)
})

test("prerelease flag comes from the version properties", () => {
  const candidate = candidateFromRaw({
    ...universal,
    versions: [{ version: "2026.1.2", targetPlatform: "universal", properties: [{ key: "Microsoft.VisualStudio.Code.PreRelease", value: "true" }] }],
  })!
  assert.equal(candidate.versions[0]!.prerelease, true)
})

test("entries without a publisher or name are rejected", () => {
  assert.equal(candidateFromRaw({ extensionName: "x" }), null)
  assert.equal(candidateFromRaw({ publisher: { publisherName: "x" } }), null)
})
