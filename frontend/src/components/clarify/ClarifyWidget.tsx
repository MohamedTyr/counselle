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
import { useState } from 'react';
import type { ClarifySpec } from '@/api/protocol';
import { cn } from '~/utils';

type ClarifyWidgetProps = {
  spec: ClarifySpec;
  frozen: boolean;
  onAnswer: (text: string) => void;
  /** The persisted answer (frozen transcript record): the resume text the
   *  student chose. Seeds the frozen widget's selection so it shows what was
   *  chosen (PRD 25). null/undefined = unanswered (live parked or never resumed). */
  answer?: string | null;
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

// ── Deep research plan panel ─────────────────────────────────────────────────

const RESEARCH_PHASES = [
  { num: 1, label: 'Planning research', sub: 'Resolve schools, question scope, and evidence needs.' },
  { num: 2, label: 'Checking Counselle data', sub: 'Use CDS, IPEDS, Scorecard, programs, and outcome envelopes first.' },
  { num: 3, label: 'Searching official sources', sub: 'Career outcome pages and current school publications.' },
  { num: 4, label: 'Searching web', sub: 'Supporting context when official sources are incomplete.' },
  { num: 5, label: 'Checking student sentiment', sub: 'Reddit only as qualitative signal.' },
  { num: 6, label: 'Extracting relevant pages', sub: 'Pull citations for pages selected by source gates.' },
  { num: 7, label: 'Verifying evidence', sub: 'Check numbers, dates, policy statements, and recommendations.' },
  { num: 8, label: 'Writing report', sub: 'Separate facts, official findings, sentiment, unknowns, and next steps.' },
];

function ResearchPlanPanel({ spec, frozen, onAnswer, answer }: ClarifyWidgetProps) {
  const runOption = spec.options[0];
  const cancelOption = spec.options[1];

  return (
    <div className="not-prose my-3 rounded-xl border border-border-light bg-surface-primary-alt p-4">
      <div className="text-xs uppercase tracking-wide text-text-secondary">{spec.header}</div>
      <p className="mt-1 text-sm text-text-secondary">{spec.question}</p>
      <div className="mt-3 rounded-xl border border-border-light bg-surface-primary p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-text-primary">Deep research plan</span>
          <span className="text-xs text-text-secondary">2–4 min · 8 phases</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {RESEARCH_PHASES.map((p) => (
            <div key={p.num} className="flex items-start gap-2">
              <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-surface-secondary text-[11px] font-medium text-text-secondary">
                {p.num}
              </span>
              <div>
                <span className="text-[13px] font-medium text-text-primary">{p.label}</span>
                <span className="ml-1.5 text-[12px] text-text-secondary">{p.sub}</span>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-text-secondary">
          Sources: Counselle data · .edu pages · web · Reddit sentiment. Disabled sources are not called.
        </p>
      </div>
      {!frozen && runOption !== undefined && cancelOption !== undefined && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => onAnswer(runOption.label)}
            className="min-h-[44px] flex-1 rounded-xl bg-teal-600 px-4 text-sm font-medium text-white hover:bg-teal-700"
          >
            {runOption.label}
          </button>
          <button
            type="button"
            onClick={() => onAnswer(cancelOption.label)}
            className="min-h-[44px] rounded-xl border border-border-light px-4 text-sm font-medium text-text-primary hover:bg-surface-hover"
          >
            {cancelOption.label}
          </button>
        </div>
      )}
      {frozen && answer != null && (
        <p className="mt-3 text-sm text-text-secondary">
          You chose: <strong>{answer}</strong>
        </p>
      )}
    </div>
  );
}

// ── Router ───────────────────────────────────────────────────────────────────

export default function ClarifyWidget({ spec, frozen, onAnswer, answer }: ClarifyWidgetProps) {
  if (spec.header === 'Deep research') {
    return <ResearchPlanPanel spec={spec} frozen={frozen} onAnswer={onAnswer} answer={answer} />;
  }
  return <StandardClarifyWidget spec={spec} frozen={frozen} onAnswer={onAnswer} answer={answer} />;
}
