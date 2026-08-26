import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type PageHeaderProps = {
  actions?: ReactNode;
  className?: string;
  /**
   * Width class for the title row, supplied by `PageContainer` so the title
   * shares a left edge with the body column on narrow pages.
   */
  columnClassName?: string;
  /**
   * Replaces the mark/title/subtitle block — a breadcrumb, say, on a page
   * that introduces its subject in the body instead of in the chrome. The
   * caller owns the page's single `<h1>` when this is set; `title` still
   * names the bar for assistive tech.
   */
  heading?: ReactNode;
  /**
   * A mark that identifies the page's subject — a school's avatar, say. Sits
   * left of the title inside the same column, so it aligns with the body
   * rather than floating in the gutter.
   */
  leading?: ReactNode;
  subtitle?: ReactNode;
  title: string;
};

/**
 * `min-h-16` is what keeps the rule under the title on the same baseline across
 * every route. The header used to size itself off whatever it contained, so a
 * page with 32px action buttons drew the rule at 64px, a page with small ghost
 * actions at 60px, and a page with no actions at 52px.
 */
export function PageHeader({
  actions,
  className,
  columnClassName,
  heading,
  leading,
  subtitle,
  title,
}: PageHeaderProps) {
  return (
    <div
      aria-label={heading ? title : undefined}
      className={cn(
        "relative -mx-6 flex min-h-16 shrink-0 items-center px-6 md:-mx-10 md:px-10",
        className,
      )}
    >
      <div
        className={cn(
          "flex w-full flex-col gap-4 py-3 md:flex-row md:items-center md:justify-between",
          columnClassName,
        )}
      >
        {heading ?? (
          <div className="flex min-w-0 items-center gap-3">
            {leading ? <div className="shrink-0">{leading}</div> : null}
            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="truncate text-xl leading-none font-semibold tracking-tight">
                {title}
              </h1>
              {subtitle ? (
                <p className="truncate text-sm text-muted-foreground">
                  {subtitle}
                </p>
              ) : null}
            </div>
          </div>
        )}
        {actions ? (
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
            {actions}
          </div>
        ) : null}
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-5 bottom-0 left-0 border-b"
      />
    </div>
  );
}
