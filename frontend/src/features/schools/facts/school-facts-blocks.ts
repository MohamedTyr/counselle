import {
  compressAbsences,
  entryRow,
  laneRow,
  orderHeadline,
  roundRows,
  strayRefs,
  type FactTableRow,
} from "@/features/schools/facts/school-facts-rows";
import {
  factStateCopy,
  isReported,
} from "@/features/schools/facts/school-facts-format";
import {
  configuredRefs,
  OTHER_GROUP_TITLE,
  type BandSpec,
  type FactEntry,
  type GroupConfig,
  type SectionConfig,
} from "@/features/schools/facts/school-facts-sections";
import type { SchoolFacts } from "@/features/schools/facts/school-facts-types";

/*
 * A section, as a list of BLOCKS rather than one flat row list.
 *
 * The old `sectionRows` flattened headline, every group and every stray into
 * a single `FactTableRow[]` before anything could render. That threw away the
 * two things the config actually knows — which facts lead, and which group a
 * fact belongs to — and made a visual impossible, because a chart is not a
 * name/value pair.
 *
 * ────────────────────────────────────────────────────────────────────────
 * THE ONE INVARIANT EVERY CHART BLOCK HOLDS.
 *
 * A chart block carries `points` (what is plotted) and `rows` (everything
 * else). Nothing is ever in neither. A value we could not plot — absent,
 * suppressed, not in this form edition, or reported as prose where the chart
 * needs a number — lands in `rows` and renders as the sentence naming which
 * kind of nothing it is.
 *
 * That is a STRUCTURAL guarantee, not a discipline: an absent value cannot
 * become a zero-width bar because it never reaches `points`, and it cannot
 * disappear because the builder puts every unplotted entry in `rows`. This
 * is the geometric form of the rule that a blank cell reads as zero, and it
 * is the reason the two lists are separate rather than one list with a flag.
 * ────────────────────────────────────────────────────────────────────────
 */

/** A value that survived every check and may be drawn. */
export type ChartPoint = {
  key: string;
  label: string;
  /** Always printed beside the mark — the shape never replaces the number. */
  display: string;
  value: number;
};

export type BlockBase = {
  id: string;
  title: string | null;
  /** Unplotted entries. See the invariant above. */
  rows: FactTableRow[];
  /** The single line of prose a chart may carry. */
  foot: string | null;
};

export type RowsBlock = BlockBase & {
  kind: "rows";
  /** The headline reads at one density step up. Never a hero number. */
  emphasis: boolean;
  /**
   * True for the overflow bucket ONLY. Curated groups are always open —
   * collapsing them would hide the thing the page exists to show — but
   * "Other published values" is by definition what the config had no place
   * for, and a long tail of it between a student and the next section is
   * the reason this tab reads as a wall.
   */
  collapsible: boolean;
};

export type BarsBlock = BlockBase & {
  kind: "bars";
  points: ChartPoint[];
  /** Domain ceiling. 100 for shares; the largest bar for counts. */
  max: number;
  unit: "percent" | "count";
};

export type OrdinalBlock = BlockBase & {
  kind: "ordinal";
  levels: readonly string[];
  items: { key: string; label: string; level: number; display: string }[];
};

export type BandsBlock = BlockBase & {
  kind: "bands";
  bands: {
    key: string;
    label: string;
    min: number;
    max: number;
    p25: number;
    p50: number;
    p75: number;
  }[];
};

export type SectionBlock = RowsBlock | BarsBlock | OrdinalBlock | BandsBlock;

/** Every block a section renders, in order. */
export function sectionBlocks(
  data: SchoolFacts,
  section: SectionConfig,
): SectionBlock[] {
  const blocks: SectionBlock[] = [];
  const seen = new Set<string>();

  const takeRows = (entries: readonly FactEntry[]): FactTableRow[] => {
    const rows: FactTableRow[] = [];
    for (const entry of entries) {
      const row = entryRow(entry, data);
      if (!row || seen.has(row.key)) continue;
      seen.add(row.key);
      rows.push(row);
    }
    return rows;
  };

  const pushRows = (
    block: Omit<RowsBlock, "kind" | "foot" | "collapsible"> &
      Partial<Pick<RowsBlock, "collapsible">>,
  ) => {
    if (block.rows.length === 0) return;
    blocks.push({
      collapsible: false,
      ...block,
      kind: "rows",
      foot: null,
    });
  };

  /*
   * Applying leads with its rounds and lanes: they are the section, and they
   * are dual-source truth rather than name/value, so they never merge into a
   * group below.
   */
  if (section.id === "applying") {
    const rows: FactTableRow[] = [];
    const push = (row: FactTableRow) => {
      if (seen.has(row.key)) return;
      seen.add(row.key);
      rows.push(row);
    };
    for (const round of data.rounds) roundRows(round).forEach(push);
    for (const lane of data.applyingLanes) push(laneRow(lane));
    pushRows({ id: "rounds", title: null, rows, emphasis: true });
  }

  pushRows({
    id: "headline",
    title: null,
    rows: takeRows(orderHeadline(section.headline, data)),
    emphasis: true,
  });

  for (const group of section.groups) {
    const block = groupBlock(group, data, seen, takeRows);
    if (block) blocks.push(block);
  }

  /*
   * Every packet ref this section owns that the config did not place.
   * Without it a manifest bump would silently drop metrics from the page,
   * which looks exactly like having fewer facts to report.
   */
  const strays = strayRefs(data, configuredRefs(section), section).map(
    (ref): FactEntry => ({ kind: "fact", ref }),
  );
  pushRows({
    id: "other",
    title: blocks.length > 0 ? OTHER_GROUP_TITLE : null,
    rows: takeRows(strays),
    emphasis: false,
    collapsible: true,
  });

  /*
   * Compression is the last thing that happens, so it sees a block's rows
   * exactly as they will render — including the entries a chart could not
   * plot, which is where same-reason runs actually pile up.
   */
  return blocks.map(
    (block): SectionBlock => ({ ...block, rows: compressAbsences(block.rows) }),
  );
}

