/**
 * Counselle app-level jotai atoms.
 * Upstream Recoil atoms that controlled UI prefs are replicated here using
 * the same localStorage keys upstream used (where they persisted).
 */
import { atom } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import type { RenderSpec, SourceEntry } from '@/api/protocol';

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

// ── Sources panel ─────────────────────────────────────────────────────────
//
// The cited sources for ONE answer, opened in the same right-side rail the
// artifact panel uses. There is one physical rail in the app, so the two are
// mutually exclusive: opening either clears the other (write-only atoms below).
// `null` when closed; cleared on conversation switch (ChatView) and Esc/close.

/**
 * The open sources panel's full state:
 *  - `sources`: the cited set for one answer (Counselle card + externals).
 *  - `activeIndex`: the marker index opened from an inline pill (scrolls + flashes
 *    its row); `null` when opened from the strip (no specific row).
 *  - `dbSchools`: school names for the Counselle-data card subline, derived from
 *    the answer's viz blocks / DB source labels (empty ⇒ generic truthful copy).
 */
export type SourcesPanelState = {
  sources: SourceEntry[];
  activeIndex: number | null;
  dbSchools: string[];
} | null;

export const sourcesPanelAtom = atom<SourcesPanelState>(null);

/** Open a viz card in the right rail, replacing whatever was there. */
export const openArtifactPanelAtom = atom(null, (_get, set, spec: RenderSpec) => {
  set(sourcesPanelAtom, null);
  set(artifactPanelAtom, { spec });
});

/** Open an answer's sources in the right rail, replacing whatever was there. */
export const openSourcesPanelAtom = atom(
  null,
  (_get, set, panel: NonNullable<SourcesPanelState>) => {
    set(artifactPanelAtom, null);
    set(sourcesPanelAtom, panel);
  },
);
