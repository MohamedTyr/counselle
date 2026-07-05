# design-sync notes — Counselle Design System

Repo-specific gotchas for future syncs. Project: `Counselle Design System`
(claude.ai/design id `61e46001-cf2f-41f0-9ed8-752e546dba0c`).

## Build shape
- **Private app, not a published library** — `package.json` has no `main`/`module`/`exports`,
  and `dist/` is the Vite SPA build, not a component library entry. The converter runs in
  **synth-entry mode** (bundles components straight from `src/`).
- To make `PKG_DIR` resolve, a self-symlink is created: `node_modules/mvp3-frontend -> ..`
  (gitignored). **Re-create it on a fresh clone**: `ln -sfn .. node_modules/mvp3-frontend`.
- `srcDir` is scoped to **`src/components`** (not `src/`) on purpose: scanning all of `src`
  pulls in routes/pages/`App.tsx`, and `src/main.tsx` + `CalendarRoute.tsx` import raw
  Tailwind CSS (`@import "tailwindcss"`) that esbuild can't resolve. `src/components` is
  clean of CSS imports.
- `cssEntry` points at the **compiled** Vite CSS (`dist/assets/index-*.css`) — Tailwind v4 is
  compiled at app-build time; esbuild does not run Tailwind, so the compiled sheet is the only
  source of the utility classes + `:root` tokens. **The hash in the filename changes on every
  `npm run build`** — after a rebuild, re-point `cssEntry` at the new `dist/assets/index-*.css`.
- Geist is the brand font. The dist CSS references it via absolute `/assets/*.woff2` urls that
  dangle; `extraFonts` is wired to `@fontsource-variable/geist/wght.css` (relative urls + woff2)
  so the family actually ships in `fonts/`.

## Curation decision (component surface)
- The synth scan discovers **153** PascalCase exports (all the shadcn compound sub-parts:
  `CardHeader`, `TableCell`, `SelectItem`, every `Sidebar*` part, etc.).
- We present **33 top-level components** as cards (`componentSrcMap` nulls the ~120 structural
  sub-parts). **Every excluded symbol stays importable** on `window.CounselleDS` (the bundle
  `export *`s them) — exclusion only removes the standalone card, not the export. Sub-parts are
  documented via their parent's preview + prompt.
- Cards kept: Alert, Avatar, Badge, Button, Calendar, Card, CardFrame, Collapsible,
  DropdownMenu, Empty, Field, Form, Input, Popover, ScrollArea, Select, Separator, Sheet,
  Sidebar, Skeleton, Spinner, Table, Tabs, Textarea, Toolbar, Tooltip, plus composites
  EssayLibraryCard, NotificationsPopover, DashboardSidebar, CalendarPlanner, CalendarTimeGrid,
  TeamSwitcher, Logo.
- `DashboardNavigation` (sidebar-02/nav-main) is **default-export only** → not on the named
  global → excluded (`[BUNDLE_EXPORT]` if re-added). `DashboardSidebar` is the real composite.

## Dark theme is the default (IMPORTANT)
- The Counselle app defaults to the **dark** theme (`.dark` class on `<html>`; `.dark` token
  block in the compiled CSS). Every preview must render dark.
- Mechanism: `.design-sync/ds-theme.tsx` exports `DsDark`, wired via `cfg.extraEntries`
  (`./.design-sync/ds-theme.tsx`) + `cfg.provider: {component: "DsDark"}`. It runs a layout
  effect that adds `.dark` + `color-scheme:dark` to `<html>` and paints `document.body`
  with `var(--background)`/`var(--foreground)` — the harness hardcodes a light body, so this
  is what makes cards read like the real product. **Do not remove** `DsDark` / the provider.
- In dark, `--primary` inverts to near-white, so the default Button is a light pill with dark
  text — that is correct, not a bug.

## Content aligns with the real mvp3 pages
- Previews use authentic Counselle data + the app's exact status→variant mappings, so the DS
  mirrors tasks/schools/essays/activities:
  - Task status → Badge: todo=secondary, doing=info, waiting=warning, done=success
    (`features/tasks/task-config.ts` `statusBadgeVariant`); priority high=error/med=warning/low=success.
  - School status → Badge: Considering=secondary, Applying=info, Submitted/Accepted=success,
    Waitlisted=warning, Rejected=error; List type Reach=warning/Target=info/Safety=success
    (`features/schools/schools-config.ts`).
  - Schools table columns: School · Status · List Type · Round · Next Deadline · Progress · Essays.
  - Real school names from fixtures (Stanford, UC Berkeley, Boston University, Michigan, …).

## Known render warns (triaged legitimate)
- `[TOKENS_MISSING]` for `--sx-*` (schedule-x calendar) and `--active-tab-*` (Tabs) custom
  properties: these are **injected at runtime** (schedule-x theme / Tabs JS setting inline
  style), so they're expected absent from the static stylesheets. Non-blocking.

## Final state (first sync, complete)
- **28 cards** uploaded and graded good (43 cells); render check 28/28 clean; `window.CounselleDS`
  exposes 171 exports (all sub-parts importable).
- **5 composites excluded from cards** (still importable): NotificationsPopover (renders only the
  closed bell), TeamSwitcher (`useSidebar` context error even inside SidebarProvider),
  DashboardSidebar (needs router + sidebar context), CalendarPlanner / CalendarTimeGrid
  (heavy, interaction-driven schedule-x/temporal widgets). Re-authoring any of these needs their
  runtime context solved first.
- **Grading gotcha:** the single-capture review sheets (`_screenshots/review/`) can render
  black/light for grid-mode components (Select, EssayLibraryCard) due to a `DsDark` layout-effect
  timing quirk in `?story=` single mode. **Grade grid-mode components from the grid screenshot
  `_screenshots/<group>__<Name>.png`, not the review single-capture.** Overlay components with
  `cardMode:single` (Popover/Sheet/DropdownMenu/Tooltip) render dark correctly in the single capture.

## Re-sync risks
- `cssEntry` filename hash is the #1 staleness risk — re-run `npm run build`, then update
  `cssEntry` to the fresh `dist/assets/index-*.css` before the converter run.
- The self-symlink `node_modules/mvp3-frontend` must exist (recreate on fresh clone).
- The curation `componentSrcMap` is a large null-map; new components added to `src/components`
  will appear as cards automatically unless they're sub-parts that should be nulled.
