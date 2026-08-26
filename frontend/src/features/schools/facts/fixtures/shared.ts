import type {
  AbsentTopic,
  SchoolFacts,
  Caveat,
  DerivedFact,
  Evidence,
  Fact,
  FactState,
} from "@/features/schools/facts/school-facts-types";
import { ABSENT_TOPIC_EXPLANATION } from "@/features/schools/facts/school-facts-format";

/*
 * ============================================================================
 * FIXTURES. EVERY NUMBER BELOW IS FABRICATED.
 *
 * This file exists so the About tab can be designed and reviewed before the
 * packet-v8 read exists. It must be replaced by a real query against the CDS
 * Library views before this tab is shown to a student — AGENTS.md principle 3
 * is not negotiable, and a plausible number is a more dangerous lie than an
 * obvious one. The qualified refs below are illustrative of the shape the
 * manifest produces; they are not an assertion that these exact metric ids
 * exist.
 * ============================================================================
 *
 * The set is deliberately WORSE than reality, because a clean fixture set
 * hides exactly the render paths that matter. Between the three schools it
 * covers: a partial packet, a section with no packet at all, a school on a
 * stale edition, a school with no readable CDS whatsoever, three
 * not_in_template_version values carrying page proof, a suppressed value, a
 * not_applicable value, an ACT band under 50% submitted (the severe caveat),
 * a "<1%" string percent, a legitimate 0, a school publishing one combined
 * cost figure with every itemized row blank, a school whose applicant count
 * is unreported so the admit rate refuses to compute, and a current-cycle
 * deadline that disagrees with the CDS figure.
 */

export type { SchoolFacts };

// ---------------------------------------------------------------- builders

export const reported = (
  display: string,
  raw: unknown = display,
): FactState => ({
  kind: "reported",
  display,
  raw,
});

export const page = (
  pageNumber: number,
  excerpt: string,
  section: string | null = null,
  row: string | null = null,
): Evidence => ({
  pageNumber,
  excerpt,
  section,
  row,
  column: null,
});

/** Absence proof: the excerpt shows the row does not exist in this edition. */
export const proof = (
  pageNumber: number,
  excerpt: string,
  section: string | null,
): Evidence => ({
  pageNumber,
  excerpt,
  section,
  row: null,
  column: null,
  isAbsenceProof: true,
});

export function f(
  ref: string,
  label: string,
  state: FactState,
  options: {
    caveats?: string[];
    evidence?: Evidence | null;
    contexts?: Fact["contexts"];
  } = {},
): Fact {
  return {
    ref,
    label,
    state,
    evidence: options.evidence ?? null,
    contexts: options.contexts ?? [],
    caveatRefs: options.caveats ?? [],
  };
}

export function index(facts: Fact[]): Record<string, Fact> {
  return Object.fromEntries(facts.map((item) => [item.ref, item]));
}

export function indexDerived(
  items: DerivedFact[],
): Record<string, DerivedFact> {
  return Object.fromEntries(items.map((item) => [item.key, item]));
}

// ---------------------------------------------------------------- caveats

