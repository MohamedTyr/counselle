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
  jumpEvidence: (page: number | null | undefined) => void;
  goToNextFlag: () => void;
  goToPrevFlag: () => void;
  flaggedFirst: boolean;
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
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
