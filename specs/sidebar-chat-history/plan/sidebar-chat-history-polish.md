# Sidebar Chat History Polish Plan

Status: Shipped and verified
Date: 2026-07-19
Implementation: `ed694c5`, `5f9b1ac`, `7824fd9`, `28f60ca`, `7228f94`,
and `b8eef04`

## Goal

Make the expanded Counselle sidebar calmer, flatter, and easier to scan, with a
specific focus on the chat-history search and rows.

The finished sidebar should preserve Counselle's restrained warm-charcoal
identity while borrowing the useful qualities of the supplied reference:
quiet hierarchy, compact history rows, minimal repeated decoration, and a
scroll area that disappears into the product.

## Approved Product Decisions

- Keep the brand header, primary workspace navigation, collapsed-sidebar
  behavior, mobile sheet, and account footer structurally unchanged.
- Keep `Recent chats` as a single chronological list. Do not add date-grouping
  labels or grouping logic for a list currently capped at 50 sessions.
- Keep chat search permanently visible in the expanded sidebar.
- Make search a flat utility control: transparent at rest, no permanent shadow
  or prominent border, a single leading search icon, and clear hover/focus
  states.
- Remove the repeated message icon from every chat row.
- Use typography, spacing, and subtle state surfaces to distinguish default,
  hover, active, focus, and generating rows. Do not add active stripes, dots,
  checks, or decorative badges.
- Keep rename/delete in the existing trailing overflow menu. The control may be
  visually quiet, but it must stay keyboard- and touch-accessible.
- Make the chat list the only scrolling region inside the expanded sidebar.
  The header, primary navigation, `Recent chats` label, search control, and
  account footer remain fixed.
- Reuse the existing warm-charcoal tokens and Geist typography. Do not adopt a
  generic messenger-blue palette, a new font, glass effects, gradients, or
  card styling.

## Current Implementation

The relevant implementation is already feature-separated:

- `frontend/src/features/shell/AppSidebar.tsx` composes the sidebar and owns the
  high-level vertical layout.
- `frontend/src/features/shell/MainNav.tsx` owns primary navigation. It is not a
  redesign target.
- `frontend/src/features/ai-sidebar/ChatSessionList.tsx` owns session loading,
  client-side filtering, list states, and scroll markup.
- `frontend/src/features/ai-sidebar/ChatSessionRow.tsx` owns navigation, active
  state, generating state, title truncation, and row composition.
- `frontend/src/features/ai-sidebar/ChatSessionActions.tsx` owns rename/delete
  actions and already provides the correct desktop-hover/mobile-visible
  behavior through `SidebarMenuAction`.
- `frontend/src/components/ui/sidebar.tsx` provides the generic shadcn sidebar
  primitives.
- `frontend/src/index.css` owns the semantic shell tokens and global scrollbar
  treatment.

The current visual problems have direct causes:

1. `SidebarInput` inherits a conventional bordered input surface, so the
   secondary filter competes visually with primary navigation.
2. Every `ChatSessionRow` renders the same `MessageSquare` icon, which adds no
   discriminating information and creates a noisy repeated rail.
3. Chat rows use nearly the same rounded icon-and-label vocabulary as primary
   navigation, so history reads as a second navigation block rather than a
   quiet content list.
4. `SidebarContent` and the nested chat menu can both scroll, creating ambiguous
   scroll ownership and contributing to the conspicuous scrollbar shown in the
   supplied screenshot.

## Worktree Safety

There are existing uncommitted user changes in the exact shared surfaces that
affect scrolling:

- `frontend/src/components/ui/sidebar.tsx`
- `frontend/src/components/ui/scroll-area.tsx`
- `frontend/src/index.css`
- `frontend/src/components/ui/command.tsx`

Those changes introduce tokenized native scrollbar styling, remove the
sidebar's `no-scrollbar` class, and alter the shared `ScrollArea` presentation.
They must be treated as user-owned work.

Before implementation:

1. Re-read the live diff and determine the intended final scrollbar behavior.
2. Preserve the existing edits; do not restore old files or replace the global
   scrollbar system.
3. Keep this feature's layout change narrowly scoped through feature-level
   classes in `AppSidebar` and `ChatSessionList`.
