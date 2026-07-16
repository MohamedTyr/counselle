import { TransportError } from "@/api/http/errors";
import { isCurrentSourceEntry, isTabularRenderSpec } from "@/api/chat/validation";
import {
  protocolEventTypes,
  type DoneStatus,
  type ProtocolEvent,
  type ProtocolEventType,
  type SseFrame,
} from "@/api/chat/types";

const knownEventTypes = new Set<ProtocolEventType>(protocolEventTypes);
const maxBufferLength = 5 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isProtocolEventType(value: unknown): value is ProtocolEventType {
  return (
    typeof value === "string" && knownEventTypes.has(value as ProtocolEventType)
  );
}

const doneStatuses = new Set<DoneStatus>([
  "complete",
  "awaiting_input",
  "cancelled",
]);
function isClarifyOption(value: unknown) {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.label === "string" && typeof value.hint === "string";
}


function coerceDoneStatus(value: string): DoneStatus {
  return doneStatuses.has(value as DoneStatus)
    ? (value as DoneStatus)
    : "complete";
}

function isStepTier(value: unknown) {
  return value === null || value === "official" || value === "community";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isPlanItem(value: unknown) {
  if (!isPlainRecord(value)) {
    return false;
  }
  return (
    typeof value.content === "string" &&
    (value.status === "pending" ||
      value.status === "in_progress" ||
      value.status === "completed" ||
      value.status === "cancelled")
  );
}

function isPlanItems(value: unknown) {
  return Array.isArray(value) && value.every(isPlanItem);
}

function isStepDetail(value: unknown) {
  if (!isPlainRecord(value)) {
    return false;
  }

  return (
    (!("query" in value) || typeof value.query === "string") &&
    (!("summary" in value) || typeof value.summary === "string") &&
    (!("domains" in value) || isStringArray(value.domains)) &&
    (!("result_count" in value) || isNumber(value.result_count)) &&
    (!("value_count" in value) || isNumber(value.value_count)) &&
    (!("duration_ms" in value) || isNumber(value.duration_ms)) &&
    (!("tool" in value) || typeof value.tool === "string") &&
    (!("domain_id" in value) || typeof value.domain_id === "string") &&
    (!("row_count" in value) || isNumber(value.row_count)) &&
    (!("viz_type" in value) || typeof value.viz_type === "string") &&
    (!("schools" in value) || isStringArray(value.schools)) &&
    (!("items" in value) || isPlanItems(value.items)) &&
    (!("completed" in value) || isNumber(value.completed)) &&
    (!("total" in value) || isNumber(value.total)) &&
    (!("next_actions" in value) || isStringArray(value.next_actions)) &&
    (!("error" in value) || typeof value.error === "string")
  );
}

function isStepSource(value: unknown) {
  if (!isPlainRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.label) &&
    (!("favicon" in value) || typeof value.favicon === "string") &&
    (!("url" in value) || typeof value.url === "string")
  );
}

function isToolUi(value: unknown) {
  if (!isPlainRecord(value)) {
    return false;
  }

  return isNonEmptyString(value.widget) && isPlainRecord(value.data);
}

