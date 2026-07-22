import { QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { BUILT_IN_SOURCE_CONFIG } from "@/api/chat/source-config";
import type {
  ChatSession,
  ChatTransport,
  ProtocolEvent,
  SseFrame,
} from "@/api/chat/types";
import { createTestQueryClient } from "@/test/render-app";
import { adaptStoredTranscript } from "@/api/chat/legacy-replay";
import legacyRaw from "../../../../tests/fixtures/protocol/legacy_v1_completed_turn.json?raw";

import { AiChatPage, type AiChatPageProps } from "./AiChatPage";

type MockedChatTransport = {
  [K in keyof ChatTransport]: ReturnType<typeof vi.fn<ChatTransport[K]>>;
};

const fakeTransport: MockedChatTransport = vi.hoisted(() => ({
  getChatConfig: vi.fn<ChatTransport["getChatConfig"]>(),
  createSession: vi.fn<ChatTransport["createSession"]>(),
  listSessions: vi.fn<ChatTransport["listSessions"]>(),
  getSession: vi.fn<ChatTransport["getSession"]>(),
  renameSession: vi.fn<ChatTransport["renameSession"]>(),
  deleteSession: vi.fn<ChatTransport["deleteSession"]>(),
  sendMessage: vi.fn<ChatTransport["sendMessage"]>(),
  steerMessage: vi.fn<ChatTransport["steerMessage"]>(async () => ({
    status: "queued",
    userMessageId: "steer-1",
  })),
  attachStream: vi.fn<ChatTransport["attachStream"]>(async () => ({
    active: false as const,
  })),
  streamFirstMessage: vi.fn<ChatTransport["streamFirstMessage"]>(),
  cancelActiveTurn: vi.fn<ChatTransport["cancelActiveTurn"]>(
    async () => undefined,
  ),
  setMessageFeedback: vi.fn<ChatTransport["setMessageFeedback"]>(
    async () => undefined,
  ),
}));

// `@/api/chat/hooks`' react-query `useChatSession` (session query) and
// `useMessageFeedback` both call the `chatTransport` singleton directly
// (they are not parameterized by the `transport` prop threaded through
// `useTurnEngine`) — mock the module so both the query layer and the turn
// engine observe the same fake backend.
vi.mock("@/api/chat/transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/chat/transport")>();
  return { ...actual, chatTransport: fakeTransport };
});

function session(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    sessionId: "s1",
    title: "Financial aid options",
    createdAt: "2026-07-06T12:00:00Z",
    updatedAt: "2026-07-06T12:00:01Z",
    sourceConfig: BUILT_IN_SOURCE_CONFIG,
    isGenerating: false,
    transcript: [],
    ...overrides,
  };
}

function meta(
  overrides: Partial<{ messageId: string; userMessageId: string }> = {},
): ProtocolEvent {
  return {
    v: 1,
    type: "meta",
    data: {
      trace_id: "trace-1",
      session_id: "s1",
      model: "test-model",
      message_id: overrides.messageId ?? "assistant-1",
      user_message_id: overrides.userMessageId ?? "user-1",
    },
  };
}

function delta(text: string): ProtocolEvent {
  return { v: 1, type: "delta", data: { text } };
}

function done(
  status: "complete" | "cancelled" | "awaiting_input" = "complete",
): ProtocolEvent {
  return { v: 1, type: "done", data: { status } };
}

function clarify(): ProtocolEvent {
  return {
    v: 1,
    type: "clarify",
    data: {
      v: 1,
      question: "Which path interests you?",
      header: "Narrow it down",
      multi_select: false,
      options: [
        { label: "Financial aid", hint: "Grants & loans" },
        { label: "Scholarships", hint: "Merit-based" },
      ],
    },
  };
}

function clarifyV2(): ProtocolEvent {
  return {
    v: 1,
    type: "clarify",
    data: {
      v: 2,
      questions: [
        {
          id: "q1",
          question: "Which path interests you?",
          selection: "single",
          options: [
            { id: "q1_o1", label: "Financial aid", hint: "Grants & loans" },
            { id: "q1_o2", label: "Scholarships", hint: "Merit-based" },
          ],
        },
      ],
    },
  };
}

