import { useParams } from "react-router";

import { AiChatPage } from "./AiChatPage";

/** Route shell for `/app/ai/:sessionId` — `WorkspaceOutlet` keys routes by
 *  pathname, so this component (and every hook it owns) remounts fresh on
 *  every session id change; no stale per-session state survives a switch. */
export function AiChatRoute() {
  const { sessionId } = useParams<{ sessionId: string }>();

  if (sessionId === undefined) {
    return null;
  }

  return <AiChatPage sessionId={sessionId} />;
}
