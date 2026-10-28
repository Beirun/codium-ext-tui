import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  TabSelectRenderable,
  TabSelectRenderableEvents,
  TextRenderable,
  fg,
  t,
} from "@opentui/core"
import type { KeyEvent } from "@opentui/core"
import { formatCount, formatTimestamp } from "../models.ts"
import type { ExtensionCandidate, InstalledExtension } from "../models.ts"
import { listInstalled } from "../installed.ts"
import { inputTheme, palette, tabTheme } from "../theme.ts"
import { dimSelectionOnBlur, panel } from "./common.ts"
import type { Navigator, Screen } from "./common.ts"
import type { Deps } from "./deps.ts"
import { DetailsScreen } from "./details-screen.ts"
import { ExtensionList } from "./extension-list.ts"
import type { ListEntry } from "./extension-list.ts"

const TABS = ["Search", "Installed"] as const

export class MainScreen implements Screen {
  readonly view: BoxRenderable
  readonly title = "search"
  hints = "/ search · ↑↓ focus · ←→ tabs · enter details · q quit"

  private readonly app: Navigator
  private readonly deps: Deps
  private readonly input: InputRenderable
  private readonly tabs: TabSelectRenderable
  private readonly list: ExtensionList

  private candidates: ExtensionCandidate[] = []
  private installed: InstalledExtension[] = []
  private searchToken = 0
  private tab = 0
  private syncingTabs = false
  private shown = false
  private lastQuery = ""

  constructor(app: Navigator, deps: Deps) {
    this.app = app
    this.deps = deps
    const ctx = app.renderer

    this.view = panel(ctx, { padding: 0 })
    const searchRow = new BoxRenderable(ctx, {
      width: "100%",
      height: 3,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: palette.bgDark,
      border: true,
      borderStyle: "single",
      borderColor: palette.border,
      paddingX: 1,
      gap: 1,
    })
    this.input = new InputRenderable(ctx, {
      flexGrow: 1,
      placeholder: "search the marketplace…",
      ...inputTheme,
    })
    searchRow.add(new TextRenderable(ctx, { content: t`${fg(palette.blue)("⌕")}`, height: 1 }))
    searchRow.add(this.input)

    this.tabs = new TabSelectRenderable(ctx, {
      width: "100%",
      height: 1,
      options: TABS.map((name) => ({ name, description: "" })),
      tabWidth: 14,
      showDescription: false,
      showUnderline: true,
      ...tabTheme,
    })

    dimSelectionOnBlur(this.tabs)
    this.list = new ExtensionList(ctx)
    this.list.setOnActivate((value) => this.openSelected(value))

    this.view.add(this.tabs)
    this.view.add(searchRow)
    this.view.add(this.list.view)

    this.input.on(InputRenderableEvents.ENTER, () => void this.runSearch())
    this.tabs.on(TabSelectRenderableEvents.SELECTION_CHANGED, (index: number) => {
      if (!this.syncingTabs) this.showTab(index, false)
    })
    this.tabs.on(TabSelectRenderableEvents.ITEM_SELECTED, () => this.focusActive())
    this.renderList()
  }

  onShow(): void {
    if (this.shown) this.focusActive()
    else this.input.focus()
    this.shown = true
    void this.refreshInstalled()
  }

  private showTab(index: number, moveFocus = true): void {
    this.tab = index
    this.syncingTabs = true
    this.tabs.setSelectedIndex(index)
    this.syncingTabs = false
    this.renderList()
    if (index === 1) void this.refreshInstalled()
    else this.showSearchStatus()
    if (moveFocus) this.focusActive()
  }

  private renderList(): void {
    if (this.tab === 0) {
      this.list.setPlaceholder("type a query above and press enter")
      this.list.setItems(this.candidates.map((candidate) => this.resultEntry(candidate)))
      return
    }
    this.list.setPlaceholder("no extensions installed")
    this.list.setItems(this.installed.map((entry) => this.installedEntry(entry)))
  }

  private focusActive(): void {
    if (this.list.length === 0) {
      this.input.focus()
      return
    }
    this.list.focus()
  }

