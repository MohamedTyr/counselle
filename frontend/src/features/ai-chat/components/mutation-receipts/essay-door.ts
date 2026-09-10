import type { WorkspaceMutationReceipt } from "@/api/chat/types";

/**
 * The essay a receipt names, or `null` when it names none — the whole test for
 * whether this receipt is a door into the document panel.
 *
 * `duplicate` resolves to the **copy**, never the source: the glance line says
 * a new draft was made, and the draft the student wants to look at is the one
 * that did not exist a moment ago. `batch`, `state_transition` and `reorder`
 * all carry several essays or none in particular, so there is no single
 * document to open and they stay inert rather than guessing at one.
 */
export function essayResourceRefOf(
  receipt: WorkspaceMutationReceipt,
): string | null {
  if (receipt.family !== "essay" && receipt.family !== "essay_content") {
    return null;
  }
  const { body } = receipt;
  if (
    body.kind === "update" ||
    body.kind === "essay_edit" ||
    body.kind === "essay_write"
  ) {
    return body.subject.resource_ref ?? null;
  }
  if (body.kind === "duplicate") {
    return body.copy.resource_ref ?? null;
  }
  return null;
}

/** The essay's own title, for the door's accessible name. */
export function essaySubjectTitleOf(
  receipt: WorkspaceMutationReceipt,
): string | null {
  const { body } = receipt;
  if (
    body.kind === "update" ||
    body.kind === "essay_edit" ||
    body.kind === "essay_write"
  ) {
    return body.subject.title.text;
  }
  if (body.kind === "duplicate") {
    return body.copy.title.text;
  }
  return null;
}
