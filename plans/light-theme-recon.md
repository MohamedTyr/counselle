# Light-theme recon — full inventory

Scope: `frontend/` only. `mvp3-frontend/` ignored per instructions (dead older frontend).

**Important correction to the initial brief:** there is no `frontend/src/vendor/librechat/` directory in this checkout. `grep -ri librechat` across the entire frontend tree (excluding `node_modules`) returns zero hits, and there is no `vendor/` directory anywhere under `src/`. AGENTS.md confirms this is Counselle's own "MVP3 workspace" frontend (shipped 2026-07-06), not a vendored fork. **100% of the application code is first-party.** The "LibreChat clone" framing in the task brief does not describe this repo's current state — treat every finding below as first-party unless noted otherwise (only `node_modules/` and the `shadcn`/`sonner`/`shiki` npm packages are third-party, and those are consumed, not vendored-in-tree).

---

## 1. `frontend/src/index.css` structure (1028 lines)

| Range | Content |
|---|---|
| 1 | `@layer theme, base, components, utilities;` — cascade layer order |
| 3–6 | `@import "tailwindcss"`, `@import "tw-animate-css"`, `@import "shadcn/tailwind.css"`, `@import "@fontsource-variable/geist"` |
| 8 | `@source` glob for streamdown (markdown renderer) Tailwind class scanning |
| 10–270 | Unlayered markdown (`.markdown-response`) vertical-rhythm rules — spacing/typography only, colors referenced via `var(--workspace-foreground*)`, no hardcoded colors |
| 272 | `@custom-variant dark (&:is(.dark *));` — defines Tailwind's `dark:` variant as **class-based**, scoped to `.dark` ancestor (not `prefers-color-scheme` media query) |
| 274–327 | `@theme inline { ... }` — Tailwind v4 token → utility-class binding (see §2) |
| 329–620 | `:root { ... }` — **254 raw/semantic tokens**, the dark palette (see family table below) |
| 622–663 | `.dark { ... }` — **40 tokens**, near-total duplicate of the shadcn-semantic subset of `:root` (see "dead weight" analysis below) |
| 665–720 | `@layer base` — global reset: `*` border/outline defaults, scrollbar styling (uses `var(--scrollbar-*)`), `body`/`html` base classes |
| 722–1028 | `@layer components` — component classes: sidebar chat title/search/action/resizer, scroll-area thumb, ProseMirror essay-editor typography. All color values are `var(--token)` or `color-mix(in oklch/oklab, var(--token) N%, transparent)` — **zero literal colors** in this section |

### `:root` token families (254 total)

| Prefix | Count | Notes |
|---|---:|---|
| `--task-*` | 66 | Task board/lane/card/pill/category system — largest family, heavy `color-mix()` and cross-references |
| `--workspace-*` | 61 | Chat shell surfaces, composer, dropdowns, pills — second-largest, root of many aliases |
| `--onboarding-*` | 20 | All alias to `--workspace-*` / `--profile-*` — thin re-export layer |
| `--activity-*` | 18 | Activity list/row/chip — aliases to `--workspace-*` |
| `--shell-*` | 15 | App chrome: sidebar background, divider, scrollbar |
| `--essay-*` | 15 | Split across editor-chrome (dark, aliases `--workspace-*`/`--shell-*`) and editor-document (light "paper", aliases `--document-*`) — see §9 |
| `--profile-*` | 11 | All aliases to `--workspace-*` |
| `--sidebar-*` (shadcn) | 8 | shadcn sidebar semantics |
| `--scrollbar-*` | 5 | `color-mix()` off `--workspace-foreground` |
| `--chart-*` (shadcn) | 5 | Grayscale `oklch(... 0 0)` ramp — **unused in any component** (dead boilerplate, see §9) |
| `--document-*` | 4 | The one intentionally-light family: `oklch(0.985...)` bg down to `oklch(0.16...)` fg — a light "paper" surface living inside the dark shell |
| shadcn semantic singles (`--warning`, `--success`, `--secondary`, `--primary`, `--popover`, `--muted`, `--info`, `--destructive`, `--card`, `--accent`, `--ring`, `--radius`, `--input`, `--foreground`, `--border`, `--background`) | ~24 | Standard shadcn contract, mostly alias to `--workspace-*`/`--shell-*` |

