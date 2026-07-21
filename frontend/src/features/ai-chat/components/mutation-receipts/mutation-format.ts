import type {
  MutationItem,
  MutationOutcome,
  WorkspaceMutationReceipt,
} from "@/api/chat/types";

/** One pure glance formatter — the collapsed receipt row and copy/export
 * (`runMarkdownOf`) both call this so visible and copied text always agree
 * (plan §11.2). Copy/export never includes expanded-only detail (memory
 * content, per-item reasons, essay word tables) — those stay inspect-only. */

function countDisposition(items: MutationItem[], disposition: string): number {
  return items.filter((item) => item.disposition === disposition).length;
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

const FAMILY_NOUN: Record<WorkspaceMutationReceipt["family"], string> = {
  task: "task",
  school: "school",
  essay: "essay",
  essay_content: "essay",
  activity: "activity",
  honor: "honor",
  profile: "profile field",
  memory: "note",
};

function batchGlance(
  receipt: WorkspaceMutationReceipt,
  items: MutationItem[],
): string {
  const noun = FAMILY_NOUN[receipt.family];
  const changed = countDisposition(items, "changed");
  const total = items.length;
  if (receipt.action === "create") {
    if (receipt.outcome === "success") return `Added ${pluralize(total, noun)}`;
    return `Added ${changed} of ${total} ${noun}${total === 1 ? "" : "s"}`;
  }
  if (receipt.action === "archive") {
    if (receipt.outcome === "success")
      return `Archived ${pluralize(total, noun)}`;
    return `Archived ${changed} of ${total} ${noun}${total === 1 ? "" : "s"}`;
  }
  return `${changed} of ${total} ${noun}${total === 1 ? "" : "s"} changed`;
}

function outcomeSuffix(outcome: MutationOutcome, subjectTitle: string): string {
  if (outcome === "failed") return `Couldn’t update “${subjectTitle}”`;
  if (outcome === "unknown") return "Action interrupted — final state is unknown";
  return "";
}

/** The glance-level text for a receipt — one line, no expansion required. */
export function mutationGlanceText(receipt: WorkspaceMutationReceipt): string {
  const { body, outcome } = receipt;
  switch (body.kind) {
    case "batch":
      return batchGlance(receipt, body.items);
    case "update": {
      const title = body.subject.title.text;
      if (outcome !== "success") return outcomeSuffix(outcome, title);
      return `Updated “${title}”`;
    }
    case "state_transition": {
      const title = body.subjects[0]?.title.text ?? FAMILY_NOUN[receipt.family];
      const verb =
        body.state === "created"
          ? "Created"
          : body.state === "restored"
            ? "Restored"
            : "Archived";
      return body.subjects.length > 1
        ? `${verb} ${pluralize(body.subjects.length, FAMILY_NOUN[receipt.family])}`
        : `${verb} “${title}”`;
    }
    case "duplicate":
      return `Copied “${body.source.title.text}”`;
    case "reorder": {
      if (body.moved_index !== null && body.moved_index !== undefined) {
        const moved = body.new_order[body.moved_index];
        if (moved !== undefined) {
          return body.moved_from_rank !== null && body.moved_from_rank !== undefined
            ? `${moved.title.text} moved #${body.moved_from_rank} → #${body.moved_index + 1}`
            : `New #${body.moved_index + 1}: ${moved.title.text}`;
        }
      }
      return `Reordered ${FAMILY_NOUN[receipt.family]}s`;
    }
    case "essay_edit":
      return `Edited “${body.subject.title.text}” — ${pluralize(body.operations.length, "edit")}`;
    case "essay_write":
      return body.mode === "drafted"
        ? `Drafted “${body.subject.title.text}”`
        : `Replaced draft of “${body.subject.title.text}”`;
    case "profile":
      return `Updated profile — ${pluralize(body.sections.length, "section")}`;
    case "memory": {
      if (body.operation === "forget") {
        return body.note_count === 1
          ? "A note is no longer remembered"
          : `${body.note_count} notes are no longer remembered`;
      }
      return body.note_count === 1
        ? "Saved a note to memory"
        : `Saved ${body.note_count} notes to memory`;
    }
    case "unresolved":
      return outcome === "unknown"
        ? `Action interrupted — final ${FAMILY_NOUN[receipt.family]} state is unknown`
        : "Couldn’t start this action";
    default:
      return "Change completed";
  }
}
