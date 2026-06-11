/**
 * Counselle app-level jotai atoms.
 * Upstream Recoil atoms that controlled UI prefs are replicated here using
 * the same localStorage keys upstream used (where they persisted).
 */
import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';

// ── Sidebar ───────────────────────────────────────────────────────────────────

/**
 * Whether the sidebar is expanded.
 * Upstream localStorage key: `sidebar-state` (recoil atom 'sidebarExpanded').
 * Frozen default: true (sidebar open on desktop).
 */
export const sidebarExpandedAtom = atomWithStorage<boolean>('sidebar-state', true);

// ── Search ────────────────────────────────────────────────────────────────────

/** The sidebar search query (filters conversation titles). */
export const searchQueryAtom = atom<string>('');

// ── Active conversation ───────────────────────────────────────────────────────

/** The currently-open conversation id, or null when on the landing screen. */
export const activeConversationIdAtom = atom<string | null>(null);
