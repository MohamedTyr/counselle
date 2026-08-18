# Frontend recon — CDS manager admin page-set

Repo root: `/home/saifuddin/Projects/counselle/.worktrees/cds-pipeline`
Scope: read-only recon for a new admin page-set (Coverage grid, Batch upload, Document review).

---

## 1. Which frontend is live — verdict

**`frontend/` is the real, current app. `mvp3-frontend/` is a frozen prototype — do not build in it.**

Evidence:
- `frontend/` has 389 source files under `src/`, last commit `7d0f9fe` (2026-07-30, "fix: render grouped citation markers as chips"). Active, ongoing commit history.
- `mvp3-frontend/` has 152 files, its only two commits are both `2026-07-05` ("add mvp3 frontend shell" / "add independent mvp3 frontend prototype"). It has been untouched since. Its own `mvp3-frontend/README.md` self-describes it as "the independent MVP3 frontend prototype... intentionally fixture-backed" — not wired to the real backend.
- `docs/ARCHITECTURE.md:615` (§31, "The frontend"): *"MVP3 frontend reset. The active frontend is rebuilt from the MVP3 design system and workspace shell; ADR 0020's LibreChat clone is historical and superseded by ADR 0026. The backend protocol client remains the same `/v1` same-origin client."* — i.e. the MVP3 design system/prototype was graduated **into** `frontend/`, not left as `mvp3-frontend/`.
- `docs/ARCHITECTURE.md:529`: *"Product client | `frontend/` React SPA — the sole protocol client (§31)"*.
- `AGENTS.md` Commands section only references `frontend/` (`cd frontend && npm install && npm run dev`, proxying `/v1` → `:8000`).
- Backend: `api/main.py:215` references `COUNSELLE_SERVE_SPA` building from `frontend/dist` (see `docs/DEPLOY.md:11`: the Node build stage runs `npm ci && npm run build` producing `frontend/dist`, copied into the container).

**Conclusion: build the CDS manager inside `frontend/`.** Treat `mvp3-frontend/` purely as a historical reference for pre-integration component exploration, never as a place to add real screens.

---

## 2. Stack & tooling

