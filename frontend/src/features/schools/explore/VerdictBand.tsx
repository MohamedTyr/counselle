import type {
  ExploreFields,
  FitCaveat,
  FitEstimate,
  FitSignal,
  FitSignalSource,
  FitUnavailableReason,
} from "@/api/schools/explore";
import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { pickBand } from "@/features/schools/explore/band-preview";
import {
  ABSENT_LABEL,
  formatBand,
  formatPercent,
} from "@/features/schools/explore/explore-format";
import type { ExploreAssumptions } from "@/features/schools/explore/explore-types";

/*
 * The verdict zone is a server-owned planning classification. Its rate is
 * the server's canonical baseline rate, and the category is deliberately
 * never recomputed from fields or URL-local assumptions in the browser.
 */

function EvidenceLine({
  fields,
  assumptions,
  bandCaptionId,
}: {
  fields: ExploreFields;
  assumptions: ExploreAssumptions;
  bandCaptionId: string | null;
}) {
  const formatted = formatBand(pickBand(fields, assumptions));

  if (formatted === null) {
    return (
      <p className="mt-2 text-xs text-[var(--school-value-absent)]">
        test range {ABSENT_LABEL}
      </p>
    );
  }

  return (
    <p
      aria-describedby={bandCaptionId ?? undefined}
      className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs tabular-nums"
    >
      <span className="text-[var(--ink-secondary)]">{formatted}</span>
      <span aria-hidden="true" className="text-[var(--ink-disabled)]">
        ·
      </span>
      <span className="text-[var(--ink-muted)]">
        Explore preview — does not affect estimate
      </span>
    </p>
  );
}

const signalCopy: Record<FitSignalSource, Record<"strong" | "weak", string>> = {
  gpa_distribution: {
    strong:
      "GPA is in the upper part of the reported entering-class distribution.",
    weak: "GPA is in the lower part of the reported entering-class distribution.",
  },
  class_rank: {
    strong: "Class rank is in the upper part of the reported entering class.",
    weak: "Class rank is in the lower part of the reported entering class.",
  },
  sat: {
    strong:
      "SAT scores are in the upper part of the reported entering-class range.",
    weak: "SAT scores are in the lower part of the reported entering-class range.",
  },
  act: {
    strong:
      "ACT score is in the upper part of the reported entering-class range.",
    weak: "ACT score is in the lower part of the reported entering-class range.",
  },
  sat_and_act: {
    strong:
      "SAT and ACT scores are in the upper part of the reported entering-class ranges.",
    weak: "SAT and ACT scores are in the lower part of the reported entering-class ranges.",
  },
};

const unavailableCopy: Record<FitUnavailableReason, string> = {
  profile_gpa_missing:
    "GPA comparison unavailable because your Profile has no GPA.",
  profile_gpa_invalid:
    "GPA comparison unavailable because the Profile GPA is invalid.",
  gpa_scale_incompatible:
    "GPA comparison unavailable because the GPA scales do not match.",
  gpa_distribution_unavailable:
    "GPA comparison unavailable because the school did not report a usable distribution.",
  gpa_distribution_stale:
    "GPA comparison unavailable because the school's distribution may be out of date.",
  gpa_distribution_invalid:
    "GPA comparison unavailable because the school's distribution could not be validated.",
  profile_rank_unavailable:
    "Class-rank comparison unavailable because your Profile has no complete rank.",
  rank_disabled:
    "Class-rank comparison unavailable because rank comparison is disabled in your Profile.",
  rank_distribution_unavailable:
    "Class-rank comparison unavailable because the school did not report usable rank shares.",
  rank_distribution_stale:
    "Class-rank comparison unavailable because the school's rank shares may be out of date.",
  rank_distribution_invalid:
    "Class-rank comparison unavailable because the school's rank shares could not be validated.",
  profile_test_missing:
    "Test comparison unavailable because your Profile has no complete test score.",
  test_score_invalid:
    "Test comparison unavailable because the Profile test score is invalid.",
  incomplete_sat_comparison:
    "Test comparison unavailable because both SAT sections are needed.",
  test_band_unavailable:
    "Test comparison unavailable because the school did not report a usable range.",
  test_band_stale:
    "Test comparison unavailable because the school's test range may be out of date.",
  test_band_invalid:
    "Test comparison unavailable because the school's test range could not be validated.",
  test_policy_not_required_or_unknown:
    "Test comparison unavailable because the school's testing policy is either not required or not confirmed in our data.",
};

const caveatCopy: Record<FitCaveat, string> = {
  entering_class_benchmark_not_cutoff:
    "Entering-class benchmarks are context, not admission cutoffs or personal odds.",
  stale_optional_facts:
    "Some optional school facts may be out of date; they were not used to adjust this estimate.",
};

function signalLabel(signal: FitSignal): string {
  return signal.factor === "academic" ? "Academic" : "Testing";
}

function displayCategory(category: FitEstimate["category"]): string {
  return category === "Unknown" ? "Not classified" : category;
}

function estimateBasisLabel(fit: FitEstimate): string {
  if (fit.basis === "missing_admit_rate") {
    return "Admit rate not available";
  }
  if (fit.basis === "school_rate") {
    return "Based on school admit rate";
  }
  return fit.category === fit.baseline_category
    ? "Checked against your profile"
    : "Adjusted using your profile";
}

