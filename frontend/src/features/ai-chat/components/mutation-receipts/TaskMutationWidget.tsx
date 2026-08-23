import type { MutationItem, WorkspaceMutationReceipt } from "@/api/chat/types";
import { Badge } from "@/components/ui/badge";

import { MutationReceiptBody } from "./MutationReceiptBody";

/**
 * Task-family anatomy (plan §9.1): batch create/archive accounting and
 * restored-state listing get task-specific rows; field-level changes
 * (status/due/priority/links) already read cleanly as typed `<dl>` rows via
 * the shared generic renderer, so "update" delegates there.
 */

function TaskRow({ item }: { item: MutationItem }) {
  const title = item.subject?.title.text;
  const isProblem = item.disposition !== "changed";
  return (
    <li className="flex min-w-0 flex-col gap-0.5 py-1">
      <span className="flex min-w-0 items-center gap-1.5 text-[var(--ink-secondary)]">
        <span className="min-w-0 truncate">{title ?? `Task ${item.input_index + 1}`}</span>
        {isProblem && (
          <Badge size="sm" variant="secondary">
            {item.disposition.replaceAll("_", " ")}
          </Badge>
        )}
      </span>
      {item.reason && (
        <span className="text-xs text-muted-foreground">{item.reason.text}</span>
      )}
    </li>
  );
}

export function TaskMutationBody({ receipt }: { receipt: WorkspaceMutationReceipt }) {
  const { body } = receipt;

  if (body.kind === "batch") {
    const changed = body.items.filter((item) => item.disposition === "changed");
    const rest = body.items.filter((item) => item.disposition !== "changed");
    return (
      <div className="grid gap-2.5">
        {changed.length > 0 && (
          <ul className="grid gap-0.5">
            {changed.map((item) => (
              <TaskRow item={item} key={item.input_index} />
            ))}
          </ul>
        )}
        {rest.length > 0 && (
          <ul className="grid gap-0.5 border-t border-[var(--edge)] pt-2">
            {rest.map((item) => (
              <TaskRow item={item} key={item.input_index} />
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (body.kind === "state_transition") {
    return (
      <ul className="grid gap-0.5">
        {body.subjects.map((subject, index) => (
          <li className="text-[var(--ink-secondary)]" key={index}>
            {subject.title.text}
          </li>
        ))}
      </ul>
    );
  }

  return <MutationReceiptBody receipt={receipt} />;
}
