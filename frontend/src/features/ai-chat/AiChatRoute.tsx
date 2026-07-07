import { useCallback } from "react";
import { useLocation, useNavigate, useParams } from "react-router";

import { AiChatPage } from "./AiChatPage";

type AiChatLocationState = {
  initialPrompt?: unknown;
};

function initialPromptFromState(state: unknown) {
  if (state === null || typeof state !== "object") {
    return null;
  }

  const prompt = (state as AiChatLocationState).initialPrompt;
  return typeof prompt === "string" && prompt.trim().length > 0
    ? prompt
    : null;
}

/** Route shell for `/app/ai/:sessionId` — `WorkspaceOutlet` keys routes by
 *  pathname, so this component (and every hook it owns) remounts fresh on
 *  every session id change; no stale per-session state survives a switch. */
export function AiChatRoute() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const initialPrompt = initialPromptFromState(location.state);

  const clearInitialPrompt = useCallback(() => {
    void navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, navigate]);

  if (sessionId === undefined) {
    return null;
  }

  return (
    <AiChatPage
      initialPrompt={initialPrompt}
      onInitialPromptConsumed={clearInitialPrompt}
      sessionId={sessionId}
    />
  );
}
