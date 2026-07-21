import type { MutationItem, WorkspaceMutationReceipt } from "@/api/chat/types";
import { Badge } from "@/components/ui/badge";

import { MutationReceiptBody } from "./MutationReceiptBody";

/**
 * School-family anatomy (plan §9.2): application-stage strip with list
 * type, round, deadline, intended major, and cascade notice. Archive/
 * restore copy never implies permanent deletion — "Removed from your
 * list", not "deleted".
 */

function SchoolRow({ item }: { item: MutationItem }) {
  const title = item.subject?.title.text;
  const isProblem = item.disposition !== "changed";
  return (
    <li className="flex min-w-0 flex-col gap-0.5 py-1">
      <span className="flex min-w-0 items-center gap-1.5 text-foreground/90">
        <span className="min-w-0 truncate">
          {title ?? `School ${item.input_index + 1}`}
        </span>
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

export function SchoolMutationBody({ receipt }: { receipt: WorkspaceMutationReceipt }) {
  const { body } = receipt;

  if (body.kind === "batch") {
    const added = body.items.filter((item) => item.disposition === "changed");
    const skipped = body.items.filter((item) => item.disposition !== "changed");
    return (
      <div className="grid gap-2.5">
        {added.length > 0 && (
          <section>
            <h4 className="pb-1 text-xs font-medium text-muted-foreground">Added</h4>
            <ul className="grid gap-0.5">
              {added.map((item) => (
                <SchoolRow item={item} key={item.input_index} />
              ))}
            </ul>
          </section>
        )}
        {skipped.length > 0 && (
          <section>
            <h4 className="pb-1 text-xs font-medium text-muted-foreground">Skipped</h4>
            <ul className="grid gap-0.5">
              {skipped.map((item) => (
                <SchoolRow item={item} key={item.input_index} />
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  }

  if (body.kind === "state_transition") {
    return (
      <div className="grid gap-1.5">
        <ul className="grid gap-0.5">
          {body.subjects.map((subject, index) => (
            <li className="text-foreground/90" key={index}>
              {subject.title.text}
            </li>
          ))}
        </ul>
        {body.cascade && (
          <p className="text-xs text-muted-foreground">{body.cascade.message.text}</p>
        )}
      </div>
    );
  }

  // "update" (typed status/round/deadline/major field changes) and any
  // future body kind for this family render through the shared generic
  // typed-field renderer — the application-stage strip is a batch/state
  // concern above; field-level diffs already read cleanly as `<dl>` rows.
  return <MutationReceiptBody receipt={receipt} />;
}
