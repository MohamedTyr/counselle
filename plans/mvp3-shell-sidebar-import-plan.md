# MVP3 Shell And Sidebar Import Plan

Status: Draft
Date: 2026-07-05

## Goal

Create a fresh `frontend/` foundation from the MVP3 prototype, starting with the shell and sidebar only.

This is not a LibreChat reskin. The new frontend should use the MVP3 design system and structure from `mvp3-frontend/`, keep code paths small and obvious, and leave the backend auth/chat protocol ready to reconnect without leaking into layout code.

## Current State

- `frontend/` exists and is empty after the backup/nuke commit.
- `frontend.backup-20260705-070513/` preserves the old backend contract and old LibreChat-derived frontend.
- `mvp3-frontend/` is the source for the new visual system and workspace shell.
- `mvp3-frontend/.design-sync/` has been removed from the working tree and should not be imported. It was design-sync tooling/artifact surface, not production source.

## Architecture Constraints

- `frontend/` stays a pure client of `/v1`; same-origin cookie auth remains the deployment posture.
- The shell must not know the chat protocol, SSE transport, auth mutation details, transcript shape, or turn lifecycle.
- MVP3 shell work must not reintroduce LibreChat vendor paths, tokens, fonts, class vocabulary, or naming.
- Fake demo data must not become app state. If temporary placeholders are needed, isolate them in one obvious development-only module.
- ADR 0020 currently says the frontend is a LibreChat clone. That is now wrong for the product direction. Supersede it with a new ADR before treating the MVP3 frontend as canonical.

## Deep Module Shape

The first import should create these modules:

- `src/app`: application bootstrap, provider stack, router creation.
- `src/app/shell`: workspace frame composition: sidebar provider, responsive frame, outlet animation, route metadata.
- `src/features/shell`: sidebar composition: brand mark, main nav, workspace/account affordances, notification affordance if kept.
- `src/components/ui`: shadcn/MVP3 primitives only. No product-specific sidebar composition here.
- `src/lib`: tiny shared utilities such as `cn`.
- `src/hooks`: generic browser hooks such as mobile breakpoint detection.

The shell module should be deep: callers get a workspace frame and route outlet from one small surface, while responsive layout, sidebar persistence, keyboard toggle, mobile sheet behavior, active-link rules, and motion stay inside the implementation.

## File Import Map

| Source | Destination | Treatment |
|---|---|---|
| `mvp3-frontend/package.json` | `frontend/package.json` | Adopt as baseline; rename package to `counselle-frontend`; keep React 19, Vite, Tailwind 4. |
| `mvp3-frontend/package-lock.json` | `frontend/package-lock.json` | Copy with package rename resolved by `npm install` if needed. |
| `mvp3-frontend/vite.config.ts` | `frontend/vite.config.ts` | Keep Tailwind 4 plugin and `@` alias; add `/v1` proxy from the old frontend config. |
| `mvp3-frontend/tsconfig*.json` | `frontend/` | Copy strict TS setup; keep `@/*` path alias. |
| `mvp3-frontend/eslint.config.js` | `frontend/eslint.config.js` | Copy. |
| `mvp3-frontend/src/index.css` | `frontend/src/index.css` | Copy MVP3 tokens and global styles; remove feature-only CSS only when it is proven unused. |
| `mvp3-frontend/src/App.tsx` | `frontend/src/App.tsx` | Copy with clean imports. |
| `mvp3-frontend/src/main.tsx` | `frontend/src/main.tsx` | Copy. |
| `mvp3-frontend/src/app/AppProviders.tsx` | `frontend/src/app/AppProviders.tsx` | Copy; later add TanStack Query/auth providers without touching shell internals. |
| `mvp3-frontend/src/app/router.tsx` | `frontend/src/app/router.tsx` | Adapt to shell-only route placeholders first. Do not import feature pages yet. |
| `mvp3-frontend/src/app/shell/*` | `frontend/src/app/shell/*` | Copy and clean names. |
| `mvp3-frontend/src/components/sidebar-02/*` | `frontend/src/features/shell/*` | Copy behavior, rename files and symbols. Do not keep `sidebar-02`. |
| `mvp3-frontend/src/components/ui/sidebar.tsx` | `frontend/src/components/ui/sidebar.tsx` | Copy as the deep sidebar primitive. |
| Required `components/ui/*` dependencies | `frontend/src/components/ui/*` | Copy only what the shell imports: button, dropdown, sheet, tooltip, avatar, separator, skeleton, input if still required. |
| `mvp3-frontend/src/hooks/use-mobile.ts` | `frontend/src/hooks/use-mobile.ts` | Copy; consider SSR-safe guard if tests expose it. |
| `mvp3-frontend/src/lib/utils.ts` | `frontend/src/lib/utils.ts` | Copy. |
| `mvp3-frontend/src/components/theme-provider.tsx` | `frontend/src/components/theme-provider.tsx` | Copy for now; later wire user settings from `/v1/me`. |
| `mvp3-frontend/src/fixtures/shell.tsx` | Do not copy | Replace fake notifications/workspaces with explicit shell defaults or omit until real data exists. |
| `mvp3-frontend/src/pages/*`, `src/features/*` | Defer | Shell/sidebar first. Import feature routes one by one after the frame is stable. |
| `frontend.backup-20260705-070513/src/api/**` | Defer to client seam phase | Preserve as reference for auth/chat/SSE, not part of shell import. |

