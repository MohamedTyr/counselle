import type {
  Caveat,
  DerivedFact,
  DomainCoverage,
  Fact,
  FactState,
  SchoolEdition,
  SchoolIdentity,
} from "@/features/schools/facts/school-facts-types";

/*
 * The copy deck, in code.
 *
 * Every string a student reads about the SHAPE of our data is decided here
 * and nowhere else. Scattering these across components is how "not reported"
 * quietly becomes "—" on the one screen nobody re-read.
 */

/**
 * Six states, six different sentences. The words are the whole point: each
 * one is a different claim about why there is no number, and a reader who
 * is choosing where to apply deserves to know which claim we are making.
 *
 * Never an empty cell, an em dash, a `0`, `N/A`, `null`, or a hidden row.
 */
export const ABSENCE_COPY: Record<
  Exclude<FactState["kind"], "reported">,
  string
> = {
  not_reported: "not reported",
  not_applicable: "not applicable",
  suppressed: "withheld by the school",
  not_in_template_version: "not in this form edition",
  no_verified_value: "no verified value",
};

/** A derived value whose inputs are incomplete. Distinct from all six above. */
export const DERIVED_UNAVAILABLE_COPY = "not available";

export const ROUND_NOT_OFFERED_COPY = "not offered";

export const ABSENT_TOPIC_EXPLANATION =
  "Not a Common Data Set field. Counselle checks the school's site when you ask.";

export function factStateCopy(state: FactState): string {
  return state.kind === "reported" ? state.display : ABSENCE_COPY[state.kind];
}

export function isReported(state: FactState): boolean {
  return state.kind === "reported";
}

/*
 * The coverage line is a contract, not a decoration (DATABASE_GUIDE.md:226).
 *
 *   M comes from the current manifest and is never Object.keys(facts).length.
 *   K — the not_in_template_version count — is stated SEPARATELY. Those are
 *   metrics whose row does not exist in this school's form edition, which is
 *   a fact about the form, not a gap in our data.
 *   The word "missing" never appears.
 */
export function coverageLine(
  coverage: DomainCoverage | undefined,
  edition: SchoolEdition | null,
): string {
  const parts: string[] = [];
  if (coverage && coverage.packet !== "missing") {
    parts.push(`${coverage.verified} of ${coverage.configured} verified`);
    if (coverage.notInTemplate > 0) {
      parts.push(`${coverage.notInTemplate} not in this form edition`);
    }
  }
  if (edition) parts.push(`CDS ${academicYearLabel(edition.academicYear)}`);
  return parts.join(" · ");
}

/**
 * The rail's right-hand fraction. A section with no packet shows an em dash,
 * NOT `0/28` — zero-of-N asserts we looked and found nothing, which is a
 * different and stronger claim than "we have nothing to look at".
 */
export function coverageFraction(coverage: DomainCoverage | undefined): string {
  if (!coverage || coverage.packet === "missing") return "—";
  return `${coverage.verified}/${coverage.configured}`;
}

/** 2025 → "2024–25". En dash, matching the CDS's own cover page. */
export function academicYearLabel(year: number): string {
  return `${year - 1}–${String(year).slice(-2)}`;
}

export function identityMeta(identity: SchoolIdentity): string {
  /*
   * An absent identity part is DROPPED rather than rendered as "unknown".
   * These are not metrics — nobody is deciding where to apply based on
   * whether we know the city — and running the absence grammar here would
   * spend the reader's attention on the one line where it buys nothing.
   */
  const place = [identity.city, identity.state].filter(Boolean).join(", ");
  const control =
    identity.control === "public"
      ? "Public"
      : identity.control === "private"
        ? "Private"
        : null;
  const size =
    identity.undergraduates === null
      ? null
      : `${identity.undergraduates.toLocaleString()} undergraduates`;
  return [place || null, control, size].filter(Boolean).join(" · ");
}

/** Resolve caveat ids against the registry, severe first so it reads first. */
export function resolveCaveats(
  refs: readonly string[],
  registry: Record<string, Caveat>,
): Caveat[] {
  const resolved = refs
    .map((ref) => registry[ref])
    .filter((caveat): caveat is Caveat => Boolean(caveat));
  return [
    ...resolved.filter((caveat) => caveat.severity === "severe"),
    ...resolved.filter((caveat) => caveat.severity !== "severe"),
  ];
}

export function hasSevereCaveat(
  refs: readonly string[],
  registry: Record<string, Caveat>,
): boolean {
  return refs.some((ref) => registry[ref]?.severity === "severe");
}

/**
 * A group's closed header has to admit what is inside it. Without this, a
 * severe caveat or a suppressed value is one disclosure away from invisible,
 * which is the failure DESIGN rule 38 exists to prevent.
 */
export function groupNeedsAttention(
  facts: readonly (Fact | DerivedFact)[],
  registry: Record<string, Caveat>,
): boolean {
  return facts.some(
    (fact) =>
      fact.state.kind === "suppressed" ||
      hasSevereCaveat(fact.caveatRefs, registry),
  );
}

/** The vintage suffix — "entering class, Fall 2025". */
export function contextSuffix(fact: Fact): string | null {
  if (fact.contexts.length === 0) return null;
  return fact.contexts.map((context) => context.display).join(" · ");
}

export type EditionBannerVariant = "stale" | "partial" | "definition";

/**
 * Which banners this edition earns, in the order they should be read.
 *
 * `stale` and `definition` qualify every number on the page, so they render
 * once, above the section body. `partial` is not edition-wide — it belongs
 * to the specific sections whose packet came through incomplete, and that is
 * `sectionBannerVariants`' job. Repeating an edition-wide banner on all six
 * sections would spend the page's one warning hue six times on one fact.
 */
export function editionBannerVariants(
  edition: SchoolEdition | null,
): EditionBannerVariant[] {
  if (!edition) return [];
  const variants: EditionBannerVariant[] = [];
  if (edition.currentness === "stale") variants.push("stale");
  if (!edition.currentDefinitionMatch) variants.push("definition");
  return variants;
}

/** The banner a single section earns on its own. */
export function sectionBannerVariants(
  coverage: DomainCoverage | undefined,
): EditionBannerVariant[] {
  return coverage?.packet === "partial" ? ["partial"] : [];
}
