# Token layer

Four strict tiers. Never skip a tier — a family file resolving straight to
a primitive (bypassing semantic.css) is a bug, not a shortcut.

1. **`primitives.css`** — raw OKLCH ramps (`--neutral-*`, `--plum-*`,
   `--green-*`, `--amber-*`, `--red-*`, `--blue-*`, `--mauve-*`, `--teal-*`,
   `--slate-*`). Named by scale position, never by usage. **This is the
   only file in the codebase allowed a color literal** (hex/rgb/hsl/oklch
   with numeric channels — the CSS keywords `transparent`/`currentColor`
   don't count, use them anywhere). Enforce by grepping: any color literal
   found outside this file is a bug.

2. **`semantic.css`** + **`elevation.css`** — role tokens. Every value is a
   `var()` onto a primitive, or a `color-mix()` of two such vars. Two
   independent naming zones live in `semantic.css`: the workspace canvas
   (`--canvas`/`--surface*`/`--ink*`/`--edge*`/`--brand*`) and the sidebar
   chrome (`--chrome*`) — both light, the chrome just a whisper-recessed,
   plum-tinted step below canvas. `elevation.css` holds the shadow scale
   (`--elevation-0..3`) and the z-index scale (`--z-*`).

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
`--task-category-essay-fg`. Primitives are `--{ramp}-{position}`, e.g.
`--neutral-200`, `--plum-600`. Semantic roles are bare nouns, e.g.
`--canvas`, `--ink-muted`, `--danger-solid`.

## The one law

**Color literals only in `primitives.css`.** Every other file must resolve
purely through `var()` (directly, through `color-mix()`, or through Tailwind
`@theme inline`). This is what makes a future re-theme (a real dark mode
pass, a seasonal palette, a white-label variant) a primitives-only edit
instead of a codebase-wide hunt.
