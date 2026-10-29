/**
 * Pixel wordmark in the style of the opencode logo: glyphs four to five columns
 * wide, light strokes with a darker inset face. "#" is a stroke, "+" the face.
 * The dash starts at column 31 and "ext" at column 36.
 */
export const LOGO_ROWS = [
  "             #  ##                              #  ",
  "#### #### ####      #  # #####      #### #   # ####",
  "#    #  # #  #  ##  #  # #+#+#      #  #  # #   #  ",
  "#+++ #++# #++#  ##  #++# #+#+# #### ####   #    #  ",
  "#+++ #++# #++#  ##  #++# #+#+#      #+++  # #   #  ",
  "#### #### ####  ##  #### #+#+#      #### #   #   ##",
] as const

export const LOGO_DASH_START = 31
export const LOGO_TAIL_START = 36
