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
 * `getSatHtml` memoises the sanitised string by `(contentSha, field)`, and
 * that memoisation is load-bearing: React only leaves
 * `dangerouslySetInnerHTML` DOM alone while the `__html` string value is
 * referentially unchanged, and the highlighter (`use-sat-highlighter.ts`)
 * walks that same DOM by text-node position — a fresh render count would
 * quietly detach its `Range`s.
 */
export const SatContent = forwardRef<HTMLDivElement, SatContentProps>(
  function SatContent({ contentSha, field, html, className }, ref) {
    const sanitized = useMemo(
      () => getSatHtml(contentSha, field, html),
      [contentSha, field, html],
    );

    return (
      <div
        ref={ref}
        className={cn("sat-content", className)}
        dangerouslySetInnerHTML={{ __html: sanitized }}
      />
    );
  },
);
