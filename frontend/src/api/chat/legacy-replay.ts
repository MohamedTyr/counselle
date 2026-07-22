import type {
  ClarifyResponseV2,
  ClarifySpec,
  LegacySourceEntry,
  RenderSpec,
  ReplaySourceEntry,
  TranscriptClarification,
  TranscriptAssistantEntry,
  TranscriptEntry,
  TranscriptSegment,
} from "@/api/chat/types";
import { isTabularRenderSpec } from "@/api/chat/validation";

type JsonObject = Record<string, unknown>;

function record(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function stringValue(value: unknown): value is string {
  return typeof value === "string";
}

function boundedString(value: unknown, maxChars: number): value is string {
  return typeof value === "string" && value.length <= maxChars;
}

function legacySource(value: unknown): LegacySourceEntry | null {
  if (
    !record(value) ||
    !positiveInteger(value.index) ||
    typeof value.label !== "string" ||
    !record(value.citation)
  )
    return null;
  const citation = value.citation;
  if (
    typeof citation.source !== "string" ||
    citation.source.trim() === "" ||
    (citation.tier !== "official" && citation.tier !== "community") ||
    typeof citation.vintage !== "string" ||
    citation.vintage.trim() === ""
  )
    return null;
  return {
    v: 1,
    index: value.index,
    label: value.label,
    citation: {
      v: 1,
      source: citation.source,
      tier: citation.tier,
      vintage: citation.vintage,
      ...(typeof citation.url === "string" || citation.url === null
        ? { url: citation.url }
        : {}),
      ...(typeof citation.caveat === "string" || citation.caveat === null
        ? { caveat: citation.caveat }
        : {}),
      ...(typeof citation.raw_table === "string" || citation.raw_table === null
        ? { raw_table: citation.raw_table }
        : {}),
    },
  };
}

function replaySource(value: unknown): ReplaySourceEntry | null {
  if (!record(value)) return null;
  if (value.v === 1 || value.legacy === true) return legacySource(value);
  return value as ReplaySourceEntry;
}

export function isLegacySourceEntry(
  value: ReplaySourceEntry,
): value is LegacySourceEntry {
  return value.v === 1;
}

function safeStoredSpec(value: unknown): RenderSpec {
  if (!record(value)) return { v: 2, type: "invalid_visualization" };
  if (isTabularRenderSpec(value)) return value;
  return {
    v: typeof value.v === "number" ? value.v : 2,
    type: typeof value.type === "string" ? value.type : "invalid_visualization",
    ...(typeof value.title === "string" || value.title === null
      ? { title: value.title }
      : {}),
  } as RenderSpec;
}

function safeClarifySpec(value: unknown): ClarifySpec | null {
  if (!record(value) || typeof value.v !== "number") return null;

  if (value.v === 1) {
    const options = Array.isArray(value.options)
      ? value.options.filter(record).filter((option) => stringValue(option.label) && stringValue(option.hint))
      : [];
    if (
      typeof value.question !== "string" ||
      typeof value.header !== "string" ||
      typeof value.multi_select !== "boolean" ||
      options.length < 2 ||
      options.length > 4 ||
      options.length !== (Array.isArray(value.options) ? value.options.length : 0)
    ) {
      return null;
    }
    return {
      v: 1,
      question: value.question,
      header: value.header,
      multi_select: value.multi_select,
      options: options.map((option) => ({
        label: option.label as string,
        hint: option.hint as string,
      })),
    };
  }

  if (value.v === 2) {
    if (!Array.isArray(value.questions)) return null;
    const questions = value.questions.filter(record).map((question) => {
      const options = Array.isArray(question.options)
        ? question.options.filter(record).map((option) => ({
            id: typeof option.id === "string" ? option.id : "",
            label: boundedString(option.label, 80) ? option.label : "",
            ...(option.hint === null ||
            option.hint === undefined ||
            boundedString(option.hint, 160)
              ? { hint: option.hint as string | null | undefined }
              : {}),
          }))
        : [];
      return {
        id: typeof question.id === "string" ? question.id : "",
        question: boundedString(question.question, 240)
          ? question.question
          : "",
        selection: question.selection === "multiple" ? "multiple" : "single",
        options,
      };
    });
    if (
      questions.length < 1 ||
      questions.length > 3 ||
      questions.length !== value.questions.length ||
      questions.some(
        (question) =>
          question.id.trim() === "" ||
          question.question.trim() === "" ||
          question.options.length < 2 ||
          question.options.length > 5 ||
          question.options.some(
            (option) => option.id.trim() === "" || option.label.trim() === "",
          ),
      )
    ) {
      return null;
    }
    return { v: 2, questions };
  }

  return { v: value.v, type: "unknown_clarify" };
}

function safeClarifyResponse(value: unknown): ClarifyResponseV2 | null {
  if (!record(value) || value.v !== 2) return null;
  if (value.mode === "reply") {
    if (
      !boundedString(value.text, 4000) ||
      value.text.trim() === "" ||
      typeof value.user_message_id !== "string" ||
      value.user_message_id.trim() === ""
    ) {
      return null;
    }
    return {
      v: 2,
      mode: "reply",
      text: value.text,
      user_message_id: value.user_message_id,
    };
  }
  if (value.mode === "widget") {
    if (!Array.isArray(value.answers) || value.answers.length > 3) return null;
    const answers = value.answers.filter(record).map((answer) => ({
      question_id:
        typeof answer.question_id === "string" ? answer.question_id : "",
      option_ids: Array.isArray(answer.option_ids)
        ? answer.option_ids.filter(stringValue)
        : [],
      ...(answer.custom_text === null ||
      answer.custom_text === undefined ||
      boundedString(answer.custom_text, 1000)
        ? { custom_text: answer.custom_text as string | null | undefined }
        : {}),
    }));
    if (
      answers.length !== value.answers.length ||
      answers.some((answer) => answer.question_id.trim() === "")
    ) {
      return null;
    }
    return { v: 2, mode: "widget", answers };
  }
  return null;
}

function safeClarification(value: unknown): TranscriptClarification | undefined {
  if (!record(value)) return undefined;
  const spec = safeClarifySpec(value.spec);
  if (spec === null) return undefined;

  if (spec.v === 1) {
    return {
      spec,
      answer:
        typeof value.answer === "string" || value.answer === null
          ? value.answer
          : null,
    };
  }

  const response = safeClarifyResponse(value.response);
  return {
    spec,
    ...(response !== null || value.response === null ? { response } : {}),
    ...(typeof value.answer === "string" || value.answer === null
      ? { answer: value.answer }
      : {}),
  };
}

function safeSegment(value: unknown): TranscriptSegment | null {
  if (!record(value) || typeof value.kind !== "string") return null;
  switch (value.kind) {
    case "narration":
    case "thinking":
    case "delta":
      return typeof value.text === "string"
        ? ({ kind: value.kind, text: value.text } as TranscriptSegment)
        : null;
    case "user":
      return typeof value.text === "string" &&
        typeof value.user_message_id === "string" &&
        typeof value.injected === "boolean"
        ? {
            kind: "user",
            text: value.text,
            user_message_id: value.user_message_id,
            injected: value.injected,
          }
        : null;
    case "step":
      return record(value.data)
        ? ({ kind: "step", data: value.data } as TranscriptSegment)
        : null;
    case "viz":
      return { kind: "viz", spec: safeStoredSpec(value.spec) };
    case "clarify":
      return { kind: "clarify" };
    default:
      return null;
  }
}

function sanitizeCurrentEntry(entry: JsonObject): TranscriptEntry {
  const entryWithoutClarify = Object.fromEntries(
    Object.entries(entry).filter(([key]) => key !== "clarify"),
  );
  const parts = Array.isArray(entry.parts)
    ? entry.parts.map((part) =>
        record(part) && part.type === "viz"
          ? { ...part, spec: safeStoredSpec(part.spec) }
          : part,
      )
    : entry.parts;
  const segments = Array.isArray(entry.segments)
    ? entry.segments.map(safeSegment).filter((segment) => segment !== null)
    : entry.segments;
  const sources = Array.isArray(entry.sources)
    ? entry.sources.map(replaySource).filter((source) => source !== null)
    : entry.sources;
  const clarify = safeClarification(entry.clarify);
  return {
    ...entryWithoutClarify,
    ...(parts !== undefined ? { parts } : {}),
    ...(segments !== undefined ? { segments } : {}),
    ...(sources !== undefined ? { sources } : {}),
    ...(clarify !== undefined ? { clarify } : {}),
  } as TranscriptEntry;
}

/** Adapt only old completed turn records loaded from durable storage. */
export function adaptLegacyCompletedTurn(
  value: unknown,
): TranscriptAssistantEntry | null {
  if (
    !record(value) ||
    value.status !== "complete" ||
    !Array.isArray(value.parts) ||
    !Array.isArray(value.sources)
  )
    return null;
  const textParts = value.parts
    .filter(record)
    .filter((part) => part.type === "text" && typeof part.text === "string");
  const sources = value.sources.map(legacySource);
  if (
    textParts.length !== value.parts.length ||
    sources.some((source) => source === null)
  )
    return null;
  const text = textParts.map((part) => part.text as string).join("");
  return {
    role: "assistant",
    text,
    ts: null,
    ...(typeof value.message_id === "string"
      ? { message_id: value.message_id }
      : {}),
    parts: [{ type: "text", text }],
    sources: sources as LegacySourceEntry[],
    status: "complete",
  };
}

/** Current transcript entries pass through unchanged; only unmistakable legacy
 * completed-turn records are adapted. Malformed records stay opaque and are not
 * guessed into the current contract. */
export function adaptStoredTranscript(value: unknown): TranscriptEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (record(entry) && (entry.role === "user" || entry.role === "assistant"))
      return [sanitizeCurrentEntry(entry)];
    const legacy = adaptLegacyCompletedTurn(entry);
    return legacy === null ? [] : [legacy];
  });
}
