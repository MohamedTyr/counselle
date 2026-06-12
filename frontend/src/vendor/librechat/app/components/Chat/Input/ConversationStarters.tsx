/**
 * Vendored from upstream client/src/components/Chat/Input/ConversationStarters.tsx
 * (pinned 197a1dc4).
 *
 * Subtractions: endpoint/entity/agentsMap/assistantMap resolution,
 * useGetAssistantDocsQuery/useGetEndpointsQuery — starters come from the
 * Counselle config fixture instead.
 * Rewires: useSubmitMessage → our ChatContext submitMessage (upstream behavior:
 * clicking a starter SUBMITS the prompt).
 *
 * The render block (wrapper + button + text classes) is byte-identical to
 * upstream; MAX_CONVO_STARTERS = 4 (upstream Constants.MAX_CONVO_STARTERS).
 */
import { useCallback } from 'react';
import { useChatContext } from '@/app/ChatContext';
import { APP_CONFIG } from '@/api/mock/fixtures/config';

const MAX_CONVO_STARTERS = 4;

const ConversationStarters = () => {
  const { submitMessage } = useChatContext();

  const conversation_starters: readonly string[] = APP_CONFIG.conversation_starters;

  const sendConversationStarter = useCallback(
    (text: string) => {
      void submitMessage(text);
    },
    [submitMessage],
  );

  if (!conversation_starters.length) {
    return null;
  }

  return (
    <div className="mt-8 flex flex-wrap justify-center gap-3 px-4">
      {conversation_starters.slice(0, MAX_CONVO_STARTERS).map((text: string, index: number) => (
        <button
          key={index}
          onClick={() => sendConversationStarter(text)}
          className="relative flex w-40 cursor-pointer flex-col gap-2 rounded-2xl border border-border-medium px-3 pb-4 pt-3 text-start align-top text-[15px] shadow-[0_0_2px_0_rgba(0,0,0,0.05),0_4px_6px_0_rgba(0,0,0,0.02)] transition-colors duration-300 ease-in-out fade-in hover:bg-surface-tertiary"
        >
          <p className="break-word line-clamp-3 overflow-hidden text-balance break-all text-text-secondary">
            {text}
          </p>
        </button>
      ))}
    </div>
  );
};

export default ConversationStarters;
