import type { ReactNode, Ref } from "react";

import { PageHeader } from "@/components/workspace/PageHeader";
import { cn } from "@/lib/utils";

/**
 * The one page scaffold. Every workspace route renders through this so that the
 * header bar height, the content column width, and the gutter rhythm are decided
 * in exactly one place.
 *
 * Before this existed the `<section>`/scroll-div pair was a copy-pasted class
 * string in four route files (and had already drifted in a fifth), which is why
 * the header bar measured 64px on three pages, 52px on Activities and 60px on
 * Profile, and why the page title sat 84px / 140px away from its own content
 * column on the two pages that centre their content.
 *
 * `width` is the only knob. The header title tracks the same column as the body,
 * so a narrow page reads as one aligned column rather than a full-bleed title
 * floating above a centred body. The rule under the header stays full-bleed —
 * it separates the page chrome from the page, so it belongs to the page edge.
 */
/**
 * One rule per tier: dense data surfaces (board, table, card grid) run
 * `full`; linear read-and-enter surfaces (a list you scan top to bottom, a
 * form you fill in order) run `wide`. Before this there were three widths
 * across five pages — 1064 / 896 / 768 — with no rule behind the split.
 */
/**
 * `panel` is the rail-and-panel pages (Profile, a school's detail): they need
 * more room than `wide` for two columns, but not the whole ultrawide display.
 * It was a `max-w-[1160px]` literal on each of those pages, which left their
 * headers full-bleed above a centred body — the exact drift this scaffold
 * exists to prevent.
 */
export type PageWidth = "full" | "panel" | "wide";

const COLUMN_CLASS: Record<PageWidth, string> = {
  full: "w-full",
  panel: "mx-auto w-full max-w-[1160px]",
  wide: "mx-auto w-full max-w-4xl",
};

type PageContainerProps = {
  actions?: ReactNode;
  children: ReactNode;
  /** Extra classes for the scrolling body column. */
  className?: string;
  /** Replaces the title block in the header bar — see PageHeader. */
  heading?: ReactNode;
  /** Identifying mark left of the title — see PageHeader. */
  leading?: ReactNode;
  /**
   * Rendered inside the page section but outside the scroll area — undo toasts,
   * dialogs, scroll indicators. Anything that must not scroll with the body.
   */
  overlay?: ReactNode;
  scrollRef?: Ref<HTMLDivElement>;
  subtitle?: ReactNode;
  title: string;
  width?: PageWidth;
};

export function PageContainer({
  actions,
  children,
  className,
  heading,
  leading,
  overlay,
  scrollRef,
  subtitle,
  title,
  width = "full",
}: PageContainerProps) {
  const column = COLUMN_CLASS[width];

  return (
    <section className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div
        className="flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pb-6 md:px-10"
        ref={scrollRef}
      >
        <PageHeader
          actions={actions}
          columnClassName={column}
          heading={heading}
          leading={leading}
          subtitle={subtitle}
          title={title}
        />
        {/*
         * `shrink-0`, not `min-h-0`: as a flex item of the scroll container
         * this column was allowed to shrink below its content, so a long page
         * spilled *out* of its own box. Overflow from a descendant does not
         * pick up the scrollport's `pb-6`, which is why the last card on a
         * tall page (a school's About tab) sat flush against the window edge
         * however much bottom padding the scroller had.
         */}
        <div className={cn("flex shrink-0 flex-col gap-6", column, className)}>
          {children}
        </div>
      </div>
      {overlay}
    </section>
  );
}
