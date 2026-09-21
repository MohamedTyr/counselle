import { forwardRef, useMemo } from "react";

import { cn } from "@/lib/utils";

import { getSatHtml } from "./sat-html";

export interface SatContentProps {
  /** Identifies the sanitised-HTML cache entry (plan §6.1) — the question's
   * content hash, so re-rendering the same question never re-sanitises or
   * re-creates the DOM nodes the highlighter (§6.3) walks. */
  contentSha: string;
  /** Which field this is ("stimulus" | "stem" | …) — part of the cache key,
   * distinct fields of the same question never collide. */
  field: string;
  /** The raw, un-normalised HTML from the question bank. */
  html: string;
  className?: string;
}

/**
 * Renders College Board's sanitised question HTML (plan §6.1). The **only**
 * place in the app that injects content HTML via `dangerouslySetInnerHTML`
 * — every other content surface reads through this component.
 *
 * `getSatHtml` memoises the sanitised string by `(contentSha, field)`, but
 * that alone is not enough: React's DOM prop differ compares
 * `dangerouslySetInnerHTML` by the **wrapper object's reference**, not by
 * its `__html` string — `nextProps.dangerouslySetInnerHTML !==
 * lastProps.dangerouslySetInnerHTML` decides whether to touch the DOM at
 * all, and only once that reference check trips does React read `__html`
 * and unconditionally assign it to `element.innerHTML` (no string
 * comparison happens there either). A fresh `{ __html: sanitized }` object
 * literal in the JSX below would therefore fail that reference check on
 * *every* render — including one triggered by an unrelated timer tick
 * elsewhere in the tree — and force a real `innerHTML` reset each time,
 * detaching every text node the highlighter (`use-sat-highlighter.ts`)
 * holds `Range`s into, even though the sanitised string never changed. The
 * second `useMemo` below keeps that wrapper object's reference stable
 * across renders whenever `sanitized` itself is unchanged, which is what
 * actually keeps the DOM untouched.
 */
export const SatContent = forwardRef<HTMLDivElement, SatContentProps>(
  function SatContent({ contentSha, field, html, className }, ref) {
    const sanitized = useMemo(
      () => getSatHtml(contentSha, field, html),
      [contentSha, field, html],
    );
    const innerHtml = useMemo(() => ({ __html: sanitized }), [sanitized]);

    return (
      <div
        ref={ref}
        className={cn("sat-content", className)}
        dangerouslySetInnerHTML={innerHtml}
      />
    );
  },
);
