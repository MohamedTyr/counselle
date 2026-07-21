import type {
  BoundedDisplayText,
  MutationBody,
  MutationChange,
  MutationItem,
  MutationNotice,
  MutationSubject,
  WorkspaceMutationReceipt,
} from "@/api/chat/types";

/**
 * One tolerant parser used by both live SSE and stored-transcript replay
 * (agent mutation receipts plan §6.7, §11.1). Returns `null` for anything
 * that doesn't validate — malformed/oversized/unknown-version — never
 * throws, and never partially trusts a shape. The caller (ToolWidgets
 * routing) is responsible for the marker-present-but-null distinction that
 * separates "current corruption" from "pre-feature history".
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBoundedDisplayText(value: unknown): BoundedDisplayText | null {
  if (!isRecord(value) || typeof value.text !== "string") return null;
  if (typeof value.truncated !== "boolean") return null;
  const original = value.original_graphemes;
  if (original !== undefined && original !== null && typeof original !== "number") {
    return null;
  }
  return {
    text: value.text,
    truncated: value.truncated,
    original_graphemes: (original as number | null | undefined) ?? null,
  };
}

function parseSubject(value: unknown): MutationSubject | null {
  if (!isRecord(value)) return null;
  const title = parseBoundedDisplayText(value.title);
  if (title === null) return null;
  const ref = value.resource_ref;
  if (ref !== undefined && ref !== null && typeof ref !== "string") return null;
  return { title, resource_ref: (ref as string | null | undefined) ?? null };
}

function parseSubjectArray(value: unknown): MutationSubject[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: MutationSubject[] = [];
  for (const item of value) {
    const subject = parseSubject(item);
    if (subject === null) return null;
    parsed.push(subject);
  }
  return parsed;
}

function parseMutationValue(value: unknown): MutationBodyValue | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  // Structural pass-through — the discriminant is trusted; nested subjects
  // are re-validated where present since they cross the same seam.
  const kind = value.kind as string;
  if (kind === "reference") {
    const reference = parseSubject(value.reference);
    if (reference === null) return null;
    return { ...value, reference } as MutationBodyValue;
  }
  if (kind === "reference_list") {
    const list = parseSubjectArray(value.reference_list);
    if (list === null) return null;
    return { ...value, reference_list: list } as MutationBodyValue;
  }
  if (kind === "text") {
    const text = parseBoundedDisplayText(value.text);
    if (text === null) return null;
    return { ...value, text } as MutationBodyValue;
  }
  return value as MutationBodyValue;
}

// Local alias — avoids importing MutationValue just for this file's internal
// widened-parse shape while still round-tripping through the public type.
type MutationBodyValue = NonNullable<MutationChange["after"]>;

function parseChange(value: unknown): MutationChange | null {
  if (!isRecord(value) || typeof value.field_key !== "string") return null;
  if (typeof value.operation !== "string") return null;
  let before: MutationChange["before"] = null;
  let after: MutationChange["after"] = null;
  if (value.before !== undefined && value.before !== null) {
    before = parseMutationValue(value.before);
    if (before === null) return null;
  }
  if (value.after !== undefined && value.after !== null) {
    after = parseMutationValue(value.after);
    if (after === null) return null;
  }
  return {
    field_key: value.field_key,
    operation: value.operation as MutationChange["operation"],
    before,
    after,
  };
}

function parseChangeArray(value: unknown): MutationChange[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: MutationChange[] = [];
  for (const item of value) {
    const change = parseChange(item);
    if (change === null) return null;
    parsed.push(change);
  }
  return parsed;
}

function parseItem(value: unknown): MutationItem | null {
  if (!isRecord(value)) return null;
  if (typeof value.input_index !== "number") return null;
  if (typeof value.disposition !== "string") return null;
  const subject =
    value.subject === undefined || value.subject === null
      ? null
      : parseSubject(value.subject);
  if (value.subject !== undefined && value.subject !== null && subject === null) {
    return null;
  }
  const reason =
    value.reason === undefined || value.reason === null
      ? null
      : parseBoundedDisplayText(value.reason);
  if (value.reason !== undefined && value.reason !== null && reason === null) {
    return null;
  }
  const recovery =
    value.recovery === undefined || value.recovery === null
      ? null
      : parseBoundedDisplayText(value.recovery);
  if (value.recovery !== undefined && value.recovery !== null && recovery === null) {
    return null;
  }
  return {
    input_index: value.input_index,
    disposition: value.disposition as MutationItem["disposition"],
    subject,
    reason,
    recovery,
  };
}

function parseBody(value: unknown): MutationBody | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  switch (value.kind) {
    case "batch": {
      if (!Array.isArray(value.items)) return null;
      const items: MutationItem[] = [];
      for (const raw of value.items) {
        const item = parseItem(raw);
        if (item === null) return null;
        items.push(item);
      }
      return { kind: "batch", items };
    }
    case "update": {
      const subject = parseSubject(value.subject);
      const changes = parseChangeArray(value.changes);
      if (subject === null || changes === null) return null;
      return { kind: "update", subject, changes };
    }
    case "state_transition": {
      const subjects = parseSubjectArray(value.subjects);
      if (subjects === null || typeof value.state !== "string") return null;
      return {
        kind: "state_transition",
        state: value.state as "created" | "restored" | "archived",
        subjects,
        cascade: (value.cascade as MutationNotice | null | undefined) ?? null,
      };
    }
    case "duplicate": {
      const source = parseSubject(value.source);
      const copy = parseSubject(value.copy);
      if (source === null || copy === null) return null;
      return { kind: "duplicate", source, copy };
    }
    case "reorder": {
      const newOrder = parseSubjectArray(value.new_order);
      if (newOrder === null) return null;
      return {
        kind: "reorder",
        new_order: newOrder,
        old_ranks: (value.old_ranks as number[] | null | undefined) ?? null,
        moved_index: (value.moved_index as number | null | undefined) ?? null,
        moved_from_rank: (value.moved_from_rank as number | null | undefined) ?? null,
      };
    }
    case "essay_edit": {
      const subject = parseSubject(value.subject);
      if (
        subject === null ||
        !Array.isArray(value.operations) ||
        typeof value.final_word_count !== "number"
      ) {
        return null;
      }
      return {
        kind: "essay_edit",
        subject,
        operations: value.operations as MutationBody extends { kind: "essay_edit" }
          ? MutationBody["operations"]
          : never,
        final_word_count: value.final_word_count,
        word_limit: (value.word_limit as number | null | undefined) ?? null,
      };
    }
    case "essay_write": {
      const subject = parseSubject(value.subject);
      if (
        subject === null ||
        typeof value.mode !== "string" ||
        typeof value.final_word_count !== "number"
      ) {
        return null;
      }
      return {
        kind: "essay_write",
        subject,
        mode: value.mode as "drafted" | "replaced",
        previous_word_count:
          (value.previous_word_count as number | null | undefined) ?? null,
        final_word_count: value.final_word_count,
        word_limit: (value.word_limit as number | null | undefined) ?? null,
      };
    }
    case "profile": {
      if (!Array.isArray(value.sections)) return null;
      const sections = [];
      for (const raw of value.sections) {
        if (!isRecord(raw) || typeof raw.section_key !== "string") return null;
        const changes = parseChangeArray(raw.changes);
        if (changes === null) return null;
        sections.push({
          section_key: raw.section_key,
          section_label: String(raw.section_label ?? raw.section_key),
          changes,
        });
      }
      return { kind: "profile", sections };
    }
    case "memory": {
      if (typeof value.operation !== "string" || typeof value.note_count !== "number") {
        return null;
      }
      if (!Array.isArray(value.active_notes)) return null;
      const notes: BoundedDisplayText[] = [];
      for (const raw of value.active_notes) {
        const note = parseBoundedDisplayText(raw);
        if (note === null) return null;
        notes.push(note);
      }
      return {
        kind: "memory",
        operation: value.operation as "remember" | "update_memory" | "forget",
        note_count: value.note_count,
        active_notes: notes,
      };
    }
    case "unresolved": {
      if (typeof value.family !== "string" || typeof value.verification !== "string") {
        return null;
      }
      return {
        kind: "unresolved",
        family: value.family as MutationBody extends { kind: "unresolved" }
          ? MutationBody["family"]
          : never,
        verification: value.verification as MutationBody extends { kind: "unresolved" }
          ? MutationBody["verification"]
          : never,
        attempted_count: (value.attempted_count as number | null | undefined) ?? null,
      };
    }
    default:
      return null;
  }
}

export function parseMutationReceipt(value: unknown): WorkspaceMutationReceipt | null {
  if (!isRecord(value)) return null;
  if (value.v !== 1) return null;
  if (typeof value.family !== "string" || typeof value.action !== "string") return null;
  if (typeof value.outcome !== "string") return null;
  const body = parseBody(value.body);
  if (body === null) return null;
  const notices = Array.isArray(value.notices) ? (value.notices as MutationNotice[]) : [];
  const omissions = isRecord(value.omissions)
    ? {
        subjects: Number(value.omissions.subjects ?? 0),
        changes: Number(value.omissions.changes ?? 0),
        item_details: Number(value.omissions.item_details ?? 0),
        notices: Number(value.omissions.notices ?? 0),
        edit_operations: Number(value.omissions.edit_operations ?? 0),
      }
    : { subjects: 0, changes: 0, item_details: 0, notices: 0, edit_operations: 0 };
  return {
    v: 1,
    family: value.family as WorkspaceMutationReceipt["family"],
    action: value.action as WorkspaceMutationReceipt["action"],
    outcome: value.outcome as WorkspaceMutationReceipt["outcome"],
    body,
    notices,
    omissions,
  };
}
