import type { MutationChange, WorkspaceMutationReceipt } from "@/api/chat/types";
import { Badge } from "@/components/ui/badge";

import { ChangeList, MutationReceiptBody } from "./MutationReceiptBody";

/**
 * Honor-family anatomy (plan §9.6): rank, recognition-level badges, grade
 * chips, and the Common App 100-character title budget. `recognition_level`
 * and `grades` get chip/badge treatment; everything else falls back to the
 * shared typed field-row renderer.
 */

const CHIP_FIELD_KEYS = new Set(["recognition_level", "grades"]);

function chipValues(change: MutationChange): string[] {
  const value = change.after ?? change.before;
  if (!value) return [];
  if (value.kind === "enum") return value.enum ? [value.enum] : [];
  if (value.kind === "enum_list" || value.kind === "text_list") return value.list_items ?? [];
  return [];
}

function ChipRow({ change }: { change: MutationChange }) {
  const values = chipValues(change);
  if (values.length === 0) return null;
  return (
    <div className="grid grid-cols-[96px_1fr] items-center gap-2">
      <dt className="font-medium text-muted-foreground">
        {change.field_key === "recognition_level" ? "Recognition" : "Grades"}
      </dt>
      <dd className="flex flex-wrap gap-1">
        {values.map((value) => (
          <Badge key={value} size="sm" variant="secondary">
            {value}
          </Badge>
        ))}
      </dd>
    </div>
  );
}

function TitleBudgetRow({ change }: { change: MutationChange }) {
  const after = change.after;
  if (!after || after.kind !== "text" || !after.text) return null;
  const graphemes = after.text.original_graphemes ?? after.text.text.length;
  return (
    <div className="grid grid-cols-[96px_1fr] gap-2">
      <dt className="font-medium text-muted-foreground">Title</dt>
      <dd className="text-foreground/85">{graphemes} / 100 characters</dd>
    </div>
  );
}

export function HonorMutationBody({ receipt }: { receipt: WorkspaceMutationReceipt }) {
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
    const chipChanges = body.changes.filter((change) => CHIP_FIELD_KEYS.has(change.field_key));
    const titleChange = body.changes.find((change) => change.field_key === "title");
    const restChanges = body.changes.filter(
      (change) => !CHIP_FIELD_KEYS.has(change.field_key) && change.field_key !== "title",
    );
    return (
      <dl className="grid gap-1.5">
        {chipChanges.map((change, index) => (
          <ChipRow change={change} key={`${change.field_key}-${index}`} />
        ))}
        {titleChange && <TitleBudgetRow change={titleChange} />}
        {restChanges.length > 0 && <ChangeList changes={restChanges} />}
      </dl>
    );
  }

  return <MutationReceiptBody receipt={receipt} />;
}

