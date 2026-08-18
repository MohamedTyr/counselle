import type { FlagsSummary } from "@/api/cds-admin/types";
import { Button } from "@/components/ui/button";

/** The sticky bottom bar (§5.10), spanning both panes — approve is a
 * decision about the document, not about the data pane. The blocking
 * reason is a sentence here, never a tooltip on a disabled button
 * (§5.1.4/§8). */
export function ApproveBar({
  flagsSummary,
  pendingEditsCount,
  onApprove,
  onApproveAnywayClick,
  approving,
  disabled,
}: {
  flagsSummary: FlagsSummary;
  pendingEditsCount: number;
  onApprove: () => void;
  onApproveAnywayClick: () => void;
  approving: boolean;
  disabled: boolean;
}) {
  const blocked = flagsSummary.unresolved > 0;

  return (
    <div className="flex shrink-0 items-center justify-between gap-4 border-t bg-background px-6 py-3 md:px-10">
      <span className="text-sm">
        {blocked ? (
          <>
            <span className="font-medium tabular-nums">
              {flagsSummary.unresolved}
            </span>{" "}
            unresolved flag{flagsSummary.unresolved === 1 ? "" : "s"} —
            resolve them, or approve anyway
          </>
        ) : pendingEditsCount > 0 ? (
          <>
            Ready to approve ·{" "}
            <span className="font-medium tabular-nums">
              {pendingEditsCount}
            </span>{" "}
            pending edit{pendingEditsCount === 1 ? "" : "s"}
          </>
        ) : (
          "Ready to approve"
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
