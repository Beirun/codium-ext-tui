import { BoxRenderable, SelectRenderableEvents } from "@opentui/core"
import type { KeyEvent, SelectOption } from "@opentui/core"
import { extensionId } from "../models.ts"
import type { ExtensionCandidate, VersionEntry } from "../models.ts"
import { makeList, panel, setOptions } from "./common.ts"
import type { Navigator, Screen } from "./common.ts"
import type { Deps } from "./deps.ts"
import { InstallScreen } from "./install-screen.ts"

const MAX_VERSIONS = 50

export class VersionScreen implements Screen {
  readonly view: BoxRenderable
  readonly title = "versions"
  readonly hints = "enter install · esc back"

  private readonly app: Navigator
  private readonly deps: Deps
  private readonly candidate: ExtensionCandidate
  private readonly entries: VersionEntry[]
  private readonly installedVersion: string | null
  private readonly list: ReturnType<typeof makeList>

  constructor(
    app: Navigator,
    deps: Deps,
    candidate: ExtensionCandidate,
    versions: VersionEntry[],
    installedVersion: string | null,
  ) {
    this.app = app
    this.deps = deps
    this.candidate = candidate
    this.entries = versions.slice(0, MAX_VERSIONS)
    this.installedVersion = installedVersion

    const ctx = app.renderer
    this.view = panel(ctx, { title: `${extensionId(candidate)} · versions`, padding: 0 })
    this.list = makeList(ctx)
    this.list.showDescription = false
    this.view.add(this.list)

    const options: SelectOption[] = this.entries.map((entry) => {
      const tags = [entry.targetPlatform]
      if (entry.prerelease) tags.push("pre-release")
      if (entry.version === this.installedVersion) tags.push("installed")
      return { name: `v${entry.version.padEnd(14)} ${tags.join("  ·  ")}`, description: "", value: entry }
    })
    setOptions(this.list, options, 0)
  }

  onShow(): void {
    this.list.focus()
  }

  handleKey(key: KeyEvent): boolean {
    if (key.name === "escape") {
      this.app.pop()
      return true
    }
    if (key.name === "return") {
      const entry = this.list.getSelectedOption()?.value as VersionEntry | undefined
      if (entry) {
        this.app.push(new InstallScreen(this.app, this.deps, this.candidate, entry, this.installedVersion))
      }
      return true
    }
    return false
  }
}
