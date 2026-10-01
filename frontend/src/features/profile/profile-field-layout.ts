import type { FieldWidth } from "@/features/profile/ProfileFieldLabel";
import type { FieldConfig } from "@/features/profile/profile-field-types";

/** A choice set this short sits beside a sibling; a longer one takes the
 * row so its chips do not wrap into a ragged second line. */
const SHORT_CHOICE_COUNT = 3;

const ROW_UNITS = 6;
const UNITS: Record<FieldWidth, number> = { third: 2, half: 3, full: 6 };

/** How much of the answer grid a field takes, from what it holds. */
export function fieldWidth(config: FieldConfig): FieldWidth {
  switch (config.kind) {
    case "int":
    case "decimal":
    case "date":
      return "third";
    case "text":
    case "boolean":
      return "half";
    case "select":
      return config.options.length <= SHORT_CHOICE_COUNT ? "half" : "full";
    default:
      return "full";
  }
}

function isChoice(config: FieldConfig): boolean {
  return (
    config.kind === "boolean" ||
    config.kind === "select" ||
    config.kind === "multi-select"
  );
}

/** Widths for a question's fields in order, laid into rows of six units.
 *
 * A row holds chips or boxes, never both: a Yes/No beside a number box puts
 * two different shapes on one line and pushes the box's partner onto a
 * line of its own. And a text field left alone on its row — a school name
 * followed by a set of choices — takes the whole row instead of stopping
 * halfway across it; a number or a choice stays its own size, because a
 * wide box for a year says the wrong thing about what goes in it. */
export type FieldPlacement = { width: FieldWidth; startsRow: boolean };

export function layoutRows(fields: readonly FieldConfig[]): FieldPlacement[] {
  const widths = fields.map(fieldWidth);
  const starts = fields.map((_, index) => index === 0);
  let rowStart = 0;
  let used = 0;

  const closeRow = (end: number) => {
    const isLoneText = end - rowStart === 1 && fields[rowStart].kind === "text";
    if (isLoneText) {
      widths[rowStart] = "full";
    }
  };

  widths.forEach((width, index) => {
    const switchesShape =
      index > rowStart &&
      isChoice(fields[index]) !== isChoice(fields[rowStart]);
    if (used + UNITS[width] > ROW_UNITS || switchesShape) {
      closeRow(index);
      rowStart = index;
      starts[index] = true;
      used = 0;
    }
    used += UNITS[width];
  });
  closeRow(widths.length);
  // The grid would otherwise pull a field up into space left on the row
  // above, so every row's first field says where it starts.
  return widths.map((width, index) => ({ width, startsRow: starts[index] }));
}
