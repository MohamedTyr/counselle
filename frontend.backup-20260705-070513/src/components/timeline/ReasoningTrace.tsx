/**
 * ReasoningTrace (feat/reasoning-experience) — the agent thinking-phase surface.
 *
 * Replaces ActivityTimeline + ThinkingShimmer with one collapsed-by-default
 * "chain of thought": a glowing orb + a current-activity shimmer (it cycles the
 * latest step label / thinking line with a min-dwell so nothing flashes by) +
 * a running timer, expanding to the rail — thinking narration lines and tool
 * steps (status + source chips) with a per-step connector line. When the turn
 * finishes it settles to "…· Ns", expandable forever (persisted old turns
 * render collapsed). The work never disappears; it gets out of the way.
 *
 * Built on @radix-ui/react-collapsible (the primitive the AI-Elements
 * Reasoning/ChainOfThought components themselves wrap) + lucide + counselle.css
 * — "use the component, not scratch", without fighting this repo's vendored
 * shadcn layout. Motion is compositor-friendly and reduced-motion-gated.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { useReducedMotion } from 'framer-motion';
import { Check, ChevronDown, X } from 'lucide-react';
import type { StepData, StepKind, StepSource } from '@/api/protocol';
import type { TimelineEntry, TurnStatus } from '@/api/turn-reducer';
import { cn } from '~/utils';
import StepSourceChip from './StepSourceChip';
import { formatDurationMs, iconFor } from './stepMeta';

type ReasoningTraceProps = {
  timeline: TimelineEntry[];
  status: TurnStatus;
  /** Ordered step labels for the collapsed header to cycle through (mockup
   *  setNow-per-step): each plays ≥MIN_DWELL, none skipped. */
  activities?: string[];
  durationMs?: number;
};

// `awaiting_input` (parked on a clarify) is NOT live: the agent finished its
// thinking and asked a question — the orb must settle and the timer stop, not
// keep glowing/ticking while the student reads. Matches ChatContext's isLive.
const LIVE_STATUSES: TurnStatus[] = ['streaming', 'idle'];
const MIN_DWELL_MS = 850;
const MAX_VISIBLE_CHIPS = 4;
// Dead-air cover: before the first real step/thinking line lands, the header
// cycles these (à la Claude) so the wait never sits on one static word.
const THINKING_WORDS = [
  'Thinking…',
  'Pondering…',
  'Mulling it over…',
  'Reasoning…',
  'Connecting ideas…',
  'Considering…',
  'Working through it…',
  'Digging in…',
  'Percolating…',
  'Synthesizing…',
];
const PLACEHOLDER_DWELL_MS = 1900;
const DEFAULT_ACTIVITY = THINKING_WORDS[0];
const EMPTY_ACTIVITIES: string[] = [];
// Live-timer cadence. Normally 100ms (a smooth sub-second clock); under reduced
// motion we tick coarsely (once/second) so a motion-sensitive user doesn't see
// the number churn — the duration stays correct, it just doesn't animate.
const TICK_MS = 100;
const TICK_MS_REDUCED = 1000;

function isLive(status: TurnStatus): boolean {
  return LIVE_STATUSES.includes(status);
}

// ── The cycling current-activity ticker (refs only — no stale-closure freeze) ──