- **React 19.2.6**, **Vite 8** (`frontend/vite.config.ts`), **TypeScript ~6** (strict).
- Package manager: npm (`package-lock.json`).
- Dev server: `npm run dev` on port 5173 (`VITE_DEV_PORT` overridable), proxies `/v1` → `http://localhost:8000` (`VITE_API_PROXY_TARGET` overridable). `frontend/vite.config.ts:14-20`.
- **Router: `react-router` v8** (data router, `createBrowserRouter`). Declared in `frontend/src/app/router.tsx`. No file-based routing — one big route tree.
- **State management:**
  - Server state: **TanStack Query v5** (`@tanstack/react-query`), one `QueryClient` created in `frontend/src/app/query-client.ts` (retry disabled for both queries and mutations), provided via `AppProviders` (`frontend/src/app/AppProviders.tsx`).
  - No Redux/Zustand/Jotai — despite the `docs/ARCHITECTURE.md:908` comment mentioning "Jotai atoms in `app/state.ts`", that file does not currently exist in `frontend/src/app/` (stale doc reference; verify before relying on it — local component state + TanStack Query is what's actually used).
  - URL state via `useSearchParams`/`useParams` from `react-router` (e.g. `frontend/src/features/schools/SchoolsRoute.tsx:94`).
- **Data fetching:** no generic fetch-wrapper hook library; a small hand-rolled HTTP client (see §7) plus one `useXxx` hook per resource in `frontend/src/api/workspace/hooks.ts`, wrapping TanStack Query's `useQuery`/`useMutation`.
- **Forms:** no React Hook Form / Formik. Forms are plain controlled inputs + local `useState`, with a `useSyncedDraft`-style local pattern for optimistic-editable fields that revert/commit against server state (see `frontend/src/features/schools/SchoolWorkspace.tsx:198-207`, `useSyncedDraft`). No dedicated form library is a project convention worth reusing, not something missing.
- **Auth:** cookie-JWT (fastapi-users + Google OAuth per `AGENTS.md`); frontend guards are `RequireAuth`/`GuestOnly`/`OnboardingGate` in `frontend/src/app/auth/`. **No admin/role concept exists anywhere in this repo** (`grep -i "is_admin|role.*admin|require_admin"` across `api/`, `app/`, `frontend/src` returns nothing). An admin page-set has no existing auth precedent to follow — this is a real open design question for the plan, not something recon can resolve.

---

## 3. Design system

Single source of truth: **`frontend/src/index.css`** (Tailwind v4 `@theme inline` + CSS custom properties). No `tailwind.config.*` file — Tailwind v4 is CSS-config-only, everything lives in this one file.

- shadcn config: `frontend/components.json` — `"style": "radix-nova"`, `"baseColor": "neutral"`, CSS at `src/index.css`, no class prefix, icon library `lucide`. Registries configured: `@ai-elements`, `@coss`, `@kokonutui` (plus the built-in `@shadcn`).
- **Theme situation:** dark is the default and, in this worktree/branch, effectively the *only* theme. `ThemeProvider` (`frontend/src/components/theme-provider.tsx`) supports `dark`/`light`/`system` and toggles a `.dark`/`.light` class on `<html>`, but in `index.css` the `:root` block (`:329`) and the `.dark` block (`:622`) currently define **the same dark values** — light mode has no distinct palette wired up here. (A separate `light-theme` branch/worktree elsewhere in this repo is presumably where that work happens — out of scope for this recon, but worth knowing the CDS admin pages will render dark-only today.)
- **Semantic token names a new page should use** (defined in `:root`/`.dark`, surfaced as Tailwind utilities via `@theme inline`):
  - Core surfaces/text: `--background` / `bg-background`, `--foreground` / `text-foreground`, `--card` / `bg-card` + `--card-foreground`, `--popover` + `--popover-foreground`.
  - Muted/secondary: `--muted` + `--muted-foreground` (→ `text-muted-foreground`), `--secondary` + `--secondary-foreground`, `--accent` + `--accent-foreground`.
  - Borders/inputs/focus: `--border` (→ `border-border`, applied globally via `* { @apply border-border }`), `--input`, `--ring`.
  - Status colors (already themed, ideal for coverage-grid chips): `--success`/`--success-foreground`, `--warning`/`--warning-foreground`, `--info`/`--info-foreground`, `--destructive`/`--destructive-foreground`.
  - Radii: `--radius: 0.625rem` base, then `--radius-sm` (0.6×), `--radius-md` (0.8×), `--radius-lg` (1×), `--radius-xl` (1.4×), `--radius-2xl`…`--radius-4xl`. Use Tailwind's `rounded-sm/md/lg/xl/2xl` etc. — they map to these.
  - Typography: font stack is `--font-sans: "Geist Variable", sans-serif` (loaded via `@fontsource-variable/geist`), aliased as `--font-heading` too (same font, headings aren't a separate family). There is a `--font-document: Georgia, ui-serif, serif` used only for essay-document rendering — not relevant to an admin UI. No numeric "type scale" tokens exist; page/section sizes are ad-hoc Tailwind text sizes used consistently in existing pages: page title `text-xl font-semibold tracking-tight` (`PageHeader`, see §5), section heading `font-heading text-lg font-medium` / `text-xl font-medium` (e.g. `SchoolWorkspace.tsx:207`, `:730`), body `text-sm`, helper/meta `text-xs text-muted-foreground`.
  - Chart colors exist (`--chart-1`…`--chart-5`, all grayscale) — not directly useful for a coverage grid.
  - There is a large second layer of **feature-scoped tokens** (`--workspace-*`, `--task-*`, `--activity-*`, `--profile-*`, `--onboarding-*`, `--essay-*`) that existing features define for their own chrome (sidebar, task-board pill colors, etc.). **Do not reuse these directly** — they're feature-private by convention (each feature's own `-config`/`-styles` file references only its own prefix, e.g. `frontend/src/features/profile/profile-control-styles.ts` uses `--profile-*`). A new `cds-admin` feature should follow the same pattern: use the core semantic tokens above for layout/surfaces, and only mint its own `--cds-*` custom properties in `index.css` if it needs a genuinely new visual (e.g. a distinct coverage-cell status palette) — mirroring how `--task-todo-pill-bg`/`--task-todo-pill-fg` etc. were added for the task board's colored pills.
  - House rule (`AGENTS.md`): *"Frontend visual changes must go through the design system first. Prefer semantic tokens, shared primitives, and existing component APIs over one-off hardcoded colors, spacing, radii, or layout values in feature components."*

---

## 4. Component inventory (`components/ui/`, registry-sourced)

Registry style is `radix-nova` (shadcn), base color `neutral`, built on **`@base-ui/react`** (not Radix primitives directly — `base-ui` is the underlying headless lib; `radix-ui` package is also a dependency but the primitives visibly use `@base-ui/react/*` imports, e.g. `table.tsx:3-4`, `badge.tsx:3-4`).

**Existing in `frontend/src/components/ui/`:**
accordion, avatar, badge, breadcrumb, button-group, button, calendar, card, carousel, checkbox, collapsible, command (cmdk), dialog, dropdown-menu, empty (empty-state pattern), hover-card, input-group, input, menu, meter (progress-bar-like), onboarding-setup, popover, radio-group, scroll-area, select, separator, sheet (slide-over panel), sidebar, skeleton, sonner (toast host), spinner, table, tabs, textarea, toolbar, tooltip.

Also `frontend/src/components/ai-elements/` (AI-SDK "elements" registry components for chat) and `frontend/src/components/workspace/PageHeader.tsx` (shared page-header primitive, see §5) and `frontend/src/components/undo-toast/` (undo-toast pattern used with sonner).

**Mapped to the 3 CDS admin screens:**

**(1) Coverage grid (schools × CDS years, status chips)**
- Reuse: `Table`/`TableHeader`/`TableRow`/`TableHead`/`TableCell` (`components/ui/table.tsx`) for the grid skeleton; `Badge` (`components/ui/badge.tsx`) for status chips — has 8 variants already (`default`, `secondary`, `outline`, `destructive`/`error`, `info`, `success`, `warning`) mapping cleanly onto coverage states (missing/error, in review, complete, stale, etc.); `Skeleton` for loading; `Empty*` family for zero-state; `DropdownMenu`/`Select` for filters (School list has a working filter+sort combo to copy, see §5); `Tooltip` for cell detail-on-hover.
- Missing / needs building: a true **sticky-header + sticky-first-column data grid** (schools rows can be long, years are columns) — the existing `Table` primitive is a plain scrollable `<table>` with `overflow-x-auto` on its container (`table.tsx:32`), no sticky-column support built in. `SchoolsTable.tsx` has custom resizable-column logic (`useColumnLayout.ts`) worth studying but it's a single-entity list, not a matrix. A cell-click-to-detail affordance is also new.

**(2) Batch upload (drag-drop many PDFs, staging table, "Process all")**
- Reuse: `Table` for the staging list; `Badge` for per-row auto-detect status; `Button`/`Button` variants for row actions and the "Process all" CTA; `Progress`-ish affordance via `Meter`/`MeterTrack`/`MeterIndicator` (already used for essay word-count progress, `SchoolWorkspace.tsx:530-538`) for per-file or overall upload progress; `Select` for manual school/year correction per staged row; `sonner` toasts for success/failure.
- Missing / needs building: **any drag-and-drop zone.** There is no existing multi-file drag-drop component anywhere in the codebase (`grep -rn "dropzone|onDrop|DataTransfer"` across `frontend/src` returns nothing) and **no drag-drop library dependency** (`package.json` has no `react-dropzone`, no `@dnd-kit/*`). The one precedent for drag interactions is `features/tasks/TaskBoard.tsx`, which uses the **native HTML5 Drag and Drop API** (`onDragStart`/`onDrop` handlers, no library) for kanban card reordering — that's the pattern to extend for a file-drop zone, or bring in a small dependency deliberately (flag as a decision, don't silently add one — house rule is "never reinvent the wheel" but also "search registries first"). File upload itself (`<input type="file">` → `FormData` → `fetch`) has a working single-file precedent: `frontend/src/features/profile/DocumentsSection.tsx` (`UploadDocumentForm`, lines 155-278) and `frontend/src/api/workspace/documents.ts` (`uploadDocument`). No batch/multi-file upload precedent exists — would need `multiple` on the input plus either N parallel requests or a new batch endpoint (backend concern).
- Auto-detected school+year per file: no existing UI pattern; would be new staging-table rows with editable `Select`/`Input` cells, similar in shape to `SchoolsTable.tsx` rows but editable.

