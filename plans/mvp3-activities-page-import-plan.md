# MVP3 Activities Page Import Plan

Status: Draft
Date: 2026-07-05

## Goal

Import the Activities page from `mvp3-frontend` into the rebuilt main `frontend` app as production-quality code.

The result should feel native to the new Counselle workspace: same shell, same warm dark color system, same shared page header pattern, shadcn primitives where they fit, domain logic outside UI components, fixture data isolated, and tests covering the behavior that matters.

This is not a raw copy. MVP3 Activities is a real feature slice with domain rules, drawers, character budgets, deep links, drag reordering, deletion undo, and model tests. The import should preserve that behavior while cleaning up prototype styling and aligning it with the current main app architecture.

## Source And Target

- Source feature: `mvp3-frontend/src/features/activities`
- Source page export: `mvp3-frontend/src/pages/activities-page.tsx`
- Source route wrapper: `mvp3-frontend/src/app/routes/activities-route.tsx`
- Source domain model: `mvp3-frontend/src/domain/activity.ts`
- Source fixture data: `mvp3-frontend/src/fixtures/activities.ts`
- Source shared domain dependency: `mvp3-frontend/src/domain/shared.ts`
- Source time dependency: `mvp3-frontend/src/domain/time.ts`
- Target app: `frontend`
- Target route: `/activities`

## Current Findings

The main `frontend` app currently has:

- the rebuilt shell/sidebar foundation;
- a real `/schools` route;
- a real `/tasks` route;
- `/activities` still rendering `RouteSurface title="Activities"`;
- shared workspace header primitive at `frontend/src/components/workspace/PageHeader.tsx`;
- warm dark semantic tokens in `frontend/src/index.css`;
- shadcn/Radix Nova project config with Tailwind v4, lucide icons, and `@/` import alias;
- installed primitives needed by Activities:
  - `badge`
  - `button`
  - `dropdown-menu`
  - `empty`
  - `input`
  - `select`
  - `sheet`
  - `tabs`
  - `textarea`

The MVP3 Activities feature includes:

- `ActivitiesRoute.tsx`: page state, tab state, add/delete/undo wiring, drawer wiring, reorder wiring.
- `ActivityRow.tsx`: activity list row, status indicators, row menu, row drag/drop, keyboard open.
- `HonorRow.tsx`: honor list row, row menu, row drag/drop, keyboard open.
- `ActivityDrawer.tsx`: editable activity details drawer.
- `HonorDrawer.tsx`: editable honor details drawer.
- `SectionStatus.tsx`: ready/not-ready/over-limit summary badges.
- `UndoToast.tsx`: local undo feedback after delete.
- `activity-form-controls.tsx`: checkbox-chip groups, copy buttons, number input, drawer field layout.
- `activity-indicators.tsx`: character counters, character-limit announcer, rank badge.
- `activities-config.ts`: undo/copy timings, drawer control styling, character state classes.
- `activities-format.ts`: readable date formatting.
- `activities-mutations.ts`: immutable create/update/remove/insert helpers and stats.
- `activities-reorder.ts`: immutable renumber/reorder/swap/toggle helpers.
- `activities-deep-link.ts`: pure `?activity=` / `?honor=` parsing and resolution.
- `useActivitiesDeepLink.ts`: route search-param state and drawer/tab synchronization.
- `useReorderDrag.ts`: handle-armed drag-to-reorder behavior.
- `activities-types.ts`: feature-level state types.
- `activities-model.test.ts`: coverage for readiness, limits, mutations, reorder, and deep-link resolution.

The source domain model includes:

- Common App activity vocabulary:
  - `ActivityType`
  - `Grade`
  - `Timing`
  - `RecognitionLevel`
  - `Activity`
  - `Honor`
- application limits:
  - `MAX_ACTIVITIES = 10`
  - `MAX_HONORS = 5`
  - position 50 chars
  - organization 100 chars
  - description 150 chars
  - honor title 100 chars
  - hours/week 168 max
  - weeks/year 52 max
- sort/format helpers:
  - `sortGrades`
  - `sortTiming`
  - `sortLevels`
  - `formatGrades`
  - `formatTiming`
  - `formatLevels`
- validation/readiness helpers:
  - `getCharState`
  - `isActivityOverLimit`
  - `getActivityMissingFields`
  - `isActivityReady`
  - `getHonorMissingFields`
  - `isHonorOverLimit`
  - `isHonorReady`

