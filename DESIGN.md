# DESIGN.md — the Counselle design system

This is the complete, enforceable specification for how Counselle looks and behaves.
It is a **living document**: it describes the system as it is built, not as a phase or
a milestone. If you change the system, change this file in the same PR.

**Read this before writing any frontend code.** It supersedes taste. Where this
document and your instinct disagree, this document wins — or you change this document
first, deliberately, with the reason written down.

| If you're… | Read |
|---|---|
| adding a colour | §2 Tokens, §3 Colour — then almost certainly don't |
| building a component | §10 Components, §11 States, §12 Motion |
| building a new page | §9 Layout, §13 Content, §17 Surface patterns |
| touching chat / citations | §15 Honesty surfaces — the highest-stakes part of the app |
| reviewing a PR | §19 The rules, §21 Review checklist |
| wondering why something is the way it is | the CSS comments. They are load-bearing. |

Companion documents: `frontend/src/styles/README.md` (the token-layer contract, in the
code where it is enforced), `docs/ARCHITECTURE.md` (the system), `docs/adr/` (decisions).

---

## 1. Principles

### 1.1 The product principle that governs the design

Counselle answers a student's questions about their future. **The one thing we never
do is lie to a student.** Every other design rule in this file is negotiable under
time pressure; this one is not. Concretely, in the UI:

- A value we do not have renders as **"not available"** — never blank, never a dash,
  never a plausible-looking zero.
- A claim carries its source. Citations are the sole honesty gate (see §15) — there is
  no second validation layer behind them, so the citation UI has to be right.
- Uncertainty is shown, not smoothed. Caveats, recency, and evidence tiers are visible
  design elements, not tooltips you have to hunt for.
- **Status is never colour alone.** A colourblind user, a printed page, and a screen
  reader all get the same information.

### 1.2 The engineering principles

Inherited from the rest of the repo (`CLAUDE.md`), applied to UI:

1. **KISS.** The smallest thing that works. No abstraction before it is needed.
2. **Never reinvent the wheel.** Search the registries before you build (§10.1).
3. **Startup speed over enterprise completeness** — with the honesty carve-out above.

### 1.3 The design principles

1. **Restraint is the house style.** This is a workspace a student lives in for a year.
   It should be calm, legible, and quiet. Colour is a signal, not decoration.
2. **Hierarchy comes from surface and weight, not from chrome.** We separate things by
   fill level and type weight before we reach for a border, and reach for a border
   before we reach for a shadow.
3. **One rule beats one value per component.** Wherever a decision recurs — hover,
   focus, card shape, empty state — there is one rule that covers the whole app. A
   hand-tuned local value is how a system dies.
4. **Motion clarifies flow or it does not ship.** No decorative motion. No hover
   transforms. No shadow escalation on hover.
5. **The common case gets no colour.** If everything is highlighted, nothing is.

---

## 2. The token system

### 2.1 Four tiers, strictly ordered

Never skip a tier. A family file resolving straight to a primitive is a **bug**, not a
shortcut. Imported in this order by `frontend/src/index.css`:

| Tier | File(s) | May contain | May reference |
|---|---|---|---|
| **1 — Primitives** | `styles/primitives.css` | Raw OKLCH literals. Named by scale position, never by usage. **The only file in the codebase allowed a colour literal.** | nothing |
| **2 — Semantic** | `styles/semantic.css`, `styles/elevation.css` | Role tokens. Every value is a `var()` onto a primitive, or a `color-mix()` of two such vars. | tier 1 only |
| **3 — Families** | `styles/shell.css`, `workspace.css`, `task.css`, `essay.css`, `activity.css`, `profile.css`, `schools.css`, `onboarding.css`, `shadcn.css` | Per-feature alias blocks. | tier 2, or a sibling token in the same tier |
| **4 — Theme** | `styles/theme.css` | The Tailwind v4 `@theme inline` binding that turns tokens into utility classes (`bg-primary`, `border-border`). | tiers 2–3 |

Custom-property resolution is lazy, so this order is for human readability, not
correctness. It is enforced by review and by grep, not by the cascade.

Tailwind v4 runs **config-free** — there is no `tailwind.config.*` and no
`postcss.config.*`. `theme.css`'s `@theme inline` block *is* the config.
`frontend/components.json` configures the shadcn CLI (style `radix-nova`,
registries `@ai-elements`, `@coss`, `@kokonutui`).

### 2.2 The three laws

**Law 1 — Colour literals live only in `primitives.css`.**
Every other file resolves purely through `var()` — directly, through `color-mix()`, or
through `@theme inline`. This is what makes a future re-theme (a real dark mode, a
seasonal palette, a white-label build) a primitives-only edit instead of a
codebase-wide hunt. `transparent` and `currentColor` are CSS keywords, not literals;
use them anywhere.

*Current compliance: two violations in the entire tree, both non-colour-critical —
`AppSidebar.tsx:164` (`#000` inside a mask gradient), `number-field.tsx:141`
(`#0008` in a drop shadow). Zero raw Tailwind palette classes (`bg-red-500`,
`text-slate-400`) anywhere. Zero tier violations. Hold this line.*

**Law 2 — A hue is a claim about state, and each hue makes exactly one claim.**

| Role | Means, on every screen |
|---|---|
| `--brand-*` | identity · the primary action · the current selection · quantity |
| `--danger-*` | overdue · error · destructive |
| `--warning-*` | waiting on someone · not ready · needs you |
| `--success-*` | done · complete · submitted · ready |
| `--label-*` | a **categorical** classifier — a category, a type, a round |
| `--brand-scale-*` | an **ordered** scale — three intensities of the one hue |
| neutral | everything else, **including every in-progress state** |

Before this rule, amber was simultaneously the `Med` priority, the `Waiting` status,
the `Aid` category and the `Reach` school — and all four could land in one table row.
When you reach for a colour, name the one claim it makes. If the answer is "so you can
tell it apart from the one next to it," it is a **label**, not a state — that is what
`--label-*` is for, and the word inside the chip does the work.

Two corollaries, both of which were violated before the rule existed:

- **The ordinary state of a record gets no colour.** A task that is `doing`, a school
  you are `Applying` to, an essay that is `Drafting` — these are the common case, and
  colouring the common case is what leaves the three real signals with nothing to say.
- **Ordered data takes one hue at several intensities, never several hues.**
  Reach/Target/Safety as amber/blue/green read as three competing categories; as three
  steps of `--brand-scale-*` the bar reads as one measurement.

**Law 3 — There are four surfaces, and which one you get follows from what the
container *does*, never from which feature owns it.**

| Role | Is | Takes |
|---|---|---|
| `--surface-raised` | an object ON the page; carries content | `--edge` + `--elevation-1` |
| `--canvas` | the page — pure white, and the **same colour** as `--surface-raised`; the two roles stay separate names because only one of them takes an edge and a shadow | nothing |
| `--chrome` | the sidebar rail | `--edge` on its seam only |
| `--surface-inset` | a well cut INTO a surface; holds or recesses something | **no border, no shadow** |

Corollaries:

- **A page has exactly one raised level. A card never contains a card.** When content
  inside a raised surface needs grouping it gets a `--hairline` rule or a heading —
  never a second border-plus-shadow-plus-fill. There are two legal shapes: a **list**
  (one raised panel, rows divided by hairlines) and a **board** (a borderless inset
  trough holding raised cards).
- **An inset surface never draws a rim.** A recessed fill that also has a border reads
  as embossed. The fill step is the entire signal.
- **Interaction states are one rule, not a value per component** (§11.1).

### 2.3 Naming

`--{family}-{role}[-{state}]` — e.g. `--workspace-composer-control-hover-border`,
`--school-filter-chip-active-ink`. Primitives are `--{ramp}-{position}`
(`--gray-400`, `--wine-600`). Semantic roles are bare nouns (`--canvas`, `--ink-muted`,
`--danger-solid`).

### 2.4 Where a new token goes

- **New raw colour?** It almost certainly doesn't belong. Reach for an existing
  primitive or semantic role. Adding a ramp is the single most expensive change you
  can make to this system (§3.1).
- **New role** (a new kind of surface, ink, or state)? Add it to `semantic.css`.
- **New feature area with its own recurring colours?** Give it a family file, prefixed
  by the feature, resolving only through `semantic.css` / `workspace.css`.
- **Extending an existing family?** Add to that family's file; keep its naming pattern.
- Split a family file once it passes ~300 lines.

---

## 3. Colour

### 3.1 The palette is five ramps. That is the whole palette.

All in **OKLCH**, all gamut- and contrast-checked by script (not eyeballed); the hex
annotations in `primitives.css` comments are the contract. Re-run the conversion script
if any step moves.

| Ramp | Hue | What it is |
|---|---|---|
| `--gray-*` | 50 | every surface, every border, every word of text |
| `--wine-*` | 15 | the brand |
| `--red-*` | 25 | danger |
| `--amber-*` | 80 | warning |
| `--leaf-*` | 143 | success |

Deleted, deliberately: `--blue` (the `--info` role), `--plum`, `--mauve`, `--teal`,
`--slate`. Merged into `--gray-*`: `--neutral-*`, `--sand-*`, `--stone-*`. Forty
distinct neutral steps became thirteen.

**Why adding a ramp is so expensive:** the four deleted wayfinding hues each existed to
tint one pill on one page, and between them they cost every status colour its meaning.
The three deleted neutral ramps cost something subtler and worse — they put six
different hues inside a five-lightness-point band, so the app's greys read as slightly
dirty rather than as levels. If you think you need a new hue, you need `--label-*`
(categorical) or `--brand-scale-*` (ordered). If you think you need a new grey, you
need one of the four surface roles.

**The neutral ramp** — note the roles, they are not interchangeable:

| Token | OKLCH | Hex | Role |
|---|---|---|---|
| `--gray-25` | `100% 0 0` | `#ffffff` | **raised *and* canvas** — the page is pure white, so an object on it is identified by `--edge` + `--elevation-1`, never by a fill step. (`--gray-50`, the old `#fcf9f7` canvas, is deleted rather than aliased: a ramp with two identical steps invites someone to re-separate them.) |
| `--gray-100` | `97.2% 0.005 50` | `#f9f5f3` | chrome — 2.8 L points under the page, and deliberately still warm beside it |
| `--gray-150` | `95.5% 0.006 50` | `#f4efed` | inset |
| `--gray-200` | `93.5% 0.007 50` | `#eee8e5` | pressed inset — *not a resting level* |
| `--gray-300` | `90.5% 0.009 50` | `#e5deda` | hairline — a divider *within* one surface |
| `--gray-400` | `86% 0.011 50` | `#d7cfcb` | edge — the *perimeter* of a surface |
| `--gray-500` | `76% 0.014 50` | `#b9afa9` | edge-strong — hovered/pressed perimeter; **and edge-control, the resting boundary of a bare form control** |
| `--gray-600` | `62% 0.016 50` | `#8f847e` | edge-control-strong — a form control's boundary *hovered* (3.61:1) |
| `--gray-650` | `70% 0.013 50` | `#a69c97` | disabled ink (WCAG-exempt) |
| `--gray-700` | `52% 0.014 50` | `#706762` | faint ink |
| `--gray-800` | `42% 0.011 50` | `#524b48` | secondary ink |
| `--gray-900` | `28% 0.01 50` | `#2d2825` | ink |
| `--gray-950` | `25% 0.009 50` | `#25201e` | strong / wordmark |
| `--gray-0` | `100% 0 0` | `#ffffff` | outside the ramp — only as ink ON a saturated fill |
| `--gray-1000` | `11% 0 0` | — | outside the ramp — only as the base a scrim mixes from |

