import { Badge } from "@/components/ui/badge";
import { CaveatList } from "@/features/schools/facts/CaveatLine";
import { EvidenceChip } from "@/features/schools/facts/EvidenceChip";
import {
  factStateCopy,
  isReported,
  resolveCaveats,
} from "@/features/schools/facts/school-facts-format";
import type {
  Caveat,
  FactState,
  LaneRow,
  SchoolEdition,
} from "@/features/schools/facts/school-facts-types";
import { cn } from "@/lib/utils";

/*
 * Where our own web-verified data and the CDS both speak — deadlines, fees,
 * testing policy — and where they are allowed to disagree.
 *
 * Both lanes always render, including when they agree. Collapsing to one
 * hides which source we actually have, and "the CDS says the same thing" is
 * itself information: a current-cycle deadline confirmed by a historical
 * form is a stronger claim than the same date from one source alone.
 */

function laneValueClassName(state: FactState): string {
  return isReported(state)
    ? "text-sm font-medium tabular-nums text-[var(--school-fact-value)]"
    : "text-sm italic text-[var(--school-fact-absent)]";
}

export function ProvenanceLanes({
  caveats,
  edition,
  row,
}: {
  caveats: Record<string, Caveat>;
  edition: SchoolEdition | null;
  row: LaneRow;
}) {
  const resolved = resolveCaveats(row.caveatRefs, caveats);
  const disagrees =
    row.disagrees &&
    Boolean(row.official && row.cds) &&
    isReported(row.official!.state) &&
    isReported(row.cds!.state);

  return (
    <div className="flex flex-col gap-2 py-2.5">
      <dt className="text-sm text-[var(--school-fact-label)]">{row.label}</dt>
      <dd>
        {/* Inset well, no border. */}
        <div className="flex flex-col gap-1.5 rounded-md bg-[var(--school-fact-well)] p-3">
          {row.official ? (
            <Lane
              provenance={
                <>
                  {row.official.source} · verified {row.official.verifiedAt}
                </>
              }
              tag="Official"
              value={row.official.state}
            />
          ) : null}
          {row.cds ? (
            <Lane
              provenance={
                row.cds.evidence ? (
                  <EvidenceChip
                    edition={edition}
                    evidence={row.cds.evidence}
                    label={`${row.label}, Common Data Set`}
                  />
                ) : null
              }
              tag="CDS"
              value={row.cds.state}
            />
          ) : null}
        </div>
        {disagrees ? (
          /*
           * No alarm styling. A current page differing from a historical
           * form is expected, not an error — dressing it in amber would
           * spend the page's one warning hue on the ordinary case and leave
           * the sub-50% test band with nothing louder to say.
           */
          <p className="mt-1.5 text-xs leading-5 text-[var(--ink-muted)]">
            The CDS figure is from the{" "}
            {edition ? edition.academicYear - 1 : "published"}–
            {edition ? String(edition.academicYear).slice(-2) : ""} edition and
            may predate this cycle.
          </p>
        ) : null}
        <CaveatList caveats={resolved} />
      </dd>
    </div>
  );
}

function Lane({
  provenance,
  tag,
  value,
}: {
  provenance: React.ReactNode;
  tag: string;
  value: FactState;
}) {
  return (
    <div className="flex items-center gap-3">
      {/* Fixed column so the two tags align and the eye can read down them. */}
      <span className="flex w-16 shrink-0">
        <Badge variant="outline">{tag}</Badge>
      </span>
      <span className={cn("min-w-0 flex-1", laneValueClassName(value))}>
        {factStateCopy(value)}
      </span>
      {provenance ? (
        <span className="shrink-0 text-xs text-[var(--ink-muted)]">
          {provenance}
        </span>
      ) : null}
    </div>
  );
}
