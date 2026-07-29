import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ChatMessage } from "./ChatMessage";
import type { ClarifyDraftController } from "../useClarifyDraft";
import type { AssistantChatMessage, UserChatMessage } from "../model";

function userMessage(
  overrides: Partial<UserChatMessage> = {},
): UserChatMessage {
  return {
    kind: "user",
    messageId: "user-1",
    conversationId: "s1",
    parentMessageId: null,
    text: "How does financial aid work?",
    sender: "",
    ts: null,
    isCreatedByUser: true,
    skills: [],
    ...overrides,
  };
}

function assistantMessage(
  overrides: Partial<AssistantChatMessage> = {},
): AssistantChatMessage {
  const blocks = overrides.blocks ?? [
    { kind: "markdown" as const, text: "Aid depends on need [1]." },
  ];

  return {
    kind: "assistant",
    messageId: "assistant-1",
    conversationId: "s1",
    parentMessageId: "user-1",
    text: "Aid depends on need [1].",
    sender: "Counselle",
    ts: null,
    isCreatedByUser: false,
    blocks,
    runMarkdown: overrides.runMarkdown ?? "Aid depends on need [1].",
    segments: blocks.map((block) =>
      block.kind === "markdown"
        ? { type: "answer" as const, text: block.text }
        : { type: "viz" as const, spec: block.spec },
    ),
    turnStatus: "complete",
    sources: [
      {
        v: 2,
        index: 1,
        citation: {
          v: 2,
          source: "web",
          tier: "official",
          vintage: "2026",
          url: "https://example.com",
        },
        label: "Example",
        evidence: [],
        evidence_omitted_count: 0,
      },
    ],
    ...overrides,
  };
}

function setClipboard(value: Pick<Clipboard, "writeText"> | undefined) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value,
  });
}

function clarifyDraft(
  overrides: Partial<ClarifyDraftController> = {},
): ClarifyDraftController {
  return {
    draft: {
      currentQuestionIndex: 0,
      selectedOptionIds: [],
      customText: "",
      validationError: null,
      answersByQuestionId: {},
      sendState: "idle",
    },
    canSubmit: true,
    setCurrentQuestionIndex: vi.fn(),
    setSelectedOptionIds: vi.fn(),
    setCustomText: vi.fn(),
    setValidationError: vi.fn(),
    answerForQuestion: (questionId) =>
      overrides.draft?.answersByQuestionId?.[questionId] ?? {
        selectedOptionIds: overrides.draft?.selectedOptionIds ?? [],
        customText: overrides.draft?.customText ?? "",
        validationError: overrides.draft?.validationError ?? null,
      },
    setQuestionAnswer: vi.fn(),
    setQuestionValidationError: vi.fn(),
    markSending: vi.fn(),
    markChecking: vi.fn(),
    markAnswered: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  setClipboard(undefined);
});

