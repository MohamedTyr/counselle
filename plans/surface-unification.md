# One grey

## The complaint

> "in some components there is a color in the background of the component, then there is
> a different color in the background of the component that is on top of the background,
> but in another component, it doesn't follow the same pattern or colors. also the
> fucking grey colors used are shit, i want grey colors that LOOK GOOD, on the background
> we have."

Two complaints, two different causes, both confirmed by measurement rather than reading.

## Measured before

### The greys were not too many levels — they were too many colours

Every neutral surface actually painted on a rendered page, read out of
`getComputedStyle` at 1440×900:

| L     | hue     | primitive       | role                             |
| ----- | ------- | --------------- | -------------------------------- |
| 1.000 | — (C 0) | `--neutral-0`   | card, popover, dialog, document  |
| 0.989 | 49      | `--sand-25`     | the page ground                  |
| 0.982 | 85      | `--stone-50`    | the sidebar rail                 |
| 0.963 | 70      | `--sand-90`     | the task board's lane trough     |
| 0.955 | 0       | `--neutral-100` | the tab track, the "sunken" well |
| 0.951 | 77      | `--sand-100`    | the label chip                   |
| 0.948 | 46.55   | `color-mix`     | a computed hover one-off         |

**Seven near-white surfaces spanning 5.3 lightness points across six hues.** Adjacent
pairs sit under a lightness point apart, so none of them reads as a _step_ — but the hue
swings up to 85 degrees between them, so they do read as a _temperature change_. That is
the whole of "the greys look shit": a cold chroma-0 tab track inside a warm hue-77 card on
a warm hue-49 page is not a level, it is a smudge. Worse, the stack changed hue mid-depth
— the board trough at hue 70 with the well directly under it at hue 0 — so depth and
temperature disagreed.

Borders had the same disease: six values across three hues (0.93 at C 0, 0.90 at hue 85,
0.89 at C 0, 0.866 at hue 77, 0.78 at hue 77, 0.62 at C 0). The Schools page alone drew
chroma-0 hairlines between its table rows, hue-77 borders around the chips in those rows,
hue-77 borders around the buttons above them and chroma-0 borders around the fields beside
those. Four weights, three temperatures, one page.

Forty distinct neutral primitive steps were in use across three ramps. Eight of them had
zero consumers.

### The nesting had no rule at all

The same nesting depth — the main panel of a route — rendered four different ways:

| Route      | main panel                           | vs. the page                         |
| ---------- | ------------------------------------ | ------------------------------------ |
| Tasks      | lane, L 0.963                        | a step **down**                      |
| Activities | list card, L 0.963 **plus a border** | a step **down**, holding white cards |
| Profile    | form card, L 1.000                   | a step **up**                        |
| Schools    | table, L 1.000                       | a step **up**                        |
| Essays     | panel, no fill at all                | a border and nothing else            |

Five routes, four answers to "what colour is the box on the page". Activities was drawing
a bordered, inset-coloured outer box containing bordered raised cards — three rounded
frames nested inside one another, every one within four lightness points of the next.

Two more specifics worth naming:

- **`--canvas` was also used as a depth-4 chip fill.** An element four levels deep was
  painted the same as the page behind it.
- **The border hierarchy was inverted.** `--edge-control` (L 0.62) is the field border;
  `--edge` (L 0.89) is the card border that contains those fields. The Profile page
  rendered forty of the former inside one of the latter — the thing inside was the loudest
  mark on the page and the thing containing it was the quietest, so a form on a card read
  as a wireframe.

## The rule

**One ramp. Four surfaces. Depth follows what the container does, never who owns it.**

### One ramp, flat hue 50

`--neutral`, `--sand` and `--stone` are merged into `--gray-*`, thirteen steps, hue
constant end to end, chroma rising through the middle and tapering at both ends.

Hue 50 is a choice, not a compromise between the three it replaces. At the top of the ramp
hue is invisible — every candidate from 25 to 85 renders within a hair of `#fdfbf9` at
L 0.984 — so it is decided where it is actually visible, the middle and the bottom. At
L 0.70: hue 25 gives `#a99a99` (pink-grey), hue 85 gives `#a49e92` (khaki), hue 50 gives
`#a89c94`, a warm taupe. Taupe is what belongs beside a wine brand at hue 15; khaki is 70
degrees off it and fights it. This is the house rule applied — tint the neutral toward the
_brand's_ hue, never "toward warm" by default — and it lands the page ground within one
degree of where `--sand-25` already was, so the app the product already looks like does not
move.

