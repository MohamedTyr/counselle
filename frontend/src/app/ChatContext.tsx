/**
 * Minimal ChatContext stub for FE-1.
 * FE-3 will grow this to hold turn state, streaming, the turn reducer, etc.
 */
import { createContext, useContext, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAtom } from 'jotai';
import { activeConversationIdAtom } from '@/app/state';

type ChatContextValue = {
  conversationId: string | null;
  newConversation: () => void;
};

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [conversationId, setConversationId] = useAtom(activeConversationIdAtom);

  const newConversation = useCallback(() => {
    setConversationId(null);
    navigate('/');
  }, [navigate, setConversationId]);

  return (
    <ChatContext.Provider value={{ conversationId, newConversation }}>
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
