/**
 * In-memory + localStorage-persisted mock chat store.
 * Seeded from fixture data; mutations are in-memory for the session.
 * FE-7 replaces this with real HTTP transport — nothing above this layer changes.
 */
import type { ChatRecord } from '@/api/types';
import { FIXTURE_CHATS } from './fixtures/chats';

const STORAGE_KEY = 'counselle:mock:chats';

function loadFromStorage(): ChatRecord[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }
    return parsed as ChatRecord[];
  } catch {
    return null;
  }
}

function saveToStorage(chats: ChatRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(chats));
  } catch {
    // quota exceeded or private mode — silent no-op
  }
}

/** In-memory store (single source of truth per session). */
let chats: ChatRecord[] = loadFromStorage() ?? structuredClone(FIXTURE_CHATS);

function persist(): void {
  saveToStorage(chats);
}

// ── Read ─────────────────────────────────────────────────────────────────────

export function listChats(): ChatRecord[] {
  return [...chats];
}

export function getChat(conversationId: string): ChatRecord | undefined {
  return chats.find((c) => c.conversationId === conversationId);
}

// ── Write (immutable-update style) ───────────────────────────────────────────

export function renameChat(conversationId: string, newTitle: string): ChatRecord {
  const idx = chats.findIndex((c) => c.conversationId === conversationId);
  if (idx === -1) {
    throw new Error(`Chat ${conversationId} not found`);
  }
  const updated: ChatRecord = {
    ...chats[idx],
    title: newTitle.trim() || 'Untitled',
    updatedAt: new Date().toISOString(),
  };
  chats = [...chats.slice(0, idx), updated, ...chats.slice(idx + 1)];
  persist();
  return updated;
}

export function deleteChat(conversationId: string): void {
  chats = chats.filter((c) => c.conversationId !== conversationId);
  persist();
}

export function createChat(title: string): ChatRecord {
  const now = new Date().toISOString();
  const newChat: ChatRecord = {
    conversationId: `chat-${crypto.randomUUID()}`,
    title: title.trim() || 'New chat',
    updatedAt: now,
    createdAt: now,
  };
  chats = [newChat, ...chats];
  persist();
  return newChat;
}

export function clearAllChats(): void {
  chats = [];
  persist();
}