function groupBlock(
  group: GroupConfig,
  data: SchoolFacts,
  seen: Set<string>,
  takeRows: (entries: readonly FactEntry[]) => FactTableRow[],
): SectionBlock | null {
  const base = {
    id: group.id,
    title: group.title,
    foot: group.foot ?? null,
  };
  const render = group.render;

  if (!render) {
    const rows = takeRows(group.entries);
    if (rows.length === 0) return null;
    return {
      ...base,
      kind: "rows",
      rows,
      emphasis: false,
      collapsible: false,
      foot: null,
    };
  }

  if (render.chart === "bars" && "source" in render) {
    return degreeShareBlock(base, data, seen);
  }

  if (render.chart === "bars") {
    const { points, rows } = splitNumeric(render.refs, data, seen);
    if (points.length === 0 && rows.length === 0) return null;
    const max = barDomain(render, points, data);
    /*
     * A configured denominator we could not read collapses the whole group
     * to rows. Self-scaling instead would draw the largest surviving bar at
     * full width against a ceiling nobody supplied — "3,850 admitted" filling
     * the track reads as the entire applicant pool. The chart's ceiling is a
     * claim, and we do not make claims we cannot source.
     */
    if (max === null) {
      const fallback = [
        ...takeRows(render.refs),
        ...rows,
        ...takeRows(group.entries),
      ];
      if (fallback.length === 0) return null;
      return {
        ...base,
        kind: "rows",
        rows: fallback,
        emphasis: false,
        collapsible: false,
        foot: null,
      };
    }
    return {
      ...base,
      kind: "bars",
      points,
      rows: [...rows, ...takeRows(group.entries)],
      max,
      unit: render.unit,
    };
  }

  if (render.chart === "ordinal") {
    const { items, rows } = splitOrdinal(
      render.refs,
      render.levels,
      data,
      seen,
    );
    if (items.length === 0 && rows.length === 0) return null;
    return {
      ...base,
      kind: "ordinal",
      levels: render.levels,
      items,
      rows: [...rows, ...takeRows(group.entries)],
    };
  }

  const { bands, rows } = splitBands(render.bands, data, seen);
  if (bands.length === 0 && rows.length === 0) return null;
  return {
    ...base,
    kind: "bands",
    bands,
    rows: [...rows, ...takeRows(group.entries)],
  };
}

/**
 * The ceiling a bar is measured against, or null when we cannot honestly
 * name one.
 *
 *   percent  — 100, always. A share is measured against the whole, never
 *              against the largest share present, which would turn "53% get
 *              aid" into a full-width bar the moment it led the group.
 *   maxRef   — the denominator the config named. Absent means no chart.
 *   neither  — the largest bar, for counts that have no whole (class-size
 *              bins). Nothing is claimed about a total, so nothing can be
 *              misread as one.
 */
function barDomain(
  render: { unit: "percent" | "count"; maxRef?: FactEntry },
  points: readonly ChartPoint[],
  data: SchoolFacts,
): number | null {
  if (render.unit === "percent") return 100;
  if (render.maxRef) return numericEntry(render.maxRef, data);
  if (points.length === 0) return null;
  return Math.max(...points.map((point) => point.value));
}

