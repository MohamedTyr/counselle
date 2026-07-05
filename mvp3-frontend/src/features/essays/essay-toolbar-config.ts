export const fontOptions = [
  { label: "Essay", value: "default" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Times", value: "'Times New Roman', Times, serif" },
  { label: "Geist", value: "'Geist Variable', sans-serif" },
  { label: "Mono", value: "'Courier New', monospace" },
]

export type ToolbarState = {
  fontFamily: string
  isBold: boolean
  isItalic: boolean
  isHeading: boolean
  isBulletList: boolean
  isOrderedList: boolean
  isBlockquote: boolean
  isAlignCenter: boolean
  isAlignRight: boolean
}

export const emptyToolbarState: ToolbarState = {
  fontFamily: "default",
  isBold: false,
  isItalic: false,
  isHeading: false,
  isBulletList: false,
  isOrderedList: false,
  isBlockquote: false,
  isAlignCenter: false,
  isAlignRight: false,
}
