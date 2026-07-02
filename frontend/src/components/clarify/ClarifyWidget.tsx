/**
 * FE-4 — the clarifying-question widget (PRD stories 23–25; MVP1 semantics
 * ported from the retired harness's clarify renderer).
 *
 * Interactive: header, question, 2–4 option chips with hint sublabels.
 * Single-select: tap answers immediately. multi_select: taps toggle, "Send"
 * answers with the labels joined ', '. An "Other" chip expands an inline
 * free-text input. The widget is a shortcut, NEVER a modal — the composer
 * stays live (PRD 24); typing is answering.
 *
 * Frozen: the same card, inert — the transcript record of what was asked
 * (PRD 25).
 *
 * Deep research: when `spec.header === 'Deep research'`, routes to a plan
 * confirmation panel (ResearchPlanPanel) instead of the normal chip widget.
 */
import { useState, type ReactNode } from 'react';
import type { ClarifySpec, ResearchPlanSpec } from '@/api/protocol';
import type { TurnStatus } from '@/api/turn-reducer';
import { Task, TaskContent, TaskItem, TaskItemFile, TaskTrigger } from '@/components/ai-elements/task';
import { cn } from '~/utils';

type ClarifyWidgetProps = {
  spec: ClarifySpec;
  frozen: boolean;
  onAnswer: (text: string) => void;
  /** The persisted answer (frozen transcript record): the resume text the
   *  student chose. Seeds the frozen widget's selection so it shows what was
   *  chosen (PRD 25). null/undefined = unanswered (live parked or never resumed). */
  answer?: string | null;
  turnStatus?: TurnStatus;
};

type ChipProps = {
  label: string;
  hint: string;
  selected: boolean;
  frozen: boolean;
  onClick: () => void;
};

function OptionChip({ label, hint, selected, frozen, onClick }: ChipProps) {
  return (
    <button
      type="button"
      disabled={frozen}
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'flex min-h-[44px] w-full flex-col items-start justify-center rounded-xl border border-border-light px-3 py-2 text-left sm:w-auto',
        !frozen && 'hover:bg-surface-hover',
        frozen && 'cursor-default',
        selected && 'border-[var(--official-border)] bg-[var(--official-surface)]',
      )}
    >
      <span className="text-sm font-medium text-text-primary">{label}</span>
      {hint.length > 0 && <span className="text-xs text-text-secondary">{hint}</span>}
    </button>
  );
}

/** Sane cap on the clarify free-text answer (no known backend limit). */
const OTHER_MAX_LEN = 280;

function OtherInput({ onAnswer }: { onAnswer: (text: string) => void }) {
  const [text, setText] = useState('');
  const send = () => {
    const trimmed = text.trim();
    if (trimmed.length > 0) {
      onAnswer(trimmed);
    }
  };
  return (
    <div className="mt-3 flex gap-2">
      <input
        type="text"
        aria-label="Your answer"
        maxLength={OTHER_MAX_LEN}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            send();
          }
        }}
        placeholder="Type your answer…"
        className="min-h-[44px] flex-1 rounded-xl border border-border-light bg-transparent px-3 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none"
      />
      <button
        type="button"
        onClick={send}
        disabled={text.trim().length === 0}
        className="min-h-[44px] rounded-xl border border-border-light px-3 text-sm font-medium text-text-primary hover:bg-surface-hover disabled:opacity-50"
      >
        Send
      </button>
    </div>
  );
}

/** Derive which option labels the persisted answer selected. An answer that
 *  matches no option label was a free-text ("Other") response — returned as
 *  `other` so the frozen widget shows it. */
function deriveSelection(
  spec: ClarifySpec,
  answer: string | null | undefined,
): { labels: string[]; other: string | null } {
  if (answer === null || answer === undefined || answer.length === 0) {
    return { labels: [], other: null };
  }
  const optionLabels = new Set(spec.options.map((o) => o.label));
  const parts = spec.multi_select ? answer.split(',').map((p) => p.trim()) : [answer.trim()];
  const labels = parts.filter((p) => optionLabels.has(p));
  const others = parts.filter((p) => p.length > 0 && !optionLabels.has(p));
  return { labels, other: others.length > 0 ? others.join(', ') : null };
}

// ── Standard chip widget ─────────────────────────────────────────────────────