## Implementation Sequence

1. **Record the frontend decision**

   Add a new ADR superseding ADR 0020 for the MVP3 frontend reset: React/Vite/Tailwind 4, MVP3 design system, no LibreChat vendor, same-origin `/v1` client posture preserved.

2. **Create the shell-only app**

   Copy the package/config/bootstrap files into `frontend/`. Add `src/index.css`, `App.tsx`, `main.tsx`, `app/AppProviders.tsx`, and a router that mounts the shell with placeholder route surfaces.

3. **Import the sidebar primitive**

   Copy `components/ui/sidebar.tsx` and only the UI primitives it needs. Keep it generic and registry-shaped. Do not mix product navigation into this file.

4. **Import the shell composition**

   Copy `WorkspaceShell` and `WorkspaceOutlet` into `src/app/shell`. Keep the shell responsible for frame layout only: sidebar, mobile header, outlet, animation.

5. **Rename and clean sidebar composition**

   Move `sidebar-02` code into `src/features/shell` with production names:

   - `AppSidebar.tsx`
   - `MainNav.tsx`
   - `NotificationsMenu.tsx` only if kept
   - `WorkspaceSwitcher.tsx` only if backed by honest local state
   - `CounselleLogo.tsx`

   Replace fixture imports with `app/shell/navigation.tsx` for routes and either remove fake dynamic surfaces or mark them as local placeholders in one file.

6. **Add shell smoke coverage**

   Add Vitest/Testing Library coverage for:

   - default route renders inside the workspace shell;
   - sidebar nav links point to expected routes and active state follows location;
   - collapse trigger changes sidebar state;
   - mobile trigger opens the sheet at a narrow viewport;
   - route placeholder content changes without remounting the frame.

7. **Run gates**

   From `frontend/`:

   ```bash
   npm install
   npm run typecheck
   npm test
   npm run build
   ```

   From repo root:

   ```bash
   git diff --check
   ```

8. **Visual verification**

   Start the Vite dev server and verify the shell/sidebar with Playwright screenshots at desktop and mobile widths. Put screenshots under `artifacts/` only.

## What Not To Do In This Phase

- Do not import the old LibreChat vendor tree.
- Do not import old chat UI, composer, transcript rendering, or auth pages.
- Do not import MVP3 feature pages yet.
- Do not wire fake notifications, fake workspace teams, or fake user data into global state.
- Do not add a right-side agent console until the left shell and route outlet are stable.
- Do not update backend routes for shell work.

## Next Phase After Shell

Once the shell/sidebar is verified, import the backend client seam from the backup in a clean shape:

- `src/api/http/*` for `/v1` REST and SSE helpers.
- `src/api/protocol.ts`, `transport.ts`, `source-config.ts`, and reducer/projection modules for chat.
- `src/app/auth.ts` as a TanStack Query auth surface over `/v1/me`.
- `AuthGate` around the workspace shell.

That phase reconnects the real backend contract without making the shell responsible for sessions, auth, or chat behavior.

## Open Decisions

- Whether the first route should be `/tasks`, `/schools`, or a neutral workspace home.
- Whether notifications exist in phase 1 or the bell is omitted until real notification data exists.
- Whether the workspace switcher represents a real future object or should become an account/settings menu instead.
- Whether the new ADR should mark ADR 0020 as superseded in-place or add ADR 0026 and update the ADR index.
