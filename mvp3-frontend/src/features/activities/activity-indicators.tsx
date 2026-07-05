import { getCharState } from "@/domain/activity"
import { cn } from "@/lib/utils"
import { charStateClass } from "@/features/activities/activities-config"
import { AlertTriangle, Check } from "lucide-react"

export function CharCounter({
  hideOverIcon = false,
  id,
  length,
  limit,
}: {
  hideOverIcon?: boolean
  id?: string
  length: number
  limit: number
}) {
  const state = getCharState(length, limit)
  const over = length - limit

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-xs tabular-nums",
        charStateClass[state]
      )}
      id={id}
    >
      {state === "over" && !hideOverIcon ? (
        <AlertTriangle aria-hidden="true" className="size-3.5" />
      ) : null}
      {state === "ok" ? (
        <Check aria-hidden="true" className="size-3.5 opacity-70" />
      ) : null}
      <span>
        {length}/{limit}
        {state === "over" ? ` · ${over} over` : ""}
      </span>
    </span>
  )
}

// Threshold crossings are announced politely; the visible counter stays quiet
// so screen readers are not spammed on every keystroke.
export function CharLimitAnnouncer({
  length,
  limit,
}: {
  length: number
  limit: number
}) {
  const state = getCharState(length, limit)
  const message =
    state === "over"
      ? `${length - limit} characters over the ${limit} character limit`
      : state === "near"
        ? `Approaching the ${limit} character limit`
        : ""

  return (
    <span aria-live="polite" className="sr-only">
      {message}
    </span>
  )
}

export function RankBadge({
  isReady,
  order,
}: {
  isReady: boolean
  order: number
}) {
  return (
    <span
      className={cn(
        "inline-flex h-7 min-w-7 items-center justify-center rounded-lg border px-1.5 text-sm font-semibold tabular-nums transition-colors",
        isReady
          ? "border-border bg-muted/50 text-foreground"
          : "border-[color:var(--activity-warning-fg)]/45 bg-[color:var(--activity-warning-fg)]/12 text-[color:var(--activity-warning-fg)]"
      )}
    >
      {order}
    </span>
  )
}
