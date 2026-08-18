import type { WorkspaceMutationReceipt } from "@/api/chat/types";

/**
 * Memory-family anatomy (plan §9.8): a restrained note surface. This is the
 * *expanded* body only — the collapsed row (rendered by the shell) already
 * carries the count/active-state consequence. `forget` never repeats the
 * forgotten text: its `active_notes` is empty by contract (enforced by the
 * backend model), so this renders only the fixed reassurance copy.
 */
export function MemoryMutationBody({ receipt }: { receipt: WorkspaceMutationReceipt }) {
  const { body } = receipt;
  if (body.kind !== "memory") return null;

  if (body.operation === "forget") {
    return (
      <p className="text-muted-foreground">
        You can ask Counselle to remember this information again.
      </p>
    );
  }

  return (
    <ul className="grid gap-1">
      {body.active_notes.map((note, index) => (
        <li className="text-[var(--ink-secondary)]" key={index}>
          {note.text}
        </li>
      ))}
    </ul>
  );
}
