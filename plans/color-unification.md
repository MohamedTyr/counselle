# One palette

## The complaint

> "the number of different colors we have is just a lot for no reason... the colors of
> the tasks components is different from those of the essays, from those of the schools,
> from those of the activities. i want one set of colors."

Correct on both counts, and the two halves have different causes.

## Measured before

Nine chromatic ramps ship (`primitives.css`), plus the achromatic neutral:

| Ramp | Hue | Where it lands |
|---|---|---|
| wine | 15 | brand — sidebar, CTA, focus ring, selection |
| red | 25 | danger |
| amber | 80 | warning |
| leaf | 143 | success |
| blue | 250 | info |
| plum | 322 | **task category "Essay" — nothing else in the app** |
| mauve | 305 | **task category "LOR" — nothing else in the app** |
| teal | 190 | **task category "Research" — nothing else in the app** |
| slate | 235 | **task category "Form" — nothing else in the app** |

Four whole ramps (12 primitive steps) exist to tint four pills on one page.

### The same hue means four different things

| Hue | Tasks | Schools | Activities |
|---|---|---|---|
| amber | priority `Med` · status `Waiting` · category `Aid` | list type `Reach` · status `Deferred`/`Waitlisted` · Explore verdict band | `N not ready` |
| leaf | priority `Low` · status `Done` · assignee `Counselle` | list type `Safety` · status `Submitted`/`Accepted`/`Enrolled` | `N paste-ready` |
| blue | status `Doing` · category `Interview` | list type `Target` · status `Applying` | — |
| red | priority `High` · overdue · "Too full" | status `Rejected` · deadline passed | `N over limit` |

Green means "done", "low priority", "assigned to the agent" and "safety school". A single
row of the task table renders three unrelated hues side by side (`Doing Now` blue,
`Essay` plum, `High` red) and the table as a whole renders seven.

### The structural cause

`components/ui/badge.tsx` — the app-wide primitive — resolves `default`, `secondary`,
`info`, `success` and `warning` through `--task-*-pill-*`. Every badge on Schools,
Essays, Activities and Profile therefore takes its colour from the **Tasks feature's
private lane tokens**. The shared component is owned by one page. That is the tier
inversion behind "every screen has its own set".

`--school-verdict-*` (12 tokens in `schools.css`) has zero consumers — the fit ladder
renders through Badge variants instead, i.e. through Tasks.

## The rule

**A hue is a claim about state. A label is not a state.**

Everything follows from that:

- **Categories** (Essay / LOR / Aid / Research / Form / Interview / Other) are labels.
  The chip already says the word; there is no task where you scan for "the teal one".
  → one neutral chip, seven times.
- **Priority** (High / Med / Low) is an ordered scale, not three categories. Only the
  alarm end earns a hue. → High is danger, Med and Low are neutral.
  ("Low priority = green" was reading as "low priority = done".)
- **Status** is a genuine state → keeps its hue.
- **Fit** (Reach / Target / Safety) is an ordered scale. Ordered data takes one hue at
  three intensities, never three categorical hues. → the row label goes neutral (the
  word is right there, in its own column); the balance bar — the one place three
  segments must be told apart and where the quantity is the point — takes three steps
  of the brand ramp, the same licence `--essay-library-progress-fill` already has.

## The one palette

Five identities. Each means exactly one thing, on every screen.

| Role | Ramp | The one meaning |
|---|---|---|
| `--brand-*` | wine 15 | identity · the primary action · the current selection · quantity |
| `--danger-*` | red 25 | overdue · error · destructive |
| `--warning-*` | amber 80 | waiting on someone · not ready · needs you |
| `--success-*` | leaf 143 | done · complete · submitted · ready |
| neutral | stone / sand | everything else — every label, every category, every in-progress state |

Deleted: `--blue-*`, `--plum-*`, `--mauve-*`, `--teal-*`, `--slate-*` — five ramps,
16 primitive steps, and the `--info-*` and `--category-*` semantic roles built on them.

