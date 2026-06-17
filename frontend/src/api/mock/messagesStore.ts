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
