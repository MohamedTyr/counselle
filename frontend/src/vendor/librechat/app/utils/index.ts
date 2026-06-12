// ~ alias resolves to src/vendor/librechat/app; this file provides the utils
// that vendored app components import as '~/utils'.
import type React from 'react';

// cn — classnames helper — from the vendored @librechat/client package
export { cn } from '@librechat/client/utils/utils';

// logger — from vendored @librechat/client
export { default as logger } from '@librechat/client/utils/logger';

// groupConversationsByDate — re-export from local convos.ts
export { groupConversationsByDate } from './convos';

// clearMessagesCache — no-op stub; actual cache clearing is handled via
// TanStack Query invalidation in @/api/hooks; callers were stripped.
export function clearMessagesCache(_queryClient?: unknown): void {
  // no-op in MVP2
}

// textarea utils — verbatim from upstream client/src/utils/textarea.ts
export { insertTextAtCursor, forceResize, checkIfScrollable } from './textarea';

// draft helpers — verbatim from upstream client/src/utils/drafts.ts
export { clearDraft, clearAllDrafts, setDraft, getDraft, NEW_CONVO, PENDING_CONVO } from './drafts';

// validateEmail — from upstream client/src/utils/email.ts, adapted: the zod
// emailSchema is replaced with the email regex upstream uses in Registration
// (zod isn't a dependency here). Same signature and empty-string behavior.
export const validateEmail = (email: string, errorMessage?: string): true | string => {
  if (!email || email.trim() === '') {
    return true;
  }
  return /\S+@\S+\.\S+/.test(email) || errorMessage || 'Please enter a valid email address';
};

// removeFocusRings — verbatim from upstream client/src/utils/index.ts
export const removeFocusRings =
  'focus:outline-none focus:ring-0 focus:border-transparent focus-visible:ring-0 focus-visible:outline-none';

// langSubset — verbatim from upstream client/src/utils/languages.ts
export { langSubset } from './languages';

// handleDoubleClick — verbatim from upstream client/src/utils/index.ts
export const handleDoubleClick: React.MouseEventHandler<HTMLElement> = (event) => {
  const range = document.createRange();
  range.selectNodeContents(event.target as Node);
  const selection = window.getSelection();
  if (!selection) {
    return;
  }
  selection.removeAllRanges();
  selection.addRange(range);
};

// Screen-reader helpers — from upstream client/src/utils/messages.ts, adapted:
// upstream numbers turns via tree depth (branching); our flat list drops the
// number (their no-depth fallback path). Structurally typed to avoid a
// vendor → app import.
type MessageLike = { isCreatedByUser: boolean };
type LocalizeFn = (key: string, options?: Record<string, string | number>) => string;

export const getMessageAriaLabel = (_message: MessageLike, localize: LocalizeFn): string =>
  localize('com_endpoint_message');

export const getHeaderPrefixForScreenReader = (
  message: MessageLike,
  localize: LocalizeFn,
): string =>
  message.isCreatedByUser
    ? `${localize('com_ui_prompt')}: `
    : `${localize('com_ui_response')}: `;
