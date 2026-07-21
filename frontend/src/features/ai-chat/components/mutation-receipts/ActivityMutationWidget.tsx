import type { WorkspaceMutationReceipt } from "@/api/chat/types";

import { ChangeList, MutationReceiptBody } from "./MutationReceiptBody";

/**
 * Activity-family anatomy (plan §9.5): Common App rank, position/org, time
 * commitment, character budgets, and numbered order. Batch/update/state
 * bodies reuse the shared field-row renderer (they're already typed `<dl>`
 * rows); reorder gets its own numbered-order rendering with the "never
 * infer movement" rule enforced explicitly.
 */
export function ActivityMutationBody({ receipt }: { receipt: WorkspaceMutationReceipt }) {
  const { body } = receipt;

  if (body.kind === "reorder") {
    return (
      <ol className="grid gap-0.5">
        {body.new_order.map((subject, index) => {
          const movedFrom =
            body.moved_index === index &&
            body.moved_from_rank !== null &&
            body.moved_from_rank !== undefined
              ? body.moved_from_rank
              : null;
          return (
            <li className="flex gap-2 text-foreground/90" key={index}>
              <span className="tabular-nums text-muted-foreground">{index + 1}</span>
              <span className="min-w-0">
                {subject.title.text}
                {movedFrom !== null && (
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    (moved #{movedFrom} → #{index + 1})
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    );
  }

  if (body.kind === "update") {
    return <ChangeList changes={body.changes} />;
  }

  return <MutationReceiptBody receipt={receipt} />;
}
