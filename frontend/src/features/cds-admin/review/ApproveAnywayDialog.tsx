import { useState } from "react";

import type { DocumentReviewOut } from "@/api/cds-admin/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { FlagChip } from "@/features/cds-admin/cds-status";
import { buildFlagQueue, hiddenUnresolvedCount } from "@/features/cds-admin/review/flag-queue";
import { useReviewControllerContext } from "@/features/cds-admin/review/review-context";

/** "Approve with N unresolved flags?" (§5.10) — the flag list doubles as an
 * escape hatch back to doing it properly: each row closes the dialog and
 * jumps straight to that metric. */
export function ApproveAnywayDialog({
  open,
  onOpenChange,
  review,
  onConfirm,
  confirming,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  review: DocumentReviewOut;
  onConfirm: (note: string) => void;
  confirming: boolean;
}) {
  const controller = useReviewControllerContext();
  const [acknowledged, setAcknowledged] = useState(false);
  const [note, setNote] = useState("");
  const flagged = buildFlagQueue(review.sections, false);
  const hidden = hiddenUnresolvedCount(review.sections, review.flags_summary);
  const count = review.flags_summary.unresolved;

  function jumpTo(ref: string, page: number | null | undefined) {
    onOpenChange(false);
    controller.focusMetric(ref);
    controller.jumpEvidence(page);
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approve with {count} unresolved flags?</DialogTitle>
          <DialogDescription>
            These flags will stay on record as overridden, not resolved.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-48 space-y-1.5 overflow-y-auto">
          {flagged.map((metric) =>
            metric.flags.map((flag) => (
              <li key={flag.code + metric.ref}>
                <button
                  className="flex w-full items-start gap-2 rounded-sm px-1 py-1 text-left text-xs outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                  onClick={() => jumpTo(metric.ref, metric.evidence?.page_number)}
                  type="button"
                >
                  <FlagChip code={flag.code} severity={flag.severity} />
                  <span className="text-muted-foreground">{flag.message}</span>
                </button>
              </li>
            )),
          )}
          {hidden > 0 && (
            <li className="px-1 text-xs text-muted-foreground">
              {hidden} more not shown here.
            </li>
          )}
        </ul>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={acknowledged}
            className="mt-0.5"
            onCheckedChange={(checked) => setAcknowledged(checked === true)}
          />
          I've checked these against the document.
        </label>
        <Textarea
          aria-label="Approval note"
          onChange={(event) => setNote(event.target.value)}
          placeholder="Note (optional)"
          rows={2}
          value={note}
        />
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} variant="ghost">
            Cancel
          </Button>
          <Button
            disabled={!acknowledged}
            loading={confirming}
            onClick={() => onConfirm(note)}
            variant="destructive"
          >
            Approve with {count} unresolved flags
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
