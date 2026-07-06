import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { ChatMessage } from "./ChatMessage";
import type { AssistantChatMessage, UserChatMessage } from "../model";

function userMessage(overrides: Partial<UserChatMessage> = {}): UserChatMessage {
  return {
    kind: "user",
    messageId: "user-1",
    conversationId: "s1",
    parentMessageId: null,
    text: "How does financial aid work?",
    sender: "",
    ts: null,
    isCreatedByUser: true,
    ...overrides,
  };
}

function assistantMessage(overrides: Partial<AssistantChatMessage> = {}): AssistantChatMessage {
  return {
    kind: "assistant",
    messageId: "assistant-1",
    conversationId: "s1",
    parentMessageId: "user-1",
    text: "Aid depends on need [1].",
    sender: "Counselle",
    ts: null,
    isCreatedByUser: false,
    blocks: [{ kind: "markdown", text: "Aid depends on need [1]." }],
    turnStatus: "complete",
    sources: [
      {
        index: 1,
        citation: { source: "web", tier: "official", vintage: "2026", url: "https://example.com" },
        label: "Example",
      },
    ],
    ...overrides,
  };
}

describe("ChatMessage", () => {
  test("user message renders as a right-aligned bubble tagged with its message id", () => {
    render(<ChatMessage message={userMessage()} />);

    const bubble = screen.getByText("How does financial aid work?").closest("[id]");
    expect(bubble).toHaveAttribute("id", "user-1");
    expect(bubble?.className).toContain("is-user");
  });

  test("assistant message renders markdown content and message actions once settled", () => {
    const onFeedback = vi.fn();
    render(<ChatMessage message={assistantMessage()} onFeedback={onFeedback} />);

    expect(screen.getByText(/Aid depends on need/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Good response" }));
    expect(onFeedback).toHaveBeenCalledWith("thumbsUp");

    fireEvent.click(screen.getByRole("button", { name: "Bad response" }));
    expect(onFeedback).toHaveBeenCalledWith("thumbsDown");
  });

  test("copy action copies the assistant's rendered text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<ChatMessage message={assistantMessage()} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledWith("Aid depends on need [1].");
  });

  test("a cancelled turn renders the stopped-response notice", () => {
    render(
      <ChatMessage
        message={assistantMessage({ turnStatus: "cancelled", blocks: [{ kind: "markdown", text: "Partial" }] })}
      />,
    );

    expect(screen.getByText("You stopped this response.")).toBeInTheDocument();
  });

  test("a partial stream error renders inline after the partial prose, not only as a toast", () => {
    render(
      <ChatMessage
        message={assistantMessage({
          turnStatus: "error",
          streamError: { message: "Connection lost before the answer completed." },
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
    expect(onClarifyAnswer).toHaveBeenCalledWith("Financial aid");
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

  test("regenerate action only appears when canRegenerate is true and calls onRegenerate", () => {
    const onRegenerate = vi.fn();
    const { rerender } = render(
      <ChatMessage canRegenerate={false} message={assistantMessage()} onRegenerate={onRegenerate} />,
    );
    expect(screen.queryByRole("button", { name: "Regenerate" })).not.toBeInTheDocument();

    rerender(
      <ChatMessage canRegenerate message={assistantMessage()} onRegenerate={onRegenerate} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(onRegenerate).toHaveBeenCalled();
  });

  test("sources are hidden while a turn is still streaming", () => {
    render(<ChatMessage message={assistantMessage({ turnStatus: "streaming" })} />);
    expect(screen.queryByText(/source/i)).not.toBeInTheDocument();
  });
});
