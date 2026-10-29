/**
 * Pixel wordmark in the style of the opencode logo: six columns per glyph
 * (two for the dotless "i"), light strokes with a darker inset face. "#" is a
 * stroke, "+" the face, and each pair of rows becomes one half-block row.
 * The dash starts at column 38 and "ext" at column 45.
 */
export const LOGO_ROWS = [
  "                   █ ██                                     █    ",
  "██████ ██████ ██████    █    █ ██████        ██████ █    █ ██████",
  "█      █    █ █    █ ██ █    █ █+██+█        █    █  █  █   █    ",
  "█+++++ █++++█ █++++█ ██ █++++█ █+██+█ ██████ ██████   ██    █    ",
  "█+++++ █++++█ █++++█ ██ █++++█ █+██+█        █+++++  █  █   █    ",
  "██████ ██████ ██████ ██ ██████ █+██+█        ██████ █    █  ████ ",
] as const

export const LOGO_DASH_START = 38
export const LOGO_TAIL_START = 45