**Raw vs. alias split** (approximate, single-line regex count — a few multi-line `color-mix`/box-shadow declarations aren't captured by the naive count so these don't sum to exactly 254):

- Raw hex literals: **82** (e.g. `--shell-background: #171615`)
- Raw `oklch()` literals: **9** (the `--document-*` family, `--chart-*` family, `--success`)
- `var()` alias references: **135** (majority — good, this is the "semantic alias" layer already working)
- `color-mix()` composites: **7** (scrollbar thumb states, task-card shadows/highlights, task-drag/selected states)
- Plain numeric/dimension values (radii, gaps, densities — not colors): **14**

So roughly a third of `:root` is raw primitives, over half is already semantic aliasing — the alias *pattern* is sound, it just currently has nowhere to point but dark values.

### `.dark` block (622–663, 40 tokens) — dead weight, with one bug

Every token in `.dark` restates a token also set in `:root` (`--background`, `--foreground`, `--card*`, `--popover*`, `--document*`, `--essay-document-*`, `--primary*`, `--secondary*`, `--muted*`, `--accent*`, `--destructive`, `--success`, `--border`, `--input`, `--ring`, `--chart-1..5`, `--sidebar*`). **39 of the 40 are byte-identical** to their `:root` counterpart.

**One is not identical — a latent bug:** `--document-border`
- `:root` (line 501): `oklch(0.895 0.003 250)`
- `.dark` (line 632): `oklch(0.84 0.003 250)`

Since the app never runs without `.dark` on `<html>` today (see §6), the `:root` value is currently dead code and `.dark`'s value is what actually renders — but the discrepancy shows the block has drifted from a copy-paste, not a deliberate override. Flag for whoever removes `.dark`: decide which of the two document-border values is intended before deleting the block, don't just delete blindly.

---

## 2. Tailwind v4 `@theme inline` mapping (lines 274–327)

Tailwind v4's `@theme inline` block is what turns CSS custom properties into Tailwind utility classes (`bg-primary`, `text-muted-foreground`, `rounded-md`, etc.). Every entry re-points a `--color-*`/`--radius-*`/`--font-*` Tailwind-namespaced variable at the semantic token of the same short name:

