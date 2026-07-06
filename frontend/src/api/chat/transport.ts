import { BASE } from "@/api/http/constants"
import { errorFromResponse, TransportError } from "@/api/http/errors"
import { jsonRequestInit, requestJson } from "@/api/http/client"
import type {
  ChatConfigWire,
  ChatTransport,
  CreatedSession,
  SourceConfigWire,
  StreamResult,
} from "@/api/chat/types"
import {
  fromWireSourceConfig,
  toWireSourceConfig,
} from "@/api/chat/source-config"
import { consumeSseStream } from "@/api/chat/sse"

type CreateSessionWire = {
  session_id: string
  source_config: SourceConfigWire | null
}

function withBase(path: string) {
  if (path.startsWith(BASE)) {
    return path
  }
  return `${BASE}${path.startsWith("/") ? path : `/${path}`}`
}

async function streamFetch(path: string, init: RequestInit) {
  try {
    return await fetch(withBase(path), {
      ...init,
      credentials: "same-origin",
    })
  } catch (cause) {
    throw new TransportError("network", "Could not reach the server.", { cause })
  }
}

function messageFromProtocolError(data: Record<string, unknown>) {
  return typeof data.message === "string" && data.message.trim().length > 0
    ? data.message
    : "The response failed while streaming."
}

export const chatTransport: ChatTransport = {
  getChatConfig() {
    return requestJson<ChatConfigWire>("/config")
  },

  async createSession({ sourceConfig }): Promise<CreatedSession> {
    const wire = await requestJson<CreateSessionWire>(
      "/sessions",
      jsonRequestInit("POST", {
        source_config: toWireSourceConfig(sourceConfig),
      }),
    )

    return {
      sessionId: wire.session_id,
      sourceConfig: fromWireSourceConfig(wire.source_config),
    }
  },

  async streamFirstMessage({
    sessionId,
    text,
    sourceConfig,
    signal,
    onEvent,
  }): Promise<StreamResult> {
    const response = await streamFetch(`/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      signal,
      body: JSON.stringify({
        text: text.trim(),
        source_config: toWireSourceConfig(sourceConfig),
      }),
    })

    if (!response.ok) {
      throw await errorFromResponse(response)
    }
    let protocolError: TransportError | null = null
    if (response.body) {
      await consumeSseStream(response.body, (event) => {
        onEvent?.(event)
        if (event.type === "error") {
          protocolError = new TransportError(
            "server",
            messageFromProtocolError(event.data),
          )
        }
      })
    }
    if (protocolError) {
      throw protocolError
    }

    return { accepted: true }
  },

  async cancelActiveTurn(sessionId) {
    const response = await streamFetch(`/sessions/${sessionId}/cancel`, {
      method: "POST",
    })
    if (response.status === 202 || response.status === 204) {
      return
    }
    if (!response.ok) {
      throw await errorFromResponse(response)
    }
  },
}