async function* replay(
  events: ProtocolEvent[],
): AsyncGenerator<SseFrame<ProtocolEvent>, void, undefined> {
  for (const event of events) {
    yield { data: event };
  }
}

/** A stream the test can push events into on demand — for scenarios (cancel,
 *  clarify) where the assistant's turn must stay open until the test drives
 *  it forward. */
function controllableStream() {
  const queue: ProtocolEvent[] = [];
  let resolveNext: (() => void) | null = null;
  let closed = false;

  const push = (event: ProtocolEvent) => {
    queue.push(event);
    resolveNext?.();
  };
  const close = () => {
    closed = true;
    resolveNext?.();
  };

  async function* stream(): AsyncGenerator<
    SseFrame<ProtocolEvent>,
    void,
    undefined
  > {
    for (;;) {
      if (queue.length > 0) {
        const event = queue.shift();
        if (event) {
          yield { data: event };
        }
        continue;
      }
      if (closed) {
        return;
      }
      await new Promise<void>((resolve) => {
        resolveNext = resolve;
      });
    }
  }

  return { stream: stream(), push, close };
}

function renderPage(
  sessionId = "s1",
  props: Partial<Omit<AiChatPageProps, "sessionId" | "transport">> = {},
) {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <AiChatPage sessionId={sessionId} transport={fakeTransport} {...props} />
    </QueryClientProvider>,
  );
}

