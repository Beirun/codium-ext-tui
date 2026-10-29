/**
 * Pixel wordmark in the style of the opencode logo: six columns per glyph,
 * light strokes with a darker inset face. "#" is a stroke, "+" the face, and
 * each pair of rows becomes one half-block row. The dash starts at column 42
 * and "ext" at column 49.
 */
export const LOGO_ROWS = [
  "                   █   ██                                       ██   ",
  "                   █   ██                                       ██   ",
  "                   █   ██                                       ██   ",
  "██████ ██████ ██████        █    █ ██████        ██████ █    █ ██████",
  "█      █    █ █    █   ██   █    █ █+██+█        █    █  █  █   ██   ",
  "█+++++ █++++█ █++++█   ██   █++++█ █+██+█ ██████ ██████   ██    ██   ",
  "█+++++ █++++█ █++++█   ██   █++++█ █+██+█        █+++++  █  █   ██   ",
  "██████ ██████ ██████   ██   ██████ █+██+█        ██████ █    █  ████ ",
] as const

export const LOGO_DASH_START = 42
export const LOGO_TAIL_START = 49
