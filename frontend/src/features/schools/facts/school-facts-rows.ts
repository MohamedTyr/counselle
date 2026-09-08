import type {
  Fact,
  FactStateWire,
} from "@/features/schools/facts/school-facts-types";

/*
 * A fact, flattened to a name/value/context row — the shape `FactTable`
 * renders and the shape `compressAbsences` operates on. Everything the About
 * tab shows that is NOT a chart or a table resolves to one of these.
 *
 * `state` (not a `reported` boolean) is what a row carries, because the wire
 * already distinguishes FIVE absence reasons (plan §5.1) and collapsing them
 * to "reported or not" is exactly the failure this page exists to avoid — a
 * reported `0` and a `not_reported` row must never share one flag.
 */
export type FactRow = {
  key: string;
  label: string;
  display: string;
  state: FactStateWire;
  reportedPeriod: string | null;
  /** Set only for a `kind: "link"` fact in state `value` — its `value` is
   * the URL, `display` the source's own link text ("Financial Aid Website",
   * "Tap Here"), verified live on Yale's Money section. `null` for every
   * other kind, so a row's own presence of an `href` is what makes it a
   * link, not a second flag a caller could forget to check. */
  href: string | null;
};

export function toFactRow(fact: Fact): FactRow {
  const href =
    fact.kind === "link" && fact.state === "value" && typeof fact.value === "string"
      ? fact.value
      : null;
  return {
    key: fact.key,
    label: fact.label,
    display: fact.display,
    state: fact.state,
    reportedPeriod: fact.state === "value" ? fact.reported_period : null,
    href,
  };
}

/** Below this a run is shorter than the line that would replace it. */
const COMPRESSIBLE_RUN = 3;

/**
 * A run of consecutive rows absent for the SAME reason collapses to one row:
 * every label still printed, the shared word said once.
 *
 * This is a COMPRESSION, not a hide: no label is dropped, no row is
 * filtered, and the reason is on screen at full size. It merges only rows
 * whose wire `display` is byte-identical, which is what keeps it honest —
 * the five state words are five different strings and never merge into one
 * another (plan §6b).
 */
export function compressAbsences(rows: readonly FactRow[]): FactRow[] {
  const out: FactRow[] = [];
  for (let i = 0; i < rows.length; ) {
    const head = rows[i];
    let end = i + 1;
    if (head.state !== "value") {
      while (
        end < rows.length &&
        rows[end].state !== "value" &&
        rows[end].display === head.display
      )
        end += 1;
    }
    const run = rows.slice(i, end);
    if (run.length < COMPRESSIBLE_RUN) {
      out.push(...run);
    } else {
      out.push({
        key: run.map((row) => row.key).join("+"),
        /* A LIST joined with a semicolon, because several labels contain
         * commas of their own. */
        label: run.map((row) => row.label).join("; "),
        display: head.display,
        state: head.state,
        reportedPeriod: null,
        href: null,
      });
    }
    i = end;
  }
  return out;
}
