/* eslint-disable react-refresh/only-export-components -- shared value/field
 * formatters (formatValue, formatWordBudget) and the ChangeList component are
 * deliberately co-located and reused by every bespoke family widget, exactly
 * like src/components/ui/badge.tsx's badgeVariants + Badge. */
import type React from "react";

import type {
  MutationChange,
  MutationItem,
  MutationValue,
  WorkspaceMutationReceipt,
} from "@/api/chat/types";
import { cn } from "@/lib/utils";

/**
 * The shared "Inspect" body renderer (plan §4.2, §12.2) — one generic,
 * typed-field-only renderer that covers every body kind. Family-specific
 * widgets (currently: tasks) may render bespoke anatomy instead; every other
 * family routes through this until its own bespoke widget is written. This
 * never infers meaning from backend-written English — every value here is a
 * typed field the backend classified explicitly.
 */

/** Shared by the generic renderer and the bespoke essay/essay-content
 * widgets — one word-budget formatting rule everywhere (§9.3, §9.4). */
export function formatWordBudget(used: number, limit: number | null | undefined): string {
  if (limit === null || limit === undefined) return `${used.toLocaleString()} words`;
  const remaining = limit - used;
  return remaining >= 0
    ? `${used.toLocaleString()} / ${limit.toLocaleString()} words — ${remaining.toLocaleString()} remaining`
    : `${used.toLocaleString()} / ${limit.toLocaleString()} words — ${Math.abs(remaining).toLocaleString()} over`;
}

/** Shared value formatter — reused by bespoke family widgets (e.g. Profile,
 * Honor) so there is exactly one `MutationValue` → display-string mapping. */
export function formatValue(value: MutationValue | null | undefined): string {
  if (value === null || value === undefined) return "—";
  switch (value.kind) {
    case "text":
      return value.text?.text ?? "—";
    case "enum":
      return value.enum ?? "—";
    case "enum_list":
    case "text_list":
      return (value.list_items ?? []).join(", ");
    case "reference":
      return value.reference?.title.text ?? "—";
    case "reference_list":
      return (value.reference_list ?? []).map((ref) => ref.title.text).join(", ");
    case "date":
      return value.date
        ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
            new Date(`${value.date}T00:00:00`),
          )
        : "—";
    case "datetime":
      return value.datetime ?? "—";
    case "integer":
      return value.integer?.toLocaleString() ?? "—";
    case "decimal":
      return value.decimal ?? "—";
    case "boolean":
      return value.boolean ? "Yes" : "No";
    case "count":
      return value.count?.toLocaleString() ?? "—";
    case "word_budget":
      return formatWordBudget(value.word_budget_used ?? 0, value.word_budget_limit);
    default:
      return "—";
  }
}

