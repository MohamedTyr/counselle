# MVP3 Tasks Page Import Plan

Status: Draft
Date: 2026-07-05

## Goal

Import the Tasks page from `mvp3-frontend` into the rebuilt main `frontend` app as production-quality code.

The result should feel like the same application as the new shell/sidebar and Schools page: warm dark workspace colors, the same top page header pattern, consistent shadcn-based primitives, clean feature boundaries, no one-off hardcoded styling, and no accidental prototype architecture leaking into the main app.

This is not a raw copy. The MVP3 Tasks feature is a full local task workspace with multiple views and interactions. The import needs to preserve useful behavior while adapting the architecture to the main frontend foundation.

## Source And Target

- Source feature: `mvp3-frontend/src/features/tasks`
- Source page export: `mvp3-frontend/src/pages/tasks-page.tsx`
- Source route wrapper: `mvp3-frontend/src/app/routes/tasks-route.tsx`
- Source domain model: `mvp3-frontend/src/domain/task.ts`
- Source time helpers: `mvp3-frontend/src/domain/time.ts`
- Source fixture data: `mvp3-frontend/src/fixtures/tasks.ts`
- Source optional workspace state: `mvp3-frontend/src/app/workspace/*`
- Target app: `frontend`
- Target route: `/tasks`

## Current Findings

The main `frontend` app currently has:

- a stable MVP3-derived shell/sidebar foundation;
- a real `/schools` route;
- a placeholder `/tasks` route rendering `RouteSurface title="Tasks"`;
- warm dark design tokens in `frontend/src/index.css`;
- task lane/category tokens already mapped to the new warm dark workspace palette;
- shadcn/Base UI primitives already present for `button`, `input`, `badge`, `dropdown-menu`, `table`, `tabs`, `sheet`, and several shell primitives.

The MVP3 Tasks feature includes:

- `TasksRoute.tsx`: page composition, view state, search, task mutation wiring, drag/selection wiring, detail sheet state.
- `TaskBoard.tsx`: Today board layout and selection surface.
- `TaskColumn.tsx`: status lane rendering and drop target behavior.
- `TaskCard.tsx`: draggable/editable task card.
- `UpcomingTasksView.tsx`: upcoming planning groups, planning panel, empty states, quick start action.
- `AllTasksTable.tsx`: desktop table, mobile list, sorting, inline editing.
- `TaskDetailSheet.tsx`: right-side task detail editor.
- `task-inline-controls.tsx`: inline text, select, badge, and date controls.
- `task-config.ts`: statuses, columns, labels, options, token bridge classes.
- `task-dates.ts`: date labels, due-state logic, date merging.
- `task-filters.ts`: search, upcoming grouping, status grouping.
- `task-sort.ts`: deterministic sort logic.
- `task-mutations.ts`: immutable create/update/move helpers.
- `useTaskDrag.ts`: drag payload parsing, drag image, drop behavior.
- `useTaskSelection.ts`: marquee/multi-selection behavior.
- `useIsResizing.ts`: disables layout animation while resizing.
- `task-model.test.ts`: coverage for dates, filtering, grouping, sorting, mutations, and drag payload parsing.

The MVP3 Tasks feature depends on UI primitives not yet present in the main app:

- `card`
- `empty`
- `popover`
- `select`
- `textarea`
- `calendar`

`calendar.tsx` depends on `react-day-picker`, which is not currently installed in the main `frontend`. The MVP3 prototype also includes `react-day-picker`, so this dependency is expected and should be added deliberately.

The current `frontend/src/components/ui/sheet.tsx` matches the MVP3 source, so it should not be overwritten.

## Architecture Outcomes

After this import, the app should have:

1. A shared workspace page header primitive used by all real pages.
2. A real `/tasks` page with Today, Upcoming, and All views.
3. A feature-scoped task module under `frontend/src/features/tasks`.
4. Shared domain types under `frontend/src/domain`, not embedded inside components.
5. Fixture data isolated under `frontend/src/fixtures`.
6. UI primitives under `frontend/src/components/ui`, kept generic and registry-shaped.
7. Colors expressed through semantic tokens and variant APIs, not hardcoded in route code.
8. Tests covering task model behavior and route-level rendering.
9. No coupling between shell/sidebar and task internals.

## Non-Negotiable Design Rules

- The top page header pattern must be shared, not copied per page.
- Every page title should use the same structure as the current Schools header:
  - full-width header band;
  - equal vertical padding;
  - `text-xl leading-none font-semibold tracking-tight`;
  - right-aligned actions;
  - bottom separator;
  - separator stops before the custom scrollbar;
  - no subtitle clutter unless a page explicitly needs it.