4. Only add sidebar-specific scrollbar tokens or selectors if browser
   verification proves the current tokenized native scrollbar still fails.
   Do not create a second competing scrollbar implementation preemptively.

## Design Specification

### Hierarchy and spacing

- Preserve the existing 16px sidebar outer inset.
- Keep primary navigation rows at their current hierarchy.
- Use 18–24px of perceived separation between primary navigation and chat
  history. Prefer the existing layout gap over adding a decorative container.
- Keep the `Recent chats` label compact and subdued, but override the shared
  label's opacity treatment locally so the 12px text still meets WCAG AA.
- Use 6–8px between the label and search and 8–10px between search and results.
- Avoid extra borders unless a visual check shows that spacing alone does not
  separate the two navigation levels. If a separator is necessary, use the
  existing one-pixel sidebar-border token, not a new color.

### Search control

- Visible placeholder: `Search`.
- Accessible name: `Search chats`.
- Keep `type="search"` and the current controlled client-side filtering.
- Add one Lucide search icon, marked `aria-hidden="true"`, inside a relative
  wrapper so the icon does not become a separate focus target.
- Default state: transparent surface, transparent border, no shadow.
- Hover state: existing `sidebar-accent` surface and readable sidebar text.
- Focus-visible state: existing sidebar ring token plus the same quiet surface;
  focus must not rely on color alone or disappear into hover.
- Disabled state is not currently required because filtering is local and the
  input is rendered only after the list request begins. Do not invent one.
- Desktop visual height: 32px. Mobile/touch height: at least 44px.
- Use the existing sidebar/input radius scale, capped around 6–8px; do not make
  the search control a pill or card.
- Keep the placeholder contrast at WCAG AA. The existing
  `--shell-sidebar-foreground` (`#969593`) is approximately 5.63:1 against the
  sidebar background and 5.18:1 against the hover surface, so it is suitable.
  Apply that token without the generic input's `/72` placeholder opacity,
  which would weaken the verified contrast.

### Chat rows

- Remove the `MessageSquare` import and rendered icon.
- Let the title start at the row's content inset.
- Retain one-line truncation and expose the full title through a native
  `title={title}` attribute. Remove the current `SidebarMenuButton` `tooltip`
  prop for chat rows: that primitive only displays tooltips while the sidebar
  is collapsed, but chat rows render only while it is expanded, so the current
  tooltip is ineffective.
- Preserve `aria-current="page"`, route behavior, modified-click behavior, and
  mobile-sheet closing behavior.
- Desktop visual height: 30–32px. Mobile/touch height: at least 44px.
- Horizontal padding: approximately 4–6px, with trailing space reserved for the
  existing action control so revealing it never shifts the title.
- List gap: 0–2px. Rows should read as history, not individual cards.
- Default: `sidebar-foreground`, regular weight, transparent background.
- Hover: existing `sidebar-accent` surface and
  `sidebar-accent-foreground` text.
- Active: the same quiet surface family, brighter text, and medium weight.
  Active history must remain visually subordinate to active primary navigation.
- Focus-visible: visible semantic ring, distinct from hover.
- Generating: keep the trailing spinner and its accessible status label.
- Overflow action: preserve hover/focus disclosure on desktop and persistent
  reachability on touch layouts. Do not change rename/delete behavior in this
  visual pass.

### Empty, loading, and error states

- Keep the existing three-row skeleton; update its geometry only if necessary
  to match the icon-free row inset.
- Keep the load error concise. No new retry mechanism is in scope because this
  plan is visual polish and the existing query lifecycle is unchanged.
- With no sessions and no query, use `No recent chats.` or the existing product
  copy; do not add a large empty-state card inside the narrow sidebar.
- With a non-empty search query and no matches, show
  `No chats match “{query}”.` so filtering does not look like an empty account.
- Do not add autocomplete, server search, highlighting, or date grouping.

### Scroll behavior

- Override the expanded app sidebar's content region to prevent it from owning
  a second scrollbar.
- Make the chat-history group and group content consume the remaining height
  with `min-height: 0` and flex growth.
- Make the session menu the sole `overflow-y: auto` element and ensure it has a
  constrained flex height.
