import { createContext, useContext } from "react";

/** The keyboard/focus/viewer controller shared by every section and metric
 * row (DESIGN.md §5.1/§5.9) — one instance, built by `useReviewController`
 * in `cds-review-page.tsx`, threaded down via context so a metric row three
 * components deep can register itself and ask to be focused without prop
 * drilling through `ReviewPanel` → `ReviewSection`. */
export interface ReviewController {
  openDomains: Set<string>;
  setOpenDomains: (domains: string[]) => void;
  editingRef: string | null;
  setEditingRef: (ref: string | null) => void;
  registerMetricRef: (ref: string, el: HTMLElement | null) => void;
  reportFocus: (ref: string) => void;
  focusMetric: (ref: string) => void;
  /** The ref most recently reported by `reportFocus` — i.e. the metric whose
   * value element currently has DOM focus, however it got there (`n`/`p`,
   * `j`/`k`, or a plain Tab). Exposed so a row can tell whether *it* is the
   * one the admin is looking at, without a second focus-tracking mechanism —
   * `MetricRow` uses it to decide whether its own evidence chip should flag
   * a page mismatch against the viewer (see `currentPage` below). */
  focusedRef: string | null;
  jumpEvidence: (page: number | null | undefined) => void;
  goToNextFlag: () => void;
  goToPrevFlag: () => void;
  /** The PDF viewer's current page, mirrored down from `cds-review-page.tsx`
   * (already threaded through `useReviewController` for the `[`/`]`
   * shortcuts) — not new state, just surfaced here too so `MetricRow` can
   * compare it against a row's own evidence page (§5.7's jump only moves the
   * viewer on `n`/`p`, never on `j`/`k`, so the two can legitimately
   * disagree; the focused row's chip should say so). */
  currentPage: number;
  /** How many metrics `n`/`p` can actually walk — every flagged metric with
   * no pending edit, warnings included. Deliberately *not*
   * `flags_summary.unresolved`, which counts only `error`-severity flags
   * because it gates Approve (`service_review._flags_summary`). The flag bar
   * reports what there is to review; the approve bar reports what blocks. */
  flagQueueLength: number;
  /** Position of the currently-focused metric within `flagQueue`, 0-indexed,
   * or `-1` when the focused metric (if any) isn't a flag-queue member —
   * e.g. nothing has been focused yet, or the operator walked to it with
   * `j`/`k` instead of `n`/`p`. Same array, same indexing `goToFlagBy`
   * itself uses to wrap — this is that "where am I" number surfaced, not a
   * new one: `n`/`p` can wrap silently past the end with no position shown
   * otherwise (§5.5's "N to review" is a remaining-count, not a position). */
  flagQueueIndex: number;
  flaggedFirst: boolean;
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  /** Metric refs whose pending edit was just swept by `_current_edits`
   * (`app/cds/service_review.py`, migration 0016) because a re-extraction
   * moved past the values that edit was written against. Populated by
   * `cds-review-page.tsx` from what it itself observed disappear right
   * after *this session's own* Re-run — the wire carries no per-metric
   * "superseded" flag (a metric with no pending edit looks identical
   * whether it never had one or just lost one), so this can only ever be a
   * session-local inference, never a fact re-derivable from a fresh load. */
  supersededRefs: ReadonlySet<string>;
}

export const ReviewControllerContext = createContext<ReviewController | null>(
  null,
);

/** Reads the controller built by `useReviewController`
 * (`use-review-controller.ts`) — named `*Context` specifically so it can't
 * be confused with the hook that builds the value in the first place. */
export function useReviewControllerContext(): ReviewController {
  const controller = useContext(ReviewControllerContext);
  if (!controller) {
    throw new Error(
      "useReviewControllerContext must be used inside <ReviewControllerContext>",
    );
  }
  return controller;
}
