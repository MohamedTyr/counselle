import { useCallback } from "react";
import { useLocation, useNavigate, useParams } from "react-router";

import type { ResponseMode } from "@/api/chat/types";
import { isResponseMode } from "@/api/chat/response-mode";

import { AiChatPage } from "./AiChatPage";

type AiChatLocationState = {
  initialTurn?: unknown;
};

export type InitialTurn = {
  text: string;
  skills: string[];
  responseMode: ResponseMode;
};

function initialTurnFromState(state: unknown): InitialTurn | null {
  if (state === null || typeof state !== "object") {
    return null;
  }

  const turn = (state as AiChatLocationState).initialTurn;
  if (turn === null || typeof turn !== "object") {
    return null;
  }

  const candidate = turn as Partial<InitialTurn>;
  if (
    typeof candidate.text !== "string" ||
    candidate.text.trim().length === 0 ||
    !Array.isArray(candidate.skills) ||
    !candidate.skills.every((skill) => typeof skill === "string")
  ) {
    return null;
  }

  // Invalid/missing legacy router state uses Quick without rejecting
  // otherwise valid text/skills (plan §8.3).
  const responseMode = isResponseMode(candidate.responseMode)
    ? candidate.responseMode
    : "quick";

  return {
    text: candidate.text,
    skills: [...candidate.skills],
    responseMode,
  };
}

/** Route shell for `/app/ai/:sessionId` — `WorkspaceOutlet` keys routes by
 *  pathname, so this component (and every hook it owns) remounts fresh on
 *  every session id change; no stale per-session state survives a switch. */
export function AiChatRoute() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const initialTurn = initialTurnFromState(location.state);

  const clearInitialPrompt = useCallback(() => {
    void navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, navigate]);

  if (sessionId === undefined) {
    return null;
  }

  return (
    <AiChatPage
      initialTurn={initialTurn}
      onInitialTurnConsumed={clearInitialPrompt}
      sessionId={sessionId}
    />
  );
}
