import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

/** The Reject confirmation (§5.10) — a required reason, a destructive
 * confirm. On success the page navigates back to coverage. */
export function RejectDialog({
  open,
  onOpenChange,
  onConfirm,
  confirming,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  confirming: boolean;
}) {
  const [reason, setReason] = useState("");
  const empty = reason.trim().length === 0;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject this document?</DialogTitle>
        </DialogHeader>
        <Textarea
          aria-label="Rejection reason"
          autoFocus
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why is this document being rejected?"
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
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
