/** The reset-progress confirm, split out of `SatAnalytics.tsx` (plan §5.2's
 * 400-line cap). See `SatAnalyticsConfirmDialog.tsx` for why its shell is
 * `ConfirmDialogContent` and not the shared `DialogContent`.
 */
import type React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SAT_ANALYTICS_COPY } from "@/features/sat/sat-analytics-copy";
import { ConfirmDialogContent } from "@/features/sat/SatAnalyticsConfirmDialog";

export interface SatResetConfirmDialogProps {
  open: boolean;
  isPending: boolean;
  totalAttempts: number;
  totalBookmarks: number;
  onOpenChange: (next: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function SatResetConfirmDialog({
  open,
  isPending,
  totalAttempts,
  totalBookmarks,
  onOpenChange,
  onCancel,
  onConfirm,
}: SatResetConfirmDialogProps): React.ReactElement {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <ConfirmDialogContent
        onEscapeKeyDown={(event) => {
          if (isPending) {
            event.preventDefault();
            return;
          }
          // `DismissableLayer.Branch` (see `ConfirmDialogContent`) makes
          // the shell correctly ignore this dialog's own outside
          // interactions, but Escape is still a raw document keydown for
          // the mobile Sheet (Base UI listens independently of Radix's
          // dismissal layering) — stop it from also reaching the shell's
          // own Escape handling there.
          event.stopPropagation();
        }}
        onPointerDownOutside={(event) => {
          if (isPending) {
            event.preventDefault();
            return;
          }
          event.stopPropagation();
        }}
        role="alertdialog"
      >
        <DialogHeader>
          <DialogTitle>{SAT_ANALYTICS_COPY.reset.confirm.title}</DialogTitle>
          <DialogDescription>
            {SAT_ANALYTICS_COPY.reset.confirm.description(totalAttempts, totalBookmarks)}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            disabled={isPending}
            onClick={(event) => {
              event.stopPropagation();
              onCancel();
            }}
            variant="outline"
          >
            {SAT_ANALYTICS_COPY.reset.confirm.cancel}
          </Button>
          <Button loading={isPending} onClick={onConfirm} variant="destructive">
            {SAT_ANALYTICS_COPY.reset.confirm.confirm}
          </Button>
        </DialogFooter>
      </ConfirmDialogContent>
    </Dialog>
  );
}
