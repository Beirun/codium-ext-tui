import {
  InputRenderable,
  TextRenderable,
  bold,
  createCliRenderer,
  dim,
  fg,
  t,
} from "@opentui/core"
import type { CliRenderer, KeyEvent } from "@opentui/core"
import { BoxRenderable } from "@opentui/core"
import { palette } from "../theme.ts"
import type { Navigator, Screen, StatusTone } from "./common.ts"

export class App implements Navigator {
  readonly renderer: CliRenderer
  private readonly body: BoxRenderable
  private readonly headerLeft: TextRenderable
  private readonly headerRight: TextRenderable
  private readonly footerLeft: TextRenderable
  private readonly footerRight: TextRenderable
  private readonly stack: Screen[] = []
  private destroyHandlers: Array<() => void> = []
  private closed = false

  private constructor(renderer: CliRenderer) {
    this.renderer = renderer

    const shell = new BoxRenderable(renderer, {
      width: "100%",
      height: "100%",
      flexDirection: "column",
      backgroundColor: palette.bgDark,
    })

    const makeBar = (): BoxRenderable =>
      new BoxRenderable(renderer, {
        width: "100%",
        height: 1,
        flexDirection: "row",
        backgroundColor: palette.bgDark,
        paddingX: 1,
      })

    const header = makeBar()
    this.headerLeft = new TextRenderable(renderer, { content: "", height: 1, flexGrow: 1 })
    this.headerRight = new TextRenderable(renderer, { content: "", height: 1 })
    header.add(this.headerLeft)
    header.add(this.headerRight)

    this.body = new BoxRenderable(renderer, {
      width: "100%",
      height: "100%",
      flexGrow: 1,
      flexDirection: "column",
      backgroundColor: palette.bgDark,
    })

    const footer = makeBar()
    this.footerLeft = new TextRenderable(renderer, { content: "", height: 1, flexGrow: 1 })
    this.footerRight = new TextRenderable(renderer, { content: "", height: 1 })
    footer.add(this.footerLeft)
    footer.add(this.footerRight)

    shell.add(header)
    shell.add(this.body)
    shell.add(footer)
    renderer.root.add(shell)

    const onKey = (key: KeyEvent): void => {
      if (key.name === "q" && !this.textInputFocused()) {
        this.quit()
        key.stopPropagation()
        return
      }
      const top = this.current()
      if (!top) return
      if (top.handleKey(key)) {
        key.stopPropagation()
        key.preventDefault()
      }
    }
    renderer.once("destroy", () => {
      this.closed = true
    })
    renderer.keyInput.on("keypress", onKey)
    this.destroyHandlers.push(() => renderer.keyInput.off("keypress", onKey))
  }

  static async create(): Promise<App> {
    const renderer = await createCliRenderer({
      exitOnCtrlC: true,
      backgroundColor: palette.bg,
      targetFps: 30,
    })
    return new App(renderer)
  }

  /** Attach to an existing renderer, such as a test renderer. */
  static of(renderer: CliRenderer): App {
    return new App(renderer)
  }

  get size(): { width: number; height: number } {
    return { width: this.renderer.width, height: this.renderer.height }
  }

  private textInputFocused(): boolean {
    return this.renderer.currentFocusedRenderable instanceof InputRenderable
  }

  current(): Screen | null {
    return this.stack[this.stack.length - 1] ?? null
  }

  push(screen: Screen): void {
    if (this.closed) return
    this.footerLeft.content = ""
    const previous = this.current()
    if (previous) {
      previous.view.visible = false
      previous.onHide?.()
    }
    this.stack.push(screen)
    this.body.add(screen.view)
    screen.view.visible = true
    this.syncChrome()
    screen.onShow?.()
  }

  pop(): void {
    const top = this.stack.pop()
    if (!top) return
    top.view.visible = false
    top.onHide?.()
    this.body.remove(top.view)
    top.view.destroyRecursively()
    const next = this.current()
    if (next) {
      next.view.visible = true
      this.syncChrome()
      next.onShow?.()
    }
  }

  replace(screen: Screen): void {
    const top = this.stack.pop()
    if (top) {
      top.view.visible = false
      top.onHide?.()
      this.body.remove(top.view)
      top.view.destroyRecursively()
    }
    this.push(screen)
  }

  private syncChrome(): void {
    const screen = this.current()
    this.headerLeft.content = t`${bold(fg(palette.blue)("codium-ext"))}${dim(`  ${screen?.title ?? ""}`)}`
    this.headerRight.content = t`${dim("vscodium marketplace")}`
    this.footerRight.content = t`${dim(screen?.hints ?? "")}`
  }

  setStatus(message: string | null, tone: StatusTone = "info"): void {
    if (this.closed) return
    if (!message) {
      this.footerLeft.content = ""
      return
    }
    const color = tone === "error" ? palette.red : tone === "success" ? palette.green : palette.comment
    this.footerLeft.content = t`${fg(color)(message)}`
  }

  quit(): void {
    this.closed = true
    for (const handler of this.destroyHandlers) handler()
    this.destroyHandlers = []
    while (this.stack.length > 0) {
      const top = this.stack.pop()
      top?.onHide?.()
    }
    this.renderer.destroy()
  }
}
