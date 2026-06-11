/**
 * Vendored from upstream client/src/hooks/Input/useHandleKeyUp.ts (pinned 197a1dc4).
 *
 * Subtractions:
 * - All command-popover logic (mentions, prompts, skills, plus) removed (no Mention/Prompts/Skills features)
 * - useHasAccess, useAgentCapabilities, useGetAgentsConfig removed
 * - Recoil store reads removed
 * - handleUpArrow (edit last message) removed — no message list in MVP2 yet
 *
 * Kept: the function signature, the keyup event type, the no-op return.
 */
import { useCallback } from 'react';

const useHandleKeyUp = (_: {
  index: number;
  textAreaRef: React.RefObject<HTMLTextAreaElement>;
}) => {
  // All command triggers removed for MVP2 (Mention, Prompts, Skills).
  // Upstream keyUp logic that survived has been absorbed into useTextarea handleKeyDown.
  const handleKeyUp = useCallback((_event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // no-op — command popovers stripped for MVP2
  }, []);

  return handleKeyUp;
};

export default useHandleKeyUp;
