import { Check, Undo2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { Button } from "@/components/ui/button";

export type UndoToastPending = {
  kind?: string;
  label?: string;
} | null;

/**
 * `kind` doubles as the verb ("deleted", "completed", "rescheduled" — plans/
 * tasks-redesign-plan.md P7.5's `useUndoableAction`); every existing caller
 * (`useUndoableDelete`) never sets it, so it defaults to "deleted" and every
 * pre-existing toast reads exactly as before.
 */
function pendingCopy(pending: UndoToastPending) {
  if (!pending) {
    return "";
  }
  return `${pending.label ?? "Item"} ${pending.kind ?? "deleted"}`;
}

export function UndoToast({
  onDismiss,
  onUndo,
  pending,
  reduceMotion,
}: {
  onDismiss: () => void;
  onUndo: () => void;
  pending: UndoToastPending;
  reduceMotion: boolean;
}) {
  return (
    <AnimatePresence>
      {pending ? (
        <motion.div
          animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
          className="pointer-events-none fixed inset-x-0 bottom-6 z-[var(--z-toast)] flex justify-center px-4"
          exit={reduceMotion ? undefined : { opacity: 0, y: 12 }}
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          <div
            className="pointer-events-auto flex items-center gap-3 rounded-xl border bg-popover px-4 py-2.5 text-sm text-popover-foreground shadow-lg"
            role="status"
          >
            <span>{pendingCopy(pending)}</span>
            <Button
              className="h-7"
              onClick={onUndo}
              size="sm"
              type="button"
              variant="outline"
            >
              <Undo2 aria-hidden="true" data-icon="inline-start" />
              Undo
            </Button>
            <Button
              aria-label="Dismiss"
              className="size-7 text-muted-foreground"
              onClick={onDismiss}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <Check aria-hidden="true" />
            </Button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
