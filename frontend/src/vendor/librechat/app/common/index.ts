// ~/common — shared types used by vendored sidebar components.
import type { ComponentType, MouseEventHandler } from 'react';

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