**(3) Document review (PDF viewer left, extracted sections + flags right, click-to-edit, Approve)**
- Reuse: `Sheet` or a two-pane flex layout (no existing split-pane primitive, but `EssayEditorRoute`/`essay-editor-page.tsx` is the closest existing "big document + side chrome" page to study for layout scaffolding, even though its structure is single-pane prose editing, not split); `Accordion` for collapsible extracted sections (already used for requirement rows, `SchoolWorkspace.tsx:975-1101`); `Badge` for validation-flag severity; `Input`/`Textarea`/`Select` for click-to-edit fields (the `useSyncedDraft` local-draft pattern in `SchoolWorkspace.tsx:198-207` — dirty/commit/revert on blur — is the exact pattern to copy for inline editable fields with an unsaved-state indicator); `Button` for Approve/Reject actions; `Tooltip` for flag explanations; `Collapsible` for optional detail disclosure.
- Missing / needs building: **any PDF rendering.** See §9 — no PDF viewer dependency exists at all. This is the single biggest net-new piece across all three screens.

---

## 5. Page/route pattern — full worked example

Template: the **Schools** page family (`ai_page`/`essay-editor-page` show the same shape; Schools is the richest full-CRUD example).

**File layout (list + detail, both under `pages/` thin wrappers delegating to `features/<name>/`):**
```
frontend/src/pages/schools-page.tsx            # thin: <SchoolsFeaturePage />
frontend/src/pages/school-detail-page.tsx       # thin: param + query → loading/error → <SchoolWorkspace/>
frontend/src/features/schools/
  SchoolsRoute.tsx        # the actual list page (filters, sort, table+mobile list, add dialog)
  SchoolsTable.tsx        # desktop table
  SchoolMobileList.tsx    # mobile list fallback
  SchoolWorkspace.tsx     # the detail page body
  AddSchoolDialog.tsx     # + its own .test.tsx
  schools-config.ts       # column defs, filter option lists (data, not components)
  schools-filters.ts      # pure filter predicate functions
  schools-sort.ts         # pure sort functions
  schools-types.ts         # local types (ColumnId, SortState, ViewFilter, ListTypeFilter)
  schools-deadline.ts      # small pure helpers
  school-cells.tsx         # small shared cell renderers (e.g. SchoolAvatar)
  useColumnLayout.ts        # resizable-column hook
  WorkspaceScrollIndicator.tsx
  *.test.tsx / *.test.ts    # co-located tests, same directory
```