**The brand ramp.** Hue 15, deep burgundy. Steps 600/700/50/100 are contractual values
from the sidebar design; the rest is interpolated along the same hue for span.
`--wine-600` (`#751e2d`, 10.65:1) is the brand. `--wine-500` (7.01:1) is the focus ring
— deliberately a step lighter than the brand so the ring reads as a ring, not as fill.
`--wine-ink-on-50` and `--wine-ink-on-100` are reduced-chroma inks for drawing on the
two brand tints; they are not ramp steps.

### 3.2 Colour space rules

- Author primitives in **OKLCH**.
- Mix hover/pressed states **`in oklab`**, not `in oklch`. Both operands are
  near-achromatic, and polar OKLCH interpolates around the hue *angle* — mixing two
  barely-chromatic colours can walk the long way round the wheel and land somewhere
  pink. Rectangular OKLab has no hue channel to rotate.
- Mix saturated colours (scrims, selected fills, shadow tints) `in oklch`, where the
  polar behaviour is not a risk.

### 3.3 Contrast law

- Text meets **WCAG AA (4.5:1)**, and the ratio is measured, not guessed. This repo's
  convention is to **write the measured ratio in a comment next to the token**. Keep
  doing that — it is how the palette survived three brand-hue changes.
- **A form control's resting border is `--edge-control` at 2.12:1, and that is a
  deliberate exception to 1.4.11 — the only one in the system.** It used to be gray-600
  (3.61:1 on raised), chosen so the boundary alone cleared WCAG 1.4.11 on the reasoning
  that a border is the only thing saying "type here." Rendered, eight of those strokes
  on one near-white card read as a wireframe, and the field also carried an inset fill
  to compensate — a fill plus a rim, which is the embossed shape §2.2 Law 3 bans. Both
  halves are now gone: the field takes its container's fill and a gray-500 boundary.
  What identifies it at rest is the whole set — a persistent visible label, the
  placeholder at 6.4:1, `shadow-xs` with the 1px inner top highlight, and the border —
  with **hover at 3.61:1 and focus at 7.01:1** both clearing the bar outright. This
  palette cannot have both soft and 3:1: thirteen neutral steps inside a narrow light
  band put "3:1 from a near-white container" at roughly L 0.62, a charcoal outline.
  Reverting is one line — `--edge-control` in `semantic.css`.
- Decorative borders and scrollbar thumbs are explicitly exempt — and where they're
  exempt, the exemption is written down.
- A UI-component colour that composites (an icon at reduced opacity on a tinted chip)
  must be checked **after compositing**. See `composer-control.ts`: chevrons sit at 65%
  and not 60%, because 60% measured 2.94:1 and 65% measures 3.28:1.

**Known gap:** contrast is hand-verified and commented; nothing in CI enforces it. The
a11y test files explicitly disclaim contrast coverage (axe-core in jsdom cannot compute
real colour). If you move a token, run the contrast script.

### 3.4 The single theme

The app is **light-only**. There is no `.dark` class, no `prefers-color-scheme` branch,
and no dark token set. `sonner.tsx` pins `theme="light"` for that reason. Dark mode is
an anticipated capability, not a built one — and the whole point of the tier system is
that it stays a primitives-only edit when we do it. Do not add `dark:` variants; they
are dead weight today and a false signal that a dark theme exists.

---

## 4. Elevation & depth

Depth is carried by **surface fill first**, border second, shadow last.

| Token | Value | Use |
|---|---|---|
| `--elevation-0` | `none` | the default |
| `--elevation-1` | `0 1px 2px @6%`, `0 1px 1px @4%` | a raised card sitting on canvas |
| `--elevation-2` | `0 4px 12px @10%`, `0 2px 4px @6%` | menus, popovers, dropdowns |
| `--elevation-3` | `0 16px 40px @16%`, `0 6px 16px @10%` | modals, sheets |
| `--elevation-cta` | tinted from `--wine-900` | the primary button at rest |
| `--elevation-cta-hover` | tinted from `--wine-900` | the primary button on hover |

All percentages are `color-mix` of `--gray-900` into `transparent`.

**Rules:**

- **`--elevation-1` (blur ≤ 2px) is the only tier safe to pair with a border on the
  same element.** `--elevation-2`/`-3` (blur ≥ 12px) belong on borderless surfaces.
  A 1px border plus a 16px-blur shadow on one element is the banned "glassy" look.
- The CTA shadow is tinted from `--wine-900` — the near-black end of the brand ramp —
  **not** from `--brand`. A mid-brand low-alpha wash reads as a glow, not a shadow.
- **Never escalate shadow on hover** for cards. Hover changes border colour (§11.2).

### 4.1 Z-index

Use the scale in `elevation.css`. Never invent a z-index.

| Token | Value |
|---|---|
| `--z-dropdown` | 20 |
| `--z-sticky` | 30 |
| `--z-modal-backdrop` | 40 |
| `--z-modal` | 50 |
| `--z-toast` | 60 |
| `--z-tooltip` | 70 |

Consume as `z-[var(--z-modal)]`. *(Known violation: `useTaskDrag.ts:110` sets
`zIndex: "2147483647"` on the drag ghost. It works; it is still off the scale.)*

---

## 5. Shape

One base radius, one calc ladder, defined in `theme.css`:

```
--radius: 0.625rem        /* 10px — the base, in shadcn.css */
--radius-sm:  calc(--radius * 0.6)   =  6px
--radius-md:  calc(--radius * 0.8)   =  8px
--radius-lg:  var(--radius)          = 10px
--radius-xl:  calc(--radius * 1.4)   = 14px
--radius-2xl: calc(--radius * 1.8)   = 18px
--radius-3xl: calc(--radius * 2.2)   = 22px
--radius-4xl: calc(--radius * 2.6)   = 26px
```

`--radius` is the one non-colour literal permitted outside `primitives.css`. It is a
dimension, not a colour, so Law 1 does not apply — but it is still the single source of
truth for every corner in the app.

**What each radius means** (de-facto usage, in frequency order — hold to it):

| Radius | Count | Means |
|---|---|---|
| `rounded-xl` (14px) | 69 | **a card** — the canonical content object |
| `rounded-lg` (10px) | 67 | **a control** — buttons, nav rows, menu popups |
| `rounded-md` (8px) | 58 | **a control inside a control** — menu items, small chips |
| `rounded-full` | 40 | circular avatars, dots, progress tracks, scrollbar thumbs |
| `rounded-sm` (6px) | 19 | badges |
| `rounded-2xl` (18px) | 13 | the composer, and only things of that scale |

When nesting, the inner radius is the outer minus the border width:
`before:rounded-[calc(var(--radius-lg)-1px)]`. That is why the `[calc(…)]` arbitrary
values exist and why they are not drift.

---

## 6. Typography

### 6.1 Families

```
--font-sans:     "Instrument Sans Variable", system-ui, sans-serif
--font-heading:  var(--font-sans)      /* deliberately the same — one voice */
--font-document: Georgia, ui-serif, serif
```

Loaded via `@fontsource-variable/instrument-sans` (npm, self-hosted — no Google Fonts
request, no FOUT from a third-party origin). One family for the entire interface.
**Georgia is reserved for essay documents** — the ProseMirror editor and the document
preview — because an essay is a piece of writing, not a piece of UI, and the serif
signals that the surface belongs to the student.

Do not add a third family. Do not use `--font-heading` as a hook to introduce one; it
exists so that *if* a display face is ever justified, one token flips.

### 6.2 The scale

Derived from real usage across `frontend/src`:

| Class | Size | Count | Use |
|---|---|---|---|
| `text-sm` | 14px | 262 | **the default.** Body, labels, nav, table cells, buttons |
| `text-xs` | 12px | 224 | meta, captions, badges, eyebrows, timestamps |
| `text-base` | 16px | 34 | prose, the composer input, mobile-first control labels |
| `text-[13px]` | 13px | 22 | the one sanctioned off-ladder step — dense chrome (§6.3) |
| `text-lg` | 18px | 12 | section headings inside a page |
| `text-xl` | 20px | 7 | **the page title** (`PageHeader`) — the largest type in the app |

There is no `text-2xl`+ in the workspace. Counselle has **no hero type**. The largest
routine text on any screen is a 20px page title; the app's presence comes from surface,
rhythm, and restraint, not scale contrast.

**Deliberate one-offs**, all commented at their site: `text-[1.625rem]` (the VerdictBand
hero number — a card's single oversized element), `text-[26px]`/`sm:text-[28px]`
(onboarding headline), `text-[15px]`, `text-[11px]`, `text-[10px]`.

### 6.3 The 13px question

`text-[13px]` appears 22 times, always in dense chrome: composer chips, menu rows,
sidebar rows, activity status badges. It sits between `text-xs` (12px) and `text-sm`
(14px) because both are wrong there — 12px is too quiet for an interactive label and
14px breaks the density.

**It is sanctioned, with one condition: it must be a named class, not a scattered
literal.** Today it is scattered. The fix (small, do it when you next touch this area)
is a `--text-chrome` step in `theme.css` so `text-chrome` is a real utility. Until then,
if you write `text-[13px]`, write the comment saying why.

Watch out for a real trap, documented in `composer-control.ts`: shadcn's variant buckets
carry `sm:text-sm`, which wins at ≥640px and silently re-renders your 13px chip at 14px
on desktop. If you set a custom size on a shadcn primitive, you must also set the `sm:`
variant.

### 6.4 Weight

| Weight | Count | Use |
|---|---|---|
| `font-medium` (500) | 199 | **the emphasis default** — active nav, labels, buttons, headings inside cards |
| `font-semibold` (600) | 35 | page titles, section titles, the wordmark |
| `font-normal` (400) | 19 | explicit reset where a parent set weight |

CSS-authored surfaces use half-steps the utility scale doesn't expose — `450` (sidebar
chat titles), `550` (markdown links), `650` (markdown headings and strong). These are
intentional: Instrument Sans is variable, and 650 reads as "heading" without the block
that 700 puts in a paragraph.

**Never use `font-bold` (700) or above.** It does not appear anywhere in the app and
should not start.

### 6.5 Rhythm and detail

- **Tracking:** `tracking-tight` on page titles; `-0.02em` on markdown headings;
  `0.08em` uppercase on sidebar group labels (the one uppercase treatment in the app —
  recency headers in the chat list). Body text takes no tracking adjustment.
- **Leading:** `1.72` for assistant prose (deliberately generous — it is read, not
  scanned), `1.28` for markdown headings, `leading-none` for the page title.
- **Measure:** assistant prose is capped at `70ch`. Long-form reading surfaces cap
  around `60–65ch`. Never let prose run the full width of a wide viewport.
- **Balance and pretty:** `text-balance` on headings (8 uses), `text-pretty` on prose.
- **Truncation:** `truncate` for single-line identity (school names, chat titles),
  `line-clamp-2` for card snippets, `line-clamp-4` for citation hover-card snippets.
  `[overflow-wrap:anywhere]` on user message bubbles so a pasted URL cannot blow out the
  layout.

### 6.6 Tabular figures

Use `tabular-nums` wherever numbers are compared vertically or update in place:
evidence values in the sources rail, table numeric columns, counters, character budgets.
This is currently applied unevenly — when you touch a numeric column, apply it.

### 6.7 Assistant markdown

Assistant prose is rendered by **Streamdown** and styled by the `.markdown-response`
block in `index.css`. Three things about it are unusual and deliberate:

1. **It is authored outside every `@layer`.** Streamdown's own utility classes live in
   Tailwind's `utilities` layer, which outranks `@layer components`. Unlayered normal
   declarations beat every cascade layer, so this is the only way to author competing
   rules. The `@media (min-width: 0)` wrapper is a no-op that keeps the block grouped.