  private async runSearch(): Promise<void> {
    const query = this.input.value.trim()
    if (query.length === 0) return
    const token = ++this.searchToken
    this.app.setStatus(null)
    try {
      const found = await this.deps.client.search(query, 50)
      if (token !== this.searchToken) return
      this.candidates = found
      this.lastQuery = query
      this.tab = 0
      this.syncingTabs = true
      this.tabs.setSelectedIndex(0)
      this.syncingTabs = false
      this.renderList()
      this.showSearchStatus()
    } catch (error) {
      if (token !== this.searchToken) return
      this.app.setStatus(error instanceof Error ? error.message : String(error), "error")
    }
  }

  private showSearchStatus(): void {
    if (this.lastQuery.length === 0) return
    const count = this.candidates.length
    this.app.setStatus(`${count} result${count === 1 ? "" : "s"} for ${this.lastQuery}`)
  }

  private resultEntry(candidate: ExtensionCandidate): ListEntry {
    const latest = candidate.versions[0]
    const meta = [latest ? `v${latest.version}` : null, `${formatCount(candidate.installCount)} installs`]
      .filter((part): part is string => part !== null)
      .join("  ·  ")
    return {
      text: {
        title: candidate.displayName || candidate.name,
        author: candidate.publisher,
        meta,
      },
      value: candidate,
    }
  }

  private installedEntry(entry: InstalledExtension): ListEntry {
    const meta = [
      `v${entry.version}`,
      entry.source ?? "unknown",
      ...(entry.pinned ? ["pinned"] : []),
      formatTimestamp(entry.installedAt),
    ].join("  ·  ")
    return {
      text: {
        title: entry.displayName ?? entry.id,
        author: entry.id.split(".", 1)[0] ?? entry.id,
        meta,
      },
      value: entry,
    }
  }

  async refreshInstalled(): Promise<void> {
    try {
      const load = this.deps.listInstalled ?? listInstalled
      this.installed = await load()
      if (this.tab === 1) {
        this.renderList()
        this.app.setStatus(`${this.installed.length} extension${this.installed.length === 1 ? "" : "s"} installed locally`)
      }
    } catch (error) {
      this.app.setStatus(error instanceof Error ? error.message : String(error), "error")
    }
  }

  private openSelected(selected: unknown): void {
    if (this.tab === 0) {
      const candidate = selected as ExtensionCandidate
      const id = `${candidate.publisher}.${candidate.name}`.toLowerCase()
      const installedVersion = this.installed.find((entry) => entry.id.toLowerCase() === id)?.version ?? null
      this.app.push(new DetailsScreen(this.app, this.deps, candidate, installedVersion))
      return
    }
    const entry = selected as InstalledExtension
    const [publisher = "", name = ""] = entry.id.split(".", 2)
    const candidate: ExtensionCandidate = {
      publisher,
      name,
      displayName: entry.displayName ?? entry.id,
      description: "",
      installCount: null,
      lastUpdated: null,
      versions: [],
    }
    this.app.push(new DetailsScreen(this.app, this.deps, candidate, entry.version))
  }

  handleKey(key: KeyEvent): boolean {
    if (key.ctrl && key.name === "r") {
      void this.refreshInstalled()
      return true
    }
    if (key.name === "/" || key.name === "slash") {
      this.input.focus()
      return true
    }
    if (key.name === "up") {
      if (this.input.focused) {
        this.tabs.focus()
        return true
      }
      if (this.list.focused) {
        if (this.list.selectedIndex === 0) {
          this.input.focus()
          return true
        }
        this.list.move(-1)
        return true
      }
      return false
    }
    if (key.name === "down") {
      if (this.tabs.focused) {
        this.input.focus()
        return true
      }
      if (this.input.focused) {
        if (this.list.length > 0) this.list.focus()
        return true
      }
      if (this.list.focused) {
        this.list.move(1)
        return true
      }
      return false
    }
    if ((key.name === "left" || key.name === "right") && this.tabs.focused) {
      const next = key.name === "left" ? Math.max(0, this.tab - 1) : Math.min(TABS.length - 1, this.tab + 1)
      this.showTab(next, false)
      this.tabs.focus()
      return true
    }
    if (key.name === "escape") {
      if (this.input.focused) {
        this.focusActive()
        return true
      }
      return false
    }
    if (key.name === "return" && this.list.focused) {
      this.list.activateSelected()
      return true
    }
    return false
  }
}
