# Vendored LibreChat source

Cloned from **danny-avila/LibreChat** (MIT — see `LICENSE` in this directory).

- **Pinned commit:** `197a1dc4e263a7925f8e86a2a691ac4d7aa31829`
- **Vendored:** 2026-06-11
- Re-syncs are deliberate tasks against this commit. Never restyle a file in
  `vendor/` — every change here is a *subtraction* (feature MVP2 doesn't have)
  or a *props rewire*, recorded below. Tailwind classes and JSX structure stay
  byte-identical.

## Directory map

| Directory | Upstream path |
|---|---|
| `client/` | `packages/client/src` (the `@librechat/client` workspace package) |
| `app/` | `client/src` subset (same relative paths; vendored per-surface in FE-1…FE-5) |

Sibling files copied verbatim from upstream `client/`:

| Our path | Upstream path |
|---|---|
| `frontend/tailwind.config.cjs` | `client/tailwind.config.cjs` (content globs adapted to this repo; tokens untouched) |
| `frontend/postcss.config.cjs` | `client/postcss.config.cjs` |
| `frontend/src/styles/style.css` | `client/src/style.css` |
| `frontend/src/styles/mobile.css` | `client/src/mobile.css` |
| `frontend/public/fonts/` | `client/public/fonts/` (9 .woff2: Inter + Roboto Mono) |
| `app/locales/en/translation.json` | `client/src/locales/en/translation.json` |

## Mechanical transform (whole `client/` tree)

- All internal `'~/...'` module specifiers rewritten to `'@librechat/client/...'`
  (sed pass at vendor time) so the package's self-alias can't collide with the
  app-files alias (`~` → `vendor/librechat/app`). No other content changed.

## Subtractions & patches (`client/`)

| File(s) | Change | Why |
|---|---|---|
| `components/DataTable.tsx`, `components/DataTable/` | deleted (+ exports removed from `components/index.ts`) | needs `@tanstack/react-table`/`react-virtual`; no data-table surface in MVP2 |
| `components/InputOTP.tsx` | deleted (+ export) | 2FA dropped (PRD decision 6); needs `input-otp` |
| `components/InputNumber.tsx` | deleted (+ export) | needs `rc-input-number`; unused by our surfaces |
| `hooks/useAvatar.ts` | deleted (+ export) | dicebear-generated avatars dropped |
| `components/Avatar.tsx` | patch: `useAvatar` call removed; renders `user.avatar` URL or their default icon | same |
| `utils/cloudfront.ts` | deleted (+ export) | their file-upload CDN helper; file uploads dropped |
| `locales/i18n.ts` | deleted | i18next replaced (below) |
| `locales/*` (non-en) | deleted | English-only (PRD) |
| `hooks/useLocalize.ts` | **reimplemented**: flat English lookup over the vendored en translation JSONs, `{{var}}` interpolation, dev-mode missing-key warn | drops i18next/react-i18next; strings stay byte-identical |
| `*.spec.*` (9 files) | deleted | their test files; we don't run their suite |
| `librechat-data-provider` imports | package never installed; typed stub at `src/types/librechat-data-provider.d.ts` | type-only imports remain (TUser, TFile) |