- Tasks must use the new warm dark color system:
  - app background: `--shell-background`;
  - surfaces: `--workspace-surface`, `--workspace-surface-raised`;
  - hover: `--workspace-surface-hover`;
  - borders: `--workspace-border`, `--workspace-border-soft`;
  - text: `--workspace-foreground`, `--workspace-muted-foreground`;
  - status/category colors through semantic task tokens.
- Feature components must not hardcode raw hex values.
- If a visual value is shared or likely to recur, it belongs in a token, variant, or shared primitive.
- Do not add decorative gradients, glass layers, marketing layout, or unrelated visual concepts.
- Do not reintroduce LibreChat naming, paths, tokens, or component assumptions.

## Implementation Plan

### 1. Create A Shared Workspace Page Header

Add:

- `frontend/src/components/workspace/PageHeader.tsx`

Initial API:

```tsx
type PageHeaderProps = {
  actions?: ReactNode
  className?: string
  title: string
}
```

Responsibilities:

- render the shared top header band;
- render the title using the approved page-title styling;
- render optional right-side actions;
- render the bottom separator;
- keep the separator out of the scrollbar lane;
- own the header spacing so feature pages do not duplicate it.

Expected class structure:

- root: `relative -mx-6 flex items-center px-6 py-4 md:-mx-10 md:px-10`
- inner row: `flex w-full flex-col gap-4 md:flex-row md:items-center md:justify-between`
- title: `text-xl leading-none font-semibold tracking-tight`
- separator: `pointer-events-none absolute bottom-0 left-0 right-5 border-b`

This component should use existing semantic border color via `border-b`, which resolves to `--border`, already mapped to `--workspace-border-soft`.

Do not include page-specific controls, counts, filters, or body layout.

### 2. Retrofit Schools To Use The Shared Header

Update:

- `frontend/src/features/schools/SchoolsRoute.tsx`

Replace the inline header markup with:

```tsx
<PageHeader
  actions={
    <Button variant="outline">
      <Plus data-icon="inline-start" />
      Add school
    </Button>
  }
  title="Application workspace"
/>
```

This must produce the same visual result as the current committed Schools page.

Reason: the Tasks import should not create a second copy of the page header pattern.

### 3. Add Missing UI Primitives Deliberately

Before adding primitives, search existing files and the shadcn registry surface from `frontend/` per project rules. Use registry-shaped shadcn/Base UI primitives instead of custom ad hoc controls.

Add or import:

- `frontend/src/components/ui/card.tsx`
- `frontend/src/components/ui/empty.tsx`
- `frontend/src/components/ui/popover.tsx`
- `frontend/src/components/ui/select.tsx`
- `frontend/src/components/ui/textarea.tsx`
- `frontend/src/components/ui/calendar.tsx`

Do not overwrite:

- `frontend/src/components/ui/sheet.tsx`

Dependency update:

- add `react-day-picker` to `frontend/package.json`;
- update `frontend/package-lock.json` through `npm install`.

Primitive rules:

- keep files generic;
- no task-specific labels or logic in `components/ui`;
- preserve Base UI/shadcn APIs used by MVP3;
- preserve `data-slot` attributes;
- preserve `render`/composition support where the primitive already uses it;
- keep styling token-based and compatible with the current dark palette.

### 4. Import Task Domain And Time Helpers

Add:

- `frontend/src/domain/task.ts`
- `frontend/src/domain/time.ts`

`domain/task.ts` should define only the domain type vocabulary:

- `Task`
- `TaskStatus`
- `TaskCategory`
- `TaskPriority`
- `TaskAssignee`

`domain/time.ts` should initially preserve the MVP3 demo clock:

- `demoNowIso`
- `demoTodayIso`
- `todayDate`
- `createTimestamp`
- `createDemoId`

Keep the fixed demo date for now because MVP3 fixtures/tests are authored around `2026-07-01`. Do not silently switch to real current date in this import; that would change sorting/grouping behavior and make the imported tests unreliable.

Later backend integration can replace fixture/demo time with server-backed state.

### 5. Import Task Fixtures

Add:

- `frontend/src/fixtures/tasks.ts`

Rules:

- fixture data stays in `fixtures`, never inside feature components;
- export `initialTasks`;
- keep data typed as `Task[]`;
- do not create a fake API layer;
- do not wire fixture data into global app state unless another route actually needs shared task state.

For this import, the route can use local state through `TasksPage` defaults. That keeps the scope smaller and avoids introducing `WorkspaceProvider` before Calendar or Activities require shared task state.

### 6. Import Task Model Modules

Add:

