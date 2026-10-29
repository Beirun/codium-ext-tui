import assert from "node:assert/strict"
import { test } from "node:test"
import { InputRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { App } from "../src/ui/app.ts"
import { MainScreen } from "../src/ui/main-screen.ts"
import type { Deps } from "../src/ui/deps.ts"
import type { ExtensionCandidate, VersionEntry } from "../src/models.ts"

function version(version: string, targetPlatform = "universal", prerelease = false): VersionEntry {
  return { version, targetPlatform, downloadUrl: "https://example.invalid", prerelease, sha256: null }
}

const eslint: ExtensionCandidate = {
  publisher: "dbaeumer",
  name: "vscode-eslint",
  displayName: "ESLint",
  description: "Integrates ESLint",
  installCount: 53_478_220,
  lastUpdated: "2026-10-01T00:00:00.000Z",
  versions: [version("3.0.34")],
}

const prettier: ExtensionCandidate = {
  publisher: "esbenp",
  name: "prettier-vscode",
  displayName: "Prettier",
  description: "Code formatter",
  installCount: 12_000,
  lastUpdated: null,
  versions: [version("12.4.0")],
}

function deps(): Deps {
  return {
    client: {
      async search() {
        return [eslint, prettier]
      },
      async getVersions() {
        return { ...eslint, versions: [version("3.0.34"), version("3.0.24", "linux-x64")] }
      },
    } as unknown as Deps["client"],
    installer: {
      async install(_candidate: ExtensionCandidate, entry: VersionEntry) {
        return { extensionId: "dbaeumer.vscode-eslint", version: entry.version, installed: true, message: `installed 3.0.34` }
      },
      async uninstall(id: string) {
        return { extensionId: id, version: "", installed: false, message: `uninstalled ${id}` }
      },
    } as unknown as Deps["installer"],
    listInstalled: async () => [
      { id: "dbaeumer.vscode-eslint", displayName: "ESLint", version: "3.0.24", source: "gallery", pinned: false, installedAt: null, targetPlatform: null },
      { id: "esbenp.prettier-vscode", displayName: "Prettier - Code formatter", version: "12.4.0", source: "vsix", pinned: true, installedAt: 1_780_000_000_000, targetPlatform: null },
    ],
  }
}

const settle = (ms = 80): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function withApp(run: (ctx: Awaited<ReturnType<typeof createTestRenderer>>, app: App) => Promise<void>): Promise<void> {
  const setup = await createTestRenderer({ width: 100, height: 24 })
  const app = App.of(setup.renderer)
  try {
    await run(setup, app)
  } finally {
    setup.renderer.destroy()
  }
}

test("the wordmark renders above the header", async () => {
  await withApp(async (setup, app) => {
    app.push(new MainScreen(app, deps()))
    const frame = await setup.waitForFrame((value) => value.includes("████ █   █ ████"))
    assert.match(frame, /codium-ext {2}search/)
  })
})

test("searching renders marketplace results", async () => {
  await withApp(async (setup, app) => {
    app.push(new MainScreen(app, deps()))
    await setup.mockInput.typeText("eslint")
    setup.mockInput.pressEnter()
    const frame = await setup.waitForFrame((value) => value.includes("ESLint") && value.includes("Prettier"))
    assert.match(frame, /53,478,220 installs/)
    assert.match(frame, /2 results for eslint/i)
  })
})

test("selecting a result opens details and resolves versions", async () => {
  await withApp(async (setup, app) => {
    app.push(new MainScreen(app, deps()))
    await setup.mockInput.typeText("eslint")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((value) => value.includes("Prettier"))
    setup.mockInput.pressEscape()
    await settle()
    setup.mockInput.pressEnter()
    const frame = await setup.waitForFrame((value) => value.includes("Choose version"))
    assert.match(frame, /dbaeumer\.vscode-eslint/)
    assert.match(frame, /Install latest {2}3\.0\.34/)
    assert.match(frame, /installed v3\.0\.24/)
  })
})

test("choose version lists compatible builds and tags the installed one", async () => {
  await withApp(async (setup, app) => {
    app.push(new MainScreen(app, deps()))
    await setup.mockInput.typeText("eslint")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((value) => value.includes("Prettier"))
    setup.mockInput.pressEscape()
    await settle()
    setup.mockInput.pressEnter()
    await setup.waitForFrame((value) => value.includes("Choose version"))
    setup.mockInput.pressKey("j")
    await settle()
    setup.mockInput.pressEnter()
    const frame = await setup.waitForFrame((value) => value.includes("enter install"))
    assert.match(frame, /v3\.0\.24 {2,}linux-x64/)
  })
})

test("arrow up moves from the search bar to the tabs, and left/right switch tabs", async () => {
  await withApp(async (setup, app) => {
    app.push(new MainScreen(app, deps()))
    await setup.mockInput.typeText("eslint")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((value) => value.includes("Prettier"))
    setup.mockInput.pressKey("ARROW_UP")
    await settle()
    setup.mockInput.pressKey("ARROW_RIGHT")
    await settle()
    const frame = await setup.waitForFrame((value) => value.includes("Prettier - Code formatter"))
    assert.match(frame, /12\.4\.0/)
    setup.mockInput.pressKey("ARROW_LEFT")
    await settle()
    const back = await setup.waitForFrame((value) => value.includes("Prettier") && value.includes("installs"))
    assert.match(back, /2 results for eslint/)
  })
})

function bgOf(setup: Awaited<ReturnType<typeof createTestRenderer>>, needle: string): string {
  type Span = { text: string; bg: { buffer: Record<string, number> } }
  const lines = (setup.captureSpans() as unknown as { lines: Array<{ spans: Span[] }> }).lines
  const row = lines.map((line) => line.spans).find((spans) => spans.map((span) => span.text).join("").includes(needle))
  const span = row?.find((item) => item.text.includes(needle))
  if (!span) return "-"
  return "#" + [0, 1, 2].map((i) => (span.bg.buffer[String(i)] ?? 0).toString(16).padStart(2, "0")).join("")
}

test("the selected tab and row keep a brighter highlight only while focused", async () => {
  await withApp(async (setup, app) => {
    app.push(new MainScreen(app, deps()))
    await setup.mockInput.typeText("eslint")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((value) => value.includes("Prettier"))
    assert.equal(bgOf(setup, "Search"), "#1f2335")
    assert.equal(bgOf(setup, "ESLint"), "#1f2335")
    setup.mockInput.pressKey("ARROW_UP")
    await settle()
    assert.equal(bgOf(setup, "Search"), "#292e42")
    assert.equal(bgOf(setup, "ESLint"), "#1f2335")
    setup.mockInput.pressKey("ARROW_DOWN")
    await settle()
    setup.mockInput.pressKey("ARROW_DOWN")
    await settle()
    assert.equal(bgOf(setup, "Search"), "#1f2335")
    assert.equal(bgOf(setup, "ESLint"), "#292e42")
  })
})

test("arrow down stays in the search bar while the list is empty", async () => {
  await withApp(async (setup, app) => {
    app.push(new MainScreen(app, deps()))
    setup.mockInput.pressKey("ARROW_DOWN")
    await settle()
    assert.ok(setup.renderer.currentFocusedRenderable instanceof InputRenderable)
    await setup.mockInput.typeText("eslint")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((value) => value.includes("Prettier"))
    setup.mockInput.pressKey("ARROW_DOWN")
    await settle()
    assert.ok(!(setup.renderer.currentFocusedRenderable instanceof InputRenderable))
  })
})

test("arrow keys chain focus: tabs → search bar → list → search bar", async () => {
  await withApp(async (setup, app) => {
    app.push(new MainScreen(app, deps()))
    await setup.mockInput.typeText("eslint")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((value) => value.includes("Prettier"))
    const focused = (): unknown => setup.renderer.currentFocusedRenderable
    assert.ok(focused() instanceof InputRenderable)
    setup.mockInput.pressKey("ARROW_UP")
    await settle()
    assert.ok(!(focused() instanceof InputRenderable))
    setup.mockInput.pressKey("ARROW_DOWN")
    await settle()
    assert.ok(focused() instanceof InputRenderable)
    setup.mockInput.pressKey("ARROW_DOWN")
    await settle()
    assert.ok(!(focused() instanceof InputRenderable))
    setup.mockInput.pressKey("ARROW_UP")
    await settle()
    assert.ok(focused() instanceof InputRenderable)
  })
})

test("arrow up inside the list scrolls until the top, then returns to the search bar", async () => {
  await withApp(async (setup, app) => {
    app.push(new MainScreen(app, deps()))
    await setup.mockInput.typeText("eslint")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((value) => value.includes("Prettier"))
    setup.mockInput.pressEscape()
    await settle()
    setup.mockInput.pressKey("ARROW_DOWN")
    await settle()
    setup.mockInput.pressKey("ARROW_UP")
    await settle()
    assert.ok(!(setup.renderer.currentFocusedRenderable instanceof InputRenderable))
    setup.mockInput.pressKey("ARROW_UP")
    await settle()
    assert.ok(setup.renderer.currentFocusedRenderable instanceof InputRenderable)
  })
})

test("the installed tab lists local extensions and opens details", async () => {
  await withApp(async (setup, app) => {
    app.push(new MainScreen(app, deps()))
    setup.mockInput.pressKey("ARROW_UP")
    await settle()
    setup.mockInput.pressKey("ARROW_RIGHT")
    await settle()
    setup.mockInput.pressEnter()
    await settle()
    await setup.waitForFrame((value) => value.includes("Prettier - Code formatter"))
    const frame = setup.captureCharFrame()
    assert.match(frame, /12\.4\.0/)
    assert.match(frame, /pinned/)
    assert.match(frame, /esbenp/)
    await settle()
    setup.mockInput.pressEnter()
    const details = await setup.waitForFrame((value) => value.includes("Choose version"))
    assert.match(details, /installed/)
  })
})

test("details offers uninstall for an installed extension and runs it after confirming", async () => {
  await withApp(async (setup, app) => {
    let uninstalled = ""
    const services = deps()
    services.installer = {
      ...(services.installer as object),
      async uninstall(id: string) {
        uninstalled = id
        return { extensionId: id, version: "", installed: false, message: `uninstalled ${id}` }
      },
    } as unknown as Deps["installer"]
    app.push(new MainScreen(app, services))
    await setup.mockInput.typeText("eslint")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((value) => value.includes("Prettier"))
    setup.mockInput.pressEscape()
    await settle()
    setup.mockInput.pressEnter()
    await setup.waitForFrame((value) => value.includes("Choose version"))
    setup.mockInput.pressKey("ARROW_DOWN")
    await settle()
    setup.mockInput.pressKey("ARROW_DOWN")
    await settle()
    setup.mockInput.pressEnter()
    const confirm = await setup.waitForFrame((value) => value.includes("Remove ESLint"))
    assert.match(confirm, /Uninstall/)
    setup.mockInput.pressKey("ARROW_DOWN")
    await settle()
    setup.mockInput.pressEnter()
    const after = await setup.waitForFrame((value) => value.includes("uninstalled dbaeumer.vscode-eslint"))
    assert.equal(uninstalled, "dbaeumer.vscode-eslint")
    assert.match(after, /not installed/)
  })
})

test("installing from details reports the result", async () => {
  await withApp(async (setup, app) => {
    app.push(new MainScreen(app, deps()))
    await setup.mockInput.typeText("eslint")
    setup.mockInput.pressEnter()
    await setup.waitForFrame((value) => value.includes("Prettier"))
    setup.mockInput.pressEscape()
    await settle()
    setup.mockInput.pressEnter()
    await setup.waitForFrame((value) => value.includes("Install latest"))
    setup.mockInput.pressEnter()
    const frame = await setup.waitForFrame((value) => value.includes("installed 3.0.34"))
    assert.match(frame, /install dbaeumer\.vscode-eslint@3\.0\.34/)
  })
})
