// ~/common — shared types used by vendored sidebar components.
import type { ComponentType, MouseEventHandler, RefObject, Dispatch, SetStateAction } from 'react';
import type { ChatMessage, AskProps } from '@/app/ChatContext';

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