function FitExplanation({
  fit,
  contentId,
  expanded,
}: {
  fit: FitEstimate;
  contentId: string;
  expanded: boolean;
}) {
  if (fit.basis === "missing_admit_rate") {
    return null;
  }

  const signals = fit.signals.slice(0, 2);
  const unavailable = fit.unavailable
    .filter(
      (item, index, all) =>
        all.findIndex((candidate) => candidate.factor === item.factor) ===
        index,
    )
    .slice(0, 2);
  const caveats = [
    ...(fit.basis === "personalized"
      ? [caveatCopy.entering_class_benchmark_not_cutoff]
      : []),
    ...fit.caveats.map((caveat) => caveatCopy[caveat]),
  ].filter((caveat, index, all) => all.indexOf(caveat) === index);

  return (
    <div
      className="mt-2 flex flex-col gap-1.5 text-xs text-[var(--ink-muted)]"
      hidden={!expanded}
      id={contentId}
    >
      {signals.length > 0 ? (
        <ul className="flex flex-col gap-1" aria-label="Applied factors">
          {signals.map((signal, index) => (
            <li
              data-testid="fit-applied-factor"
              key={`${signal.source}-${index}`}
            >
              <span className="font-medium text-[var(--ink-secondary)]">
                {signalLabel(signal)}:
              </span>{" "}
              {signalCopy[signal.source][signal.assessment]}
            </li>
          ))}
        </ul>
      ) : null}
      {unavailable.length > 0 ? (
        <ul
          aria-label="Unavailable comparisons"
          className="flex flex-col gap-1"
        >
          {unavailable.map((item) => (
            <li key={`${item.factor}-${item.reason}`}>
              {unavailableCopy[item.reason]}
            </li>
          ))}
        </ul>
      ) : null}
      {caveats.map((caveat) => (
        <p key={caveat}>{caveat}</p>
      ))}
    </div>
  );
}

export function VerdictBand({
  fields,
  assumptions,
  fit,
  bandCaptionId,
  isRefreshingEstimate,
}: {
  fields: ExploreFields;
  assumptions: ExploreAssumptions;
  fit: FitEstimate;
  /** The id of the once-per-screen band caption node (`ExploreResultsHeader`),
   * or null when no card on screen shows a band at all. */
  bandCaptionId: string | null;
  /** `ExplorePanel` replaces cached personalized details until a matching
   * response arrives after a Profile mutation or change event. */
  isRefreshingEstimate: boolean;
}) {
  const rate = formatPercent(fit.baseline_admit_rate);
  const category = fit.category;
  const categoryLabel = displayCategory(category);
  const basisLabel = estimateBasisLabel(fit);
  const appliedFactorLabels = fit.signals.slice(0, 2).map(signalLabel);
  const accessibleCaveat =
    fit.basis === "personalized"
      ? "Entering-class benchmarks are context, not admission cutoffs or personal odds."
      : "";
  const accessibleName = [
    `Fit: ${categoryLabel}.`,
    `Admit rate: ${rate ?? ABSENT_LABEL}.`,
    basisLabel + ".",
    appliedFactorLabels.length > 0
      ? `Applied factors: ${appliedFactorLabels.join(", ")}.`
      : "",
    accessibleCaveat,
  ]
    .filter(Boolean)
    .join(" ");
  const explanationId = useId();
  const [isExplanationOpen, setExplanationOpen] = useState(false);

  if (isRefreshingEstimate) {
    return (
      <div
        aria-label="Refreshing estimate"
        className="-mx-4 border-y px-4 py-3"
        data-slot="explore-fit-refresh"
        role="group"
      >
        <p className="text-sm text-[var(--ink-muted)]">Refreshing estimate…</p>
      </div>
    );
  }

  return (
    <div
      aria-label={accessibleName}
      className="-mx-4 border-y px-4 py-3"
      role="group"
    >
      <div className="flex items-center justify-between gap-3">
        {rate === null ? (
          <span className="min-w-0 truncate text-sm text-[var(--school-value-absent)]">
            Admit rate not available
          </span>
        ) : (
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="text-[1.625rem] leading-none font-medium tracking-[-0.02em] tabular-nums">
              {rate}
            </span>
            <span className="truncate text-xs text-[var(--ink-muted)]">
              admit rate
            </span>
          </span>
        )}
        <Badge className="shrink-0" variant="secondary">
          {categoryLabel}
        </Badge>
      </div>

      {fit.basis !== "missing_admit_rate" ? (
        <>
          <p
            className="mt-2 text-xs text-[var(--ink-secondary)]"
            data-slot="fit-basis"
          >
            {basisLabel}
          </p>
          <button
            aria-controls={explanationId}
            aria-expanded={isExplanationOpen}
            className="mt-1 inline-flex min-h-6 min-w-6 items-center rounded-sm text-xs font-medium text-[var(--ink-secondary)] underline decoration-[var(--edge-subtle)] underline-offset-2 outline-none hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            onClick={() => setExplanationOpen((open) => !open)}
            type="button"
          >
            How this estimate was made
          </button>
          <FitExplanation
            contentId={explanationId}
            expanded={isExplanationOpen}
            fit={fit}
          />
        </>
      ) : null}

      <EvidenceLine
        bandCaptionId={bandCaptionId}
        fields={fields}
        assumptions={assumptions}
      />
    </div>
  );
}
