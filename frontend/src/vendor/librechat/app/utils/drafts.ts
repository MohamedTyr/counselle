/**
 * Draft persistence helpers.
 * Verbatim from upstream client/src/utils/drafts.ts (pinned 197a1dc4).
 * librechat-data-provider LocalStorageKeys/Constants replaced with inline
 * string literals (same values) since we stub the package.
 */
import debounce from 'lodash/debounce';

/** Matches upstream LocalStorageKeys.TEXT_DRAFT */
const TEXT_DRAFT_KEY = 'librechat.textDraft.';
/** Matches upstream LocalStorageKeys.FILES_DRAFT */
const FILES_DRAFT_KEY = 'librechat.filesDraft.';
/** Matches upstream Constants.NEW_CONVO */
export const NEW_CONVO = 'new';
/** Matches upstream Constants.PENDING_CONVO */
export const PENDING_CONVO = '__pending__';

export { TEXT_DRAFT_KEY, FILES_DRAFT_KEY };

const encodeBase64 = (plainText: string): string => {
  try {
    const textBytes = new TextEncoder().encode(plainText);
    return btoa(String.fromCharCode(...textBytes));
  } catch {
    return '';
  }
};

const decodeBase64 = (base64String: string): string => {
  try {
    const bytes = atob(base64String);
    const uint8Array = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      uint8Array[i] = bytes.charCodeAt(i);
    }
    return new TextDecoder().decode(uint8Array);
  } catch {
    return '';
  }
};

export const clearDraft = debounce((id?: string | null) => {
  localStorage.removeItem(`${TEXT_DRAFT_KEY}${id ?? ''}`);
}, 2500);

export const clearAllDrafts = (conversationId?: string | null) => {
  const key = conversationId ?? NEW_CONVO;
  localStorage.removeItem(`${TEXT_DRAFT_KEY}${key}`);
  localStorage.removeItem(`${FILES_DRAFT_KEY}${key}`);
};

export const setDraft = ({ id, value }: { id: string; value?: string }) => {
  if (value && value.length > 1) {
    localStorage.setItem(`${TEXT_DRAFT_KEY}${id}`, encodeBase64(value));
    return;
  }
  localStorage.removeItem(`${TEXT_DRAFT_KEY}${id}`);
};

export const getDraft = (id?: string): string | null =>
  decodeBase64((localStorage.getItem(`${TEXT_DRAFT_KEY}${id ?? ''}`) ?? '') || '');
