# MVP3 Essay Workspace Import Plan

## Goal

Import the MVP3 essay workspace into the rebuilt Counselle frontend cleanly, using the current shell, sidebar, page header, warm dark design system, shadcn/Base UI primitives, and feature-first architecture.

The import should not copy the MVP3 page blindly. It should preserve the useful product behavior while making it native to the current app:

- `/essays` becomes the essay library/workspace page;
- `/essays/:essayId` becomes the focused essay editor;
- visual styling comes from semantic tokens in `frontend/src/index.css`;
- feature code stays under `frontend/src/features/essays`;
- pure model/content logic is testable without React;
- editor state and route state are explicit;
- no LibreChat-era, prototype, raw color, or one-off component styling leaks in.

## Source Inventory

MVP3 source files to evaluate and port:

- `mvp3-frontend/src/features/essays/EssaysRoute.tsx`
- `mvp3-frontend/src/features/essays/EssayEditorRoute.tsx`
- `mvp3-frontend/src/features/essays/EssayEditorHeader.tsx`
- `mvp3-frontend/src/features/essays/EssayEditorToolbar.tsx`
- `mvp3-frontend/src/features/essays/useEssayEditor.ts`
- `mvp3-frontend/src/features/essays/essay-content.ts`
- `mvp3-frontend/src/features/essays/essay-filters.ts`
- `mvp3-frontend/src/features/essays/essay-toolbar-config.ts`
- `mvp3-frontend/src/features/essays/essays-model.test.ts`
- `mvp3-frontend/src/components/ui/compose-email-card.tsx`
- `mvp3-frontend/src/components/ui/toolbar.tsx`
- `mvp3-frontend/src/domain/essay.ts`
- `mvp3-frontend/src/fixtures/essays.ts`
- `mvp3-frontend/src/lib/essay-display.ts`
- essay editor CSS in `mvp3-frontend/src/index.css`
- MVP3 route wrappers:
  - `mvp3-frontend/src/pages/essays-page.tsx`
  - `mvp3-frontend/src/pages/essay-editor-page.tsx`
  - `mvp3-frontend/src/app/routes/essays-route.tsx`
  - `mvp3-frontend/src/app/routes/essay-editor-route.tsx`

Current app integration points:

- `frontend/src/app/router.tsx`
- `frontend/src/app/shell/navigation.tsx`
- `frontend/src/components/workspace/PageHeader.tsx`
- `frontend/src/index.css`
- `frontend/src/pages/*`
- `frontend/src/features/{schools,tasks,activities}`
- `frontend/src/app/shell/WorkspaceShell.test.tsx`

## Key Differences From MVP3

The current app is not the same surface as `mvp3-frontend`.

- Current `/essays` is still a placeholder `RouteSurface`.
- Current `frontend/package.json` does not include TipTap:
  - `@tiptap/react`
  - `@tiptap/starter-kit`
  - `@tiptap/extension-placeholder`
  - `@tiptap/extension-text-align`
  - `@tiptap/extension-text-style`
- Current app does not have `frontend/src/components/ui/toolbar.tsx`.
- Current app already has document tokens in `index.css`, but the essay import needs to verify they are the right product tokens, not raw MVP3 leftovers.
- Current pages use `PageHeader`; MVP3 `EssaysRoute.tsx` has its own page title stack with "Essays", "Essay workspace", and summary text. That should be replaced with the shared header pattern.
- MVP3 `compose-email-card.tsx` is a feature-specific essay card living under `components/ui`, which is not the right boundary now. It should move into `features/essays`.
- MVP3 card interactivity uses `article role="button"` with nested buttons. We should avoid that pattern, following the activities import fix: real internal buttons/links for primary actions, and menu buttons that do not create nested interactive semantics.
- MVP3 uses a manual popover for card actions. The current app already has an expanded `DropdownMenu`; use it instead.

## Architecture Target

Create this structure:

```text
frontend/src/domain/essay.ts
frontend/src/fixtures/essays.ts
frontend/src/lib/essay-display.ts
frontend/src/pages/essays-page.tsx
frontend/src/pages/essay-editor-page.tsx
frontend/src/features/essays/
  EssaysRoute.tsx
  EssayEditorRoute.tsx
  EssayLibraryCard.tsx
  EssayDocumentPreview.tsx
  EssayEditorHeader.tsx
  EssayEditorToolbar.tsx
  essay-content.ts
  essay-filters.ts
  essay-toolbar-config.ts
  essays-types.ts
  useEssayEditor.ts
  essays-model.test.ts
  EssaysRoute.test.tsx
```

Add only if needed:

```text
frontend/src/components/ui/toolbar.tsx
```

Do not put essay-specific cards under `components/ui`. Shared UI is for generic primitives only.