- Leave the account footer outside the scrolling region.
- Reuse the in-progress tokenized native scrollbar: transparent track, no
  browser arrow buttons, a thin rounded thumb, and stronger hover/active thumb
  states.
- Do not introduce scroll-jacking, custom wheel handlers, a hidden scrollbar
  with no overflow affordance, or another nested `ScrollArea` unless native
  browser verification demonstrates a concrete failure.

### Motion

- Limit motion to 150–200ms color/opacity transitions for hover, focus, and the
  overflow action.
- Do not animate row dimensions or list layout.
- Preserve the existing reduced-motion handling. The sidebar must remain fully
  understandable with transitions disabled.

## File-Level Implementation Map

### `frontend/src/features/shell/AppSidebar.tsx`

- Keep composition and collapse behavior unchanged.
- Adjust the `SidebarContent` classes so it is the fixed flex frame rather than
  an additional scroll owner.
- Tune the gap between `MainNav` and `ChatSessionList` only if the existing
  `gap-4` does not meet the approved hierarchy after row/search changes.

### `frontend/src/features/ai-sidebar/ChatSessionList.tsx`

- Add the non-interactive Lucide search icon and wrapper.
- Apply feature-specific flat search classes instead of changing every
  `SidebarInput` globally.
- Change only the visible placeholder to `Search`; keep the current accessible
  name so tests and assistive technology remain explicit.
- Distinguish the two empty cases using `searchQuery.trim()`.
- Make group content and the session menu participate correctly in the single
  constrained flex/scroll chain.
- Align skeleton and status messages to the icon-free title inset.

### `frontend/src/features/ai-sidebar/ChatSessionRow.tsx`

- Remove the redundant message icon and import.
- Replace the current chat-row classes with the approved compact, quiet state
  hierarchy.
- Add the native full-title hover affordance and preserve all routing, active,
  generating, and action-spacing logic.

### `frontend/src/features/ai-sidebar/ChatSessionActions.tsx`

- No behavioral changes expected.
- Only adjust placement or state classes if the shorter icon-free row makes the
  current trailing alignment visibly incorrect.
- Preserve the existing dropdown, rename dialog, delete action, busy state, and
  accessible names.

### `frontend/src/components/ui/sidebar.tsx`

- Do not alter the shared primitive merely to style this feature.
- Preserve the user's current scrollbar-related diff.
- Change this file only if implementation reveals a generic primitive defect
  affecting all sidebar consumers; document that reason in the diff.

### `frontend/src/index.css`

- Reuse existing semantic sidebar and scrollbar tokens.
- Do not add raw colors to feature components.
- Preserve the current uncommitted scrollbar work.
- Add a new semantic token only if an approved state cannot be expressed with
  `sidebar`, `sidebar-foreground`, `sidebar-accent`,
  `sidebar-accent-foreground`, `sidebar-border`, or `sidebar-ring`.

### `frontend/src/features/ai-sidebar/ChatSessionList.test.tsx`

- Keep the existing behavior coverage for loading sessions, active state,
  generating state, client-side filtering, routing, rename, and delete.
- Update copy assertions only where the query-specific no-match state changes.
- Do not add brittle tests for Tailwind class strings, pixel values, icon count,
  hover colors, or scrollbar CSS. Those are cheaper and more trustworthy to
  verify in the browser.
- Add one regression assertion for the query-specific no-match message only if
  that branch is implemented; this test earns its place because it distinguishes
  filtering from a genuinely empty account.

## Implementation Sequence

### Phase 0: Reconfirm the live baseline

1. Review `git status` and the diffs for the four user-modified shared files.
2. Run the current targeted sidebar tests once to establish a known-good
   behavior baseline.
3. Search the shadcn MCP registries from `frontend/` for sidebar search/history
   patterns as required by the project's registry-first policy. Reuse the
   already-installed `SidebarInput`, `SidebarMenu`, and Lucide primitives unless
   a registry result materially improves the approved design. Do not add a
   dependency for a cosmetic variant.

### Phase 1: Establish one scroll owner

1. Constrain `SidebarContent` at the `AppSidebar` usage site.
2. Extend the flex/min-height chain through `SidebarGroup`,
   `SidebarGroupContent`, and the session `SidebarMenu`.
