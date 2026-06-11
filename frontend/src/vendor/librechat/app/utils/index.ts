// ~ alias resolves to src/vendor/librechat/app; this file provides the utils
// that vendored app components import as '~/utils'.

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

// removeFocusRings — verbatim from upstream client/src/utils/index.ts
export const removeFocusRings =
  'focus:outline-none focus:ring-0 focus:border-transparent focus-visible:ring-0 focus-visible:outline-none';