## Route Design

Update `frontend/src/app/router.tsx`:

- `/essays` renders `EssaysPage`;
- `/essays/:essayId` renders `EssayEditorPage`;
- unknown essay IDs should not crash.

Preferred unknown-ID behavior:

- render the editor route with `fallbackEssay` only if no ID is provided;
- if an explicit unknown ID is provided, navigate back to `/essays` or show a small native not-found state with a "Back to essays" action.

Keep the existing shell mounted across both routes. The editor should not replace the sidebar shell.

Route wrapper files:

- `frontend/src/pages/essays-page.tsx` exports the feature route;
- `frontend/src/pages/essay-editor-page.tsx` exports the editor route or a thin wrapper that resolves route params.

Use `useNavigate` and `useParams` in a route-level wrapper, not inside low-level editor components.

## Library Page Plan

`EssaysRoute.tsx` should be the essay library page:

- root layout follows current page pattern:
  - `section.relative.flex.min-h-0.min-w-0.flex-1.overflow-hidden`;
  - inner `workspace-scrollbar ... overflow-y-auto pr-8 pb-6 pl-6 md:pr-10`;
  - shared `<PageHeader title="Essay workspace" />`;
  - header action: `New essay`.
- remove MVP3 eyebrow and summary line:
  - no standalone "Essays";
  - no "`n` essays, `n` need review..." under the title.
- keep counts inside filters where they are actionable.
- preserve search, filters, and the essay card grid.
- filter controls should follow the existing Schools/Tasks pattern:
  - `Tabs`, `TabsList`, `TabsTab`;
  - `Input` with `Search` icon;
  - no bespoke segmented-control component.
- empty result state should use shadcn `Empty`, not custom markup.

Library behavior:

- clicking the card's primary open affordance navigates to `/essays/:essayId`;
- menu actions can be present but non-destructive stubs are acceptable for this import;
- if "Duplicate" and "Mark ready" are kept, either implement local immutable mutations or remove the actions for now. Do not leave buttons that look real but do nothing.

## Editor Page Plan

`EssayEditorRoute.tsx` should be a focused editor within the same shell:

- top header uses the shared visual language, but it is editor-specific enough to stay inside the feature.
- replace MVP3 raw backgrounds:
  - `bg-[oklch(...)]`;
  - `dark:bg-[oklch(...)]`;
  - `border-border/80`, `bg-background/95`, and similar alpha styling should be mapped to semantic essay/workspace tokens where it affects the designed surface.
- keep the editor document as a deliberate light writing surface. This is not a violation if the document tokens are semantic:
  - `--essay-document-surface`;
  - `--essay-document-foreground`;
  - `--essay-document-muted`;
  - `--essay-document-border`;
  - alias existing `--document-*` tokens to these if we want to preserve the current shadcn color names.
- the surrounding workspace/editor chrome should use the same dark warm system as Tasks/Activities.
- bottom floating toolbar remains, but should use workspace tokens and the generic `Toolbar` primitive.

Editor behavior to preserve:

- initial content is derived from the selected essay preview;
- word count updates on edit;
- save state changes from `saved` to `unsaved` on edit;
- Save button returns to saved state and updates modified label;
- over-limit count uses semantic danger styling;
- prompt menu shows the prompt text;
- back button returns to `/essays`;
- reduced motion disables movement animation.

## Dependency Plan

Install TipTap dependencies in `frontend/package.json` by using npm from `frontend/`:

```bash
cd frontend
npm install @tiptap/react @tiptap/starter-kit @tiptap/extension-placeholder @tiptap/extension-text-align @tiptap/extension-text-style
```

Do not install unrelated MVP3 dependencies such as Schedule-X or Temporal for this import.

`motion` already exists in current `frontend`, so no extra animation dependency is needed.

## shadcn / Primitive Plan

Already installed primitives:

- `avatar`
- `badge`
- `button`
- `card`
- `dropdown-menu`
- `empty`
- `input`
- `select`
- `separator`
- `tabs`
- `tooltip`

Registry search results:

- `@shadcn` does not currently ship a matching `toolbar` item for this project;
- `@ai-elements` has a `toolbar`, but it is AI-oriented and not obviously better for a rich-text formatting toolbar.

Plan:

- add `frontend/src/components/ui/toolbar.tsx` from the MVP3 Base UI primitive because it is a generic primitive, small, and uses `@base-ui/react/toolbar`, already available via `@base-ui/react`;
- keep it generic and tokenized;
- do not put essay-specific toolbar styling in the primitive;
- use existing `Select`, `Button`, and icon conventions;
- ensure icons inside buttons use `data-icon` where the Button renders text, and no manual icon size classes inside icon-only buttons unless the local primitive requires it.

## Design Token Plan

