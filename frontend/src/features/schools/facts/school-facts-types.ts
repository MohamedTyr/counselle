/*
 * The wire shape for `GET /v1/schools/{unitid}/facts` (plan §5.2), mirrored
 * by hand from `app/facts/response_models.py`. Snake_case throughout — the
 * app's convention (see `api/workspace/types.ts`) is to keep the frontend
 * type a direct transcription of the pydantic response, not a re-cased
 * mirror, so there is exactly one name for each field across the wire.
 *
 * Every student-facing word on this response — `display`, `line`, `foot`,
 * the deadline block's `foot`, the band caption — is composed server-side in
 * `app/facts/service.py`/`domain/facts/state.py`. This file adds no copy: it
 * only names the shape that copy arrives in.
 */

export type FactStateWire =
  | "value"
  | "not_reported"
  | "not_fetched"
  | "not_published"
  | "not_collected";

export type FactKindWire =
  | "scalar"
  | "link"
  | "list"
  | "table"
  | "matrix"
  | "distribution"
  | "band"
  | "ordinal";

export type FetchStateWire = "ok" | "partial" | "not_fetched" | "not_published";

export type SchoolIdentity = {
  unitid: number;
  name: string;
  city: string | null;
  state: string | null;
  control: "public" | "private" | "private_for_profit" | null;
  undergraduates: number | null;
  website_url: string | null;
  domain: string | null;
};

/** A `band` fact's `value` — SAT/ACT `_p25`/`_p75` already merged server-side.
 * There is no `p50`: CollegeData publishes no median, and synthesising one
 * is the one thing this page refuses to do (plan §6b, R14). */
export type BandValue = {
  p25: number | null;
  p75: number | null;
  min: number | null;
  max: number | null;
  submitted_percent: number | null;
};

/** An `ordinal` fact's `value` — the source's own vocabulary, marked. */
export type OrdinalValue = {
  code: string;
  levels: string[];
};

/** A `distribution` fact's `value` — a `BarGraph`, as published. A bucket
 * with `absence: "not_reported"` is PRESENT but unplotted, distinct from a
 * label omitted entirely (`omitted_buckets`) — neither is ever a zero-width
 * bar (plan §5.1/§7). `absence_display`/`OmittedBucket.display` are composed
 * server-side (`app/facts/service.py`'s `_enrich_distribution`) — the chart
 * renders them verbatim and authors no absence word of its own. */
export type DistributionBucket = {
  label: string;
  lo?: number;
  hi?: number;
  pct?: number;
  absence?: "not_reported";
  absence_display?: string;
};

export type OmittedBucket = {
  label: string;
  display: string;
};

export type DistributionValue = {
  scale: string;
  buckets: DistributionBucket[];
  omitted_buckets: OmittedBucket[];
  sums_to: number | null;
};

/* A `list` fact carries no dedicated value type: `_kind_and_value` reads
 * `{items: string[]}` server-side but the wire's `display` (already
 * comma-joined) is all this page renders — a `list` fact takes the same
 * plain "rows" path as `scalar`/`link` in `school-facts-blocks.ts`, so
 * there is no reader for a typed `value` shape here. */

/** A `matrix` fact's `value` (the sports-offered / scholarship icon grid) —
 * one row per label, one boolean per column. A `false` cell is a real "no",
 * never a missing cell. */
export type MatrixRow = { label: string } & Record<string, boolean>;
export type MatrixValue = { rows: MatrixRow[] };

/** A `table` fact's `value` — a generic labelled table (no producer ships
 * this yet; the shape stays honest to `domain/facts/normalize.py::normalize_table`
 * for when one does). */
export type TableValue = { rows: Record<string, unknown>[] };

export type Fact = {
  key: string;
  label: string;
  tab: string;
  state: FactStateWire;
  kind: FactKindWire;
  /** Never blank — the absence word itself when `state !== "value"`. */
  display: string;
  unit: string | null;
  value: unknown;
  observed_at: string | null;
  reported_period: string | null;
  caveat_ids: string[];
};

export type FactGroup = {
  id: string;
  label: string | null;
  foot: string | null;
  chart: Record<string, unknown> | null;
  facts: Fact[];
};

export type FactSection = {
  id: string;
  title: string;
  fetch_state: FetchStateWire;
  never_checked: boolean;
  line: string | null;
  foot: string | null;
  groups: FactGroup[];
};

export type DeadlineRow = {
  round: string;
  date: string | null;
  display: string;
  reported_period: string | null;
  state: FactStateWire;
  observed_at: string | null;
};

export type DeadlinesBlock = {
  rows: DeadlineRow[];
  foot: string;
};

export type CaveatWire = {
  id: string;
  text: string;
  severity: "ordinary" | "severe";
};

export type SchoolFactsResponse = {
  identity: SchoolIdentity;
  has_collegedata: boolean;
  observed_at: string | null;
  is_stale: boolean;
  freshness_line: string | null;
  deadlines: DeadlinesBlock;
  sections: FactSection[];
  caveats: CaveatWire[];
};