- **Fonts:** `--font-heading` → `var(--font-sans)`, `--font-sans` → literal `"Geist Variable", sans-serif`, `--font-document` → literal `Georgia, ui-serif, serif` (only non-token, hardcoded font stack — fine, not a color concern)
- **Radii:** `--radius-sm/md/lg/xl/2xl/3xl/4xl` all derive from one `--radius` value via `calc()` — a clean single-source-of-truth scale
- **Colors:** every shadcn-standard color (`background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `success`, `warning`, `info`, `border`, `input`, `ring`, `chart-1..5`, `sidebar*`) plus the app-specific `document`, `document-foreground`, `document-muted`, `document-border` are exposed as `--color-X: var(--X)`

This means: **any token not listed in `@theme inline` has no Tailwind utility class** — it's only usable via arbitrary-value syntax (`bg-[var(--workspace-surface)]`, `border-[var(--onboarding-border)]`, etc.), which is exactly what the codebase does everywhere outside the shadcn primitive layer (see §3/§5, the near-total absence of raw palette classes is because components reach for `var(--token)` arbitrary values instead). The `--task-*`, `--workspace-*`, `--shell-*`, `--activity-*`, `--essay-*`, `--onboarding-*`, `--profile-*` families are **not** wired into `@theme inline` at all — they're CSS-var-only, consumed via `bg-[var(--...)]`/`text-[var(--...)]`/`border-[var(--...)]` arbitrary-value utilities throughout `src/features/*` and `src/components/ui/*`.

---

## 3. Hardcoded colors outside the token block

**Headline finding: this codebase is exceptionally clean on this axis.** Searched all of `frontend/src/**/*.{ts,tsx,css}` for hex/`rgb()`/`rgba()`/`hsl()`/`hsla()`/`oklch()` literals.

| Pattern | Count outside `index.css` | Locations |
|---|---:|---|
| Hex (`#abc`, `#aabbcc`, 8-digit) | **0** | none found |
| `rgb()`/`rgba()` | **1** | `src/components/ui/onboarding-setup.tsx:173` — `shadow-[0_1px_2px_rgba(0,0,0,0.04)]` (a fixed near-black shadow tint; harmless on light card surfaces but worth converting to `color-mix()`/token form for consistency) |
| `hsl()`/`hsla()` | **0** | none |
| `oklch()` | **0** | none outside `index.css` |

- **Inline `style={{}}` props (14 total, `rg` count):** none carry color values. They set `minWidth`/`width` (table column sizing), `transform` (translateY for virtualization/scroll indicators), `resize: "none"`, `fontFamily` (essay toolbar font picker, not color), `"--sidebar-width"` custom-property assignment, and `contentVisibility`/`containIntrinsicSize` (code-block perf hints). Full list: `AllTasksTable.tsx:283,288`, `InlineSkillMentionLayer.tsx:73`, `SidebarResizer.tsx:34`, `AiComposer.tsx:178`, `EssayEditorToolbar.tsx:122`, `school-cells.tsx:178`, `WorkspaceScrollIndicator.tsx:84`, `SchoolsTable.tsx:132,139`, `CitationRenderer.tsx:291`, `WorkspaceShell.tsx:33`, `ChatComposer.tsx:199`, `code-block.tsx:318`.
- **SVG `fill`/`stroke` attributes (7 hits):** all `fill="none"`, `stroke="currentColor"`, or `fill="currentColor"` (`select.tsx:192,194`, `menu.tsx:169,171,217,219`, `CounselleLogo.tsx:6`) — correctly polarity-agnostic, inherit from text color.
- **Chart/data-viz color arrays:** none exist. `--chart-1..5` tokens are defined in `index.css` but **not referenced anywhere in `src/**/*.{ts,tsx}`** — dead boilerplate carried over from the shadcn scaffold (see §9).
- **Canvas/WebGL:** one legitimate `canvas`/`getContext("2d")` use in `src/components/ai-elements/prompt-input.tsx:139–151` — it's an image-resize/compress utility (draws an uploaded image to a canvas to re-encode as PNG blob), not a color-rendering surface. No color logic there.
- **`.ts` files:** no color literals found in any `.ts` file (only `.tsx`/`.css` had hits, and only the one `rgba()` in a `.tsx`).
- **Runtime-generated colors (not static in source, worth flagging separately):** `src/components/ai-elements/code-block.tsx` uses `shiki`'s `createHighlighter` with `themes: { dark: "github-dark", light: "github-light" }` (line 159–163, 216–219). Shiki computes per-token `color`/`bgColor` hex values at runtime from its bundled theme JSON and injects them via `style={{ backgroundColor: token.color, color: token.bgColor, ...token.htmlStyle }}` (`TokenSpan`, line 62–78) plus a `dark:!bg-[var(--shiki-dark-bg)] dark:!text-[var(--shiki-dark)]` class pair. This is **already dual-theme-correct**: base inline style is the light (`github-light`) theme, `.dark` ancestor swaps to the dark (`github-dark`) theme via shiki's own `--shiki-dark`/`--shiki-dark-bg` CSS custom properties that it stamps onto each token's `htmlStyle`. No source-code change needed here for the light-mode flip — see §9.

**Total literal-color count in first-party `.ts`/`.tsx`/`.css` files (excluding `index.css`): 1** (the `rgba()` in `onboarding-setup.tsx`).

---

## 4. Tailwind `dark:` variant usage

`@custom-variant dark (&:is(.dark *));` (index.css:272) makes `dark:` fire on **any element under `.dark`**, not on `prefers-color-scheme`. Since `.dark` is applied to `<html>` unconditionally today for practical purposes (see §6 — theme defaults to `"system"` and most environments/browsers default dark, and even in "light" mode the CSS has no `.light` block to differ from `:root`), these are effectively **live** already in some sessions and will become **decision points** the moment a `.light` block exists.

- **Total `dark:` occurrences (utility-class instances):** 77
- **Lines containing `dark:`:** 25
- **`not-dark:` occurrences (explicit light-mode-only override):** 12

| File | `dark:` occurrences | Character |
|---|---:|---|
| `src/components/ui/button.tsx` | multiple | Part of a **polarity-aware** shadow/highlight pattern — see §7 |
| `src/components/ui/card.tsx` | multiple | Same pattern |
| `src/components/ui/table.tsx` | multiple | Same pattern, plus `color-mix()` hover/selected row tints |
| `src/components/ui/input.tsx`, `textarea.tsx`, `select.tsx`, `menu.tsx`, `popover.tsx`, `sheet.tsx`, `empty.tsx`, `avatar.tsx`, `checkbox.tsx`, `radio-group.tsx`, `tabs.tsx`, `toolbar.tsx`, `input-group.tsx`, `dropdown-menu.tsx`, `badge.tsx` | 1–4 each | Same shadcn primitive pattern |
| `src/components/ai-elements/code-block.tsx` | 2 | Shiki dual-theme token color swap (see §3) — already correct |
| `src/components/ai-elements/conversation.tsx:89,157` | 2 | `dark:bg-background dark:hover:bg-muted` on the "scroll to bottom" round button — **no base-case background class**, only a `dark:` one. Needs a visual check: in light mode this button currently likely relies on `variant="outline"` from the shared `Button` component for any background; confirm it isn't blank/invisible once `.dark` is genuinely absent. |
| `src/features/ai-chat/components/SourcesRail.tsx:51` | 1 | `dark:bg-primary/[0.045]` tint adjustment, paired with a `bg-primary/[0.03]` base — polarity-aware |
| `src/features/ai-sidebar/ChatSessionList.tsx:97` | 3 | `dark:!bg-transparent dark:hover:!bg-sidebar-accent dark:has-focus-visible:!bg-sidebar-accent` reinforcing an already-transparent/`!bg-transparent` base — likely redundant with the base class today but worth re-checking once light-mode sidebar colors differ from dark |
| `src/features/tasks/TaskDetailSheet.tsx:227` | 2 | Same `!bg-transparent` reinforcement pattern |
| `src/features/tasks/task-inline-controls.tsx:208` | 2 | Same pattern |
| `src/features/tasks/UpcomingTasksView.tsx:143` | 1 | `dark:hover:bg-input/50` — light mode currently has no equivalent hover-tint override; will need one |

**Read of the pattern:** the large majority of `dark:` usage (≈60 of 77) lives in `src/components/ui/*` — the shadcn primitive layer — and is **already correctly paired** with `not-dark:` counterparts implementing a light-appropriate shadow/highlight scheme (see §7/§9). The smaller set in first-party feature components (`conversation.tsx`, `SourcesRail.tsx`, `ChatSessionList.tsx`, `TaskDetailSheet.tsx`, `task-inline-controls.tsx`, `UpcomingTasksView.tsx`) is more ad hoc and each one needs a manual visual check once light mode is live — these were written assuming `.dark` is always present.

---

## 5. Hardcoded Tailwind palette classes

Searched for `{bg,text,border,ring,fill,stroke,from,via,to,divide,outline,accent,caret,shadow,decoration}-{white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose}(-NN)?` across all `.ts`/`.tsx`.

**Total: 10 raw-palette utility instances, across 5 files** — far smaller than the brief anticipated; this is not the codebase's biggest DRY violation class (that's actually the shadow/`color-mix` inline-arbitrary-value pattern in §7, which is at least intentional).