function hasIdentityFields(type: ProtocolEventType, data: unknown) {
  if (!isRecord(data)) {
    return false;
  }
  switch (type) {
    case "meta":
      return (
        isNonEmptyString(data.trace_id) &&
        isNonEmptyString(data.message_id) &&
        isNonEmptyString(data.user_message_id) &&
        isNonEmptyString(data.session_id) &&
        isNonEmptyString(data.model)
      );
    case "step":
      return (
        isNonEmptyString(data.step_id) &&
        (data.status === "start" ||
          data.status === "end" ||
          data.status === "error") &&
        typeof data.kind === "string" &&
        typeof data.label === "string" &&
        isStepTier(data.tier) &&
        (data.detail === null || isStepDetail(data.detail)) &&
        (!("sources" in data) ||
          (Array.isArray(data.sources) && data.sources.every(isStepSource))) &&
        (!("ui" in data) || isToolUi(data.ui))
      );
    case "done":
      return typeof data.status === "string";
    case "error":
      return isNonEmptyString(data.message);
    case "delta":
    case "narration":
    case "thinking":
      return typeof data.text === "string";
    case "user_message":
      return (
        typeof data.text === "string" &&
        isNonEmptyString(data.user_message_id) &&
        typeof data.injected === "boolean"
      );
    case "viz":
      if (!isPositiveInteger(data.v) || !isNonEmptyString(data.type)) return false;
      if (data.type !== "stat_block" && data.type !== "comparison_table") {
        return !("title" in data) || data.title === null || typeof data.title === "string";
      }
      return isTabularRenderSpec(data);
    case "clarify":
      return (
        typeof data.v === "number" &&
        typeof data.question === "string" &&
        typeof data.header === "string" &&
        typeof data.multi_select === "boolean" &&
        Array.isArray(data.options) &&
        data.options.every(isClarifyOption)
      );
    case "sources":
      return Array.isArray(data.sources) && data.sources.every(isCurrentSourceEntry);
    case "usage":
      return (
        typeof data.input_tokens === "number" &&
        typeof data.output_tokens === "number" &&
        typeof data.tool_calls === "number"
      );
    default:
      return false;
  }
}

function coerceProtocolEvent(value: unknown): ProtocolEvent {
  if (!isRecord(value)) {
    throw new TransportError("server", "Stream returned an unknown event.");
  }
  if (typeof value.type === "string" && !isProtocolEventType(value.type)) {
    return {
      v: typeof value.v === "number" ? value.v : undefined,
      type: value.type,
      data: {},
    } as unknown as ProtocolEvent;
  }
  if (!isProtocolEventType(value.type)) {
    throw new TransportError("server", "Stream returned an unknown event.");
  }
  if (!hasIdentityFields(value.type, value.data)) {
    throw new TransportError(
      "server",
      `Stream returned a malformed ${value.type} event.`,
    );
  }
  if (value.type === "done" && isRecord(value.data)) {
    return {
      v: typeof value.v === "number" ? value.v : undefined,
      type: value.type,
      data: { status: coerceDoneStatus(value.data.status as string) },
    };
  }
  return {
    v: typeof value.v === "number" ? value.v : undefined,
    type: value.type,
    data: isRecord(value.data) ? value.data : {},
  } as ProtocolEvent;
}

function parseFrame(block: string): SseFrame<ProtocolEvent> | null {
  let id: string | undefined;
  let event: string | undefined;
  const dataLines: string[] = [];

  for (const rawLine of block.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0 || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("id:")) {
      id = line.slice(3).trimStart();
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice(6).trimStart();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  try {
    const data = coerceProtocolEvent(
      JSON.parse(dataLines.join("\n")) as unknown,
    );
    if (!knownEventTypes.has(data.type)) {
      return null;
    }
    return { id, event, data };
  } catch (cause) {
    if (cause instanceof TransportError) {
      throw cause;
    }
    throw new TransportError("server", "Stream returned malformed JSON.", {
      cause,
    });
  }
}

export async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseFrame<ProtocolEvent>, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      if (buffer.length > maxBufferLength) {
        await reader.cancel().catch(() => undefined);
        throw new TransportError(
          "server",
          "Stream exceeded the maximum allowed size.",
        );
      }

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = parseFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (frame) {
          yield frame;
        }
        boundary = buffer.indexOf("\n\n");
      }
    }

    buffer += decoder.decode();
    const tail = buffer.replace(/\r\n/g, "\n").trim();
    if (tail.length > 0) {
      const frame = parseFrame(tail);
      if (frame) {
        yield frame;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function consumeSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent?: (event: ProtocolEvent, frame: SseFrame<ProtocolEvent>) => void,
): Promise<void> {
  for await (const frame of parseSseStream(body)) {
    onEvent?.(frame.data, frame);
  }
}
