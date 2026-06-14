/**
 * ChatView — the main chat page.
 *
 * Structure cloned from upstream client/src/components/Chat/ChatView.tsx
 * (pinned 197a1dc4): ChatFormProvider owns the composer form; the landing
 * greeting, the composer, and the starter chips live in ONE centered column
 * (Landing's `sm:max-h-0` trick depends on this exact parent structure).
 *
 * Subtractions vs upstream: Recoil/submission machinery, messages tree fetch
 * (FE-3 adds MessagesView through the turn reducer), Presentation's artifacts/
 * drag-drop/side-panel layers (the bg-presentation + main wrappers are kept),
 * ProjectLandingChip, spinner states.
 */
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useParams } from 'react-router-dom';
import { useSetAtom } from 'jotai';
import type { ChatFormValues } from '~/common';
import { ChatFormProvider } from '~/Providers';
import ConversationStarters from '~/components/Chat/Input/ConversationStarters';
import MessagesView from '~/components/Chat/Messages/MessagesView';
import Landing from '~/components/Chat/Landing';
import Header from '~/components/Chat/Header';
import Footer from '~/components/Chat/Footer';
import { cn } from '~/utils';
import { useChatContext } from '@/app/ChatContext';
import { activeConversationIdAtom } from '@/app/state';
import ChatComposer from '@/components/composer/ChatComposer';

/** Upstream `centerFormOnLanding` atom — frozen true (no UI toggle in MVP2). */
const CENTER_FORM_ON_LANDING = true;

export default function ChatView() {
  const { messages } = useChatContext();
  const { conversationId: urlConversationId } = useParams<{ conversationId: string }>();
  const setActiveConversationId = useSetAtom(activeConversationIdAtom);

  const methods = useForm<ChatFormValues>({ defaultValues: { text: '' } });

  // Sync URL param → atom so ChatContext/SourceDropdown see the current conversation.
  useEffect(() => {
    setActiveConversationId(urlConversationId ?? null);
  }, [urlConversationId, setActiveConversationId]);

  const isLandingPage = messages.length === 0 && !urlConversationId;

  return (
    <ChatFormProvider {...methods}>
      <div className="relative flex w-full grow overflow-hidden bg-presentation">
        <main className="flex h-full w-full flex-col overflow-y-auto" role="main">
          <div className="relative flex h-full w-full flex-col">
            <Header />
            <>
              <div
                className={cn(
                  'flex flex-col',
                  isLandingPage
                    ? 'flex-1 items-center justify-end sm:justify-center'
                    : 'h-full overflow-y-auto',
                )}
              >
                {isLandingPage ? (
                  <Landing centerFormOnLanding={CENTER_FORM_ON_LANDING} />
                ) : (
                  <MessagesView />
                )}
                <div
                  className={cn(
                    'w-full',
                    isLandingPage && 'max-w-3xl transition-all duration-200 xl:max-w-4xl',
                  )}
                >
                  <ChatComposer centerFormOnLanding={CENTER_FORM_ON_LANDING} />
                  {isLandingPage ? <ConversationStarters /> : <Footer />}
                </div>
              </div>
              {isLandingPage && <Footer />}
            </>
          </div>
        </main>
      </div>
    </ChatFormProvider>
  );
}
