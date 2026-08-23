export const fontOptions = [
  { label: "Essay", value: "default" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Times", value: "'Times New Roman', Times, serif" },
  { label: "Sans", value: "'Instrument Sans Variable', sans-serif" },
  { label: "Mono", value: "'Courier New', monospace" },
];

export type ToolbarState = {
  fontFamily: string;
  isAlignCenter: boolean;
  isAlignRight: boolean;
  isBlockquote: boolean;
  isBold: boolean;
  isBulletList: boolean;
  isHeading: boolean;
  isItalic: boolean;
  isOrderedList: boolean;
};

export const emptyToolbarState: ToolbarState = {
  fontFamily: "default",
  isAlignCenter: false,
  isAlignRight: false,
  isBlockquote: false,
  isBold: false,
  isBulletList: false,
  isHeading: false,
  isItalic: false,
  isOrderedList: false,
};
