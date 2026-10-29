import {
  InputRenderable,
  StyledText,
  TextRenderable,
  bg,
  bold,
  createCliRenderer,
  dim,
  fg,
  t,
} from "@opentui/core"
import type { CliRenderer, KeyEvent, TextChunk } from "@opentui/core"
import { BoxRenderable } from "@opentui/core"
import { palette } from "../theme.ts"
import type { Navigator, Screen, StatusTone } from "./common.ts"
import { LOGO_DASH_START, LOGO_ROWS, LOGO_TAIL_START } from "./logo.ts"

type LogoSection = "head" | "dash" | "tail"

const LOGO_STROKE: Record<LogoSection, string> = {
  head: palette.blueFaint,
  dash: palette.comment,
  tail: palette.blueMuted,
}

function logoSection(column: number): LogoSection {
  if (column < LOGO_DASH_START) return "head"
  return column < LOGO_TAIL_START ? "dash" : "tail"
}

function logoColor(row: string, column: number): string | null {
  const cell = row[column]
  if (cell === undefined || cell === " ") return null
  return cell === "+" ? palette.blueDeep : LOGO_STROKE[logoSection(column)]
}

interface LogoCell {
  text: string
  fg: string
  bg: string | null
}

function logoCells(): LogoCell[][] {
  const rows: LogoCell[][] = []
  for (let pixelRow = 0; pixelRow < LOGO_ROWS.length; pixelRow += 2) {
    const top = LOGO_ROWS[pixelRow] ?? ""
    const bottom = LOGO_ROWS[pixelRow + 1] ?? ""
    const cells: LogoCell[] = []
    for (let column = 0; column < top.length; column++) {
      const topColor = logoColor(top, column)
      const bottomColor = logoColor(bottom, column)
      if (topColor && bottomColor && topColor === bottomColor) cells.push({ text: "█", fg: topColor, bg: null })
      else if (topColor && bottomColor) cells.push({ text: "▀", fg: topColor, bg: bottomColor })
      else if (topColor) cells.push({ text: "▀", fg: topColor, bg: null })
      else if (bottomColor) cells.push({ text: "▄", fg: bottomColor, bg: null })
      else cells.push({ text: " ", fg: palette.comment, bg: null })
    }
    rows.push(cells)
  }
  return rows
}

function logoContent(cells: LogoCell[]): StyledText {
  const chunks: TextChunk[] = []
  let start = 0
  const flush = (end: number): void => {
    const run = cells[start]!
    const text = cells.slice(start, end).map((cell) => cell.text).join("")
    chunks.push(run.bg ? bg(run.bg)(fg(run.fg)(text)) : fg(run.fg)(text))
  }
  for (let index = 1; index < cells.length; index++) {
    const previous = cells[start]!
    const cell = cells[index]!
    if (cell.fg === previous.fg && cell.bg === previous.bg) continue
    flush(index)
    start = index
  }
  flush(cells.length)
  return new StyledText(chunks)
}

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

    const logo = new BoxRenderable(renderer, {
      width: "100%",
      height: LOGO_ROWS.length / 2,
      flexDirection: "column",
      backgroundColor: palette.bgDark,
      paddingX: 1,
      marginTop: 2,
      marginBottom: 2,
    })
    for (const cells of logoCells()) {
      logo.add(
        new TextRenderable(renderer, {
          content: logoContent(cells),
          height: 1,
          wrapMode: "none",
          textAlign: "center",
        }),
      )
    }

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

    shell.add(logo)
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
