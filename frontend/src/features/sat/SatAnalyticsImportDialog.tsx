/** The import-progress confirm, split out of `SatAnalytics.tsx` (plan
 * §5.2's 400-line cap). See `SatAnalyticsConfirmDialog.tsx` for why its
 * shell is `ConfirmDialogContent` and not the shared `DialogContent`.
 */
import type React from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SAT_ANALYTICS_COPY } from "@/features/sat/sat-copy";
import { ConfirmDialogContent } from "@/features/sat/SatAnalyticsConfirmDialog";

export interface SatImportConfirmDialogProps {
  open: boolean;
  isPending: boolean;
  totalAttempts: number;
  totalBookmarks: number;
  fileName: string;
  onOpenChange: (next: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function SatImportConfirmDialog({
  open,
  isPending,
  totalAttempts,
  totalBookmarks,
  fileName,
  onOpenChange,
  onCancel,
  onConfirm,
}: SatImportConfirmDialogProps): React.ReactElement {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <ConfirmDialogContent
        onEscapeKeyDown={(event) => {
          if (isPending) {
            event.preventDefault();
            return;
          }
          // See the reset confirm — still needed for the mobile Sheet's
          // independent Escape handling.
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
          <DialogTitle>{SAT_ANALYTICS_COPY.footer.importConfirm.title}</DialogTitle>
          <DialogDescription>
            {SAT_ANALYTICS_COPY.footer.importConfirm.description(
              totalAttempts,
              totalBookmarks,
              fileName,
            )}
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
            {SAT_ANALYTICS_COPY.footer.importConfirm.cancel}
          </Button>
          <Button loading={isPending} onClick={onConfirm}>
            {SAT_ANALYTICS_COPY.footer.importConfirm.confirm}
          </Button>
        </DialogFooter>
      </ConfirmDialogContent>
    </Dialog>
  );
}