2. **Every gap is `margin-block-start` only** (`> * + *`), never a bottom margin. This
   makes margin collapse a non-issue and means a block's spacing is determined by what
   precedes it, which is what you actually want in streamed content.
3. **Spacing is a named local scale**, not literals: `--md-flow` (0.85rem),
   `--md-flow-tight` (0.65), `--md-flow-block` (1.15), `--md-flow-sub` (1.2),
   `--md-flow-minor` (1.05), `--md-flow-section` (1.5), `--md-flow-stack` (1),
   `--md-flow-rule` (1). A `max-width: 640px` block retunes four of them for mobile.

Markdown heading sizes are `1.375 / 1.1875 / 1.0625 / 1rem` — note how compressed that
is. A heading inside an answer is a *signpost*, not a title.

Blockquotes get a **filled surface, no left border** — the fill is the signal (Law 3's
inset corollary applied to prose).

---

## 7. Spacing & density

### 7.1 The scale

Tailwind's 4px base. Real usage, in frequency order:

| Gap | Count | | Padding | Count |
|---|---|---|---|---|
| `gap-2` (8px) | 202 | | `px-2` (8) | 50 |
| `gap-3` (12px) | 90 | | `px-3` (12) | 45 |
| `gap-1.5` (6px) | 90 | | `px-4` (16) | 37 |
| `gap-1` (4px) | 67 | | `py-1` (4) | 32 |
| `gap-4` (16px) | 46 | | `py-2` (8) | 30 |
| `gap-2.5` (10px) | 23 | | `p-4` (16) | 22 |
| `gap-6` (24px) | 15 | | `p-6` (24) | 18 |

**The sanctioned ladder is 1 / 1.5 / 2 / 3 / 4 / 6** (4, 6, 8, 12, 16, 24px), with
`2.5` and `0.5` as legitimate half-steps inside dense chrome. `gap-5`, `gap-8` and above
are outliers — 9 and 2 uses respectively; prefer 4 or 6.

**Rhythm by altitude:**
- **Page level** — 24px (`gap-6`) between header and body and between body sections.
- **Card interior** — 16px (`p-4`) or 24px (`p-6`) padding, 8–12px between elements.
- **Chrome** — 4–8px. The sidebar stacks nav rows at a **1px** gap (`gap-px`)
  deliberately: the rows are tall enough that more reads as a list of separate buttons
  rather than one column.

### 7.2 Control heights

| Height | Count | Use |
|---|---|---|
| `h-11` (44px) | 41 | mobile touch targets, tall inputs |
| `h-7` (28px) | 38 | dense chrome — icon buttons, small chips |
| `h-8` (32px) | 34 | **the default control height on desktop** |
| `h-9` (36px) | 8 | the default control height on mobile / nav rows |
| `h-10` (40px) | 11 | large controls, the "New chat" CTA |

The app is tuned **larger on touch and smaller on desktop** — the inverse of the usual
mobile-first pattern. Buttons are `h-9 sm:h-8`, badges `h-5.5 sm:h-4.5`, icons
`size-4.5 sm:size-4`. Follow the inversion; do not "fix" it.

### 7.3 Icon sizes

| Size | Count | Use |
|---|---|---|
| `size-4` (16px) | 95 | **the default** |
| `size-3.5` (14px) | 79 | inside dense chrome, badges, inline meta |
| `size-4.5` (18px) | 22 | the mobile counterpart of `size-4` |

Icons are **lucide-react**, exclusively, at default stroke width. Never set a size on
an icon at the call site — the container's variant does it:

```
[&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4
[&_svg:not([class*='opacity-'])]:opacity-80
[&_svg]:pointer-events-none
```

That third rule (`opacity-80`) is the app's "icons read slightly muted against text"
convention, enforced structurally so no call site has to remember it.

**Exception:** the sidebar uses a hand-drawn glyph set (`features/shell/sidebar-icons.tsx`)
transcribed from the sidebar design, at deliberately un-normalised optical sizes
(nav 17px/stroke 1.7, actions 16px/stroke 1.8–1.9, filter 15px/stroke 1.8). Swapping in
Lucide got the palette right and the drawing wrong. Leave it alone.

### 7.4 Breakpoints

Tailwind v4 defaults, no overrides. `useIsMobile()` uses `768` to match `md`.

| Prefix | Count | What it means here |
|---|---|---|
| `sm:` 640px | 284 | **the desktop-densification breakpoint** — controls shrink |
| `md:` 768px | 58 | **the layout breakpoint** — sidebar becomes a rail, tables appear |
| `lg:` 1024px | 34 | multi-column content |
| `xl:` 1280px | 11 | filter rows go horizontal |
| `2xl:` 1536px | 6 | rare |

`min-[420px]:` appears once (`SchoolDataToolRow.tsx:89`) — a container-scale decision
wearing a viewport-query costume. Prefer container queries (`@container`) for
component-internal reflow; `SearchToolWidget` already does this correctly.

---

## 8. Content max-widths

Two tiers, and only two, exposed by `PageContainer` (§9.3):

- **`full`** — dense data surfaces: board, table, card grid.
- **`wide`** — `mx-auto max-w-4xl` (896px) — linear read-and-enter surfaces.

Before this rule there were three widths across five pages (1064 / 896 / 768) with no
rule behind the split. *(Four literal widths still exist outside the vocabulary:
`max-w-[700px]` in the composer landing, `max-w-[820px]` in the essay editor,
`max-w-3xl` in the chat transcript, `max-w-md` in error panels. The chat and essay
widths are justified by measure, not layout — see §6.5.)*

---

## 9. Layout & the shell

### 9.1 Anatomy

```
main.tsx → App → AppProviders (QueryClient, TooltipProvider, Toaster)
  RouterProvider
    GuestOnly            → /login, /register
    RequireAuth
      OnboardingGate
        WorkspaceShell    ← /app
          SidebarProvider  (--sidebar-width from useResizableSidebar)
            div.relative.flex.h-dvh.w-full
              AppSidebar            → <Sidebar collapsible="icon">
              SidebarResizer        (desktop only)
              SidebarInset          → <main>, flex column, overflow-hidden
                header.h-14.md:hidden   ← mobile-only top bar
                WorkspaceOutlet
                  motion.div.absolute.inset-0   ← route transition
                    <route element>
```

`h-dvh` pins the shell to the dynamic viewport. **The shell never scrolls.** Every page
owns its own scroll container, and the sidebar's chat list owns its own. This is the
single most important layout fact: if you write a page that assumes the window scrolls,
it will not work.

### 9.2 The sidebar

- **Width** 312px default, 232–408px resizable, persisted to
  `localStorage["counselle:sidebar-width"]`. Double-click the resizer to reset.
- **Collapsed** to a 48px icon rail. Open/collapsed state persists in the `sidebar_state`
  cookie (7 days). `⌘/Ctrl+B` toggles it, guarded so it doesn't fire while typing.
- **Below 768px** the sidebar is a `Sheet` (off-canvas, 288px), the resizer is gone, and
  nav clicks auto-close it.
- **Fill** is flat `--chrome` (`--gray-100`). No texture, no grain, no gradient — those
  were tried and removed. Separation from canvas is carried by `--shell-sidebar-border`,
  because rail and canvas sit within 0.7 lightness points of each other.
- **Zones**, top to bottom, each with its own inline inset: header (16px) · "New chat"
  CTA (12px) · nav (12px) · chat history (12px, the only scrolling zone, bottom-masked)
  · account row (10px, `mt-auto`).
- **Nav row:** `h-9`, `rounded-[10px]`, `px-3`, `gap-[11px]`, `text-sm`, 17px icons,
  stacked at `gap-px`.
- **Active state** is a `--chrome-active` (`--wine-50`) fill plus `font-medium` plus
  `--on-chrome-active` ink. **There is no left bar** — it was removed once hover and
  active got distinct fills, because a bar on top of a fill and a weight change is the
  third redundant signal.
- **Scrollbars are invisible at rest** and revealed on hover, both via `scrollbar-color`
  and the WebKit pseudo-elements, with the transition disabled under reduced motion.
- The account row is `rounded-[13px]` — rounder than any nav row, deliberately, so the
  account block does not read as one more item in the list. Its menu opens from a
  typographic `···`, and **the row itself is not the logout target** (it used to be, and
  stray clicks ended sessions).

### 9.3 The page scaffold

**Every workspace route should render through `PageContainer`.**

```tsx
<PageContainer
  title="Schools"                 // required
  subtitle={<>…</>}               // optional
  actions={<Button>Add school</Button>}
  width="full" | "panel" | "wide" // default "full"
  scrollRef={ref}                 // if you need scroll position
  overlay={<UndoToast … />}       // rendered OUTSIDE the scroll area
  className="…"                   // extra classes on the body column
>
  …
</PageContainer>
```

It renders a `<section>` (bounds, `overflow-hidden`) wrapping a scrolling column
(`overflow-y-auto px-6 pb-6 md:px-10`, `gap-6`), with `PageHeader` at the top.

**Widths.** `full` for dense data surfaces, `wide` (896px) for linear read-and-enter
surfaces, `panel` (1160px) for rail-and-panel pages — Profile and a school's detail. The
header tracks the same column as the body, so a page reads as one aligned column.

`PageHeader` guarantees:
- a **fixed `min-h-16` (64px)** — before it existed, header height varied 64/60/52px per
  page depending on which action buttons happened to be present, so the rule under the
  title landed at a different height on every route;
- `text-xl font-semibold tracking-tight` title, `text-sm text-muted-foreground` subtitle;
- a **full-bleed bottom rule** achieved by negating and reapplying the parent's padding
  (`-mx-6 px-6 md:-mx-10 md:px-10`), so the rule spans edge to edge while the title stays
  aligned with the body;
- actions stacking vertically below `sm:`, and the whole header stacking below `md:`.

`rule` is the one knob: `inset` (the default) stops the rule 20px short on the right to
clear the scrollbar of the column `PageContainer` puts the header inside; `full` runs it
to the true edge, for a header that sits *above* a scroll area rather than in one — the
essay editor — where the inset would read as a notch.

**The actions column is `shrink-0`.** Whatever you put in it is width the title can never
reclaim, so a header with a lot of chrome needs a stated priority order rather than a
uniform `truncate`. The essay editor is the worked example: between `md:` (where the
header returns to one row) and `xl:` the sidebar is still at full width, leaving the bar
~410px, so the school mark, the "Modified …" stamp, the status chip and the Prompt
button's label each drop out at a named breakpoint before the title is allowed to
collapse. Drop by importance; never let the page's own name be the thing that goes.

**This is not currently universal.** `EssaysRoute`, `SchoolsRoute` and `TasksRoute` still
hand-roll `PageContainer`'s markup and have already drifted from it (asymmetric
`pr-8 pl-6 md:pr-10` instead of `px-6 md:px-10`). `RouteSurface` (`/app/calendar`) is a
third header shape entirely (`h-14`, `text-base`, `px-5`). The chat routes opt out
legitimately — they have a different shape. See §20.

The essay editor **does** render through `PageHeader` (it can't use `PageContainer` — its
body is a centred sheet, not the standard scroll column). Its chrome is three flush bands
separated by hairlines: title, formatting toolbar, then the canvas. It used to be a raised
header card plus a toolbar pill floating over the page, which put three competing objects
on screen when the document is meant to be the only one that floats.

### 9.4 Routes

| Path | Renders | Gate |
|---|---|---|
| `/login`, `/register` | auth routes | `GuestOnly` |
| `/app` → `/app/ai` | redirect | auth + onboarding |
| `/app/ai` | composer landing | ” |
| `/app/ai/:sessionId` | chat | ” |
| `/app/tasks` | task board / table | ” |
| `/app/schools`, `/app/schools/:unitid` | list; school page (About + Your application). Keyed by school, so a school you have not added still has a page; an application id in the slot redirects to the canonical URL | ” |
| `/app/essays`, `/app/essays/:id` | library, editor | ” |
| `/app/activities` | activities + honors | ” |
| `/app/profile` | profile | ” |
| `/app/calendar` | stub | ” |
| `/onboarding` | wizard (outside the shell) | auth |
| `/dev/*` | galleries | dev builds only |