| File:line | Class | Context |
|---|---|---|
| `src/components/ui/button.tsx:37` | `text-white` (×2 in the line: base + loading-indicator selector) | Destructive-variant button label text |
| `src/components/ui/sheet.tsx:36` | `bg-black/32` | Sheet overlay/scrim |
| `src/components/ui/dialog.tsx:40` | `bg-black/10` | Dialog overlay/scrim |
| `src/features/ai-chat/components/SourcesRail.tsx:174` | `shadow-black/[0.02]` | Source-card resting shadow |
| `src/components/ai-elements/tool.tsx:59` | `text-yellow-600` | Tool-call status icon: "approval-requested" |
| `src/components/ai-elements/tool.tsx:60` | `text-blue-600` | Tool-call status icon: "approval-responded" |
| `src/components/ai-elements/tool.tsx:63` | `text-green-600` | Tool-call status icon: "output-available" |
| `src/components/ai-elements/tool.tsx:64` | `text-orange-600` | Tool-call status icon: "output-denied" |
| `src/components/ai-elements/tool.tsx:65` | `text-red-600` | Tool-call status icon: "output-error" |

**Notable near-miss (not counted above, semantically distinct):** the shadcn overlay pattern (`sheet.tsx`, `dialog.tsx`) using literal `bg-black/NN` for scrims is actually reasonable even in light mode (scrims are conventionally black-tinted regardless of theme) — flag for a design decision rather than an automatic token conversion. `tool.tsx`'s five status-color classes are the one real case of "should be semantic tokens" (e.g. `text-warning`, `text-info`, `text-success`, `text-destructive` already exist as tokens in `index.css` and aren't being used here) — small, contained fix.

