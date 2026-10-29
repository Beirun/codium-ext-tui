/**
 * Pixel wordmark in the style of the opencode logo: five columns per glyph,
 * light strokes with a darker inset face. "#" is a stroke, "+" the face.
 * The dash starts at column 36 and "ext" at column 42.
 */
export const LOGO_ROWS = [
  "                █  ██                                  █   ",
  "█████ █████ █████       █   █ █████       █████ █   █ █████",
  "█     █   █ █   █  ██   █   █ █+█+█       █   █  █ █   █   ",
  "█++++ █+++█ █+++█  ██   █+++█ █+█+█ █████ █████   █    █   ",
  "█++++ █+++█ █+++█  ██   █+++█ █+█+█       █++++  █ █   █   ",
  "█████ █████ █████  ██   █████ █+█+█       █████ █   █  ███ ",
] as const

export const LOGO_DASH_START = 36
export const LOGO_TAIL_START = 42
