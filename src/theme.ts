/** Tokyo Night, flattened: square borders, no rounded corners. */
export const palette = {
  bg: "#1a1b26",
  bgDark: "#16161e",
  bgHighlight: "#292e42",
  bgHighlightDim: "#1f2335",
  border: "#2f3549",
  fg: "#c0caf5",
  fgDim: "#a9b1d6",
  comment: "#565f89",
  blueFaint: "#4f69a1", // 65% of blue
  blueMuted: "#6282c6", // 80% of blue
  blueDeep: "#25314a", // 30% of blue, inset face of the wordmark
  gutter: "#3b4261",
  blue: "#7aa2f7",
  cyan: "#7dcfff",
  green: "#9ece6a",
  yellow: "#e0af68",
  orange: "#ff9e64",
  red: "#f7768e",
  magenta: "#bb9af7",
  purple: "#9d7cd8",
} as const

// Focus must not repaint idle text: the focused colors deliberately mirror the idle ones.
export const selectTheme = {
  backgroundColor: palette.bgDark,
  focusedBackgroundColor: palette.bgDark,
  textColor: palette.fgDim,
  focusedTextColor: palette.fgDim,
  selectedBackgroundColor: palette.bgHighlight,
  selectedTextColor: palette.fg,
  descriptionColor: palette.comment,
  selectedDescriptionColor: palette.blue,
  showScrollIndicator: true,
  wrapSelection: false,
} as const

export const inputTheme = {
  backgroundColor: "transparent",
  focusedBackgroundColor: "transparent",
  textColor: palette.fg,
  focusedTextColor: palette.fg,
  placeholderColor: palette.comment,
  focusedPlaceholderColor: palette.comment,
} as const

export const tabTheme = {
  backgroundColor: palette.bgDark,
  focusedBackgroundColor: palette.bgDark,
  textColor: palette.comment,
  focusedTextColor: palette.comment,
  selectedBackgroundColor: palette.bgHighlight,
  selectedTextColor: palette.blue,
  selectedDescriptionColor: palette.comment,
} as const