- `frontend/src/features/tasks/task-config.ts`
- `frontend/src/features/tasks/task-dates.ts`
- `frontend/src/features/tasks/task-filters.ts`
- `frontend/src/features/tasks/task-sort.ts`
- `frontend/src/features/tasks/task-mutations.ts`
- `frontend/src/features/tasks/task-types.ts`

Adaptation rules:

- preserve immutable update behavior;
- preserve deterministic sorting fallbacks;
- preserve drag payload validation;
- keep labels/options centralized in `task-config.ts`;
- keep token bridge classes centralized in `laneThemeClass` and `categoryChipClass`;
- do not scatter status/category colors into components.

Review `task-config.ts` carefully after import:

- status labels should remain product-appropriate;
- category labels should remain short enough for cards and pills;
- `laneThemeClass` should only reference CSS variables, not raw colors;
- badge variants should map to existing `Badge` variants.

### 7. Import Task Interaction Hooks

Add:

- `frontend/src/features/tasks/useTaskDrag.ts`
- `frontend/src/features/tasks/useTaskSelection.ts`
- `frontend/src/features/tasks/useIsResizing.ts`

Required review points:

- `useTaskSelection` must clean up global Escape listener;
- pointer capture must be released safely;
- interactive targets must not trigger marquee selection;
- drag payload parsing must reject invalid data;
- drag preview nodes must be removed immediately after `setDragImage`;
- resizing state timeout must be cleared on unmount.

Keep these hooks feature-scoped. They are task-specific behavior, not generic app hooks.

### 8. Import Task UI Components

Add:

- `frontend/src/features/tasks/TasksRoute.tsx`
- `frontend/src/features/tasks/TaskBoard.tsx`
- `frontend/src/features/tasks/TaskColumn.tsx`
- `frontend/src/features/tasks/TaskCard.tsx`
- `frontend/src/features/tasks/UpcomingTasksView.tsx`
- `frontend/src/features/tasks/AllTasksTable.tsx`
- `frontend/src/features/tasks/TaskDetailSheet.tsx`
- `frontend/src/features/tasks/task-inline-controls.tsx`

Adapt `TasksRoute.tsx` header to use the shared header:

```tsx
<PageHeader
  actions={
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Button onClick={handleNewTask} type="button" variant="outline">
        <Plus aria-hidden="true" data-icon="inline-start" />
        New task
      </Button>
      <Button onClick={handlePlanWithAgent} type="button">
        <Sparkles aria-hidden="true" data-icon="inline-start" />
        Plan with agent
      </Button>
    </div>
  }
  title={pageTitle}
/>
```

Remove the old MVP3 Tasks local header that showed:

- small `Tasks` eyebrow;
- `text-2xl` title;
- per-route header spacing.

The page title should be:

- `Today, Jul 1` for Today view;
- `Upcoming` for Upcoming view;
- `All tasks` for All view.

This keeps the title responsive to the selected task view while preserving the shared header styling.

Task body layout should stay under the scroll container:

- outer section: `relative flex min-h-0 min-w-0 flex-1 overflow-hidden`;
- scroll area: `workspace-scrollbar flex min-h-0 min-w-0 flex-1 flex-col gap-6 overflow-y-auto pr-8 pb-6 pl-6 md:pr-10`;
- header uses `PageHeader`;
- controls and view content follow below.

This matches Schools and avoids the current placeholder header.

### 9. Add Page And Route Entry

Add:

- `frontend/src/pages/tasks-page.tsx`

Initial implementation:

```tsx
export { TasksPage } from "@/features/tasks/TasksRoute"
```

Update:

- `frontend/src/app/router.tsx`

Replace:

```tsx
{
  path: "tasks",
  element: <RouteSurface title="Tasks" />,
}
```

with:

```tsx
{
  path: "tasks",
  element: <TasksPage />,
}
```

Keep `/` redirecting to `/tasks`.

`RouteSurface` can remain for routes not imported yet, but the long-term direction is that real pages use `PageHeader`.

### 10. Decide Whether To Add Workspace State

Do not add `WorkspaceProvider` in this phase unless implementation proves it is necessary.

MVP3 has:

- `WorkspaceProvider`
- `workspace-context.ts`
- `workspace-hooks.ts`
- `workspace-store.ts`

Those are useful once multiple pages need the same task state, especially Calendar or Activities. For Tasks alone, local state in `TasksPage` is simpler and avoids global state too early.

Decision for this import:

- use local `TasksPage` state first;
- keep the source workspace files as a reference;
- introduce workspace state later when a second imported page needs shared task/task-derived data.

If workspace state is introduced later:

