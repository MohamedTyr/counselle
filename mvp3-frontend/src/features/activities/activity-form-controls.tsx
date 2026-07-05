import { useEffect, useRef, useState, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  COPIED_FEEDBACK_MS,
  drawerControlClassName,
} from "@/features/activities/activities-config"
import { toggleValue } from "@/features/activities/activities-reorder"
import { Check, Copy } from "lucide-react"

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
  ariaLabel: string
  onChange: (value: T[]) => void
  options: readonly { label: string; value: T }[]
  value: T[]
}) {
  return (
    <div aria-label={ariaLabel} className="flex flex-wrap gap-1.5" role="group">
      {options.map((option) => {
        const checked = value.includes(option.value)

        return (
          <label
            className={cn(
              "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors select-none focus-within:ring-2 focus-within:ring-ring/50",
              checked
                ? "border-white/[0.14] bg-white/[0.075] font-medium text-foreground"
                : "border-white/[0.075] bg-white/[0.025] text-muted-foreground hover:border-white/[0.12] hover:bg-white/[0.045] hover:text-foreground"
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
        )
      })}
    </div>
  )
}

export function CopyFieldButton({
  label,
  value,
}: {
  label: string
  value: string
}) {
  const [copied, setCopied] = useState(false)
  const timeoutRef = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timeoutRef.current), [])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // Clipboard can be blocked (permissions, insecure context); fail quietly.
    }

    setCopied(true)
    window.clearTimeout(timeoutRef.current)
    timeoutRef.current = window.setTimeout(
      () => setCopied(false),
      COPIED_FEEDBACK_MS
    )
  }

  return (
    <Button
      aria-label={label}
      className="h-6 gap-1 px-1.5 text-muted-foreground hover:text-foreground"
      disabled={!value}
      onClick={handleCopy}
      size="xs"
      type="button"
      variant="ghost"
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
    </Button>
  )
}

export function NumberField({
  ariaLabel,
  max,
  onChange,
  placeholder,
  value,
}: {
  ariaLabel: string
  max: number
  onChange: (value: number | undefined) => void
  placeholder: string
  value: number | undefined
}) {
  return (
    <Input
      aria-label={ariaLabel}
      className={cn(
        "w-24 [&_[data-slot=input]]:tabular-nums",
        drawerControlClassName
      )}
      inputMode="numeric"
      onChange={(event) => {
        const digits = event.target.value.replace(/\D/g, "")

        if (!digits) {
          onChange(undefined)
          return
        }

        onChange(Math.min(Number.parseInt(digits, 10), max))
      }}
      placeholder={placeholder}
      value={value === undefined ? "" : String(value)}
    />
  )
}

export function DrawerSectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </p>
  )
}

export function DrawerField({
  children,
  label,
  labelFor,
  trailing,
}: {
  children: ReactNode
  label: string
  labelFor?: string
  trailing?: ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <label
          className="text-xs font-medium text-muted-foreground"
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
  )
}
