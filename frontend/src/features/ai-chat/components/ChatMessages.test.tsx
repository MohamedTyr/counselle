import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { ChatMessages } from "./ChatMessages";
import type { GoalStepDetail } from "@/api/chat/types";
import type { ChatMessage as ChatMessageModel } from "../model";
import type { Segment, TurnStatus } from "../turn-reducer";

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
    runMarkdown: text,
    segments: [{ type: "answer", text }],
    turnStatus: "complete",
    hasBackendId: true,
  };
}

function goalStepDetail(overrides: Partial<GoalStepDetail> = {}): GoalStepDetail {
  return {
    phase: "check",
    statement: "Get into a reach school",
    status: null,
    iteration: 1,
    max_iterations: 5,
    criteria: [],
    critique: null,
    met_count: 0,
    total_count: 0,
    unchecked_count: 0,
    not_checked_note: "",
    requests_used: 1,
    requests_limit: 10,
    tokens_used: 100,
    tokens_limit: 10000,
    est_cost_usd: null,
    cost_limit_usd: null,
    elapsed_s: 1,
    ...overrides,
  };
}

function goalAssistant(
  messageId: string,
  turnStatus: TurnStatus,
  goalOverrides: Partial<GoalStepDetail> = {},
): ChatMessageModel {
  const segments: Segment[] = [
    {
      type: "tool",
      step: {
        step_id: "goal-1",
        status: "end",
        kind: "goal",
        label: "Goal",
        tier: null,
        detail: { goal: goalStepDetail(goalOverrides) },
      },
    },
  ];
  return {
    kind: "assistant",
    messageId,
    conversationId: "s1",
    parentMessageId: null,
    text: "",
    sender: "Counselle",
    ts: null,
    isCreatedByUser: false,
    blocks: [],
    runMarkdown: "",
    segments,
    turnStatus,
    hasBackendId: true,
  };
}

describe("ChatMessages", () => {
  test("empty active session renders a clean empty state", () => {
    render(<ChatMessages isSubmitting={false} messages={[]} sessionId="s1" />);

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

    expect(screen.getAllByRole("button", { name: "Regenerate" })).toHaveLength(
      1,
    );
  });

  test("an actively-streaming goal turn is not interrupted, per the real live id", () => {
    render(
      <ChatMessages
        isSubmitting
        liveMessageId="a1"
        messages={[goalAssistant("a1", "streaming")]}
        sessionId="s1"
      />,
    );

    expect(
      screen.getByText(/^(Starting|Working)$|still working$/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Interrupted before it finished")).not.toBeInTheDocument();
  });

  test("a persisted idle goal run with no final step is interrupted (crash replay)", () => {
    render(
      <ChatMessages
        isSubmitting={false}
        liveMessageId={null}
        messages={[goalAssistant("a1", "idle")]}
        sessionId="s1"
      />,
    );

    expect(screen.getByText("Interrupted before it finished")).toBeInTheDocument();
  });

  test("a goal run the student stopped says so, never that it was interrupted", () => {
    render(
      <ChatMessages
        isSubmitting={false}
        liveMessageId={null}
        messages={[goalAssistant("a1", "cancelled")]}
        sessionId="s1"
      />,
    );

    expect(screen.getByText("You stopped it")).toBeInTheDocument();
    expect(screen.queryByText("Interrupted before it finished")).not.toBeInTheDocument();
  });

  test("a settled goal run with a final step is not interrupted", () => {
    render(
      <ChatMessages
        isSubmitting={false}
        liveMessageId={null}
        messages={[
          goalAssistant("a1", "complete", {
            phase: "final",
            status: "achieved",
          }),
        ]}
        sessionId="s1"
      />,
    );

    expect(screen.getAllByText("All done").length).toBeGreaterThan(0);
    expect(screen.queryByText("Interrupted before it finished")).not.toBeInTheDocument();
  });
});