The source also has prototype styling that must be adapted:

- local page header with `Applications` eyebrow and `Activities` title;
- `data-page="activities"` marker;
- several `white/[...]` alpha color utilities;
- drawer control styling in `activities-config.ts` hardcoded to white alpha values;
- checkbox-chip styling in `activity-form-controls.tsx` hardcoded to white alpha values;
- row badge styling in `ActivityRow.tsx` hardcoded to white alpha values.

These should not be copied as-is.

## Product Behavior To Preserve

The imported page must preserve:

1. Two tabs:
   - Activities
   - Honors
2. Common App limits:
   - activities capped at 10;
   - honors capped at 5;
   - add buttons disabled at limits;
   - open slot affordance for activities when below limit.
3. Readiness summaries:
   - paste-ready count;
   - not-ready count;
   - over-limit count.
4. Activity rows:
   - rank number;
   - position/title;
   - organization;
   - description preview or missing-description warning;
   - character counter for description;
   - grades/timing/hours/weeks/college intent metadata;
   - missing field summary;
   - row action menu;
   - click/keyboard open drawer;
   - drag reorder only when armed from the grip.
5. Honor rows:
   - rank number;
   - title;
   - recognition levels;
   - grades;
   - row action menu;
   - click/keyboard open drawer;
   - drag reorder only when armed from the grip.
6. Activity drawer:
   - type select;
   - position input with counter and copy;
   - organization input with counter and copy;
   - description textarea with counter, copy, and live limit announcer;
   - grades checkbox chips;
   - timing checkbox chips;
   - hours/week numeric field;
   - weeks/year numeric field;
   - continue-in-college checkbox;
   - private story textarea;
   - move up/down;
   - delete;
   - created/updated dates.
7. Honor drawer:
   - title textarea with counter and copy;
   - grade checkbox chips;
   - recognition-level checkbox chips;
   - move up/down;
   - delete;
   - created/updated dates.
8. Undo flow:
   - delete removes and renumbers immediately;
   - toast allows undo within `UNDO_WINDOW_MS`;
   - undo reinserts at the original position and renumbers;
   - cleanup timer is cleared on unmount.
9. Deep links:
   - `?activity=<id>` opens activity drawer;
   - `?honor=<id>` opens honor drawer;
   - activity deep link wins if both are present;
   - invalid ids are ignored;
   - closing drawer clears params with replace navigation;
   - active tab follows valid drawer deep link.
10. Reduced motion:
    - layout animations disabled when `useReducedMotion()` is true;
    - undo toast uses instant state under reduced motion.

## Architecture Outcomes

After this import, the app should have:

1. A real `/activities` route wired through `frontend/src/app/router.tsx`.
2. A thin page entry at `frontend/src/pages/activities-page.tsx`.
3. A feature-scoped activities module under `frontend/src/features/activities`.
4. Activity and honor domain types/rules under `frontend/src/domain/activity.ts`.
5. Shared `Option` type reused from `frontend/src/domain/shared.ts`.
6. Demo fixture data under `frontend/src/fixtures/activities.ts`.
7. Time helpers reused from existing `frontend/src/domain/time.ts`.
8. The same shared `PageHeader` used by Schools and Tasks.
9. Activity-specific visual tokens in `frontend/src/index.css`.
10. No raw hex or `white/[...]` styling in feature files.
11. Tests for domain/model behavior and route-level UI behavior.
12. No new app-level provider or global state unless strictly required.

## Non-Negotiable Design Rules

- Use the shared page header:
  - title: `Activities`;
  - right actions only when globally useful;
  - no `Applications` eyebrow;
  - no local duplicated header structure.
- Keep page body consistent with Tasks and Schools:
  - `section` root: `relative flex min-h-0 min-w-0 flex-1 overflow-hidden`;
  - scroll container uses `workspace-scrollbar`;
  - page top aligned under the shared header;
  - no floating card page section wrappers unless the content itself is a list panel.
- Use semantic tokens, not one-off colors.
- Replace MVP3 `white/[...]` alpha styling with named activity/workspace tokens.
- Keep activity/honor list rows visually distinct from the page background and list frame.
- Do not make the row cards transparent.
- Do not add decorative gradients, glass effects, or marketing-style layout.
- Use lucide icons already used in the source; icons inside buttons must use `data-icon` where the Button API expects it.
- Keep every overlay accessible:
  - `SheetTitle` must exist;
  - menu triggers need labels;
  - drawer controls need labels or associated labels;
  - checkbox chips must retain real checkbox semantics.
