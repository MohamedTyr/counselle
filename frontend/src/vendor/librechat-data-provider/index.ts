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

/** Upstream packages/data-provider/src/config.ts:2366 — trimmed to the three tabs FE-5 keeps. */
export enum SettingsTabValues {
  /**
   * Tab for General Settings
   */
  GENERAL = 'general',
  /**
   * Tab for Data Controls
   */
  DATA = 'data',
  /**
   * Tab for Account Settings
   */
  ACCOUNT = 'account',
}

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
  [key: string]: unknown;
};

// FE-5A: typed fields the vendored Auth components read; index signature
// keeps prior Record<string, unknown> consumers working.
export type TStartupConfig = {
  appTitle?: string;
  registrationEnabled?: boolean;
  emailLoginEnabled?: boolean;
  socialLoginEnabled?: boolean;
  googleLoginEnabled?: boolean;
  passwordResetEnabled?: boolean;
  emailEnabled?: boolean;
  minPasswordLength?: number;
  serverDomain?: string;
  socialLogins?: string[];
  interface?: {
    privacyPolicy?: { externalUrl?: string; openNewTab?: boolean };
    termsOfService?: { externalUrl?: string; openNewTab?: boolean };
  };
  [key: string]: unknown;
};

// FE-5A: auth form payloads + route helpers (shapes from upstream
// librechat-data-provider, trimmed to MVP2 fields — no username/token/userId).
export type TLoginUser = {
  email: string;
  password: string;
};

export type TRegisterUser = {
  name: string;
  email: string;
  password: string;
  confirm_password: string;
};

export type TRequestPasswordReset = {
  email: string;
};

export type TResetPassword = {
  password: string;
  confirm_password: string;
};

export function loginPage(): string {
  return '/login';
}

export function registerPage(): string {
  return '/register';
}

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

// ── Feedback (derived from upstream packages/data-provider/src/feedback.ts,
//    pinned 197a1dc4; zod schemas dropped — types only) ───────────────────────

export type TFeedbackRating = 'thumbsUp' | 'thumbsDown';

export const FEEDBACK_REASON_KEYS = [
  // Down
  'not_matched',
  'inaccurate',
  'bad_style',
  'missing_image',
  'unjustified_refusal',
  'not_helpful',
  'other',
  // Up
  'accurate_reliable',
  'creative_solution',
  'clear_well_written',
  'attention_to_detail',
] as const;

export type TFeedbackTagKey = (typeof FEEDBACK_REASON_KEYS)[number];

export interface TFeedbackTag {
  key: TFeedbackTagKey;
  label: string;
  direction: TFeedbackRating;
  icon: string;
}

export const FEEDBACK_TAGS: TFeedbackTag[] = [
  // Thumbs Down
  {
    key: 'not_matched',
    label: 'com_ui_feedback_tag_not_matched',
    direction: 'thumbsDown',
    icon: 'AlertCircle',
  },
  {
    key: 'inaccurate',
    label: 'com_ui_feedback_tag_inaccurate',
    direction: 'thumbsDown',
    icon: 'AlertCircle',
  },
  {
    key: 'bad_style',
    label: 'com_ui_feedback_tag_bad_style',
    direction: 'thumbsDown',
    icon: 'PenTool',
  },
  {
    key: 'missing_image',
    label: 'com_ui_feedback_tag_missing_image',
    direction: 'thumbsDown',
    icon: 'ImageOff',
  },
  {
    key: 'unjustified_refusal',
    label: 'com_ui_feedback_tag_unjustified_refusal',
    direction: 'thumbsDown',
    icon: 'Ban',
  },
  {
    key: 'not_helpful',
    label: 'com_ui_feedback_tag_not_helpful',
    direction: 'thumbsDown',
    icon: 'ThumbsDown',
  },
  {
    key: 'other',
    label: 'com_ui_feedback_tag_other',
    direction: 'thumbsDown',
    icon: 'HelpCircle',
  },
  // Thumbs Up
  {
    key: 'accurate_reliable',
    label: 'com_ui_feedback_tag_accurate_reliable',
    direction: 'thumbsUp',
    icon: 'CheckCircle',
  },
  {
    key: 'creative_solution',
    label: 'com_ui_feedback_tag_creative_solution',
    direction: 'thumbsUp',
    icon: 'Lightbulb',
  },
  {
    key: 'clear_well_written',
    label: 'com_ui_feedback_tag_clear_well_written',
    direction: 'thumbsUp',
    icon: 'PenTool',
  },
  {
    key: 'attention_to_detail',
    label: 'com_ui_feedback_tag_attention_to_detail',
    direction: 'thumbsUp',
    icon: 'Search',
  },
];

export function getTagsForRating(rating: TFeedbackRating): TFeedbackTag[] {
  return FEEDBACK_TAGS.filter((tag) => tag.direction === rating);
}

export type TMinimalFeedback = {
  rating: TFeedbackRating;
  tag: TFeedbackTagKey;
  text?: string;
};

export type TFeedback = {
  rating: TFeedbackRating;
  // B5c: `tag`/`text` are optional — the reason-chip + free-text UI was
  // subtracted (the backend stores only `{rating}`; reason chips are MVP3).
  tag?: TFeedbackTag | undefined;
  text?: string;
};

export type TUpdateFeedbackRequest = {
  feedback?: TMinimalFeedback;
};

export type TUpdateFeedbackResponse = {
  feedback?: { rating: TFeedbackRating; tag?: TFeedbackTagKey | null; text?: string };
};

export function toMinimalFeedback(feedback: TFeedback | undefined): TMinimalFeedback | undefined {
  if (!feedback?.rating || !feedback?.tag || !feedback.tag.key) {
    return undefined;
  }

  return {
    rating: feedback.rating,
    tag: feedback.tag.key,
    text: feedback.text,
  };
}

export function getTagByKey(key: TFeedbackTagKey | undefined): TFeedbackTag | undefined {
  if (!key) {
    return undefined;
  }
  return FEEDBACK_TAGS.find((tag) => tag.key === key);
}