Nothing is painted pure white at rest any more. `--surface-raised` is `--gray-25`
(`#fffdfc`), because a chroma-0 card on a warm page is the single cool object in the frame.

### Four surfaces

| Role               | Is                                                          | Takes                      |
| ------------------ | ----------------------------------------------------------- | -------------------------- |
| `--surface-raised` | an object ON the page; carries content                      | `--edge` + `--elevation-1` |
| `--canvas`         | the page                                                    | nothing                    |
| `--chrome`         | the sidebar rail                                            | `--edge` on its seam only  |
| `--surface-inset`  | a well cut INTO a surface; holds or recesses something else | **no border, no shadow**   |

Steps are 1.1 / 1.2 / 1.7 lightness points. The rail in particular gains a real step: it
sat 0.7 points under the canvas at a different hue, so its separation was carried almost
entirely by the 1px border.

**A page has exactly one raised level. A card never contains a card.** Two legal shapes: a
**list** (one raised panel, hairline-divided rows) and a **board** (a borderless inset
trough holding raised cards).

### Four borders

`--hairline` (a divider _within_ a surface), `--edge` (the perimeter _of_ a surface),
`--edge-strong` (that perimeter hovered), `--edge-control` (the sole boundary of a bare
field, the only one held to a contrast bar). Nine alias tokens — `--edge-panel`,
`--edge-panel-strong`, `--edge-button`, `--edge-button-strong` and the rest — now resolve
onto those four instead of carrying values of their own.

### One state rule

Hover is 4% of `--gray-900` mixed into whatever surface the element sits on; pressed is 7%.
Those two percentages land within a tenth of a lightness point of the same perceived step
on all four levels (2.9 / 2.8 / 2.8 / 2.7 for hover), which is why one rule covers the app
and hand-tuned `bg-muted/40`-style modifiers never did — a translucent fill is a value that
changes depending on what happens to be behind it.

## Status — landed

### Measured after

Every neutral surface and border painted on every page, same method as before:

| Page       | surfaces                      | borders             |
| ---------- | ----------------------------- | ------------------- |
| Schools    | 0.995 · 0.984 · 0.972 · 0.955 | 0.905 · 0.86 · 0.62 |
| Activities | 0.995 · 0.984 · 0.972 · 0.955 | 0.905 · 0.86 · 0.62 |
| Profile    | 0.995 · 0.984 · 0.972 · 0.955 | 0.905 · 0.86 · 0.62 |
| Essays     | 0.995 · 0.984 · 0.972         | 0.905 · 0.86        |
| Tasks      | 0.995 · 0.984 · 0.972 · 0.955 | 0.86 · 0.62         |
| AI         | 0.995 · 0.984 · 0.972 · 0.955 | 0.86                |

**Every value on every page is one of the four surface steps or one of the border steps,
all at hue 50.** Seven surfaces at six hues became four at one; six borders at three hues
became four at one. `--edge-strong` appears only on hover, which is why it is absent from a
resting snapshot.

### Contrast, all computed rather than eyeballed

Ink on all four surfaces (raised / canvas / chrome / inset):

| tier              |       |       |       |                    |
| ----------------- | ----- | ----- | ----- | ------------------ |
| `--ink`           | 14.41 | 13.96 | 13.48 | 12.81              |
| `--ink-secondary` | 8.37  | 8.10  | 7.82  | 7.44               |
| `--ink-faint`     | 5.45  | 5.28  | 5.10  | 4.85               |
| `--ink-disabled`  | 2.64  | 2.56  | 2.47  | 2.35 (WCAG-exempt) |

`--edge-control` clears its 3:1 bar on all four (3.61 / 3.49 / 3.37 / 3.21). Brand and all
three status hues stay above 6:1 everywhere. No step clips sRGB.

**Three tiers of sidebar text were below the 4.5:1 floor and are not any more.** The group
eyebrow (3.07), the account email (3.46) and the muted rail icons (3.75) were carried
verbatim from a design doc, with a warning attached in three files telling everyone not to
reuse them. They measure 5.10:1 now. There is no exempt tier left in the app besides
disabled, and the warning is deleted rather than re-sited.

