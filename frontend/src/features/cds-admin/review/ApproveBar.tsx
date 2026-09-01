import type { FlagsSummary } from "@/api/cds-admin/types";
import { Button } from "@/components/ui/button";

/** The sticky bottom bar (§5.10), spanning both panes — approve is a
 * decision about the document, not about the data pane. The blocking
 * reason is a sentence here, never a tooltip on a disabled button
 * (§5.1.4/§8). */
export function ApproveBar({
  flagsSummary,
  pendingEditsCount,
  toReview,
  onApprove,
  onApproveAnywayClick,
  approving,
  disabled,
}: {
  flagsSummary: FlagsSummary;
  pendingEditsCount: number;
  /** Flagged metrics with no pending edit — what the right pane counts. Not
   * `flagsSummary.unresolved`, which is only the Approve-blocking subset. */
  toReview: number;
  onApprove: () => void;
  onApproveAnywayClick: () => void;
  approving: boolean;
  disabled: boolean;
}) {
  // "blocking", not "unresolved": `flags_summary.unresolved` counts only
  // `error`-severity flags, deliberately, so a warning never blocks Approve
  // (`service_review._flags_summary`, flag-precision.md). The right pane
  // separately reports everything still *to review*, warnings included — two
  // different questions, so they get two different words rather than one word
  // with two meanings on the same screen.
  const blocked = flagsSummary.unresolved > 0;

  return (
    <div className="flex shrink-0 items-center justify-between gap-4 border-t bg-background px-6 py-3 md:px-10">
      <span className="text-sm">
        {blocked ? (
          <>
            <span className="font-medium tabular-nums">
              {flagsSummary.unresolved}
            </span>{" "}
            blocking flag{flagsSummary.unresolved === 1 ? "" : "s"} — resolve
            them, or approve anyway
          </>
        ) : (
          <>
            Ready to approve
            {pendingEditsCount > 0 && (
              <>
                {" · "}
                <span className="font-medium tabular-nums">
                  {pendingEditsCount}
                </span>{" "}
                pending edit{pendingEditsCount === 1 ? "" : "s"}
              </>
            )}
            {/* Say what's still unlooked-at even though it doesn't block.
                "Ready to approve" on its own, beside a panel listing 18
                "possible hallucinated page citation" warnings, is true but
                reads as an all-clear — and this bar is the last thing an
                admin sees before the data reaches a student.
                "metrics", not a bare number: `toReview` counts flagged
                metrics (`ReviewPanel.tsx`'s `flagQueueLength`), and the
                sentence right above this one counts *flags* ("N blocking
                flags") — an unlabeled "N to review" beside that reads as
                the same unit when it isn't. */}
            {toReview > 0 && (
              <>
                {" · "}
                <span className="font-medium tabular-nums">{toReview}</span>{" "}
                metric{toReview === 1 ? "" : "s"} to review
              </>
            )}
          </>
        )}
      </span>
      <div className="flex items-center gap-2">
        {blocked && (
          <Button
            disabled={disabled}
            onClick={onApproveAnywayClick}
            size="sm"
            variant="outline"
          >
            Approve anyway
          </Button>
        )}
        <Button
          aria-keyshortcuts="Meta+Enter"
          disabled={blocked || disabled}
          loading={approving}
          onClick={onApprove}
          size="sm"
        >
          Approve
        </Button>
      </div>
    </div>
  );
}
