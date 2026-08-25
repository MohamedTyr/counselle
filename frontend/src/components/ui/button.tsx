/* eslint-disable react-refresh/only-export-components */
"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";

export const buttonVariants = cva(
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border text-base font-medium whitespace-nowrap transition-[background-color,border-color,box-shadow,color] duration-150 ease-out outline-none motion-reduce:transition-none before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 data-loading:text-transparent data-loading:select-none sm:text-sm pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 [&_svg]:pointer-events-none [&_svg]:-mx-0.5 [&_svg]:shrink-0 [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-9 px-[calc(--spacing(3)-1px)] sm:h-8",
        icon: "size-9 sm:size-8",
        "icon-lg": "size-10 sm:size-9",
        "icon-sm": "size-8 sm:size-7",
        "icon-xl":
          "size-11 sm:size-10 [&_svg:not([class*='size-'])]:size-5 sm:[&_svg:not([class*='size-'])]:size-4.5",
        "icon-xs":
          "size-7 rounded-md before:rounded-[calc(var(--radius-md)-1px)] sm:size-6 not-in-data-[slot=input-group]:[&_svg:not([class*='size-'])]:size-4 sm:not-in-data-[slot=input-group]:[&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 px-[calc(--spacing(3.5)-1px)] sm:h-9",
        sm: "h-8 gap-1.5 px-[calc(--spacing(2.5)-1px)] sm:h-7",
        xl: "h-11 px-[calc(--spacing(4)-1px)] text-lg sm:h-10 sm:text-base [&_svg:not([class*='size-'])]:size-5 sm:[&_svg:not([class*='size-'])]:size-4.5",
        xs: "h-7 gap-1 rounded-md px-[calc(--spacing(2)-1px)] text-sm before:rounded-[calc(var(--radius-md)-1px)] sm:h-6 sm:text-xs [&_svg:not([class*='size-'])]:size-4 sm:[&_svg:not([class*='size-'])]:size-3.5",
      },
      variant: {
        default:
          "border-[var(--brand-edge)] bg-primary text-primary-foreground shadow-[var(--elevation-cta)] not-disabled:not-active:not-data-pressed:before:shadow-[inset_0_1px_0_--theme(--color-white/20%),inset_0_-1px_0_--theme(--color-black/14%)] hover:border-[var(--brand-edge-hover)] hover:bg-[var(--brand-hover)] hover:shadow-[var(--elevation-cta-hover)] data-pressed:border-[var(--brand-edge-active)] data-pressed:bg-[var(--brand-active)] *:data-[slot=button-loading-indicator]:text-primary-foreground [:active,[data-pressed]]:before:shadow-[inset_0_1px_2px_--theme(--color-black/22%)] disabled:border-[var(--edge-button)] disabled:bg-[var(--control-track)] disabled:text-[var(--ink-muted)] [:disabled,:active,[data-pressed]]:shadow-none",
        destructive:
          "border-[var(--danger-edge)] bg-destructive text-[var(--on-brand)] shadow-[var(--elevation-1)] not-disabled:not-active:not-data-pressed:before:shadow-[inset_0_1px_0_--theme(--color-white/20%),inset_0_-1px_0_--theme(--color-black/14%)] hover:border-[var(--danger-edge-hover)] hover:bg-[var(--danger-solid-hover)] data-pressed:border-[var(--danger-edge-hover)] data-pressed:bg-[var(--danger-solid-active)] *:data-[slot=button-loading-indicator]:text-[var(--on-brand)] [:active,[data-pressed]]:before:shadow-[inset_0_1px_2px_--theme(--color-black/22%)] disabled:border-[var(--edge-button)] disabled:bg-[var(--control-track)] disabled:text-[var(--ink-muted)] [:disabled,:active,[data-pressed]]:shadow-none",
        "destructive-outline":
          "border-[var(--edge-button)] bg-[var(--surface-raised)] text-destructive-foreground shadow-[var(--elevation-1)] bg-clip-padding hover:border-[var(--danger-border)] hover:bg-[var(--danger-surface)] data-pressed:border-[var(--danger-border)] data-pressed:bg-[var(--danger-surface)] *:data-[slot=button-loading-indicator]:text-foreground [:disabled,:active,[data-pressed]]:shadow-none",
        ghost:
          "border-transparent text-foreground hover:bg-accent data-pressed:bg-[var(--surface-active)] *:data-[slot=button-loading-indicator]:text-foreground",
        link: "border-transparent text-foreground underline-offset-4 hover:underline data-pressed:underline *:data-[slot=button-loading-indicator]:text-foreground",
        outline:
          "border-[var(--edge-button)] bg-[var(--surface-raised)] text-foreground shadow-[var(--elevation-1)] bg-clip-padding hover:border-[var(--edge-button-strong)] hover:bg-[var(--surface-button-hover)] data-pressed:border-[var(--edge-button-strong)] data-pressed:bg-[var(--surface-button-active)] *:data-[slot=button-loading-indicator]:text-foreground [:disabled,:active,[data-pressed]]:shadow-none",
        secondary:
          "border-transparent bg-[var(--control-quiet-surface)] text-secondary-foreground hover:bg-[var(--control-quiet-hover)] data-pressed:bg-[var(--control-quiet-active)] *:data-[slot=button-loading-indicator]:text-secondary-foreground",
      },
    },
  },
);

export interface ButtonProps extends useRender.ComponentProps<"button"> {
  variant?: VariantProps<typeof buttonVariants>["variant"];
  size?: VariantProps<typeof buttonVariants>["size"];
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  render,
  children,
  loading = false,
  disabled: disabledProp,
  ...props
}: ButtonProps): React.ReactElement {
  const isDisabled: boolean = Boolean(loading || disabledProp);
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] =
    render ? undefined : "button";

  const defaultProps = {
    children: (
      <>
        {children}
        {loading && (
          <Spinner
            className="pointer-events-none absolute"
            data-slot="button-loading-indicator"
          />
        )}
      </>
    ),
    className: cn(buttonVariants({ className, size, variant })),
    "aria-disabled": loading || undefined,
    "data-loading": loading ? "" : undefined,
    "data-slot": "button",
    disabled: isDisabled,
    type: typeValue,
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
}
