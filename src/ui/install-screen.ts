import {
  BoxRenderable,
  ScrollBoxRenderable,
  SelectRenderableEvents,
  TextRenderable,
  bold,
  dim,
  fg,
  t,
} from "@opentui/core"
import type { KeyEvent, SelectOption } from "@opentui/core"
import { extensionId } from "../models.ts"
import type { ExtensionCandidate, VersionEntry } from "../models.ts"
import type { Cancellation } from "../marketplace.ts"
import { palette } from "../theme.ts"
import { formatBytes, makeList, panel, progressBar, setOptions } from "./common.ts"
import type { Navigator, Screen } from "./common.ts"
import type { Deps } from "./deps.ts"

type Action = { kind: "back" } | { kind: "retry" }

export class InstallScreen implements Screen {
  readonly view: BoxRenderable
  readonly title = "install"
  hints: string

  private readonly app: Navigator
  private readonly deps: Deps
  private readonly candidate: ExtensionCandidate
  private readonly entry: VersionEntry
  private readonly installedVersion: string | null
  private readonly phase: TextRenderable
  private readonly progress: TextRenderable
  private readonly logText: TextRenderable
  private readonly actions: ReturnType<typeof makeList>
  private readonly logBox: ScrollBoxRenderable
  private readonly cancellation: Cancellation = { cancelled: false }
  private started = false
  private finished = false
  private lines: string[] = []

  constructor(
    app: Navigator,
    deps: Deps,
    candidate: ExtensionCandidate,
    entry: VersionEntry,
    installedVersion: string | null,
  ) {
    this.app = app
    this.deps = deps
    this.candidate = candidate
    this.entry = entry
    this.installedVersion = installedVersion
    this.hints = "esc cancel · q quit"

    const ctx = app.renderer
    const id = extensionId(candidate)
    this.view = panel(ctx, { title: `install ${id}@${entry.version}`, padding: 1 })
    this.view.flexDirection = "column"

    this.phase = new TextRenderable(ctx, {
      content: t`${bold(fg(palette.blue)("preparing"))}`,
      height: 1,
    })
    this.progress = new TextRenderable(ctx, { content: "", height: 1 })
    this.logBox = new ScrollBoxRenderable(ctx, {
      width: "100%",
      flexGrow: 1,
      backgroundColor: palette.bgDark,
      stickyScroll: true,
      stickyStart: "bottom",
      scrollY: true,
    })
    this.logText = new TextRenderable(ctx, {
      content: "",
      width: "100%",
      fg: palette.fgDim,
      wrapMode: "word",
    })
    this.logBox.add(this.logText)
    this.actions = makeList(ctx)
    this.actions.showDescription = false
    this.actions.height = 1
    this.actions.visible = false

    this.view.add(this.phase)
    this.view.add(this.progress)
    this.view.add(this.logBox)
    this.view.add(this.actions)

    this.actions.on(SelectRenderableEvents.ITEM_SELECTED, () => this.runAction())
  }

  onShow(): void {
    if (!this.started) {
      this.started = true
      void this.run()
    }
  }

  private append(line: string): void {
    this.lines.push(line)
    if (this.lines.length > 400) this.lines.shift()
    this.logText.content = this.lines.join("\n")
  }

  private setPhase(text: string, color: string = palette.blue): void {
    this.phase.content = t`${bold(fg(color)(text))}`
  }

  private async run(): Promise<void> {
    this.setPhase("downloading")
    try {
      const result = await this.deps.installer.install(
        this.candidate,
        this.entry,
        {
          onPhase: (phase) => {
            this.setPhase(phase.toLowerCase())
            this.append(`— ${phase}`)
          },
          onProgress: (received, total) => this.renderProgress(received, total),
          onLog: (line) => this.append(line),
        },
        this.cancellation,
      )
      this.finished = true
      this.progress.content = ""
      if (result.installed) {
        this.setPhase(result.message, palette.green)
        this.append(`✔ ${result.message}`)
        this.app.setStatus(result.message, "success")
      } else {
        this.setPhase(result.message, palette.yellow)
        this.append(`! ${result.message}`)
        this.app.setStatus(result.message, "info")
      }
    } catch (error) {
      this.finished = true
      this.progress.content = ""
      if (this.cancellation.cancelled) {
        this.setPhase("cancelled", palette.yellow)
        this.append("install cancelled")
        this.app.setStatus("install cancelled", "info")
      } else {
        const message = error instanceof Error ? error.message : String(error)
        this.setPhase("failed", palette.red)
        this.append(`✘ ${message}`)
        this.app.setStatus(message, "error")
      }
    }
    this.showActions()
  }

  private renderProgress(received: number, total: number | null): void {
    const width = Math.max(10, Math.min(48, this.app.size.width - 40))
    const ratio = total && total > 0 ? received / total : 0
    const bar = progressBar(ratio, width)
    const label = total ? `${formatBytes(received)} / ${formatBytes(total)}` : formatBytes(received)
    const percent = total && total > 0 ? `${Math.min(100, Math.round(ratio * 100))}%` : ""
    this.progress.content = t`${fg(palette.blue)(bar)}${dim(`  ${label} ${percent}`)}`
  }

  private showActions(): void {
    const options: SelectOption[] = []
    options.push({ name: "Back", description: "", value: { kind: "back" } satisfies Action })
    if (!this.cancellation.cancelled) {
      options.push({ name: "Install again", description: "", value: { kind: "retry" } satisfies Action })
    }
    setOptions(this.actions, options, 0)
    this.actions.height = options.length
    this.actions.visible = true
    this.hints = "enter select · esc back · q quit"
    this.actions.focus()
  }

  private runAction(): void {
    const action = this.actions.getSelectedOption()?.value as Action | undefined
    if (action?.kind === "retry") {
      this.cancellation.cancelled = false
      this.finished = false
      this.lines = []
      this.append(`— retrying ${this.entry.version}`)
      void this.run()
      return
    }
    this.app.pop()
  }

  handleKey(key: KeyEvent): boolean {
    if (key.name === "escape") {
      if (!this.finished) {
        this.cancellation.cancelled = true
        this.setPhase("cancelling…", palette.yellow)
        return true
      }
      this.app.pop()
      return true
    }
    if (key.name === "return") {
      if (this.finished) this.runAction()
      return true
    }
    return false
  }
}
