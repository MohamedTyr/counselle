# Token layer

Four strict tiers. Never skip a tier — a family file resolving straight to
a primitive (bypassing semantic.css) is a bug, not a shortcut.

1. **`primitives.css`** — raw OKLCH ramps. Named by scale position, never by
   usage. **This is the only file in the codebase allowed a color literal**
   (hex/rgb/hsl/oklch with numeric channels — the CSS keywords
   `transparent`/`currentColor` don't count, use them anywhere). Enforce by
   grepping: any color literal found outside this file is a bug.

   **Five ramps — one neutral, four chromatic — and that is the whole
   palette:**

   | Ramp        | Hue | What it is                                         |
   | ----------- | --- | -------------------------------------------------- |
   | `--gray-*`  | 50  | every surface, every border and every word of text |
   | `--wine-*`  | 15  | the brand                                          |
   | `--red-*`   | 25  | danger                                             |
   | `--amber-*` | 80  | warning                                            |
   | `--leaf-*`  | 143 | success                                            |

   `--blue-*`, `--plum-*`, `--mauve-*`, `--teal-*` and `--slate-*` were
   deleted in the palette pass; `--neutral-*` (chroma 0), `--sand-*` (hue
   49/77) and `--stone-*` (hue 85) were merged into `--gray-*` in the
   surface pass. Forty distinct neutral steps became thirteen.

   **Adding a ramp is the single most expensive change you can make to this
   system.** The four wayfinding hues each existed to tint one pill on one
   page, and between them they cost every status colour its meaning. The
   three neutral ramps cost something subtler and worse: they put six
   different hues inside a five-lightness-point band, so the app's greys
   read as slightly dirty rather than as levels. If you think you need a new
   hue, you almost certainly need `--label-*` (categorical) or
   `--brand-scale-*` (ordered) instead. If you think you need a new grey,
   you need one of the four surface roles in tier 2.

2. **`semantic.css`** + **`elevation.css`** — role tokens. Every value is a
   `var()` onto a primitive, or a `color-mix()` of two such vars. Two
   independent naming zones live in `semantic.css`: the workspace canvas
   (`--canvas`/`--surface*`/`--ink*`/`--edge*`/`--brand*`) and the sidebar
   chrome (`--chrome*`) — same ramp, the chrome one step recessed below
   canvas. `elevation.css` holds the shadow scale (`--elevation-0..3`) and
   the z-index scale (`--z-*`).

3. **Component/feature families** — `shell.css`, `workspace.css`,
   `task.css`, `onboarding.css`, `activity.css`, `essay.css`, `profile.css`,
   `shadcn.css`. Every value here is a `var()` onto tier 2 (or another
   token in the same tier — the existing alias chains, e.g.
   `--task-doing-card: var(--task-todo-card)`, are fine and expected).
   **Never** reference a primitive directly, never a literal — if you find
   yourself reaching for a primitive from a family file, that's the signal
   a semantic role is missing; add it to tier 2, don't reach past it. Split
   a family into more than one file once it passes ~300 lines.

4. **`theme.css`** — the Tailwind v4 `@theme inline` block: the
   utility-class binding (`bg-primary`, `border-border`, ...). A plain
   imported file like every other tier; `index.css` imports it last.

`index.css` orchestrates: imports tiers 1–4 in order, then the base layer
and the small set of component classes that don't fit the token system
(sidebar scroll affordances, markdown vertical rhythm, the ProseMirror
essay typography).

## Where a new token goes

- Need a new raw color? It almost certainly doesn't belong here — reach for
  an existing primitive or semantic role first. If a ramp is genuinely
  missing a hue (rare), add it to `primitives.css`.
- Need a new role (a new kind of surface, ink, or state)? Add it to
  `semantic.css`, following the existing naming: a noun for the surface
  family (`surface`, `chrome`, `ink`), a suffix for the variant
  (`-hover`, `-muted`, `-strong`).
- Building a new feature area with its own recurring colors (like `--task-*`
  or `--essay-*`)? Give it its own family file, name-prefixed by the
  feature, resolving only through `semantic.css`/`workspace.css`.
- Extending an existing family? Add to that family's file, keep the naming
  pattern already established there.

## Naming convention

`--{family}-{role}[-{state}]`, e.g. `--workspace-composer-control-hover-border`,
`--school-filter-chip-active-ink`. Primitives are `--{ramp}-{position}`, e.g.
`--gray-400`, `--wine-600`. Semantic roles are bare nouns, e.g.
`--canvas`, `--ink-muted`, `--danger-solid`.

## The three laws

**1. Color literals only in `primitives.css`.** Every other file must resolve
purely through `var()` (directly, through `color-mix()`, or through Tailwind
`@theme inline`). This is what makes a future re-theme (a real dark mode
pass, a seasonal palette, a white-label variant) a primitives-only edit
instead of a codebase-wide hunt.

**2. A hue is a claim about state, and each hue makes exactly one claim.**

| Role              | Means, on every screen                                           |
| ----------------- | ---------------------------------------------------------------- |
| `--brand-*`       | identity · the primary action · the current selection · quantity |
| `--danger-*`      | overdue · error · destructive                                    |
| `--warning-*`     | waiting on someone · not ready · needs you                       |
| `--success-*`     | done · complete · submitted · ready                              |
| `--label-*`       | a **categorical** classifier — a category, a type, a round       |
| `--brand-scale-*` | an **ordered** scale — three intensities of the one hue          |
| neutral           | everything else, including every in-progress state               |

Before this rule, amber was simultaneously the `Med` priority, the `Waiting`
status, the `Aid` category and the `Reach` school, and all four could land in
one table row. When you reach for a colour, name the one claim it makes. If
the answer is "so you can tell it apart from the one next to it", it is a
label, not a state — that is what `--label-*` is for, and the word inside the
chip is doing the work.

Two corollaries worth stating because both were violated:

- **The ordinary state of a record gets no colour.** A task that is `doing`,
  a school you are `Applying` to, an essay that is `Drafting` — these are the
  common case, and colouring the common case is what leaves the three real
  signals with nothing to say.
- **Ordered data takes one hue at several intensities, never several hues.**
  Reach/Target/Safety as amber/blue/green read as three competing categories;
  as three steps of `--brand-scale-*` the bar reads as one measurement.

**3. There are four surfaces, and which one you get follows from what the
container does — never from which feature owns it.**

| Role               | Is                                                          | Takes                      |
| ------------------ | ----------------------------------------------------------- | -------------------------- |
| `--surface-raised` | an object ON the page; carries content                      | `--edge` + `--elevation-1` |
| `--canvas`         | the page                                                    | nothing                    |
| `--chrome`         | the sidebar rail                                            | `--edge` on its seam only  |
| `--surface-inset`  | a well cut INTO a surface; holds or recesses something else | **no border, no shadow**   |

Corollaries, all three of which were being violated:

- **A page has exactly one raised level. A card never contains a card.** When
  content inside a raised surface needs grouping, it gets a `--hairline` rule
  or a heading — never a second border-plus-shadow-plus-fill. There are two
  legal shapes: a **list** (one raised panel, rows divided by hairlines) and a
  **board** (a borderless inset trough holding raised cards). Activities was
  drawing both at once.
- **An inset surface never draws a rim.** A recessed fill that also has a
  border reads as embossed. The fill step is the entire signal.
- **Interaction states are one rule, not a value per component.** Hover is 4%
  of `--gray-900` mixed into whatever surface the element sits on; pressed is
  7%. Those two percentages land within a tenth of a lightness point of the
  same perceived step on all four levels, which is why one rule covers the
  app and hand-tuned `bg-muted/40`-style modifiers never did — a translucent
  fill is a value that changes depending on what happens to be behind it.

Before this rule the same nesting depth — the main panel of a route — was
`L 0.963` on Tasks, `L 0.963`-with-a-border on Activities, `L 1.000` on
Profile and Schools, and no fill at all on Essays. Five routes, four answers
to "what colour is the box on the page".