function degreeShareBlock(
  base: { id: string; title: string; foot: string | null },
  data: SchoolFacts,
  seen: Set<string>,
): SectionBlock | null {
  const points: ChartPoint[] = [];
  const rows: FactTableRow[] = [];
  for (const share of data.degreeShares) {
    const key = `share:${share.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    /*
     * `percent` is null for "<1%" — a string percent whose qualifier IS the
     * value. Parsing it to a number would throw the qualifier away, so it
     * renders as a row carrying the literal string instead.
     */
    if (isReported(share.state) && share.percent !== null) {
      points.push({
        key,
        label: share.label,
        display: share.state.display,
        value: share.percent,
      });
      continue;
    }
    rows.push({
      key,
      label: share.label,
      value: factStateCopy(share.state),
      reported: isReported(share.state),
    });
  }
  if (points.length === 0 && rows.length === 0) return null;
  return { ...base, kind: "bars", points, rows, max: 100, unit: "percent" };
}

/*
 * ── the numeric gate ─────────────────────────────────────────────────────
 *
 * A chart may only draw a value the packet supplied AS A NUMBER. Display
 * strings are never parsed: "1500–1560" is a range written for a human,
 * "<1%" carries a qualifier a parse would discard, and "6 to 1" is not a
 * quantity at all. Anything that fails this gate becomes a row.
 */
function numericState(
  entry: FactEntry,
  data: SchoolFacts,
): { display: string; value: number } | null {
  const source =
    entry.kind === "derived" ? data.derived[entry.key] : data.facts[entry.ref];
  if (!source || !isReported(source.state)) return null;
  const raw = source.state.raw;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return { display: source.state.display, value: raw };
}

function numericEntry(
  entry: FactEntry | undefined,
  data: SchoolFacts,
): number | null {
  if (!entry) return null;
  return numericState(entry, data)?.value ?? null;
}

function entryLabel(entry: FactEntry, data: SchoolFacts): string | null {
  const source =
    entry.kind === "derived" ? data.derived[entry.key] : data.facts[entry.ref];
  return source?.label ?? null;
}

function entryKey(entry: FactEntry): string {
  return entry.kind === "derived" ? `derived:${entry.key}` : entry.ref;
}

/** Plottable points, and a row for every entry that was not one. */
function splitNumeric(
  entries: readonly FactEntry[],
  data: SchoolFacts,
  seen: Set<string>,
): { points: ChartPoint[]; rows: FactTableRow[] } {
  const points: ChartPoint[] = [];
  const rows: FactTableRow[] = [];
  for (const entry of entries) {
    const key = entryKey(entry);
    if (seen.has(key)) continue;
    const label = entryLabel(entry, data);
    if (label === null) continue;
    seen.add(key);
    const numeric = numericState(entry, data);
    if (numeric) {
      points.push({
        key,
        label,
        display: numeric.display,
        value: numeric.value,
      });
      continue;
    }
    const row = entryRow(entry, data);
    if (row) rows.push(row);
  }
  return { points, rows };
}

/**
 * An ordinal level is matched against the configured vocabulary, never
 * guessed at a position. A school printing something outside the four CDS
 * levels gets a row with its own words rather than a tick we invented.
 */
function splitOrdinal(
  entries: readonly FactEntry[],
  levels: readonly string[],
  data: SchoolFacts,
  seen: Set<string>,
): {
  items: { key: string; label: string; level: number; display: string }[];
  rows: FactTableRow[];
} {
  const items: {
    key: string;
    label: string;
    level: number;
    display: string;
  }[] = [];
  const rows: FactTableRow[] = [];
  const index = new Map(
    levels.map((level, position) => [level.toLowerCase(), position]),
  );
  for (const entry of entries) {
    const key = entryKey(entry);
    if (seen.has(key)) continue;
    const source =
      entry.kind === "derived"
        ? data.derived[entry.key]
        : data.facts[entry.ref];
    if (!source) continue;
    seen.add(key);
    const level = isReported(source.state)
      ? index.get(source.state.display.trim().toLowerCase())
      : undefined;
    if (level !== undefined && isReported(source.state)) {
      items.push({
        key,
        label: source.label,
        level,
        display: source.state.display,
      });
      continue;
    }
    const row = entryRow(entry, data);
    if (row) rows.push(row);
  }
  /* Heaviest first: the top of the block should BE the answer. Ties keep
   * config order, which is the CDS's own. */
  items.sort((a, b) => b.level - a.level);
  return { items, rows };
}

/**
 * A band needs all three percentiles as numbers. Two out of three is not a
 * band — it is a shape we would be inventing an edge for — so a partial set
 * degrades to rows carrying whichever values exist.
 */
function splitBands(
  specs: readonly BandSpec[],
  data: SchoolFacts,
  seen: Set<string>,
): { bands: BandsBlock["bands"]; rows: FactTableRow[] } {
  const bands: BandsBlock["bands"] = [];
  const rows: FactTableRow[] = [];
  for (const spec of specs) {
    const refs = [spec.p25, spec.p50, spec.p75];
    if (refs.some((ref) => seen.has(ref))) continue;
    const values = refs.map((ref) => numericState({ kind: "fact", ref }, data));
    const [p25, p50, p75] = values;
    const complete =
      p25 !== null &&
      p50 !== null &&
      p75 !== null &&
      p25.value <= p50.value &&
      p50.value <= p75.value;
    for (const ref of refs) seen.add(ref);
    if (complete) {
      bands.push({
        key: spec.p50,
        label: spec.label,
        min: spec.min,
        max: spec.max,
        p25: p25.value,
        p50: p50.value,
        p75: p75.value,
      });
      continue;
    }
    for (const ref of refs) {
      const row = entryRow({ kind: "fact", ref }, data);
      if (row) rows.push(row);
    }
  }
  return { bands, rows };
}
