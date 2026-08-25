/* eslint-disable react-refresh/only-export-components */
"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type React from "react";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-1 rounded-sm border border-transparent font-medium whitespace-nowrap transition-shadow outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='size-'])]:size-3.5 sm:[&_svg:not([class*='size-'])]:size-3 [button&,a&]:cursor-pointer [button&,a&]:pointer-coarse:after:absolute [button&,a&]:pointer-coarse:after:size-full [button&,a&]:pointer-coarse:after:min-h-11 [button&,a&]:pointer-coarse:after:min-w-11",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default:
          "h-5.5 min-w-5.5 px-[calc(--spacing(1)-1px)] text-sm sm:h-4.5 sm:min-w-4.5 sm:text-xs",
        lg: "h-6.5 min-w-6.5 px-[calc(--spacing(1.5)-1px)] text-base sm:h-5.5 sm:min-w-5.5 sm:text-sm",
        sm: "h-5 min-w-5 rounded-[.25rem] px-[calc(--spacing(1)-1px)] text-xs sm:h-4 sm:min-w-4 sm:text-[.625rem]",
      },
      /*
       * Every variant resolves through semantic.css and nothing else.
       *
       * It used to resolve through `--task-*-pill-*` — the Tasks feature's
       * private lane tokens — which meant the app-wide badge primitive was
       * owned by one page, and every status pill on Schools, Essays,
       * Activities and Profile took its colour from the task board. That
       * inversion is the structural half of "every screen has its own set
       * of colours"; the variants below are the fix.
       *
       * Three status hues and one label chip, which is the whole palette:
       *   success  done · complete · submitted · ready
       *   warning  waiting on someone · not ready · needs you
       *   error    overdue · rejected · destructive
       *   default / secondary  everything else — the neutral label chip
       *
       * There is no `info` variant. The blue it drew was applied to a task
       * that is `doing` and a school you are `Applying` to, i.e. the
       * ordinary state of a record, and colouring the ordinary state is
       * what left the three real signals with nothing to say.
       */
      variant: {
        default:
          "border-[color:var(--label-border)] bg-[color:var(--label-surface)] text-[color:var(--label-ink)]",
        destructive: "bg-[var(--danger-surface)] text-[var(--danger-fg)]",
        error: "bg-[var(--danger-surface)] text-[var(--danger-fg)]",
        outline:
          "border-input bg-background text-foreground [button&,a&]:hover:bg-[var(--surface-selected)]",
        secondary:
          "border-[color:var(--label-border)] bg-[color:var(--label-surface)] text-[color:var(--label-ink)]",
        success: "bg-[var(--success-surface)] text-[var(--success-fg)]",
        warning: "bg-[var(--warning-surface)] text-[var(--warning-fg)]",
      },
    },
  },
);

export interface BadgeProps extends useRender.ComponentProps<"span"> {
  variant?: VariantProps<typeof badgeVariants>["variant"];
  size?: VariantProps<typeof badgeVariants>["size"];
}

export function Badge({
  className,
  variant,
  size,
  render,
  ...props
}: BadgeProps): React.ReactElement {
  const defaultProps = {
    className: cn(badgeVariants({ className, size, variant })),
    "data-slot": "badge",
  };

  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(defaultProps, props),
    render,
  });
}