**`info` goes because "in progress" is the default state of everything in this app**, and
colouring the default state is precisely what turns a page into a rainbow. A task that is
`Doing` is already in the Doing lane; a school you are `Applying` to is the ordinary case.

## Status — landed

### Measured after

Every chromatic value actually rendered, read out of `getComputedStyle` on each
page at 1440×900 (Chromium keeps these in OKLCH, so the hue is the third channel):

| Page | Hues rendered |
|---|---|
| Tasks (All) | 15, 25, 80, 143 |
| Schools · My list | **15 only** — seven lightness steps of one hue |
| Schools · Explore | 15, 80 |
| Activities | 15, 80, 143 |
| Essays | 15 |
| Profile | 15 |

Four hues across the whole app, down from nine, and no page renders one that
another page doesn't have a reason to. My list is now a single-hue page: the
balance bar's three ordered steps (L 0.38 / 0.60 / 0.75 at H 15) plus the brand.

### Changed

**Token layer**
- `primitives.css` — deleted `--blue-*`, `--plum-*`, `--mauve-*`, `--teal-*`,
  `--slate-*` (16 steps). Six ramps left: neutral, sand, stone, wine, red,
  amber, leaf.
- `semantic.css` — deleted the `--info-*` role and the twelve `--category-*`
  roles. Added `--brand-scale-1/2/3` (ordered data) and `--label-surface/-ink/
  -border` (categorical data). Label ink measures 7.33:1 on its own fill and
  8.46:1 on white; the fit scale's lightest step is `wine-300`, not `wine-200`,
  because the legend draws these as swatch dots on the page and wine-200 lands
  at 1.51:1 against canvas.
- `task.css` — deleted the 21 `--task-category-*` tokens. `doing` pill goes
  neutral, `doing` dot goes brand.
- `schools.css` — deleted the 12 dead `--school-verdict-*` tokens; the balance
  bar moves onto `--brand-scale-*`.
- `workspace.css`, `shadcn.css`, `theme.css` — `--info` pair removed at every
  tier rather than left dangling.

**Components**
- `badge.tsx` — every variant now resolves through `semantic.css` instead of
  `--task-*-pill-*`. This is the structural fix: the app-wide badge was owned
  by the Tasks feature. The `info` variant is gone.
- `task-config.ts` — one `CATEGORY_CHIP` for all seven categories; `low`/`med`
  priority and `counselle` assignee off their status hues.
- `schools-config.ts` — `Applying` off blue, the whole fit ladder to neutral.
- `essay-display.ts` — `Drafting` off blue.
- **Deleted `components/ai-elements/tool.tsx`** — zero importers, and the only
  file in the codebase carrying stock Tailwind palette classes
  (`text-yellow-600`, `text-blue-600`, `text-green-600`, `text-orange-600`,
  `text-red-600`): a sixth palette hiding in dead code.

**Docs** — `styles/README.md` gained a second law ("a hue is a claim about
state, and each hue makes exactly one claim") with the role table, the two
corollaries that were violated, and a warning that adding a ramp is the most
expensive change available.

### Verified

- `tsc --noEmit -p tsconfig.app.json`: no error in any touched file. The six
  files that still error (`essay-prompt-drafts`, `hook-utils`, `AiChatPage`,
  `ClarifyWidget`, `turn-reducer`, `sidebar-icons`) errored before this pass.
- `vitest run`: 874 passing. The same 3 failures in `ChatSessionList.test.tsx`
  and `auth-routes.test.tsx` that were failing before this work.
- `eslint`/`prettier` clean on every changed file.
- Zero console errors on reload of all six pages.

### Not done

`DESIGN.md` at the repo root is stale — it documents Wise's lime-green brand
(`#9fe870`) and Wise Sans, i.e. a design-extraction artefact from another
project, not Counselle. Nothing reads it, so it changes no pixels, but it will
mislead the next agent that runs `$impeccable`. Regenerating it from the actual
code is a `$impeccable document` run, not part of this pass.
