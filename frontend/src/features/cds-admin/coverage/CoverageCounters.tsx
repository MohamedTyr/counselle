import type { CoverageCounters as CoverageCountersData } from "@/api/cds-admin/types";
import { cn } from "@/lib/utils";

/** `schools`/`editions` are real counted nouns and need to agree with the
 * number ("1 school", not "1 schools") — a search narrowed to one result is
 * an everyday state on this screen, not an edge case. The other three
 * segments (`needs review`, `failed`, `missing`) are status labels, not
 * nouns, so they never pluralize. */
function pluralize(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}

/** A plain, inert count — `schools` and `editions` are never interactive
 * (DESIGN.md §3.7), and a zero attention count renders the same way: a
 * clickable "0 failed" would be a small lie about there being something
 * there. */
function CounterSegment({ label, value }: { label: string; value: number }) {
  return (
    <span>
      <span className="font-medium text-foreground tabular-nums">
        {value}
      </span>{" "}
      {label}
    </span>
  );
}

/** A non-zero attention count doubles as its own filter toggle. */
function CounterFilterSegment({
  active,
  label,
  onToggle,
  value,
}: {
  active: boolean;
  label: string;
  onToggle: () => void;
  value: number;
}) {
  if (value === 0) {
    return <CounterSegment label={label} value={value} />;
  }

  return (
    <button
      aria-pressed={active}
      className={cn(
        "-mx-1 rounded-sm px-1 outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        active && "bg-accent text-foreground",
      )}
      onClick={onToggle}
      type="button"
    >
      <span className="font-medium text-foreground tabular-nums">
        {value}
      </span>{" "}
      {label}
    </button>
  );
}

function Dot() {
  return (
    <span aria-hidden="true" className="text-muted-foreground/60">
      ·
    </span>
  );
}

/** The counters line, DESIGN.md §3.7 — one sentence, `aria-live="polite"`,
 * doubling as the primary filter for the two attention statuses (amber
 * `needs_review`, red `failed`) per the colour law. `missing` stays inert:
 * absence is neutral/grey (law 1), not an attention colour. */
export function CoverageCounters({
  className,
  counters,
  failedActive,
  needsReviewActive,
  onToggleFailed,
  onToggleNeedsReview,
}: {
  className?: string;
  counters: CoverageCountersData;
  failedActive: boolean;
  needsReviewActive: boolean;
  onToggleFailed: () => void;
  onToggleNeedsReview: () => void;
}) {
  return (
    <p
      aria-live="polite"
      className={cn(
        "flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground",
        className,
      )}
    >
      <CounterSegment
        label={pluralize(counters.schools, "school")}
        value={counters.schools}
      />
      <Dot />
      <CounterSegment
        label={pluralize(counters.editions, "edition")}
        value={counters.editions}
      />
      <Dot />
      <CounterFilterSegment
        active={needsReviewActive}
        label="needs review"
        onToggle={onToggleNeedsReview}
        value={counters.needs_review}
      />
      <Dot />
      <CounterFilterSegment
        active={failedActive}
        label="failed"
        onToggle={onToggleFailed}
        value={counters.failed}
      />
      <Dot />
      <CounterSegment label="missing" value={counters.missing} />
    </p>
  );
}