function useActivityTicker(activities: string[], live: boolean): string {
  const [shown, setShown] = useState(DEFAULT_ACTIVITY);
  const reduceMotion = useReducedMotion();
  const queue = useRef<string[]>([]);
  const pumping = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // How many of `activities` we've already queued — every NEW label is played
  // in order, ≥MIN_DWELL each (the mockup's setNow-per-step), so a burst of fast
  // tools still surfaces one label at a time rather than skipping to the last.
  const enqueued = useRef(0);
  const mounted = useRef(true);

  const pump = useCallback(() => {
    if (!mounted.current || pumping.current || queue.current.length === 0) {
      return;
    }
    pumping.current = true;
    const next = queue.current.shift()!;
    setShown(next);
    timer.current = setTimeout(() => {
      pumping.current = false;
      pump();
    }, MIN_DWELL_MS);
  }, []);

  useEffect(() => {
    // Set true on (re)mount — NOT just false on unmount. React StrictMode (dev)
    // runs mount → cleanup → mount; a cleanup-only effect would leave
    // `mounted` stuck false after the simulated unmount, permanently disabling
    // `pump` (the activity line freezes on its first value). Reset it here.
    //
    // DECLARATION ORDER MATTERS: this effect must precede the activities/pump
    // effect below so that on a (re)mount it runs FIRST, restoring
    // `mounted.current = true` before `pump()` is called — otherwise the pump
    // runs while `mounted` is still false and skips the initial activity.
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!live) {
      // Done/parked: stop cycling and drop anything queued so the pump never
      // drains stale activity (or fires) after the turn finishes. Reset
      // `enqueued` too, so if this instance is ever reused for a later turn its
      // fresh activities aren't treated as already-played (latent-bug guard).
      queue.current = [];
      pumping.current = false;
      enqueued.current = 0;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      return;
    }
    if (activities.length > enqueued.current) {
      queue.current.push(...activities.slice(enqueued.current));
      enqueued.current = activities.length;
      pump();
    }
  }, [activities, live, pump]);

  // Dead-air rotation: while live with no real activity yet, cycle the playful
  // "thinking" words on an interval. A random start index varies the opener per
  // turn. As soon as real activities arrive (length > 0) this cleans up and the
  // pump above owns the line — it never reverts to a placeholder mid-turn.
  // Under reduced motion we hold one static word (no interval, no re-renders).
  // Dep is `activities.length` (not `activities`): the prop is a fresh array each
  // render; we only care about the empty→non-empty transition.
  useEffect(() => {
    if (!live || activities.length > 0) {
      return;
    }
    if (reduceMotion) {
      setShown(DEFAULT_ACTIVITY);
      return;
    }
    let i = Math.floor(Math.random() * THINKING_WORDS.length);
    setShown(THINKING_WORDS[i]);
    const id = setInterval(() => {
      i = (i + 1) % THINKING_WORDS.length;
      setShown(THINKING_WORDS[i]);
    }, PLACEHOLDER_DWELL_MS);
    return () => clearInterval(id);
  }, [live, activities.length, reduceMotion]);

  return shown;
}

// ── The live wall-clock (setInterval → state; isolated to the header) ──────────

// The live wall-clock. On every idle→live transition the timer RESTARTS from
// zero (a reused ReasoningTrace instance must not carry a previous turn's elapsed
// into the next — FE-H2): `start` is the moment we went live and we never read
// `elapsed` inside the effect, so the dep array is honest ([live, reduceMotion])
// and no lint suppression is needed (FE-L1). Under reduced motion the interval
// ticks coarsely (FE-M4) — the displayed number stops churning sub-second.
function useElapsed(live: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (!live) {
      return;
    }
    setElapsed(0);
    const start = performance.now();
    const period = reduceMotion ? TICK_MS_REDUCED : TICK_MS;
    const id = setInterval(() => setElapsed(performance.now() - start), period);
    return () => clearInterval(id);
  }, [live, reduceMotion]);
  return elapsed;
}

// ── Source chips (interactive — StepSourceChip owns link + hover preview) ──────

function SourceChips({
  sources,
  kind,
  query,
}: {
  sources: StepSource[];
  kind: StepKind;
  query?: string;
}) {
  // "+N more" is a real focusable <button> that reveals the hidden chips inline
  // (FE-M2). The old aria-labelled <span> was unreachable for keyboard/AT users —
  // sources 5+ couldn't be opened, and an aria-label on a static span reads as a
  // labelled element with no role. One-way expand is enough here.
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? sources : sources.slice(0, MAX_VISIBLE_CHIPS);
  const extra = sources.length - visible.length;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {visible.map((s, i) => (
        <StepSourceChip key={s.url ?? `${s.label}-${i}`} source={s} kind={kind} index={i} query={query} />
      ))}
      {extra > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-expanded={false}
          aria-label={`Show ${extra} more ${extra === 1 ? 'source' : 'sources'}`}
          className="rounded px-1 py-0.5 text-xs text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-xheavy"
        >
          +{extra} more
        </button>
      )}
    </div>
  );
}

