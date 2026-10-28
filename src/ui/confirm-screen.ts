import { BoxRenderable, SelectRenderableEvents, TextRenderable, dim, t } from "@opentui/core"
import type { KeyEvent, SelectOption } from "@opentui/core"
import { palette } from "../theme.ts"
import { makeList, panel, setOptions } from "./common.ts"
import type { Navigator, Screen } from "./common.ts"

interface ConfirmOptions {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
}

export class ConfirmScreen implements Screen {
  readonly view: BoxRenderable
  readonly title: string
  readonly hints = "enter select · esc cancel"

  private readonly app: Navigator
  private readonly options: ConfirmOptions
  private readonly actions: ReturnType<typeof makeList>

  constructor(app: Navigator, options: ConfirmOptions) {
    this.app = app
    this.options = options
    this.title = options.title

    const ctx = app.renderer
    this.view = panel(ctx, { title: options.title, padding: 1 })
    this.view.flexDirection = "column"

    const message = new TextRenderable(ctx, {
      content: options.message,
      fg: palette.fgDim,
      width: "100%",
      wrapMode: "word",
    })
    const spacer = new BoxRenderable(ctx, { width: "100%", flexGrow: 1, backgroundColor: palette.bgDark })
    this.actions = makeList(ctx)
    this.actions.showDescription = false

    this.view.add(message)
    this.view.add(spacer)
    this.view.add(this.actions)

    const items: SelectOption[] = [
      { name: "Cancel", description: "", value: "cancel" },
      { name: options.confirmLabel, description: "", value: "confirm" },
    ]
    setOptions(this.actions, items, 0)
    this.actions.height = 2
    this.actions.on(SelectRenderableEvents.ITEM_SELECTED, () => this.runSelected())
  }

  onShow(): void {
    this.actions.focus()
  }

  private runSelected(): void {
    const choice = this.actions.getSelectedOption()?.value
    if (choice !== "confirm") {
      this.app.pop()
      return
    }
    this.app.pop()
    this.options.onConfirm()
  }

  handleKey(key: KeyEvent): boolean {
    if (key.name === "escape") {
      this.app.pop()
      return true
    }
    if (key.name === "return") {
      this.runSelected()
      return true
    }
    return false
  }
}