- keep it under `frontend/src/app/workspace`;
- add it to `AppProviders`;
- test that `useWorkspaceTasks` fails outside provider;
- avoid adding unrelated global state at the same time.

### 11. Theme And Token Pass

The current `frontend/src/index.css` already includes warm dark task tokens. Verify and adjust only through variables:

- `--task-todo-surface`
- `--task-todo-card`
- `--task-todo-card-hover`
- `--task-todo-border`
- `--task-todo-pill-bg`
- `--task-todo-pill-fg`
- `--task-doing-*`
- `--task-waiting-*`
- `--task-done-*`
- `--task-category-*`

Do not introduce raw hex in task components.

If a component needs a new reusable color, add a semantic variable first, for example:

- `--workspace-surface-subtle`
- `--workspace-control-hover`
- `--workspace-selection`

Then consume the token from class names.

Visual consistency targets:

- task cards should feel related to Schools table rows;
- lane headers should be readable but quiet;
- badges should not dominate the page;
- hover states should align with sidebar hover tone (`--workspace-surface-hover`);
- focus rings should use `--workspace-ring`;
- popovers, selects, sheets, and calendars should use `--popover`, `--card`, `--border`, and `--input`.

### 12. Test Plan

Import:

- `frontend/src/features/tasks/task-model.test.ts`

Add route/component coverage:

- `frontend/src/features/tasks/TasksRoute.test.tsx`

Suggested test cases:

1. Renders default Today view.
   - Assert heading `Today, Jul 1`.
   - Assert view tabs `Today`, `Upcoming`, `All`.

2. Uses the shared page header.
   - Assert one page heading.
   - Assert `New task`.
   - Assert `Plan with agent`.

3. Creates a new task.
   - Click `New task`.
   - Assert `Untitled task` appears.
   - Assert detail sheet opens or newly created task is visible, depending on final behavior.

4. Filters tasks by search.
   - Search a known fixture term.
   - Assert matching task remains and non-matching task disappears from current view.

5. Changes view.
   - Click `Upcoming`.
   - Assert upcoming planning content appears.
   - Click `All`.
   - Assert all-tasks table/list content appears.

6. Opens detail sheet.
   - Open a task.
   - Assert task title input or sheet title surface is present.

7. Model tests remain deterministic.
   - Dates use fixed demo date.
   - Sorting, grouping, mutation, and drag payload parsing match source behavior.

Update:

- `frontend/src/app/shell/WorkspaceShell.test.tsx`

Expected updates:

- `/tasks` no longer renders placeholder `RouteSurface`.
- tests should assert the real Tasks route heading.
- sidebar active-state tests should still pass.
- default redirect `/` should still land on `/tasks`.

Avoid brittle tests:

- do not assert exact lane/card class names;
- do not assert every fixture item;
- do not couple tests to animation internals;
- do not test native drag-and-drop deeply in jsdom beyond pure payload parsing.

### 13. Accessibility And Interaction Review

Before accepting the import, verify:

- page has exactly one visible `h1`;
- all icon-only buttons have accessible labels;
- task cards are keyboard-openable;
- inline editable text fields have `aria-label`;
- select triggers have accessible labels;
- date picker triggers have accessible labels;
- sheet close button has accessible label;
- focus rings are visible on dark background;
- Escape clears selection and closes overlays as expected;
- reduced motion disables layout animation where MVP3 intended;
- mobile layout does not rely on hover.

### 14. Verification Commands

From `frontend/`:

```bash
npm install
npm run typecheck
npm test -- --run
npm run lint
npm run build
```

From repo root:

```bash
git diff --check
git status --short
```

Run the app:

```bash
cd frontend && npm run dev -- --host 127.0.0.1
```

Visual pages to inspect:

- `/tasks` desktop, Today view;
- `/tasks` desktop, Upcoming view;
- `/tasks` desktop, All view;
- `/tasks` mobile width;
- `/schools`, to ensure the shared header retrofit did not regress it;
- collapsed sidebar with `/tasks` active;
- expanded sidebar with `/tasks` active.

Artifacts:

- screenshots go only under `artifacts/`;
- do not commit screenshots or temporary visual reports.

## File Checklist

Expected additions:

