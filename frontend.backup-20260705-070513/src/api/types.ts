/**
 * Counselle API types — the shapes our TanStack Query hooks and mock store use.
 * FE-7 will reconcile these against the real backend contract.
 */

/** A conversation summary shown in the sidebar list. */
export type ChatSummary = {
  /** UUID or slug, matches the URL segment `/c/:conversationId`. */
  conversationId: string;
  title: string;
  /** ISO-8601 datetime string; used for date-group sorting. */
  updatedAt: string;
  createdAt: string;
  /** True while this session's latest turn is streaming (B5c — a pulsing row dot). */
  isGenerating: boolean;
};

/** The shape the mock store holds per-conversation. */
export type ChatRecord = ChatSummary;
