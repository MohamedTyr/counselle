# MVP3 Schools Page Import Plan

## Goal

Import the Schools page from `mvp3-frontend` into the rebuilt main `frontend` app as production-quality code, preserving the MVP3 shadcn component behavior while fitting the current clean shell/sidebar foundation.

This import should not be a raw prototype dump. The result should be maintainable, token-driven, test-covered, and organized by feature boundaries.

## Source And Target

- Source: `mvp3-frontend/src/features/schools`
- Source route wrapper: `mvp3-frontend/src/app/routes/schools-route.tsx`
- Source page export: `mvp3-frontend/src/pages/schools-page.tsx`
- Source domain types: `mvp3-frontend/src/domain/school.ts`, `mvp3-frontend/src/domain/shared.ts`
- Source fixtures: `mvp3-frontend/src/fixtures/schools.ts`
- Target app: `frontend`
- Target route: `/schools`

## Current Findings

The current app only has the shell scaffold and placeholder route surfaces. The `/schools` route currently renders `RouteSurface title="Schools"`.

The MVP3 Schools page is a full feature slice:

- `SchoolsRoute.tsx` owns filters, sorting state, column resize state, and page composition.
- `SchoolsTable.tsx` renders the desktop table with sortable/resizable columns.
- `SchoolMobileList.tsx` renders the mobile card layout.
- `school-cells.tsx` owns reusable school cell display components.
- `schools-config.ts`, `schools-filters.ts`, and `schools-sort.ts` contain model/config logic.
- `useColumnLayout.ts` contains table column resize behavior.
- `WorkspaceScrollIndicator.tsx` contains the custom scroll indicator.
- `schools-model.test.ts` already covers filtering, sorting, progress derivations, and immutability.

The source page depends on shadcn primitives that are not installed in the current app yet:

- `avatar`
- `badge`
- `dropdown-menu`
- `table`
- `tabs`

The source also depends on MVP3 customizations:

- `Badge` variants: `info`, `success`, `warning`, `error`
- `Table variant="card"`
- `TabsTab` export/API
- `Avatar size="lg"`
- `workspace-scrollbar` global utility

The current shell/sidebar code must not be overwritten. It contains fixes that are newer than the MVP3 prototype:

- persisted collapsed sidebar state restore
- editable-control shortcut guard
- sidebar border token wiring
- collapsed sidebar layout polish

## Architecture Principles

1. Keep the import feature-scoped.
   Schools-specific code belongs under `frontend/src/features/schools`. Shared UI primitives belong under `frontend/src/components/ui`. Data fixtures belong under `frontend/src/fixtures`.

2. Preserve shadcn as the component source.
   Add missing primitives through shadcn from inside `frontend/`, then apply only the MVP3 customizations the Schools page actually uses.

3. Use semantic tokens and shared primitives.
   Do not hardcode one-off colors, spacing, or component styling in feature files when the design system can express it.

4. Do not regress the shell.
   The shell/sidebar foundation is already committed and tested. The Schools import should plug into it, not replace it.

5. Keep prototype data isolated.
   `fixtures/schools.ts` is acceptable for this stage, but it should be obvious that it is fixture data and not a backend contract.

6. Preserve behavior with tests.
   Import model tests and update route/shell tests where the placeholder behavior changes.

## Implementation Plan

### 1. Add Missing shadcn Primitives

From `frontend/`, add the missing primitives:

```bash
npx shadcn@latest add avatar badge dropdown-menu table tabs
```

Then inspect the generated files before editing. Do not blindly overwrite existing primitives.

Expected target files:

- `frontend/src/components/ui/avatar.tsx`
- `frontend/src/components/ui/badge.tsx`
- `frontend/src/components/ui/dropdown-menu.tsx`
- `frontend/src/components/ui/table.tsx`
- `frontend/src/components/ui/tabs.tsx`

Apply MVP3-compatible extensions only where needed:

- Add the status-oriented `Badge` variants used by Schools.
- Add `Table` support for `variant="card"`.
- Ensure `TabsTab` is exported, with `TabsTrigger` alias preserved if present.
- Ensure `Avatar` supports `size="lg"`.

