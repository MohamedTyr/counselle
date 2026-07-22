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
  ResponseMode,
  SendMessageInput,
  SourceConfigWire,
  SseFrame,
  SteerMessageResult,
  StreamResult,
} from "@/api/chat/types";
import {
  fromWireSourceConfig,
  toWireSourceConfig,
} from "@/api/chat/source-config";
import { isResponseMode } from "@/api/chat/response-mode";
import { parseSseStream } from "@/api/chat/sse";
import { adaptStoredTranscript } from "@/api/chat/legacy-replay";
import {
  clearStoredCursor,
  getStoredCursor,
  setStoredCursor,
} from "@/api/chat/cursor";

type CreateSessionWire = {
  session_id: string;
  source_config: SourceConfigWire | null;
  response_mode?: string;
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

type SessionMetadataWire = {
  session_id: string;
  title: string | null;
  created_at: string;
  updated_at?: string;
  source_config: SourceConfigWire | null;
  is_generating?: boolean;
  response_mode?: string;
};

function responseModeFromWire(value: unknown): ResponseMode {
  return isResponseMode(value) ? value : "quick";
}

type SessionDetailResponseWire = SessionMetadataWire & {
  transcript?: unknown[];
};

type SteerQueuedWire = {
  status: "queued";
  user_message_id: string;
};

type SteerIdleWire = {
  status: "idle";
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

function isSessionRowWire(value: unknown): value is SessionRowWire {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const row = value as Partial<SessionRowWire>;
  return (
    typeof row.session_id === "string" &&
    (typeof row.title === "string" || row.title === null) &&
    typeof row.created_at === "string" &&
    typeof row.updated_at === "string" &&
    typeof row.is_generating === "boolean" &&
    isSourceConfigWire(row.source_config)
  );
}

function isSessionMetadataWire(value: unknown): value is SessionMetadataWire {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const row = value as Partial<SessionMetadataWire>;
  return (
    typeof row.session_id === "string" &&
    (typeof row.title === "string" || row.title === null) &&
    typeof row.created_at === "string" &&
    (row.updated_at === undefined || typeof row.updated_at === "string") &&
    (row.is_generating === undefined ||
      typeof row.is_generating === "boolean") &&
    isSourceConfigWire(row.source_config)
  );
}

function isSourceConfigWire(value: unknown): value is SourceConfigWire | null {
  if (value === null) {
    return true;
  }
  if (typeof value !== "object") {
    return false;
  }

  const config = value as Partial<SourceConfigWire>;
  return (
    typeof config.web === "boolean" &&
    typeof config.edu === "boolean" &&
    typeof config.reddit === "boolean" &&
    (config.reddit_subreddits === null ||
      (Array.isArray(config.reddit_subreddits) &&
        config.reddit_subreddits.every((item) => typeof item === "string")))
  );
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

function detailToSession(
  row: Partial<SessionDetailResponseWire>,
  fallbackSessionId: string,
): ChatSession {
  if (!isSessionMetadataWire(row) || row.session_id !== fallbackSessionId) {
    throw new TransportError(
      "server",
      "Session response did not match the requested conversation.",
    );
  }

  return {
    sessionId: row.session_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
    sourceConfig: fromWireSourceConfig(row.source_config),
    isGenerating: row.is_generating ?? false,
    responseMode: responseModeFromWire(row.response_mode),
    transcript: adaptStoredTranscript(
      (row as Partial<SessionDetailResponseWire>).transcript,
    ),
  };
}

function listRows(value: unknown): SessionRowWire[] {
  if (!Array.isArray(value)) {
    throw new TransportError("server", "Session list response was malformed.");
  }

  if (!value.every(isSessionRowWire)) {
    throw new TransportError("server", "Session list response was malformed.");
  }

  return value;
}

function isSteerQueuedWire(value: unknown): value is SteerQueuedWire {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const row = value as Partial<SteerQueuedWire>;
  return row.status === "queued" && typeof row.user_message_id === "string";
}

function isSteerIdleWire(value: unknown): value is SteerIdleWire {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as Partial<SteerIdleWire>).status === "idle"
  );
}

async function parseSteerJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (cause) {
    throw new TransportError("server", "Steer response was malformed.", {
      cause,
      status: response.status,
    });
  }
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

  async createSession({ sourceConfig, responseMode }): Promise<CreatedSession> {
    const wire = await requestJson<CreateSessionWire>(
      "/sessions",
      jsonRequestInit("POST", {
        source_config: toWireSourceConfig(sourceConfig),
        ...(responseMode !== undefined ? { response_mode: responseMode } : {}),
      }),
    );

    return {
      sessionId: wire.session_id,
      sourceConfig: fromWireSourceConfig(wire.source_config),
      responseMode: responseModeFromWire(wire.response_mode),
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
      sessions: listRows(wire.sessions).map((row) => rowToSummary(row)),
      nextCursor:
        typeof wire.next_cursor === "string" ? wire.next_cursor : null,
    };
  },

  async getSession(sessionId): Promise<ChatSession> {
    const wire = await requestJson<Partial<SessionDetailResponseWire>>(
      sessionPath(sessionId),
    );
    return detailToSession(wire, sessionId);
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
    skills,
    signal,
    replaceMessageId,
    responseMode,
  }: SendMessageInput) {
    clearStoredCursor(sessionId);
    const response = await streamFetch(`${sessionPath(sessionId)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        text: text.trim(),
        source_config: toWireSourceConfig(sourceConfig),
        ...(skills !== undefined ? { skills } : {}),
        ...(replaceMessageId !== undefined
          ? { replace_message_id: replaceMessageId }
          : {}),
        ...(responseMode !== undefined ? { response_mode: responseMode } : {}),
      }),
    });

    if (!response.ok) {
      throw await errorFromResponse(response);
    }
    yield* streamFrames(sessionId, response);
  },

  async steerMessage({ sessionId, text }): Promise<SteerMessageResult> {
    const response = await streamFetch(`${sessionPath(sessionId)}/steer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.trim() }),
    });

    if (response.status === 202) {
      const wire = await parseSteerJson(response);
      if (!isSteerQueuedWire(wire)) {
        throw new TransportError("server", "Steer response was malformed.", {
          status: response.status,
        });
      }
      return { status: "queued", userMessageId: wire.user_message_id };
    }

    if (response.status === 409) {
      const wire = await parseSteerJson(response);
      if (isSteerIdleWire(wire)) {
        return { status: "idle" };
      }
    }

    throw await errorFromResponse(response);
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
