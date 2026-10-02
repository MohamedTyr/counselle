import { Check, X } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/*
 * Small building blocks for the scholarship editor. They follow the profile
 * form's grammar: label above control, choices on show as chips.
 */

export function EditorSection({
  id,
  title,
  children,
  aside,
}: {
  id: string;
  title: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 border-t border-[var(--hairline)] px-6 py-5 first:border-t-0">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--ink)]" id={id}>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label className="text-xs font-medium text-[var(--ink-secondary)]" htmlFor={id}>
        {label}
      </Label>
      {children(id)}
      {error ? (
        <p className="text-xs text-[var(--danger-fg)]">{error}</p>
      ) : hint ? (
        <p className="text-xs text-[var(--ink-muted)]">{hint}</p>
      ) : null}
    </div>
  );
}

export function ChoiceChips<T extends string>({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { value: T; label: string }[];
  selected: readonly T[];
  onToggle: (value: T) => void;
}) {
  return (
    <div aria-label={label} className="flex flex-wrap gap-1.5" role="group">
      {options.map((option) => {
        const on = selected.includes(option.value);
        return (
          <button
            aria-pressed={on}
            className={cn(
              "inline-flex h-7 cursor-pointer items-center gap-1 rounded-full border px-2.5 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] active:scale-[0.97]",
              on
                ? "border-[var(--accent-solid)] bg-[var(--brand-subtle)] font-medium text-[var(--brand-subtle-ink)]"
                : "border-[var(--edge-control)] bg-[var(--surface-raised)] text-[var(--ink-secondary)] hover:border-[var(--edge-control-strong)]",
            )}
            key={option.value}
            onClick={() => onToggle(option.value)}
            type="button"
          >
            {on ? <Check aria-hidden="true" className="size-3" /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Enter or a comma adds a tag; Backspace on an empty field removes the last. */
export function TagInput({
  id,
  values,
  onChange,
  placeholder,
}: {
  id?: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}) {
  const [text, setText] = useState("");
  function commit() {
    const value = text.trim().replace(/,$/, "");
    if (value && !values.some((existing) => existing.toLowerCase() === value.toLowerCase())) {
      onChange([...values, value]);
    }
    setText("");
  }
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-[var(--field-surface)] px-1.5 py-1 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/24">
      {values.map((value) => (
        <span
          className="inline-flex h-6 items-center gap-1 rounded-md bg-[var(--label-surface)] pr-1 pl-2 text-xs text-[var(--label-ink)]"
          key={value}
        >
          {value}
          <button
            aria-label={`Remove ${value}`}
            className="flex size-4 cursor-pointer items-center justify-center rounded-sm opacity-60 hover:bg-[var(--surface-hover)] hover:opacity-100"
            onClick={() => onChange(values.filter((item) => item !== value))}
            type="button"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        className="h-6 min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-[var(--ink-placeholder)]"
        id={id}
        onBlur={commit}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            commit();
          } else if (event.key === "Backspace" && text === "" && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
        placeholder={values.length ? "" : placeholder}
        value={text}
      />
    </div>
  );
}

/** Whole numbers only; empty is null. */
export function NumberInput({
  id,
  value,
  onChange,
  prefix,
  placeholder,
  step,
  className,
}: {
  id?: string;
  value: number | null;
  onChange: (value: number | null) => void;
  prefix?: string;
  placeholder?: string;
  step?: number;
  className?: string;
}) {
  // Local text so a half-typed "3." isn't normalised to "3" mid-keystroke.
  const [text, setText] = useState(value === null ? "" : String(value));
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    if (value !== (text === "" ? null : Number(text))) setText(value === null ? "" : String(value));
  }
  return (
    <div className={cn("relative", className)}>
      {prefix ? (
        <span className="pointer-events-none absolute start-3 top-1/2 z-10 -translate-y-1/2 text-sm text-[var(--ink-muted)]">
          {prefix}
        </span>
      ) : null}
      <Input
        className={cn("tabular-nums", prefix && "[&_input]:ps-6")}
        id={id}
        inputMode={step && step < 1 ? "decimal" : "numeric"}
        onChange={(event) => {
          const raw = event.target.value.replace(step && step < 1 ? /[^0-9.]/g : /[^0-9]/g, "");
          setText(raw);
          const parsed = raw === "" ? null : Number(raw);
          const next = parsed !== null && Number.isFinite(parsed) ? parsed : null;
          setLastValue(next);
          onChange(next);
        }}
        placeholder={placeholder}
        value={text}
      />
    </div>
  );
}