### Changed

**Token layer**

- `primitives.css` — `--neutral-*`, `--sand-*` and `--stone-*` deleted; one `--gray-*` ramp
  at hue 50 in their place. Forty steps in use became thirteen. `--wine-25` and `--wine-150`
  deleted (zero consumers). Pure white and pure black moved out of the ramp and named for
  what they are (`--gray-0` is ink on a saturated fill, `--gray-1000` is the scrim base).
- `semantic.css` — the surface block rewritten as the four-level ladder plus contract
  aliases; the edge block cut from six values to four; the ink ladder cut from five tiers
  to four (`--ink-secondary` at L 0.42 and `--ink-muted` at L 0.45 were a rounding error
  that two names had been arguing over — `--ink-muted` is now an alias). `--edge-panel-soft`
  deleted. `--field-surface` moved from raised to inset so a field is a well cut into its
  container rather than the same fill as it. Added `--brand-chip`/`--brand-chip-ink` and
  `--on-brand-quiet`.
- `elevation.css`, `shell.css` — repointed; stale comments describing the old ramps and a
  brand two brands ago rewritten.
- `workspace.css` — the task card's hover was resolving to its own resting fill after the
  collapse (fixed); its border moved from a hairline alias to `--edge`, the one perimeter
  weight every container uses.
- `activity.css` — the list container's border to `transparent` (it is a trough, and a
  trough that draws a rim is the nested-card shape); the chip from raised to inset, matching
  `--school-filter-chip-surface`, so two features stop having two answers for one object.
- `onboarding.css` — the frame from `--canvas` to `--surface-raised`; the frame, the page
  behind it and the caption beside it were three names all resolving to the same value.

**Components**

- `tabs.tsx` — the active indicator was `bg-background`, i.e. the canvas colour used as a
  raised object inside an inset track. Now `--surface-raised` with `--elevation-1`.
- `button.tsx` — `outline` and `destructive-outline` were filled with `bg-popover`. A button
  is not a popover; both now resolve to `--surface-raised`.
- `UpcomingTasksView.tsx` — raised cards were sitting directly on a raised `<Card>`. The
  panel holding them is an inset tray now, which is the board shape the task board already
  uses.
- `ActivitiesRoute.tsx` — one container slot was rendering three different fills across its
  list, empty and error states (`--activity-list-surface`, `--control-track`, `bg-card`).
  One fill.
- `SchoolsRoute.tsx` — `bg-white/15`, the last hardcoded colour literal outside
  `primitives.css`, replaced with `--on-brand-quiet`. It also silently depended on the
  button staying the dark variant.
- `AppSidebar.tsx` — was reaching straight at `--wine-100` and `--wine-ink-on-100`, the only
  tier violation left in the codebase. Resolves through `--brand-chip` now.
- `artifact.tsx`, `code-block.tsx`, `SourcesRail.tsx`, `TaskBoard.tsx` — every
  opacity-modified surface (`bg-muted/50`, `bg-muted/80`, `bg-card/95`, `bg-ring/12`)
  replaced with a named role. The only `/NN` fill left in the app is `bg-foreground/4`, a
  browser-autofill state.

**Docs** — `styles/README.md` gained a third law (the surface ladder, its two legal shapes,
and the one state rule) and its ramp table rewritten from seven ramps to five.

### Verified

- `tsc --noEmit -p tsconfig.app.json`: no error in any file touched. The same six files
  error as before this pass (`essay-prompt-drafts`, `hook-utils`, `AiChatPage`,
  `ClarifyWidget`, `turn-reducer`, `sidebar-icons`).
- `vitest run`: 874 passing, the same 3 pre-existing failures in `ChatSessionList.test.tsx`
  and `auth-routes.test.tsx`.
- `eslint --max-warnings 0` and `prettier` clean on every changed file.
- Zero primitive references outside `primitives.css`; zero primitive references from any
  `.tsx`.
- Rendered-value enumeration on all six routes (table above), plus visual review of each at
  1440×900.

### Not done

`DESIGN.md` at the repo root still documents **Wise's** lime-green brand (`#9fe870`) and
Wise Sans — a design-extraction artefact from another project. Nothing reads it, so it
changes no pixels, but it is now actively misleading: the `impeccable` skill loads it as
this project's design system on every invocation. Regenerating it from the actual code is
an `$impeccable document` run.
