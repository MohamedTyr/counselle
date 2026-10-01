import type {
  BandValue,
  DistributionBucket,
  Fact,
  MatrixRow,
  OrdinalValue,
  SchoolFactsResponse,
} from "@/features/schools/facts/school-facts-types";

/*
 * Read facts by key. Each block names the keys it draws (see blocks.ts), so
 * whatever no block draws can still be listed rather than lost — a curated
 * page must never quietly drop a published figure.
 */

export type Num = { value: number; display: string; period: string | null };
export type Band = {
  label: string;
  p25: number;
  p75: number;
  min: number;
  max: number;
};
export type Bucket = { label: string; pct: number };
export type Factor = { label: string; level: number; levelLabel: string };

const FACTOR_LEVEL_LABELS = [
  "Not considered",
  "Considered",
  "Important",
  "Very important",
];

export class FactReader {
  readonly facts: Map<string, Fact>;
  /** Fact key → the id of the server section it arrived in. */
  readonly sectionOf: Map<string, string>;
  /** Fact key → its group's server-written note, when the group has one. */
  readonly groupFootOf: Map<string, string>;
  readonly data: SchoolFactsResponse;

  constructor(data: SchoolFactsResponse) {
    this.data = data;
    this.facts = new Map();
    this.sectionOf = new Map();
    this.groupFootOf = new Map();
    for (const section of data.sections)
      for (const group of section.groups)
        for (const fact of group.facts) {
          this.facts.set(fact.key, fact);
          this.sectionOf.set(fact.key, section.id);
          if (group.foot) this.groupFootOf.set(fact.key, group.foot);
        }
  }

  /** The fact, only if it carries a published value. */
  get(key: string): Fact | null {
    const fact = this.facts.get(key);
    return fact && fact.state === "value" ? fact : null;
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  num(key: string): Num | null {
    const fact = this.get(key);
    if (!fact || typeof fact.value !== "number") return null;
    return {
      value: fact.value,
      display: fact.display,
      period: fact.reported_period,
    };
  }

  text(key: string): string | null {
    return this.get(key)?.display ?? null;
  }

  list(key: string): string[] {
    const fact = this.get(key);
    const items = (fact?.value as { items?: unknown } | null)?.items;
    if (Array.isArray(items)) {
      const strings = items.filter((i): i is string => typeof i === "string");
      /* Some sources publish a whole list as one comma-joined item. */
      return strings.length === 1 ? splitList(strings[0]!) : strings;
    }
    return fact ? splitList(fact.display) : [];
  }

  band(key: string, label: string): Band | null {
    const v = this.get(key)?.value as BandValue | undefined;
    if (
      !v ||
      v.p25 === null ||
      v.p75 === null ||
      v.min === null ||
      v.max === null
    )
      return null;
    return { label, p25: v.p25, p75: v.p75, min: v.min, max: v.max };
  }

  buckets(key: string): Bucket[] {
    const raw =
      (this.get(key)?.value as { buckets?: DistributionBucket[] } | undefined)
        ?.buckets ?? [];
    return raw
      .filter(
        (b): b is DistributionBucket & { pct: number } =>
          typeof b.pct === "number",
      )
      .map((b) => ({
        label: b.label.replace(/^Score of /, "").replace(/ - /g, "–"),
        pct: b.pct,
      }));
  }

  matrix(key: string): MatrixRow[] {
    return (
      (this.get(key)?.value as { rows?: MatrixRow[] } | undefined)?.rows ?? []
    );
  }

  link(key: string): string | null {
    const value = this.get(key)?.value;
    return typeof value === "string" && value.startsWith("http") ? value : null;
  }

  /** "1,127 (42.0%) of aid recipients" → 42. */
  share(key: string): number | null {
    const match = this.text(key)?.match(/\(([\d.]+)%\)/);
    return match ? Number(match[1]) : null;
  }

  /** A leading count from "93% of all students" or "42% of men participate". */
  leadingPct(key: string): number | null {
    const fact = this.get(key);
    if (!fact) return null;
    if (typeof fact.value === "number") return fact.value;
    const match = fact.display.match(/^([\d.]+)%/);
    return match ? Number(match[1]) : null;
  }

  factors(): Factor[] {
    const out: Factor[] = [];
    for (const fact of this.facts.values()) {
      if (
        !fact.key.startsWith("admissions.selection_factor_") ||
        fact.state !== "value"
      )
        continue;
      const v = fact.value as OrdinalValue;
      const level = v.levels.indexOf(v.code);
      if (level < 0) continue;
      const bare = fact.label
        .replace(/^Selection factor /i, "")
        .replace(/ s /g, "'s ");
      out.push({
        label: bare.charAt(0).toUpperCase() + bare.slice(1),
        level,
        levelLabel: FACTOR_LEVEL_LABELS[level] ?? fact.display,
      });
    }
    return out.sort((a, b) => b.level - a.level);
  }
}

function splitList(display: string): string[] {
  return display
    .split(/,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Whether a published availability phrase means yes. */
export function isYes(display: string): boolean {
  return !/^(no|none|not\b)/i.test(display.trim());
}

export function sentenceCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
