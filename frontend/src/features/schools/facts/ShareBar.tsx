import { GroupCaveat } from "@/features/schools/facts/CaveatLine";
import { factStateCopy } from "@/features/schools/facts/school-facts-format";
import type { DegreeShare } from "@/features/schools/facts/school-facts-types";
import { cn } from "@/lib/utils";

/*
 * Degree shares — the ONE place a bar is legal on this page.
 *
 * Share of degrees conferred is ordered data, so DESIGN rule 5 permits one
 * hue at several intensities. Nothing else here gets a bar, a sparkline or a
 * chart: there is no charting library, and "viz" in this app means typed
 * tabular render specs. Test bands in particular render as three tabular
 * cells (p25 / p50 / p75) and never as a range strip — a strip invites the
 * eye to read a distribution we do not have.
 */

const SHARE_CAVEAT =
  "Share of degrees conferred in one year — not program quality, not admission difficulty, and not a course catalogue. A blank row does not mean the major isn't offered.";

/** Three ordered steps of the brand hue: top third, middle, bottom. */
function fillToken(percent: number, max: number): string {
  const ratio = max > 0 ? percent / max : 0;
  if (ratio >= 2 / 3) return "var(--brand-scale-3)";
  if (ratio >= 1 / 3) return "var(--brand-scale-2)";
  return "var(--brand-scale-1)";
}

export function ShareBarList({ shares }: { shares: readonly DegreeShare[] }) {
  /*
   * Reported rows descending by value; absent rows last, alphabetically.
   * Sorting absent rows into the numeric order would require inventing a
   * position for them, and the position would read as a value.
   */
  const reported = shares
    .filter((share) => share.percent !== null)
    .sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
  const absent = shares
    .filter((share) => share.percent === null)
    .sort((a, b) => a.label.localeCompare(b.label));
  const max = reported[0]?.percent ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <GroupCaveat text={SHARE_CAVEAT} />
      <dl className="flex flex-col gap-2.5">
        {[...reported, ...absent].map((share) => (
          <ShareRow key={share.ref} max={max} share={share} />
        ))}
      </dl>
    </div>
  );
}

function ShareRow({ max, share }: { max: number; share: DegreeShare }) {
  const percent = share.percent;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_64px_88px] items-center gap-3">
      <dt className="truncate text-sm text-[var(--school-fact-label)]">
        {share.label}
      </dt>
      <dd
        className={cn(
          "text-right text-xs tabular-nums",
          percent === null
            ? "italic text-[var(--school-fact-absent)]"
            : "text-[var(--school-fact-value)]",
        )}
      >
        {/* A 0% row renders its zero as a fact, at value weight, with a
         * bar of zero width. Zero is not absence. */}
        {factStateCopy(share.state)}
      </dd>
      <dd>
        {percent === null ? (
          /* No bar at all rather than an empty track: an empty track is a
           * drawn zero, and we are not claiming zero. */
          <span className="sr-only">no bar, value not reported</span>
        ) : (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--control-track)]">
            <div
              className="h-full rounded-full"
              style={{
                backgroundColor: fillToken(percent, max),
                width: `${max > 0 ? (percent / max) * 100 : 0}%`,
              }}
            />
          </div>
        )}
      </dd>
    </div>
  );
}
