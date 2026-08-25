/*
 * Display formatting for Explore. Every one of these takes a nullable and
 * returns `null` for absence rather than a placeholder string — the caller
 * renders the absence, because the treatment differs by surface (a card
 * stat says "not published" in --school-value-absent; a chip just omits
 * itself). What none of them ever do is substitute 0.
 */

/** The literal string a missing metric renders as. Never "—", never "0",
 *  never an empty cell — a blank reads as zero, and zero is a lie. */
export const ABSENT_LABEL = "not published";

const currency = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 0,
  style: "currency",
});

const compact = new Intl.NumberFormat("en-US");

const abbreviated = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  notation: "compact",
});

export function formatPercent(value: number | null): string | null {
  if (value === null) {
    return null;
  }

  return `${value % 1 === 0 ? value : value.toFixed(1)}%`;
}

export function formatCurrency(value: number | null): string | null {
  return value === null ? null : currency.format(value);
}

export function formatCount(value: number | null): string | null {
  return value === null ? null : compact.format(value);
}

export function formatDeadlineDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(`${value}T00:00:00`);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

/** "16.3k". The card's header line has ~250px for city, control, and size
 *  together; the grouped form ("16,300") is what pushed it into truncating
 *  mid-word. Lowercased because the line is running text, not a table. */
export function formatCompactCount(value: number | null): string | null {
  return value === null ? null : abbreviated.format(value).toLowerCase();
}

/** "SAT 1500–1560". An en dash, not a hyphen: it is a range, not a minus. */
export function formatTestBand(
  band: { p25: number; p75: number } | null,
): string | null {
  return band === null ? null : `SAT ${band.p25}–${band.p75}`;
}

/*
 * The two basis labels below encode a qualifier INTO the label rather than
 * hanging it under the value as a third line. Same information, one line
 * instead of two, and the stat cells stay a single rhythm across the grid —
 * which is the whole reason the measure row is three fixed columns.
 */

/** Which tuition row the amount came from. "private" needs no qualifier —
 *  a private school charges one price — so it keeps the neutral label. */
export function costLabel(basis: string | null): string {
  if (basis === "in-state") {
    return "in-state cost";
  }

  return basis === "out-of-state" ? "out-of-state cost" : "sticker cost";
}

/** Which cohort the admit rate describes. */
export function admitLabel(basis: string | null): string {
  return basis === "overall" || basis === null
    ? "admit rate"
    : `${basis} admit rate`;
}
