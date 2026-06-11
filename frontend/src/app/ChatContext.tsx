/**
 * ChatContext — the single seam between the composer and the transport layer.
 *
 * FE-2: submitMessage is a mock that:
 *   1. Creates a new chat in the mock store if on the landing screen (no conversationId)
 *   2. Navigates to /c/<id>
 *   3. Appends the user message to an in-memory message list
 *   4. Flips isSubmitting true for ~3 seconds (fake stream window so StopButton shows)
 *
 * FE-3 replaces the fake stream window with a real mock event stream.
 * ChatContext is the ONLY place that knows which transport is active.
 */
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useAtom } from 'jotai';
import { useQueryClient } from '@tanstack/react-query';
import { activeConversationIdAtom } from '@/app/state';
import { createChat } from '@/api/mock/store';
import { QueryKeys } from '@/api/hooks';

// ── Message shape ─────────────────────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant';

export type Message = {
  id: string;
  role: MessageRole;
  text: string;
  createdAt: string;
};

// ── Context value shape ───────────────────────────────────────────────────────

type ChatContextValue = {
  conversationId: string | null;
  isSubmitting: boolean;
  messages: Message[];
  submitMessage: (text: string) => Promise<void>;
  stopGenerating: () => void;
  newConversation: () => void;
};

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

// ── In-memory message store (per-session) ─────────────────────────────────────
// FE-3 will replace this with proper state management.
const messagesByConvo: Map<string, Message[]> = new Map();

function getMessages(conversationId: string): Message[] {
  return messagesByConvo.get(conversationId) ?? [];
}

function appendMessage(conversationId: string, msg: Message): void {
  const existing = messagesByConvo.get(conversationId) ?? [];
  messagesByConvo.set(conversationId, [...existing, msg]);
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function ChatProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useAtom(activeConversationIdAtom);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);

  // Track active timeout so stopGenerating can cancel it
  const fakeStreamRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep a mutable ref to the current conversationId so the submit closure captures it freshly
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;

  const syncMessages = useCallback((convoId: string) => {
    setMessages(getMessages(convoId));
  }, []);

  const submitMessage = useCallback(
    async (text: string) => {
      if (isSubmitting) return;

      let activeId = conversationIdRef.current;

      // Start fake stream window FIRST so the Stop button shows before navigation
      setIsSubmitting(true);

      // If on landing (no conversationId), create a new chat
      if (!activeId) {
        const newChat = createChat(text.slice(0, 60) || 'New chat');
        activeId = newChat.conversationId;
        setConversationId(activeId);
        void queryClient.invalidateQueries([QueryKeys.chats]);
        navigate(`/c/${activeId}`, { replace: false });
      }

      // Append user message
      const userMsg: Message = {
        id: `msg-${crypto.randomUUID()}`,
        role: 'user',
        text,
        createdAt: new Date().toISOString(),
      };
      appendMessage(activeId, userMsg);
      syncMessages(activeId);

      fakeStreamRef.current = setTimeout(() => {
        // Append a stub assistant message (FE-3 replaces this with real stream)
        const assistantMsg: Message = {
          id: `msg-${crypto.randomUUID()}`,
          role: 'assistant',
          text: '…',
          createdAt: new Date().toISOString(),
        };
        if (activeId) {
          appendMessage(activeId, assistantMsg);
          syncMessages(activeId);
        }
        setIsSubmitting(false);
        fakeStreamRef.current = null;
      }, 3000);
    },
    [isSubmitting, navigate, setConversationId, syncMessages],
  );

  const stopGenerating = useCallback(() => {
    if (fakeStreamRef.current !== null) {
      clearTimeout(fakeStreamRef.current);
      fakeStreamRef.current = null;
    }
    setIsSubmitting(false);
  }, []);

  const newConversation = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    navigate('/');
  }, [navigate, setConversationId]);

  // Sync messages when conversationId changes (e.g. navigating to existing chat)
  useEffect(() => {
    if (conversationId) {
      setMessages(getMessages(conversationId));
    } else {
      setMessages([]);
    }
  }, [conversationId]);

  return (
    <ChatContext.Provider
      value={{ conversationId, isSubmitting, messages, submitMessage, stopGenerating, newConversation }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChatContext(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (ctx === undefined) {
    throw new Error('useChatContext must be used within ChatProvider');
  }
  return ctx;
}