3. Verify with 50 sessions that only the history list scrolls and the account
   footer never moves or overlaps content.
4. Verify that the collapsed sidebar and mobile sheet still behave normally.

### Phase 2: Flatten search

1. Add the single decorative search icon.
2. Apply the transparent default, subtle hover, visible focus, and responsive
   height states with existing semantic tokens.
3. Change the placeholder to `Search` while retaining `aria-label="Search chats"`.
4. Add the query-specific no-results copy without changing filter semantics or
   request behavior.

### Phase 3: Quiet the chat rows

1. Remove the repeated message icon.
2. Tighten row inset, radius, height, and list gap.
3. Apply the approved default/hover/active/focus hierarchy.
4. Re-check trailing spinner and overflow-menu alignment with long titles.
5. Verify the action menu remains discoverable by mouse, keyboard, and touch.

### Phase 4: Reconcile scrollbar presentation

1. Test the existing in-progress global scrollbar rules in Chromium and one
   non-WebKit engine if available.
2. Confirm the chat list has no visible track or arrow buttons at rest and that
   its thumb remains discoverable during hover/scroll.
3. If the current system passes, add no new CSS.
4. If it fails only in the sidebar, scope the smallest correction to the chat
   list rather than changing every scrollable surface in the application.

### Phase 5: Verify and review

Run from `frontend/`:

```bash
npm run typecheck
npm test -- src/features/ai-sidebar/ChatSessionList.test.tsx
npm test -- src/app/shell/WorkspaceShell.test.tsx
npm test
npm run lint
npm run build
```

Run from the repository root:

```bash
git diff --check
```

Then perform a code-review pass focused on accidental shared-primitive changes,
accessibility, and preservation of existing behavior.

## Browser Verification Matrix

Use the real app shell and store all screenshots under `artifacts/`.

### Desktop

- Expanded sidebar around the current 256px width.
- Default, hover, active, keyboard-focus, and generating chat rows.
- Empty account, loading, load error, search match, and search no-match states.
- Very long titles and untitled fallback.
- 50-session overflow with wheel, trackpad, keyboard, and scrollbar dragging.
- Confirm header, primary nav, search, and account footer remain fixed while the
  history list scrolls.
- Confirm the title does not move when the overflow action appears.

### Mobile/touch

- 375px viewport and one wider phone viewport.
- Sidebar sheet opens and closes normally.
- Search and chat rows provide at least 44px interaction height.
- Overflow actions remain reachable without hover.
- Long titles do not create horizontal scrolling.
- The on-screen keyboard does not make the footer cover search results.

### Accessibility

- Tab order follows search → chat links/actions → footer controls.
- Focus rings remain visible on the dark background and are not clipped by the
  list's overflow boundary.
- `aria-current` identifies the active chat.
- The search retains an explicit accessible name despite the shorter visible
  placeholder.
- The generating spinner remains announced as status.
- Primary and secondary text meet WCAG AA; verify both rest and hover surfaces.
- Reduced-motion mode does not remove state feedback.

## Non-Goals

- No redesign of primary workspace navigation.
- No account-footer redesign.
- No new sidebar information architecture.
- No date grouping, pinning, folders, pagination, virtualization, server-side
  search, autocomplete, or chat-title highlighting.
- No changes to session APIs, caching, rename/delete semantics, routing, or the
  turn lifecycle.
- No new component library, icon library, font, color palette, or animation
  dependency.
- No global scrollbar rewrite as part of this feature.

## Completion Criteria

The plan is complete when:

- search reads as a flat secondary utility instead of a bordered form card;
- chat rows contain no repeated message icon and scan cleanly at high density;
- active, hover, focus, and generating states are distinct without visual noise;
- only the chat list scrolls and the large white track/arrows are absent;
- desktop, mobile, keyboard, and long-title behavior are verified;
- existing session navigation, filtering, rename, delete, collapse, and mobile
  sheet tests pass;
- type-check, lint, build, targeted tests, and `git diff --check` pass;
- no unrelated user changes are overwritten.

After implementation and verification, graduate this plan from `plans/` to an
appropriate `specs/<feature>/plan/` location or delete it if the work is
abandoned, following `plans/README.md`.