---

## 6. Theme runtime

**File:** `src/components/theme-provider.tsx`. A fully-built, non-trivial theme system already exists:

- **Types:** `Theme = "dark" | "light" | "system"`, `ResolvedTheme = "dark" | "light"`
- **Storage:** `localStorage` key `"theme"` (default `storageKey = "theme"`), read on mount via `isTheme()` guard, written on every `setTheme()` call
- **Default:** `defaultTheme = "system"` (set by `<ThemeProvider>` default prop; `AppProviders.tsx` calls `<ThemeProvider>` with no override, so the app ships with `"system"` as the initial theme)
- **DOM application (`applyTheme`):** resolves `"system"` via `window.matchMedia("(prefers-color-scheme: dark)")`, then `document.documentElement.classList.remove("light", "dark")` followed by `classList.add(resolvedTheme)` — so `<html>` gets exactly one of `.light`/`.dark`. **Because `index.css` has no `.light` block, adding the `light` class today changes nothing visually** — the app still renders `:root`'s dark values regardless of resolved theme. This is the crux of why the app reads as "dark-only" even though the plumbing for a toggle already exists.
- **System-preference reactivity:** subscribes to `mediaQuery.addEventListener("change", ...)` while `theme === "system"`, re-applies on OS-level scheme changes
- **Cross-tab sync:** `window.addEventListener("storage", ...)` — if another tab changes the `"theme"` localStorage key, this tab's state updates too
- **Transition suppression:** `disableTransitionsTemporarily()` (on by default via `disableTransitionOnChange = true`) injects a temporary `* { transition: none !important }` style tag around a theme switch to avoid a flash of animated color transitions
- **Keyboard shortcut:** a global `keydown` listener toggles theme on bare `d` (no modifier keys, not focused in an editable target) — cycles dark→light, light→dark, or from `"system"` to the opposite of the current resolved theme. **This is the only way to reach light mode today; there is no visible UI toggle.** (Confirmed via `grep -rn "Moon|Sun"` and `grep -i toggle` across `src/**/*.tsx` — no theme-toggle button component exists.)

**Consumers:**
- `src/app/AppProviders.tsx` — wraps the app in `<ThemeProvider>` (default props, no `defaultTheme` override)
- `src/components/ui/sonner.tsx` — the only other `useTheme()` consumer; passes `theme` straight through to the `sonner` toast library's own `theme` prop, and separately maps `--normal-bg`/`--normal-text`/`--normal-border`/`--border-radius` to `var(--popover)`/`var(--popover-foreground)`/`var(--border)`/`var(--radius)`. This is **already token-driven and theme-correct** — sonner's own light/dark CSS plus the passed-through custom properties should flip correctly once the token layer has real light values.

**Net assessment:** the runtime is essentially done and doesn't need rebuilding — it's `light`/`dark`/`system`-aware, persists, syncs across tabs, and respects OS preference. The gap is 100% on the CSS token side (no `.light` block) and 100% on discoverability (no UI toggle, only a hidden `d` keyboard shortcut). Both are cheap follow-ups once tokens exist.

---

## 7. Opacity/alpha patterns

