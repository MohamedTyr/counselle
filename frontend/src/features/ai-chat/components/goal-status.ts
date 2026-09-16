import type { badgeVariants } from "@/components/ui/badge";
import type { GoalStatus } from "@/api/chat/types";

import type { VariantProps } from "class-variance-authority";

type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];

/**
 * The six terminal states, `running`, and the crash rule, all in one place
 * (plans/goal-mode-plan.md §5.3) — `GoalHeader` and `GoalVerdictCard` both
 * call this so they can never disagree about what a status means. `null`
 * means "still running" unless `isInterrupted` overrides it.
 *
 * Pulled out of `GoalHeader.tsx` into its own module (not a component) so
 * that file only exports components — `react-refresh/only-export-components`
 * otherwise flags a plain function living beside a component export.
 *
 * The live SSE path validates `status` against the `GoalStatus` union
 * (`sse.ts`'s `isGoalStatus`, used by `isGoalStepDetail`) and throws a
 * `TransportError` rather than ever handing this function an unrecognized
 * literal. The persisted-transcript replay path does not: `legacy-replay.ts`
 * passes a `kind: "step"` segment's `data` through as an opaque record (only
 * checked to be an object, never shape-checked), so a stored session
 * carrying a status outside the current six-literal union — after a backend
 * rename, or a seventh status persisted before a frontend deploy — reaches
 * this function unvalidated on replay. The `default` branch below is
 * load-bearing for exactly that path, even though TypeScript's
 * exhaustiveness checking considers the switch complete: it is the only
 * thing standing between an unrecognized value and a `TypeError` that would
 * take out the whole chat view for that turn.
 *
 * That branch only ever fires for a non-null, unrecognized `status` — `null`
 * has its own case above it. Per the crash rule (§5.3), a non-null `status`
 * only ever comes from a genuine `phase: "final"` step; a crashed/interrupted
 * run never produces one. So an unrecognized value here always means a
 * concluded run, in both callers (`GoalHeader` and `GoalVerdictCard`) —
 * never one still in progress. "Working" would therefore be an affirmative
 * false claim, not just an unhelpful guess; "Status unknown" is the honest
 * fallback.
 */
export function goalStatusPresentation(
  status: GoalStatus | null,
  isInterrupted: boolean,
): Readonly<{ headline: string; badge: BadgeVariant }> {
  if (isInterrupted) {
    return { headline: "Stopped — interrupted", badge: "secondary" };
  }

  switch (status) {
    case null:
      return { headline: "Working", badge: "secondary" };
    case "achieved":
      return { headline: "Achieved", badge: "success" };
    case "partial":
      return { headline: "Partial — some criteria unmet", badge: "warning" };
    case "stopped_budget":
      return { headline: "Partial — budget reached", badge: "warning" };
    case "stopped_no_progress":
      return { headline: "Stopped — no progress", badge: "warning" };
    case "stopped_user":
      return { headline: "Stopped — you stopped it", badge: "secondary" };
    case "stopped_check_failed":
      return { headline: "Stopped — couldn't check", badge: "warning" };
    default:
      return { headline: "Status unknown", badge: "secondary" };
  }
}
