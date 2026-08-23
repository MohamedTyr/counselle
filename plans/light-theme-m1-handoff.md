# Light theme — Milestone 1 handoff

Scope: the token *definition* layer only (`frontend/src/styles/` + `frontend/src/index.css`).
No component files were touched. This doc is the design rationale, the
contrast evidence, and the M2 migration map.

## Scene → palette

*A high-school senior at a desk on a weekday afternoon, daylight through a
window, laptop open beside the Common App in another tab, mildly anxious,
checking deadlines and re-reading an essay draft.* Long repeated sessions,
document-centric, reading-heavy. That forces light — and it forces *quiet*
light, not bright/playful light: this is homework-adjacent stress, not a
consumer app moment.

## Color strategy

**Canvas:** true neutral, `--neutral-25` (OKLCH `99% 0 0`, chroma exactly
0) — not pure white. Not a naive inversion of the old dark shell's
lightness — the old shell was warm (`#171615`, low-chroma but hue ~40-60°),
and inverting its lightness while keeping that hue lands squarely in the
banned cream/sand band (`L 0.84–0.97, C < 0.06, hue 40–100`). True zero
chroma sidesteps the question entirely: there is no hue to read as warm.
`--neutral-25` rather than `--neutral-0` (white) is a deliberate 1-point
deviation, not a rounding choice: canvas needs headroom below white so
`--surface-raised` (true white) reads as genuinely elevated rather than
identical to the page it sits on — see "Surface stack," below.

**Accent — "plum":** one committed hue, deep aubergine at OKLCH hue 322°
(`--plum-600` ≈ `#6f3a78`), used sparingly (links, focus rings, primary
actions, the essay category tag) — never as a canvas color.

**Reflex-tier check:**
- *First-order* ("AI college-admissions workspace" → light + blue + rounded
  friendly cards): plum is not blue, and status blue is confined to the
  small "info" badge role, never the brand identity color. Fails the guess.
- *Second-order* ("not-blue admissions tool" → warm editorial cream +
  serif): canvas is true zero-chroma neutral, not cream; body type is the
  existing sans stack, serif is reserved for the essay document only (an
  existing, deliberate, pre-M1 choice, not a new "editorial" affectation).
  Fails the guess.

Plum was chosen over the more obvious "academic ivy green" precisely
*because* green is already spoken for as the `success` status color —
reusing it as the brand identity would make every success state look like
a brand accent and vice versa. Plum reads as premium/serious (jewel-tone,
not pastel) without colliding with any status semantic, and it's genuinely
uncommon as an app's primary hue.

## Sidebar decision (final — whisper-recessed, plum-tinted)

**The sidebar is light, like the rest of the app — no exception.** That
part hasn't changed since the previous round. What changed is the *tone*:
an 8.5 L-point, zero-chroma grey rail passed every contrast check and still
looked like default OS window chrome — a metric passing is a floor, not a
design. The fix is a whisper-recessed surface with a threshold-of-
perception plum tint, not a starker grey step.

