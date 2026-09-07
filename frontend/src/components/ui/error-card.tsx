import { cva, type VariantProps } from "class-variance-authority";
import type React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const errorCardVariants = cva("rounded-xl border p-6", {
  defaultVariants: {
    variant: "default",
  },
  variants: {
    variant: {
      default: "bg-card",
      // Byte-for-byte clone of ActivitiesRoute.tsx's original inline card
      // (school-data-v3 plan §6b promotion — see the file-level comment).
      // That original already deviated from DESIGN.md §17.1's canonical
      // "--edge` border + `--surface-raised` fill + `--elevation-1`" card
      // pattern by omitting `--elevation-1`. This is inherited debt, not a
      // sanctioned second pattern — don't copy `raised` as the reference
      // for a new §17.1 card; add the shadow there instead.
      raised: "border-[color:var(--edge)] bg-[color:var(--surface-raised)]",
    },
  },
});

/**
 * DESIGN.md §13.1's error state ("Could not load {things}"). Promoted out of
 * the parked CDS admin feature (`features/cds-admin/CdsErrorCard.tsx`,
 * school-data-v3 plan §6b) — it was the only DRY copy of this card and had
 * been hand-rolled in six other places. Each call site owns its own heading,
 * body sentence, and button label; this primitive owns only the shared
 * chrome, so re-pointing a site to it is a markup change with an unchanged
 * accessible name.
 */
export function ErrorCard({
  className,
  headingLevel: HeadingTag = "h2",
  message,
  onRetry,
  retryLabel = "Try again",
  secondaryAction,
  title,
  variant,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> &
  VariantProps<typeof errorCardVariants> & {
    /** Defaults to `h2`; pass `h1` for a page-level card with no other
     * top-level heading (e.g. the essay editor's not-found state). */
    headingLevel?: "h1" | "h2";
    message: string;
    onRetry: () => void;
    retryLabel?: string;
    /** An additional action rendered after the retry button, e.g. a "Back
     * to {list}" link. */
    secondaryAction?: React.ReactNode;
    title: string;
  }): React.ReactElement {
  return (
    <div
      className={cn(errorCardVariants({ variant }), className)}
      data-slot="error-card"
      {...props}
    >
      <div className="flex max-w-md flex-col gap-3">
        <HeadingTag
          className="font-heading text-lg font-medium"
          data-slot="error-card-title"
        >
          {title}
        </HeadingTag>
        <p
          className="text-sm text-muted-foreground"
          data-slot="error-card-description"
        >
          {message}
        </p>
        <div className="flex gap-2" data-slot="error-card-actions">
          <Button onClick={onRetry}>{retryLabel}</Button>
          {secondaryAction}
        </div>
      </div>
    </div>
  );
}
