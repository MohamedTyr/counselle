import { useState } from "react";

import type { ClarifySpec } from "@/api/chat/types";
import { cn } from "@/lib/utils";

export type ClarifyWidgetProps = {
  spec: ClarifySpec;
  /** True for a persisted transcript entry — the widget renders inert
   *  (chips disabled, no submit affordance), seeded from `answer`. */
  frozen: boolean;
  onAnswer: (text: string) => void;
  /** The persisted answer (frozen transcript record). null/undefined means
   *  unanswered. */
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
      aria-pressed={selected}
      className={cn(
        "flex min-h-11 w-full flex-col items-start justify-center rounded-xl border px-3 py-2 text-left sm:w-auto",
        !frozen && "hover:bg-accent",
        frozen && "cursor-default",
        selected && "border-primary bg-accent",
      )}
      disabled={frozen}
      onClick={onClick}
      type="button"
    >
      <span className="text-sm font-medium text-foreground">{label}</span>
      {hint.length > 0 && (
        <span className="text-xs text-muted-foreground">{hint}</span>
      )}
    </button>
  );
}

const OTHER_MAX_LEN = 280;

function OtherInput({ onAnswer }: { onAnswer: (text: string) => void }) {
  const [text, setText] = useState("");

  const send = () => {
    const trimmed = text.trim();
    if (trimmed.length > 0) {
      onAnswer(trimmed);
    }
  };

  return (
    <div className="mt-3 flex gap-2">
      <input
        aria-label="Your answer"
        className="min-h-11 flex-1 rounded-xl border bg-transparent px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        maxLength={OTHER_MAX_LEN}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            send();
          }
        }}
        placeholder="Type your answer…"
        type="text"
        value={text}
      />
      <button
        className="min-h-11 rounded-xl border px-3 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
        disabled={text.trim().length === 0}
        onClick={send}
        type="button"
      >
        Send
      </button>
    </div>
  );
}

/** Which option labels a persisted answer selected; anything left over is a
 *  free-text ("Other") response. */
function deriveSelection(
  spec: ClarifySpec,
  answer: string | null | undefined,
): { labels: string[]; other: string | null } {
  if (answer === null || answer === undefined || answer.length === 0) {
    return { labels: [], other: null };
  }

  const optionLabels = new Set(spec.options.map((option) => option.label));
  const parts = spec.multi_select
    ? answer.split(",").map((part) => part.trim())
    : [answer.trim()];
  const labels = parts.filter((part) => optionLabels.has(part));
  const others = parts.filter(
    (part) => part.length > 0 && !optionLabels.has(part),
  );

  return { labels, other: others.length > 0 ? others.join(", ") : null };
}

/**
 * ClarifyWidget — the inline (never modal) clarifying-question card. Ported
 * from the old app's ClarifyWidget: single-select answers submit
 * immediately; multi-select toggles chips and a "Send" button joins the
 * selected labels with ", "; an "Other" chip opens a free-text input where
 * Enter or "Send" submits. A frozen widget seeds its selection from the
 * persisted `answer` and renders inert (the transcript record of what was
 * asked and chosen).
 */
export function ClarifyWidget({
  spec,
  frozen,
  onAnswer,
  answer,
}: ClarifyWidgetProps) {
  const seeded = frozen
    ? deriveSelection(spec, answer)
    : { labels: [], other: null };
  const [selected, setSelected] = useState<string[]>(seeded.labels);
  const [otherOpen, setOtherOpen] = useState(seeded.other !== null);

  const toggle = (label: string) => {
    setSelected((previous) =>
      previous.includes(label)
        ? previous.filter((entry) => entry !== label)
        : [...previous, label],
    );
  };

  const handleChip = (label: string) => {
    if (spec.multi_select) {
      toggle(label);
      return;
    }

    onAnswer(label);
  };

  const isChipSelected = (label: string) =>
    frozen
      ? seeded.labels.includes(label)
      : spec.multi_select && selected.includes(label);

  return (
    <div
      className={cn(
        "not-prose my-3 rounded-xl border bg-card p-4",
        frozen && "opacity-70",
      )}
    >
      <div className="text-xs tracking-wide text-muted-foreground uppercase">
        {spec.header}
      </div>
      <div className="mt-1 font-medium text-foreground">{spec.question}</div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {spec.options.map((option) => (
          <OptionChip
            frozen={frozen}
            hint={option.hint}
            key={option.label}
            label={option.label}
            onClick={() => handleChip(option.label)}
            selected={isChipSelected(option.label)}
          />
        ))}
        <OptionChip
          frozen={frozen}
          hint="Type your own answer"
          label="Other"
          onClick={() => setOtherOpen((value) => !value)}
          selected={otherOpen}
        />
      </div>
      {frozen && seeded.other !== null && (
        <div className="mt-3 rounded-xl border px-3 py-2 text-sm text-foreground">
          {seeded.other}
        </div>
      )}
      {spec.multi_select && !frozen && (
        <button
          className="mt-3 min-h-11 rounded-xl border px-4 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
          disabled={selected.length === 0}
          onClick={() => onAnswer(selected.join(", "))}
          type="button"
        >
          Send
        </button>
      )}
      {otherOpen && !frozen && <OtherInput onAnswer={onAnswer} />}
    </div>
  );
}