function StandardClarifyWidget({ spec, frozen, onAnswer, answer }: ClarifyWidgetProps) {
  const seeded = frozen ? deriveSelection(spec, answer) : { labels: [], other: null };
  const [selected, setSelected] = useState<string[]>(seeded.labels);
  const [otherOpen, setOtherOpen] = useState(seeded.other !== null);

  const toggle = (label: string) =>
    setSelected((prev) =>
      prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label],
    );
  const handleChip = (label: string) => {
    if (spec.multi_select) {
      toggle(label);
    } else {
      onAnswer(label);
    }
  };

  const isChipSelected = (label: string) =>
    frozen ? seeded.labels.includes(label) : spec.multi_select && selected.includes(label);

  return (
    <div
      className={cn(
        'not-prose my-3 rounded-xl border border-border-light bg-surface-primary-alt p-4',
        frozen && 'opacity-70',
      )}
    >
      <div className="text-xs uppercase tracking-wide text-text-secondary">{spec.header}</div>
      <div className="mt-1 font-medium text-text-primary">{spec.question}</div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {spec.options.map((opt) => (
          <OptionChip
            key={opt.label}
            label={opt.label}
            hint={opt.hint}
            selected={isChipSelected(opt.label)}
            frozen={frozen}
            onClick={() => handleChip(opt.label)}
          />
        ))}
        <OptionChip
          label="Other"
          hint="Type your own answer"
          selected={otherOpen}
          frozen={frozen}
          onClick={() => setOtherOpen((v) => !v)}
        />
      </div>
      {/* Frozen "Other" answer: show the typed text the student chose. */}
      {frozen && seeded.other !== null && (
        <div className="mt-3 rounded-xl border border-border-light px-3 py-2 text-sm text-text-primary">
          {seeded.other}
        </div>
      )}
      {spec.multi_select && !frozen && (
        <button
          type="button"
          onClick={() => onAnswer(selected.join(', '))}
          disabled={selected.length === 0}
          className="mt-3 min-h-[44px] rounded-xl border border-border-light px-4 text-sm font-medium text-text-primary hover:bg-surface-hover disabled:opacity-50"
        >
          Send
        </button>
      )}
      {otherOpen && !frozen && <OtherInput onAnswer={onAnswer} />}
    </div>
  );
}

// ── Deep research confirmation panel ─────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  db: 'Counselle data',
  official: 'Official',
  web: 'Web',
  reddit: 'Reddit',
};

function PlanSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border-light pt-4 first:border-t-0 first:pt-0">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-secondary">{title}</h4>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function ResearchPlanDetails({ plan }: { plan: ResearchPlanSpec }) {
  return (
    <div className="mt-4 space-y-4">
      <PlanSection title="Scope">
        <p className="max-w-[76ch] text-[15px] leading-7 text-text-primary">{plan.summary}</p>
        {plan.planner === 'fallback' && (
          <p className="mt-2 rounded-md border border-amber-400/30 bg-amber-500/10 px-2 py-1.5 text-xs leading-5 text-amber-700 dark:text-amber-300">
            {plan.planner_note ?? 'Using a bounded fallback plan because model planning is unavailable.'}
          </p>
        )}
        {plan.schools.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {plan.schools.map((school) => (
              <span
                key={school}
                className="rounded-md bg-surface-secondary px-2 py-1 text-xs text-text-primary"
              >
                {school}
              </span>
            ))}
          </div>
        )}
      </PlanSection>

      {plan.topics.length > 0 && (
        <PlanSection title="Questions">
          <ul className="grid gap-1.5 text-sm leading-6 text-text-primary sm:grid-cols-2">
            {plan.topics.map((topic) => (
              <li key={topic} className="min-w-0 rounded-md bg-surface-secondary px-2.5 py-1.5">
                {topic}
              </li>
            ))}
          </ul>
        </PlanSection>
      )}

      {plan.tasks.length > 0 && (
        <PlanSection title="Detailed work plan">
          <div className="space-y-3">
            {plan.tasks.map((task, index) => (
              <Task key={`${task.label}-${index}`} defaultOpen className="rounded-md">
                <TaskTrigger
                  title={task.label}
                  className="w-full"
                  aria-label={`${task.label} task details`}
                >
                  <button
                    type="button"
                    className="group flex w-full items-start gap-3 rounded-md text-left"
                  >
                    <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-border-light text-[11px] tabular-nums text-text-secondary">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium leading-6 text-text-primary">
                        {task.label}
                      </span>
                      <span className="block text-xs leading-5 text-text-secondary">
                        {task.reason}
                      </span>
                    </span>
                  </button>
                </TaskTrigger>
                <TaskContent className="ml-9">
                  <TaskItem className="flex flex-wrap gap-1.5">
                    {task.sources.map((source) => (
                      <TaskItemFile key={source}>{SOURCE_LABELS[source] ?? source}</TaskItemFile>
                    ))}
                  </TaskItem>
                  {task.queries.length > 0 && (
                    <details className="mt-1.5">
                      <summary className="cursor-pointer text-[11px] leading-5 text-text-secondary hover:text-text-primary">
                        Search details
                      </summary>
                      <div className="mt-1 space-y-1 text-[11px] leading-5 text-text-secondary">
                        {task.queries.slice(0, 3).map((query) => (
                          <div key={query} className="min-w-0 break-words">
                            {query}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </TaskContent>
              </Task>
            ))}
          </div>
        </PlanSection>
      )}

      {plan.source_policy.length > 0 && (
        <PlanSection title="Source rules">
          <ul className="space-y-1.5 text-xs leading-5 text-text-secondary">
            {plan.source_policy.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </PlanSection>
      )}

      {plan.limitations.length > 0 && (
        <PlanSection title="Verification and source limits">
          <ul className="space-y-1.5 text-xs leading-5 text-text-secondary">
            {plan.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
            <li>Maximum runtime: {plan.max_runtime_seconds} seconds.</li>
          </ul>
        </PlanSection>
      )}
    </div>
  );
}

function ResearchPlanLoading() {
  return (
    <div className="mt-4 space-y-4" role="status" aria-live="polite" aria-label="Preparing research plan">
      <div className="space-y-2">
        <div className="h-3 w-24 rounded bg-surface-secondary" />
        <div className="h-4 w-11/12 rounded bg-surface-secondary" />
        <div className="h-4 w-8/12 rounded bg-surface-secondary" />
      </div>
      <div className="space-y-2 border-t border-border-light pt-4">
        <div className="h-3 w-32 rounded bg-surface-secondary" />
        <div className="h-9 rounded-md bg-surface-secondary" />
        <div className="h-9 rounded-md bg-surface-secondary" />
      </div>
    </div>
  );
}

function researchPlanStatus({
  frozen,
  answer,
  turnStatus,
  cancelLabel,
}: {
  frozen: boolean;
  answer?: string | null;
  turnStatus?: TurnStatus;
  cancelLabel?: string;
}): { label: string; tone: 'ready' | 'running' | 'done' | 'cancelled' } {
  const declined =
    answer !== undefined &&
    answer !== null &&
    cancelLabel !== undefined &&
    answer.trim() === cancelLabel;
  if (!frozen) {
    return { label: 'Review before running', tone: 'ready' };
  }
  if (declined || turnStatus === 'cancelled') {
    return { label: 'Cancelled', tone: 'cancelled' };
  }
  if (turnStatus === 'streaming' || turnStatus === 'idle') {
    return { label: 'Running', tone: 'running' };
  }
  if (turnStatus === 'complete') {
    return { label: 'Completed', tone: 'done' };
  }
  if (turnStatus === 'error') {
    return { label: 'Stopped', tone: 'cancelled' };
  }
  return { label: 'Plan saved', tone: 'done' };
}

function ResearchPlanPanel({ spec, frozen, onAnswer, answer, turnStatus }: ClarifyWidgetProps) {
  const runOption =
    spec.options.find((option) => /run deep research/i.test(option.label)) ?? spec.options[0];
  const cancelOption =
    spec.options.find((option) => /cancel|skip/i.test(option.label)) ?? spec.options[1];
  const plan = spec.research_plan;
  const status = researchPlanStatus({ frozen, answer, turnStatus, cancelLabel: cancelOption?.label });

  return (
    <div className="not-prose my-3 rounded-xl border border-border-light bg-surface-primary-alt p-4 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-secondary">
            {spec.header}
          </div>
          <div className="mt-1 text-sm font-semibold text-text-primary">Research plan</div>
        </div>
        <span
          aria-live="polite"
          className={cn(
            'shrink-0 rounded-full border px-2 py-1 text-[11px] font-medium',
            status.tone === 'ready' && 'border-border-light text-text-secondary',
            status.tone === 'running' && 'border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-300',
            status.tone === 'done' && 'border-[var(--official-border)] bg-[var(--official-surface)] text-[var(--official-text)]',
            status.tone === 'cancelled' && 'border-border-light text-text-secondary',
          )}
        >
          {status.label}
        </span>
      </div>
      {plan !== undefined && plan !== null ? (
        <ResearchPlanDetails plan={plan} />
      ) : !frozen ? (
        <ResearchPlanLoading />
      ) : (
        <p className="mt-2 max-w-[72ch] text-sm leading-6 text-text-primary">{spec.question}</p>
      )}
      {!frozen && runOption !== undefined && cancelOption !== undefined && (
        <div className="sticky bottom-2 z-10 mt-3 flex gap-2 rounded-xl border border-border-light bg-surface-primary-alt p-2 shadow-sm sm:static sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
          <button
            type="button"
            onClick={() => onAnswer(runOption.label)}
            className="min-h-[44px] flex-1 rounded-xl bg-teal-600 px-4 text-sm font-medium text-white hover:bg-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            {runOption.label}
          </button>
          <button
            type="button"
            onClick={() => onAnswer(cancelOption.label)}
            className="min-h-[44px] rounded-xl border border-border-light px-4 text-sm font-medium text-text-primary hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-xheavy"
          >
            {cancelOption.label}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Router ───────────────────────────────────────────────────────────────────

export default function ClarifyWidget({ spec, frozen, onAnswer, answer, turnStatus }: ClarifyWidgetProps) {
  if (spec.header === 'Deep research') {
    return (
      <ResearchPlanPanel
        spec={spec}
        frozen={frozen}
        onAnswer={onAnswer}
        answer={answer}
        turnStatus={turnStatus}
      />
    );
  }
  return <StandardClarifyWidget spec={spec} frozen={frozen} onAnswer={onAnswer} answer={answer} />;
}
