import { ChevronDownIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { StepData } from "@/api/chat/types";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

import { safeExternalUrl } from "../citations";
import type { TimelineEntry, TurnStatus } from "../turn-reducer";
import {
  dedupeStepSources,
  formatDurationMs,
  isLiveStatus,
  MAX_VISIBLE_SOURCE_CHIPS,
  receiptText,
} from "./activity-trace-helpers";

export type ActivityTraceProps = {
  timeline: TimelineEntry[];
  status: TurnStatus;
  /** Ordered activity labels for the collapsed header to cycle through. */
  activities?: string[];
  durationMs?: number;
};

const MIN_DWELL_MS = 850;
const PLACEHOLDER_DWELL_MS = 1900;
const THINKING_WORDS = [
  "Thinking…",
  "Reasoning…",
  "Connecting ideas…",
  "Considering…",
  "Working through it…",
];
const TICK_MS = 250;

/** Cycles the header's current-activity label: every new label from
 *  `activities` plays for at least `MIN_DWELL_MS`, in order — a burst of
 *  fast steps still surfaces one label at a time rather than skipping to the
 *  last. Before any real activity arrives, it rotates a "thinking" word so
 *  the wait never sits on one static placeholder. */
function useActivityTicker(activities: string[], live: boolean): string {
  const [shown, setShown] = useState(THINKING_WORDS[0]);
  const queueRef = useRef<string[]>([]);
  const pumpingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enqueuedRef = useRef(0);

  // A ref (not a directly-recursive useCallback) so the timeout can always
  // invoke the latest pump without the closure needing to reference its own
  // not-yet-declared binding.
  const pumpRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    pumpRef.current = () => {
      if (pumpingRef.current || queueRef.current.length === 0) {
        return;
      }

      pumpingRef.current = true;
      const next = queueRef.current.shift();
      if (next !== undefined) {
        setShown(next);
      }

      timerRef.current = setTimeout(() => {
        pumpingRef.current = false;
        pumpRef.current();
      }, MIN_DWELL_MS);
    };
  }, []);

  useEffect(() => {
    if (!live) {
      queueRef.current = [];
      pumpingRef.current = false;
      enqueuedRef.current = 0;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    if (activities.length > enqueuedRef.current) {
      queueRef.current.push(...activities.slice(enqueuedRef.current));
      enqueuedRef.current = activities.length;
      pumpRef.current();
    }
  }, [activities, live]);

  useEffect(() => {
    if (!live || activities.length > 0) {
      return undefined;
    }

    // The initial state is already THINKING_WORDS[0], so the first tick only
    // needs to advance the rotation — no synchronous setState on mount.
    let index = 0;
    const id = setInterval(() => {
      index = (index + 1) % THINKING_WORDS.length;
      setShown(THINKING_WORDS[index]);
    }, PLACEHOLDER_DWELL_MS);

    return () => clearInterval(id);
  }, [live, activities.length]);

  return shown;
}

/** The live wall-clock: restarts from zero on every idle→live transition so
 *  a reused trace never carries a previous turn's elapsed into the next. */
function useElapsed(live: boolean): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!live) {
      return undefined;
    }

    // Every idle→live transition restarts the clock from the moment this
    // effect runs, not a synchronous setElapsed(0) — the first interval tick
    // (TICK_MS later) reports the true elapsed-since-live, which is 0 for a
    // fresh mount anyway.
    const start = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - start), TICK_MS);
    return () => clearInterval(id);
  }, [live]);

  return elapsed;
}

function SourceChips({ step }: { step: StepData }) {
  const sources = dedupeStepSources(step.sources);
  const [expanded, setExpanded] = useState(false);

  if (sources.length === 0) {
    return null;
  }

  const visible = expanded ? sources : sources.slice(0, MAX_VISIBLE_SOURCE_CHIPS);
  const extra = sources.length - visible.length;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {visible.map((source, index) => {
        const href = safeExternalUrl(source.url);
        const className =
          "rounded-md border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground";

        return href === undefined ? (
          <span className={className} key={source.url ?? `${source.label}-${index}`}>
            {source.label}
          </span>
        ) : (
          <a
            className={cn(className, "hover:text-foreground")}
            href={href}
            key={source.url ?? `${source.label}-${index}`}
            rel="noreferrer"
            target="_blank"
          >
            {source.label}
          </a>
        );
      })}
      {extra > 0 && (
        <button
          aria-label={`Show ${extra} more ${extra === 1 ? "source" : "sources"}`}
          className="rounded px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded(true)}
          type="button"
        >
          +{extra} more
        </button>
      )}
    </div>
  );
}

