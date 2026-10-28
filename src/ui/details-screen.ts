import {
  BoxRenderable,
  SelectRenderableEvents,
  TextRenderable,
  dim,
  fg,
  t,
} from "@opentui/core"
import type { KeyEvent, SelectOption } from "@opentui/core"
import { extensionId, formatCount, formatDate, latestStable } from "../models.ts"
import type { ExtensionCandidate, VersionEntry } from "../models.ts"
import { palette } from "../theme.ts"
import { makeList, panel, setOptions } from "./common.ts"
import { ConfirmScreen } from "./confirm-screen.ts"
import type { Navigator, Screen } from "./common.ts"
import type { Deps } from "./deps.ts"
import { InstallScreen } from "./install-screen.ts"
import { VersionScreen } from "./version-screen.ts"

type Action =
  | { kind: "install"; entry: VersionEntry }
  | { kind: "versions" }
  | { kind: "uninstall" }
  | { kind: "back" }

export class DetailsScreen implements Screen {
  readonly view: BoxRenderable
  readonly title: string
  readonly hints = "enter run · esc back"

  private readonly app: Navigator
  private readonly deps: Deps
  private candidate: ExtensionCandidate
  private installedVersion: string | null
  private busy = false
  private readonly actions: ReturnType<typeof makeList>
  private readonly status: TextRenderable
  private readonly meta: TextRenderable
  private readonly installedLine: TextRenderable
  private versions: VersionEntry[] = []
  private resolved = false

  constructor(app: Navigator, deps: Deps, candidate: ExtensionCandidate, installedVersion: string | null) {
    this.app = app
    this.deps = deps
    this.candidate = candidate
    this.installedVersion = installedVersion
    this.title = candidate.displayName || extensionId(candidate)

    const ctx = app.renderer
    this.view = panel(ctx, { title: this.title, padding: 1 })
    this.view.flexDirection = "column"

    this.meta = new TextRenderable(ctx, {
      content: t`${fg(palette.blue)(extensionId(candidate))}${dim(`  by ${candidate.publisher}`)}`,
      height: 1,
    })
    const description = new TextRenderable(ctx, {
      content: candidate.description || "no description",
      fg: palette.fgDim,
      width: "100%",
      wrapMode: "word",
    })
    this.installedLine = new TextRenderable(ctx, { content: "", height: 1 })
    this.status = new TextRenderable(ctx, { content: "", height: 1 })

    const spacer = new BoxRenderable(ctx, { width: "100%", flexGrow: 1, backgroundColor: palette.bgDark })

    this.actions = makeList(ctx)
    this.actions.showDescription = false

    this.view.add(this.meta)
    this.view.add(description)
    this.view.add(this.installedLine)
    this.view.add(this.status)
    this.view.add(spacer)
    this.view.add(this.actions)

    this.actions.on(SelectRenderableEvents.ITEM_SELECTED, () => this.runSelectedAction())
    this.renderState()
  }

  onShow(): void {
    this.actions.focus()
    if (!this.resolved) void this.resolveVersions()
  }

  private renderState(): void {
    const id = extensionId(this.candidate)
    this.meta.content = t`${fg(palette.blue)(id)}${dim(`  by ${this.candidate.publisher}`)}`
    this.installedLine.content =
      this.installedVersion === null
        ? t`${dim("not installed")}`
        : t`${fg(palette.green)("installed")}${dim(` v${this.installedVersion}`)}`

    const options: SelectOption[] = []
    if (this.busy) {
      options.push({ name: "Working…", description: "", value: { kind: "back" } satisfies Action })
      setOptions(this.actions, options, 0)
      this.actions.height = 1
      return
    }
    if (this.resolved) {
      const latest = latestStable(this.versions)
      if (latest) {
        const label =
          this.installedVersion === latest.version
            ? `Reinstall ${latest.version}`
            : `Install latest  ${latest.version}`
        options.push({ name: label, description: "", value: { kind: "install", entry: latest } satisfies Action })
      }
      options.push({ name: "Choose version…", description: "", value: { kind: "versions" } satisfies Action })
      if (this.installedVersion !== null) {
        options.push({ name: "Uninstall", description: "", value: { kind: "uninstall" } satisfies Action })
      }
    } else {
      options.push({ name: "Resolving versions…", description: "", value: { kind: "back" } satisfies Action })
    }
    options.push({ name: "Back", description: "", value: { kind: "back" } satisfies Action })

    const previous = this.actions.getSelectedIndex()
    setOptions(this.actions, options, previous)
    this.actions.height = Math.max(1, options.length)
  }

  private async resolveVersions(): Promise<void> {
    this.status.content = t`${dim("fetching version list…")}`
    try {
      const resolved = await this.deps.client.getVersions(extensionId(this.candidate))
      this.candidate = resolved
      this.versions = resolved.versions
      this.resolved = true
      const latest = latestStable(this.versions)
      const stats = [
        `${formatCount(resolved.installCount)} installs`,
        `updated ${formatDate(resolved.lastUpdated)}`,
        `${this.versions.length} versions`,
        latest?.prerelease ? "latest is pre-release" : null,
      ].filter((part): part is string => part !== null)
      this.status.content = t`${dim(stats.join("  ·  "))}`
    } catch (error) {
      this.status.content = t`${fg(palette.red)(error instanceof Error ? error.message : String(error))}`
    }
    this.renderState()
  }

  private runSelectedAction(): void {
    const action = this.actions.getSelectedOption()?.value as Action | undefined
    if (!action) return
    if (action.kind === "back") {
      this.app.pop()
      return
    }
    if (action.kind === "uninstall") {
      this.confirmUninstall()
      return
    }
    if (action.kind === "versions") {
      this.app.push(new VersionScreen(this.app, this.deps, this.candidate, this.versions, this.installedVersion))
      return
    }
    this.app.push(new InstallScreen(this.app, this.deps, this.candidate, action.entry, this.installedVersion))
  }

  private confirmUninstall(): void {
    const id = extensionId(this.candidate)
    const version = this.installedVersion ? ` v${this.installedVersion}` : ""
    this.app.push(
      new ConfirmScreen(this.app, {
        title: "uninstall",
        message: `Remove ${this.candidate.displayName || id}${version} from VSCodium? The extension files are deleted from disk.`,
        confirmLabel: "Uninstall",
        onConfirm: () => void this.uninstall(),
      }),
    )
  }

  private async uninstall(): Promise<void> {
    const id = extensionId(this.candidate)
    this.busy = true
    this.renderState()
    this.status.content = t`${dim(`uninstalling ${id}…`)}`
    try {
      const result = await this.deps.installer.uninstall(id)
      this.installedVersion = null
      this.status.content = t`${fg(palette.green)(result.message)}`
      this.app.setStatus(result.message, "success")
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.status.content = t`${fg(palette.red)(message)}`
      this.app.setStatus(message, "error")
    } finally {
      this.busy = false
      this.renderState()
    }
  }

  handleKey(key: KeyEvent): boolean {
    if (key.name === "escape") {
      this.app.pop()
      return true
    }
    if (key.name === "return") {
      this.runSelectedAction()
      return true
    }
    return false
  }
}