describe("ChatMessage", () => {
  test("user message renders as a right-aligned bubble tagged with its message id", () => {
    render(<ChatMessage message={userMessage()} />);

    const bubble = screen
      .getByText("How does financial aid work?")
      .closest("[id]");
    expect(bubble).toHaveAttribute("id", "user-1");
    expect(bubble?.className).toContain("is-user");
  });

  test("renders historical skill chips with catalog labels and a slug fallback", () => {
    render(
      <ChatMessage
        message={userMessage({
          skills: ["school-comparison", "retired-skill"],
        })}
        skillLabelForName={(name) =>
          name === "school-comparison" ? "School comparison" : undefined
        }
      />,
    );

    expect(
      screen.getByRole("list", { name: "Invoked skills" }),
    ).toHaveTextContent("School comparison");
    expect(
      screen.getByRole("list", { name: "Invoked skills" }),
    ).toHaveTextContent("retired skill");
  });

  test("filters counseling mode skills from historical skill chips", () => {
    const message = userMessage({
      skills: ["focused-answer", "school-comparison", "guided-counselor"],
    });
    render(
      <ChatMessage
        message={message}
        modeSkillNames={["focused-answer", "guided-counselor"]}
        skillLabelForName={(name) =>
          name === "school-comparison" ? "School comparison" : undefined
        }
      />,
    );

    const invokedSkills = screen.getByRole("list", { name: "Invoked skills" });
    expect(invokedSkills).toHaveTextContent("School comparison");
    expect(invokedSkills).not.toHaveTextContent("Focused Answer");
    expect(invokedSkills).not.toHaveTextContent("guided counselor");
    expect(message.skills).toEqual([
      "focused-answer",
      "school-comparison",
      "guided-counselor",
    ]);
  });

  test("does not render an invoked-skill list when only a mode skill is present", () => {
    render(
      <ChatMessage
        message={userMessage({
          skills: ["focused-answer"],
        })}
        modeSkillNames={["focused-answer"]}
      />,
    );

    expect(
      screen.queryByRole("list", { name: "Invoked skills" }),
    ).not.toBeInTheDocument();
  });

  test("filters mode chips from config-derived names, not only locked slugs", () => {
    render(
      <ChatMessage
        message={userMessage({
          skills: ["future-response-mode", "retired-skill"],
        })}
        modeSkillNames={["future-response-mode"]}
      />,
    );

    const invokedSkills = screen.getByRole("list", { name: "Invoked skills" });
    expect(invokedSkills).not.toHaveTextContent("future response mode");
    expect(invokedSkills).toHaveTextContent("retired skill");
  });

  test("assistant message renders markdown content and message actions once settled", () => {
    const onFeedback = vi.fn();
    render(
      <ChatMessage message={assistantMessage()} onFeedback={onFeedback} />,
    );

    expect(screen.getByText(/Aid depends on need/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Good response" }));
    expect(onFeedback).toHaveBeenCalledWith("thumbsUp");

    fireEvent.click(screen.getByRole("button", { name: "Bad response" }));
    expect(onFeedback).toHaveBeenCalledWith("thumbsDown");
  });

  test("assistant message renders registered tool widgets inline between prose beats", () => {
    render(
      <ChatMessage
        message={assistantMessage({
          segments: [
            {
              type: "narration",
              id: "n1",
              text: "I'll add that to your task list.",
            },
            {
              type: "tool",
              step: {
                step_id: "task-1",
                status: "end",
                kind: "skill",
                label: "Adding a task",
                tier: null,
                detail: null,
                ui: {
                  widget: "task_added",
                  data: {
                    title: "Submit Duke financial aid forms",
                    school: "Duke University",
                    due_date: "2026-11-15",
                    status: "todo",
                  },
                },
              },
            },
            { type: "answer", text: "I added it to your workspace." },
          ],
          blocks: [{ kind: "markdown", text: "I added it to your workspace." }],
          text: "I added it to your workspace.",
        })}
      />,
    );

    expect(
      screen.getByText("I'll add that to your task list."),
    ).toBeInTheDocument();
    expect(screen.getByText("Task added")).toBeInTheDocument();
    expect(
      screen.getByText("Submit Duke financial aid forms"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("I added it to your workspace."),
    ).toBeInTheDocument();
  });

  test("passes live turn state to the active school-data row", () => {
    const schoolStep = {
      type: "tool" as const,
      step: {
        step_id: "school-1",
        status: "start" as const,
        kind: "db_tool" as const,
        tool: "resolve_school",
        label: "Finding “Yale”…",
        tier: "official" as const,
        detail: null,
      },
    };
    const streaming = assistantMessage({
      blocks: [],
      segments: [schoolStep],
      text: "",
      turnStatus: "streaming",
    });
    const persisted = assistantMessage({
      ...streaming,
      turnStatus: "complete",
    });

    const { container, rerender } = render(<ChatMessage message={streaming} />);
    expect(container.querySelector(".lucide-loader-circle")).toHaveClass(
      "motion-safe:animate-spin",
    );

    rerender(<ChatMessage message={persisted} />);
    expect(container.querySelector(".lucide-loader-circle")).not.toHaveClass(
      "motion-safe:animate-spin",
    );
  });

  test("keeps concurrent school-data starts live within the same streaming turn", () => {
    const schoolStep = (
      stepId: string,
      tool: "resolve_school" | "get_domain",
    ) => ({
      type: "tool" as const,
      step: {
        step_id: stepId,
        status: "start" as const,
        kind: "db_tool" as const,
        tool,
        label:
          tool === "resolve_school"
            ? "Finding “Yale”…"
            : "Reading Yale’s admissions data…",
        tier: "official" as const,
        detail: null,
      },
    });
    const streaming = assistantMessage({
      blocks: [],
      segments: [
        schoolStep("school-1", "resolve_school"),
        schoolStep("school-2", "get_domain"),
      ],
      text: "",
      turnStatus: "streaming",
    });

    const { container, rerender } = render(<ChatMessage message={streaming} />);
    expect(
      container.querySelectorAll(
        ".lucide-loader-circle.motion-safe\\:animate-spin",
      ),
    ).toHaveLength(2);

    rerender(
      <ChatMessage message={{ ...streaming, turnStatus: "complete" }} />,
    );
    expect(
      container.querySelectorAll(
        ".lucide-loader-circle.motion-safe\\:animate-spin",
      ),
    ).toHaveLength(0);
  });

  test("assistant message pins the latest write_plan checklist above the stream", () => {
    render(
      <ChatMessage
        message={assistantMessage({
          segments: [
            { type: "narration", id: "n1", text: "First, I will plan this." },
            {
              type: "tool",
              step: {
                step_id: "plan-1",
                status: "end",
                kind: "write_plan",
                label: "Updated the plan",
                tier: null,
                detail: {
                  completed: 1,
                  total: 2,
                  items: [
                    { content: "Check schools", status: "completed" },
                    { content: "Compare fit", status: "in_progress" },
                  ],
                },
              },
            },
            { type: "answer", text: "Then I will answer." },
          ],
          blocks: [{ kind: "markdown", text: "Then I will answer." }],
          text: "Then I will answer.",
        })}
      />,
    );

    expect(screen.getByText("Plan")).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByText("Check schools")).toBeInTheDocument();
    expect(screen.getByText("Compare fit")).toBeInTheDocument();

    const text = document.body.textContent ?? "";
    expect(text.indexOf("Plan")).toBeLessThan(
      text.indexOf("First, I will plan this."),
    );
  });

  test("assistant message suppresses the generic write_plan beat from the stream", () => {
    render(
      <ChatMessage
        message={assistantMessage({
          segments: [
            { type: "narration", id: "n1", text: "First, I will plan this." },
            {
              type: "tool",
              step: {
                step_id: "plan-1",
                status: "end",
                kind: "write_plan",
                label: "Updated the plan",
                tier: null,
                detail: {
                  completed: 1,
                  total: 2,
                  items: [
                    { content: "Check schools", status: "completed" },
                    { content: "Compare fit", status: "in_progress" },
                  ],
                },
              },
            },
            { type: "answer", text: "Then I will answer." },
          ],
          blocks: [{ kind: "markdown", text: "Then I will answer." }],
          text: "Then I will answer.",
        })}
      />,
    );

    expect(screen.queryByText("Updated the plan")).not.toBeInTheDocument();
  });

  test("empty live assistant run shows a visible starting row immediately", () => {
    render(
      <ChatMessage
        message={assistantMessage({
          blocks: [],
          runMarkdown: "",
          segments: [],
          text: "",
          turnStatus: "streaming",
        })}
      />,
    );

    expect(screen.getByText("Starting response...")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Thinking" }),
    ).not.toBeInTheDocument();
  });

  test("live final answer renders a streaming cursor", () => {
    render(
      <ChatMessage
        message={assistantMessage({
          segments: [{ type: "answer", text: "Streaming **answer**" }],
          blocks: [{ kind: "markdown", text: "Streaming **answer**" }],
          text: "Streaming answer",
          turnStatus: "streaming",
        })}
      />,
    );

    expect(screen.getByText("answer")).toBeInTheDocument();
    expect(screen.getByTestId("streaming-cursor")).toBeInTheDocument();
  });

  test("live final answer keeps the cursor on the latest answer when viz follows", () => {
    const spec = {
      v: 1,
      type: "stat_block",
      title: "Cost card",
      schools: [],
      rows: [],
    } as const;

    render(
      <ChatMessage
        message={assistantMessage({
          segments: [
            { type: "answer", text: "Streaming answer before the card." },
            { type: "viz", spec },
          ],
          blocks: [
            { kind: "markdown", text: "Streaming answer before the card." },
            { kind: "viz", spec },
          ],
          text: "Streaming answer before the card.",
          turnStatus: "streaming",
        })}
      />,
    );

    expect(
      screen.getByText("Streaming answer before the card."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("streaming-cursor")).toBeInTheDocument();
  });

  test("assistant message renders inline user beats inside the assistant row", () => {
    render(
      <ChatMessage
        message={assistantMessage({
          segments: [
            { type: "narration", id: "n1", text: "Checking costs." },
            {
              type: "user",
              id: "steer-1",
              text: "Also compare cost.",
              injected: true,
            },
            { type: "answer", text: "Cost comparison follows." },
          ],
          blocks: [{ kind: "markdown", text: "Cost comparison follows." }],
          text: "Cost comparison follows.",
        })}
      />,
    );

    const bubble = screen.getByText("Also compare cost.");
    expect(bubble).toBeInTheDocument();
    expect(bubble.closest("[id]")).toHaveAttribute("id", "assistant-1");
  });

  test("copy action copies the whole assistant run markdown", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    render(
      <ChatMessage
        message={assistantMessage({
          runMarkdown:
            "Checking official data.\n\n- Searching web: 2 results\n\nAid depends on need [1].",
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledWith(
      "Checking official data.\n\n- Searching web: 2 results\n\nAid depends on need [1].",
    );
  });

  test("copy action falls back to answer text when run markdown is empty", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    render(
      <ChatMessage
        message={assistantMessage({
          runMarkdown: "",
          text: "Answer-only copy.",
          blocks: [{ kind: "markdown", text: "Answer-only copy." }],
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledWith("Answer-only copy.");
  });

  test("copy action reports clipboard rejection without crashing", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    setClipboard({ writeText });

    render(<ChatMessage message={assistantMessage()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Copy failed" }),
      ).toBeInTheDocument();
    });
    expect(writeText).toHaveBeenCalledWith("Aid depends on need [1].");
    expect(
      screen.queryByRole("button", { name: "Copied" }),
    ).not.toBeInTheDocument();
  });

  test("a cancelled turn renders the stopped-response notice", () => {
    render(
      <ChatMessage
        message={assistantMessage({
          turnStatus: "cancelled",
          blocks: [{ kind: "markdown", text: "Partial" }],
        })}
      />,
    );

    expect(screen.getByText("You stopped this response.")).toBeInTheDocument();
  });

  test("a partial stream error renders inline after the partial prose, not only as a toast", () => {
    render(
      <ChatMessage
        message={assistantMessage({
          turnStatus: "error",
          streamError: {
            message: "Connection lost before the answer completed.",
          },
        })}
      />,
    );

    expect(screen.getByText(/Aid depends on need/)).toBeInTheDocument();
    expect(
      screen.getByText("Connection lost before the answer completed."),
    ).toBeInTheDocument();
  });

  test("clarify: a live clarify spec renders inline and answers route through onClarifyAnswer", () => {
    const onClarifyAnswer = vi.fn();
    render(
      <ChatMessage
        message={assistantMessage({
          turnStatus: "awaiting_input",
          blocks: [],
          clarify: {
            v: 1,
            question: "Which path?",
            header: "Narrow it down",
            multi_select: false,
            options: [{ label: "Financial aid", hint: "" }],
          },
        })}
        isLatestMessage
        onClarifyAnswer={onClarifyAnswer}
      />,
    );

    fireEvent.click(screen.getByText("Financial aid"));
    expect(onClarifyAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: "widget",
        text: "Financial aid",
        response: expect.objectContaining({ mode: "widget" }),
      }),
    );
  });

  test("clarify: a historical awaiting-input card is frozen and cannot answer", () => {
    const onClarifyAnswer = vi.fn();
    render(
      <ChatMessage
        message={assistantMessage({
          turnStatus: "awaiting_input",
          blocks: [],
          clarify: {
            v: 1,
            question: "Which path?",
            header: "Narrow it down",
            multi_select: false,
            options: [{ label: "Financial aid", hint: "" }],
          },
        })}
        isLatestMessage={false}
        onClarifyAnswer={onClarifyAnswer}
      />,
    );

    fireEvent.click(screen.getByText("Financial aid"));
    expect(onClarifyAnswer).not.toHaveBeenCalled();
  });

  test("clarify: v1 segment does not render the future-version fallback", () => {
    render(
      <ChatMessage
        message={assistantMessage({
          turnStatus: "awaiting_input",
          blocks: [],
          clarify: {
            v: 1,
            question: "Which path?",
            header: "Narrow it down",
            multi_select: false,
            options: [{ label: "Financial aid", hint: "" }],
          },
          segments: [
            {
              type: "clarify",
              spec: {
                v: 1,
                question: "Which path?",
                header: "Narrow it down",
                multi_select: false,
                options: [{ label: "Financial aid", hint: "" }],
              },
              response: null,
            },
          ],
        })}
        isLatestMessage
      />,
    );

    expect(screen.getByText("Which path?")).toBeInTheDocument();
    expect(screen.getByText("Financial aid")).toBeInTheDocument();
    expect(
      screen.queryByText("Clarifying question from a newer client version."),
    ).not.toBeInTheDocument();
  });

  test("clarify: v2 segment renders the actual question and answer in order", () => {
    render(
      <ChatMessage
        message={assistantMessage({
          blocks: [],
          clarify: {
            v: 2,
            questions: [
              {
                id: "q1",
                question: "Which term?",
                selection: "single",
                options: [
                  { id: "q1_o1", label: "Fall" },
                  { id: "q1_o2", label: "Spring" },
                ],
              },
            ],
          },
          segments: [
            { type: "narration", id: "narration-0", text: "One more detail." },
            {
              type: "clarify",
              spec: {
                v: 2,
                questions: [
                  {
                    id: "q1",
                    question: "Which term?",
                    selection: "single",
                    options: [
                      { id: "q1_o1", label: "Fall" },
                      { id: "q1_o2", label: "Spring" },
                    ],
                  },
                ],
              },
              response: {
                v: 2,
                mode: "widget",
                answers: [{ question_id: "q1", option_ids: ["q1_o1"] }],
              },
            },
          ],
        })}
      />,
    );

    expect(screen.getByText("One more detail.")).toBeInTheDocument();
    expect(screen.getByText("Which term?")).toBeInTheDocument();
    expect(screen.getByText(/Fall/)).toBeInTheDocument();
  });

  test("clarify: live v2 segment answers with real option ids", () => {
    const onClarifyAnswer = vi.fn();
    const draft = clarifyDraft({
      draft: {
        currentQuestionIndex: 0,
        selectedOptionIds: ["q1_o1"],
        customText: "",
        validationError: null,
        answersByQuestionId: {
          q1: {
            selectedOptionIds: ["q1_o1"],
            customText: "",
            validationError: null,
          },
        },
        sendState: "idle",
      },
    });
    render(
      <ChatMessage
        clarifyDraft={draft}
        isLatestMessage
        message={assistantMessage({
          blocks: [],
          turnStatus: "awaiting_input",
          clarify: {
            v: 2,
            questions: [
              {
                id: "q1",
                question: "Which term?",
                selection: "single",
                options: [
                  { id: "q1_o1", label: "Fall" },
                  { id: "q1_o2", label: "Spring" },
                ],
              },
            ],
          },
          segments: [
            {
              type: "clarify",
              spec: {
                v: 2,
                questions: [
                  {
                    id: "q1",
                    question: "Which term?",
                    selection: "single",
                    options: [
                      { id: "q1_o1", label: "Fall" },
                      { id: "q1_o2", label: "Spring" },
                    ],
                  },
                ],
              },
              response: null,
            },
          ],
        })}
        onClarifyAnswer={onClarifyAnswer}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send answers" }));

    expect(onClarifyAnswer).toHaveBeenCalledWith({
      origin: "widget",
      text: "Fall",
      response: {
        v: 2,
        mode: "widget",
        answers: [{ question_id: "q1", option_ids: ["q1_o1"] }],
      },
    });
  });

  test("clarify: future nested specs render a safe textual fallback", () => {
    render(
      <ChatMessage
        message={assistantMessage({
          blocks: [],
          clarify: { v: 42, shape: "future" },
          segments: [
            {
              type: "clarify",
              spec: { v: 42, shape: "future" },
              response: null,
            },
          ],
        })}
      />,
    );

    expect(
      screen.getByText("Clarifying question from a newer client version."),
    ).toBeInTheDocument();
  });

  test("regenerate action only appears when canRegenerate is true and calls onRegenerate", () => {
    const onRegenerate = vi.fn();
    const { rerender } = render(
      <ChatMessage
        canRegenerate={false}
        message={assistantMessage()}
        onRegenerate={onRegenerate}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Regenerate" }),
    ).not.toBeInTheDocument();

    rerender(
      <ChatMessage
        canRegenerate
        message={assistantMessage()}
        onRegenerate={onRegenerate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(onRegenerate).toHaveBeenCalled();
  });

  test("sources are hidden while a turn is still streaming", () => {
    render(
      <ChatMessage message={assistantMessage({ turnStatus: "streaming" })} />,
    );
    expect(screen.queryByText(/source/i)).not.toBeInTheDocument();
  });

  test("expanded thinking stays expanded when completion appends sources and actions", () => {
    const onFeedback = vi.fn();
    const streamingMessage = assistantMessage({
      blocks: [],
      runMarkdown: "I'll compare reputation and student life.",
      segments: [
        {
          type: "narration",
          id: "narration-0",
          text: "I'll compare reputation and student life.",
        },
        {
          type: "thinking",
          id: "thinking-0",
          text: "I need to compare prestige separately from campus fit.",
        },
      ],
      text: "",
      turnStatus: "streaming",
    });
    const completedMessage = assistantMessage({
      ...streamingMessage,
      blocks: [
        {
          kind: "markdown",
          text: "Both are strong for different reasons [1].",
        },
      ],
      runMarkdown:
        "I'll compare reputation and student life.\n\nBoth are strong for different reasons [1].",
      segments: [
        {
          type: "narration",
          id: "narration-0",
          text: "I'll compare reputation and student life.",
        },
        {
          type: "thinking",
          id: "thinking-0",
          text: "I need to compare prestige separately from campus fit.",
        },
        { type: "answer", text: "Both are strong for different reasons [1]." },
      ],
      text: "Both are strong for different reasons [1].",
      turnStatus: "complete",
    });

    const { rerender } = render(
      <ChatMessage message={streamingMessage} onFeedback={onFeedback} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Thinking" }));
    expect(
      screen.getByText(
        "I need to compare prestige separately from campus fit.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Copy" }),
    ).not.toBeInTheDocument();

    rerender(
      <ChatMessage message={completedMessage} onFeedback={onFeedback} />,
    );

    expect(screen.getByRole("button", { name: "Thought" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "I need to compare prestige separately from campus fit.",
      ),
    ).toBeVisible();
    expect(screen.queryByTestId("streaming-cursor")).not.toBeInTheDocument();

    const text = document.body.textContent ?? "";
    expect(
      text.indexOf("I'll compare reputation and student life."),
    ).toBeLessThan(
      text.indexOf("I need to compare prestige separately from campus fit."),
    );
    expect(
      text.indexOf("I need to compare prestige separately from campus fit."),
    ).toBeLessThan(text.indexOf("Both are strong for different reasons"));
    expect(text.indexOf("Both are strong for different reasons")).toBeLessThan(
      text.indexOf("1 source"),
    );
    expect(text.indexOf("1 source")).toBeLessThan(text.indexOf("Copy"));
    expect(text.indexOf("Copy")).toBeLessThan(text.indexOf("Good response"));
  });
});
