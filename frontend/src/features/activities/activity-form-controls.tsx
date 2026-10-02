import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  COPIED_FEEDBACK_MS,
  drawerControlClassName,
} from "@/features/activities/activities-config";
import { toggleValue } from "@/features/activities/activities-reorder";
import { Check, Copy } from "lucide-react";

// ---------------------------------------------------------------------------
// Multi-select chip toggles. Real checkbox semantics (keyboard + SR), styled
// as chips. Never radios: grades, timing, and levels are check-all-that-apply.
// ---------------------------------------------------------------------------

export function CheckChipGroup<T extends string>({
  ariaLabel,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  onChange: (value: T[]) => void;
  options: readonly { label: string; value: T }[];
  value: T[];
}) {
  return (
    <div aria-label={ariaLabel} className="flex flex-wrap gap-1.5" role="group">
      {options.map((option) => {
        const checked = value.includes(option.value);

        return (
          <label
            className={cn(
              "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm transition-[color,background-color,border-color,scale] duration-150 ease-out select-none focus-within:ring-2 focus-within:ring-[var(--focus-ring)] active:scale-[0.96] motion-reduce:transition-none",
              checked
                ? "border-[var(--accent-solid)] bg-[var(--brand-subtle)] text-[var(--brand-subtle-ink)]"
                : "border-[var(--activity-control-border)] text-[var(--ink-secondary)] hover:border-[var(--edge-control-strong)] hover:text-[var(--ink)]",
            )}
            key={option.value}
          >
            <input
              checked={checked}
              className="sr-only"
              onChange={() => onChange(toggleValue(value, option.value))}
              type="checkbox"
            />
            {checked ? <Check aria-hidden="true" className="size-3.5" /> : null}
            <span>{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}

export function CopyFieldButton({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const timeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timeoutRef.current), []);

  async function handleCopy() {
    window.clearTimeout(timeoutRef.current);

    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }

    timeoutRef.current = window.setTimeout(() => {
      setCopied(false);
      setCopyFailed(false);
    }, COPIED_FEEDBACK_MS);
  }

  return (
    <Button
      aria-label={label}
      className="h-6 gap-1 px-2 text-[var(--ink-faint)] hover:text-[var(--ink)]"
      disabled={!value}
      onClick={handleCopy}
      size="xs"
      type="button"
      variant="ghost"
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span aria-live="polite">
        {copied ? "Copied" : copyFailed ? "Copy failed" : "Copy"}
      </span>
    </Button>
  );
}

export function NumberField({
  ariaLabel,
  max,
  onChange,
  placeholder,
  value,
}: {
  ariaLabel: string;
  max: number;
  onChange: (value: number | undefined) => void;
  placeholder: string;
  value: number | undefined;
}) {
  return (
    <Input
      aria-label={ariaLabel}
      className={cn(
        "w-24 [&_[data-slot=input]]:tabular-nums",
        drawerControlClassName,
      )}
      inputMode="numeric"
      onChange={(event) => {
        const digits = event.target.value.replace(/\D/g, "");

        if (!digits) {
          onChange(undefined);
          return;
        }

        onChange(Math.min(Math.max(Number.parseInt(digits, 10), 1), max));
      }}
      placeholder={placeholder}
      value={value === undefined ? "" : String(value)}
    />
  );
}

export function DrawerSectionLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-sm font-semibold text-[var(--ink)]">{children}</h3>
  );
}

export function DrawerField({
  children,
  label,
  labelFor,
  trailing,
}: {
  children: ReactNode;
  label: string;
  labelFor?: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <label
          className="text-xs font-medium text-[var(--ink-secondary)]"
          htmlFor={labelFor}
        >
          {label}
        </label>
        {trailing ? (
          <div className="flex items-center gap-1.5">{trailing}</div>
        ) : null}
      </div>
      {children}
    </div>
  );
}
