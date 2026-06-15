/**
 * Counselle app-level jotai atoms.
 * Upstream Recoil atoms that controlled UI prefs are replicated here using
 * the same localStorage keys upstream used (where they persisted).
 */
import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import type { RenderSpec } from '@/api/protocol';

// ── Sidebar ───────────────────────────────────────────────────────────────────

/**
 * Whether the sidebar is expanded.
 * Upstream: store/settings.ts `sidebarExpanded` — localStorage key
 * `unifiedSidebarExpanded`, default collapsed on small screens, expanded
 * otherwise. Replicated exactly (getOnInit matches upstream's eager read).
 */
export const sidebarExpandedAtom = atomWithStorage<boolean>(
  'unifiedSidebarExpanded',
  typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches ? false : true,
  undefined,
  { getOnInit: true },
);

// ── Search ────────────────────────────────────────────────────────────────────

/** The sidebar search query (filters conversation titles). */
export const searchQueryAtom = atom<string>('');

// ── Active conversation ───────────────────────────────────────────────────────

/** The currently-open conversation id, or null when on the landing screen. */
export const activeConversationIdAtom = atom<string | null>(null);

// ── Composer prefs ────────────────────────────────────────────────────────────

/**
 * Whether pressing Enter (without Shift) sends the message.
 * Upstream: store/settings.ts `enterToSend` — localStorage key `enterToSend`, default true.
 * Replicated exactly.
 */
export const enterToSendAtom = atomWithStorage<boolean>('enterToSend', true, undefined, {
  getOnInit: true,
});

// ── Artifact panel ──────────────────────────────────────────────────────────

/**
 * The viz spec currently opened in the right-side artifact panel, or null when
 * closed. A dense card (esp. the comparison table) opens here to get full
 * viewport height + width instead of scrolling inside the chat bubble. Single
 * slot: opening a new card replaces the open one. Cleared on conversation
 * switch and on Esc/close.
 */
export type ArtifactPanelState = { spec: RenderSpec } | null;

export const artifactPanelAtom = atom<ArtifactPanelState>(null);