### 9.5 Route transitions

`WorkspaceOutlet` animates route changes: fade + `scale(0.992→1)` + `y(18→0)` in,
`y(-12)` out, **220ms, `cubic-bezier(0.22, 1, 0.36, 1)`**. Under reduced motion it
collapses to opacity only.

---

## 10. Components

### 10.1 Search registries before you build — in this order

This is principle 2 made concrete. **Before building any component:**

1. **shadcn MCP** (`search_items_in_registries`) — always first.
2. **COSS registry** (`coss`) — the default for components, blocks, particles.
3. **`@ai-elements`** — we are an AI app; prefer it for anything chat/agent-shaped.
4. **`@shadcn`** — plain primitives (button, tooltip, dialog).
5. **21st.dev `magic` MCP** if present (user-scoped, may be absent — skip silently).
6. **Only build custom when nothing fits.**

Install from `frontend/` so the project registries resolve:
```bash
cd frontend && npx shadcn@latest add @ai-elements/conversation
```

Counselle's differentiating honesty surfaces (§15) are built new. Everything commodity
comes from a registry.

### 10.2 The primitive layer

`frontend/src/components/ui/` holds ~39 primitives. Two headless lineages coexist:

- **Base UI** (`@base-ui/react`) + `useRender`/`mergeProps` — the newer lineage:
  button, badge, card, input, textarea, label, menu, popover, select, sheet, tabs,
  table, accordion, scroll-area, meter, toolbar, breadcrumb, number-field,
  segmented-control. Polymorphism via `render={<X />}`.
- **Radix** (`radix-ui`) — checkbox, radio-group, separator, tooltip, hover-card,
  dialog, dropdown-menu, collapsible, avatar, and `sidebar.tsx`'s `Slot`.
  Polymorphism via `asChild`.

**Both are fine. Do not port one to the other opportunistically** — that is a refactor,
and refactors are their own change, never smuggled into a feature edit. Do check which
lineage a file uses before adding to it, because the state attributes differ
(`data-highlighted`/`data-pressed` vs `focus:`/`data-[state]`).

### 10.3 Composition conventions

- **`cn()` = `twMerge(clsx(…))`** (`lib/utils.ts`) composes every className, so later
  classes reliably beat earlier conflicting ones.
- **`data-slot="…"` on every part.** It is the universal styling and testing hook, and
  it enables cross-component selectors (`in-data-[slot=input-group]`,
  `has-data-[slot=kbd]`).
- **Variants are `cva` + `VariantProps<typeof xVariants>`.** Manual string-union
  variants (tabs, table) exist and are acceptable for two-value cases.
- **Icon rules, touch-target expansion, and disabled treatment live in the base variant
  string**, not at the call site.
- **Field chrome lives on the wrapper, not the control.** `input.tsx` and `textarea.tsx`
  wrap the native element in `<span data-slot="input-control">` and drive border/ring
  from `:has()` selectors on the child's state. This is what makes `unstyled` and
  `nativeInput` escape hatches possible.

### 10.4 Notable deviations from stock (keep them)

| Component | Deviation | Why |
|---|---|---|
| `button.tsx` | a `before:` gloss layer that flips to an inset shadow on press; `--elevation-cta`; a `loading` prop that sets `aria-disabled` (not `disabled`) so the label stays readable | tactility; accessible loading |
| `badge.tsx` | variants replaced with the status vocabulary; **deliberately no `info`** | Law 2 (§2.2) |
| `card.tsx` | adds a `CardFrame*` family using `clip-path` to weld stacked cards into one frame | stacked-card layouts |
| `table.tsx` | adds `variant="card"` | card-shaped data |
| `empty.tsx` | two rotated ghost copies behind `variant="icon"` | depth without a shadow |
| `code-block.tsx` | pinned to `github-light-default` | the previous theme's identifiers cleared only 3.49:1 |
| `number-field.tsx` | field fill moved to `--field-surface`; `dark:` variants dropped | one field appearance; light-only app |
| `sonner.tsx` | `theme="light"` hardcoded | §3.4 |

### 10.5 The AI Elements directory is mostly vendored scaffolding

`components/ai-elements/` contains 11 files. **Only two are actually imported:**
`message.tsx` (Message, MessageContent, MessageResponse/Streamdown, MessageActions) and
`inline-citation.tsx`. The other nine — `artifact`, `code-block`, `chain-of-thought`,
`conversation`, `prompt-input`, `reasoning`, `shimmer`, `sources`, `task` — have **zero
importers**. `tool.tsx` and `suggestion.tsx` have been deleted.

**Do not treat that directory as representative of the design system.** The real chat
system is the bespoke stack in §15. If you need a work-visibility component, extend
`ToolBeat`, not `chain-of-thought.tsx`.

**A vendored file is not automatically reusable — check it against *our* primitives.**
`suggestion.tsx` was deleted at the one moment it finally had a caller (the essay panel's
selection-scoped verb chips, §15.7). It wraps shadcn's Radix `ScrollArea`, and
`ui/scroll-area.tsx` is a Base UI rewrite with a different contract — the root is
`size-full` and renders its own scrollbars, so `Suggestions` would have stretched to its
parent's height and left a stray `ScrollBar` inside the content. Its `Suggestion` half was
a `Button` wearing `rounded-full px-4`, a shape §5 reserves for avatars, dots and tracks.
Both halves were being overridden more than used, so the chips are a `Button` row and the
file is gone.

---

## 11. Interaction states

### 11.1 The one hover/press rule

**Hover is 4% of `--gray-900` mixed into whatever surface the element sits on. Pressed
is 7%.** Mixed `in oklab`.

Those two percentages land within a tenth of a lightness point of the same perceived
step on all four surface levels, which is why one rule covers the app and hand-tuned
`bg-muted/40`-style modifiers never did — **a translucent fill is a value that changes
depending on what happens to be behind it.**

The tokens already exist for each level; use them, never re-derive:
`--surface-hover`/`--surface-active`, `--canvas-hover`/`--canvas-active`,
`--chrome-hover`/`--chrome-pressed`, `--control-quiet-hover`/`--control-quiet-active`.

### 11.2 Hover, by element type

- **Controls** (buttons, nav rows, menu items) — **background shift.** 73 uses. Canonical.
- **Form controls** — **border shift** to `--edge-control-strong` (gray-600, 3.61:1),
  which is also where the control recovers the 1.4.11 bar its resting border trades
  away (§3.3). A background shift would fight the raised field fill.
- **Cards** — **border shift** to `--edge-strong`. Never shadow escalation, never
  transform. Both were tried and rejected as "motion that clarifies nothing."
- **The primary CTA** — the one place shadow changes on hover
  (`--elevation-cta` → `--elevation-cta-hover`).

### 11.3 Press

Base UI's `data-pressed` is primary, with `:active` as the compound fallback. The button
runs a real state machine: a rim-light inset shadow at rest
(`inset 0 1px 0 white/20%, inset 0 -1px 0 black/14%`) flipping to a depression
(`inset 0 1px 2px black/22%`) on press, with `shadow-none` on the outer box.

### 11.4 Focus

**Every interactive element has a visible focus ring. No exceptions.**

- Form controls: `focus-visible:border-ring focus-visible:ring-[3px]` at
  `--focus-ring` (`--wine-500`).
- Buttons, badges, sidebar rows: `focus-visible:ring-2` with
  `ring-offset-1 ring-offset-background` on badges.
- Composers: `focus-within:ring-2 ring-[var(--focus-ring)]/30` — deliberately softer,
  because the ring is on a large panel and mirrors the Input/Select focus language.

The 2px/3px split is real and only partly justified. When you touch a component that
uses `ring-2` on a *form control*, move it to `ring-[3px]`.

Focus must be **on the wrapper for compound fields** (`focus-within`, `has-focus-visible`)
so the ring surrounds the whole control, not the bare `<input>`.

### 11.5 Disabled

`disabled:pointer-events-none` plus an opacity. **The target is `opacity-64`** — the
actively maintained primitives (button, badge, input, select, textarea, tabs, menu) are
already there; the older set (checkbox, radio-group, sidebar, dropdown-menu,
onboarding-setup) is still on `opacity-50`. There is no semantic difference; it is an
unfinished migration. Move files to 64 as you touch them.

**Do not fade a saturated brand fill to produce a disabled state.** A 64%-opacity wine
button reads as a colour someone chose on purpose. Disabled uses the quiet control fill
plus `--ink-disabled` — see `composer-control.ts`, which documents exactly this.

### 11.6 Loading

Use the `loading` prop on `Button`. It sets `aria-disabled` rather than `disabled` (so
the label stays announceable), sets `data-loading`, makes the label transparent, and
overlays a `Spinner` — the label's width is preserved so the button does not resize.

It looks like §11.5: `data-loading:opacity-64` is the same fade as the disabled state, and
`data-loading:cursor-not-allowed` keeps the 1:1 cursor pairing of §11.7. What it
deliberately does **not** carry is `pointer-events-none` — the busy button stays
hoverable and focusable, so its tooltip still opens and the focus ring still lands on it.

Native `disabled` is the wrong tool here because it **ejects DOM focus to `<body>`**: a
keyboard student resolving one tracked change at a time would restart Tab from the top of
the page after every accept. The busy button stays focusable; `Button` refuses the
activation instead, with `preventDefault` so a busy submit button cannot post its form
again. **The one thing that behaviour does not cover is implicit submission** — Enter in a
field reaches the form directly, and a disabled default button used to block it. Any form
whose submit button uses `loading` needs its own re-entry guard in the submit handler
(`LoginRoute`, `RegisterRoute`, `ChatSessionActions`, `onboarding-setup` all have one).

### 11.7 Cursors

`cursor-pointer` on real click targets · `cursor-default` explicitly reset on menu and
list rows so the text caret doesn't leak · `cursor-not-allowed` paired 1:1 with disabled
· `cursor-grab`/`cursor-grabbing` on drag handles only · `cursor-text` on editable
surfaces · `cursor-col-resize` on resizers.

### 11.8 Touch targets

The pattern, which expands the hit area to 44px on coarse pointers without changing
visual size:

```
pointer-coarse:after:absolute pointer-coarse:after:size-full
pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11
```

It is baked into `buttonVariants` and `badgeVariants`, so every `Button` and `Badge`
gets it free. **It is missing from sidebar nav rows and table-row action buttons.** Any
bespoke icon-only clickable that is not a `Button` must add it explicitly.

---

## 12. Motion

### 12.1 The rules

