import { BASE } from "@/api/http/constants";
import { errorFromResponse, TransportError } from "@/api/http/errors";
import { jsonRequestInit, requestJson } from "@/api/http/client";
import type {
  AttachStreamResult,
  ChatConfigWire,
  ChatSession,
  ChatSessionList,
  ChatSessionSummary,
  ChatTransport,
  CreatedSession,
  ProtocolEvent,
  SendMessageInput,
  SourceConfigWire,
  SseFrame,
  StreamResult,
  TranscriptEntry,
} from "@/api/chat/types";
import {
  fromWireSourceConfig,
  toWireSourceConfig,
} from "@/api/chat/source-config";
import { parseSseStream } from "@/api/chat/sse";
import {
  clearStoredCursor,
  getStoredCursor,
  setStoredCursor,
} from "@/api/chat/cursor";

type CreateSessionWire = {
  session_id: string;
  source_config: SourceConfigWire | null;
};

type SessionRowWire = {
  session_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  source_config: SourceConfigWire | null;
  is_generating: boolean;
};

type SessionListWire = {
  sessions: SessionRowWire[];
  next_cursor: string | null;
};

type SessionDetailWire = SessionRowWire & {
  transcript: TranscriptEntry[];
};

function withBase(path: string) {
  if (path.startsWith(BASE)) {
    return path;
  }
  return `${BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

async function streamFetch(path: string, init: RequestInit = {}) {
  try {
    return await fetch(withBase(path), {
      ...init,
      credentials: "same-origin",
    });
  } catch (cause) {
    throw new TransportError("network", "Could not reach the server.", {
      cause,
    });
  }
}

function messageFromProtocolError(data: ProtocolEvent["data"]) {
  return "message" in data &&
    typeof data.message === "string" &&
    data.message.trim()
    ? data.message
    : "The response failed while streaming.";
}

function rowToSummary(row: SessionRowWire): ChatSessionSummary {
  return {
    sessionId: row.session_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceConfig: fromWireSourceConfig(row.source_config),
    isGenerating: row.is_generating,
  };
}

function detailToSession(row: SessionDetailWire): ChatSession {
  return {
    ...rowToSummary(row),
    transcript: row.transcript,
  };
}

async function* streamFrames(
  sessionId: string,
  response: Response,
): AsyncGenerator<SseFrame<ProtocolEvent>, void, undefined> {
  if (!response.body) {
    throw new TransportError(
      "server",
      "Stream response did not include a body.",
    );
  }

  let terminalSeen = false;
  for await (const frame of parseSseStream(response.body)) {
    if (frame.id !== undefined) {
      setStoredCursor(sessionId, frame.id);
    }
    if (frame.data.type === "done" || frame.data.type === "error") {
      terminalSeen = true;
      clearStoredCursor(sessionId);
    }
    yield frame;
  }
  if (!terminalSeen) {
    clearStoredCursor(sessionId);
    throw new TransportError(
      "network",
      "Stream ended before a terminal event.",
    );
  }
}

function sessionPath(sessionId: string) {
  return `/sessions/${encodeURIComponent(sessionId)}`;
}

export const UNTITLED_CHAT_TITLE = "Untitled";

export function normalizeChatTitle(title: string) {
  return title.trim() || UNTITLED_CHAT_TITLE;
}

export const chatTransport: ChatTransport = {
  getChatConfig() {
    return requestJson<ChatConfigWire>("/config");
  },

  async createSession({ sourceConfig }): Promise<CreatedSession> {
    const wire = await requestJson<CreateSessionWire>(
      "/sessions",
      jsonRequestInit("POST", {
        source_config: toWireSourceConfig(sourceConfig),
      }),
    );

    return {
      sessionId: wire.session_id,
      sourceConfig: fromWireSourceConfig(wire.source_config),
    };
  },

  async listSessions({ limit = 50, q, cursor } = {}): Promise<ChatSessionList> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (q?.trim()) {
      params.set("q", q.trim());
    }
    if (cursor) {
      params.set("cursor", cursor);
    }
    const wire = await requestJson<SessionListWire>(`/sessions?${params}`);
    return {
      sessions: wire.sessions.map(rowToSummary),
      nextCursor: wire.next_cursor,
    };
  },

  async getSession(sessionId): Promise<ChatSession> {
    const wire = await requestJson<SessionDetailWire>(sessionPath(sessionId));
    return detailToSession(wire);
  },

  async renameSession(sessionId, title) {
    const response = await streamFetch(sessionPath(sessionId), {
      ...jsonRequestInit("PATCH", { title: normalizeChatTitle(title) }),
    });
    if (!response.ok) {
      throw await errorFromResponse(response);
    }
  },

  async deleteSession(sessionId) {
    const response = await streamFetch(sessionPath(sessionId), {
      method: "DELETE",
    });
    if (response.status === 204) {
      clearStoredCursor(sessionId);
      return;
    }
    if (!response.ok) {
      throw await errorFromResponse(response);
    }
    clearStoredCursor(sessionId);
  },

  async *sendMessage({
    sessionId,
    text,
    sourceConfig,
    signal,
    replaceMessageId,
  }: SendMessageInput) {
    clearStoredCursor(sessionId);
    const response = await streamFetch(`${sessionPath(sessionId)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        text: text.trim(),
        source_config: toWireSourceConfig(sourceConfig),
        ...(replaceMessageId !== undefined
          ? { replace_message_id: replaceMessageId }
          : {}),
      }),
    });

    if (!response.ok) {
      throw await errorFromResponse(response);
    }
    yield* streamFrames(sessionId, response);
  },

  async attachStream({ sessionId, signal }): Promise<AttachStreamResult> {
    const cursor = getStoredCursor(sessionId);
    const response = await streamFetch(`${sessionPath(sessionId)}/stream`, {
      method: "GET",
      signal,
      headers: cursor ? { "Last-Event-ID": cursor } : undefined,
    });

    if (response.status === 204) {
      clearStoredCursor(sessionId);
      return { active: false };
    }
    if (!response.ok) {
      throw await errorFromResponse(response);
    }
    if (!response.body) {
      throw new TransportError(
        "server",
        "Stream response did not include a body.",
      );
    }
    return { active: true, stream: streamFrames(sessionId, response) };
  },

  async streamFirstMessage(input): Promise<StreamResult> {
    let protocolError: TransportError | null = null;
    for await (const frame of chatTransport.sendMessage(input)) {
      input.onEvent?.(frame.data);
      if (frame.data.type === "error") {
        protocolError = new TransportError(
          "server",
          messageFromProtocolError(frame.data.data),
        );
      }
    }
    if (protocolError) {
      throw protocolError;
    }
    return { accepted: true };
  },

  async cancelActiveTurn(sessionId) {
    const response = await streamFetch(`${sessionPath(sessionId)}/cancel`, {
      method: "POST",
    });
    if (response.status === 202 || response.status === 204) {
      return;
    }
    if (!response.ok) {
      throw await errorFromResponse(response);
    }
  },

  async setMessageFeedback({ sessionId, messageId, rating }) {
    const response = await streamFetch(
      `${sessionPath(sessionId)}/messages/${encodeURIComponent(messageId)}/feedback`,
      {
        ...jsonRequestInit("POST", { rating }),
      },
    );
    if (!response.ok) {
      throw await errorFromResponse(response);
    }
  },
};
