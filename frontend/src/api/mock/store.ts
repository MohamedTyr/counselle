/**
 * In-memory + localStorage-persisted mock chat store.
 * Seeded from fixture data; mutations are in-memory for the session.
 * FE-7 replaces this with real HTTP transport — nothing above this layer changes.
 */
import type { ChatRecord } from '@/api/types';
import { FIXTURE_CHATS } from './fixtures/chats';

const STORAGE_KEY = 'counselle:mock:chats';
const VERSION_KEY = 'counselle:mock:version';
/** Bump to wipe persisted mock state on every client (fixtures changed, test garbage, …). */
const STORE_VERSION = '4';

function loadFromStorage(): ChatRecord[] | null {
  try {
    if (localStorage.getItem(VERSION_KEY) !== STORE_VERSION) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(VERSION_KEY, STORE_VERSION);
      return null;
    }
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

// ── Write (immutable-update style) ───────────────────────────────────────────

export function createChat(title: string): ChatRecord {
  const now = new Date().toISOString();
  const newChat: ChatRecord = {
    conversationId: `chat-${crypto.randomUUID()}`,
    title: title.trim() || 'New chat',
    updatedAt: now,
    createdAt: now,
    isGenerating: false,
  };
  chats = [newChat, ...chats];
  persist();
  return newChat;
}