// ── Step receipt (Tier 2) — external steps reveal what they searched ───────────

// Only SEARCH steps reveal a receipt: the query + result count. DB/sql/viz
// steps reveal NOTHING — internal field/table names never reach the student
// (the honesty line cuts the other way here: don't leak the schema).
const SEARCH_KINDS: StepKind[] = ['web_search', 'edu_search', 'reddit_search'];

function receiptText(step: StepData): string | null {
  if (!SEARCH_KINDS.includes(step.kind) || step.status !== 'end') {
    return null;
  }
  const detail = step.detail;
  if (detail == null) {
    return null;
  }
  const parts: string[] = [];
  if (detail.query !== undefined && detail.query !== '') {
    parts.push(`“${detail.query}”`);
  }
  if (typeof detail.result_count === 'number') {
    const noun = step.kind === 'reddit_search' ? 'thread' : 'result';
    parts.push(`${detail.result_count} ${noun}${detail.result_count === 1 ? '' : 's'}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

// ── Rail nodes ─────────────────────────────────────────────────────────────────

function StatusMark({ status }: { status: StepData['status'] }) {
  if (status === 'end') {
    return <Check className="size-3.5 shrink-0 text-text-secondary" aria-label="done" />;
  }
  if (status === 'error') {
    return <X className="size-3.5 shrink-0 text-red-500/80" aria-label="failed" />;
  }
  return (
    <span
      className="counselle-step-active inline-block size-3 shrink-0 rounded-full border-[1.6px] border-border-medium border-t-text-secondary"
      aria-label="working"
    />
  );
}

const StepNode = memo(function StepNode({ step }: { step: StepData }) {
  const Icon = iconFor(step.kind);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const receipt = receiptText(step);
  const receiptId = `receipt-${step.step_id}`;
  const labelClass = cn(
    'text-sm leading-normal',
    step.status === 'start' ? 'font-medium text-text-primary' : 'text-text-secondary',
  );
  return (
    <div className="counselle-tl-node counselle-node-in relative grid grid-cols-[22px_1fr] gap-3">
      <span className="grid h-[21px] place-items-center">
        {/* Monochrome by design: the current step's icon is near-white, finished
            ones recede to muted. Hue is reserved for meaning (source tiers in the
            chip previews, the red error mark) — never decorative on the rail. */}
        <Icon
          className={cn(
            'size-4',
            step.status === 'start' ? 'text-text-primary' : 'text-text-secondary',
          )}
          aria-hidden="true"
        />
      </span>
      <div className="min-w-0 pb-3.5">
        {receipt !== null ? (
          // A search step: the label toggles its receipt (the query it ran).
          <button
            type="button"
            onClick={() => setReceiptOpen((v) => !v)}
            aria-expanded={receiptOpen}
            // Only reference the receipt while it's mounted — a collapsed step
            // doesn't render the <p>, so a static aria-controls would dangle.
            aria-controls={receiptOpen ? receiptId : undefined}
            className="group inline-flex max-w-full items-center gap-2 rounded text-left align-middle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-xheavy"
          >
            <span className={cn(labelClass, 'truncate group-hover:text-text-primary')}>
              {step.label}
            </span>
            <StatusMark status={step.status} />
            <ChevronDown
              className={cn(
                'size-3 shrink-0 text-text-secondary opacity-0 transition-all group-hover:opacity-70',
                receiptOpen && 'rotate-180 opacity-70',
              )}
              aria-hidden="true"
            />
          </button>
        ) : (
          <span className="inline-flex items-center gap-2 align-middle">
            <span className={labelClass}>{step.label}</span>
            <StatusMark status={step.status} />
          </span>
        )}
        {receipt !== null && receiptOpen && (
          <p id={receiptId} className="counselle-receipt-in mt-1 text-xs text-text-secondary">
            {receipt}
          </p>
        )}
        {step.sources !== undefined && step.sources.length > 0 && (
          <SourceChips sources={step.sources} kind={step.kind} query={step.detail?.query} />
        )}
      </div>
    </div>
  );
});

function ThinkNode({ text }: { text: string }) {
  return (
    <div className="counselle-tl-node counselle-node-in relative grid grid-cols-[22px_1fr] gap-3 pb-3.5">
      <span className="mt-1.5 size-1.5 justify-self-center rounded-full bg-border-medium" aria-hidden="true" />
      <p className="min-w-0 text-[13.5px] italic leading-normal text-text-secondary">{text}</p>
    </div>
  );
}

// ── Header ─────────────────────────────────────────────────────────────────────

function TraceHeader({
  status,
  activities,
  durationMs,
  open,
}: {
  status: TurnStatus;
  activities?: string[];
  durationMs?: number;
  open: boolean;
}) {
  const live = isLive(status);
  // Collapsed + live is the only state that cycles the activity with the
  // shimmer + slide (mockup `renderHead`): expanded shows a static "Working",
  // done shows "Thought for Ns".
  const collapsedLive = live && !open;
  const shown = useActivityTicker(activities ?? EMPTY_ACTIVITIES, live);
  const elapsed = useElapsed(live);

  // WALL-CLOCK, not summed tool-time. A turn that ran live this session has
  // `elapsed` frozen at completion (true duration, incl. model time); prefer it.
  // Only a reloaded turn (never live → elapsed 0) falls back to `durationMs`.
  const dur = formatDurationMs(elapsed > 0 ? elapsed : (durationMs ?? 0));
  const doneText = `Thought for ${dur}`;
  const label = !live ? doneText : open ? 'Working' : shown;
  const ariaLabel = live ? 'Agent thinking — expand to see the steps' : `${doneText} — expand`;

  return (
    <Collapsible.Trigger
      aria-label={ariaLabel}
      className="flex w-full items-center gap-2 rounded-md px-0.5 py-1 text-left text-text-secondary transition-colors hover:text-text-primary"
    >
      {/* The leading chevron is the expand affordance — a lucide chevron-right
          shape masked over the SAME animated gradient as the activity text, so
          it shimmers in lockstep while live+collapsed and rotates 90° (transform
          only, no colour change) when the trace opens. */}
      <span
        aria-hidden="true"
        className={cn('counselle-trace-caret', open && 'is-open', collapsedLive && 'is-live')}
      />
      <span className="min-w-0 flex-1 overflow-hidden">
        {/* Transform wrapper (slide), re-keyed per activity so it reruns; the
            inner span carries the background-clip shimmer (the two never fight). */}
        <span key={collapsedLive ? shown : 'static'} className={cn('block', collapsedLive && 'counselle-now-in')}>
          <span
            className={cn(
              'block truncate text-[13px] font-normal tracking-[0.005em] text-text-secondary',
              collapsedLive && 'counselle-shimmer-text',
            )}
          >
            {label}
          </span>
        </span>
      </span>
      {live && (
        <span className="shrink-0 text-[13px] tabular-nums text-text-secondary">
          {formatDurationMs(elapsed)}
        </span>
      )}
    </Collapsible.Trigger>
  );
}

// ── The component ──────────────────────────────────────────────────────────────

export default function ReasoningTrace({
  timeline,
  status,
  activities,
  durationMs,
}: ReasoningTraceProps) {
  const [open, setOpen] = useState(false);

  // Live with no entries yet = the dead-air "Thinking…" header. Done with no
  // entries = nothing to show (a pure-prose answer used no tools).
  if (timeline.length === 0 && !isLive(status)) {
    return null;
  }

  return (
    <div className="not-prose my-2">
      <Collapsible.Root open={open} onOpenChange={setOpen}>
        <TraceHeader
          status={status}
          activities={activities}
          durationMs={durationMs}
          open={open}
        />
        <Collapsible.Content className="mt-2.5">
          <div className="flex flex-col pl-0.5">
            {timeline.map((entry) =>
              entry.type === 'step' ? (
                <StepNode key={`step-${entry.step.step_id}`} step={entry.step} />
              ) : (
                // Keyed on the reducer-assigned stable id (FE-H3), never the array
                // index: with steps and thinking interleaved in arrival order, an
                // index key would re-map to different text as entries merge/arrive.
                <ThinkNode key={entry.id} text={entry.text} />
              ),
            )}
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  );
}
