/**
 * Vendored from upstream client/src/components/Chat/Messages/MessagesView.tsx
 * (pinned 197a1dc4).
 *
 * Subtractions / rewires:
 * - MultiMessage tree recursion → a flat map over ChatContext messages
 *   (branching dropped); MessageNav (branch navigation) dropped
 * - useMessageScrolling (bottom-chasing) → useQuestionAnchoredScroll
 *   (PRD-mvp2 decision 8)
 * - useScreenshot / MessagesViewProvider dropped; scrollButtonPreference
 *   (recoil setting) frozen true; fontSize frozen 'text-base'
 * Kept byte-identical: the scroll container structure and classes
 * (scrollbar-gutter-stable, pb-9 pt-14, #messages-end), the CSSTransition
 * scroll-animation wrapping ScrollToBottom.
 */
import { useState, useRef } from 'react';
import { CSSTransition } from 'react-transition-group';
import ScrollToBottom from '~/components/Messages/ScrollToBottom';
import useQuestionAnchoredScroll from '@/app/useQuestionAnchoredScroll';
import { useChatContext } from '@/app/ChatContext';
import { useLocalize } from '~/hooks';
import Message from './Message';
import { cn } from '~/utils';

export default function MessagesView() {
  const localize = useLocalize();
  const { messages } = useChatContext();
  const fontSize = 'text-base';
  const [currentEditId, setCurrentEditId] = useState<number | string | null>(-1);
  const scrollToBottomRef = useRef<HTMLDivElement>(null);

  const {
    contentRef,
    scrollableRef,
    messagesEndRef,
    showScrollButton,
    handleSmoothToRef,
    debouncedHandleScroll,
  } = useQuestionAnchoredScroll();

  return (
    <>
      <div className="relative flex-1 overflow-hidden overflow-y-auto">
        <div className="relative h-full">
          <div
            className="scrollbar-gutter-stable"
            onScroll={debouncedHandleScroll}
            ref={scrollableRef}
            style={{
              height: '100%',
              overflowY: 'auto',
              width: '100%',
            }}
          >
            <div ref={contentRef} className="flex flex-col pb-9 pt-14 dark:bg-transparent">
              {messages.length === 0 ? (
                <div
                  className={cn(
                    'flex w-full items-center justify-center p-3 text-text-secondary',
                    fontSize,
                  )}
                >
                  {localize('com_ui_nothing_found')}
                </div>
              ) : (
                <>
                  {messages.map((message) => (
                    <Message
                      key={message.messageId}
                      message={message}
                      currentEditId={currentEditId}
                      setCurrentEditId={setCurrentEditId}
                    />
                  ))}
                </>
              )}
              <div
                id="messages-end"
                className="group h-0 w-full flex-shrink-0"
                ref={messagesEndRef}
              />
            </div>
          </div>

          <CSSTransition
            in={showScrollButton}
            timeout={{
              enter: 300,
              exit: 250,
            }}
            classNames="scroll-animation"
            unmountOnExit={true}
            appear={true}
            nodeRef={scrollToBottomRef}
          >
            <ScrollToBottom ref={scrollToBottomRef} scrollHandler={handleSmoothToRef} />
          </CSSTransition>
        </div>
      </div>
    </>
  );
}
