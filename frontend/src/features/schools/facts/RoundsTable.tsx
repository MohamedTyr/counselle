import { Badge } from "@/components/ui/badge";
import {
  factStateCopy,
  isReported,
  ROUND_NOT_OFFERED_COPY,
} from "@/features/schools/facts/school-facts-format";
import type {
  Caveat,
  FactState,
  LaneRow,
  RoundRow,
  SchoolEdition,
} from "@/features/schools/facts/school-facts-types";
import { ProvenanceLanes } from "@/features/schools/facts/ProvenanceLanes";
import { cn } from "@/lib/utils";

/*
 * The Applying section's headline.
 *
 * A round the school does not offer says "not offered". A round whose
 * offered-flag we could not read says "not reported". Those are different
 * claims and the table must never collapse them — a student who reads
 * "not offered" stops looking, and being wrong about that costs them a
 * round.
 */

function offeredCopy(offered: RoundRow["offered"]): string {
  if (offered === "no") return ROUND_NOT_OFFERED_COPY;
  return "not reported";
}

function valueClassName(state: FactState): string {
  return isReported(state)
    ? "text-sm font-medium tabular-nums text-[var(--school-fact-value)]"
    : "text-sm italic text-[var(--school-fact-absent)]";
}

export function RoundsTable({
  caveats,
  edition,
  rounds,
}: {
  caveats: Record<string, Caveat>;
  edition: SchoolEdition | null;
  rounds: readonly RoundRow[];
}) {
  return (
    <dl className="divide-y divide-[var(--school-fact-divider)]">
      {rounds.map((round) => (
        <RoundEntry
          caveats={caveats}
          edition={edition}
          key={round.code}
          round={round}
        />
      ))}
    </dl>
  );
}

function RoundEntry({
  caveats,
  edition,
  round,
}: {
  caveats: Record<string, Caveat>;
  edition: SchoolEdition | null;
  round: RoundRow;
}) {
  if (round.offered !== "yes") {
    return (
      <div className="flex items-center justify-between gap-3 py-2.5">
        <dt className="flex items-center gap-2">
          <Badge variant="secondary">{round.code}</Badge>
        </dt>
        <dd className="text-sm italic text-[var(--school-fact-absent)]">
          {offeredCopy(round.offered)}
        </dd>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{round.code}</Badge>
        {round.restrictive ? (
          <Badge variant="warning">Restrictive</Badge>
        ) : null}
        {round.restrictive ? (
          <span className="text-xs text-[var(--ink-secondary)]">
            Applying here restrictively blocks other early applications.
          </span>
        ) : null}
      </div>
      <ProvenanceLanes
        caveats={caveats}
        edition={edition}
        row={round.deadline}
      />
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-sm text-[var(--school-fact-label)]">
          Decision notification
        </dt>
        <dd className={cn(valueClassName(round.notification))}>
          {factStateCopy(round.notification)}
        </dd>
      </div>
    </div>
  );
}

/**
 * Application fee, testing policy, reply deadline, deposit — the mixed-lane
 * rows that sit under the rounds.
 */
export function ApplyingLanes({
  caveats,
  edition,
  rows,
}: {
  caveats: Record<string, Caveat>;
  edition: SchoolEdition | null;
  rows: readonly LaneRow[];
}) {
  return (
    <dl className="divide-y divide-[var(--school-fact-divider)]">
      {rows.map((row) => (
        <ProvenanceLanes
          caveats={caveats}
          edition={edition}
          key={row.id}
          row={row}
        />
      ))}
    </dl>
  );
}