function fieldLabel(fieldKey: string): string {
  return fieldKey
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function ChangeRow({ change }: { change: MutationChange }) {
  const label = fieldLabel(change.field_key);
  let value: React.ReactNode;
  if (change.operation === "clear") {
    value = <span className="text-muted-foreground">Cleared</span>;
  } else if (change.operation === "delete") {
    value = <span className="text-muted-foreground">Removed</span>;
  } else if (change.operation === "state_only") {
    value = <span className="text-muted-foreground">Updated</span>;
  } else if (change.before && change.after) {
    value = (
      <span className="inline-flex items-center gap-1">
        <span className="text-muted-foreground">{formatValue(change.before)}</span>
        <span aria-hidden="true">→</span>
        <span>{formatValue(change.after)}</span>
      </span>
    );
  } else {
    value = formatValue(change.after);
  }
  return (
    <div className="grid grid-cols-[96px_1fr] gap-2">
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-foreground/85">{value}</dd>
    </div>
  );
}

/** Exported so bespoke family widgets (Profile's section groups, Honor's
 * field rows) share this exact field-row rendering instead of a second copy
 * of the `MutationValue` formatting switch drifting out of sync. */
export function ChangeList({ changes }: { changes: MutationChange[] }) {
  return (
    <dl className="grid gap-1.5">
      {changes.map((change, index) => (
        <ChangeRow change={change} key={`${change.field_key}-${index}`} />
      ))}
    </dl>
  );
}

function ItemRow({ item }: { item: MutationItem }) {
  const title = item.subject?.title.text;
  const isProblem = item.disposition === "failed" || item.disposition === "skipped";
  return (
    <li className="flex min-w-0 flex-col gap-0.5 py-1">
      <span className="min-w-0 text-foreground/90">
        {title ?? `Item ${item.input_index + 1}`}
        {isProblem && (
          <span className="ml-1.5 text-xs text-muted-foreground">
            ({item.disposition.replaceAll("_", " ")})
          </span>
        )}
      </span>
      {item.reason && (
        <span className="text-xs text-muted-foreground">{item.reason.text}</span>
      )}
      {item.recovery && (
        <span className="text-xs text-muted-foreground">{item.recovery.text}</span>
      )}
    </li>
  );
}

export function MutationReceiptBody({
  receipt,
}: {
  receipt: WorkspaceMutationReceipt;
}) {
  const { body } = receipt;

  switch (body.kind) {
    case "batch": {
      const changed = body.items.filter((item) => item.disposition === "changed");
      const rest = body.items.filter((item) => item.disposition !== "changed");
      return (
        <div className="grid gap-2">
          {changed.length > 0 && (
            <ul className="grid gap-0.5">
              {changed.map((item) => (
                <ItemRow item={item} key={item.input_index} />
              ))}
            </ul>
          )}
          {rest.length > 0 && (
            <ul className="grid gap-0.5 border-t border-border/50 pt-2">
              {rest.map((item) => (
                <ItemRow item={item} key={item.input_index} />
              ))}
            </ul>
          )}
        </div>
      );
    }
    case "update":
      return <ChangeList changes={body.changes} />;
    case "state_transition":
      return (
        <ul className="grid gap-0.5">
          {body.subjects.map((subject, index) => (
            <li className="text-foreground/90" key={index}>
              {subject.title.text}
            </li>
          ))}
          {body.cascade && (
            <li className="text-xs text-muted-foreground">{body.cascade.message.text}</li>
          )}
        </ul>
      );
    case "duplicate":
      return (
        <dl className="grid gap-1.5">
          <div className="grid grid-cols-[96px_1fr] gap-2">
            <dt className="font-medium text-muted-foreground">Original</dt>
            <dd className="text-foreground/85">{body.source.title.text}</dd>
          </div>
          <div className="grid grid-cols-[96px_1fr] gap-2">
            <dt className="font-medium text-muted-foreground">Copy</dt>
            <dd className="text-foreground/85">{body.copy.title.text}</dd>
          </div>
        </dl>
      );
    case "reorder":
      return (
        <ol className="grid gap-0.5">
          {body.new_order.map((subject, index) => (
            <li className="flex gap-2 text-foreground/90" key={index}>
              <span className="tabular-nums text-muted-foreground">{index + 1}</span>
              <span className="min-w-0">{subject.title.text}</span>
            </li>
          ))}
        </ol>
      );
    case "essay_edit":
      return (
        <div className="grid gap-2">
          <ol className="grid gap-1">
            {body.operations.map((operation, index) => (
              <li className="flex gap-2 text-foreground/90" key={index}>
                <span className="tabular-nums text-muted-foreground">{index + 1}</span>
                <span className="min-w-0">
                  {operation.location.kind === "paragraph_range" &&
                  operation.location.start !== null &&
                  operation.location.start !== undefined
                    ? `Paragraph ${operation.location.start + 1}${
                        operation.location.end !== operation.location.start
                          ? `–${(operation.location.end ?? operation.location.start) + 1}`
                          : ""
                      }`
                    : operation.location.kind === "word_range"
                      ? `Words ${operation.location.start}–${operation.location.end}`
                      : "Location unavailable"}
                  {" · "}
                  {operation.operation === "insert" && "Inserted"}
                  {operation.operation === "delete" && "Deleted"}
                  {operation.operation === "replace" && "Replaced"} {operation.after_words}{" "}
                  words
                </span>
              </li>
            ))}
          </ol>
          <dl className="grid grid-cols-[96px_1fr] gap-2">
            <dt className="font-medium text-muted-foreground">Final length</dt>
            <dd className="text-foreground/85">
              {formatWordBudget(body.final_word_count, body.word_limit)}
            </dd>
          </dl>
        </div>
      );
    case "essay_write":
      return (
        <dl className="grid grid-cols-[96px_1fr] gap-2">
          <dt className="font-medium text-muted-foreground">Final length</dt>
          <dd className="text-foreground/85">
            {formatWordBudget(body.final_word_count, body.word_limit)}
          </dd>
        </dl>
      );
    case "profile":
      return (
        <div className="grid gap-3">
          {body.sections.map((section) => (
            <section key={section.section_key}>
              <h4 className="pb-1 text-xs font-medium text-muted-foreground">
                {section.section_label}
              </h4>
              <ChangeList changes={section.changes} />
            </section>
          ))}
        </div>
      );
    case "memory":
      return (
        <ul className={cn("grid gap-1", body.operation === "forget" && "text-muted-foreground")}>
          {body.operation === "forget" ? (
            <li>You can ask Counselle to remember this information again.</li>
          ) : (
            body.active_notes.map((note, index) => <li key={index}>{note.text}</li>)
          )}
        </ul>
      );
    case "unresolved":
      return (
        <p className="text-muted-foreground">
          This may have completed. Check the workspace before asking Counselle to try
          again.
        </p>
      );
    default:
      return null;
  }
}