**Registered in the router** (`frontend/src/app/router.tsx:98-105`):
```tsx
{ path: "schools", element: <SchoolsPage /> },
{ path: "schools/:applicationId", element: <SchoolDetailPage /> },
```
All nested under the `/app` route whose `Component: WorkspaceShell` (`router.tsx:71-72`), itself nested under `RequireAuth` → `OnboardingGate` (`router.tsx:64-69`).

**Layout/shell wrapper:** `frontend/src/app/shell/WorkspaceShell.tsx` — `SidebarProvider` + `AppSidebar` (nav) + resizable divider + `SidebarInset` containing the routed page via `WorkspaceOutlet`. Nav items are declared in `frontend/src/app/shell/navigation.tsx` as a flat `shellRoutes: ShellRoute[]` array (id/title/icon/link) — **a CDS admin section would add entries here, or (more likely given it's an admin tool, not student-facing) get its own separate shell/route branch outside `/app` entirely** — worth a deliberate decision in planning, not something to copy blindly.

**Loading/error/empty states (the pattern, consistent across every page read):**
- Loading: `Skeleton` blocks shaped like the eventual content (`SchoolsSkeleton`/`EssayEditorSkeleton` — local skeleton components per page, not a shared generic one).
- Error: a plain `<div className="rounded-xl border bg-card p-6">` card with heading + `text-sm text-muted-foreground` message + a `Try again` `Button` calling `query.refetch()`. Repeated verbatim (`SchoolsRoute.tsx:204-217`, `essay-editor-page.tsx:27-53`) — copy this exact shape for the new pages' error states.
- Empty: the `Empty`/`EmptyHeader`/`EmptyMedia`/`EmptyTitle`/`EmptyDescription`/`EmptyContent` component family (`components/ui/empty.tsx`), e.g. `SchoolsRoute.tsx:218-236`.

**Data fetching:** TanStack Query hooks from `frontend/src/api/workspace/hooks.ts` (`useApplications()`, `useEssay(id)`, etc.) — `isLoading`/`isError`/`data`/`refetch` destructured directly in the page component, no extra abstraction layer.

**Page header:** shared `PageHeader` component (`frontend/src/components/workspace/PageHeader.tsx`) — `title` + optional `actions` (right-aligned button row), bottom border, consistent `-mx-6 px-6 py-4` gutter matching the shell's own padding. Use this verbatim for the Coverage grid page header ("CDS Coverage" + a "Batch upload" action button, for instance).

---

## 6. Feature folder convention

`frontend/src/features/<feature-name>/` — one directory per product feature, flat files inside (no further nesting except a few `components/` subfolders in the largest features like `ai-chat`). Observed feature dirs: `activities`, `ai-chat`, `ai-composer`, `ai-sidebar`, `auth`, `dev-onboarding-shell-gallery`, `dev-tool-call-gallery`, `essays`, `onboarding`, `profile`, `schools`, `shell`, `skill-picker`, `tasks`.

Naming conventions inside a feature:
- `<Feature>Route.tsx` — the top-level page component the `pages/` wrapper renders.
- `<Feature><Noun>.tsx` — PascalCase component files (e.g. `SchoolsTable.tsx`, `AddSchoolDialog.tsx`).
- `<feature>-<concern>.ts` — kebab-case pure-logic/data files (e.g. `schools-config.ts`, `schools-filters.ts`, `schools-sort.ts`, `schools-types.ts`).
- `use<Thing>.ts` — feature-local hooks (e.g. `useColumnLayout.ts`).
- `*.test.tsx`/`*.test.ts` co-located next to the file under test, same directory.

**A new admin feature would go at `frontend/src/features/cds-admin/`**, with per-screen sub-components split similarly (e.g. `CoverageGridRoute.tsx` + `coverage-grid-config.ts`, `BatchUploadRoute.tsx` + `upload-staging-types.ts`, `DocumentReviewRoute.tsx` + `document-review-fields.tsx`), and a corresponding `pages/` wrapper per screen (`pages/cds-coverage-page.tsx`, `pages/cds-upload-page.tsx`, `pages/cds-review-page.tsx`) registered in `router.tsx`.

---

## 7. API client conventions

Base HTTP layer: `frontend/src/api/http/client.ts`. Everything routes through two functions:

```ts
// frontend/src/api/http/client.ts
export async function safeFetch(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(withBase(path), {
      ...init,
      credentials: "same-origin",             // cookie-JWT auth, no manual header
      signal: init.signal ?? AbortSignal.timeout(AUTH_REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new TransportError("network", "Could not reach the server.", { cause });
  }
}

export async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await safeFetch(path, init);
  if (!response.ok) throw await errorFromResponse(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
```
`BASE` (`frontend/src/api/http/constants.ts`) prefixes every path — the versioned `/v1` root. Errors go through `errorFromResponse` (`frontend/src/api/http/errors.ts`) into a typed `TransportError`. Auth is entirely cookie-based (`credentials: "same-origin"`), never a manually-attached bearer header.

**Per-resource module** pattern (`frontend/src/api/workspace/*.ts`, one file per resource, plain typed functions, no classes):
```ts
// frontend/src/api/workspace/applications.ts
export function listApplications() {
  return requestJson<ApplicationView[]>("/applications");
}
export function addApplication(input: ApplicationCreate) {
  return requestJson<ApplicationAddResult>("/applications", jsonRequestInit("POST", input));
}
```
File-upload variant (`frontend/src/api/workspace/documents.ts`) skips `jsonRequestInit`/JSON body in favor of `FormData` + `safeFetch` directly:
```ts
export async function uploadDocument(input: { file: File; title: string; docType: DocumentType }) {
  const formData = new FormData();
  formData.append("file", input.file);
  formData.append("title", input.title);
  formData.append("doc_type", input.docType);
  const response = await safeFetch("/documents", { method: "POST", body: formData });
  if (!response.ok) throw await errorFromResponse(response);
  return (await response.json()) as Document;
}
```
This is the direct precedent for the batch-upload screen's file POSTs.

Then **hooks** wrap each resource function in TanStack Query (`frontend/src/api/workspace/hooks.ts`), e.g. `useApplications()` → `useQuery`, `useUploadDocument()` → `useMutation` with cache invalidation via `frontend/src/api/workspace/keys.ts` query-key factory. Types live in `frontend/src/api/workspace/types.ts` per resource.

A `cds-admin` API module should follow the exact same three-layer shape: `api/cds-admin/<resource>.ts` (fetch functions) → `api/cds-admin/hooks.ts` (TanStack Query wrappers) → `api/cds-admin/types.ts`.

---

## 8. Checks — exact commands

From `frontend/package.json` scripts (confirmed against `AGENTS.md`'s "Frontend checks" section, which matches):
```bash
cd frontend
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm run test         # vitest run
npm run test:watch   # vitest (watch mode)
npm run build        # tsc -b && vite build
npm run format        # prettier --write "**/*.{ts,tsx,css,json,md}"
```
Vitest config is inline in `vite.config.ts` (`environment: "jsdom"`, `setupFiles: ["./src/test/setup.ts"]`, globals on). `eslint.config.js` exists at `frontend/` root (flat config, ESLint 10 + typescript-eslint 8 + react-hooks/react-refresh plugins).

---

## 9. PDF rendering

**No PDF library is a dependency anywhere in `frontend/package.json`.** Confirmed by grepping `package.json` for "pdf" (no hits) and searching `frontend/src` for any PDF-handling code (`grep -rn "pdf" -il` only turns up unrelated fixture/test files that happen to mention "pdf" as a doc-type string, e.g. `tool-call-fixtures.ts`, not an actual renderer). Do not install anything per this task's scope — flagging for the planning phase: the Document Review screen's left-pane PDF viewer needs a net-new dependency decision (e.g. `pdf.js`/`react-pdf` via the registry-search house rule — check `@shadcn`/`@coss`/`@ai-elements` first per `AGENTS.md`'s "Frontend components" section, though a PDF viewer is unlikely to be in any of those UI registries and will probably need a dedicated library choice as its own ADR-lite decision).

---

## Summary of what's missing across all 3 screens (net-new work, not reuse)

1. **Sticky-header/sticky-column data-grid behavior** for the coverage matrix (existing `Table` is a plain scrollable table).
2. **Multi-file drag-and-drop zone** — no library, no existing component; only precedent is native HTML5 DnD in `TaskBoard.tsx` (single-item drag, not file drop) and a single-file `<input type="file">` pattern in `DocumentsSection.tsx`.
3. **Batch/multi-file upload flow** — existing `uploadDocument()` handles exactly one file per request; batching, per-file progress, and per-file staged metadata (auto-detected school+year) are all new.
4. **Split-pane / two-column document layout** with a PDF viewer on one side — no existing split-pane primitive and, critically, **no PDF rendering dependency at all**.
5. **Admin-only route/auth gating** — no `admin` role concept exists in this codebase (frontend or backend) today; this is a real open question for planning, not just a UI gap.