- Keep files focused and under the project’s size constraints.
- Do not reintroduce LibreChat naming, source paths, or assumptions.

## Token Plan

Add activity-specific tokens to `frontend/src/index.css` under `:root`, near the existing workspace/task tokens.

Recommended token names:

```css
--activity-list-surface
--activity-list-border
--activity-row-surface
--activity-row-hover
--activity-row-border
--activity-row-shadow
--activity-control-surface
--activity-control-hover
--activity-control-border
--activity-chip-surface
--activity-chip-hover
--activity-chip-border
--activity-chip-selected-surface
--activity-chip-selected-border
--activity-warning-fg
--activity-warning-bg
--activity-danger-fg
--activity-danger-bg
```

Map these from existing workspace semantics:

- list surface from `--workspace-task-lane-surface` or `--workspace-surface`;
- row surface from `--workspace-task-card-surface`;
- row hover from `--workspace-task-card-hover`;
- row border from `--workspace-task-card-border`;
- control surface from `--workspace-input`;
- control hover from `--workspace-surface-hover`;
- warning/danger from existing workspace warning/danger pill tokens.

Do not place literal token values in feature components. Feature components should consume tokens through `activities-config.ts` classes or direct `var(--activity-...)` references only when that token is feature-specific.

## File Import Plan

### 1. Domain

Add:

- `frontend/src/domain/activity.ts`

Use the MVP3 source as the base, preserving:

- Common App vocabulary;
- limits;
- option arrays;
- sort helpers;
- format helpers;
- readiness helpers.

Rules:

- Keep domain pure: no React, no DOM, no component imports.
- Keep comments that explain Common App limits and the two-layer model.
- Do not add backend assumptions.
- Do not mutate arrays; keep copy/sort helpers immutable.

### 2. Fixtures

Add:

- `frontend/src/fixtures/activities.ts`

Rules:

- export `initialActivities`;
- export `initialHonors`;
- keep data typed as `Activity[]` and `Honor[]`;
- keep intentionally missing/over-limit fixture entries because they exercise the UI states;
- do not embed fixture data inside the route or drawers.

### 3. Page Entry

Add:

- `frontend/src/pages/activities-page.tsx`

Content:

```ts
export { ActivitiesPage } from "@/features/activities/ActivitiesRoute"
```

No route logic, no data fetching, no wrappers.

### 4. Feature Module

Add:

- `frontend/src/features/activities/ActivitiesRoute.tsx`
- `frontend/src/features/activities/ActivityRow.tsx`
- `frontend/src/features/activities/HonorRow.tsx`
- `frontend/src/features/activities/ActivityDrawer.tsx`
- `frontend/src/features/activities/HonorDrawer.tsx`
- `frontend/src/features/activities/SectionStatus.tsx`
- `frontend/src/features/activities/UndoToast.tsx`
- `frontend/src/features/activities/activity-form-controls.tsx`
- `frontend/src/features/activities/activity-indicators.tsx`
- `frontend/src/features/activities/activities-config.ts`
- `frontend/src/features/activities/activities-format.ts`
- `frontend/src/features/activities/activities-mutations.ts`
- `frontend/src/features/activities/activities-reorder.ts`
- `frontend/src/features/activities/activities-deep-link.ts`
- `frontend/src/features/activities/useActivitiesDeepLink.ts`
- `frontend/src/features/activities/useReorderDrag.ts`
- `frontend/src/features/activities/activities-types.ts`
- `frontend/src/features/activities/activities-model.test.ts`

Adapt imports to the current app’s `@/` aliases.

Do not import from:

- `mvp3-frontend`;
- backup folders;
- old shell/sidebar files;
- old workspace store/provider files.

## Route Composition Plan

Update:

- `frontend/src/app/router.tsx`

Add:

```tsx
import { ActivitiesPage } from "@/pages/activities-page"
```

Replace:

```tsx
{
  path: "activities",
  element: <RouteSurface title="Activities" />,
}
```

with:

```tsx
{
  path: "activities",
  element: <ActivitiesPage />,
}
```