function StepRow({ step }: { step: StepData }) {
  const receipt = receiptText(step);
  const labelClass = cn(
    "text-sm leading-normal",
    step.status === "start" ? "font-medium text-foreground" : "text-muted-foreground",
  );

  return (
    <div className="grid grid-cols-[16px_1fr] gap-3 pb-3.5">
      <span
        aria-hidden="true"
        className={cn(
          "mt-1 size-2.5 justify-self-center rounded-full border",
          step.status === "end" && "border-transparent bg-muted-foreground",
          step.status === "error" && "border-transparent bg-destructive",
          step.status === "start" && "border-foreground",
        )}
      />
      <div className="min-w-0">
        <span className={labelClass}>{step.label}</span>
        {receipt !== null && (
          <p className="mt-0.5 text-xs text-muted-foreground">{receipt}</p>
        )}
        <SourceChips step={step} />
      </div>
    </div>
  );
}

function ThinkRow({ text }: { text: string }) {
  return (
    <div className="grid grid-cols-[16px_1fr] gap-3 pb-3.5">
      <span
        aria-hidden="true"
        className="mt-1.5 size-1.5 justify-self-center rounded-full bg-muted-foreground"
      />
      <p className="min-w-0 text-[13.5px] text-muted-foreground italic">{text}</p>
    </div>
  );
}

/**
 * ActivityTrace — the agent thinking/step timeline (ported from the old
 * app's ReasoningTrace). Collapsed by default: a live turn's header cycles
 * the current activity label with a running timer; a settled turn shows
 * "Thought for Ns", expandable forever. Expanding reveals thinking lines and
 * step rows in stream order (steps arrive already merged by `step_id` — see
 * `turn-reducer`'s `mergeStep`). Search steps may show a query/result-count
 * receipt; every other step kind never does, so DB/sql/viz internals stay
 * hidden. Step source chips are capped and deduped (see
 * `activity-trace-helpers`).
 */
export function ActivityTrace({ timeline, status, activities, durationMs }: ActivityTraceProps) {
  const [open, setOpen] = useState(false);
  const live = isLiveStatus(status);
  // Hooks run unconditionally (Rules of Hooks) — the empty-and-settled
  // early-out below only affects what gets rendered, never which hooks run.
  const collapsedLive = live && !open;
  const shown = useActivityTicker(activities ?? [], live);
  const elapsed = useElapsed(live);

  if (timeline.length === 0 && !live) {
    return null;
  }

  const durationLabel = formatDurationMs(elapsed > 0 ? elapsed : (durationMs ?? 0));
  const doneText = `Thought for ${durationLabel}`;
  const headerLabel = !live ? doneText : open ? "Working" : shown;

  return (
    <div className="not-prose my-2">
      <Collapsible onOpenChange={setOpen} open={open}>
        <CollapsibleTrigger
          className="flex w-full items-center gap-2 rounded-md py-1 text-left text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDownIcon
            aria-hidden="true"
            className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-180")}
          />
          <span className="min-w-0 flex-1 truncate text-[13px]">{headerLabel}</span>
          {live && (
            <span className="shrink-0 text-[13px] tabular-nums">
              {formatDurationMs(elapsed)}
            </span>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2.5">
          <div className="flex flex-col pl-0.5" data-collapsed-live={collapsedLive}>
            {timeline.map((entry) =>
              entry.type === "step" ? (
                <StepRow key={`step-${entry.step.step_id}`} step={entry.step} />
              ) : (
                <ThinkRow key={entry.id} text={entry.text} />
              ),
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