1. **Motion clarifies flow or it does not ship.** No decorative animation.
2. **Animate `transform` and `opacity`.** Layout properties (`width`, `height`, `margin`,
   `top`/`left`) are a last resort, permitted only where there is genuinely no
   alternative — accordion height, sidebar width. Where we accept the cost, we say so in
   a comment (see `index.css`'s `.task-lane` note).
3. **Never `transition-all`.** Name the properties.
4. **Everything respects `prefers-reduced-motion`.**
5. **Hover is never a transform.**

### 12.2 The duration scale

A three-tier scale exists in practice. **It is not tokenised, and that is a known debt**
(§20). Until it is, use these values and only these:

| Tier | Value | Use |
|---|---|---|
| Fast | **150ms** `ease-out` | colour/state changes on controls: hover, press, focus |
| Base | **200ms** `ease-out` | enter/exit of surfaces: menus, dialogs, rails, panels |
| Slow | **340ms** `cubic-bezier(0.16, 1, 0.3, 1)` | list entrance, staged reveals |

Route transitions are **220ms `cubic-bezier(0.22, 1, 0.36, 1)`**. `100ms` is used for
overlay fades. `duration-[175ms]`, `duration-300`, and `duration-500` each appear once
or twice — treat them as outliers, not precedent.

### 12.3 Easings

- `ease-out` for anything entering or responding to input. This is the default.
- `cubic-bezier(0.22, 1, 0.36, 1)` — the route/shared-element curve.
- `cubic-bezier(0.16, 1, 0.3, 1)` — the expo-out list-entrance curve.
- Springs, for physical reordering: `{stiffness: 420, damping: 34, mass: 0.8}` (tasks),
  `{stiffness: 520, damping: 40, mass: 0.7}` (activities).

**All of these are currently copy-pasted across 2–4 files each.** They belong in a
`lib/motion.ts` (§20).

### 12.4 The vocabulary

| Slot | Implementation |
|---|---|
| Route enter/exit | `motion.div` in `WorkspaceOutlet` — fade + scale + y |
| List item enter/exit | `AnimatePresence` + `layout="position"` (tasks, activities) |
| List stagger | `sidebar-chat-in` keyframe, 22ms/row, **capped at 8 rows** |
| Shared element | `layoutId` — essay card → editor "paper", onboarding step frame |
| Surface enter | `motion-safe:animate-in fade-in slide-in-from-*`, 200ms |
| Hover / press | colour transition, 150ms — never transform |
| Streaming text | a pulsing block caret, `w-[0.55ch]` |
| Loading | `animate-spin` on a Lucide loader; `Skeleton` for placeholders |
| Expand / collapse | height transition + chevron rotate |

**There is exactly one custom `@keyframes` in the entire app** (`sidebar-chat-in`).
Everything else rides Tailwind/`tw-animate-css` utilities or `motion`'s JS animation.
Keep it that way — if you are reaching for a keyframe, ask what it clarifies.

### 12.5 Reduced motion

Three mechanisms, all valid, pick by context:

- **`motion-safe:` / `motion-reduce:` variants** — for utility-class animation. Prefer
  `motion-safe:` so content is visible by default and only the reveal is gated.
- **`@media (prefers-reduced-motion: reduce)`** — for CSS-authored animation.
- **`useReducedMotion()`** from `motion` — for `motion.*` components; collapse
  transform-based variants to opacity-only rather than removing the animation.

**Known gaps — fix on sight:** `spinner.tsx:12`, `sonner.tsx:24`, `AgentRunView.tsx:42`
(which is inconsistent with line 198 in the *same file*), and `ChatMessage.tsx:67`'s
streaming caret all use bare `animate-spin`/`animate-pulse` with no guard.

---

## 13. Content & copy

UX copy is design. These templates are the app's voice; do not improvise new ones.

### 13.1 Error state

> **"Could not load {things}"**
> "The workspace could not reach your {things} list."
> `[Try again]`

### 13.2 Empty state

Use the `Empty` primitive: icon + title + one sentence + one primary CTA (plus at most
one secondary).

> **"No schools yet"** / "Build your college list, then track deadlines, tasks, and essays from one place." / `[Add your first school]` `[Browse schools]`
> **"No activities yet"** / "Add your most important activity first." / `[Add activity]`
> **"No messages yet"** / "Ask a question to start this conversation."

### 13.3 Filtered-to-zero

Distinct from empty — the user has data, the filter hides it. Say which filter is
responsible and offer to relax it:

> **"No schools match"** / "{narrowest filter} is the narrowest filter — {N} schools match everything else." / `[Relax {filter}]` `[Clear all filters]`

### 13.4 Voice

- **Sentence case everywhere.** No Title Case buttons, no ALL CAPS except the one
  uppercase sidebar group label.
- **Second person, present tense.** "Add your most important activity first."
- **Say the noun.** "Add school", not "Add". "Try again", not "Retry".
- **Never blame the user, never blame "the system."** State what happened.
- **Never render an absent value as blank.** "not available", "No deadline",
  "Not classified", "Not opened".
- **Numbers get units and periods.** "{n} paste-ready", "3 steps remaining".

---

## 14. The status vocabulary

### 14.1 The badge contract

Every status system in the app routes through **five `Badge` variants** and no others:

| Variant | Tokens | Means |
|---|---|---|
| `success` | `--success-surface` / `--success-fg` | done · complete · submitted · ready |
| `warning` | `--warning-surface` / `--warning-fg` | waiting on someone · not ready |
| `error` (= `destructive`) | `--danger-surface` / `--danger-fg` | overdue · rejected · over limit |
| `secondary` (= `default`) | `--label-*` | **the ordinary state, and every category** |
| `outline` | `border-input` / `bg-background` | a non-status affordance |

**There is no `info` variant and there will not be one.** shadcn's contract has one;
`shadcn.css` deliberately omits it, with a comment, because a dangling `--info` is an
invitation to reintroduce the blue.

### 14.2 The mappings, and why

Each of these was wrong once, in a specific way that is written down at the site.

**Tasks** (`features/tasks/task-config.ts`) — the task model was rewritten (a task is
now open/done via `done_at`, with two dates — `when_on`/`deadline_on` — a `flagged`
boolean, and a derived label; `status`/`priority`/`category`/`assignee` no longer
drive any UI). **No `Badge` variant appears in the task list body at all** — zero
status badges, zero priority badges, zero category chips. Two deliberate refinements
of the old mapping below, cross-checked in full against this section in
`plans/tasks-redesign-design.md` §9.4:
- **The flag is `--brand` (wine), not `--danger-fg` (error).** `flagged` is the
  student's own mark on the task, the same claim `--brand` already makes for "the
  current selection" — and keeping it out of red is what lets red mean exactly one
  thing on the page: a date the world has already passed.
- **The deadline is plain text, not a badge: amber (`--warning-fg`) at ≤2 days out,
  red (`--danger-fg`) once overdue, nothing beyond 7 days or when absent.** Not the
  old 14-day error-badge threshold — fourteen days of red in a forty-row list is why
  the previous board read as an alarm; two days of amber and an ink-only overdue
  state let red mean "already missed" and nothing softer.

The old mapping (status → `waiting: warning`/`done: success`/`todo`,`doing:
secondary`; priority → `high: error`/`med`,`low: secondary`; category → one shared
`--label-*` chip; assignee → both `secondary`) is retired along with the columns
that drove it.

**Schools** (`features/schools/schools-config.ts`)
- `Accepted`/`Enrolled`/`Submitted`: success · `Rejected`: error ·
  `Deferred`/`Waitlisted`: warning · `Considering`/`Applying`/`Withdrawn`: secondary.
- **List type — Reach/Target/Safety are all `secondary`.** Colour for that ladder lives
  only on `ListBalanceBar`, as three steps of `--brand-scale-*`, because it is *ordered*,
  not categorical.
- Deadlines: ≤14 days → `error` badge; 15–60 days → "upcoming" (used by filters only);
  otherwise plain text.

**Essays** (`lib/essay-display.ts`)
- `Ready`/`Submitted`: success · `Needs review`: warning ·
  `Drafting`/`Not started`: secondary. Drafting used to be the loudest badge on the most
  common row on the page.

**Activities** (`features/activities/activities-config.ts`)
- `Ready` (success, always shown) · `Not ready` (warning, only if >0) ·
  `Over limit` (error, only if >0, **with an `AlertTriangle` icon**).
- Character budget: `empty` → `--ink-faint`, `ok` → muted, `near` (≥90%) → warning,
  `over` → danger + `font-medium`.

### 14.3 Status is never colour alone

Every status badge contains the **word**. Where severity matters, add a **glyph**:
`VerdictBand` marks a severe caveat with ink weight *and* an `AlertTriangle` *and* a
`title` — triple-redundant, and the right model.

Tool-call status uses **three genuinely distinct shapes**, not three colours of one dot:
an unfilled ring while running, a filled circle when it settles cleanly, a filled
diamond on error — so status still reads on hover, in print, and in colourblind-safe
views.

*Known violation: `school-cells.tsx`'s urgent-deadline badge is a red date and nothing
else — no icon, no label, no accessible name distinguishing it from any other date.*

---

## 15. The honesty surfaces

This is the part of the app that justifies the product. Treat changes here as
high-stakes.

### 15.1 Conversation

- Container `max-w-3xl mx-auto`, `gap-8` between turns, `role="log"`.
- **User** — right-aligned bubble, `max-w-[95%]`, `rounded-lg`,
  `bg-[--workspace-message-user-surface]`, `px-4 py-3`, `whitespace-pre-wrap`,
  `[overflow-wrap:anywhere]`.
- **Assistant** — no bubble, no background, full width. The answer is the page, not an
  object on it.
- **No avatars.** Alignment and surface carry speaker identity.
- **Scroll is question-anchored, not bottom-chasing.** On send, the new question anchors
  near the *top* of the viewport once and the answer streams down below it. The app
  never fights user scroll — position is forced only on session-open and on-send. This is
  a deliberate rejection of the standard `use-stick-to-bottom` pattern.

### 15.2 Work visibility

Events (`step`/`narration`/`thinking`/`viz`/`clarify`/…) reduce to a **flat,
chronologically-ordered segment list**. Narration, tool calls, thinking, user steering,
answer text and viz cards all interleave in stream-arrival order. This is one continuous
timeline — **not** a collapsed reasoning drawer plus a separate final answer.

- **Every tool beat shares one grid:** `grid-cols-[16px_minmax(0,1fr)] gap-3 py-2` — a
  16px icon rail and a content column, so every family shares one baseline.
- **Plan checklist** pins above the stream, inset card, `Meter` progress, per-step icons.
- **Thinking is collapsed by default**, coalesced into one block per continuous episode,
  labelled "Thinking" (pulsing) while live and "Thought" once settled.
- **Mutation receipts** are collapsed by default — but a failure's first actionable issue
  renders *outside* the collapsed region. **Never hide an error behind a click.**
- Loading uses two staggered-width `Skeleton` bars, not a generic shimmer block.

### 15.3 Citation grammar — the highest-stakes UI in the app

- Markers are `[3]` or `[3, 5, 12]`, 1-indexed. One regex (`CITATION_PATTERN`) is shared
  by the renderer and the source-detection scan **so they can never disagree about what
  counts as a citation.**
- A remark plugin converts markers in `text` nodes only — a `[7]` inside a code span is
  never converted.
- **A chip is never a bare bracketed index.** One chip shape for every source kind, with
  a favicon (school domain → generic school icon → site favicon → globe), rendered as a
  real keyboard-operable `<button>`. This is a chat answer, not a research paper's
  footnote.
- **A marker whose source has not arrived renders nothing.** Never a bare, unexplained
  mark. An ambiguous index (two sources claiming it) also renders nothing rather than
  guessing.
- Chips are injected via `createPortal` into placeholder spans, because Streamdown caches
  a block's rendered output by element identity once its text stops changing — a chip
  rendered during the first streaming pass would otherwise freeze with a stale source
  closure. **If you touch `CitationRenderer.tsx`, read the comment first.**
- Hover card: source label + tier badge (`Official` / `Community`), a meta line that
  omits anything the label already said, a `line-clamp-4` snippet, and a link row showing
  the truncated path rather than the raw URL.

### 15.4 Sources rail

- Desktop: fixed `w-[26rem]` `<aside>`, docked right, on the **shell sidebar's own
  surface** — `bg-sidebar`, `border-s-sidebar-border`. It is chrome, not canvas, and it
  reads as one plane with the left rail. Mobile: full-width `Sheet` on the same surface.
- **The rail is flat.** A source is a row, not a card: no fill, no border, no shadow, and
  **no divider** at rest. Rhythm comes from spacing (`px-3 py-3`, `gap-0.5`, list inset
  `p-2`), not from boxes. The favicon sits directly on the surface — no framed tile.
- **A fill only appears when the row reacts**, and then it is card-shaped
  (`rounded-lg`, inset from the panel edges by the list's own padding): `--sidebar-accent`
  on hover/keyboard focus, `--sidebar-active` — the sidebar's selected-row colour — for a
  citation highlight. `transition-colors duration-200 ease-out`; one duration, because
  hover and highlight ride the same property.
- **The row is the link.** The title anchor stretches over the row
  (`after:absolute after:inset-0`), so a click anywhere opens the source in a new tab.
  The rail has **no selection state** — clicking a row never restyles it.
- **A citation highlight is transient.** Clicking a chip opens the rail, focuses that
  exact source (or that exact evidence row), scrolls it into view respecting reduced
  motion, and lights it for `HIGHLIGHT_MS` (1.8s) before fading back. The panel never
  sits there wearing a stale mark.
- CDS/profile sources nest **evidence rows** indented under the title: label,
  `tabular-nums` value, `Page N · Section · Row · Column`, and an italic excerpt. Omitted
  evidence is disclosed: "…and {n} more values from this document." When a row nests
  evidence, the anchor's stretch is scoped to the header block so excerpts stay
  selectable.

### 15.4.1 The chat's document panel

The other right rail. **Only one is ever open**: `AiChatPage` holds a single
`RightPanel` discriminated union (`{kind: "sources"} | {kind: "document"} | null`), so
opening a document closes the sources rail and opening a citation closes the document.
Two competing right rails is worse than one that swaps.

- **Docked on the measured row, never on the viewport.** `w-[36rem]` (576px) of panel plus
  a 424px floor for the chat column beside it is `MIN_DOCK_ROW_PX` = 1000px of *row*
  (`EssayDocumentPanel.tsx`), read off the panel's own parent with a `ResizeObserver`.
  A viewport breakpoint is wrong by a whole sidebar: 312px expanded, far less collapsed.
  Keyed to `innerWidth >= 1024` the aside was shoved past the right edge between 1024 and
  1141px and clipped every line of the essay with no horizontal scrollbar to recover it.
  Same lesson as `essay-paper-inset.ts` one level up. The aside stays mounted below the
  threshold (`hidden`, no children) because it is what measures the row. Below it the
  document is a full-width `Sheet`, because the chat column left over would be narrower
  than the composer in it. No resizable divider.
- It hosts `EssayDocumentSurface` at `density="panel"`: the same paper, the same tracked
  changes, the same hover accept/reject popover, and the same `SuggestionsBar` as the full
  editor — the bar is the only place a change one comma wide stays findable and the only
  thing that announces the count to a screen reader, so the panel built to show proposed
  edits is the last place to drop it. The paper's inset comes from the one scale in
  `essay-paper-inset.ts`, stepped by the panel's own scroll column
  (`@container/essay-canvas`) — never a second hand-tuned ladder. The column caps its
  content at `max-w-[40rem]`, tighter than the editor page's 820px: docked that ceiling is
  never reached (544px column, measured 475px of prose, ~69 characters), but in the Sheet
  the editor's ceiling gave 724px of prose at 106 characters a line — a *worse* measure on
  the wider surface. 640px holds the Sheet to a measured 510px of prose (~74 characters),
  the docked rhythm.
- **The panel sits at canvas level, deliberately** — `--essay-editor-chrome-surface`,
  where the sources arm of the same slot sits at chrome level (`bg-sidebar`, §15.4). The
  two arms therefore differ in material, not only in contents. That is the point: this arm
  is the editor's own chrome, and "Open in editor" morphs the paper straight into it, so
  matching the editor is worth more here than matching the rail it replaces.
- **Non-modal when docked.** The student keeps reading the answer that produced the edit.
  Enter/exit is the rail's own 200ms `ease-out` `slide-in-from-right-2`; Escape closes it,
  and only when nothing nearer the key has already defaulted the event.
- **Closing returns focus to whatever opened it** — the mutation-receipt door, or the
  citation chip for the sources arm. `AiChatPage` captures `document.activeElement` on
  open and refocuses it before the panel unmounts.
- **The receipt is the door.** A settled essay mutation receipt's glance line becomes a
  `<button>` labelled `Open {title} — {glance}`. Its ink is identical to the non-door
  glance lines above it, so the resting underline is the whole static cue and has to clear
  1.4.11 on its own: `--ink-faint` (5.28:1), an ink token for a text decoration, one step
  quieter than the label. Ink and rule go to full strength on hover over 150ms.
  `min-h-6` for SC 2.5.8's 24px floor — not the disclosure trigger's `min-h-11`, which on
  a 20px glance line would pull the label off the icon beside it. A **running** or
  **failed** receipt is never a door: mid-write there is nothing stable to open, and after
  a failure a click that says "see your edit" would promise a document that was never
  written.
- **"Open in editor"** is a real shared-element transition, not a fade: the panel's paper
  and the editor page's paper carry the same `essay-document-${id}` `layoutId` under
  `WorkspaceOutlet`'s `LayoutGroup`, so the sheet flies from the 576px column into the
  820px page. The layout tween is **420ms `cubic-bezier(0.22, 1, 0.36, 1)`**, inherited
  from the editor route since MVP3 — off §12.2's scale and tracked as a debt in §20; it is
  not "the route curve", which is 220ms. `layoutDependency` is the paper's `density`, the
  one value that differs across the handoff: pinned to `layoutId` — identical on both
  sides — motion never re-measured across it and the morph degraded to a jump.

### 15.5 Visualisations

There is **no charting library.** "Viz" means typed tabular render specs:
`stat_block` (a `<dl>`) and `comparison_table` (schools as columns, metrics as rows).

- **Every cell is a citation envelope.** Unavailable cells render *"not available"* in
  muted italic — never blank, never a dash.
- **No colour is assigned to series or schools.** Differentiation is structural — columns,
  favicons, labels. Decorative colour implying data meaning is exactly the kind of lie
  §1.1 forbids.
- An unrecognised spec version renders "This visualization requires a newer client."
  inside the normal frame, so it reads as forward-compatibility rather than breakage.

### 15.6 Tracked changes

The agent's edits to a student's essay arrive as **proposals**, not writes. They are
painted into the ProseMirror document as decorations — a `<del>` around text the agent
wants removed, an `<ins>` widget carrying text it wants added — and nothing lands in the
essay until the student accepts it.

- **The document is the source of truth for where a change goes.** A suggestion is
  anchored by searching the document for its text, never by a stored position, so a
  drifting offset can never point a change at the wrong words.
- **Stale is shown, never hidden.** When the student edits the text a change was written
  against, that change is no longer applicable: its line goes dotted and grey and it
  stays on the page, inert. A proposal that silently vanished would leave the student
  thinking it was applied. Only the **line** dims — the words under a stale change are
  the student's own essay and stay at full ink, which makes that line the sole channel
  carrying "stale" and so a graphical state indicator owing 3:1 (1.4.11). Stale is
  derived against the live document every time — it is never a flag the server sends.
- **Ambiguity is stale too.** If a change's text appears twice in the document, there is
  no honest way to pick one, so it goes stale rather than guessing.
- **The trim is presentation only.** "Add a sentence here" is stored as a replacement
  that extends the existing one, so the shared head and tail are trimmed away before
  painting and only the genuinely new words go green. Nothing trimmed is ever sent back.

| Token | Resolves to | Claim |
|---|---|---|
| `--essay-suggestion-insert-ink` | `--success-fg` (leaf-700, 7.87:1) | text being **added** — applied as **ink** |
| `--essay-suggestion-insert-surface` | `--success-surface` | hover wash behind an insertion |
| `--essay-suggestion-delete-ink` | `--danger-fg` (red-700, 9.84:1) | text being **removed** — applied as the **strike colour only** |
| `--essay-suggestion-delete-surface` | `--danger-surface` | hover wash behind a deletion |
| `--essay-suggestion-stale-ink` | `--ink-faint` (gray-700, 5.45:1) | a change that can no longer be applied — the **dotted line only** |

Success and danger are the right hues under §2.2 Law 2 (something added, something
removed), but "ready" and "proposed" are two claims on one hue — so the decorations take
their own family tokens in `essay.css` rather than the role tokens directly, and a
suggestion can never read as a status. At rest a change is ink plus one line; the wash
arrives on hover, because a permanent colour block through the student's own prose is
harder to read than the prose it annotates.

**The two hues are not applied the same way, because the two spans do not have the same
owner.** An insertion is the agent's words — not in the document, not the student's — so
its *ink* is green, and the colour is carrying real information: these words are not
yours yet. A deletion, a stale change, and everything under them is **the student's own
sentence**, still theirs and still on the page, so only the *line* is coloured and the
words keep the document's own ink. Recolouring them was measured as the loudest thing on
the screen: the essay's prose is `--document-foreground` at chroma 0.01 and `--danger-fg`
is chroma 0.16, so a struck sentence carried sixteen times the chroma of the sentences
around it — on a 580-word draft with five changes, three full lines of the opening
paragraph rendered as damage rather than as annotation. The line alone still carries the
claim at 9.84:1, far past the 3:1 WCAG 1.4.11 asks of a graphical state indicator, and
solid-red against dotted-grey keeps deletion and stale apart in two channels at once.
**This is one rule, not two:** the student's words are always the student's ink, and the
line is what says what is being proposed about them.

**Two fragments that touch are separated by the decoration builder, never by a sibling
selector.** Marks rendered back to back weld into one: `good`/`north` reads as `goodnorth`,
and two separately-decidable deletions divided only by an unstruck full stop become a
single red bar over two decisions. `buildDecorations` knows both ranges, so it compares
positions and hangs `.essay-suggestion-abuts` on the later fragment; the stylesheet holds
one flat rule. CSS adjacency cannot do this job, and two attempts proved it: `bracket()`
puts a varying number of id-less screen-reader markers between any two fragments — one
hop for a replacement, two for a pair of deletions — so `[data-suggestion-id] +
[data-suggestion-id]` separated nothing, and adding one `.sr-only` hop separated
replacements only, leaving abutting deletions measured at 0.00px. `+` also skips text
nodes, so whichever arm did fire padded pairs with whole words of prose between them.
jsdom does not lay out, so only a browser can catch this class of bug.

The rules are plain selectors, not React components — ProseMirror renders this DOM itself
— so they live in `styles/essay-suggestions.css`, which carries its own `@layer
components` wrapper so that the layer order `index.css` declares still decides when they
apply. The `--essay-suggestion-*` tokens they resolve stay in `essay.css` with the rest of
the essay family (§2.1 tier 3); their `-ink` suffix names the colour, not the property, so
the delete and stale tokens reach the page as `text-decoration-color`.

**One change, one hover target.** A replacement paints as a struck span plus a proposed
one, and a change crossing a paragraph break paints one fragment per block — so hovering
any fragment washes *every* fragment of that change. Half a change lighting up misreads
one decision as two. The hovered id is plugin state and the wash is a decoration, never
an attribute written onto the rendered spans: the editor treats a foreign attribute
inside its own DOM as interference, reverts it, and the redraw re-fires the pointer
event that set it.

Never bind bare `Enter`, `Backspace` or `Delete` to accept or reject. Inside a
`contenteditable` those mean "new paragraph" and "delete a character", so a student
typing near a pending change would resolve it by accident — and an accidental accept is
silent. `Mod+Enter` accepts, `Mod+Backspace` rejects, `Alt+.`/`Alt+,` move between
pending changes.

**Accept and Reject are peers.** `ResolveButtons`
(`features/essays/suggestions/ResolveButtons.tsx`) is the one component that renders the
pair, used by both the hover popover and every row of the pending-changes bar — the two
places are not merely shaped alike, they carry the same rule about how a student's own
writing may be rewritten. Both buttons are `variant="outline"`; a bordered Accept beside
a ghost Reject reads as a recommendation, and the essay is not improved by default. The
same component owns the busy lock (`aria-disabled` plus `opacity-64`, never native
`disabled` — §11.6) and the accessible name: a row's control is `Accept: Replace good →
unforgettable`, never a sixth button called "Accept".

**Neither icon is tinted**, for the same reason the variants match. The check used to take
`--essay-suggestion-insert-ink` and the cross `--essay-suggestion-delete-ink`, which broke
that symmetry and made two claims that are not true. Those tokens mean "text being added"
and "text being removed" — but Accept is just as often accepting a *deletion*, so a green
check on that row states the opposite of what the row does; and red marked the **safe**
choice as the dangerous one, when rejecting changes nothing and accepting rewrites the
student's sentence with no undo. Across a five-row queue it also put ten alarm-coloured
glyphs in a 130px band, which is the merge-conflict chrome the decorations themselves are
kept clear of. The words carry the meaning, as everywhere else in the app.

**Nothing bulk before the list is open.** The pending-changes bar is collapsed by
default, and its "Accept all"/"Reject all" only exist once it is expanded. Collapsed, the
loudest control in the editor was an Accept-all a student met before seeing a single one
of the changes it applies.

**A short change carries its context.** Under 12 characters the trimmed preview is not a
description of anything — `Replace , → ;` says a semicolon belongs somewhere in a
650-word essay — so `suggestion-preview.ts` appends a quoted window of the student's own
text around the change point. That window is presentation only, from the `_plain` fields,
same as the trim.

**Focus advances so the queue can be cleared without leaving it.** Resolution is
serialized and non-optimistic, so the row that was pressed stays in the DOM, busy, until
the server confirms — and then leaves, taking a keyboard student's focus to `<body>` and
restarting the next Tab at the top of the page. The bar therefore moves focus to the row
that took its place, or the row above it when the last one goes, or the disclosure, or —
when the bar itself is leaving — back into the document, which is where the popover and
`Mod+Enter` paths already put the caret. It arms only when focus was genuinely inside the
bar (a pointer click never focuses these buttons at all, by design), and it fires on the
resolved row *leaving the list* rather than on the lock clearing, because those two arrive
in separate renders. Nothing new is announced: the row's control is already named for its
change, so landing on it says what it is, and a second live region is exactly the double
announcement `PendingChangesReadout`'s `announce` default exists to prevent.

**The word count says what it would become.** Beside "648 / 650 words" the header appends
"· 631 if you accept all" whenever that number is knowable. It is not a sum of per-change
deltas: accepting is cumulative, so overlapping changes get skipped rather than applied,
and `countWords` counts runs of non-whitespace, so a change can merge or split words at
its own edges without changing any of its own. `word-projection.ts` rebuilds the text the
student would be left with — in the same string space the header already counts — and
counts it. Where it cannot be sure (a change spanning a paragraph break, overlapping
anchors, an anchor it cannot re-find, or its own reading of the document disagreeing with
the count on screen) it says nothing at all. **A wrong number in a student's word budget
is worse than no number**, and the clause is the added part of that segment, so it is also
the first thing to drop when the header gets tight (`xl:` — measured: at 1024 a realistic
title loses half its width to it).

**Outdated changes sink, and keep their text.** Rows are ordered by document position so
a student working top-to-bottom is not bounced around their own essay, and stale rows
sort last because they are the only ones that cannot be acted on. A stale row says
"Outdated" in the verb slot and keeps its preview at `--essay-suggestion-stale-ink`;
replacing the preview with the status would hide what the row was ever about. Its one
control is Dismiss, which rejects that single change — a rejection cannot fail, and
Reject-all would take the pending proposals with it. The list is capped at `max-h-64` and
scrolls: eight pending changes is an ordinary revision pass, and an uncapped list of them
pushes the essay it annotates off the bottom of the screen.

**The row gap opens up on a coarse pointer, and only there** (`pointer-coarse:gap-y-5`).
`ResolveButtons` works the *horizontal* touch arithmetic out carefully — measured 10px
between the two hit areas once the labels collapse — but the vertical axis was left at the
dense `gap-y-0.5` while `buttonVariants` grows every row control to a 44px target. Measured
at 375px on a real touch context: a 32px button on a 34px row pitch, so each row's hit area
**overlapped the next one's by 10px**, and what a stray thumb lands on is an Accept that
rewrites the student's sentence with no undo. 20px takes the pitch to 52px and leaves a
true 8px dead zone. Fine pointers keep the dense list, so the eight-row shape above is
unchanged wherever it is actually real.

**The list's top margin opens up with the gap** (`pointer-coarse:mt-5`), because the seam
it guards is the worst one on the surface. Widening the row gap and leaving `mt-1.5` alone
left `Reject all` — the safest control here, the one that changes nothing — overlapping
row 1's Accept: measured on a real touch context at 295→339 against 333→377, a **6px
overlap and no dead zone at all**. It resolved to the safe control only because the row's
`::after` is clipped by the list's own overflow, which is an accident of a clip and not a
decision. Matching the row gap puts a true 8px there too.

### 15.6.1 The essay chat panel

Docked at **1280px and up** (`PANEL_DOCK_BREAKPOINT_PX` in `EssayEditorRoute.tsx`), where
it takes its 380px out of the row and the document reflows into what is left. **Below
that it covers the document instead of splitting it.** Both halves are measured, not
assumed: reserving 380px at 1024px leaves a 276px sheet of paper and a measure of
eighteen characters a line, and an overlay that only covers *part* of the prose slices
every line mid-sentence and reads as a rendering bug. Covered, the scroll column is
`inert` — content nobody can see is content nobody should be able to Tab into. The panel
is never a `Sheet`: it is non-modal by design, because the student keeps editing the
essay and accepting changes while it is open.

The paper's and the bar's padding steps are **container queries on the scroll column**
(`@container/essay-canvas`, one scale in `essay-paper-inset.ts`, shared by both so a row
label starts where the sentence it describes starts). Viewport steps were the bug: a
`lg:px-16` keyed off the window kept paying 64px margins on a sheet of paper that no
longer had the room.

Opening animates the panel's **width** over 200ms `ease-out` — the accordion carve-out of
§12.1 rule 2, so the paper follows it frame for frame. The paper's own `layoutId` gets
`layoutDependency={density}`, which pins its 420ms shared-element curve to a change of
*surface*; without a dependency a panel toggle fired that curve on one edge while the bar
resized on the next frame. Density is constant within the editor route, so the toggle is
still unanimated — and it does differ across the chat panel → editor handoff, which is the
one transition the `layoutId` exists for. See §15.4.1.

### 15.7 Composer

`rounded-2xl` panel, `min-h-28`, focus-within border swap plus a 30% ring. Chip toolbar
with an explicit internal rhythm (`10px | icon 16 | 6px | label | 4px | chevron 14 | 8px`).
Enter submits, Shift+Enter newlines, IME composition is respected, and the skill picker
intercepts keys first. The send button toggles to a stop square while streaming.

The essay panel's **selection chip** sits *above* the textarea, not in the chip toolbar
below it: what the student highlighted is the subject of the sentence they are about to
write, not a third preference beside "Sources". It is a `Badge` with a `TextQuote` icon
and a bespoke clear button, which therefore carries §11.8's coarse-pointer block by hand.

Directly under it, and only while it is there, sit the **three selection-scoped verbs**
("Make specific" / "Tighten" / "Show, don't tell", from `essay-quick-actions.ts` — the one
list the panel's empty state also reads). Each sends its full prompt the moment it is
pressed. Three things make them read as actions rather than as more settings:

- **`variant="outline"`, not the composer's soft-fill chip.** The chips *below* the
  textarea open menus; these send a message. Same composer, two consequences, so they must
  not look like one family. Everything tactile is `buttonVariants`' own — the 150ms colour
  hover, the rim-light that flips to a depression on press, the focus ring, §11.8's hit
  area. Nothing is redrawn locally.
- **`rounded-md`** (§5: "a control inside a control"), at `text-[13px]` with the explicit
  `sm:` twin §6.3 warns about, and content-sized rather than a uniform pill row.
- **Position is the whole affordance.** Each verb says "this"; the quoted selection
  directly above is what gives "this" a referent, so the row is never rendered without it.

Measured: 32px tall on desktop / 36px on mobile, `gap-2` giving a true 8px between hit
areas (the buttons are wider than 44px, so the coarse-pointer block grows them only
vertically), one line in the docked 380px panel and a clean two-line wrap at 375px.

---

## 16. Accessibility

**Baseline: WCAG 2.2 AA.**

### 16.1 What's required

- **Landmarks.** `<main>` (via `SidebarInset`), `<nav aria-label>`, `<header>`,
  `<aside>`. Every page lives inside `<main>` already — do not nest another.
- **Every icon-only control has an `aria-label`.** Every decorative icon has
  `aria-hidden="true"`.
- **Images that duplicate adjacent text take `alt=""`.** All ten `alt` attributes in the
  app are correctly empty (favicons and avatars beside a visible name). If you add an
  image whose content is *not* described by adjacent text, it needs real alt text.
- **Errors:** `role="alert"` on the message, `aria-invalid` on the field,
  `aria-describedby` linking them.
- **Live regions:** `aria-live="polite"` on streaming and count-changing regions. Nothing
  in this app warrants `assertive`.
- **Toggles** use `aria-pressed`; **current items** use `aria-current="page"`.
- **Keyboard:** every interactive element reachable and operable; Escape closes every
  overlay; focus traps come from Radix/Base UI — never hand-roll one.
- **Focus rings** per §11.4. Drag handles are the classic place a ring gets forgotten —
  check them.
- **Reduced motion** per §12.5.
- **Status carries a word or a shape**, not only a hue (§14.3).

### 16.2 Known gaps

1. **No skip link.** A persistent `<nav>` sits before `<main>` on every route and there
   is no way past it. This is the most impactful open a11y item.
2. **No `aria-busy`** anywhere, despite several multi-chunk streaming regions — screen
   readers announce partial updates.
3. **`pointer-coarse` touch expansion** missing on sidebar nav rows and table-row actions.
4. **No CI contrast check** (§3.3).
5. **`role="alertdialog"`** is not used on destructive confirmations.

---

## 17. Surface patterns

These are the recurring shapes. Match them; do not invent a sixth.

### 17.1 The card

`rounded-xl` · `border` (`--edge` at rest, `--edge-strong` on hover) ·
`--surface-raised` fill · `--elevation-1`. **Hover changes border colour only** — no
shadow escalation, no transform. Applies to school cards, task cards, essay cards, and
activity rows alike.

### 17.2 The two legal container shapes

- **A list** — one raised panel, rows separated by `--hairline` rules.
- **A board** — a borderless `--surface-inset` trough holding raised cards.

Never both at once. Never a card inside a card.

### 17.3 The editing model

**Autosave on blur. No Save/Cancel buttons.** Local draft state, commit on blur or on
discrete-control click, PATCH as a minimal merge-patch, errors surfaced as an inline
message or a button state — never a blocking modal. Used by profile, essays, tasks, and
the school workspace.

### 17.4 Destructive actions

**Optimistic mutation plus a 5-second undo toast.** Used by schools (archive), essays
(archive), and activities (delete) via the shared `useUndoableDelete`.
*(Tasks' bulk keyboard delete has no undo — that is a gap, not a variant.)*

### 17.5 Drag and drop

Native HTML5 DnD everywhere. No dnd-kit, no react-beautiful-dnd. Drags are **armed by
pointerdown on a grip handle only**, so clicking a row never starts one. Drag-over
**live-reorders in real time** with a preview committed on drop or discarded on Escape.

### 17.6 Tables

Resizable columns via pointer drag or arrow keys (±16px, ±32px with Shift). Default
widths live in the feature's `*-config.ts`. Below `md:`, tables become card stacks.

---

## 18. Testing the design system

- **Do not write reflexive UI tests.** A test earns its place: an honesty-critical
  behaviour, a bug you want to stay fixed, or logic gnarly enough that a test is the
  fastest way to trust it.
- **Do test** citation resolution, availability/"not available" rendering, evidence
  display, and status mapping — these are §1.1 surfaces.
- **Do test** ARIA structure with axe (`*-a11y.test.tsx`) — while knowing it cannot
  verify colour contrast in jsdom.
- Run `cd frontend && npm run typecheck && npm test` before you call anything done.

---

## 19. The rules — the enforceable list

**Colour**
1. No colour literal outside `primitives.css`.
2. No raw Tailwind palette class (`bg-red-500`, `text-slate-400`) anywhere.
3. No tier-3 file referencing a tier-1 primitive.
4. No new ramp without deleting one, or a written decision.
5. One claim per hue; the ordinary state gets no hue; ordered data gets one hue at
   several intensities.
6. No `info`/blue.
7. No `dark:` variants.

**Surface & depth**
8. Four surface roles; the role follows what the container does, not who owns it.
9. One raised level per page; a card never contains a card.
10. An inset surface never draws a border.
11. `--elevation-1` is the only shadow tier that may share an element with a border.
12. Z-index comes from `--z-*`.

**Shape, type, space**
13. Radius from the `--radius-*` ladder; `xl`=card, `lg`=control, `md`=nested control.
14. Type from the scale; `text-sm` is the default; no `font-bold`; no hero type.
15. Spacing from 1 / 1.5 / 2 / 3 / 4 / 6.
16. Icons are Lucide, sized by the container's variant, never at the call site.
17. Prose is measure-capped (≤70ch).

**Components**
18. Search the registries before building (§10.1).
19. Extend existing components; a refactor is its own change, never smuggled in.
20. `data-slot` on every part; `cn()` for every className; `cva` for variants.
21. No second implementation of an existing pattern.

**States**
22. Hover 4%, pressed 7%, mixed `in oklab`, from the existing tokens.
23. Cards hover on border, controls hover on background, only the CTA hovers on shadow.
24. Every interactive element has a visible `focus-visible` ring.
25. Disabled is `opacity-64` plus the quiet fill — never a faded brand fill.
26. 44px touch targets on coarse pointers.

**Motion**
27. Durations 150 / 200 / 340ms; easings from §12.3.
28. `transform` and `opacity` only, unless the exception is commented.
29. Never `transition-all`.
30. Everything respects `prefers-reduced-motion`.
31. Hover is never a transform.

**Content**
32. Error, empty, and filtered-to-zero use the §13 templates.
33. Sentence case; second person; say the noun.
34. An absent value renders as words, never as blank.

**Honesty**
35. Status is never colour alone.
36. A citation marker without a resolved source renders nothing.
37. An unavailable value renders "not available".
38. A failure's first actionable issue is never hidden behind a disclosure.
39. No decorative colour that implies data meaning.

**Accessibility**
40. Landmarks, labels, `aria-hidden` on decorative icons, `role="alert"` on errors,
    keyboard operability, and Escape on every overlay.

---

## 20. Known debts

Ranked. Each is small; none is speculative.

| # | Debt | Where |
|---|---|---|
| 1 | **No skip link** | shell |
| 2 | **Motion constants are copy-pasted** — `[0.22,1,0.36,1]` in 4 files, two spring presets in 2 files each. Extract `lib/motion.ts`. | tasks, activities, essays, onboarding |
| 3 | **No duration/easing tokens** — the scale is real but every value is a literal | app-wide |
| 4 | **`bg-info` is a dead class.** `EssayEditorHeader.tsx:16` maps `Drafting` to `bg-info`, but `--color-info` was deleted — the dot renders with no fill. | essays |
| 5 | ~~Three routes bypass `PageContainer` and have drifted (`pr-8 pl-6 md:pr-10`)~~ **Closed for Tasks** — `TasksLayout.tsx` now renders through `PageContainer`. Essays and Schools are unchanged. | Essays, Schools |
| 6 | **`RouteSurface` is a third header shape** (`h-14`, `text-base`, `px-5`) | /app/calendar |
| 7 | **Reduced-motion gaps on spinners** — `spinner.tsx:12`, `sonner.tsx:24`, `AgentRunView.tsx:42`, `ChatMessage.tsx:67` | app-wide |
| 8 | **Two dropdown-menu implementations** — `ui/menu.tsx` (Base UI, aliased as `DropdownMenu*`, 3 importers) and `ui/dropdown-menu.tsx` (Radix, 10 importers). Same import name, different library. | ui |
| 9 | **`AiComposer.tsx` and `ChatComposer.tsx`** are ~280-line near-duplicates | ai-composer, ai-chat |
| 10 | **Nine unused `ai-elements` files** with zero importers | components/ai-elements |
| 11 | **Disabled opacity split** 50 vs 64 | ui |
| 12 | **Focus ring width split** 2px vs 3px on form controls | ui |
| 13 | **`text-[13px]` scattered** in 22 places; promote to a `text-chrome` token. **Partially closed:** `--text-chrome` (`theme.css`) now exists and Tasks uses it in its five sites (group headers, scheduler rows, hint chips, nudge, footer). The other sites app-wide still need the sweep. | app-wide |
| 14 | **Colour-only urgent deadline badge** | `school-cells.tsx` |
| 15 | **No `aria-busy`** on streaming regions | ai-chat |
| 16 | **Popup chrome copy-pasted** across `menu`/`popover`/`select` | ui |
| 17 | ~~`zIndex: 2147483647` off the `--z-*` scale~~ **Closed** — `useTaskDrag.ts` is deleted; the tasks redesign has no drag code. | ~~`useTaskDrag.ts:110`~~ |
| 18 | **Duplicated constants** — `UNDO_WINDOW_MS`, `MIN/MAX_CYCLE_YEAR`, `86_400_000` | activities, schools, tasks |
| 19 | ~~`dayDiff <= 6` vs `<= 7` — two definitions of "this week" in one feature~~ **Closed** — one `getDeadlineState` in `task-dates.ts` (`<= 7` for "normal", `<= 2` for "due soon") is now the single definition; the second copy is gone. | ~~tasks~~ |
| 20 | ~~No undo on task bulk delete~~ **Moot** — bulk actions and multi-select are deleted; there is no bulk delete to undo. | ~~tasks~~ |
| 21 | **Two colour literals** — `AppSidebar.tsx:164`, `number-field.tsx:141` | shell, ui |
| 22 | **Dead tokens** — `--essay-library-card-hover`, `--essay-editor-toolbar-border` | essay.css |
| 23 | **`transition-all` in 4 files** — violates rule 29; name the properties instead | `sidebar.tsx`, `accordion.tsx`, `meter.tsx`, `sheet.tsx` |
| 24 | **Onboarding aliases Profile's tokens** rather than semantic ones | onboarding.css |
| 25 | **The 420ms shared-element layout tween is off §12.2's scale** — `EssayDocumentSurface.tsx:125`, inherited from the editor route since MVP3. It is the paper's card → editor → panel morph, not the 220ms route curve; either fold it into the scale or name it a fifth tier. | essays |

---

## 21. Review checklist

Paste into the PR when the diff touches `frontend/`.

```
Tokens
- [ ] No colour literal outside primitives.css
- [ ] No raw Tailwind palette class
- [ ] No tier-3 file reaching a tier-1 primitive
- [ ] Any new token is in the right tier, named --{family}-{role}[-{state}]

Colour & surface
- [ ] Every hue makes exactly one claim; the ordinary state has none
- [ ] Surface role follows what the container does
- [ ] One raised level; no card inside a card; no border on an inset
- [ ] Shadow tier and border are compatible

Shape / type / space
- [ ] Radius from the ladder, and it means what the ladder says
- [ ] Type from the scale; no font-bold; prose measure-capped
- [ ] Spacing from 1/1.5/2/3/4/6
- [ ] Icons sized by the container, not the call site

Components
- [ ] Registries searched before anything new was built
- [ ] Existing component extended, not duplicated or rewritten in passing
- [ ] data-slot present; cn() used; cva for variants

States
- [ ] Hover/press use the 4%/7% tokens
- [ ] Cards hover on border; controls on background
- [ ] Visible focus-visible ring on every interactive element
- [ ] Disabled: opacity-64 + quiet fill
- [ ] 44px coarse-pointer target

Motion
- [ ] 150/200/340ms; easing from the list
- [ ] transform/opacity only (or the exception is commented)
- [ ] No transition-all
- [ ] prefers-reduced-motion handled

Content & honesty
- [ ] Error/empty/filtered-to-zero use the templates
- [ ] Sentence case; says the noun
- [ ] Absent values render as words
- [ ] Status carries a word or a shape, not just a hue
- [ ] Citations: no bare marker, no unresolved chip, no hidden failure

A11y
- [ ] Labels on icon-only controls; aria-hidden on decorative icons
- [ ] Errors: role="alert" + aria-invalid + aria-describedby
- [ ] Keyboard-operable; Escape closes overlays

Docs
- [ ] DESIGN.md updated if the system changed
- [ ] The "why" is a comment at the site, not just in the PR
```

### 21.1 Grep checks

```bash
cd frontend

# Law 1 — colour literals outside primitives.css (expect: 2 known)
rg -n '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(' src --glob '!src/styles/primitives.css'

# Law 1 — raw Tailwind palette classes (expect: 0)
rg -n '\b(bg|text|border|ring)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}\b' src

# Tier violations — primitives reached from a family file (expect: 0)
rg -n -- '--(gray|wine|red|amber|leaf)-[0-9]' \
  src/styles/{shell,workspace,task,onboarding,activity,essay,profile,schools,shadcn}.css

# Banned motion
rg -n 'transition-all' src

# Off-scale durations
rg -o --no-filename 'duration-\[?[0-9]+m?s?\]?' src | sort | uniq -c | sort -rn
```

These are cheap enough to run by hand every time and are the obvious first candidates
for a CI step. No lint rule currently enforces any of this — the discipline is real and
entirely human, which is why it is written down here.

---

## 22. Playbooks

**Adding a component.** Search registries (§10.1) → if nothing fits, check whether an
existing primitive extends → build in `components/ui/` with `data-slot`, `cva`, and the
icon/touch/disabled base rules → wire colours through existing semantic tokens → hover,
press, focus, disabled, loading, empty → keyboard and label → reduced motion.

**Adding a page.** `PageContainer` with a `title` and a `width` tier → the page owns its
scroll → build from §17's shapes → write the three states from §13 first, before the
happy path → check it at 375px, 768px, and 1440px.

**Adding a status.** Ask: is this a *state* (one of four claims) or a *label*? Labels go
to `--label-*`, always. If it is a state, map it to one of the five badge variants in the
feature's `*-config.ts`, put the word in the chip, and **write the comment explaining
what the colour claims.** If you cannot name the claim in one sentence, it is a label.

**Adding a token.** §2.4. Then ask once more whether you need it.

**Changing a colour.** Edit `primitives.css` only. Re-run the contrast script. Update the
hex annotations. If you needed to edit anything outside `primitives.css`, the system was
bypassed somewhere upstream — find that instead.

---

*When this document and the code disagree, the code is the bug — unless the code is
right, in which case this document is the bug. Fix whichever it is in the same PR.*
