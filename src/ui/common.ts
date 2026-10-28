import { BoxRenderable, RenderableEvents, SelectRenderable, TabSelectRenderable, TextRenderable } from "@opentui/core"
import type { CliRenderer, KeyEvent, RenderContext, SelectOption } from "@opentui/core"
import { palette, selectTheme } from "../theme.ts"

export type StatusTone = "info" | "error" | "success"

export interface Navigator {
  readonly renderer: CliRenderer
  push(screen: Screen): void
  pop(): void
  replace(screen: Screen): void
  setStatus(message: string | null, tone?: StatusTone): void
  readonly size: { width: number; height: number }
}

export interface Screen {
  readonly view: BoxRenderable
  readonly title: string
  hints: string
  onShow?(): void
  onHide?(): void
  handleKey(key: KeyEvent): boolean
}

export function panel(ctx: RenderContext, options: { title?: string; padding?: number } = {}): BoxRenderable {
  const base = {
    width: "100%" as const,
    height: "100%" as const,
    flexDirection: "column" as const,
    backgroundColor: palette.bgDark,
    paddingX: options.padding ?? 1,
  }
  if (!options.title) return new BoxRenderable(ctx, base)
  // Passing borderStyle alone draws a border in 0.6.x, so border keys stay tied to the title.
  return new BoxRenderable(ctx, {
    ...base,
    border: true,
    borderStyle: "single",
    borderColor: palette.border,
    title: ` ${options.title} `,
    titleColor: palette.blue,
    titleAlignment: "left",
  })
}

export function line(ctx: RenderContext, content: string, color: string = palette.fgDim): TextRenderable {
  return new TextRenderable(ctx, { content, fg: color, height: 1 })
}

/** Selection keeps a brighter highlight only while its control owns the keyboard focus. */
export function dimSelectionOnBlur(control: SelectRenderable | TabSelectRenderable): void {
  const paint = (focused: boolean): void => {
    control.selectedBackgroundColor = focused ? palette.bgHighlight : palette.bgHighlightDim
  }
  control.on(RenderableEvents.FOCUSED, () => paint(true))
  control.on(RenderableEvents.BLURRED, () => paint(false))
  paint(control.focused)
}

export function makeList(ctx: RenderContext): SelectRenderable {
  const list = new SelectRenderable(ctx, {
    width: "100%",
    height: "100%",
    ...selectTheme,
    itemSpacing: 0,
    fastScrollStep: 5,
  })
  dimSelectionOnBlur(list)
  return list
}

export function setOptions(list: SelectRenderable, options: SelectOption[], index = 0): void {
  list.options = options
  if (options.length > 0) list.setSelectedIndex(Math.min(index, options.length - 1))
}

export function progressBar(ratio: number, width: number): string {
  const clamped = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0
  const filled = Math.round(clamped * width)
  return `${"█".repeat(filled)}${"░".repeat(Math.max(0, width - filled))}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
