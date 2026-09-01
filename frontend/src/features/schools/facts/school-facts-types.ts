/*
 * The read model for the About tab.
 *
 * Shaped as the eventual packet-v8 query result so swapping fixtures for a
 * real read is a change of source and not of shape. Three properties of this
 * model are load-bearing and must not be relaxed:
 *
 *   1. There is no `string | null` value anywhere. A value is a FactState,
 *      and every non-reported state names itself. `null` would collapse six
 *      distinct claims — "the school didn't report it", "it doesn't apply",
 *      "the school withheld it", "the row isn't in this form edition", "we
 *      couldn't read it" — into one blank, and a blank reads as zero.
 *
 *   2. `caveatRefs` is not optional. You cannot construct a Fact for an SAT
 *      percentile without the submitter-rate caveat that makes it true. That
 *      is METRICS-KEEP.md's schema decision 2 enforced by the compiler
 *      rather than by anyone's discipline.
 *
 *   3. Coverage carries `configured` from the manifest. It is never
 *      `Object.keys(facts).length` — see DATABASE_GUIDE.md:226.
 */

export type SectionId =
  | "getting-in"
  | "money"
  | "academics"
  | "campus-life"
  | "outcomes"
  | "applying";

/*
 * The eight (extraction_status × availability_status) combinations of
 * DATABASE_GUIDE.md §6, already collapsed to the six the student sees.
 * `not_extracted`, `conflict` and `invalid` all mean the same thing to a
 * reader — we have no verified value — so they share one kind. The
 * distinction matters to the pipeline, not to the page.
 *
 * Only `reported` is a student value. A reported `0` or `false` IS a fact:
 * it renders at full weight in the value ink, never as absence.
 */
export type FactState =
  | { kind: "reported"; display: string; raw: unknown }
  | { kind: "not_reported" }
  | { kind: "not_applicable" }
  | { kind: "suppressed" }
  | { kind: "not_in_template_version" }
  | { kind: "no_verified_value" };

export type Evidence = {
  /** Positive physical PDF page. Packet v8 forbids anything else. */
  pageNumber: number;
  excerpt: string;
  section: string | null;
  row: string | null;
  column: string | null;
  /**
   * True only for `not_in_template_version`, where the excerpt proves a row
   * is ABSENT from this form edition rather than carrying a value. The chip
   * reads "proof" instead of a bare page number so the two are never
   * confused.
   */
  isAbsenceProof?: boolean;
};

/**
 * Severe means: the number cannot be read correctly without this sentence.
 * Sub-50% submitter rates, a suppressed value, a stale edition. Nothing
 * else. If everything is severe, nothing is.
 */
export type CaveatSeverity = "ordinary" | "severe";

export type Caveat = {
  id: string;
  text: string;
  severity: CaveatSeverity;
  /**
   * The same qualifier compressed for the headline strip's 12px foot —
   * "62% submitted" rather than the full sentence. It is a shorter way to
   * say the same thing, never a weaker one, and the full text always
   * renders on the row itself.
   */
  short?: string;
};

/** A compiled binder — renders as the vintage suffix on the value it dates. */
export type FactContext = {
  id: string;
  label: string;
  display: string;
};

export type Fact = {
  /** Qualified: `<domain_id>.<metric_id>`. Never a bare metric id. */
  ref: string;
  label: string;
  state: FactState;
  evidence: Evidence | null;
  /** Omitted entirely when any binder is missing — never a guessed year. */
  contexts: FactContext[];
  /** Required, not optional. See the file header. */
  caveatRefs: string[];
};

export type DerivedInput = {
  ref: string;
  label: string;
  evidence: Evidence | null;
};

/**
 * A value we compute because the CDS does not print it — the admit rate, the
 * share of classes under 20, the honest need-met figure.
 *
 * A derived value whose inputs are not all reported does not compute. It
 * carries `blockedBy` naming the input that stopped it, and renders "not
 * available" with that reason. Never a partial computation, never a zero
 * denominator, never a silent omission.
 */
export type DerivedFact = {
  key: string;
  label: string;
  state: FactState;
  /** Human arithmetic, shown in the evidence card: "2,275 ÷ 49,000". */
  formula: string;
  inputs: DerivedInput[];
  blockedBy: string | null;
  caveatRefs: string[];
};

export type DomainCoverage = {
  /** N — verified metrics. */
  verified: number;
  /** M — configured in the CURRENT manifest. Server-supplied, never counted. */
  configured: number;
  /** K — stated separately, never folded into a "missing" count. */
  notInTemplate: number;
  packet: "accepted" | "partial" | "missing";
};

export type SchoolIdentity = {
  unitid: number;
  name: string;
  city: string | null;
  state: string | null;
  control: "public" | "private" | null;
  undergraduates: number | null;
  websiteUrl: string | null;
  /** Bare domain, for "Ask Counselle to check yale.edu". */
  domain: string | null;
};

export type SchoolEdition = {
  academicYear: number;
  documentId: string;
  documentUrl: string | null;
  currentness: "current" | "stale";
  stalenessReason: string | null;
  partialDomainCount: number;
  configuredDomainCount: number;
  /** False when this edition was read under an older metric definition. */
  currentDefinitionMatch: boolean;
};

/** One of the thirteen topics confirmed absent from the whole CDS. */
export type AbsentTopic = {
  id: string;
  section: SectionId;
  topic: string;
  explanation: string;
};

/*
 * Applying is the one section where our own web-verified data and the CDS
 * both speak, and where they are allowed to disagree. Rendering only one of
 * them would be picking a winner silently, so both lanes always render.
 */
export type OfficialLane = {
  state: FactState;
  source: string;
  sourceUrl: string;
  verifiedAt: string;
};

export type CdsLane = {
  state: FactState;
  evidence: Evidence | null;
};

export type LaneRow = {
  id: string;
  label: string;
  official: OfficialLane | null;
  cds: CdsLane | null;
  /**
   * Whether the two lanes actually contradict each other. Decided where the
   * raw values live, never by comparing the two display strings: "January 2,
   * 2027" and "January 2" are the same deadline written twice, and a
   * renderer that string-compares them would tell a student their sources
   * conflict when they agree.
   */
  disagrees: boolean;
  caveatRefs: string[];
};

/**
 * `offered: "not_reported"` and `offered: "no"` are different claims. A
 * school that does not offer ED is not the same as a school whose
 * offered-flag we could not read, and the table must not collapse them.
 */
export type RoundRow = {
  code: string;
  offered: "yes" | "no" | "not_reported";
  restrictive: boolean;
  deadline: LaneRow;
  notification: FactState;
};

/** Degree shares — the one place a bar is legal on this page. */
export type DegreeShare = {
  ref: string;
  label: string;
  state: FactState;
  /** Null whenever the state is not `reported`; the row still renders. */
  percent: number | null;
};

export type SchoolFacts = {
  identity: SchoolIdentity;
  /** Null when we hold no readable Common Data Set for this school. */
  edition: SchoolEdition | null;
  /** Keyed by SectionId — the server aggregates each section's domains. */
  coverage: Record<string, DomainCoverage>;
  /** Keyed by qualified ref. */
  facts: Record<string, Fact>;
  /** Keyed by derived key. */
  derived: Record<string, DerivedFact>;
  /** Keyed by caveat id; Facts point in here rather than carrying prose. */
  caveats: Record<string, Caveat>;
  absent: AbsentTopic[];
  rounds: RoundRow[];
  /** Application fee, testing policy, reply deadline, deposit. */
  applyingLanes: LaneRow[];
  degreeShares: DegreeShare[];
};
