import { AlertTriangle } from "lucide-react";

import { coverageLine } from "@/features/schools/facts/school-facts-format";
import type { EditionBannerVariant } from "@/features/schools/facts/school-facts-format";
import type {
  DomainCoverage,
  SchoolEdition,
} from "@/features/schools/facts/school-facts-types";

/*
 * The coverage line is a contract, not a decoration (DATABASE_GUIDE.md:226).
 *
 *   M is the count of configured metrics in the CURRENT manifest, supplied
 *   by the server. Never Object.keys(facts).length, never computed here.
 *   K — the not_in_template_version count — is stated separately, because a
 *   row that does not exist in this school's form edition is a fact about
 *   the form, not a gap in our data.
 *   The word "missing" never appears.
 */
export function SectionHeader({
  coverage,
  edition,
  id,
  title,
}: {
  coverage: DomainCoverage | undefined;
  edition: SchoolEdition | null;
  id: string;
  title: string;
}) {
  const line = coverageLine(coverage, edition);
  return (
    <div className="flex flex-col gap-1 border-b border-[var(--hairline)] pb-4">
      <h2 className="text-lg font-medium text-[var(--ink)]" id={id}>
        {title}
      </h2>
      {line ? (
        <p className="text-xs tabular-nums text-[var(--ink-muted)]">{line}</p>
      ) : null}
    </div>
  );
}

/**
 * Sits between the coverage line and the first group — never inside a
 * collapsed group, for the same reason a severe caveat is never a tooltip.
 */
export function EditionBanner({
  edition,
  schoolName,
  variant,
}: {
  edition: SchoolEdition;
  schoolName: string;
  variant: EditionBannerVariant;
}) {
  const copy = bannerCopy(variant, edition, schoolName);
  return (
    /* --warning-surface, no border. Elevation is fill first; a tinted well
     * with a rim around it reads as a component rather than as a note. */
    <div className="flex items-start gap-2 rounded-md bg-[var(--warning-surface)] p-3">
      <AlertTriangle
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-[var(--warning-fg)]"
      />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-[var(--warning-fg)]">
          {copy.title}
        </p>
        <p className="text-xs leading-5 text-[var(--ink-secondary)]">
          {copy.body}
        </p>
      </div>
    </div>
  );
}

function bannerCopy(
  variant: EditionBannerVariant,
  edition: SchoolEdition,
  schoolName: string,
): { title: string; body: string } {
  const year = `${edition.academicYear - 1}–${String(edition.academicYear).slice(-2)}`;
  if (variant === "stale") {
    return {
      title: "Older edition",
      body: `These figures come from the ${year} Common Data Set. ${schoolName} has not published a newer one we can read.`,
    };
  }
  if (variant === "partial") {
    /* Section-scoped, so it says what is true of this section. The page-wide
     * count lives in the edition's own flags and is not a student's
     * question. */
    return {
      title: "Partial extraction",
      body: "This section came through incomplete. Values we could not verify are marked below.",
    };
  }
  return {
    title: "Definition changed",
    body: "This edition was read under an older metric definition. Its values are not directly comparable to a current-edition school.",
  };
}