Do not lazy-load at this stage. The current router directly imports Schools and Tasks; Activities should follow that established pattern unless bundle size becomes an actual problem.

## ActivitiesRoute Adaptation Plan

Start from MVP3 `ActivitiesRoute.tsx`, then adapt:

1. Remove `data-page="activities"`.
2. Replace local header:

```tsx
<header>
  <p>Applications</p>
  <h1>Activities</h1>
</header>
```

with shared:

```tsx
<PageHeader title="Activities" />
```

3. Match current page container structure:

```tsx
<section className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
  <div className="workspace-scrollbar flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-y-auto pr-8 pb-6 pl-6 md:pr-10">
    <PageHeader title="Activities" />
    ...
  </div>
  ...
</section>
```

4. Keep content width decision deliberate:
   - source uses `mx-auto max-w-4xl`;
   - main app Tasks uses full-width board;
   - Activities should likely keep a readable max width for form-like list content, but the header must still span the full scroll container.

Recommended structure:

```tsx
<PageHeader title="Activities" />
<div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
  ...
</div>
```

5. Keep tabs as one `Tabs` root.
6. Avoid duplicate `TabsList` markup inside each panel if it creates avoidable duplication.
   - MVP3 repeats the same `TabsList` in both panels.
   - Better architecture: create a small local `ActivitiesTabsHeader` component that receives counts, status, current tab, and add action.
   - Keep it in `ActivitiesRoute.tsx` unless it becomes large enough to deserve a file.
7. Keep `ActivityDrawer`, `HonorDrawer`, and `UndoToast` outside the scroll container but inside the route section, as source does.

## Styling Adaptation Plan

### activities-config.ts

Replace:

```ts
"border-white/[0.075] bg-white/[0.035] ..."
```

with token-based classes:

```ts
"border-[color:var(--activity-control-border)] bg-[color:var(--activity-control-surface)] shadow-none before:shadow-none hover:bg-[color:var(--activity-control-hover)]"
```

Keep `charStateClass`, but ensure warning/danger point to `--activity-warning-fg` and `--activity-danger-fg`.

### activity-form-controls.tsx

Replace checkbox-chip white alpha classes with token classes:

- unchecked:
  - border: `--activity-chip-border`
  - bg: `--activity-chip-surface`
  - hover bg: `--activity-chip-hover`
  - text: `text-muted-foreground`
- checked:
  - border: `--activity-chip-selected-border`
  - bg: `--activity-chip-selected-surface`
  - text: `text-foreground`

Keep real checkbox inputs with `sr-only`; do not replace this with fake buttons unless a proper shadcn checkbox/toggle primitive is added intentionally.

### ActivityRow.tsx

Replace row badge hardcoded white alpha with semantic badge variants or token-backed classes.

Replace row hover surface:

- current source: `hover:bg-muted/25`
- target: `hover:bg-[color:var(--activity-row-hover)]`

Make the row itself a visible card layer:

- background: `--activity-row-surface`;
- border: transparent by default or `--activity-row-border` if visual separation needs it;
- hover border: `--activity-row-border`;
- subtle shadow via `--activity-row-shadow`.

The list frame should not make rows look transparent.

### HonorRow.tsx

Apply the same row surface, hover, border, and shadow treatment as activity rows.

### ActivitiesRoute list frame

Replace:

```tsx
rounded-2xl border bg-card/40 p-1.5 shadow-xs/5
```

with a token-backed panel:

```tsx
rounded-xl border border-[color:var(--activity-list-border)] bg-[color:var(--activity-list-surface)] p-1.5
```

Do not use rounded `2xl` unless the current design system requires it. The current app’s cards should stay 12px-ish, not overly rounded.

## UI Primitive Plan

No new primitive should be added initially.

Already installed:

- `Button`
- `Badge`
- `DropdownMenu`
- `Empty`
- `Input`
- `Select`
- `Sheet`
- `Tabs`
- `Textarea`

Registry note:

- A quick shadcn CLI search for checkbox/toggle-group under the current Radix Nova registry path did not return a clean item.
- MVP3’s `CheckChipGroup` is feature-specific and accessible because it uses real checkbox inputs.
- Keep `CheckChipGroup` inside `features/activities/activity-form-controls.tsx` for now.
- If checkbox/toggle primitives are added later, do it as a separate design-system task, not hidden inside this import.

