import { useCallback } from "react";
import { useLocation, useNavigate, useParams } from "react-router";

import { AiChatPage } from "./AiChatPage";

type AiChatLocationState = {
  initialTurn?: unknown;
};

export type InitialTurn = {
  text: string;
  skills: string[];
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

  return { text: candidate.text, skills: [...candidate.skills] };
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
