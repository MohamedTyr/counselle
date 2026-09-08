/*
 * Display formatting for Explore. Every one of these takes a nullable and
 * returns `null` for absence rather than a placeholder string -- the
 * caller renders the absence, because the treatment differs by surface (a
 * card stat says "not available" in --school-value-absent; a chip just
 * omits itself). What none of them ever do is substitute 0.
 */

/** The literal string a missing metric renders as. Never "—", never "0",
 *  never an empty cell -- a blank reads as zero, and zero is a lie
 *  (AGENTS.md principle 3). "not available", not "not published": the
 *  school may well publish the figure -- we may simply not have read it
 *  yet, and "published" would be a claim about the school where the only
 *  claim we can make is about our own data (plan §5.3). */
export const ABSENT_LABEL = "not available";

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

/** "SAT Math 620–700". An en dash, not a hyphen: it is a range, not a
 *  minus. */
export function formatBand(
  band: { label: string; p25: number; p75: number } | null,
): string | null {
  return band === null ? null : `${band.label} ${band.p25}–${band.p75}`;
}

/** Which tuition row the amount came from. */
export function costLabel(basis: "in-state" | "out-of-state" | null): string {
  return basis === "in-state" ? "in-state cost" : "out-of-state cost";
}
