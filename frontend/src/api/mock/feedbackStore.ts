/**
 * Mock feedback store — thumbs up/down per message, persisted in localStorage
 * (PRD story 22). FE-7 swaps this for POST .../messages/{id}/feedback;
 * the stored shape mirrors the backend's minimal feedback payload.
 */
export type StoredFeedback = {
  rating: 'thumbsUp' | 'thumbsDown';
  tag?: string;
  text?: string;
};

const STORAGE_KEY = 'counselle:mock:feedback';

type FeedbackMap = Record<string, StoredFeedback>;

function load(): FeedbackMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null ? (parsed as FeedbackMap) : {};
  } catch {
    return {};
  }
}

function save(map: FeedbackMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // silent no-op
  }
}

function key(conversationId: string, messageId: string): string {
  return `${conversationId}:${messageId}`;
}

export function getFeedback(conversationId: string, messageId: string): StoredFeedback | undefined {
  return load()[key(conversationId, messageId)];
}

/** Upsert; `undefined` clears (re-tapping toggles — idempotent per message). */
export function setFeedback(
  conversationId: string,
  messageId: string,
  feedback: StoredFeedback | undefined,
): void {
  const map = load();
  const k = key(conversationId, messageId);
  if (feedback === undefined) {
    const { [k]: _removed, ...rest } = map;
    save(rest);
    return;
  }
  save({ ...map, [k]: feedback });
}
