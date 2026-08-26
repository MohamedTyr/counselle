import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Badge } from "@/components/ui/badge";
import type {
  DerivedFact,
  Evidence,
  SchoolEdition,
} from "@/features/schools/facts/school-facts-types";
import { academicYearLabel } from "@/features/schools/facts/school-facts-format";
import { cn } from "@/lib/utils";

/*
 * The page's one evidence language.
 *
 * Label, tabular value, "Page N · Section · Row · Column", italic excerpt —
 * the same grammar the sources rail speaks (DESIGN §15.4), because a student
 * who learns to read a citation in chat should not have to learn a second
 * dialect here.
 *
 * The chip is a real <button>, not a <span> with a hover handler. Evidence
 * that only a mouse can reach is evidence a keyboard user does not have.
 */

const chipClassName = cn(
  "inline-flex h-5 shrink-0 items-center rounded-md px-1.5",
  "text-xs tabular-nums whitespace-nowrap text-[var(--school-fact-evidence-ink)]",
  "cursor-pointer transition-colors duration-150 outline-none",
  "hover:bg-[var(--school-fact-evidence-hover)]",
  "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
  /* Bespoke clickable, so it opts into the 44px coarse target itself —
   * buttonVariants would have done this for us and this is not a Button. */
  "pointer-coarse:relative pointer-coarse:after:absolute pointer-coarse:after:size-full",
  "pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11",
  "pointer-coarse:after:top-1/2 pointer-coarse:after:left-1/2",
  "pointer-coarse:after:-translate-x-1/2 pointer-coarse:after:-translate-y-1/2",
);

/* Elevation-2 has a 12px blur and belongs on a BORDERLESS surface. Pairing a
 * wide soft shadow with a 1px ring is the glassy look DESIGN §4 bans, which
 * is why this overrides the primitive's default ring. */
const cardClassName = cn(
  "w-[22rem] rounded-xl border-0 bg-[var(--surface-overlay)] p-0 ring-0",
  "shadow-[var(--elevation-2)]",
);

function citationPath(evidence: Evidence): string {
  return [
    `Page ${evidence.pageNumber}`,
    evidence.section ? `Section ${evidence.section}` : null,
    evidence.row ? `Row ${evidence.row}` : null,
    evidence.column ? `Column ${evidence.column}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Strips the scheme so the card shows a readable path, not a raw URL. */
function readablePath(url: string | null): string | null {
  if (!url) return null;
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function chipLabel(evidence: Evidence): string {
  /* Absence proof is not a value citation and must not look like one. */
  if (evidence.isAbsenceProof) return `p.${evidence.pageNumber} — proof`;
  return evidence.section
    ? `p.${evidence.pageNumber} · ${evidence.section}`
    : `p.${evidence.pageNumber}`;
}

function CardHeaderRow({ edition }: { edition: SchoolEdition | null }) {
  return (
    <div className="flex items-start justify-between gap-2 px-3 pt-3">
      <p className="text-xs font-medium text-[var(--ink)]">
        {edition
          ? `Common Data Set ${academicYearLabel(edition.academicYear)}`
          : "Common Data Set"}
      </p>
      <Badge variant="outline">Official</Badge>
    </div>
  );
}

export function EvidenceChip({
  edition,
  evidence,
  label,
}: {
  edition: SchoolEdition | null;
  evidence: Evidence;
  label: string;
}) {
  const yearLabel = edition
    ? `the ${academicYearLabel(edition.academicYear)} Common Data Set`
    : "the Common Data Set";
  const path = readablePath(edition?.documentUrl ?? null);

  return (
    <HoverCard closeDelay={80} openDelay={200}>
      <HoverCardTrigger
        aria-label={
          evidence.isAbsenceProof
            ? `Proof that ${label} is absent from ${yearLabel}: page ${evidence.pageNumber}`
            : `Evidence for ${label}: page ${evidence.pageNumber} of ${yearLabel}`
        }
        className={chipClassName}
        type="button"
      >
        {chipLabel(evidence)}
      </HoverCardTrigger>
      <HoverCardContent align="end" className={cardClassName}>
        <CardHeaderRow edition={edition} />
        <p className="px-3 pt-1 text-xs tabular-nums text-[var(--ink-muted)]">
          {citationPath(evidence)}
        </p>
        <div className="px-3 pt-2">
          <p className="rounded-md bg-[var(--school-fact-well)] p-2.5 text-xs leading-5 italic text-[var(--ink-secondary)]">
            {/* For an absence proof this excerpt is the surrounding header
             * or table fragment showing the row does not exist — not a
             * value. A blank cell or failed OCR is never proof. */}
            {evidence.excerpt}
          </p>
        </div>
        {path ? (
          <p className="truncate px-3 pt-2 pb-3 text-xs text-[var(--ink-muted)]">
            {path}
          </p>
        ) : (
          <div className="pb-3" />
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * The derived variant shows the arithmetic instead of one excerpt, then
 * offers a chip per input so each half of the sum can be traced back to its
 * own page. A calculated number that cannot be taken apart is a number the
 * student has to take on faith.
 */
export function DerivedEvidenceChip({
  derived,
  edition,
}: {
  derived: DerivedFact;
  edition: SchoolEdition | null;
}) {
  const traceable = derived.inputs.filter((input) => input.evidence);

  return (
    <HoverCard closeDelay={80} openDelay={200}>
      <HoverCardTrigger
        aria-label={`How ${derived.label} is calculated`}
        className={chipClassName}
        type="button"
      >
        calculated
      </HoverCardTrigger>
      <HoverCardContent align="end" className={cardClassName}>
        <div className="px-3 pt-3">
          <p className="text-xs font-medium text-[var(--ink)]">Calculated</p>
          <p className="pt-1 text-xs tabular-nums text-[var(--ink-secondary)]">
            {derived.formula}
          </p>
        </div>
        <p className="px-3 pt-2 text-xs text-[var(--ink-muted)]">
          {edition
            ? `From the ${academicYearLabel(edition.academicYear)} Common Data Set.`
            : "From the Common Data Set."}
        </p>
        {traceable.length > 0 ? (
          <div className="flex flex-wrap gap-1 px-3 pt-2 pb-3">
            {traceable.map((input) => (
              <span
                className="rounded-md bg-[var(--school-fact-well)] px-1.5 py-0.5 text-xs tabular-nums text-[var(--ink-secondary)]"
                key={input.ref}
              >
                p.{input.evidence!.pageNumber} {input.label}
              </span>
            ))}
          </div>
        ) : (
          <div className="pb-3" />
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
