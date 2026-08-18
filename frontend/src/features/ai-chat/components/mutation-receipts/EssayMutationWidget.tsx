import { FilePenLineIcon } from "lucide-react";

import type { WorkspaceMutationReceipt } from "@/api/chat/types";

import { MutationReceiptBody } from "./MutationReceiptBody";

/**
 * Essay-object anatomy (plan §9.3): document metadata under a document
 * heading, and explicit source → copy roles for duplicates. Prompt
 * contents never appear. Archive has no item deep link — the active
 * essay route may not resolve an archived item, so none is fabricated
 * here.
 */

function DocumentHeading({ title }: { title: string }) {
  return (
    <p className="mb-2 flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <FilePenLineIcon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{title}</span>
    </p>
  );
}

export function EssayMutationBody({ receipt }: { receipt: WorkspaceMutationReceipt }) {
  const { body } = receipt;

  if (body.kind === "duplicate") {
    return (
      <dl className="grid gap-1.5">
        <div className="grid grid-cols-[96px_1fr] gap-2">
          <dt className="font-medium text-muted-foreground">Original</dt>
          <dd className="text-[var(--ink-secondary)]">{body.source.title.text}</dd>
        </div>
        <div className="grid grid-cols-[96px_1fr] gap-2">
          <dt className="font-medium text-muted-foreground">Copy</dt>
          <dd className="text-[var(--ink-secondary)]">{body.copy.title.text}</dd>
        </div>
      </dl>
    );
  }

  if (body.kind === "update") {
    return (
      <div>
        <DocumentHeading title={body.subject.title.text} />
        <MutationReceiptBody receipt={receipt} />
      </div>
    );
  }

  // batch create/archive and restore already read cleanly through the
  // shared generic renderer's `<ul>` per-item semantics — the distinct
  // anatomy this family needs is the document heading (update) and the
  // duplicate source/copy roles above.
  return <MutationReceiptBody receipt={receipt} />;
}