Add essay-specific tokens in `frontend/src/index.css` near the current workspace/activity tokens.

Suggested semantic tokens:

```css
--essay-library-card-surface: var(--workspace-task-card-surface);
--essay-library-card-hover: var(--workspace-task-card-hover);
--essay-library-card-border: var(--workspace-task-card-border);
--essay-library-card-frame: var(--workspace-surface-raised);
--essay-editor-chrome-surface: var(--workspace-surface);
--essay-editor-header-surface: var(--workspace-surface-raised);
--essay-editor-toolbar-surface: var(--workspace-surface-raised);
--essay-editor-toolbar-border: var(--workspace-border);
--essay-document-surface: var(--document);
--essay-document-foreground: var(--document-foreground);
--essay-document-muted: var(--document-muted);
--essay-document-border: var(--document-border);
```

Then either:

- keep existing `--document-*` as canonical shadcn document tokens and alias essay tokens to them; or
- make `--essay-document-*` canonical and alias `--document-*` to essay tokens.

Avoid raw colors in essay feature components. Raw values are acceptable only inside token definitions after they have a semantic name.

Token decisions:

- the app background remains `--shell-background: #171615`;
- sidebar remains `--shell-sidebar-background: #1e1d1b`;
- essay cards should not be transparent;
- hover states should use the same family as sidebar/task hover, not MVP3 gray alpha surfaces;
- document page can stay light because it represents the writing artifact, not app chrome.

## CSS Plan

Move the ProseMirror editor CSS from MVP3 into `frontend/src/index.css` under `@layer components`, but rename/select carefully:

- keep `.essay-editor-shell .ProseMirror`;
- avoid global ProseMirror styling that could affect future editors;
- use document tokens for all colors;
- keep `font-family: var(--font-document)`;
- keep content typography readable and print-like;
- preserve placeholder styling through `data-placeholder`;
- do not add artifact/prototype CSS outside the feature selector.

Current MVP3 CSS to port:

- editor min height;
- spacing between blocks;
- h1/h2 document typography;
- paragraph/list/blockquote typography;
- list styles;
- blockquote border;
- empty placeholder.

## Data / Domain Plan

Port `frontend/src/domain/essay.ts`, but tighten naming:

- `EssayStatus`
- `EssayType`
- `Essay`
- optional `EssayRisk`

Prefer app-native names over MVP3's `EssayLibraryCardData` if the touch scope is limited to this feature. If renaming would create noisy code, keep the MVP3 type name for the first import and add a follow-up cleanup.

Keep fixtures in `frontend/src/fixtures/essays.ts`.

Pure functions stay outside React:

- filtering;
- search text generation;
- word counting;
- HTML escaping;
- initial content generation;
- fallback initial selection;
- prompt derivation;
- school fallback initials;
- status-to-badge mapping;
- activity label formatting.

Do not store mutable global editor content in fixtures. Editor state should be local in the route until a real persistence layer exists.

## Component Refactor Plan

### `EssayLibraryCard`

Move MVP3 `compose-email-card.tsx` into `features/essays/EssayLibraryCard.tsx`.

Refactor:

- no `"use client"` directive needed in Vite, but harmless; prefer removing it for consistency;
- replace manual popover with `DropdownMenu`;
- avoid `article role="button"` wrapping nested buttons;
- expose a real primary `<button>` or `<Link>` area for opening the essay;
- keep action menu separate and stop propagation only where necessary;
- use semantic tokens for card frame, preview document, hover, border, and focus ring;
- keep reduced-motion handling;
- do not use `rounded-2xl` if it fights current app direction. Prefer app radius tokens/classes consistent with existing components unless the document preview specifically needs a softer page-card treatment.

### `EssayDocumentPreview`

Split out from card if the file starts getting large.

Responsibilities:

- render preview title;
- render preview lines;
- render blank state;
- use document tokens;
- no route or mutation logic.

### `EssayEditorHeader`

Keep in feature scope.

Refactor:

- use `DropdownMenu` for prompt menu;
- use `Separator` or tokenized divider helper instead of raw border when suitable;
- avoid raw status dot colors by mapping to tokens/classes;
- maintain responsive layout without overlapping text;
- ensure long essay titles truncate cleanly.

### `EssayEditorToolbar`

Keep the toolbar feature-specific, built from generic `Toolbar`, `Button`, and `Select`.

Refactor:

- toolbar button config can stay in `essay-toolbar-config.ts`;
- use `ToolbarGroup` and `ToolbarSeparator`;
- maintain disabled state when editor is not ready;
- keep button labels and titles for accessibility;
- use tokenized active state, not raw `bg-secondary` overrides if that produces inconsistent contrast.

### `useEssayEditor`

Keep as the only TipTap integration point.

Responsibilities:

