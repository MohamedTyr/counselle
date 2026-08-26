import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

/** The Reject confirmation (§5.10) — a required reason, a destructive
 * confirm. On success the page navigates back to coverage.
 *
 * `isCorrection` distinguishes rejecting a candidate document (which stops
 * it from ever going live) from discarding a pending `active_update`
 * correction against an already-active document (SHIP-PLAN §2.3/§2.4) —
 * the document keeps serving its prior, already-approved data unchanged.
 * Saying "reject this document" in the latter case would misstate what the
 * action does, which the design system's honesty laws forbid. */
export function RejectDialog({
  open,
  onOpenChange,
  onConfirm,
  confirming,
  isCorrection = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  confirming: boolean;
  isCorrection?: boolean;
}) {
  const [reason, setReason] = useState("");
  const empty = reason.trim().length === 0;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isCorrection ? "Discard this correction?" : "Reject this document?"}
          </DialogTitle>
          {isCorrection && (
            <DialogDescription>
              The document stays active and keeps serving its current data
              unchanged — only the pending correction is discarded.
            </DialogDescription>
          )}
        </DialogHeader>
        <Textarea
          aria-label={isCorrection ? "Reason for discarding" : "Rejection reason"}
          autoFocus
          onChange={(event) => setReason(event.target.value)}
          placeholder={
            isCorrection
              ? "Why is this correction being discarded?"
              : "Why is this document being rejected?"
          }
          rows={3}
          value={reason}
        />
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="ghost">
            Cancel
          </Button>
          <Button
            disabled={empty}
            loading={confirming}
            onClick={() => onConfirm(reason)}
            variant="destructive"
          >
            {isCorrection ? "Discard" : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
