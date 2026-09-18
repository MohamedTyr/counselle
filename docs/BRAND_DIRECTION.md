# Counselle — selected colors and typography

Selected by the owner on September 13, 2026: **Evergreen / Citron + Switzer**.

This records the chosen visual direction from the design studio. It does not apply a production theme change or supersede the implemented system in `DESIGN.md`. Palette and font family are selected; the preview's alternative compositions are not a final layout decision.

## Colors — Evergreen / Citron

Deep blue-green anchors the hero, electric citron emphasizes its primary action, and near-white surfaces keep reading areas clear. OKLCH values below are the exact saved palette values, not approximations.

| Role | Color |
| --- | --- |
| Hero background | `oklch(29% .055 170)` |
| Hero text | `oklch(99% 0 0)` |
| Hero button background — citron | `oklch(92% .18 115)` |
| Hero button text | `oklch(19% 0 0)` |
| App action background | `oklch(38% .065 170)` |
| App action text | `oklch(99% 0 0)` |
| Selection background | `oklch(96% .012 170)` |
| Selection text | `oklch(38% .065 170)` |
| Surface | `oklch(99% 0 0)` |
| Canvas | `oklch(97% 0 0)` |
| Border | `oklch(88% 0 0)` |
| Body text | `oklch(19% 0 0)` |
| Muted text | `oklch(43% 0 0)` |

Keep the foreground/background pairs together. Citron is the hero action accent, not a body-text color. The workspace example uses the lighter evergreen action color with near-white text. This selection does not redefine semantic error, warning, or success colors.

Machine-readable palette: [evergreen-citron.palette.json](../frontend/public/evergreen-citron.palette.json). Its `typography: null` field reflects its original color-only scope; the font decision is recorded here.

## Typography — Switzer only

Use **Switzer for both headlines and interface text**. Fraunces and Instrument Serif were comparison candidates, not the selected direction.

| Role | Weight | Treatment |
| --- | --- | --- |
| Hero headline | Semibold `600` | Tracking `-0.04em`; balanced wrapping |
| Section headings and wordmark | Semibold `600` | Size and spacing establish hierarchy |
| Buttons, selected labels, controls | Semibold `600` | Clear emphasis without another family |
| Body copy, descriptions, ordinary labels | Regular `400` | Normal letter-spacing; line-height `1.5` |

Font stack: `Switzer, Arial, sans-serif`.

### Preview sizing reference

These are the current **Original landing** composition settings, not an approved app-wide type scale:

- Hero: `clamp(42px, 5.5vw, 86px)`, line-height `1.1`.
- At viewport widths of 700px or less: hero `clamp(38px, 9vw, 58px)`, line-height `1.4` to accommodate longer wraps.
- Intro: 18px, reducing to 17px on mobile; measure capped at `36ch`.
- Base text: 15px / `1.5`; ordinary buttons and navigation: 14px.
- Mobile studio selectors: 16px to avoid input zoom.

### Font assets

Use the real Regular and Semibold WOFF2 faces, served locally with `font-display: swap`:

- [Switzer Regular](../frontend/src/features/landing/assets/switzer-regular.woff2)
- [Switzer Semibold](../frontend/src/features/landing/assets/switzer-semibold.woff2)

These are normal-style faces. Load an appropriate real face before introducing italics or additional weights; do not rely on synthesized styles.

Switzer is copyright Indian Type Foundry and is distributed under the [ITF Free Font License](https://www.fontshare.com/licenses/itf-ffl). See the existing [landing asset provenance](../frontend/src/features/landing/assets/README.md).

## Reopen the selection

Open `/palette-preview.html` on the frontend development server, then select:

- Collection: **Preserved greens**
- Palette: **Evergreen / Citron**
- Typography: **Switzer only**

Source: [design studio](../frontend/public/palette-preview.html). Other palettes and font comparisons remain available; their presence does not change this selection.
