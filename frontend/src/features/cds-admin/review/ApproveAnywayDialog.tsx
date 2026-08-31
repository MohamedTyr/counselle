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

/** "Approve with N blocking flags?" (§5.10) — the flag list doubles as an
 * escape hatch back to doing it properly: each row closes the dialog and
 * jumps straight to that metric.
 *
 * `ownEditConflictMessage` covers the other 409 `approve_document` can raise
 * (`app/cds/service_review_approve.py::_prepare_edited_packets`): the
 * admin's own pending edit would introduce a blocking flag on a packet that
 * was refused before it was ever written. `review.flags_summary`/
 * `buildFlagQueue` describe only the document's already-*stored* flags, so
 * they read `0`/empty here and would otherwise show a dialog that lies about
 * what it's asking the admin to override. When set, this renders the
 * server's own message in place of the flag list — nothing invented — and
 * keeps the same acknowledge-and-note friction (never a one-click override)
 * so this case isn't easier to wave through than a stored flag is. */
export function ApproveAnywayDialog({
  open,
  onOpenChange,
  review,
  onConfirm,
  confirming,
  ownEditConflictMessage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  review: DocumentReviewOut;
  onConfirm: (note: string) => void;
  confirming: boolean;
  ownEditConflictMessage?: string;
}) {
  const controller = useReviewControllerContext();
  const [acknowledged, setAcknowledged] = useState(false);
  const [note, setNote] = useState("");
  const flagged = buildFlagQueue(review.sections, false);
  const hidden = hiddenUnresolvedCount(review.sections, review.flags_summary);
  const count = review.flags_summary.unresolved;
  const isOwnEditConflict = ownEditConflictMessage !== undefined;

  function jumpTo(ref: string, page: number | null | undefined) {
    onOpenChange(false);
    controller.focusMetric(ref);
    controller.jumpEvidence(page);
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isOwnEditConflict
              ? "Approve despite this edit's validation failure?"
              : `Approve with ${count} blocking flags?`}
          </DialogTitle>
          <DialogDescription>
            {isOwnEditConflict
              ? "This edit will still be recorded as overridden, not resolved."
              : "These flags will stay on record as overridden, not resolved."}
          </DialogDescription>
        </DialogHeader>
        {isOwnEditConflict ? (
          <p className="rounded-md border bg-muted/50 p-3 text-xs text-muted-foreground">
            {ownEditConflictMessage}
          </p>
        ) : (
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
        )}
        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={acknowledged}
            className="mt-0.5"
            onCheckedChange={(checked) => setAcknowledged(checked === true)}
          />
          I've checked th{isOwnEditConflict ? "is" : "ese"} against the
          document.
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
            {isOwnEditConflict ? "Approve anyway" : `Approve with ${count} blocking flags`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