### 2. Import Domain And Fixture Files

Add:

- `frontend/src/domain/school.ts`
- `frontend/src/domain/shared.ts`
- `frontend/src/fixtures/schools.ts`

Keep these files small and typed. Avoid coupling fixture shape to future backend assumptions.

### 3. Import Schools Feature Files

Add:

- `frontend/src/features/schools/SchoolMobileList.tsx`
- `frontend/src/features/schools/SchoolsRoute.tsx`
- `frontend/src/features/schools/SchoolsTable.tsx`
- `frontend/src/features/schools/WorkspaceScrollIndicator.tsx`
- `frontend/src/features/schools/school-cells.tsx`
- `frontend/src/features/schools/schools-config.ts`
- `frontend/src/features/schools/schools-filters.ts`
- `frontend/src/features/schools/schools-sort.ts`
- `frontend/src/features/schools/schools-types.ts`
- `frontend/src/features/schools/useColumnLayout.ts`

Keep import paths using the existing `@/` alias.

While importing, check for:

- accidental dependency on MVP3 app-level providers
- accidental dependency on old shell files
- direct raw colors or layout hacks
- file size overgrowth
- custom components that should instead be shadcn primitives

### 4. Add Page/Route Entry

Use a thin route entry for `/schools`.

Preferred simple target:

- Add `frontend/src/pages/schools-page.tsx` exporting `SchoolsPage` from the feature.
- Update `frontend/src/app/router.tsx` so `path: "schools"` renders the real Schools page instead of `RouteSurface`.

Lazy loading is optional. For this import, direct routing is acceptable unless bundle size becomes an actual problem.

### 5. Add Global Utility Support

Add the MVP3 scrollbar utility to `frontend/src/index.css`:

```css
@layer utilities {
  .workspace-scrollbar {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }

  .workspace-scrollbar::-webkit-scrollbar {
    display: none;
    height: 0;
    width: 0;
  }
}
```

Do not change shell/sidebar color tokens as part of this import unless the Schools page exposes a real bug.

### 6. Import And Adjust Tests

Add:

- `frontend/src/features/schools/schools-model.test.ts`

Update shell route tests because `/schools` will no longer be a placeholder page. The test should assert the real route content without becoming brittle.

Good assertions:

- route navigation reaches `/schools`
- sidebar active state still works
- real Schools page content appears, such as `Application workspace`
- shell stays mounted while route content changes

Avoid assertions tied to exact fixture counts unless the test is specifically about Schools model behavior.

### 7. Verification

Run:

```bash
cd frontend && npm run typecheck
cd frontend && npm test -- --run
cd frontend && npm run lint
```

Then run or reuse the dev server and inspect:

- `/schools` desktop table layout
- `/schools` mobile card layout
- column sort behavior
- column resize behavior
- filter tabs
- view dropdown
- custom scroll indicator
- collapsed sidebar state
- mobile sidebar drawer

### 8. Cleanup Before Commit

Before committing:

- run `git status --short`
- verify no generated artifacts outside `artifacts/`
- verify no unrelated MVP3 pages were imported
- verify no package dependencies for Calendar, Essays, or Activities were added accidentally
- verify no shell/sidebar files were overwritten unintentionally

## Acceptance Criteria

- `/schools` renders the MVP3 Schools page inside the current main app shell.
- The page uses shadcn primitives from the main app, with only necessary MVP3-compatible extensions.
- The shell/sidebar behavior remains unchanged.
- The import is organized by domain/feature/ui boundaries.
- The model behavior is covered by tests.
- Frontend typecheck, tests, and lint pass.
- No dirty artifacts or unrelated MVP3 files are added.

## Known Risks

- shadcn primitive drift between generated files and MVP3 prototype customizations.
- accidentally overwriting the current fixed sidebar primitive with older MVP3 shell code.
- importing more prototype dependencies than the Schools page actually needs.
- adding visual hardcoding to patch design mismatches instead of extending tokens/primitives.

## Recommended First Implementation Step

Start by adding the five missing shadcn primitives and comparing them with the MVP3 versions. Once the primitive API gap is clear, import the Schools feature slice and wire `/schools`.
