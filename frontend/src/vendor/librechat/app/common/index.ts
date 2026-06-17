// ~/common — shared types used by vendored sidebar components.
import type { ComponentType, MouseEventHandler, RefObject, Dispatch, SetStateAction } from 'react';
import type { TStartupConfig } from 'librechat-data-provider';
// FE-COUPLING (Phase 5): point at the PURE projection module, not the provider
// — these are pure types; depending on @/app/ChatContext pulled the whole
// streaming provider into a vendored types file.
import type { ChatMessage, AskProps } from '@/api/projectTranscript';
// (TranslationKeys imported below in the FE-5 settings-types section)

// ── FE-5A: auth layout outlet context — upstream common/types.ts:600,
//    error/headerText narrowed from string to TranslationKeys (our Startup
//    layout passes keys straight to localize). ──────────────────────────────
export type TLoginLayoutContext = {
  startupConfig: TStartupConfig | null;
  startupConfigError: unknown;
  isFetching: boolean;
  error: TranslationKeys | null;
  setError: Dispatch<SetStateAction<TranslationKeys | null>>;
  headerText: TranslationKeys | null;
  setHeaderText: Dispatch<SetStateAction<TranslationKeys | null>>;
};

/** Upstream common/types.ts:94 */
export type ChatFormValues = { text: string };

export type NavLink = {
  id: string;
  title: string;
  label?: string;
  icon?: ComponentType<{ className?: string }> | null;
  href?: string;
  variant?: 'default' | 'ghost';
  Component?: ComponentType | null;
  onClick?: MouseEventHandler<HTMLButtonElement>;
};

// ── FE-3 message types — upstream common/types.ts trimmed to the flat
//    message list (branching/siblings/endpoints subtracted), `TMessage`
//    replaced by our ChatMessage projection. ─────────────────────────────────

export type TMessageProps = {
  message?: ChatMessage;
  currentEditId: string | number | null;
  setCurrentEditId: Dispatch<SetStateAction<string | number | null>>;
  isLatestMessage?: boolean;
};

export type TMessageIcon = {
  isCreatedByUser?: boolean;
  modelLabel?: string;
};

export type TMessageContentProps = {
  text: string;
  edit: boolean;
  error: boolean;
  unfinished: boolean;
  isSubmitting: boolean;
  isLast: boolean;
  message: ChatMessage;
  ask: (props: AskProps) => void;
  enterEdit: (cancel?: boolean) => void;
  isCreatedByUser: boolean;
};

export type TDisplayProps = {
  text: string;
  isCreatedByUser: boolean;
  message: ChatMessage;
  showCursor?: boolean;
  className?: string;
};

export type TEditProps = {
  text: string;
  message: ChatMessage;
  isSubmitting: boolean;
  ask: (props: AskProps) => void;
  enterEdit: (cancel?: boolean) => void;
};

export type CodeBarProps = {
  lang: string;
  error?: boolean;
  codeRef: RefObject<HTMLElement>;
  plugin?: boolean;
  allowExecution?: boolean;
  blockIndex?: number;
};

// ── FE-5 settings types — upstream common/types.ts:452,468 ──────────────────

import type { UseMutationResult } from '@tanstack/react-query';
import type { TranslationKeys } from '@librechat/client/hooks/useLocalize';

export type TDangerButtonProps = {
  id: string;
  confirmClear: boolean;
  className?: string;
  disabled?: boolean;
  showText?: boolean;
  mutation?: UseMutationResult<unknown, unknown, unknown, unknown>;
  onClick: () => void;
  infoTextCode: TranslationKeys;
  actionTextCode: TranslationKeys;
  dataTestIdInitial: string;
  dataTestIdConfirm: string;
  infoDescriptionCode?: TranslationKeys;
  confirmActionTextCode?: TranslationKeys;
};

export type TDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Upstream common/types.ts:89 */
export type LocalizeFunction = (
  phraseKey: TranslationKeys,
  options?: Record<string, string | number>,
) => string;
