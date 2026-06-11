/**
 * Type stub for `librechat-data-provider` (never installed — ADR 0020).
 * Only the handful of types the vendored files still reference after the
 * strips. Kept intentionally minimal; extend only when a newly vendored
 * file needs another member.
 *
 * Member definitions derived from upstream packages/data-provider/src/schemas.ts
 * and packages/data-provider/src/types.ts at pinned commit 197a1dc4.
 */
declare module 'librechat-data-provider' {
  export type TUser = {
    id: string;
    username?: string;
    email?: string;
    name?: string;
    avatar?: string;
    role?: string;
    provider?: string;
    createdAt?: string;
    updatedAt?: string;
  };

  export type TFile = {
    file_id?: string;
    filename?: string;
    filepath?: string;
    type?: string;
    object?: string;
    bytes?: number;
    embedded?: boolean;
    width?: number;
    height?: number;
  };

  export type TStartupConfig = Record<string, unknown>;

  /** Minimal TConversation — only the fields the vendored sidebar files read. */
  export type TConversation = {
    conversationId: string | null;
    title: string | null;
    endpoint?: string | null;
    endpointType?: string | null;
    model?: string | null;
    modelLabel?: string | null;
    chatGptLabel?: string | null;
    iconURL?: string | null;
    spec?: string | null;
    agent_id?: string | null;
    assistant_id?: string | null;
    chatProjectId?: string | null;
    updatedAt: string;
    createdAt: string;
    isArchived?: boolean;
    tags?: string[];
  };

  /** Conversations grouped by date label. */
  export type GroupedConversations = [key: string, TConversation[]][];

  /** Pagination response shape (used by useConversationsInfiniteQuery in upstream). */
  export type ConversationListResponse = {
    conversations: TConversation[];
    nextCursor: string | null;
  };

  export type TMessage = {
    messageId?: string;
    conversationId?: string;
    thread_id?: string;
    endpoint?: string;
  };

  /** Permission constants (used in ConvoOptions/ConversationsSection). */
  export const PermissionTypes: Record<string, string>;
  export const Permissions: Record<string, string>;

  /** QueryKeys constants used by vendored components. */
  export const QueryKeys: {
    messages: string;
    allConversations: string;
    [key: string]: string;
  };

  /** LocalStorageKeys used by convos.ts utility. */
  export const LocalStorageKeys: {
    LAST_MODEL: string;
    [key: string]: string;
  };

  /** Constants used in Convo.tsx. */
  export const Constants: {
    NEW_CONVO: string;
    [key: string]: string;
  };
}

declare module 'librechat-data-provider/react-query' {
  export function useUserKeyQuery(endpoint: string): { data: { expiresAt?: string } };
}
