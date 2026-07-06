import { TransportError } from "@/api/http/errors"
import {
  protocolEventTypes,
  type ProtocolEvent,
  type ProtocolEventType,
} from "@/api/chat/types"

const knownEventTypes = new Set<ProtocolEventType>(protocolEventTypes)
const maxBufferLength = 5 * 1024 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isProtocolEventType(value: unknown): value is ProtocolEventType {
  return typeof value === "string" && knownEventTypes.has(value as ProtocolEventType)
}

function parseFrame(block: string): ProtocolEvent | null {
  const dataLines: string[] = []

  for (const rawLine of block.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine
    if (line.length === 0 || line.startsWith(":")) {
      continue
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart())
    }
  }

  if (dataLines.length === 0) {
    return null
  }

  try {
    const parsed = JSON.parse(dataLines.join("\n")) as unknown
    if (!isRecord(parsed) || !isProtocolEventType(parsed.type)) {
      return null
    }
    return {
      v: typeof parsed.v === "number" ? parsed.v : undefined,
      type: parsed.type,
      data: isRecord(parsed.data) ? parsed.data : {},
    }
  } catch {
    return null
  }
}

export async function consumeSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent?: (event: ProtocolEvent) => void,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n")
      if (buffer.length > maxBufferLength) {
        throw new TransportError("server", "Stream exceeded the maximum allowed size.")
      }

      let boundary = buffer.indexOf("\n\n")
      while (boundary !== -1) {
        const event = parseFrame(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
        if (event) {
          onEvent?.(event)
        }
        boundary = buffer.indexOf("\n\n")
      }
    }

    buffer += decoder.decode()
    const tail = buffer.replace(/\r\n/g, "\n").trim()
    if (tail.length > 0) {
      const event = parseFrame(tail)
      if (event) {
        onEvent?.(event)
      }
    }
  } finally {
    reader.releaseLock()
  }
}