## Accessibility Plan

Preserve and verify:

- rows use `role="button"` with useful `aria-label`;
- row keyboard open works with `Enter` and `Space`;
- row keyboard handling ignores nested controls;
- row menus have labeled triggers;
- reorder grip buttons have labels;
- drawer titles exist through `SheetTitle`;
- drawer form controls are labeled:
  - `labelFor` + `id` for text inputs/textareas;
  - `ariaLabel` for numeric fields;
  - `ariaLabel` for checkbox-chip groups;
  - select triggers should get explicit labels if not otherwise associated.
- character-limit announcers use `aria-live="polite"` and do not spam every keystroke;
- undo toast uses `role="status"`;
- dismiss button has `aria-label="Dismiss"`;
- disabled add buttons communicate limit state through their visible label.

Add route tests for the most important accessibility surfaces:

- opening drawers by row click;
- opening drawers by keyboard;
- tab switching by tab controls;
- delete undo.

## Reorder Plan

MVP3 uses native drag/drop for list reorder:

- `useReorderDrag` only allows drag after `onArmDrag` fires from the grip;
- row click opens the drawer instead of starting drag;
- dragging over a target reorders immediately;
- motion layout animation handles visual movement.

Import this behavior, but review after implementation for the same drag-image issues seen on Tasks.

Important difference from Tasks:

- Activities reorder does not create a custom drag image.
- It only sets `dataTransfer` payload to the item id.
- This should avoid the offscreen-preview problem we saw in Tasks.

If visual drag behavior is wrong in browser:

- fix `useReorderDrag` in one place;
- do not add per-row drag hacks;
- do not use offscreen `setDragImage`.

## Deep-Link Plan

Import:

- `activities-deep-link.ts`
- `useActivitiesDeepLink.ts`

Keep the URL contract:

- `?activity=<id>`
- `?honor=<id>`

Testing requirements:

- pure model tests for parsing/resolution;
- route test that renders under a router at `/activities?activity=robotics-founder` and confirms the activity drawer opens;
- route test that honors an honor deep link;
- route test that invalid deep links do not open a drawer.

Implementation note:

- `useSearchParams` requires the component to be rendered under React Router in tests.
- Use `createMemoryRouter` or `MemoryRouter` test wrapper for deep-link route tests.

## Test Plan

### Model Tests

Import and adapt:

- `frontend/src/features/activities/activities-model.test.ts`

Keep coverage for:

- `reorderById`;
- `swapByIndex`;
- `renumber`;
- `toggleValue`;
- missing fields;
- readiness;
- stats;
- `updateItemById`;
- `removeById`;
- `insertAt`;
- `createActivity`;
- `createHonor`;
- deep-link read/resolve/initial tab.

### Route Tests

Add:

- `frontend/src/features/activities/ActivitiesRoute.test.tsx`

Minimum route tests:

1. Renders the Activities workspace:
   - heading `Activities`;
   - tabs `Activities` and `Honors`;
   - add activity button;
   - readiness badges.
2. Switches to Honors tab:
   - honors list visible;
   - add honor button visible.
3. Opens an activity drawer:
   - click first activity row;
   - assert drawer title/input content;
   - assert URL contains `activity=<id>` if rendered under router.
4. Opens an honor drawer:
   - switch to Honors;
   - click first honor;
   - assert honor drawer content.
5. Creates a new activity:
   - click add activity;
   - drawer opens with empty fields;
   - order is appended.
6. Updates character-limited fields:
   - edit description;
   - counter updates;
   - over-limit state appears when exceeding limit.
7. Deletes and undoes:
   - delete from row menu or drawer;
   - row disappears;
   - undo toast appears;
   - clicking Undo restores row.
8. Limit behavior:
   - render with 10 activities;
   - add activity button disabled and label says limit reached.
9. Deep link behavior:
   - render at `/activities?activity=robotics-founder`;
   - drawer opens;
   - closing clears search params.

### Shell Tests

Update existing shell/router tests only if they assert placeholder text for `/activities`.

Good shell assertions:

- navigating to Activities updates pathname to `/activities`;
- sidebar active state changes;
- route content has heading `Activities`;
- shell stays mounted.

Avoid coupling shell tests to activity fixture titles, counts, or drawer internals.

## Verification Plan

Run:

```bash
cd frontend
npm run typecheck
npm test -- --run
npm run lint
npm run build
git diff --check
```

