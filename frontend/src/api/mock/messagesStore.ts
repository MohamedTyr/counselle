/**
 * Per-chat persisted transcript (mock) — the §27.5 contract's storage side.
 *
 * Each chat's messages persist as TranscriptEntry[] in localStorage; reloading
 * /c/<id> reduces assistant entries through the SAME turn reducer the live
 * stream used (one code path, §34). Version-gated like the chat store.
 */
import type { TranscriptEntry } from '@/api/protocol';

const STORAGE_PREFIX = 'counselle:mock:messages:';
const VERSION_KEY = 'counselle:mock:messages:version';
/** Bump to wipe persisted transcripts on every client. */
const STORE_VERSION = '3';

function checkVersion(): void {
  try {
    if (localStorage.getItem(VERSION_KEY) !== STORE_VERSION) {
      const stale: string[] = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key !== null && key.startsWith(STORAGE_PREFIX)) {
          stale.push(key);
        }
      }
      stale.forEach((key) => localStorage.removeItem(key));
      localStorage.setItem(VERSION_KEY, STORE_VERSION);
    }
  } catch {
    // private mode — silent no-op
  }
}

checkVersion();

export function getTranscript(conversationId: string): TranscriptEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + conversationId);
    if (raw === null) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as TranscriptEntry[]) : [];
  } catch {
    return [];
  }
}

function save(conversationId: string, entries: TranscriptEntry[]): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + conversationId, JSON.stringify(entries));
  } catch {
    // quota exceeded or private mode — silent no-op
  }
}

export function appendEntry(conversationId: string, entry: TranscriptEntry): void {
  save(conversationId, [...getTranscript(conversationId), entry]);
}

/** Truncate-and-re-ask (PRD decision 4): drop entries from `index` onward. */
export function truncateFrom(conversationId: string, index: number): void {
  save(conversationId, getTranscript(conversationId).slice(0, index));
}

/** Edit-in-place save (their EditMessage "Save" button). */
export function updateEntryText(conversationId: string, index: number, text: string): void {
  const entries = getTranscript(conversationId);
  if (index < 0 || index >= entries.length) {
    return;
  }
  const updated: TranscriptEntry = { ...entries[index], text };
  save(conversationId, [...entries.slice(0, index), updated, ...entries.slice(index + 1)]);
}

export function deleteTranscript(conversationId: string): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + conversationId);
  } catch {
    // silent no-op
  }
}

/** FE-5 (Settings → Data → Clear all chats): wipe every persisted transcript. */
export function clearAllTranscripts(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key !== null && key.startsWith(STORAGE_PREFIX)) {
        keys.push(key);
      }
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    // private mode — silent no-op
  }
}