- configure extensions;
- set initial content;
- expose editor and toolbar state;
- call `onUpdate` with plain text;
- avoid component-level TipTap extension setup duplication.

Review `immediatelyRender: true`; if it causes React 19/Vite test or hydration warnings, remove it or set a value recommended by TipTap for client-only React usage.

## Testing Plan

Port and expand MVP3 model tests into:

- `frontend/src/features/essays/essays-model.test.ts`

Coverage:

- `matchesFilter` for all filters;
- `filterEssays` query + filter combinations;
- count per filter;
- empty query behavior;
- `countWords` handles empty/whitespace/multiple spaces;
- `escapeHtml` escapes `& < > " '`;
- `getInitialEssayContent` escapes preview content;
- blank essay fallback content;
- `getEssayPrompt` Common App/personal/supplement branches;
- `getSchoolFallback` multi-word and single-word schools.

Add React route tests:

- `frontend/src/features/essays/EssaysRoute.test.tsx`

Coverage:

- renders shared header title and New essay action;
- renders filters with counts;
- search filters cards;
- filter tab narrows cards;
- empty state appears when no result;
- opening an essay calls route callback or navigates in route-level test;
- card action menu opens and does not open the editor by accident.

Add editor behavior tests if TipTap can run reliably in jsdom:

- renders selected essay title;
- Back button callback fires;
- prompt menu shows prompt text;
- word count renders initial count;
- Save button state changes after editing if simulating editor input is reliable.

If TipTap jsdom editing is flaky, keep editor tests focused on route/header/prompt and pure model tests for count/content derivations. Do not write brittle DOM-selection tests.

Update `WorkspaceShell.test.tsx`:

- `/essays` sidebar click should now find `Essay workspace`, not placeholder `Essays`;
- add coverage for navigating to `/essays/common-app-main` if route-level smoke is useful;
- verify the shell remains mounted when moving between list and editor.

## Verification Plan

Run from repo root:

```bash
cd frontend && npm run typecheck
cd frontend && npm test -- --run
cd frontend && npm run lint
cd frontend && npm run build
git diff --check
```

Search checks:

```bash
rg -n "LibreChat|librechat|mvp3-frontend|frontend.backup" frontend/src/features/essays frontend/src/domain/essay.ts frontend/src/fixtures/essays.ts
rg -n "bg-\\[|text-\\[#[0-9a-fA-F]|#[0-9a-fA-F]{3,8}|white/" frontend/src/features/essays frontend/src/pages/essays-page.tsx frontend/src/pages/essay-editor-page.tsx
rg -n "compose-email-card" frontend/src
```

Expected:

- no source references to MVP3/backup/LibreChat;
- no raw hex or MVP3 arbitrary color classes in essay feature files;
- no `compose-email-card` generic UI file remains;
- build passes after TipTap dependency install.

## Implementation Order

1. Install only required TipTap packages in `frontend`.
2. Add the generic `Toolbar` primitive if still absent.
3. Add essay domain, fixture, display, filter, and content modules.
4. Add model tests and make them pass.
5. Add document/editor tokens and ProseMirror scoped CSS in `index.css`.
6. Build `EssayLibraryCard` and `EssayDocumentPreview` from the MVP3 card, refactored for current architecture.
7. Build `EssaysRoute` using `PageHeader`, current shell spacing, tokens, shadcn primitives, search, tabs, and empty state.
8. Add `/essays` page wrapper and wire router.
9. Build `useEssayEditor`, editor header, toolbar, and editor route.
10. Add `/essays/:essayId` wrapper/route and back navigation.
11. Add route/component tests.
12. Run full frontend verification.
13. Do a cleanup scan for raw prototype imports, artifacts, hardcoded visual styling, and dead files.

## Risks / Decisions

- TipTap is a real dependency increase. It is justified because a rich essay editor should not be hand-rolled.
- The document itself should probably stay light for writing ergonomics. The surrounding app chrome must stay in the new dark Counselle system.
- MVP3 card design is visually strong but too prototype-specific. Keep the document preview idea, not the exact generic `compose-email-card` location or manual popover implementation.
- Do not build persistence in this import. Local editor state is enough until backend essay objects exist.
- Do not import the calendar or other MVP3 dependencies transitively.

## Done Criteria

- `/essays` is a real essay workspace using the new page header pattern.
- `/essays/:essayId` opens a focused editor for the chosen essay.
- Sidebar navigation works and the shell stays mounted.
- Cards, controls, editor chrome, and toolbar use semantic tokens.
- No raw color/prototype styling is left in essay feature components.
- Essay-specific UI is not placed under generic `components/ui`.
- Pure behavior is tested.
- Route behavior is tested.
- `typecheck`, tests, lint, build, and `git diff --check` pass.
