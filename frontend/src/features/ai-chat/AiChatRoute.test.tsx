import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, test, vi } from "vitest";

import type { AiChatPageProps } from "./AiChatPage";
import { AiChatRoute } from "./AiChatRoute";

const receivedProps: AiChatPageProps[] = [];

vi.mock("./AiChatPage", () => ({
  AiChatPage: (props: AiChatPageProps) => {
    receivedProps.push(props);
    return (
      <div data-testid="initial-turn">
        {JSON.stringify(props.initialTurn ?? null)}
      </div>
    );
  },
}));

function renderRoute(state: unknown) {
  receivedProps.length = 0;
  render(
    <MemoryRouter
      initialEntries={[{ pathname: "/app/ai/session-1", state }]}
    >
      <Routes>
        <Route path="/app/ai/:sessionId" element={<AiChatRoute />} />
      </Routes>
    </MemoryRouter>,
  );
}

/*
 * Router state is untrusted input -- it can be replayed, hand-edited, or
 * arrive from an old build. `initialTurnFromState` must arm goal mode only
 * on a genuine `goalMode: true`, never guess on anything else, since falsely
 * arming a long, autonomous, workspace-writing run is far worse than failing
 * to arm one (plan: goal-mode new-chat gap).
 */
describe("AiChatRoute — initial turn goalMode parsing", () => {
  test("a /goal-armed new chat carries goalMode: true through to AiChatPage", () => {
    renderRoute({
      initialTurn: {
        text: "Help me plan my applications",
        skills: [],
        responseMode: "quick",
        goalMode: true,
      },
    });

    const parsed = JSON.parse(
      screen.getByTestId("initial-turn").textContent ?? "null",
    );
    expect(parsed.goalMode).toBe(true);
  });

  test("a normally-started new chat sends no goalMode", () => {
    renderRoute({
      initialTurn: {
        text: "What's a good safety school?",
        skills: [],
        responseMode: "quick",
      },
    });

    const parsed = JSON.parse(
      screen.getByTestId("initial-turn").textContent ?? "null",
    );
    expect(parsed.goalMode).toBeUndefined();
  });

  test("a malformed goalMode in router state does not arm goal mode", () => {
    renderRoute({
      initialTurn: {
        text: "What's a good safety school?",
        skills: [],
        responseMode: "quick",
        goalMode: "true",
      },
    });

    const parsed = JSON.parse(
      screen.getByTestId("initial-turn").textContent ?? "null",
    );
    expect(parsed.goalMode).toBeUndefined();
  });
});