- **Semantic-token alpha modifiers (`bg-muted/20`, `ring-ring/50`, `text-muted-foreground/80`, etc.):** **144 distinct lines** matching `{bg,text,border,ring,shadow,from,via,to,outline,divide}-<token>/<5–95>` across `.tsx` files. This is the dominant alpha pattern in the codebase and it's built on **semantic tokens**, not raw palette — good architecturally, but every one of these opacity percentages was tuned by eye against the current dark backgrounds. Heaviest concentrations: `src/features/tasks/*` (TaskCard.tsx, TaskColumn.tsx, TaskDetailSheet.tsx, UpcomingTasksView.tsx, AllTasksTable.tsx, task-actions.tsx), `src/features/schools/*` (SchoolWorkspace.tsx, SchoolsTable.tsx, school-cells.tsx, WorkspaceScrollIndicator.tsx, AddSchoolDialog.tsx), and the shadcn primitives (`button.tsx`, `card.tsx`, `table.tsx`). **Every one of these needs a visual re-check against light backgrounds** — an opacity tuned to read as "subtle raised surface" on `#171615` will not automatically read the same on a light `--shell-background`.
- **Raw `white`/`black` with alpha:** only the 4 instances already listed in §5 (`button.tsx:37`, `dialog.tsx:40`, `sheet.tsx:36`, `SourcesRail.tsx:174`) plus the `--theme(--color-black/N%)`/`--theme(--color-white/N%)` inset-shadow pattern below.
- **`color-mix()` outside `index.css` (6 files):** `table.tsx` (row hover/selected tints, both `not-in-data`/`in-data` variants, each paired `dark:`/base using `--color-black`/`--color-white` mix against `var(--card)`/`var(--background)`), `AiComposer.tsx:135` and `ChatComposer.tsx:152` (`color-mix(in_oklch, var(--shell-background) 60%, transparent)` for composer drop-shadow — **hardcodes an assumption that `--shell-background` is dark**, i.e. mixing 60% of the shell color into a shadow only reads as a shadow if `--shell-background` is dark; on a light shell this produces a light-tinted "shadow" that won't look like a shadow. This is the single most direct instance of "shadows assume dark" called out in the brief — see §8).
- **The `--theme(--color-black/N%)` / `--theme(--color-white/N%)` inset-shadow pattern:** used extensively in `button.tsx`, `card.tsx`, `table.tsx`, `input.tsx`, `textarea.tsx`, `select.tsx`, `menu.tsx`, `popover.tsx`, `sheet.tsx`, `empty.tsx` — e.g. `before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]`. This is a **deliberately polarity-aware technique** (already shipped, from the shadcn/base-ui component generation): light mode gets a subtle black inset-shadow for depth (top edge darkening), dark mode swaps to a white inset-highlight (top edge lightening) — the classic "light needs shadows, dark needs highlight-borders" idiom the task brief asks to watch for. **This one is already done correctly and should be preserved as the reference pattern**, not reinvented.

---

## 8. Anything that assumes dark

- **Composer/task-card drop-shadows via `color-mix(in oklch, var(--shell-background) N%, transparent)`:** `--workspace-task-card-shadow` (index.css:393–395), `--activity-row-shadow` (445–447), `--essay-editor-header-shadow` (464–466), `--essay-editor-toolbar-shadow` (470–471), `--task-drag-preview-shadow` (602–603), plus the two composer inline shadows in `AiComposer.tsx:135`/`ChatComposer.tsx:152`. All mix `var(--shell-background)` into a shadow color — this only produces a plausible "shadow" while `--shell-background` is dark. **These need to become genuine shadow tokens** (real low-opacity black, not a shell-color mix) once the shell goes light, or the composer/task-card/essay-editor chrome will render with a light-tinted, invisible-looking "shadow."
- **`backdrop-filter`/`backdrop-blur`:** 5 occurrences — `dialog.tsx:40`, `sheet.tsx:36`, plus others; paired with `bg-black/NN` scrims, which read fine in either theme (see §5 note).
- **`mix-blend-mode`:** exactly one use — `src/components/ui/avatar.tsx:18`, `after:mix-blend-darken data-[size=lg]:size-10 ... dark:after:mix-blend-lighten` on the avatar's border ring. **Already polarity-aware** (darken in light, lighten in dark) — correct pattern, preserve.
- **`filter: invert()`:** none found anywhere.
- **`color-scheme` CSS property:** not declared anywhere (not in `index.css`, not per-component). Worth adding a `color-scheme: light dark` (or per-resolved-theme value) at the root once light mode ships, so native form controls/scrollbars pick the right OS chrome.
- **`<meta name="theme-color">` / PWA manifest:** `index.html` has no `<meta name="theme-color">` tag at all, and there is no `manifest.json`/PWA manifest anywhere in `frontend/` (checked `public/` and repo root for `manifest*.json`). Nothing to migrate, but nothing configured either — worth adding once a light `--shell-background` exists, for mobile browser chrome coloring.
- **Syntax-highlighting theme (`code-block.tsx`):** already dual-theme via `shiki`'s `github-light`/`github-dark` themes — see §3/§9, no work needed.
- **`sonner` toast theme:** already wired via `useTheme()` pass-through — see §6, no work needed.
- **Static dark-only image assets:** `public/onboarding/{academic,basics,context,direction,fit}.svg` — five SVG illustrations used by the onboarding flow (`src/features/onboarding/onboarding-steps.ts`, `OnboardingAside.tsx`, and the dev gallery `OnboardingShellGalleryPage.tsx`). Each SVG **bakes the current dark palette directly into its own `<linearGradient>`/`<radialGradient>`/`fill` attributes** as static hex values matching the app tokens almost exactly: backgrounds `#1b1a19`/`#141312`/`#1c1b19`/`#201e1c`/`#211f1d` (≈`--shell-background`/`--workspace-surface`), accents `#d8d0c3` (≈`--workspace-primary`), plus `#2a2724`/`#3a3733`/`#252220`/`#2b2926` (≈`--workspace-surface-raised`/`--workspace-composer-control-surface` family), and a black `stop-color="#000000"` vignette. **These are standalone static assets, not driven by CSS custom properties at all** — a light shell will need new light-mode SVG art (or art redesigned to be theme-neutral / SVG `currentColor`-driven), not a token swap. This is real design + asset work, not a code fix.
- **`public/landing.html`:** a fully separate, static marketing page (125 lines, outside the React app / outside `index.css`'s token system entirely) with its own hardcoded dark palette: `#171615` (×2), `#e3e0db`, `#d8d0c3`, `#a39e95`, `#34312e`, `#211f1d`, `#1d1b19`, plus `rgba(216, 208, 195, 0.12)` and `rgba(0, 0, 0, 0.32)`. This is served as a static file (see `public/` listing) and is **not touched by the React theming system at all** — it needs its own separate light-mode pass (or a decision to leave the landing page permanently dark as a brand choice, which is a legitimate option since it's not part of the authenticated app shell).

---

## 9. Existing conventions worth preserving

- **The alias-chain pattern itself is sound.** 135 of 254 root tokens are `var()` references to other tokens (`--onboarding-*` → `--workspace-*`/`--profile-*`, `--activity-*` → `--workspace-*`, `--profile-*` → `--workspace-*`, `--task-doing/waiting/done-*` → `--task-todo-*` plus one pill-color override each). This is a real 2-tier system already (primitive-ish `--workspace-*`/`--shell-*` → feature-semantic `--task-*`/`--activity-*`/`--onboarding-*`/`--profile-*`/`--essay-*`). A light-mode refactor can mostly **repoint the primitives** (`--shell-*`, `--workspace-*` raw hex values) and let the alias chain propagate — it does not need every one of the 254 tokens re-derived by hand.
- **The `--theme(--color-black/N%)` / `--theme(--color-white/N%)` inset-shadow idiom in `src/components/ui/*`** (button, card, table, input, textarea, select, menu, popover, sheet, empty) is **already the correct light/dark answer** to "light needs shadows, dark needs highlight-borders" — don't reinvent this, extend it as the house style for any new component.
- **`avatar.tsx`'s `mix-blend-darken`/`dark:mix-blend-lighten`** on the avatar ring border is the same idiom applied to blend modes — correct, preserve.
- **Shiki code-block dual-theme (`code-block.tsx`)** is fully built for both themes already (`themes: { dark: "github-dark", light: "github-light" }`, `dark:!bg-[var(--shiki-dark-bg)]` class pairing) — zero code changes needed for the light flip.
- **`sonner` toast theming** is already token-driven and theme-aware via `useTheme()` — zero code changes needed.
- **The `--document-*` / `--essay-document-*` family is the one part of the system that is ALREADY light**, and this has direct implications for the shell refactor:
  - `--document`: `oklch(0.985 0.003 250)` (near-white), `--document-foreground`: `oklch(0.16 0.002 250)` (near-black), `--document-muted`: `oklch(0.34 0.003 250)`, `--document-border`: `oklch(0.895 0.003 250)` in `:root` / `oklch(0.84 0.003 250)` in `.dark` (the one drift noted in §1).
  - Consumed by `src/features/essays/EssayDocumentPreview.tsx`, `EssayLibraryCard.tsx`, `EssayEditorRoute.tsx`, and the ProseMirror essay-editor CSS in `index.css` (`@layer components`, lines 957–1027) — this is the deliberate "light paper inside a dark shell" surface (essay documents render as light paper regardless of app theme, like Google Docs/Word).
  - **Implication for the light-shell refactor:** once the *shell* also goes light, `--document` and the shell background converge toward the same near-white value, and the essay editor's paper surface **loses its current visual distinction** (today the paper pops because it's the one light rectangle in a dark app; in an all-light app it risks blending into the surrounding chrome). The refactor needs a deliberate decision here — e.g. keep `--document` as a slightly-elevated/bordered white distinct from a slightly-off-white shell, or keep a subtle shadow/border contrast — this is a design decision, not just a token repoint, and should be flagged early rather than discovered late.
  - The `--essay-editor-chrome-surface`/`--essay-editor-header-surface`/`--essay-editor-toolbar-surface` tokens (the chrome *around* the paper) currently alias `--shell-background`/`--workspace-surface-raised` (dark) — these should flip with the rest of the shell; only the `--document*`/`--essay-document-*` paper tokens are the intentional exception.