- `frontend/src/components/workspace/PageHeader.tsx`
- `frontend/src/components/ui/card.tsx`
- `frontend/src/components/ui/empty.tsx`
- `frontend/src/components/ui/popover.tsx`
- `frontend/src/components/ui/select.tsx`
- `frontend/src/components/ui/textarea.tsx`
- `frontend/src/components/ui/calendar.tsx`
- `frontend/src/domain/task.ts`
- `frontend/src/domain/time.ts`
- `frontend/src/fixtures/tasks.ts`
- `frontend/src/features/tasks/AllTasksTable.tsx`
- `frontend/src/features/tasks/TaskBoard.tsx`
- `frontend/src/features/tasks/TaskCard.tsx`
- `frontend/src/features/tasks/TaskColumn.tsx`
- `frontend/src/features/tasks/TaskDetailSheet.tsx`
- `frontend/src/features/tasks/TasksRoute.tsx`
- `frontend/src/features/tasks/TasksRoute.test.tsx`
- `frontend/src/features/tasks/UpcomingTasksView.tsx`
- `frontend/src/features/tasks/task-config.ts`
- `frontend/src/features/tasks/task-dates.ts`
- `frontend/src/features/tasks/task-filters.ts`
- `frontend/src/features/tasks/task-inline-controls.tsx`
- `frontend/src/features/tasks/task-model.test.ts`
- `frontend/src/features/tasks/task-mutations.ts`
- `frontend/src/features/tasks/task-sort.ts`
- `frontend/src/features/tasks/task-types.ts`
- `frontend/src/features/tasks/useIsResizing.ts`
- `frontend/src/features/tasks/useTaskDrag.ts`
- `frontend/src/features/tasks/useTaskSelection.ts`
- `frontend/src/pages/tasks-page.tsx`

Expected modifications:

- `frontend/package.json`
- `frontend/package-lock.json`
- `frontend/src/app/router.tsx`
- `frontend/src/app/shell/WorkspaceShell.test.tsx`
- `frontend/src/features/schools/SchoolsRoute.tsx`
- `frontend/src/index.css` only if token gaps are found

Files to leave alone unless a real integration issue appears:

- `frontend/src/components/ui/sheet.tsx`
- shell/sidebar composition files
- backend API code
- old frontend backup
- `mvp3-frontend`

## Acceptance Criteria

- `/tasks` renders the real task workspace.
- `/tasks` uses the shared page header pattern.
- `/schools` also uses the shared page header pattern and looks unchanged.
- Today view shows task lanes with draggable task cards.
- Upcoming view shows grouped planning sections and planning panel.
- All view shows sortable table on desktop and mobile list on small screens.
- New task and Plan with agent actions work against local state.
- Task detail sheet opens and edits task fields.
- Inline editing works without triggering card open/drag unexpectedly.
- Search filters task content.
- Colors match the new warm dark system.
- No raw hex colors are added to task feature files.
- No new global state is added unless explicitly justified.
- No LibreChat code, naming, paths, or styling returns.
- Tests pass.
- Lint/typecheck/build pass.
- Worktree contains no artifacts outside `artifacts/`.

## Risks And Mitigations

### Risk: UI Primitive Drift

MVP3 primitives may not exactly match current primitives.

Mitigation:

- compare before overwriting;
- import only missing primitives;
- keep `sheet.tsx` unchanged because it already matches;
- run typecheck after primitive import before importing feature files.

### Risk: Date Dependency Adds Bundle Or API Surface

`calendar.tsx` requires `react-day-picker`.

Mitigation:

- add the exact dependency deliberately;
- keep it isolated to the calendar primitive;
- do not add calendar-route dependencies like Schedule X in this phase.

### Risk: Header Pattern Forks Again

Tasks and Schools could end up with subtly different header spacing.

Mitigation:

- build `PageHeader` first;
- retrofit Schools before importing Tasks;
- test both routes render expected headings.

### Risk: Prototype State Becomes App Architecture Too Early

MVP3 has a workspace provider, but Tasks alone does not require shared app state.

Mitigation:

- use local state now;
- introduce `app/workspace` only when a second page needs it;
- document that decision in this plan.

### Risk: Hardcoded Styling Creeps Into Feature Files

Tasks has many visual states.

Mitigation:

- centralize status/category visual mapping in `task-config.ts`;
- use CSS variables from `index.css`;
- reject raw hex in feature files during review;
- add semantic tokens if a new shared visual role is needed.

### Risk: Complex Interactions Break In jsdom

Drag and selection are browser-heavy.

Mitigation:

- test pure parsing/model behavior thoroughly;
- smoke test route behavior and interaction basics;
- verify drag/selection manually in browser.

## Implementation Order Summary

1. Add `PageHeader`.
2. Retrofit Schools to use `PageHeader`.
3. Add missing UI primitives and `react-day-picker`.
4. Add task domain/time/fixtures.
5. Add task model modules and model tests.
6. Add task hooks.
7. Add task UI components.
8. Wire `/tasks`.
9. Add route tests and update shell tests.
10. Run typecheck/tests/lint/build.
11. Visual inspect `/tasks` and `/schools`.
12. Clean up and commit.
