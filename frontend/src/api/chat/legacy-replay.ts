import type {
  LegacySourceEntry,
  RenderSpec,
  ReplaySourceEntry,
  TranscriptAssistantEntry,
  TranscriptEntry,
} from "@/api/chat/types";
import { isTabularRenderSpec } from "@/api/chat/validation";

type JsonObject = Record<string, unknown>;

function record(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function legacySource(value: unknown): LegacySourceEntry | null {
  if (!record(value) || !positiveInteger(value.index) || typeof value.label !== "string" || !record(value.citation)) return null;
  const citation = value.citation;
  if (typeof citation.source !== "string" || citation.source.trim() === "" ||
      (citation.tier !== "official" && citation.tier !== "community") ||
      typeof citation.vintage !== "string" || citation.vintage.trim() === "") return null;
  return {
    v: 1,
    index: value.index,
    label: value.label,
    citation: {
      v: 1,
      source: citation.source,
      tier: citation.tier,
      vintage: citation.vintage,
      ...(typeof citation.url === "string" || citation.url === null ? { url: citation.url } : {}),
      ...(typeof citation.caveat === "string" || citation.caveat === null ? { caveat: citation.caveat } : {}),
      ...(typeof citation.raw_table === "string" || citation.raw_table === null ? { raw_table: citation.raw_table } : {}),
    },
  };
}

function replaySource(value: unknown): ReplaySourceEntry | null {
  if (!record(value)) return null;
  if (value.v === 1 || value.legacy === true) return legacySource(value);
  return value as ReplaySourceEntry;
}

export function isLegacySourceEntry(value: ReplaySourceEntry): value is LegacySourceEntry {
  return value.v === 1;
}

function safeStoredSpec(value: unknown): RenderSpec {
  if (!record(value)) return { v: 2, type: "invalid_visualization" };
  if (isTabularRenderSpec(value)) return value;
  return {
    v: typeof value.v === "number" ? value.v : 2,
    type: typeof value.type === "string" ? value.type : "invalid_visualization",
    ...(typeof value.title === "string" || value.title === null ? { title: value.title } : {}),
  } as RenderSpec;
}

function sanitizeCurrentEntry(entry: JsonObject): TranscriptEntry {
  const parts = Array.isArray(entry.parts)
    ? entry.parts.map((part) => record(part) && part.type === "viz"
        ? { ...part, spec: safeStoredSpec(part.spec) }
        : part)
    : entry.parts;
  const segments = Array.isArray(entry.segments)
    ? entry.segments.map((segment) => record(segment) && segment.kind === "viz"
        ? { ...segment, spec: safeStoredSpec(segment.spec) }
        : segment)
    : entry.segments;
  const sources = Array.isArray(entry.sources)
    ? entry.sources.map(replaySource).filter((source) => source !== null)
    : entry.sources;
  return {
    ...entry,
    ...(parts !== undefined ? { parts } : {}),
    ...(segments !== undefined ? { segments } : {}),
    ...(sources !== undefined ? { sources } : {}),
  } as TranscriptEntry;
}

/** Adapt only old completed turn records loaded from durable storage. */
export function adaptLegacyCompletedTurn(value: unknown): TranscriptAssistantEntry | null {
  if (!record(value) || value.status !== "complete" || !Array.isArray(value.parts) || !Array.isArray(value.sources)) return null;
  const textParts = value.parts.filter(record).filter((part) => part.type === "text" && typeof part.text === "string");
  const sources = value.sources.map(legacySource);
  if (textParts.length !== value.parts.length || sources.some((source) => source === null)) return null;
  const text = textParts.map((part) => part.text as string).join("");
  return {
    role: "assistant",
    text,
    ts: null,
    ...(typeof value.message_id === "string" ? { message_id: value.message_id } : {}),
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
    if (record(entry) && (entry.role === "user" || entry.role === "assistant")) return [sanitizeCurrentEntry(entry)];
    const legacy = adaptLegacyCompletedTurn(entry);
    return legacy === null ? [] : [legacy];
  });
}