- **`--chart-1..5` are unused dead code** (confirmed zero references in any `.tsx`/`.ts`) — safe to delete entirely rather than redesign for light mode, unless a chart feature is planned.
- **Radius scale** (`--radius` → `--radius-sm/md/lg/xl/2xl/3xl/4xl` via `calc()`) is theme-independent and needs no changes.

---

## 10. Test/QA surface

- `src/test/` contains exactly three files: `protocol-fixtures.test.ts`, `render-app.tsx` (test render harness), `setup.ts` (test environment setup). **None reference color, theme, `dark`, or `light`.**
- No Playwright config anywhere in the repo (`find . -iname "playwright.config*"` — zero hits outside `node_modules`).
- No screenshot/visual-regression baselines exist (`find . -iname "*.png"` outside `node_modules` — zero hits).
- No `toHaveScreenshot`/`toMatchSnapshot` calls anywhere in `src/`.
- **Conclusion: zero existing test coverage of color or theme, in any form.** A light-mode rollout has no regression safety net today — any visual-regression tooling (Playwright screenshots at minimum, per both themes) would be new infrastructure, not an extension of something existing.

---

## Summary of raw counts

| Problem class | Count | Where |
|---|---:|---|
| `:root` tokens (raw dark palette) | 254 | `index.css:329–620` |
| `.dark` tokens (dead duplicate, 1 drifted) | 40 | `index.css:622–663` |
| Hardcoded hex outside `index.css` | 0 | — |
| Hardcoded `rgb()`/`rgba()` outside `index.css` | 1 | `onboarding-setup.tsx:173` |
| Hardcoded `hsl()`/`oklch()` outside `index.css` | 0 | — |
| Tailwind raw-palette utility classes | 10 | 5 files (§5) |
| `dark:` variant instances | 77 (25 lines) | 25 files, mostly `components/ui/*` |
| `not-dark:` variant instances | 12 | `components/ui/*` |
| Semantic-token alpha-modifier lines (`token/NN`) | 144 | mostly `features/tasks/*`, `features/schools/*`, `components/ui/*` |
| `color-mix()` calls outside `index.css` | 6 lines (7 calls) | `table.tsx`, `AiComposer.tsx`, `ChatComposer.tsx` |
| Static dark-baked SVG assets | 5 | `public/onboarding/*.svg` |
| Separate static HTML with hardcoded dark palette | 1 (9 literals) | `public/landing.html` |
| Existing theme/color tests | 0 | — |
