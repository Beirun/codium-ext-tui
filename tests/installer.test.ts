import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { CodiumInstaller, CorruptVsix, validateVsix } from "../src/installer.ts"
import type { MarketplaceClient } from "../src/marketplace.ts"
import type { ExtensionCandidate, VersionEntry } from "../src/models.ts"

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function buildVsix(dir: string, manifest: string, name = "extension.vsixmanifest"): string {
  const source = join(dir, "src")
  mkdirSync(source, { recursive: true })
  writeFileSync(join(source, name), manifest)
  const path = join(dir, "package.vsix")
  execFileSync("bsdtar", ["--format", "zip", "-cf", path, "-C", source, name])
  return path
}

const GOOD_MANIFEST = `<?xml version="1.0"?><PackageManifest Version="2.0.0"><Metadata><Identity Id="demo" Publisher="acme" Version="1.2.3" /></Metadata></PackageManifest>`

test("validateVsix accepts a matching manifest", async () => {
  const dir = tempDir("vsix-ok-")
  try {
    await validateVsix(buildVsix(dir, GOOD_MANIFEST), "acme.demo", "1.2.3")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("validateVsix rejects a mismatched id, publisher or version", async () => {
  const dir = tempDir("vsix-bad-")
  try {
    const path = buildVsix(dir, GOOD_MANIFEST)
    await assert.rejects(() => validateVsix(path, "acme.other", "1.2.3"), CorruptVsix)
    await assert.rejects(() => validateVsix(path, "someone.demo", "1.2.3"), CorruptVsix)
    await assert.rejects(() => validateVsix(path, "acme.demo", "9.9.9"), CorruptVsix)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("validateVsix rejects an archive without a manifest", async () => {
  const dir = tempDir("vsix-empty-")
  try {
    const source = join(dir, "src")
    mkdirSync(source)
    writeFileSync(join(source, "readme.txt"), "not a vsix")
    const path = join(dir, "broken.vsix")
    execFileSync("bsdtar", ["--format", "zip", "-cf", path, "-C", source, "readme.txt"])
    await assert.rejects(() => validateVsix(path, "acme.demo", "1.2.3"), CorruptVsix)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function stubClient(vsixPath: string, manifest: string): MarketplaceClient {
  return {
    async download(_entry: unknown, destination: string) {
      const dir = tempDir("vsix-dl-")
      const built = buildVsix(dir, manifest)
      writeFileSync(destination, readFileSync(built))
      rmSync(dir, { recursive: true, force: true })
    },
  } as unknown as MarketplaceClient
}

function fakeCodium(dir: string, stateFile: string): string {
  const path = join(dir, "fake-codium")
  writeFileSync(
    path,
    `#!/bin/sh
while [ $# -gt 0 ]; do
  case "$1" in
    --extensions-dir|--user-data-dir) shift 2 ;;
    --install-extension) installing=1; shift 2 ;;
    --list-extensions) listing=1; shift ;;
    *) shift ;;
  esac
done
if [ -n "$installing" ]; then
  echo "$FAKE_ID" > "$FAKE_STATE"
  echo "Extension installed"
  exit 0
fi
if [ -n "$listing" ]; then
  [ -f "$FAKE_STATE" ] && cat "$FAKE_STATE"
  exit 0
fi
exit 1
`,
    { mode: 0o755 },
  )
  return path
}

const candidate: ExtensionCandidate = {
  publisher: "acme",
  name: "demo",
  displayName: "Demo",
  description: "demo extension",
  installCount: 1,
  lastUpdated: null,
  versions: [],
}

const entry: VersionEntry = {
  version: "1.2.3",
  targetPlatform: "universal",
  downloadUrl: "https://example.invalid/demo.vsix",
  prerelease: false,
  sha256: null,
}

test("install runs the pipeline and leaves no work files behind", async () => {
  const dir = tempDir("install-ok-")
  try {
    const stateFile = join(dir, "state")
    const workRoot = join(dir, "work")
    const installer = new CodiumInstaller(stubClient("", GOOD_MANIFEST), {
      codium: fakeCodium(dir, stateFile),
      workRoot,
      pollTimeoutMs: 5_000,
    })
    process.env.FAKE_ID = "acme.demo@1.2.3"
    process.env.FAKE_STATE = stateFile
    const phases: string[] = []
    const result = await installer.install(candidate, entry, { onPhase: (phase) => phases.push(phase) })
    assert.equal(result.installed, true)
    assert.match(result.message, /installed acme\.demo@1\.2\.3/)
    assert.deepEqual(phases, ["Downloading 1.2.3", "Validating package", "Installing with codium", "Verifying installation"])
    assert.deepEqual(readdirSync(workRoot), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a corrupt download fails the install and still cleans up", async () => {
  const dir = tempDir("install-bad-")
  try {
    const workRoot = join(dir, "work")
    const installer = new CodiumInstaller(stubClient("", "<PackageManifest/>"), {
      codium: fakeCodium(dir, join(dir, "state")),
      workRoot,
      pollTimeoutMs: 1_000,
    })
    await assert.rejects(() => installer.install(candidate, entry), CorruptVsix)
    assert.deepEqual(readdirSync(workRoot), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a failing codium surfaces CodiumError and removes the vsix", async () => {
  const dir = tempDir("install-codium-")
  try {
    const failing = join(dir, "failing-codium")
    writeFileSync(failing, "#!/bin/sh\necho 'boom' 1>&2\nexit 3\n", { mode: 0o755 })
    const workRoot = join(dir, "work")
    const installer = new CodiumInstaller(stubClient("", GOOD_MANIFEST), {
      codium: failing,
      workRoot,
      pollTimeoutMs: 1_000,
    })
    await assert.rejects(() => installer.install(candidate, entry), /codium exited with 3/)
    assert.deepEqual(readdirSync(workRoot), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("cancel stops the pipeline before installing", async () => {
  const dir = tempDir("install-cancel-")
  try {
    const workRoot = join(dir, "work")
    const installer = new CodiumInstaller(stubClient("", GOOD_MANIFEST), {
      codium: fakeCodium(dir, join(dir, "state")),
      workRoot,
      pollTimeoutMs: 1_000,
    })
    await assert.rejects(() => installer.install(candidate, entry, {}, { cancelled: true }), /cancelled/)
    assert.deepEqual(readdirSync(workRoot), [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
