import type { ReactNode } from "react";

import { CaveatList } from "@/features/schools/facts/CaveatLine";
import {
  DerivedEvidenceChip,
  EvidenceChip,
} from "@/features/schools/facts/EvidenceChip";
import {
  contextSuffix,
  DERIVED_UNAVAILABLE_COPY,
  factStateCopy,
  resolveCaveats,
} from "@/features/schools/facts/school-facts-format";
import type {
  Caveat,
  DerivedFact,
  Fact,
  FactState,
  SchoolEdition,
} from "@/features/schools/facts/school-facts-types";
import { cn } from "@/lib/utils";

/*
 * The atom. Every fact on this page renders through this one component,
 * which is how the honesty rules stay enforced in one place instead of
 * thirty.
 *
 * The row is a <dt>/<dd> pair inside a <dl>, and the caveat is a SECOND <dd>
 * bound to the same <dt> — so a screen reader reading the value goes on to
 * read the qualifier without being asked to hover anything.
 *
 * Never rendered: an empty cell · an em dash · a bare 0 standing in for
 * absence · "N/A" · "null" · a hidden row.
 */

const labelClassName = cn(
  /* Wraps, never truncates. These labels are long by nature —
   * "average percent of need met, first-time first-year" — and a truncated
   * metric label is an unreadable one. */
  "text-sm leading-6 text-[var(--school-fact-label)]",
  "@md:col-start-1 @md:row-start-1",
);

const valueRowClassName = cn(
  "mt-0.5 flex items-baseline gap-2",
  "@md:mt-0 @md:col-start-2 @md:row-start-1 @md:justify-self-end",
);

function valueClassName(state: FactState): string {
  if (state.kind === "reported") {
    /* A reported 0 or false lands here, at full weight. It is a fact. */
    return "text-sm leading-6 font-medium tabular-nums text-[var(--school-fact-value)] @md:text-right";
  }
  /*
   * Italic and NOT font-medium. Absence is not a value, and weight would
   * make it read as one — the eye scanning a column of numbers should be
   * able to tell in peripheral vision which cells are claims and which are
   * admissions. Still right-aligned so the column edge holds.
   */
  return "text-sm leading-6 italic text-[var(--school-fact-absent)] @md:text-right";
}

function RowShell({
  caveats,
  children,
  footer,
  interactive,
}: {
  caveats: readonly Caveat[];
  children: ReactNode;
  /** Rendered above the caveats, in the same trailing <dd>. */
  footer?: ReactNode;
  interactive: boolean;
}) {
  const hasFooter = Boolean(footer) || caveats.length > 0;
  return (
    <div
      className={cn(
        "-mx-2 grid grid-cols-1 gap-x-4 rounded-md px-2 py-2.5",
        "@md:grid-cols-[minmax(0,1fr)_auto]",
        /* Hover only when there is evidence to reveal. A row with nothing
         * behind it should not advertise itself as interactive. */
        interactive &&
          "transition-colors duration-150 hover:bg-[var(--surface-hover)]",
      )}
    >
      {children}
      {hasFooter ? (
        /* A second <dd> bound to the same <dt>. Valid HTML, and it is what
         * keeps the qualifier inside the value's own definition rather than
         * beside it. */
        <dd className="@md:col-span-2 @md:row-start-2">
          {footer}
          <CaveatList caveats={caveats} />
        </dd>
      ) : null}
    </div>
  );
}

export function FactRow({
  caveats,
  edition,
  fact,
}: {
  caveats: Record<string, Caveat>;
  edition: SchoolEdition | null;
  fact: Fact;
}) {
  const resolved = resolveCaveats(fact.caveatRefs, caveats);
  const vintage = contextSuffix(fact);

  return (
    <RowShell caveats={resolved} interactive={Boolean(fact.evidence)}>
      <dt className={labelClassName}>{fact.label}</dt>
      <dd className={valueRowClassName}>
        <span className={valueClassName(fact.state)}>
          {/* The code-produced display string, verbatim. Never reformatted,
           * never re-rounded, never paraphrased — 58 of the kept metrics are
           * percent-semantic strings preserving tokens like "<1%", and
           * parsing one to make it prettier destroys the qualifier. */}
          {factStateCopy(fact.state)}
        </span>
        {vintage ? (
          <span className="shrink-0 text-xs text-[var(--ink-muted)]">
            {vintage}
          </span>
        ) : null}
        {fact.evidence ? (
          <EvidenceChip
            edition={edition}
            evidence={fact.evidence}
            label={fact.label}
          />
        ) : null}
      </dd>
    </RowShell>
  );
}

/**
 * A value the CDS does not print and we compute — the admit rate, the share
 * of classes under 20, the honest need-met figure.
 *
 * Marked by the WORD "calculated", never by colour. Rule 39: no decorative
 * colour that implies data meaning, and "we did arithmetic" is not a quality
 * judgement about the number.
 */
export function DerivedFactRow({
  caveats,
  derived,
  edition,
}: {
  caveats: Record<string, Caveat>;
  derived: DerivedFact;
  edition: SchoolEdition | null;
}) {
  const resolved = resolveCaveats(derived.caveatRefs, caveats);
  const computed = derived.state.kind === "reported";
  /*
   * "not available" means we tried and an input stopped us. When the state
   * is a real absence — the school does not report a residency split at all,
   * say — that state's own words are the truthful ones, and borrowing
   * "not available" would claim an attempt we never made.
   */
  const valueCopy = computed
    ? derived.state.display
    : derived.blockedBy
      ? DERIVED_UNAVAILABLE_COPY
      : factStateCopy(derived.state);

  return (
    <RowShell
      caveats={resolved}
      footer={
        computed ? (
          <p className="mt-1 text-xs leading-5 text-[var(--school-fact-derived-ink)]">
            calculated · {derived.formula}
          </p>
        ) : !derived.blockedBy ? null : (
          /*
           * A derived value whose inputs are not all reported does not
           * compute. It says which input stopped it. Never a partial
           * computation, never a zero denominator, never a silent omission —
           * an admit rate quietly rendered from a missing applicant count is
           * the most convincing wrong number this page could produce.
           */
          <p className="mt-1 text-xs leading-5 text-[var(--school-fact-caveat)]">
            {derived.blockedBy}
          </p>
        )
      }
      interactive={computed}
    >
      <dt className={labelClassName}>{derived.label}</dt>
      <dd className={valueRowClassName}>
        <span className={valueClassName(derived.state)}>{valueCopy}</span>
        {computed ? (
          <DerivedEvidenceChip derived={derived} edition={edition} />
        ) : null}
      </dd>
    </RowShell>
  );
}
