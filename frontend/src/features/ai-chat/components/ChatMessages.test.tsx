import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { ChatMessages } from "./ChatMessages";
import type { ChatMessage as ChatMessageModel } from "../model";

function user(messageId: string, text: string): ChatMessageModel {
  return {
    kind: "user",
    messageId,
    conversationId: "s1",
    parentMessageId: null,
    text,
    sender: "",
    ts: null,
    isCreatedByUser: true,
  };
}

function assistant(messageId: string, text: string): ChatMessageModel {
  return {
    kind: "assistant",
    messageId,
    conversationId: "s1",
    parentMessageId: null,
    text,
    sender: "Counselle",
    ts: null,
    isCreatedByUser: false,
    blocks: [{ kind: "markdown", text }],
    segments: [{ type: "answer", text }],
    turnStatus: "complete",
    hasBackendId: true,
  };
}

describe("ChatMessages", () => {
  test("empty active session renders a clean empty state", () => {
    render(
      <ChatMessages isSubmitting={false} messages={[]} sessionId="s1" />,
    );

    expect(screen.getByText("No messages yet")).toBeInTheDocument();
  });

  test("renders a flat message list in order, no branch tree", () => {
    render(
      <ChatMessages
        isSubmitting={false}
        messages={[user("u1", "Question one"), assistant("a1", "Answer one")]}
        sessionId="s1"
      />,
    );

    const rendered = screen.getAllByText(/Question one|Answer one/);
    expect(rendered.map((node) => node.textContent)).toEqual([
      "Question one",
      "Answer one",
    ]);
  });

  test("only the latest assistant message is eligible for regenerate", () => {
    const onRegenerate = vi.fn();
    render(
      <ChatMessages
        isSubmitting={false}
        messages={[
          user("u1", "Q1"),
          assistant("a1", "First answer"),
          user("u2", "Q2"),
          assistant("a2", "Second answer"),
        ]}
        onRegenerate={onRegenerate}
        sessionId="s1"
      />,
    );

    expect(screen.getAllByRole("button", { name: "Regenerate" })).toHaveLength(1);
  });
});
