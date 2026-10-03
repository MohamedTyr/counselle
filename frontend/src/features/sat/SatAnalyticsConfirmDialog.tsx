/**
 * The reset/import confirms render through `DialogPortal`, which (like every
 * Radix portal) always teleports to `document.body` regardless of where it
 * sits in the React tree — so simply nesting the confirm's JSX inside the
 * shell's own `DialogContent` would NOT make it a DOM descendant of the
 * shell, and wouldn't fix anything on its own. What makes Radix treat a
 * portaled dialog as "part of" an outer one is `DismissableLayer.Branch`: a
 * plain marker div, registered into Radix's (module-global) dismissable-layer
 * context, that any outside-interaction check (`onPointerDownOutside`,
 * `onFocusOutside`) treats as "inside" for every currently-mounted Radix
 * dismissable layer — including the shell's. This local variant wraps the
 * *whole* `DialogPrimitive.Content` in one `Branch`, mirroring
 * `DialogContent`'s own markup/classes (minus its ✕ — a confirm closes
 * through Cancel only), since `DialogContent` doesn't expose a way to inject
 * a wrapper around itself.
 *
 * That branch check alone is not sufficient, though: Radix's own
 * `usePointerDownOutside` defers a click's outside-check to the browser's
 * *next* `click` event so text selection isn't misread as a dismiss. Cancel
 * both (a) flips this dialog's own `open` to `false` and (b) fires a
 * *native* click that keeps bubbling to `document` — and because this
 * dialog's `Presence`-driven exit here runs with no detected CSS animation
 * (`getComputedStyle(...).animationName === "none"`, which is what a
 * reduced-motion / low-power browser reports), (a) unmounts this dialog,
 * *including its Branch's cleanup effect*, synchronously, in the same tick,
 * before that native click reaches `document`. So by the time the shell's
 * deferred check runs, the branch that would have exempted it is already
 * gone — Branch fixes this whenever the exit is actually animated, but not
 * reliably. `stopPropagation()` on Cancel's own click (below) is what
 * makes this deterministic instead of animation-timing-dependent: it keeps
 * the native click from ever reaching `document`, so Radix's own
 * interception bookkeeping (`wasOutsideInteractionIntercepted`, keyed off
 * whether the click's document-level listener actually fired) reports it as
 * intercepted and the shell's outside-check is never dispatched at all.
 */
import { Dialog as DialogPrimitive } from "radix-ui";
import { DismissableLayer } from "radix-ui/internal";
import type React from "react";

import { DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function ConfirmDialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>): React.ReactElement {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DismissableLayer.Branch className="contents">
        <DialogPrimitive.Content
          data-slot="dialog-content"
          className={cn(
            "fixed top-1/2 left-1/2 z-[var(--z-modal)] grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground border border-[var(--hairline)] shadow-[var(--elevation-3)] duration-150 outline-none motion-reduce:animate-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        >
          {children}
        </DialogPrimitive.Content>
      </DismissableLayer.Branch>
    </DialogPortal>
  );
}