describe("AiChatPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeTransport.attachStream.mockResolvedValue({ active: false });
    fakeTransport.getChatConfig.mockResolvedValue({
      greeting: "Welcome",
      season_note: null,
      conversation_starters: [],
      default_source_config: null,
      skills: [],
      max_selected_skills: 3,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("hydrates a persisted transcript", async () => {
    fakeTransport.getSession.mockResolvedValue(
      session({
        transcript: [
          {
            role: "user",
            message_id: "user-1",
            text: "How does aid work?",
            ts: null,
          },
          {
            role: "assistant",
            message_id: "assistant-1",
            text: "Aid depends on need.",
            status: "complete",
            ts: null,
          },
        ],
      }),
    );

    renderPage();

    expect(await screen.findByText("How does aid work?")).toBeInTheDocument();
    expect(screen.getByText("Aid depends on need.")).toBeInTheDocument();
  });

  test("renders the persisted historical v1 fixture through the current chat UI", async () => {
    const fixture = JSON.parse(legacyRaw) as {
      turn_records: Array<Record<string, unknown>>;
    };
    const turn = fixture.turn_records[0]!;
    const [source] = turn.sources as Array<Record<string, unknown>>;
    const transcript = adaptStoredTranscript([
      {
        role: "user",
        text: turn.user_text,
        ts: null,
        message_id: turn.user_message_id,
      },
      {
        role: "assistant",
        text: "The legacy display was 7% [1].",
        ts: null,
        message_id: turn.message_id,
        parts: turn.parts,
        status: "complete",
        sources: [
          {
            ...source,
            v: 1,
            citation: { ...(source?.citation as object), v: 1 },
          },
        ],
      },
    ]);
    fakeTransport.getSession.mockResolvedValue(session({ transcript }));

    renderPage();

    expect(
      await screen.findByText("What was the old admission rate?"),
    ).toBeInTheDocument();
    expect(screen.getByText(/The legacy display was 7%/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open source: ipeds" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/couldn't load this conversation/i),
    ).not.toBeInTheDocument();
  });

  test("opens exact CDS evidence from a rendered cell and leaves unavailable cells inert", async () => {
    const citation = {
      v: 2 as const,
      source: "cds" as const,
      tier: "official" as const,
      vintage: "Common Data Set 2024-25",
      url: null,
      document_sha256: "a".repeat(64),
      source_kind: "upload",
      retrieved_at: "2026-07-15T00:00:00+00:00",
      academic_year: 2024,
      manifest_version: "5.0.1",
      school_unitid: 198419,
      profile_sha256: null,
    };
    const evidence = {
      eid: "admissions.acceptance_rate",
      value_display: "6.8%",
      label: "Acceptance rate",
      page: 7,
      section: "C1",
      excerpt: "Applicants admitted: 6.8%",
    };
    const spec = {
      v: 2 as const,
      type: "comparison_table" as const,
      title: "Admissions",
      columns: [
        { unitid: 198419, name: "Duke University", domain: "duke.edu" },
        { unitid: null, name: "Web College", domain: null },
      ],
      rows: [
        {
          label: "Acceptance rate",
          cells: [
            {
              v: 2 as const,
              field: evidence.eid,
              label: evidence.label,
              display: evidence.value_display,
              raw: 0.068,
              available: true as const,
              unit: "percent",
              citation,
              evidence,
              caveats: [],
              marker: "[2]",
            },
            {
              v: 2 as const,
              field: null,
              label: "Acceptance rate",
              display: "not available" as const,
              raw: null,
              available: false as const,
              unit: null,
              citation: null,
              evidence: null,
              caveats: [],
              marker: null,
            },
          ],
        },
      ],
    };
    fakeTransport.getSession.mockResolvedValue(
      session({
        transcript: [
          {
            role: "assistant",
            message_id: "assistant-evidence",
            text: "",
            ts: null,
            status: "complete",
            parts: [{ type: "viz", spec }],
            sources: [
              {
                v: 2,
                index: 2,
                citation,
                label: "Duke University — Common Data Set 2024-25",
                snippet: null,
                evidence: [evidence],
                evidence_omitted_count: 0,
              },
            ],
          },
        ],
      }),
    );

    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Open official source 2" }),
    );

    const exact = document.getElementById(
      "source-evidence-2-admissions.acceptance_rate",
    );
    await waitFor(() => expect(exact).toHaveFocus());
    expect(exact).toHaveAttribute("data-active", "true");
    expect(screen.getByText("not available")).not.toHaveRole("button");
  });

  test("empty active session renders the empty state plus a usable composer", async () => {
    fakeTransport.getSession.mockResolvedValue(session());

    renderPage();

    expect(await screen.findByText("No messages yet")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Message Counselle"),
    ).toBeInTheDocument();
  });

  test("transcript load failure shows a recoverable banner with retry, not a crash", async () => {
    fakeTransport.getSession
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(session());

    renderPage();

    expect(
      await screen.findByText(/couldn't load this conversation/i),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("No messages yet")).toBeInTheDocument();
  });

  test("sending a follow-up appends an optimistic user bubble and streams the assistant answer", async () => {
    fakeTransport.getSession.mockResolvedValue(session());
    const controlled = controllableStream();
    fakeTransport.sendMessage.mockReturnValue(controlled.stream);

    renderPage();
    await screen.findByText("No messages yet");

    const textarea = screen.getByPlaceholderText("Message Counselle");
    fireEvent.change(textarea, { target: { value: "Tell me about aid" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(await screen.findByText("Tell me about aid")).toBeInTheDocument();
    controlled.push(meta());
    controlled.push(delta("Here's how aid works."));
    controlled.push(done());
    controlled.close();
    expect(
      await screen.findByText("Here's how aid works."),
    ).toBeInTheDocument();
    expect(fakeTransport.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "s1", text: "Tell me about aid" }),
    );
  });

  test("submits a routed initial prompt once after the empty session loads", async () => {
    const onInitialPromptConsumed = vi.fn();
    fakeTransport.getSession.mockResolvedValue(session());
    const controlled = controllableStream();
    fakeTransport.sendMessage.mockReturnValue(controlled.stream);

    renderPage("s1", {
      initialPrompt: "Compare aid",
      onInitialPromptConsumed,
    });

    expect(await screen.findByText("Compare aid")).toBeInTheDocument();
    controlled.push(meta());
    controlled.push(delta("Initial answer"));
    expect(await screen.findByText("Initial answer")).toBeInTheDocument();
    expect(onInitialPromptConsumed).toHaveBeenCalledTimes(1);
    expect(fakeTransport.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "s1", text: "Compare aid" }),
    );
    controlled.push(done());
    controlled.close();
  });

  test("Shift+Enter inserts a newline instead of sending", async () => {
    fakeTransport.getSession.mockResolvedValue(session());
    renderPage();
    await screen.findByText("No messages yet");

    const textarea = screen.getByPlaceholderText("Message Counselle");
    fireEvent.change(textarea, { target: { value: "line one" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    expect(fakeTransport.sendMessage).not.toHaveBeenCalled();
  });

  test("reattaching an active stream on open does not duplicate the assistant bubble", async () => {
    fakeTransport.getSession.mockResolvedValue(
      session({
        transcript: [
          { role: "user", message_id: "user-1", text: "Question", ts: null },
        ],
      }),
    );
    fakeTransport.attachStream.mockResolvedValue({
      active: true,
      stream: replay([
        meta({ userMessageId: "user-1" }),
        delta("Answer continues"),
        done(),
      ]),
    });

    renderPage();

    await waitFor(() => {
      const assistants = screen.getAllByText(/Answer continues/);
      expect(assistants).toHaveLength(1);
    });
  });

  test("stopping an active stream calls cancel and renders the cancelled message", async () => {
    fakeTransport.getSession.mockResolvedValue(session());
    const controlled = controllableStream();
    fakeTransport.sendMessage.mockReturnValue(controlled.stream);
    fakeTransport.cancelActiveTurn.mockImplementation(async () => {
      controlled.push(done("cancelled"));
      controlled.close();
    });

    renderPage();
    await screen.findByText("No messages yet");

    fireEvent.change(screen.getByPlaceholderText("Message Counselle"), {
      target: { value: "Tell me about aid" },
    });
    fireEvent.keyDown(screen.getByPlaceholderText("Message Counselle"), {
      key: "Enter",
    });

    controlled.push(meta());
    controlled.push(delta("Partial answer"));

    const stopButton = await screen.findByRole("button", { name: "Stop" });
    fireEvent.click(stopButton);

    expect(fakeTransport.cancelActiveTurn).toHaveBeenCalledWith("s1");
    expect(
      await screen.findByText("You stopped this response."),
    ).toBeInTheDocument();
  });

  test("clarify: an inline widget appears, and a normal composer submission answers it", async () => {
    fakeTransport.getSession.mockResolvedValue(session());
    fakeTransport.sendMessage
      .mockReturnValueOnce(replay([meta(), clarify(), done("awaiting_input")]))
      .mockReturnValueOnce(
        replay([
          meta({ messageId: "assistant-2" }),
          delta("Great, let's talk aid."),
          done(),
        ]),
      );

    renderPage();
    await screen.findByText("No messages yet");

    fireEvent.change(screen.getByPlaceholderText("Message Counselle"), {
      target: { value: "Help me choose" },
    });
    fireEvent.keyDown(screen.getByPlaceholderText("Message Counselle"), {
      key: "Enter",
    });

    expect(
      await screen.findByText("Which path interests you?"),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Pick one, or just type..."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("Financial aid"));

    expect(
      await screen.findByText("Great, let's talk aid."),
    ).toBeInTheDocument();
    expect(fakeTransport.sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: "",
        inReplyTo: "assistant-1",
        clarifyResponse: expect.objectContaining({ mode: "widget" }),
        sourceConfig: undefined,
        skills: undefined,
      }),
    );
  });

  test("clarify: composer reply sends in_reply_to and omits turn settings", async () => {
    fakeTransport.getSession.mockResolvedValue(session());
    fakeTransport.sendMessage
      .mockReturnValueOnce(replay([meta(), clarifyV2(), done("awaiting_input")]))
      .mockReturnValueOnce(
        replay([
          meta({ messageId: "assistant-2" }),
          delta("Great, let's talk aid."),
          done(),
        ]),
      );

    renderPage();
    await screen.findByText("No messages yet");

    fireEvent.change(screen.getByPlaceholderText("Message Counselle"), {
      target: { value: "Help me choose" },
    });
    fireEvent.keyDown(screen.getByPlaceholderText("Message Counselle"), {
      key: "Enter",
    });

    expect(
      await screen.findByText("Which path interests you?"),
    ).toBeInTheDocument();

    fireEvent.change(
      screen.getByRole("combobox", { name: "Message Counselle" }),
      {
        target: { value: "I care most about grants" },
      },
    );
    fireEvent.keyDown(
      screen.getByRole("combobox", { name: "Message Counselle" }),
      {
        key: "Enter",
      },
    );

    expect(
      await screen.findByText("Great, let's talk aid."),
    ).toBeInTheDocument();
    expect(fakeTransport.sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: "I care most about grants",
        inReplyTo: "assistant-1",
        clarifyResponse: undefined,
        sourceConfig: undefined,
        skills: undefined,
        responseMode: undefined,
      }),
    );
  });

  test("clarify: current v2 card submits a structured widget answer", async () => {
    fakeTransport.getSession.mockResolvedValue(session());
    fakeTransport.sendMessage
      .mockReturnValueOnce(replay([meta(), clarifyV2(), done("awaiting_input")]))
      .mockReturnValueOnce(
        replay([
          meta({ messageId: "assistant-2" }),
          delta("Great, let's talk aid."),
          done(),
        ]),
      );

    renderPage();
    await screen.findByText("No messages yet");

    fireEvent.change(screen.getByPlaceholderText("Message Counselle"), {
      target: { value: "Help me choose" },
    });
    fireEvent.keyDown(screen.getByPlaceholderText("Message Counselle"), {
      key: "Enter",
    });

    expect(
      await screen.findByText("Which path interests you?"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("Financial aid"));
    fireEvent.click(screen.getAllByRole("button", { name: "Send" })[0]!);

    expect(
      await screen.findByText("Great, let's talk aid."),
    ).toBeInTheDocument();
    expect(fakeTransport.sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: "",
        inReplyTo: "assistant-1",
        clarifyResponse: {
          v: 2,
          mode: "widget",
          answers: [{ question_id: "q1", option_ids: ["q1_o1"] }],
        },
        sourceConfig: undefined,
        skills: undefined,
        responseMode: undefined,
      }),
    );
  });

  test("feedback: clicking thumbs up persists through the feedback endpoint", async () => {
    fakeTransport.getSession.mockResolvedValue(
      session({
        transcript: [
          { role: "user", message_id: "user-1", text: "Question", ts: null },
          {
            role: "assistant",
            message_id: "assistant-1",
            text: "Answer",
            status: "complete",
            ts: null,
          },
        ],
      }),
    );

    renderPage();
    await screen.findByText("Answer");

    fireEvent.click(screen.getByRole("button", { name: "Good response" }));

    await waitFor(() =>
      expect(fakeTransport.setMessageFeedback).toHaveBeenCalledWith({
        sessionId: "s1",
        messageId: "assistant-1",
        rating: "up",
      }),
    );
  });

  test("message source opens the shared sources rail focused on that source", async () => {
    fakeTransport.getSession.mockResolvedValue(
      session({
        transcript: [
          { role: "user", message_id: "user-1", text: "Question", ts: null },
          {
            role: "assistant",
            message_id: "assistant-1",
            text: "Answer [1]",
            parts: [{ type: "text", text: "Answer [1]" }],
            status: "complete",
            sources: [
              {
                v: 2,
                index: 1,
                citation: {
                  v: 2,
                  source: "web",
                  tier: "official",
                  vintage: "2026",
                  url: "https://example.com/source",
                },
                label: "Example",
                evidence: [],
                evidence_omitted_count: 0,
              },
            ],
            ts: null,
          },
        ],
      }),
    );

    renderPage();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "View 1 source for this answer",
      }),
    );

    expect(
      await screen.findByRole("heading", { name: "1 source" }),
    ).toBeInTheDocument();
    expect(document.getElementById("source-row-1")).toBeInTheDocument();
  });

  test("regenerate rewrites from the parent user message id", async () => {
    fakeTransport.getSession.mockResolvedValue(
      session({
        transcript: [
          {
            role: "user",
            message_id: "user-1",
            text: "Original question",
            ts: null,
          },
          {
            role: "assistant",
            message_id: "assistant-1",
            text: "Original answer",
            status: "complete",
            ts: null,
          },
        ],
      }),
    );
    fakeTransport.sendMessage.mockReturnValue(
      replay([
        meta({ messageId: "assistant-2", userMessageId: "user-1" }),
        delta("New answer"),
        done(),
      ]),
    );

    renderPage();
    await screen.findByText("Original answer");

    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));

    await waitFor(() =>
      expect(fakeTransport.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "Original question",
          replaceMessageId: "user-1",
        }),
      ),
    );
  });

  test("active send steers the running turn instead of cancelling it", async () => {
    fakeTransport.getSession.mockResolvedValue(session());
    const first = controllableStream();
    fakeTransport.sendMessage.mockReturnValueOnce(first.stream);
    fakeTransport.steerMessage.mockResolvedValueOnce({
      status: "queued",
      userMessageId: "steer-1",
    });

    renderPage();
    await screen.findByText("No messages yet");

    const textarea = screen.getByPlaceholderText("Message Counselle");
    fireEvent.change(textarea, { target: { value: "First question" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    first.push(meta());

    await waitFor(() =>
      expect(fakeTransport.sendMessage).toHaveBeenCalledTimes(1),
    );

    fireEvent.change(textarea, { target: { value: "Second question" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() =>
      expect(fakeTransport.steerMessage).toHaveBeenCalledWith({
        sessionId: "s1",
        text: "Second question",
      }),
    );
    expect(fakeTransport.cancelActiveTurn).not.toHaveBeenCalled();
    first.close();
  });

  test("selecting a subreddit subset is preserved on the next send", async () => {
    fakeTransport.getSession.mockResolvedValue(session());
    fakeTransport.sendMessage.mockReturnValue(
      replay([meta(), delta("ok"), done()]),
    );

    renderPage();
    await screen.findByText("No messages yet");

    // Reddit is on by default (BUILT_IN_SOURCE_CONFIG) — the subreddit menu
    // toggle is already visible without needing to enable Reddit first.
    fireEvent.click(screen.getByRole("button", { name: /Sources:/ }));
    const menu = screen.getByRole("menu");
    fireEvent.click(
      within(menu).getByRole("menuitemcheckbox", { name: "chanceme" }),
    );

    const textarea = screen.getByPlaceholderText("Message Counselle");
    fireEvent.change(textarea, { target: { value: "Reddit question" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() =>
      expect(fakeTransport.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceConfig: expect.objectContaining({
            reddit: true,
            selectedSubreddits: expect.not.arrayContaining(["r/chanceme"]),
          }),
        }),
      ),
    );
  });

  test("normalizes a stale sticky Think session to Quick when Think is unavailable", async () => {
    fakeTransport.getChatConfig.mockResolvedValue({
      greeting: "Welcome",
      season_note: null,
      conversation_starters: [],
      default_source_config: null,
      skills: [],
      max_selected_skills: 0,
      default_response_mode: "quick",
      response_modes: [
        {
          id: "quick",
          model: "google-vertex:gemini-3.5-flash",
          model_display_name: "Gemini 3.5 Flash",
          preview: false,
        },
      ],
    });
    fakeTransport.getSession.mockResolvedValue(
      session({ responseMode: "think" }),
    );
    fakeTransport.sendMessage.mockReturnValue(
      replay([meta(), delta("ok"), done()]),
    );

    renderPage();
    await screen.findByText("No messages yet");
    expect(
      screen.getByRole("button", { name: "Response mode: Quick" }),
    ).toBeInTheDocument();

    const textarea = screen.getByPlaceholderText("Message Counselle");
    fireEvent.change(textarea, { target: { value: "Aid question" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() =>
      expect(fakeTransport.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ responseMode: "quick" }),
      ),
    );
  });
});