Manual browser checks:

1. `/activities` desktop:
   - header matches Schools/Tasks header;
   - content does not touch sidebar;
   - list rows have visible surfaces;
   - text contrast is readable;
   - status badges are not loud.
2. `/activities` narrow viewport:
   - tabs wrap cleanly;
   - action buttons do not overflow;
   - drawers become full-width on small screens;
   - row text wraps without overlap.
3. Activity drawer:
   - type select opens above sheet content correctly;
   - checkbox chips focus correctly;
   - copy buttons work or fail quietly if clipboard is blocked;
   - counters update live;
   - over-limit state is visible.
4. Honor drawer:
   - title textarea works;
   - grades/levels chips work;
   - move/delete controls work.
5. Reorder:
   - dragging from row body should not reorder;
   - dragging from grip should reorder;
   - move up/down menu actions work.
6. Delete/undo:
   - deletion renumbers;
   - undo restores original position;
   - toast dismiss works.
7. Deep links:
   - `/activities?activity=robotics-founder`;
   - `/activities?honor=physics-olympiad`;
   - invalid ids stay closed.

If screenshots or Playwright captures are needed, put them only under `artifacts/`.

## Cleanup Plan

Before committing:

- run `git status --short`;
- verify no files from `mvp3-frontend` were moved wholesale except intentional source adaptation;
- verify no artifacts outside `artifacts/`;
- verify no new hardcoded raw hex values in `frontend/src/features/activities`;
- verify no `white/[...]` utilities remain in `frontend/src/features/activities`;
- verify no `data-page="activities"` remains;
- verify no `Applications` eyebrow remains;
- verify all added files are either:
  - domain,
  - fixtures,
  - activities feature,
  - page entry,
  - router wiring,
  - tests,
  - CSS tokens.

Suggested scans:

```bash
rg -n "data-page|Applications|white/|#[0-9a-fA-F]{3,8}|bg-card/40|rounded-2xl" frontend/src/features/activities frontend/src/domain/activity.ts frontend/src/fixtures/activities.ts
rg -n "mvp3-frontend|frontend.backup|LibreChat|librechat" frontend/src/features/activities frontend/src/pages/activities-page.tsx
```

The first scan may still find acceptable token names such as `--activity-warning-fg`; review results manually.

## Implementation Order

1. Add activity tokens to `frontend/src/index.css`.
2. Add `frontend/src/domain/activity.ts`.
3. Add `frontend/src/fixtures/activities.ts`.
4. Add activities pure helpers and model tests:
   - config;
   - format;
   - mutations;
   - reorder;
   - deep-link;
   - types.
5. Run model tests or full test suite once pure files are in.
6. Add small UI support files:
   - `activity-indicators.tsx`;
   - `activity-form-controls.tsx`;
   - `SectionStatus.tsx`;
   - `UndoToast.tsx`;
   - `useReorderDrag.ts`.
7. Add row components:
   - `ActivityRow.tsx`;
   - `HonorRow.tsx`.
8. Add drawer components:
   - `ActivityDrawer.tsx`;
   - `HonorDrawer.tsx`.
9. Add route component:
   - `ActivitiesRoute.tsx`;
   - adapt header/layout/tokens.
10. Add page export:
    - `pages/activities-page.tsx`.
11. Wire `/activities` in `app/router.tsx`.
12. Add route tests.
13. Run typecheck/tests/lint/build.
14. Browser inspect and fix visual issues.
15. Final scans and cleanup.
16. Commit only after user approval.

## Acceptance Criteria

- `/activities` is a real page, not a placeholder.
- Page header matches the shared Schools/Tasks header pattern.
- Activities and Honors tabs work.
- Add activity/honor works and opens the correct drawer.
- Activity and honor drawers edit local state.
- Character counters and over-limit states work.
- Copy buttons are present and safe.
- Delete/undo works.
- Reorder works from grip handles.
- Deep links open the correct drawer.
- Fixture/demo data is isolated.
- Domain logic is pure and tested.
- UI uses existing shadcn primitives and shared workspace tokens.
- No hardcoded raw color values in activities feature components.
- No prototype `white/[...]` alpha styling remains in activities feature components.
- No app shell/sidebar regression.
- `npm run typecheck`, `npm test -- --run`, `npm run lint`, and `npm run build` pass.
