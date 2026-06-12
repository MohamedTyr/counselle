/**
 * FE-4 — the activity timeline (PRD stories 13–16).
 *
 * LIVE (streaming / idle / awaiting_input): the expanded list — StepRow per
 * step (shimmer on the active one, receipts one tap deep) with thinking lines
 * interleaved as muted italics in arrival order.
 *
 * DONE (complete / cancelled / error): collapsed to the one-line receipt
 * (" · 3.4s" appended when known), expandable forever — persisted old turns
 * therefore render collapsed by default (PRD decision 5). The work never
 * disappears; it gets out of the way.
 */
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { TimelineEntry, TurnStatus } from '@/api/turn-reducer';
import { cn } from '~/utils';
import { formatDurationMs } from './stepMeta';
import StepRow from './StepRow';

type ActivityTimelineProps = {
  timeline: TimelineEntry[];
  status: TurnStatus;
  receipt?: string;
  durationMs?: number;
};

const LIVE_STATUSES: TurnStatus[] = ['streaming', 'idle', 'awaiting_input'];

function ExpandedList({ timeline }: { timeline: TimelineEntry[] }) {
  return (
    <div className="flex flex-col gap-1">
      {timeline.map((entry, i) =>
        entry.type === 'step' ? (
          <StepRow key={`step-${entry.step.step_id}`} step={entry.step} />
        ) : (
          <p key={`thinking-${i}`} className="px-1.5 text-sm italic text-text-secondary">
            {entry.text}
          </p>
        ),
      )}
    </div>
  );
}

export default function ActivityTimeline({
  timeline,
  status,
  receipt,
  durationMs,
}: ActivityTimelineProps) {
  const [open, setOpen] = useState(false);

  if (timeline.length === 0) {
    return null;
  }

  if (LIVE_STATUSES.includes(status)) {
    return (
      <div className="not-prose my-2">
        <ExpandedList timeline={timeline} />
      </div>
    );
  }

  const line =
    (receipt !== undefined && receipt.length > 0 ? receipt : 'Activity') +
    (durationMs !== undefined ? ` · ${formatDurationMs(durationMs)}` : '');

  return (
    <div className="not-prose my-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm text-text-secondary hover:bg-surface-hover"
      >
        <ChevronRight
          className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate">{line}</span>
      </button>
      {open && (
        <div className="mt-1">
          <ExpandedList timeline={timeline} />
        </div>
      )}
    </div>
  );
}
