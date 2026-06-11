// Mock runtime shim for librechat-data-provider
// Only provides the constants and types that vendored files actually use.
// No librechat-data-provider npm package is installed — this shim is the
// runtime implementation.

export const QueryKeys = {
  messages: 'messages',
  allConversations: 'allConversations',
  conversation: 'conversation',
  user: 'user',
  name: 'queryKeys',
} as const;

export const LocalStorageKeys = {
  LAST_MODEL: 'lastSelectedModel',
  LAST_CONVO_SETUP: 'lastConvoSetup',
  SEARCH_QUERY: 'searchQuery',
} as const;

export const Constants = {
  NEW_CONVO: 'new',
} as const;

export enum PermissionTypes {
  NONE = 0,
  READ = 1,
  WRITE = 2,
}

export enum Permissions {
  NONE = 0,
  SHARED = 1,
  ALL = 2,
}

// Types (re-exported for convenience; actual shapes defined in the .d.ts stub)
export type TConversation = {
  conversationId: string | null;
  title: string | null;
  endpoint: string | null;
  updatedAt?: string;
  createdAt?: string;
  chatProjectId?: string | null;
  endpointType?: string | null;
  iconURL?: string | null;
  model?: string | null;
  modelLabel?: string | null;
  chatGptLabel?: string | null;
  spec?: string | null;
  agent_id?: string | null;
  assistant_id?: string | null;
  [key: string]: unknown;
};

export type GroupedConversations = Array<[string, TConversation[]]>;

export type ConversationListResponse = {
  conversations: TConversation[];
  nextCursor?: string | null;
};

export type TMessage = {
  messageId: string;
  conversationId?: string;
  text: string;
  role: 'user' | 'assistant' | 'system';
  parentMessageId?: string | null;
  [key: string]: unknown;
};