`--chrome` is a new primitive, `--plum-25` (OKLCH `96.5% 0.01 322`) — 2.5
L points below `--canvas` (`--neutral-25`, `99% 0 0`), with just enough
chroma (0.01, against `--canvas`'s exact 0) to read as *designed* rather
than default grey, and nowhere near enough to read as "purple." **Correction
in this pass:** the first draft shipped at chroma `0.004` — measured
imperceptible across ~30 screenshots (false precision, not an actual tint).
Raised to `0.01`, still hue 322, still nowhere near the banned cream/sand
band (hue 40–100) at any chroma. Hue 322 — the same hue as the brand plum
ramp — keeps it out of that band regardless of how much chroma survives.
PRODUCT.md's *"let the sidebar establish the product identity and extend
that language across the app"* is now carried by that tint plus
hierarchy/placement (the brand plum shows up first in the sidebar —
active-chat indicator, resizer handle) rather than by a big tonal gap.

**Active-row idea, adopted:** with chrome this close to canvas/white,
`--chrome-active` (the selected nav row) resolves all the way to
`--neutral-0` — continuous with `--surface-raised`, so a selected chat item
reads as already part of the surface it's about to open, not just "darker
than its neighbors." `--chrome-hover` sits at `--neutral-50` (97.5% L) — a
small step *toward* canvas (99%) without landing exactly on it, between
`--chrome` (96.5%) and `--chrome-active` (100%) — a real three-step
progression (rail → hover nudges toward the canvas tone → active opens
into white), not an arbitrary hover tint. **Correction in this pass:** an
earlier draft of this doc claimed `--chrome-hover` resolved to
`--neutral-25` (99%, landing exactly on canvas); the shipped token is
`--neutral-50` (97.5%) — close to canvas, not identical to it. Fixed here
and in "Surface stack" below.

Full stack:

| Token | Primitive | OKLCH `L` | Role |
|---|---|---:|---|
| `--chrome` | `--plum-25` | 0.965 (C 0.01, H 322) | sidebar base surface |
| `--chrome-hover` | `--neutral-50` | 0.975 | row hover — a step toward the canvas tone, not identical to it |
| `--chrome-active` | `--neutral-0` | 1.00 | selected/active row — continuous with raised surfaces |
| `--chrome-border` | `--neutral-200` | 0.89 | outer border / interior dividers — barely there, see "Hairlines" below |
| `--chrome-ink` | `--neutral-800` | 0.26 | primary nav/chat-title text |
| `--chrome-ink-secondary` | `--neutral-700` | 0.35 | chat history titles |
| `--chrome-ink-muted` | `--neutral-600` | 0.44 | group labels ("Today"/"Yesterday") |
| `--chrome-ink-strong` | `--neutral-950` | 0.11 | hover/active emphasized text |
| `--on-chrome-active` | `--neutral-950` | 0.11 | text on `--chrome-active` |

**Chrome-ink × chrome-surface pairing table** (computed with the same
OKLCH→linear-sRGB→WCAG script referenced in "Contrast table" below — the
table this section's "full pairing table is in..." cross-reference in
semantic.css points to; it didn't exist until this pass, added here rather
than left as a dangling claim):

| Ink role | vs. `--chrome` | vs. `--chrome-hover` | vs. `--chrome-active` |
|---|---:|---:|---:|
| `--chrome-ink` (`--neutral-800`) | 13.99 | 14.46 | 15.54 |
| `--chrome-ink-secondary` (`--neutral-700`) | 10.18 | 10.52 | 11.31 |
| `--chrome-ink-muted` (`--neutral-600`) | 6.99 | 7.23 | 7.77 |
| `--chrome-ink-strong` / `--on-chrome-active` (`--neutral-950`) | 18.42 | 19.03 | 20.46 |

All four clear 4.5:1 on every chrome surface they render on, same as the
canvas ink tiers — no collapse, confirming the "no change was needed there"
call in semantic.css's ink-hierarchy comment.

**Consequence withdrawn (still true, now for a different reason):** neither
draft has `--chrome` and `--ink` sharing a primitive. `--chrome` is now
`--plum-25` (a distinct primitive from the neutral ramp entirely), `--ink`
is `--neutral-900`. Don't read a unifying coincidence into this family.

**Containment check (per the coordinator's ask, re-run for this round):**
the fix is a `semantic.css`-only edit to the `--chrome*` block, plus one
new primitive (`--plum-25`) added to the existing plum ramp in
`primitives.css` — no restructuring there, just one more step. `shell.css`
needed zero structural changes (all 15 `--shell-sidebar-*` tokens still
resolve through the identical `--chrome-*` names); the scrollbar-thumb
opacity and resizer shade were retuned again, because those are
alpha-compositing/shade facts about the *current* chrome lightness, not
part of the semantic contract, and chrome's lightness moved from 89% to
96.5% between rounds. Full numbers below.

## Surface stack (full, in L order)

The coordinator asked for this at a glance. Darkest to lightest:

| Surface | Token | Primitive | OKLCH `L` |
|---|---|---|---:|
| Wells / inputs (recessed) | `--surface-sunken` | `--neutral-100` | 0.955 |
| Sidebar rail | `--chrome` | `--plum-25` | 0.965 (C 0.01, H 322) |
| Sidebar hover | `--chrome-hover` | `--neutral-50` | 0.975 |
| Workspace canvas | `--canvas` | `--neutral-25` | 0.99 |
| Sidebar active / Cards, popovers, dropdowns | `--chrome-active` / `--surface-raised` / `--surface-overlay` | `--neutral-0` | 1.00 |

`sunken < chrome < chrome-hover < canvas < raised` holds as asked, with
`chrome-active` landing exactly on `raised` — deliberate (see "Sidebar
decision" above), not a coincidence left unexamined. **Correction in this
pass:** an earlier draft of this table put `--chrome-hover` at the same
row as `--canvas` (`--neutral-25`, 0.99) with the claim "chrome-hover
lands exactly on canvas." The shipped token is `--neutral-50` (0.975) — a
real intermediate step between `--chrome` (0.965) and `--canvas` (0.99),
not identical to either. See "Sidebar decision" above for the corrected
rationale.

## Ink hierarchy — rebuilt as a real defect fix

The previous round collapsed `--ink-muted`, `--ink-faint`, and
`--ink-placeholder` onto the same primitive (`--neutral-600`) — three
hierarchy roles satisfying one 4.5:1 check instead of three genuinely
different legibility tiers. Rebuilt as four distinct steps (`--ink`
through `--ink-faint`/`--ink-placeholder`), each checked against every
surface it actually renders on, not sampled:

| Ink role | Primitive | vs. `--canvas` | vs. `--surface-raised`/`overlay` | vs. `--surface-sunken` |
|---|---|---:|---:|---:|
| `--ink` | `--neutral-900` | 18.72 | 19.27 | 16.90 |
| `--ink-secondary` | `--neutral-700` | 10.99 | 11.31 | 9.92 |
| `--ink-muted` | `--neutral-600` | 7.55 | 7.77 | 6.81 |
| `--ink-faint` | `--neutral-550` *(new primitive)* | 5.35 | 5.51 | 4.83 |
| `--ink-placeholder` | `--neutral-550` (shares `--ink-faint`) | 5.35 | 5.51 | 4.83 |
| `--ink-disabled` *(WCAG-exempt)* | `--neutral-400` | 2.80 | 2.88 | 2.53 |

All five non-exempt tiers clear 4.5:1 on every surface they render on —
`--ink-faint`/`--ink-placeholder` on `--surface-sunken` is the tightest
margin at 4.83, still a real pass, not a rounding-error one.
`--neutral-550` (`52% L`) is a new primitive — the ramp had a gap between
`--neutral-500` (55%, too light: would have landed at ~4.3:1 on sunken,
under the bar) and `--neutral-600` (44%, already spoken for by
`--ink-muted`). `--ink-disabled` stays visibly weaker than `--ink-faint`
(2.5–2.9 vs. 4.8+) on purpose — legible-as-disabled, not legible-as-body.

Applied the same audit to `--chrome-ink*` — already three genuinely
distinct steps (26% / 35% / 44% L) with no collapse, so no change was
needed there; full pairing table is in "Sidebar decision" verification
below.

## Hairlines vs. functional borders — split, not over-corrected

The previous round applied a 3:1 non-text bar to `--chrome-border`, a
decorative rail/canvas seam, and darkened it to `--neutral-500` — visibly
too heavy once chrome went whisper-light, and the wrong bar in the first
place. WCAG 1.4.11 covers boundaries that are interactive or the sole
signal of a state (form controls, focus indicators, toggle boundaries) —
not every hairline between two surfaces. Split into two named families in
`semantic.css` instead of one name doing both jobs:

- **Decorative** (`--hairline`, `--edge`, `--edge-strong`) — panel seams,
  card/dropdown/task-card borders, the document's paper edge, the
  chrome/canvas boundary. No contrast bar. Deliberately barely-there:

  | Pairing | Ratio | Note |
  |---|---:|---|
  | `--chrome-border` (`--neutral-200`) / `--chrome` | 1.25 | correct — decorative |
  | `--hairline` (`--neutral-150`) / `--canvas` | 1.19 | correct — decorative |
  | `--edge` (`--neutral-200`) / `--surface-raised` | 1.39 | correct — decorative (card/dropdown) |
  | `--document-border` (`--neutral-200`) / `--document` | 1.39 | correct — decorative (paper edge) |

- **Functional** (`--edge-control`, `--edge-control-strong` — new
  tokens) — the sole visible boundary of a form control: composer
  container, composer control chips, and (via the existing alias chains)
  profile fields and onboarding controls. These genuinely need 3:1:

  | Pairing | Ratio | Note |
  |---|---:|---|
  | `--edge-control` (`--neutral-500`) / `--surface-sunken` | 4.26 | resting control border |
  | `--edge-control` (`--neutral-500`) / `--surface-raised` | 4.85 | resting control border |
  | `--edge-control-strong` (`--neutral-600`) / `--surface-sunken` | 6.81 | focused/hover control border |
  | `--edge-control-strong` (`--neutral-600`) / `--surface-raised` | 7.77 | focused/hover control border |

  Before this split, `--workspace-composer-border`,
  `--workspace-composer-border-active`, `--workspace-composer-control-border`,
  and `--workspace-composer-control-hover-border` all pointed at the
  decorative `--edge`/`--edge-strong` (1.2–1.8:1 against their surfaces —
  a text field you can't see the edge of). Repointed to
  `--edge-control`/`--edge-control-strong` in `workspace.css`; every
  preserved name that aliases through these (`--profile-field-border`,
  `--profile-field-hover-border`, `--profile-field-focus-border`,
  `--onboarding-control-border`, `--onboarding-control-hover-border`)
  inherited the fix automatically through the existing alias chains —
  zero edits needed in `profile.css`/`onboarding.css`.

## Field-surface split — the "disabled-looking field" defect

The single most-reported visual defect once the shell went light: every
editable form field (profile fields, composer control chips) resolved
through `--surface-sunken` (`--neutral-100`, L 0.955) for its fill. On a
dark shell that read as a subtle recessed well; on a white
(`--surface-raised`, L 1.0) card it reads as **disabled**, not editable —
a 4.5-point tonal gap between "the card" and "the field on the card" where
none was intended.

Fixed by splitting the one overloaded surface role into two, both defined
in `semantic.css`:

- **`--field-surface`** (`var(--surface-raised)`, white) — the fill for an
  editable control sitting on a raised card: profile fields, composer
  control chips, and (via the existing alias chains) every
  `--profile-field-surface`/`--onboarding-control-surface` consumer.
  Crisp white, flush with the card it sits on, reads as actionable.
- **`--control-track`** (`var(--surface-sunken)`) — kept the *old*
  `--surface-sunken` value, but renamed for its actual job: the light,
  **inert** fill for things that are never editable-white — meter tracks,
  toggle/switch unchecked tracks, button-group separators, disabled fills.
  This is also the counterpart to the `--input` border/fill split below.
- **`--field-surface-canvas`** (`var(--surface-sunken)`, same value as
  `--control-track` today, but its own named token) — the fill for an
  editable control sitting directly on `--canvas` rather than a raised
  card. No current consumer resolves through this: every editable control
  audited for this milestone sits on a card or the composer's own raised
  surface, not bare canvas. Defined now as forward vocabulary rather than
  silently omitted, so a future canvas-level search/filter field has a
  named token to reach for instead of reinventing one or misusing
  `--field-surface` (which would render flush-white-on-near-white with no
  separation from the canvas at all).

`--workspace-composer-control-surface` was repointed from
`--surface-sunken` to `--field-surface`; every alias that chains through
it (`--profile-field-surface`, `--onboarding-control-surface`) inherited
the fix automatically. `--workspace-input` (a separate, pre-existing
token feeding `--activity-control-surface`) still resolves to
`--surface-sunken` directly — that one genuinely is an inert well, not an
editable field, so it was left alone.

## `--document-*` decision

The essay/document "paper" family was already the one light surface in the
old dark shell — it doesn't move. What changes is that its contrast device
(the only light rectangle in an otherwise-dark app) collapses now that the
shell is also light. Deliberate fix, three layers, no single one of which
would be enough alone:

1. **Tonal step:** `--document` is pure `--neutral-0` (white); the
   surrounding canvas is `--neutral-25` (99%, a hair off-white). Small but
   real — the same "headroom below white" relationship that makes
   `--surface-raised` read as elevated everywhere else (see "Surface
   stack" above).
2. **Hairline border:** `--document-border` = `--neutral-200` — decorative,
   1.39 against the paper (see "Hairlines vs. functional borders" above;
   this is deliberately not held to a 3:1 bar, the same way the chrome
   panel edge isn't). This also resolves the drift bug flagged in recon —
   `:root` had `oklch(0.895 0.003 250)` and `.dark` had `oklch(0.84 0.003
   250)` for the same token. Kept the lighter `:root` value; the `.dark`
   block itself is deleted along with the rest of its dead weight.
3. **Elevation:** the essay editor container already applies `shadow-sm` +
   the border in `EssayEditorRoute.tsx`/`EssayLibraryCard.tsx` (untouched,
   component-layer code) — those classes now compose with real tokens
   instead of a dark-shell-dependent illusion.

The essay document is the product's most important reading surface; "leave
it identical to the canvas" was explicitly ruled out and wasn't done.

## `.dark` block and the dark-mode runtime

Per the milestone brief, the `.dark { ... }` block (39/40 tokens
byte-identical to `:root`, one drifted) is deleted outright — not migrated,
not rebuilt. `@custom-variant dark (&:is(.dark *));` stays (component-level
`dark:` utility overrides, e.g. the shadow/highlight idiom in
`components/ui/button.tsx` etc., are untouched and still valid CSS), but
since there is no longer a `.dark` token override block, toggling to dark
via the existing theme-provider will **not** re-derive a dark palette — the
custom properties are identical either way, so dark mode now visually
equals light mode except for the small set of component-level `dark:`
shadow/highlight tweaks.

**Product direction (confirmed with the coordinator, supersedes the "left
for later" note in the first draft): Counselle is going single-theme
light, full stop — M2 does not rebuild a dark ramp.** The correct M2 task
is *removing* the now-dead dark/system runtime rather than resurrecting
it: the `d` keyboard shortcut in `theme-provider.tsx`, the
`prefers-color-scheme` media-query listener, the `Theme`/`ResolvedTheme`
three-way union (collapses to just "light"), the cross-tab `storage` sync
for a theme that no longer varies, and eventually the `.dark`
`@custom-variant` itself once the component-level `dark:` utility usages
are cleaned up alongside it. The token *architecture* stays theme-capable
regardless — primitives → semantic → family tiers mean a real second theme
(if the product ever wants one again) is a new primitive set plus a
re-pointed semantic layer, not a rewrite — but building that capability out
now would be speculative work against a product decision that's already
been made. Don't build it until it's asked for.

## Contrast table (WCAG, computed — not eyeballed)

Verified with a throwaway OKLCH→linear-sRGB→relative-luminance→contrast
script (Björn Ottosson's OKLab matrices; standard WCAG 2.x contrast
formula), re-run against the final canvas/chrome/ink values in this round.
The full ink×surface and chrome-ink×chrome tables are in "Ink hierarchy"
and "Sidebar decision" above (every text role × every surface it actually
renders on, not a sampled subset, per the coordinator's ask); this table
covers everything else — brand, status, categories, document.

| Pairing | Ratio | AA body (≥4.5) | AA large (≥3.0) |
|---|---:|:---:|:---:|
| brand (`--plum-600`) link / canvas | 8.02 | PASS | PASS |
| brand-hover (`--plum-700`) link / raised surface | 11.41 | PASS | PASS |
| on-brand / brand solid | 8.25 | PASS | PASS |
| on-brand / brand-hover solid | 11.41 | PASS | PASS |
| success-fg / success-surface | 9.59 | PASS | PASS |
| warning-fg / warning-surface | 11.35 | PASS | PASS |
| danger-fg / danger-surface | 8.84 | PASS | PASS |
| info-fg / info-surface | 8.92 | PASS | PASS |
| danger-fg / raised surface (popover banner) | 10.00 | PASS | PASS |
| neutral pill fg / neutral pill bg | 9.92 | PASS | PASS |
| lor category fg / surface | 8.53 | PASS | PASS |
| research category fg / surface | 8.34 | PASS | PASS |
| form category fg / surface | 8.15 | PASS | PASS |
| document ink / document paper | 19.27 | PASS | PASS |
| document-muted / document paper | 7.77 | PASS | PASS |

These rows are unaffected by this round's canvas/chrome changes (their
surfaces are independent status/document primitives) except the two brand
rows, re-checked against the new `--canvas` (99%, was 97.5%) and confirmed
to still pass — canvas got lighter, so brand text on it only gained
contrast (7.67 → 8.02).

**Scrollbar thumb and resizer, re-checked against the final `--chrome`
(96.5% L, was 89% in the previous round):**

| Element | Ratio | Note |
|---|---:|---|
| sidebar scrollbar thumb, resting: `color-mix(chrome-ink 55%, transparent)` over `chrome` (previous round's value) | 2.04 | Not actually wrong by the numbers, but visually heavier than intended against a much lighter track — retuned down anyway for the whisper aesthetic |
| sidebar scrollbar thumb, resting: `color-mix(chrome-ink 45%, transparent)` over `chrome` (final) | 1.72 | Deliberately subtle at rest |
| sidebar scrollbar thumb, hover: `color-mix(chrome-ink 60%, transparent)` over `chrome` (final) | 2.26 | Visibly brightens on interaction; decorative element, not held to 3:1 |
| resizer handle, `--plum-500` vs. `chrome` (previous round's value) | 5.27 | Too saturated/heavy for a whisper-light rail — retuned down |
| resizer handle, `--plum-400` vs. `chrome` (final) | 3.31 | Clears a non-text 3:1 comfortably without reading as an accent button |

No pairing in this round required a compromise below its bar — the one
real correction (beyond the sidebar tone itself) was `--chrome-border`,
which the previous round had wrongly forced to a 3:1-clearing
`--neutral-500` (3.49 against the old 89% chrome) by treating a decorative
seam as a functional boundary; see "Hairlines vs. functional borders"
above for the fix and why 1.25 is the *correct* number for that pairing,
not a failure.

## `--document-border` drift — resolved

See "`--document-*` decision" above: the lighter `:root` value (0.895) was
kept; the darker `.dark` value (0.84) is discarded with the rest of the
dead `.dark` block.

## `--chart-1..5` — deleted

Confirmed zero consumers via `rg` across `src/**/*.{ts,tsx}` (recon's
finding, re-verified). Removed from `primitives`-adjacent leaf definitions,
`shadcn.css`, and the `@theme inline` block in `index.css`.

## Bug fixed in passing

`--accent-foreground` (the shadcn generic hover-surface contract, used by
`components/ui/menu.tsx` etc. for `bg-accent text-accent-foreground`) used
to alias `--shell-sidebar-hover-foreground` — a near-white value correct
only against the old dark `--accent` background. `--accent` itself
resolves through `--workspace-surface-hover`, which is now a light
hover-tint surface; near-white text on a near-white surface would have
been unreadable. Repointed to `--ink`. Documented in `shadcn.css`.

## M2 vocabulary — old alpha-modifier pattern → new token

Recon found 144 lines of hand-tuned semantic-token alpha modifiers
(`bg-muted/20`, `ring-ring/50`, etc.), eyeballed against the old dark
backgrounds. Real samples pulled from the codebase, generalized into the
new semantic vocabulary M2 should migrate onto:

| Old pattern (examples found) | Replace with |
|---|---|
| `ring-ring/50`, `ring-ring/45`, `ring-ring/35`, `ring-ring/30` | `ring-[var(--focus-ring)]` (already opaque and calibrated — drop the opacity math) |
| `text-foreground/90`, `/85`, `/80`, `/75`, `/70` | `text-[var(--ink-secondary)]` or `text-[var(--ink-muted)]` depending on which tier the opacity was approximating |
| `text-muted-foreground/80`, `/60`, `/50`, `/45`, `/40` | `text-[var(--ink-muted)]` or `text-[var(--ink-faint)]` |
| `bg-muted/20`, `/25`, `/30`, `/35`, `/40`, `/50`, `/55`, `/60`, `/80` | `bg-[var(--surface-hover)]` (resting hover) or `bg-[var(--surface-active)]` (pressed) — pick by interaction, not by matching the old percentage |
| `border-border/50`, `/55`, `/60` | `border-[var(--edge)]` / `border-[var(--edge-strong)]` for decorative panel borders, or `border-[var(--edge-control)]` / `border-[var(--edge-control-strong)]` if the border is the sole visible boundary of a form control (see "Hairlines vs. functional borders" above) |
| `bg-accent/50` | `bg-[var(--surface-selected)]` (menu/list selected row) |
| `bg-input`, `bg-input/30`, `/32`, `/50` | `bg-[var(--control-track)]` — **not** `--surface-hover`. `--input` is a border-only token as of this pass (see the "`--input` split" subsection right after this table for the exact file:line consumer list); the inert-fill job these alpha modifiers were doing now has its own token, `--control-track`. |
| `bg-destructive/10`, `/90` | `bg-[var(--danger-surface)]` (banner tint) / `bg-[var(--danger-solid)]` with `color-mix` for a pressed state if actually needed |
| `border-destructive/30`, `/32`, `/50` | `border-[var(--danger-border)]` |
| `ring-destructive/20`, `/40` | `ring-[color-mix(in_oklch,var(--danger-solid)_40%,transparent)]` (destructive focus rings are the one case still worth an explicit alpha — no pre-baked "danger focus ring" token exists yet; add one in M2 if this shows up more than once or twice) |
| `text-destructive/85`, `/90` | `text-[var(--danger-fg)]` |
| `bg-secondary/80`, `/90`; `bg-primary/90` | `color-mix(in oklch, var(--surface-raised|--brand) N%, var(--neutral-900))`-style pressed states, or add `--brand-active`/`--surface-active` variants per-component if the exact percentage matters |
| `shadow-xs/5`, `shadow-sm/5`, `shadow-md/5`, `shadow-lg/5` | `shadow-[var(--elevation-1)]` / `--elevation-2` / `--elevation-3` per the component's actual elevation tier — these Tailwind alpha modifiers were approximating an elevation scale by hand; the scale now exists |
| `bg-background/95`, `/70` | `bg-[color-mix(in_oklch,var(--canvas)_95%,transparent)]` for a sticky-header fade, or `var(--overlay-scrim-subtle)` if it's actually a scrim |
| `divide-border/50`; `ring-border/80` | `divide-[var(--hairline)]`; `ring-[var(--edge-strong)]` |
| `border-input/30` (`command.tsx:69`), `border-input/75` (`UpcomingTasksView.tsx:143`) | `border-[var(--input)]` — drop the opacity math. `--input` is already the retuned, opaque functional-border value (`--edge-control`, ≈L 0.62, 3:1+ checked); these two alpha modifiers were hand-tuning it lighter/heavier against the old dark backgrounds, which the new resting/hover pair (`--input` / `--edge-control-strong`) already does correctly without an alpha hack. |
| `bg-black/10` (dialog scrim), `bg-black/32` (sheet scrim) | `bg-[var(--overlay-scrim-subtle)]` / `bg-[var(--overlay-scrim)]` |
| `shadow-black/[0.02]` (SourcesRail resting shadow) | `shadow-[var(--elevation-1)]` |
| `color-mix(in oklch, var(--shell-background) 60%, transparent)` (2 inline composer shadows, `AiComposer.tsx:135`, `ChatComposer.tsx:152`) | `var(--elevation-2)` — **not fixed in M1** (component file, out of token-layer scope), but the exact fix used for the 5 equivalent tokens that *were* in `index.css`. Flag as the first thing to touch in M2; will currently render as a faint/near-invisible shadow since it still mixes a now-light `--shell-background`. |
| `text-yellow-600`, `text-blue-600`, `text-green-600`, `text-orange-600`, `text-red-600` (`ai-elements/tool.tsx` status icons) | `text-[var(--warning-solid)]`, `text-[var(--info-solid)]`, `text-[var(--success-solid)]`, an amber/danger split for "denied" vs "error" (`--warning-solid` / `--danger-solid`), `text-[var(--danger-solid)]` |

### `--input` split — the exact consumer list for M2

shadcn's `--input` was doing two unrelated jobs: a border color
(`border-input`) and a solid fill (`bg-input`). `shadcn.css:47` used to set
`--input: var(--edge-control)` directly, which is correct for the border
job but meant every `bg-input`/`bg-input/NN` consumer — meter tracks,
switch/toggle unchecked tracks, button-group separators — rendered as a
dark ≈L 0.62 slab instead of a light inert fill. This pass keeps `--input`
border-only and gives the fill job its own token, `--control-track`
(`var(--surface-sunken)`, semantic.css). **Component files are Wave 2's
job, not this pass's** — recorded here so Wave 2 doesn't have to
rediscover the list:

- **Border (`border-input`) — no change needed, already correct:**
  `components/ui/input.tsx:40`, `textarea.tsx:26`, `select.tsx:20`,
  `checkbox.tsx:17`, `radio-group.tsx:27`, `input-group.tsx:17`,
  `badge.tsx:33`, `button.tsx:39,44`. All already resolve through `--input`
  → `--edge-control`; nothing to migrate here.
- **Fill (`bg-input`) — migrate to `bg-[var(--control-track)]`:**
  `components/ui/meter.tsx:47` (meter track), `menu.tsx:158`
  (`data-unchecked:bg-input`, switch track), `button-group.tsx:72`
  (separator).
- **Fill, alpha-modified — migrate to `bg-[var(--control-track)]`, drop the
  opacity:** `command.tsx:69` (`bg-input/30`, paired with the
  `border-input/30` noted in the mapping table above), `input-group.tsx:17`
  (`has-disabled:bg-input/50`).

General migration rule for M2: don't try to preserve the old opacity
percentage. Each one was tuned by eye against a dark background and the
percentage is not meaningful in the new palette — pick the semantically
closest new token (hover vs. active vs. selected vs. disabled; ink tier by
reading role, not by matching the old alpha number) and eyeball-verify
against the actual light surface once, the same way this milestone's
ramps were calibrated against the contrast script rather than by matching
old percentages.

## Verification results

Re-run in full after the whisper-recessed sidebar correction (canvas →
`--neutral-25`, chrome → `--plum-25`, rebuilt ink hierarchy, split
decorative/functional borders) — all results below are post-fix.

- `npm run typecheck` (`tsc --noEmit`): clean.
- `npm run lint`: 2 pre-existing errors, both in files this milestone never
  touched (`components/ui/onboarding-setup.tsx`, `features/ai-chat/
  components/CitationRenderer.tsx`) — confirmed identical with `git stash`
  applied against this change. Zero lint issues introduced.
- `npm run build` (`tsc -b && vite build`): `tsc -b` fails on pre-existing,
  unrelated type errors (`ClarifySpec`/`ClarifyResponseV2` mismatches in
  `features/ai-chat/*`, an `EssaySummary` shape mismatch in
  `api/workspace/*`) — confirmed identical with `git stash` applied. These
  predate this branch's CSS work entirely.
- `npx vite build` (the actual CSS/Tailwind pipeline, bypassing the
  unrelated `tsc -b` failure above): **succeeds**. This is the meaningful
  signal for a token-layer-only milestone; the Tailwind `@theme` → utility
  generation, all imports, and every token resolve without error.
- Zero color literals outside `styles/primitives.css`, confirmed via `rg`
  for hex/rgb/hsl/oklch across `styles/*.css` and `index.css`.
- `npm run dev`: starts clean, serves `index.css` over HTTP 200, no CSS
  compile errors in the dev-server log. Inspected the served CSS directly:
  `--canvas: var(--neutral-25);` and `--chrome: var(--plum-25);` (the
  semantic layer correctly stays a `var()` reference, not an inlined
  value — only `primitives.css` entries serve literals, confirmed
  alongside: `--plum-25: oklch(96.5% 0.01 322);` — chroma `0.01`, raised
  from an initial `0.004` draft that measured imperceptible across ~30
  screenshots; see "Sidebar decision" above).

## Left for later milestones

- **M2 (component migration):** the 144-line alpha-modifier sweep (table
  above), the two inline composer shadow literals in `AiComposer.tsx` /
  `ChatComposer.tsx`, the `ai-elements/tool.tsx` raw Tailwind palette
  classes, and a manual visual pass over every `dark:`/`not-dark:` usage
  now that the underlying tokens actually differ from before.
- **Dark/system theme runtime removal (not a dark-mode rebuild):** see
  "`.dark` block and the dark-mode runtime" above — product direction is
  single-theme light, so M2 removes the now-dead toggle/shortcut/media-
  query-listener/three-way `Theme` union rather than building a new dark
  ramp.
- **`public/onboarding/*.svg` and `public/landing.html`:** both bake the
  old dark palette as static hex values outside the token system entirely
  (recon §8) — untouched, need their own design pass.
- **Shiki code-block themes and `sonner` toast theming:** already
  dual-theme-correct per recon §3/§6, nothing to do.
- A `--danger-focus-ring` (or similar) token doesn't exist yet — every
  `ring-destructive/NN` instance found in recon can fall back to a
  `color-mix()` of `--danger-solid` for now; add a named token in M2 if the
  pattern recurs more than once or twice.
