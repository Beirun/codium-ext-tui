import {
  BoxRenderable,
  RenderableEvents,
  ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core"
import type { RenderContext } from "@opentui/core"
import { palette } from "../theme.ts"

export interface RowText {
  title: string
  author: string
  meta: string
}

export interface ListEntry {
  text: RowText
  value: unknown
}

interface RowView {
  box: BoxRenderable
  title: TextRenderable
  author: TextRenderable
  meta: TextRenderable
}

const ITEM_HEIGHT = 3

/**
 * Three-line rows (name / author / details). SelectRenderable only draws a name
 * and a one-line description, so the extension lists are hand-built from a ScrollBox.
 */
export class ExtensionList {
  readonly view: ScrollBoxRenderable
  private readonly ctx: RenderContext
  private readonly placeholder: TextRenderable
  private entries: ListEntry[] = []
  private rows: RowView[] = []
  private selected = 0
  private activate: ((value: unknown) => void) | null = null

  constructor(ctx: RenderContext) {
    this.ctx = ctx
    this.view = new ScrollBoxRenderable(ctx, {
      width: "100%",
      height: "100%",
      backgroundColor: palette.bgDark,
      scrollY: true,
      focusable: true,
    })
    this.placeholder = new TextRenderable(ctx, {
      content: "(nothing here yet)",
      fg: palette.comment,
      height: 1,
      marginLeft: 1,
    })
    this.view.add(this.placeholder)
    this.view.on(RenderableEvents.FOCUSED, () => this.paint())
    this.view.on(RenderableEvents.BLURRED, () => this.paint())
  }

  get length(): number {
    return this.entries.length
  }

  get selectedIndex(): number {
    return this.selected
  }

  get focused(): boolean {
    return this.view.focused
  }

  focus(): void {
    this.view.focus()
  }

  setPlaceholder(text: string): void {
    this.placeholder.content = text
  }

  setOnActivate(handler: (value: unknown) => void): void {
    this.activate = handler
  }

  getSelected(): unknown | null {
    return this.entries[this.selected]?.value ?? null
  }

  setItems(entries: ListEntry[]): void {
    for (const row of this.rows) {
      this.view.remove(row.box)
      row.box.destroyRecursively()
    }
    this.rows = []
    this.entries = entries
    this.selected = 0
    for (const [index, entry] of entries.entries()) {
      const row = this.makeRow(entry, index)
      this.rows.push(row)
      this.view.add(row.box)
    }
    this.placeholder.visible = entries.length === 0
    this.view.scrollTop = 0
    this.paint()
  }

  move(delta: number): void {
    if (this.entries.length === 0) return
    const next = Math.max(0, Math.min(this.entries.length - 1, this.selected + delta))
    if (next === this.selected) return
    this.selected = next
    this.paint()
    this.ensureVisible()
  }

  activateSelected(): void {
    const entry = this.entries[this.selected]
    if (entry) this.activate?.(entry.value)
  }

  private makeRow(entry: ListEntry, index: number): RowView {
    const box = new BoxRenderable(this.ctx, {
      width: "100%",
      height: ITEM_HEIGHT,
      flexDirection: "column",
      backgroundColor: palette.bgDark,
      paddingX: 1,
      onMouseDown: () => {
        this.selected = index
        this.view.focus()
        this.paint()
      },
    })
    const title = new TextRenderable(this.ctx, { content: "", height: 1 })
    const author = new TextRenderable(this.ctx, { content: entry.text.author, height: 1 })
    const meta = new TextRenderable(this.ctx, { content: entry.text.meta, height: 1 })
    box.add(title)
    box.add(author)
    box.add(meta)
    return { box, title, author, meta }
  }

  private paint(): void {
    if (this.view.isDestroyed) return
    const focused = this.view.focused
    for (const [index, row] of this.rows.entries()) {
      const entry = this.entries[index]
      if (!entry) continue
      // The scroll box blurs while it is being torn down, after its children are freed.
      if (row.box.isDestroyed || row.title.isDestroyed) continue
      const isSelected = index === this.selected
      row.box.backgroundColor = isSelected ? (focused ? palette.bgHighlight : palette.bgHighlightDim) : palette.bgDark
      // The marker sits on the middle line so it is centred in the three-row item.
      row.title.content = `  ${entry.text.title}`
      row.author.content = `${isSelected ? "▶" : " "} ${entry.text.author}`
      row.meta.content = `  ${entry.text.meta}`
      row.title.fg = isSelected ? palette.fg : palette.fgDim
      row.author.fg = isSelected ? palette.fgDim : palette.comment
      row.meta.fg = palette.comment
    }
  }

  private ensureVisible(): void {
    const top = this.selected * ITEM_HEIGHT
    const height = typeof this.view.height === "number" ? this.view.height : 0
    if (top < this.view.scrollTop) {
      this.view.scrollTop = top
      return
    }
    if (height > 0 && top + ITEM_HEIGHT > this.view.scrollTop + height) {
      this.view.scrollTop = top + ITEM_HEIGHT - height
    }
  }
}