const SHARED_CAVEATS: Caveat[] = [
  {
    id: "sat-submitters",
    severity: "ordinary",
    text: "62% of the enrolled class submitted an SAT score.",
    short: "62% submitted",
  },
  {
    id: "act-submitters-low",
    severity: "severe",
    text: "Only 41% of the class submitted an ACT score — this band describes the top third, not the class.",
    short: "only 41% submitted",
  },
  {
    id: "gpa-submitted-low",
    severity: "severe",
    text: "Only 44% of the class reported a GPA.",
    short: "only 44% reported",
  },
  {
    id: "rank-submitted-low",
    severity: "severe",
    text: "Only 31% of the class had a rank to report — most US high schools no longer rank.",
  },
  {
    id: "suppressed",
    severity: "severe",
    text: "The school withheld this value. We do not infer it.",
  },
  {
    id: "stale-edition",
    severity: "severe",
    text: "These figures come from the 2023–24 CDS, not the current one.",
  },
  {
    id: "need-met-recipients",
    severity: "ordinary",
    text: "of aid recipients, not all students — excludes PLUS and private loans",
  },
  {
    id: "ratio-basis",
    severity: "ordinary",
    text: "The school defines the population behind this ratio; it is not comparable cell-for-cell across schools.",
  },
  {
    id: "not-additive",
    severity: "ordinary",
    text: "Out-of-state and international are counted separately; these two figures do not add up to a share of non-local students.",
  },
  {
    id: "rank-nested",
    severity: "ordinary",
    text: "Bands overlap — the top tenth is inside the top quarter. They cannot be added or subtracted.",
  },
  {
    id: "waitlist-volatile",
    severity: "ordinary",
    text: "Waitlist numbers swing widely year to year. Read them as context, not as odds.",
  },
  {
    id: "retention-copied",
    severity: "ordinary",
    text: "Copied as the school printed it. Recomputing it would disagree with their own figure, because the rate carries form-defined exclusions.",
  },
  {
    id: "pell-not-prediction",
    severity: "ordinary",
    text: "Pell status is a socioeconomic fact, not a prediction about you. This is the school's published figure for low-income completion.",
  },
  {
    id: "cost-stale-direction",
    severity: "ordinary",
    text: "Published before the cycle's final costs were set, so it is a floor rather than an estimate.",
  },
  {
    id: "printed-need-met-below",
    severity: "ordinary",
    text: "The school's own printed “average percent of need met” is in Need-based aid below, with the caveat that makes it readable.",
  },
  {
    id: "combined-cost-only",
    severity: "ordinary",
    text: "This school publishes one combined figure rather than an itemized breakdown, so the itemized rows are blank by design.",
  },
];

export const caveatRegistry: Record<string, Caveat> = Object.fromEntries(
  SHARED_CAVEATS.map((caveat) => [caveat.id, caveat]),
);

// ---------------------------------------------------------------- absences

export function absentTopics(): AbsentTopic[] {
  const standard = ABSENT_TOPIC_EXPLANATION;
  return [
    {
      id: "need-blind",
      section: "getting-in",
      topic: "Need-blind or need-aware",
      explanation: standard,
    },
    {
      id: "admit-by-major",
      section: "getting-in",
      topic: "Admit rate by major or college",
      explanation: standard,
    },
    {
      id: "ea-counts",
      section: "getting-in",
      topic: "Early-action applicant and admit counts",
      explanation:
        "The Common Data Set publishes early-decision counts but no early-action counts at all, which is why no round-by-round rate can be calculated for an EA school.",
    },
    {
      id: "legacy-athlete",
      section: "getting-in",
      topic: "Legacy and athlete admit rates",
      explanation: standard,
    },
    {
      id: "superscoring",
      section: "getting-in",
      topic: "Superscoring policy",
      explanation: standard,
    },
    {
      id: "net-price-bands",
      section: "money",
      topic: "Net price by income band",
      explanation:
        "There is no income dimension anywhere in the cost or aid domains. Use the school's net price calculator, linked above, for a figure specific to your family.",
    },
    {
      id: "meets-full-need",
      section: "money",
      topic: "The meets-full-need pledge",
      explanation:
        "Only the realized outcome is published — how much need was met last year — never the promise itself.",
    },
    {
      id: "salary-outcomes",
      section: "outcomes",
      topic: "Salary, employment, and graduate-school placement",
      explanation:
        "College Scorecard publishes these; the Common Data Set does not.",
    },
    {
      id: "program-catalogue",
      section: "academics",
      topic: "The program and major catalogue",
      explanation:
        "The CDS reports what students graduated in, not what the school offers. “Do they have linguistics” is not answerable from this data.",
    },
    {
      id: "campus-setting",
      section: "campus-life",
      topic: "Campus setting and urbanicity",
      explanation:
        "A first-order fit filter with no Common Data Set field behind it.",
    },
    {
      id: "religious-affiliation",
      section: "campus-life",
      topic: "The school's own religious affiliation",
      explanation:
        "The selection-factor row says whether faith commitment is weighed in admission; nothing states the school's own affiliation. The two are easy to confuse.",
    },
    {
      id: "application-platform",
      section: "applying",
      topic: "Application platform (Common App / Coalition)",
      explanation: standard,
    },
    {
      id: "interview-format",
      section: "applying",
      topic: "Interview availability and format",
      explanation: standard,
    },
  ];
}
