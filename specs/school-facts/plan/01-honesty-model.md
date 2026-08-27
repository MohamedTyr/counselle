# The school page — design specification

**Status:** design spec, not yet built. Frontend only; there is no backend for this read.
**Surface:** `/app/schools/:unitid`, inside the workspace shell.
**Audience for this document:** a designer or design tool generating the screens, and the
engineer building them afterwards. Everything here is prescriptive.

Source material, all verified before writing this:
`.worktrees/cds-pipeline/plans/cds-pipeline/METRICS-KEEP.md` (394 kept metrics, the derive
list, the 14 traps) · `docs/DATABASE_GUIDE.md` §4–7 (edition selection, packet v8,
availability states, evidence) · `DESIGN.md` (the design system — this spec never
contradicts it) · `frontend/src/features/schools/` (the surface being extended).

---

## 0. How to use this document

§2 is the token contract — every value in §3–§7 resolves to something in it. §3 is layout.
§4 is the component specs, which is the bulk of the work. §5 is the content that goes in
them. §11 is the copy deck. §15 lists the exact screens to produce.

**Two hard rules that override any aesthetic judgement made downstream:**

1. **Never render an absent value as blank, a dash, or zero.** Absence gets words. This is
   `AGENTS.md` principle 3 and `DESIGN.md` rule 37, and on this page it is the whole point
   — a blank cell reads as zero, and zero is a lie about a real school to a real student.
2. **A caveat is never a tooltip.** Where a number requires a qualifier, the qualifier
   renders as visible text under the number, always, at every viewport. A caveat behind a
   hover is a caveat that gets dropped.

---

## 1. The problem this page solves

A student browsing schools can currently see a result card and nothing more.
`ExplorePanel.tsx:244` passes `href={applicationId ? '/app/schools/' + applicationId :
null}` — a school you have not added to your list has no page at all. Meanwhile we hold
**394 verified CDS metrics per school**, plus our own web-verified requirements and essay
prompts, and none of it is visible anywhere except through the chat.

This page is where that data becomes readable. It must do three things at once:

- show everything we have, organised so it can actually be read;
- be honest about the shape of what we *don't* have, which is substantial and specific;
- never let a number appear without the qualifier that makes it true.

The last one is not a nicety. Under test-optional review, a school's published SAT middle
50% describes only the students who chose to submit — at 38% submitted, that band is the
profile of the top third of the class. Printing `1500–1560` without `38% submitted` is
manufacturing a fact.

---

## 2. Design system contract

Every token below already exists. Do not introduce a colour, a size, or a radius that is
not here. New tokens go in §2.8 and nowhere else.

### 2.1 Colour — the roles this page uses

The palette is five ramps (`--gray-*`, `--wine-*`, `--red-*`, `--amber-*`, `--leaf-*`) and
the app is **light-only** — there is no dark variant, no `.dark` class, and `dark:` utility
variants are banned.

| Purpose on this page | Token | Resolves to |
|---|---|---|
| Page background | `--canvas` | `--gray-50` `#fcf9f7` |
| Panel / card fill | `--surface-raised` | `--gray-25` `#fffdfc` |
| Recessed well (evidence, collapsed group body) | `--surface-inset` | `--gray-150` `#f4efed` |
| Panel perimeter | `--edge` | `--gray-400` `#d7cfcb` |
| Panel perimeter, hovered | `--edge-strong` | `--gray-500` `#b9afa9` |
| Divider **inside** one panel | `--hairline` | `--gray-300` `#e5deda` |
| Primary text | `--ink` | `--gray-900` `#2d2825` |
| Metric label | `--ink-secondary` | `--gray-800` `#524b48` |
| Caveat, meta, evidence chip | `--ink-muted` | — |
| **Absent value** | `--school-value-absent` → `--ink-faint` | `--gray-700` `#706762` |
| Selected rail row fill / ink | `--brand-subtle` / `--brand-subtle-ink` | wine 50 / reduced-chroma wine ink |
| Ordered intensity (degree-share bars only) | `--brand-scale-1/2/3` | three steps of one hue |
| Severe caveat ink | `--warning-fg` on `--warning-surface` | amber |
| Focus ring | `--focus-ring` | `--wine-500`, 7.01:1 |
| Hover on a surface | `--surface-hover` | 4% `--gray-900` mixed `in oklab` |
| Pressed | `--surface-active` | 7% `--gray-900` mixed `in oklab` |

**Law 2 — a hue is a claim, and each hue makes exactly one claim.** On this page:

- **Amber (`warning`) appears for exactly one thing: a caveat severe enough to change how
  the number should be read.** Sub-50% test submitters, a suppressed value, a stale
  edition. Nothing else on the page is amber.
- **Red (`danger`) appears for nothing.** There is no error state in the data itself; a
  missing metric is not a failure. Red is reserved for the page-level load error in §7.2.
- **Green (`success`) appears for nothing.** "We have this value" is the ordinary case, and
  the ordinary case gets no colour. Ticking every present metric green would leave the two
  real signals with nothing to say.
- **Wine appears only as selection** (the active rail row) **and as ordered quantity** (the
  degree-share bars). Never as decoration.

**Rule 39 — no decorative colour that implies data meaning.** A metric is not tinted by
domain, by section, or by "how good the number is." We do not know whether 4.6% is good for
this student.

### 2.2 Typography

One family: `--font-sans` = `"Instrument Sans Variable", system-ui, sans-serif`.
Self-hosted. `--font-heading` is deliberately the same token. Georgia is reserved for essay
documents and never appears here.

| Element | Class | Size / weight |
|---|---|---|
| Page title (school name, in `PageHeader`) | `text-xl font-semibold tracking-tight` | 20px / 600 |
| Section heading (e.g. "Getting in") | `text-lg font-medium` | 18px / 500 |
| Group heading (e.g. "How they weigh your file") | `text-sm font-medium` | 14px / 500 |
| Metric label | `text-sm` | 14px / 400 |
| **Metric value** | `text-sm font-medium tabular-nums` | 14px / 500 |
| Caveat line | `text-xs` | 12px / 400 |
| Coverage line, evidence chip, meta | `text-xs` | 12px / 400 |
| Rail row | `text-sm` (`font-medium` when selected) | 14px |
| Headline strip value | `text-lg font-medium tabular-nums` | 18px / 500 |
| Headline strip label | `text-xs` | 12px / 400 |

**There is no `text-2xl` or above anywhere in the workspace. Counselle has no hero type.**
The largest routine text on this page is the 20px school name. Presence comes from surface,
rhythm and restraint, not scale.

`font-bold` (700) does not exist in this app and must not start here. `font-medium` (500)
is the emphasis default; `font-semibold` (600) is page titles only.

**`tabular-nums` on every number.** Values are compared vertically down a column; without
tabular figures the decimal points wander and the column stops being readable.

### 2.3 Spacing

Sanctioned ladder: **1 / 1.5 / 2 / 3 / 4 / 6** = 4 / 6 / 8 / 12 / 16 / 24px. `2.5` (10px)
and `0.5` (2px) are legitimate half-steps in dense chrome. `gap-5` and `gap-8` are
outliers — prefer 4 or 6.

Rhythm by altitude:
- **Page level** — `gap-6` (24px) between header, tabs, and body.
- **Between sections in a panel** — `gap-6` (24px).
- **Between groups inside a section** — `gap-4` (16px).
- **Panel interior padding** — `p-4` (16px) or `p-6` (24px).
- **Between a value and its caveat** — `gap-1` (4px).
- **Rail rows** — stacked at `gap-0.5` (2px).

### 2.4 Radius

One base, one ladder: `--radius: 0.625rem` (10px).

| Radius | px | Means |
|---|---|---|
| `rounded-xl` | 14 | **a card / a panel** |
| `rounded-lg` | 10 | **a control** — buttons, rail rows |
| `rounded-md` | 8 | **a control inside a control** — evidence chip, collapsible header |
| `rounded-sm` | 6 | badges |
| `rounded-full` | — | avatars, dots, bar tracks |

When nesting, inner radius = outer minus border width.

### 2.5 Elevation

Depth is **fill first, border second, shadow last.**

- The About panel and the rail sit on `--canvas` as **one raised level**: `--surface-raised`
  fill + `--edge` border + `--elevation-1` (`0 1px 2px @6%`, `0 1px 1px @4%`).
- **A page has exactly one raised level. A card never contains a card.** Groups inside the
  panel are separated by a `--hairline` rule or a heading — never by a second
  border-plus-shadow-plus-fill.
- **An inset surface never draws a border.** The evidence well and the collapsed-group body
  use `--surface-inset` fill and no rim. A recessed fill that also has a border reads as
  embossed.
- **Never escalate shadow on hover.** Cards hover on border colour.

### 2.6 Motion

Three durations and only these: **150ms `ease-out`** for colour/state on controls ·
**200ms `ease-out`** for surfaces entering or leaving · **340ms `cubic-bezier(0.16, 1, 0.3,
1)`** for staged list entrance.

Animate `transform` and `opacity`. Never `transition-all`. Hover is never a transform.
Everything respects `prefers-reduced-motion`.

### 2.7 The badge vocabulary

Five variants, no others. **There is no `info` variant and there will not be one.**

| Variant | Means | Used on this page for |
|---|---|---|
| `secondary` | the ordinary state, and every category | round codes, domain labels, "calculated" |
| `warning` | not ready · needs you | stale edition, partial packet, severe caveat |
| `success` | done · complete | *(unused here)* |
| `error` | overdue · rejected | *(unused here)* |
| `outline` | a non-status affordance | "Official" / "CDS" provenance lane tags |

**Status is never colour alone.** Every badge contains the word. Where severity matters,
add a glyph — the severe-caveat treatment is ink weight **and** an `AlertTriangle` **and** a
`title`, triple-redundant, matching `VerdictBand`.

### 2.8 New tokens this feature mints

Family tier (`frontend/src/styles/schools.css`), resolving only through semantic tier —
never straight to a primitive.

```css
/* ---- fact rows ----
 * A fact is a label, a value, and the qualifier that makes the value true.
 * Absence has its own ink because a blank cell reads as zero, and zero is a
 * lie (AGENTS.md principle 3). */
--school-fact-label:            var(--ink-secondary);
--school-fact-value:            var(--ink);
--school-fact-absent:           var(--school-value-absent);
--school-fact-caveat:           var(--ink-muted);
--school-fact-caveat-severe-fg: var(--warning-fg);
--school-fact-caveat-severe-bg: var(--warning-surface);
--school-fact-divider:          var(--hairline);
--school-fact-derived-ink:      var(--ink-faint);
--school-fact-evidence-ink:     var(--ink-muted);
--school-fact-evidence-hover:   var(--surface-hover);
--school-fact-well:             var(--surface-inset);
```

Nothing else. If a screen seems to need a sixth hue, it needs `--label-*` (categorical) or
`--brand-scale-*` (ordered) instead.

---

## 3. Page anatomy

### 3.1 Shell context

The page renders inside `WorkspaceShell` → `SidebarInset` → `<main>`. **The shell never
scrolls.** The page owns its own scroll container. A layout that assumes the window scrolls
will not work.

Sidebar is 312px default (232–408 resizable), collapsing to a 48px icon rail, and becomes an
off-canvas `Sheet` below 768px. Design the page against a content area of
**1440 − 312 = 1128px** at the reference desktop width.

### 3.2 The scaffold

```tsx
<PageContainer
  title={school.name}
  width="full"
  actions={<>…</>}
>
```

`PageContainer` renders a `<section>` with `overflow-hidden`, wrapping a scrolling column
(`overflow-y-auto px-6 pb-6 md:px-10`, `gap-6`), with `PageHeader` at the top.

`PageHeader` guarantees a **fixed 64px minimum height** and a **full-bleed bottom rule**
(achieved by negating and reapplying the parent padding: `-mx-6 px-6 md:-mx-10 md:px-10`),
so the rule spans edge to edge while the title stays aligned with the body.

The About tab's content is capped at **`max-w-[1160px]`, centred** — matching Profile — so
the two columns have room without stretching across an ultrawide display.

### 3.3 Desktop wireframe — 1440px viewport, "Getting in"

```
┌─ sidebar 312 ─┬─ content 1128 ───────────────────────────────────────────────────┐
│               │                                                                    │
│               │  Schools  ›  Yale University                          ← 12px crumb │
│               │                                                                    │
│               │  ┌──┐  Yale University                    [Website ↗] [Add to list]│
│               │  │YU│  New Haven, CT · Private · 6,600 undergraduates              │
│               │  └──┘                                                              │
│               │  ──────────────────────────────────────────────────────────────    │ ← full-bleed rule
│               │                                                                    │
│               │  ┌─ headline strip ────────────────────────────────────────────┐   │
│               │  │ Admit rate   SAT mid 50   Sticker cost   Need met   6-yr grad│   │
│               │  │    4.6%      1500–1560      $87,400        100%       97%    │   │
│               │  │  calculated  62% submitted  2024–25       derived            │   │
│               │  └─────────────────────────────────────────────────────────────┘   │
│               │                                                                    │
│               │  ┌ About ┐┌ Your application  7 ┐                                  │
│               │  └───────┘└─────────────────────┘                                  │
│               │  ────────                                                          │ ← underline indicator
│               │                                                                    │
│               │  ┌ rail 200 ────────┐  ┌ panel ──────────────────────────────────┐ │
│               │  │ Getting in  24/28│  │ Getting in                              │ │
│               │  │ Money       41/67│  │ 24 of 28 verified · 2 not in this form   │ │
│               │  │ Academics   18/24│  │ edition · CDS 2024–25                    │ │
│               │  │ Campus life 11/13│  │ ─────────────────────────────────────────│ │
│               │  │ Outcomes    10/10│  │                                          │ │
│               │  │ Applying       — │  │ Admit rate              4.6%   [p.3 · C1]│ │
│               │  │                  │  │   calculated · 2,275 of 49,000 applicants│ │
│               │  │ ── Source ──     │  │ ─────────────────────────────────────────│ │
│               │  │ CDS 2024–25      │  │ SAT composite, middle 50%                │ │
│               │  │ Yale University  │  │                    1500–1560   [p.4 · C9]│ │
│               │  │ [View document ↗]│  │   62% of the enrolled class submitted an │ │
│               │  │                  │  │   SAT score                              │ │
│               │  │                  │  │ ─────────────────────────────────────────│ │
│               │  │                  │  │ Average high school GPA   not reported   │ │
│               │  │                  │  │ ─────────────────────────────────────────│ │
│               │  │                  │  │ Class rank, top tenth                    │ │
│               │  │                  │  │            not in this form edition [p.4]│ │
│               │  │                  │  │                                          │ │
│               │  │                  │  │ ▸ How they weigh your file          21   │ │
│               │  │                  │  │ ▸ Required high-school units        24   │ │
│               │  │                  │  │ ▸ Test scores in detail             22   │ │
│               │  │                  │  │ ▸ Class rank                         6   │ │
│               │  │                  │  │ ▸ Waitlist                           5   │ │
│               │  │                  │  │ ▸ Applicant pool                     9   │ │
│               │  │                  │  │                                          │ │
│               │  │                  │  │ ── Not published in the CDS ─────────────│ │
│               │  │                  │  │ Need-blind or need-aware                 │ │
│               │  │                  │  │   [Ask Counselle to check yale.edu →]    │ │
│               │  │                  │  │ Admit rate by major                      │ │
│               │  │                  │  │   [Ask Counselle to check yale.edu →]    │ │
│               │  └──────────────────┘  └──────────────────────────────────────────┘ │
└───────────────┴────────────────────────────────────────────────────────────────────┘
```

Grid: `grid items-start gap-6 md:grid-cols-[200px_minmax(0,1fr)] lg:gap-8`. This is
`ProfileRoute.tsx:36` verbatim — reuse it, do not mint a second two-column layout.

The rail is `sticky top-0`. The panel scrolls with the page.

### 3.4 1024px

Same two-column grid; `gap-6` instead of `gap-8`. The headline strip drops from five tiles
to three (admit rate, sticker cost, 6-year graduation) and the other two move into their
sections. Sidebar is still open.

### 3.5 Mobile — 375px

- Sidebar is an off-canvas `Sheet`; content is full width.
- Breadcrumb is hidden; the back affordance is the `PageHeader` title row.
- Headline strip becomes a **2-column grid, `gap-3`**, showing three tiles.
- **The rail becomes a `Select`** above the panel, labelled "Section", showing the current
  section and its coverage: `Getting in · 24 of 28`.
- `FactRow` **stacks**: label on line 1 at `text-xs text-[--ink-muted]`, value on line 2 at
  `text-sm font-medium`, caveat on line 3. Evidence chip moves to the end of the value line.
- Controls grow, per the app's inversion: buttons `h-9`, icons `size-4.5`, badges `h-5.5`.
  The app is tuned larger on touch and smaller on desktop — follow it, do not "fix" it.

---

## 4. Component specifications

### 4.1 `SchoolIdentityHeader`

Sits inside `PageHeader`'s slot; persists across both tabs.

| Part | Spec |
|---|---|
| Avatar | `SchoolAvatar` from `school-cells.tsx`, 40px, `rounded-full`, favicon with initials fallback. `alt=""` — the name is adjacent. |
| Name | `text-xl font-semibold tracking-tight truncate` |
| Meta line | `text-sm text-[--ink-muted]` — `{City}, {ST} · {Public\|Private} · {n} undergraduates`, separator ` · `. Any absent part is **dropped**, not rendered as "unknown", because identity facts are not metrics. |
| Actions | Right-aligned, `gap-2`. `[Website ↗]` `variant="outline" size="sm"` (omit when null). Then either `[Add to list]` `variant="default"` or `[Archive]` `variant="outline"`. |
| Layout | `flex` row, stacking to column below `sm:`. |

### 4.2 `HeadlineStrip`

Five tiles, the six-question spine compressed to what a student checks first.

- Container: `grid grid-cols-5 gap-4` on `lg:`, `grid-cols-3` on `md:`, `grid-cols-2 gap-3`
  on mobile. **Borderless** — it sits directly on canvas, separated by the header rule
  above. It is not a card, and it does not contain cards. (Law 3: one raised level.)
- Tile: `flex flex-col gap-0.5`, left-aligned.
  - label `text-xs text-[--ink-muted]`
  - value `text-lg font-medium tabular-nums text-[--ink]`
  - foot `text-xs text-[--ink-muted]` — carries the caveat or the vintage
- **A tile whose value is absent still renders**, with the absent copy at `text-lg` in
  `--school-fact-absent` and the reason in the foot. Dropping the tile would silently
  change the strip's shape from school to school and hide what is missing.

The five: **Admit rate** (derived, foot = `calculated`) · **SAT middle 50%** (foot = `{n}%
submitted`, escalated when <50%) · **Sticker cost** (foot = the CDS year) · **Average need
met** (derived `h2_h / h2_c`, foot = `calculated`) · **6-year graduation** (foot = cohort
year).

### 4.3 Tabs

`components/ui/tabs.tsx`, **`variant="underline"`**. The underline indicator is
`bg-primary`, `h-0.5`, transitioning `width` and `translate` over 200ms `ease-in-out`.

Two tabs: `About` and `Your application`. The second carries a count chip — the open-items
count, in the same grammar as "My list 7" elsewhere: `text-xs tabular-nums
text-[--ink-muted]`, **absent when zero or unknown**.

Tab state lives in the URL (`?tab=about`), so a link into the facts is shareable and the
back button works.

### 4.4 `SchoolFactsNav` — the rail

Reuses the row vocabulary of the sidebar and of `ProfileSectionNav.tsx`.

| Property | Value |
|---|---|
| Width | 200px (`md:grid-cols-[200px_minmax(0,1fr)]`) |
| Row height | `h-9` (36px) |
| Row radius | `rounded-[10px]` |
| Row padding | `px-3` |
| Row type | `text-sm`, `font-medium` when selected |
| Row stack | `gap-0.5` |
| Rest | `text-foreground` |
| Hover | `bg-[var(--canvas-hover)]` — the rail sits on canvas, not chrome, so it resolves to the canvas pair |
| Selected | `bg-[var(--brand-subtle)] font-medium text-[var(--brand-subtle-ink)]`, `aria-current="true"` |
| Focus | `focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]` |
| Transition | `transition-colors duration-150` |

**There is no left bar on the selected row.** Fill plus weight is already two signals; a bar
is a redundant third. This was removed from the sidebar deliberately.

Right side of each row: the coverage fraction, `text-xs tabular-nums
text-[--ink-muted]` — `24/28`. When a section has no CDS packet at all it shows `—`, not
`0/28`, because zero-of-N asserts we looked and found nothing, which is a different claim.

Below the rows, separated by 20px and a `--hairline` rule, the **source block**:

```
Source
CDS 2024–25 · Yale University
[View document ↗]
```

`text-xs`, label at `--ink-muted`. When the edition is stale the block gains a `warning`
badge reading `Older edition` directly under the year.

Mobile: replaced by a `Select` (§3.5), same content in the option label.

### 4.5 `SectionHeader` + `CoverageLine`

```
Getting in
24 of 28 verified · 2 not in this form edition · CDS 2024–25
─────────────────────────────────────────────────────────────
```

- Heading `text-lg font-medium`, sentence case.
- Coverage line `text-xs text-[--ink-muted]`, immediately below, `gap-1`.
- Rule: `--hairline`, full panel width, 16px below.

**The coverage line is a contract, not a decoration.** Per `DATABASE_GUIDE.md:226`:

- **M** (the denominator) is the count of configured metrics in the **current manifest**,
  supplied by the server. It is never `len(metrics)` and never computed on the client.
- **N** is the verified count.
- **K**, the `not_in_template_version` count, is stated **separately** and never folded into
  "missing" — those are metrics whose row does not exist in this school's form edition,
  which is a fact about the form, not a gap in our data.
- The phrase "missing" never appears. Sections read `24 of 28 verified`, never
  `4 missing`.

When the packet is partial or the edition is stale, an `EditionBanner` (§4.15) sits between
the coverage line and the first group.

### 4.6 `FactGroup`

A `<dl>`. **This is the same component as `stat_block` in the viz vocabulary** — the chat
renders fact groups too, and there is one implementation, not two.

- Optional heading: `text-sm font-medium`, 8px above the first row.
- Rows separated by a **`--hairline` 1px rule**, `divide-y`. Not borders, not cards.
- Group-level caveat, where the data requires one (§5), renders **above the first row** at
  `text-xs text-[--ink-muted]`, on a `--surface-inset` well with `rounded-md p-3`, no
  border.

Two shapes:
- **Headline group** — no heading, always open, first in the section.
- **Detail group** — inside a `Collapsible` (§4.16), closed by default.

### 4.7 `FactRow` — the atom

Every fact on this page renders through this one component, which is how the honesty rules
stay enforced in one place instead of thirty.

**Desktop layout** — `grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-3 py-2.5`:

```
┌──────────────────────────────┬──────────────┬────────────┐
│ Average need met             │         94%  │ [p.7 · H2-i]│
│   of aid recipients, not all students — excludes PLUS    │
│   and private loans                                       │
└──────────────────────────────┴──────────────┴────────────┘
   label col                     value col      evidence col
   text-sm --school-fact-label   text-sm         text-xs
                                 font-medium     --ink-muted
                                 tabular-nums
                                 text-right
```

| Slot | Spec |
|---|---|
| Label | `text-sm text-[--school-fact-label]`, wraps, never truncates. A truncated metric label is unreadable — these are long by nature (`h2_i_average_percent_need_met_first_time_first_year`). |
| Value | `text-sm font-medium tabular-nums text-right text-[--school-fact-value]`. **Copy the code-produced display string verbatim.** Never reformat, never re-round, never paraphrase. |
| Evidence | `EvidenceChip` (§4.9), or nothing when there is no evidence. |
| Caveat | `CaveatLine` (§4.8), full width beneath, `mt-1`. |
| Row hover | `bg-[var(--surface-hover)]`, 150ms, **only when the row has evidence** — a row with nothing to reveal should not appear interactive. |

**Absent values** replace the value slot with the state's copy, at
`text-sm italic text-[--school-fact-absent]`, **not** `font-medium` — it is not a value, and
weight would make it read as one. Right-aligned like a value so the column edge holds.

Exact copy per state is in §6. There are six states and each has its own words.

**Never:** an empty cell · an em dash · `0` · `N/A` · `—` · `null` · a hidden row.

### 4.8 `CaveatLine`

Two severities.

**Ordinary** — `text-xs text-[--school-fact-caveat]`, indented to the label column, `mt-1`,
no icon, no fill:

> of aid recipients, not all students — excludes PLUS and private loans

**Severe** — the number cannot be read correctly without it. `text-xs
text-[--school-fact-caveat-severe-fg]`, `font-medium`, on `--school-fact-caveat-severe-bg`,
`rounded-md px-2 py-1`, with an `AlertTriangle` at `size-3.5` and a `title` attribute
carrying the same sentence:

> ⚠ Only 38% of the class submitted an SAT score — this band describes the top third, not
> the class.

Triple-redundant by design: **weight, glyph, and title.** Status is never colour alone, and
this must survive greyscale, a screen reader, and print.

**Severe applies to exactly these, and no others:**

| Trigger | Sentence |
|---|---|
| Test submitters < 50% | Only {n}% of the class submitted a {SAT\|ACT} score — this band describes the top third, not the class. |
| Class rank submitted < 50% | Only {n}% of the class had a rank to report — most US high schools no longer rank. |
| GPA submitted < 50% | Only {n}% of the class reported a GPA. |
| `availability = suppressed` | The school withheld this value. We do not infer it. |
| Edition is stale | These figures come from the {year} CDS, not the current one. |

Everything else is ordinary.

**The caveat is a required child, not an optional prop.** In the type, `caveatRefs` is not
`| undefined` — you cannot construct a `Fact` for `sat_composite_p25` without
`sat_submitters_percent`. This is `METRICS-KEEP.md`'s schema decision 2 enforced by the
compiler rather than by discipline.

### 4.9 `EvidenceChip` + hover card

**The chip.** `text-xs text-[--school-fact-evidence-ink]`, `rounded-md px-1.5 py-0.5`, a
real keyboard-operable `<button>` — not a `<span>` with a hover handler.

Label: `p.{n}` alone, or `p.{n} · {section}` when a section label exists. Hover/focus:
`bg-[var(--school-fact-evidence-hover)]`, 150ms. Focus ring: `ring-2`
`ring-[var(--focus-ring)]`.

`aria-label`: `Evidence for {label}: page {n} of the {year} Common Data Set`.

**The hover card.** `HoverCard`, `--surface-overlay` fill, `rounded-xl`, `--elevation-2`,
**no border** — elevation-2 has a 12px blur and belongs on borderless surfaces; pairing it
with a 1px border is the banned "glassy" look. Width `w-[22rem]`. Opens after 200ms, enters
with `fade-in` + `slide-in-from-bottom-1` over 200ms `ease-out`.

```
┌──────────────────────────────────────────┐
│ Common Data Set 2024–25         [Official]│  ← text-xs, outline badge
│ Page 7 · Section H2 · Row i               │  ← text-xs --ink-muted tabular-nums
│ ┌──── --surface-inset well, rounded-md ──┐│
│ │ "i. Average percent of need met.  94%" ││  ← text-xs italic, line-clamp-4
│ └────────────────────────────────────────┘│
│ yale.edu/institutional-research/cds.pdf   │  ← truncated path, not raw URL
└──────────────────────────────────────────┘
```

This is the same grammar as the sources rail's evidence rows (`DESIGN.md` §15.4) — label,
`tabular-nums` value, `Page N · Section · Row · Column`, italic excerpt. One evidence
language across the app.

**For a derived value**, the card shows the arithmetic instead of one excerpt:

```
Calculated
2,275 admitted ÷ 49,000 applicants
Both values from Common Data Set 2024–25, page 3
[p.3 · C1 admitted]  [p.3 · C1 applicants]   ← two chips, each opening its own evidence
```

### 4.10 `DerivedFactRow`

Identical to `FactRow` with two additions:

- The caveat slot's first line is always `calculated · {formula}` at `text-xs
  text-[--school-fact-derived-ink]`.
- The evidence chip reads `calculated` rather than a page number, and opens the arithmetic
  card above.

**A derived value is never marked by colour.** It is marked by the word `calculated`.

A derived value whose inputs are not all `verified + reported` **does not compute**. It
renders `not available` with the caveat naming which input is missing:
`Applicants not reported, so the admit rate cannot be calculated.` Never a partial
computation, never a zero denominator, never a silent omission.

### 4.11 `ProvenanceLanes`

For the Applying section, where our web-verified data and the CDS both speak and can
disagree. Rendering only one of them would be picking a winner silently.

```
Early Decision deadline
┌─────────────────────────────────────────────────────────┐  --surface-inset, rounded-md,
│ [Official]  Nov 1, 2026    yale.edu/apply · verified Aug 12│  p-3, NO border
│ [CDS]       Nov 1                          p.3 · C21      │
└─────────────────────────────────────────────────────────┘
```

- Lane tag: `Badge variant="outline"`, `text-xs`, fixed 64px column so the two align.
- Value: `text-sm font-medium tabular-nums`.
- Provenance: `text-xs text-[--ink-muted]`, right-aligned. The official lane shows
  `{domain} · verified {date}` from `ReferenceProvenance`; the CDS lane shows an
  `EvidenceChip`.
- **When the two agree, both lanes still render.** Collapsing to one hides which source we
  actually have, and "the CDS says the same thing" is information.
- **When they disagree,** a line beneath at `text-xs text-[--ink-muted]`:
  `The CDS figure is from the {year} edition and may predate this cycle.` No alarm styling —
  disagreement between a current page and a historical form is expected, not an error.

### 4.12 `AbsentRow`

For the thirteen topics confirmed absent from the entire CDS. These get a group at the
bottom of their section, under a `--hairline` rule and a `text-sm font-medium` heading
reading **"Not published in the CDS"**.

```
Need-blind or need-aware
  Not a Common Data Set field. Counselle checks the school's site when you ask.
  [Ask Counselle to check yale.edu →]
```

- Topic `text-sm text-[--school-fact-label]`.
- Explanation `text-xs text-[--ink-muted]`.
- Action: `Button variant="ghost" size="sm"`, opens the AI sidebar with the question
  pre-filled and the school in context.

**This group never collapses.** Omitting it would make the page look complete, which is the
lie this whole design exists to avoid.

### 4.13 `ShareBar` — degree shares

The **one** place a bar is legal on this page. Degree share is ordered data, so rule 5
permits one hue at several intensities.

- Row: `grid grid-cols-[minmax(0,1fr)_48px_88px] items-center gap-3`.
- Track: `h-1.5 rounded-full bg-[var(--control-track)]`.
- Fill: `rounded-full`, `--brand-scale-3` for the top third of values, `-2` for the middle,
  `-1` for the bottom. Width is the percentage.
- Value `text-xs tabular-nums` beside it.
- **A blank or 0% row still renders**, with the absent copy and no bar.

**Mandatory group caveat**, on the inset well above the first row:

> Share of degrees conferred in one year — not program quality, not admission difficulty,
> and not a course catalogue. A blank row does not mean the major isn't offered.

Sorted descending by value; absent rows sort last, alphabetically.

Nothing else on this page gets a bar, a sparkline, or a chart. There is no charting library
and viz means typed tabular render specs (`DESIGN.md` §15.5). **Test bands render as three
`tabular-nums` cells — p25 / p50 / p75 — never as a range strip.**

### 4.14 `RoundsTable`

The Applying section's headline. A `FactGroup` whose rows are rounds rather than metrics.

| Column | Content |
|---|---|
| Round | `Badge variant="secondary"` — `ED`, `ED2`, `EA`, `REA`, `RD`, `Rolling` |
| Deadline | `ProvenanceLanes`, collapsed to one line when both lanes agree and only the official lane has a date |
| Notification | date or absent copy |
| Note | `Restrictive` `Badge variant="warning"` on REA/SCEA, with the sentence `Applying here restrictively blocks other early applications.` |

Rounds the school does not offer render as a row reading `not offered` — derived from
`early_decision_offered` / `early_action_offered` being explicitly `false`. A round whose
offered-flag is itself absent renders `not reported`, which is a different claim and must
not be collapsed into "not offered."

### 4.15 `EditionBanner`

Between the coverage line and the first group, when the edition is stale or the packet is
partial. **Never inside a collapsed group** — `DESIGN.md` rule 38 extended: an honesty flag
is never hidden behind a disclosure.

```
┌──────────────────────────────────────────────────────────────┐  --warning-surface,
│ ⚠ Older edition                                               │  rounded-md, p-3,
│ These figures come from the 2023–24 Common Data Set. Yale     │  NO border
│ has not published a newer one we can read.                    │
└──────────────────────────────────────────────────────────────┘
```

Variants: **Older edition** (`currentness = stale`) · **Partial extraction** (`{n} of {m}
domains came through incomplete. Values we could not verify are marked.`) ·
**Definition changed** (`This edition was read under an older metric definition. Its values
are not directly comparable to a current-edition school.`).

Icon `AlertTriangle size-4`, heading `text-sm font-medium text-[--warning-fg]`, body
`text-xs`.

### 4.16 The collapsible detail group

Header row: `flex items-center justify-between h-9 px-3 rounded-md`, hover
`bg-[var(--surface-hover)]`, 150ms.

- Chevron `size-4`, rotates 90° over 150ms `ease-out`, `motion-reduce` disables the rotate.
- Title `text-sm font-medium`.
- Right: metric count `text-xs tabular-nums text-[--ink-muted]`, plus — **when the group
  contains a severe caveat or a suppressed value** — a `warning` badge reading `Check this`,
  so the flag is visible from the closed state.
- Expand: height transition, 200ms `ease-out`. Height is a layout property and normally a
  last resort; accordion height is the documented exception, so comment it at the site.
- Expanded body: `--surface-inset` well, `rounded-md`, `p-4`, **no border**.

---

## 5. The six sections

Domains are how we *extract*. They are the wrong spine for reading — nobody has ever asked
"what's in the H2 grid." These six are what a student is actually asking.

Every section is: **headline group (open) → detail groups (collapsed) → absent group.**

### 5.1 Getting in

*admissions (evaluation) + class_profile · ~130 metrics*

**Headline (7 rows):** admit rate *(derived)* · admit rate by residency *(derived; publics
only — in-state, out-of-state and international rates from
`admitted_residency_* / applicants_residency_*`)* · ED admit rate *(derived, **ED-only
schools**)* · SAT composite middle 50% *(+ submitter caveat)* · ACT composite middle 50%
*(+ submitter caveat)* · `average_high_school_gpa` *(+ submitted-% caveat)* ·
`class_rank_top_tenth_percent` *(+ submitted-% caveat)*.

> **Trap 4 — the ED rate is only publishable for ED-only schools.** ED counts combine ED I
> and ED II, and there are **no EA counts at all**. Deriving an "RD rate" by subtraction at
> an EA school is polluted by EA admits and overstates it. At any school offering EA, the ED
> row renders `not available` with the caveat: `The CDS does not publish early-action
> counts, so a round-by-round rate cannot be calculated here.`

**Detail groups:**

| Group | Contents | Group caveat |
|---|---|---|
| How they weigh your file | the 20 `selection_factor_*` + `program_specific_factor_differences` | **"This is what the school says it weighs, not a measurement."** Read `program_specific_factor_differences` first — it can override the general table for an oversubscribed major. `selection_factor_level_of_applicant_interest` is the least trustworthy cell in the CDS. |
| Required high-school units | `total_academic_units_required/recommended` + the 11 subject pairs + `other_subject_label` | Rendered as a two-column required / recommended table. Schools often recommend more than they require; the recommendation is the real expectation. |
| Test scores in detail | SAT ebrw + math, ACT english/math/reading/science, all p25/p50/p75, plus submitter counts | The submitter caveat repeats here — it is not inherited from the headline. |
| Class rank | the 5 bands + `class_rank_submitted_percent` | **Bands are nested** (top-tenth ⊂ top-quarter). Never derive one from another; never subtract to fill a blank. Most US high schools no longer rank. |
| Waitlist | `has_waitlist_policy`, offered, accepted, admitted + derived conversion | **Swings 0 → 400 year to year. Narrative only, never a chance input.** |
| Applicant pool | applicants / admitted / enrolled totals + the residency splits | International admit rate is the single number that reclassifies "safety" publics into reaches for aid-needing international applicants. |

`open_admission_all_students` is special: when true it **moves to the top of the headline
group**, because it resets the entire frame — this school is not selective and the rest of
the section should be read that way.

**Score-band placement.** When the student has a score in their profile (`StudentProfile` in
`explore/explore-types.ts` already carries `satScore`) **and** submitters ≥ 50%, an extra
row: `Your 1480 sits in the middle 50%.` Below 50% submitted we **refuse to place it** and
say why: `Too few students submitted scores for a placement to mean anything here.` Never a
probability, ever — the chancing consumer classifies risk, it never emits a fake number.

**Absent group:** need-blind vs need-aware · admit rate by major or college · EA applicant
and admit counts · legacy and athlete admit rates · superscoring policy · interview
availability and format.

### 5.2 Money

*cost + financial_aid · ~110 metrics*

**Headline (7 rows):** sticker cost of attendance *(derived, residency-aware)* · the tuition
row matching the student's residency · **average % of need met — the derived `h2_h / h2_c`,
not the printed `h2_i`** · `h2_j` average aid package · `h2_e` % awarded a need-based grant
· `h5_borrowers_any_program_average_principal` average debt at graduation ·
`recent_affordability_initiative_details`.

> **Trap 3 — why derived, not printed.** `h2_i_average_percent_need_met_*` has aid
> *recipients* as its denominator, not all students, and it excludes PLUS and private loans
> from "need met." A school can print 100% while the family still borrows. The derived
> `h2_h / h2_c` — the share of students with need whose need was fully met — is the honest
> version. The printed figure still appears, in the need-based-aid detail group, with the
> caveat.

**Detail groups:** Cost of attendance, itemized · If you live at home or off campus ·
Per-credit rates · Does the price rise after year one? · Need-based aid (H2 a–m) · Merit
aid (H2a n–q + the twelve `h14_*`) · International and nonresident aid (H6, H7) · Debt at
graduation (H5) · Forms and deadlines (H8, `aid_*`, H11, H12).

**Four guards, all of which must be visible in the design:**

1. **`comprehensive_tuition_food_housing_amount` and the itemized rows are alternatives.**
   Schools that cannot itemize populate one and blank the other. Check which shape is
   populated before summing, or the page silently shows **$0**. When the comprehensive
   figure is the populated one, the itemized group renders a single line:
   `This school publishes one combined figure rather than an itemized breakdown.`
2. **`nonresident` ≠ `out_of_state`.** Citizenship status versus state residency. H6
   international aid is never conflated with out-of-state tuition. The two never appear in
   the same group.
3. **Cost is stale in the wrong direction** — printed tuition is *below* what an applicant
   will pay. `final_costs_not_available` and `final_costs_expected_date` are honesty flags
   and render **in the headline group**, never behind a disclosure.
4. `cost_academic_year`, `aid_reporting_academic_year`, `aid_reporting_status` (estimated
   vs final) and `need_analysis_methodology` (Federal vs Institutional — it decides whether
   home equity and business assets count against the family) render as **vintage suffixes
   on the values they date**, via compiled contexts, not as separate rows.

**Absent group:** net price by income band — **confirmed absent from both money domains;
there is no income dimension in any metric** · the meets-full-need pledge (only inferable
as a realized outcome, never the pledge) · post-graduation salary and employment.

> Note for the backend, not the design: `skills/costs-and-aid/SKILL.md` instructs the agent
> to pull net price by income band from the database. **That instruction cannot be
> satisfied.** The UI points at `net_price_calculator_url` plus the kept averages instead.

### 5.3 Academics

*degrees + academics + class_size + faculty · ~86 metrics*

**Headline (7 rows):** `students_per_faculty` *(+ basis caveat)* · % of classes under 20
*(derived from the section bands — **not printed on the CDS form**)* · % of classes 50+
*(derived)* · % of faculty full-time *(derived)* · % holding a terminal degree *(derived)* ·
`special_study_honors_program` · `special_study_undergraduate_research`.

> **Trap 8 — `students_per_faculty` uses a school-chosen FTE basis** (`ratio_basis_*` exist
> precisely because it varies) **and must not be recomputed from those bases.** "8 to 1" at
> a research university and at a liberal-arts college are different experiences. Ordinary
> caveat on the row: `The school defines the population behind this ratio; it is not
> comparable cell-for-cell across schools.`

**Detail groups:** Class sizes (7 section bands + 7 subsection bands — subsections reveal
the real small-group experience hiding behind a big lecture) · What students graduate in
(`ShareBar`, §4.13) · Special study options (12 `special_study_*`) · Core curriculum (12
`required_coursework_*`) · Degrees offered.

**Absent group:** the program and major catalogue — *"The CDS reports what students
graduated in, not what the school offers. 'Do they have linguistics' is not answerable from
this data."*

### 5.4 Campus life

*enrollment + student_life + identity · ~30 metrics*

**Headline (6 rows):** `undergraduate_total` · `graduate_total` ·
`college_owned_housing_percent_undergraduates` · % international *(derived
`nonresident_all_undergraduates / undergraduate_total`)* ·
`out_of_state_percent_undergraduates` · `academic_calendar`.

> **Trap 9 — `out_of_state_percent_undergraduates` excludes international from both
> numerator and denominator.** It is **not additive** with the international share. Ordinary
> caveat, on both rows: `Out-of-state and international are counted separately; these two
> figures do not add up to a share of non-local students.`

**Detail groups:** Greek life · Who's on campus (age 25+, average age, gender model) ·
ROTC (6 fields — on-campus versus cross-enrollment at a cooperating institution changes
feasibility, so both render).

**Absent group:** campus setting and urbanicity — *"a first-order fit filter with no CDS
field"* · the school's own religious affiliation — *"`selection_factor_religious_affiliation_commitment`
says whether faith commitment is weighed in admission; nothing states the school's own
affiliation. The two are easy to confuse."*

### 5.5 Outcomes

*outcomes · 10 metrics*

**Headline (4 rows):** `first_year_retention_reported_percent` · 4-year completion rate
*(derived)* · `primary_all_students_six_year_graduation_rate_ratio` ·
`primary_pell_grant_six_year_graduation_rate_ratio`.

> **Trap 10 — the retention percent is copied, never recomputed.** The printed rate carries
> form-defined exclusions and a recomputation will disagree with the school's own figure. It
> renders as printed, as a string, alongside a derived figure only if we can show both.

**Detail group:** Time to degree — the cohort count, the 4 / 5 / 6-year completion counts,
and the derived **4yr-to-6yr gap**, captioned: `A high six-year rate with a low four-year
rate means students routinely need a fifth year — which is a year of tuition.`

The Pell row carries an ordinary caveat: `Pell status is a socioeconomic fact, not a
prediction about you. This is the school's published figure for low-income completion.`

**Absent group:** salary, employment, and graduate-school placement — *"College Scorecard
publishes these; the CDS does not."*

### 5.6 Applying

*admissions (process) + our own requirements · mixed provenance*

**This is where CDS and our own web-verified data meet, and where they are allowed to
disagree.** `DATABASE_GUIDE.md:150`: current-cycle deadlines and facts beyond the CDS
edition require an official-web fallback **even when a packet exists**.

**Headline:** the `RoundsTable` (§4.14) · application fee and need-based waiver
*(`ProvenanceLanes`)* · testing policy *(`ProvenanceLanes` — `sat_or_act_admission_policy`
is a snapshot, and `test_policy_clarification` can carry "test-blind except nursing", which
no structured field holds)* · reply deadline · deposit.

**Detail groups:** Decision notification (mode, rolling begin, fixed date) · Other terms
(spring admit, deferred enrolment and its maximum period — **not to be confused with an
admission deferral, an easy and embarrassing conflation**) · Deposits (housing deposit
amount, deadline, refundability) · **Essay prompts, read-only** (from `SchoolEssayPrompt`,
with `SchoolPromptGroup` choice-group labels and `ReferenceProvenance`) · Other
requirements (recommendations, transcript, interview, CSS Profile, FAFSA, from
`SchoolRequirement`).

**The division of labour with the other tab is absolute:**

> **About shows what the school requires. Your application shows what you have done about
> it.**

The same prompt appears in both, with a different verb. Here it is a published fact with a
source. There it is a draft with a word count and a "Start writing" button. Nothing renders
twice meaning the same thing.

**Absent group:** application platform (Common App / Coalition) · interview availability and
format.

### 5.7 Not in the six: transfer

The 23 kept `transfer` metrics are gated behind an explicit "I'm transferring" signal rather
than shipped in the default packet for a first-year applicant. Out of scope for these
screens; recorded so it is not forgotten.

---

## 6. The state matrix

`extraction_status` and `availability_status` answer different questions. This table is
applied **in code, before anything reaches the screen** (`DATABASE_GUIDE.md:200`).

| Extraction | Availability | Renders as | Ink | Evidence |
|---|---|---|---|---|
| `verified` | `reported` | the formatted value | `--school-fact-value`, `font-medium` | yes |
| `verified` | `not_reported` | **not reported** | `--school-fact-absent`, italic | yes, if legacy evidence is valid |
| `verified` | `not_applicable` | **not applicable** | `--school-fact-absent`, italic | yes |
| `verified` | `suppressed` | **withheld by the school** | `--school-fact-absent`, italic | yes + **severe** caveat |
| `verified` | `not_in_template_version` | **not in this form edition** | `--school-fact-absent`, italic | yes — page proof required |
| `not_extracted` | null | **no verified value** | `--school-fact-absent`, italic | no |
| `conflict` | null | **no verified value** | `--school-fact-absent`, italic | no |
| `invalid` | null | **no verified value** | `--school-fact-absent`, italic | no |

**Only `verified + reported` is a student value.**

**Zero and `false` are valid reported values** when explicitly extracted. They are never
synonyms for missing, blank, suppressed, or not applicable. A `0` renders as `0`, in the
value ink, at `font-medium` — it is a fact.

**`not_in_template_version` is a third state, not a `false`.** It is a verified assertion,
introduced in packet v8, requiring a physical page and enough visible table or header
excerpt to prove the configured row or column does not exist in that school's CDS template
edition. A blank cell, failed OCR, a missing routed page, or a model's inability to find a
metric is **not** proof.

Two consequences that must survive into the design:

1. Its evidence chip reads `p.4 — proof`, and its hover card shows the header excerpt
   proving the row's absence, not a value excerpt.
2. **No boolean carrying this sentinel can ever be a catalogue filter.** Filtering "has
   study abroad" would silently drop every school that used a different form edition. If a
   filter chip ever appears for one of these fields, it is a bug in the filter, not in the
   data.

**String-typed percents.** 58 of the 394 kept metrics are percent-semantic `type: string`,
deliberately preserving tokens like `"<1%"`. Display keeps the raw string, qualifier and
all. **They never back a numeric sort or a range filter.** If a column of them is ever
sortable, that is a bug.

---

## 7. Page states

### 7.1 Loading

Shaped like the eventual content, never a generic shimmer.

```
[Skeleton 40px circle]  [Skeleton h-6 w-64]           [Skeleton h-8 w-24 ×2]
                        [Skeleton h-4 w-48]
─────────────────────────────────────────────────────────────────────────
[Skeleton h-14 ×5, grid-cols-5 gap-4]
[Skeleton h-8 w-56]                                    ← tabs
[Skeleton h-80 w-[200px]] [Skeleton h-96 flex-1]       ← rail + panel
```

### 7.2 Error

The app's error template, verbatim (`DESIGN.md` §13.1):

> **Could not load this school**
> The workspace could not reach the school data.
> `[Try again]`

`rounded-xl border bg-card p-6`, `max-w-md`, `role="alert"`.

### 7.3 No coverage at all

The school exists in the catalogue but has no readable CDS document. **This is not an
error** and must not use error styling.

Use the `Empty` primitive — icon, title, one sentence, one primary CTA:

> **No Common Data Set on file**
> We haven't been able to read a Common Data Set for {school}. The application requirements
> below are still current.
> `[Ask Counselle about {school}]`

The Applying section still renders fully, because our own requirements data is independent
of the CDS. The rail shows `—` for the five CDS sections and the real count for Applying.

### 7.4 Not on your list

The default state for a school reached from Explore.

- Header action is `[Add to list]`, `variant="default"`.
- **The About tab renders in full.** Facts do not require an application.
- The `Your application` tab renders an `Empty`:
  > **Not on your list yet**
  > Add {school} to track deadlines, essays, and requirements alongside your other
  > applications.
  > `[Add to list]`
- `[Add to list]` opens the existing `AddSchoolDialog` — it needs a `cycle_year`, which
  `ApplicationCreate` requires. Do not mint a second add path.

### 7.5 A section with no packet

The rail row shows `—`. The panel shows the section header, then:

> **This section isn't in the {year} edition we have**
> Yale's {year} Common Data Set didn't include the {domain} section, or we couldn't read
> it. We don't fill the gap from an older edition.

`--surface-inset` well, `rounded-md p-4`, no border, `text-sm`. The absent group still
renders below it.

**Never merge values across editions to fill holes.** Never silently substitute an older
packet for a missing current-domain row.

---

## 8. Responsive

| Breakpoint | Behaviour |
|---|---|
| `< 640px` | Rail → `Select`. `FactRow` stacks to 3 lines. Headline strip 2 columns × 3 tiles. Controls grow: `h-9`, `size-4.5`, badges `h-5.5`. Evidence chip moves to the end of the value line. |
| `640–768px` | Same layout, controls densify to `h-8` / `size-4` / `h-4.5`. |
| `768px+` | Two-column grid appears (`200px` + fluid). Breadcrumb appears. Headline strip 3 tiles. |
| `1024px+` | `gap-8` between rail and panel. Headline strip 5 tiles. |
| `1280px+` | Panel content still capped at `max-w-[1160px]` total; extra width becomes margin. |

Prefer container queries (`@container`) for component-internal reflow over viewport queries
— `FactRow`'s stack point is a property of the row's width, not the window's.

---

## 9. Motion

| Moment | Spec |
|---|---|
| Tab switch | The `TabsIndicator` transitions `width` and `translate`, 200ms `ease-in-out`. Panel content cross-fades, 150ms. |
| Rail row select | Panel content `fade-in` + `slide-in-from-bottom-1`, 200ms `ease-out`. Rail row background 150ms. |
| Collapsible expand | Height + chevron rotate, 200ms `ease-out`. Height is a layout property — the accordion exception; comment it at the site. |
| Evidence hover card | 200ms open delay, `fade-in` + `slide-in-from-bottom-1`, 200ms `ease-out`. |
| Headline strip entrance | Staggered `fade-in`, 22ms per tile, **capped at 8** — matching the sidebar-chat-in convention. |
| Row hover | Background colour only, 150ms. **Never a transform.** |

Under `prefers-reduced-motion`: all slides collapse to opacity, the stagger drops to zero,
the chevron rotation is removed, the height transition stays (it is not decorative — it is
the disclosure itself).

---

## 10. Accessibility

Baseline **WCAG 2.2 AA**.

- The page lives inside the shell's `<main>`. **Do not nest another `<main>`.**
- The rail is `<nav aria-label="School fact sections">`; rows are `<button>` with
  `aria-current="true"` on the selected one.
- Each section is `<section aria-labelledby>` pointing at its heading.
- Each `FactGroup` is a `<dl>`; label is `<dt>`, value is `<dd>`.
- **The caveat is inside the `<dd>`**, so a screen reader reading the value also reads the
  qualifier. This is the whole reason it is not a tooltip.
- The evidence chip is a real `<button>` with an `aria-label` naming the metric, the page,
  and the edition. The hover card opens on focus as well as hover, and closes on `Escape`.
- Every interactive element has a visible `focus-visible` ring: `ring-2`
  `ring-[var(--focus-ring)]` for buttons, badges and rail rows; `ring-[3px]` for form
  controls.
- Severe caveats are **not colour-only** — weight, an `AlertTriangle`, and a `title`.
- Touch targets reach 44px on coarse pointers via the `pointer-coarse:after:` pattern, which
  `buttonVariants` and `badgeVariants` already bake in. **Any bespoke icon-only clickable
  that is not a `Button` must add it explicitly** — the evidence chip qualifies.
- Contrast is hand-verified and commented at the token. Nothing in CI enforces it; if a
  token moves, run the contrast script.

---

## 11. Copy deck

Sentence case throughout. Second person, present tense. Say the noun. Never blame the user
or "the system." Numbers get units.

**Absence**

| State | String |
|---|---|
| `not_reported` | `not reported` |
| `not_applicable` | `not applicable` |
| `suppressed` | `withheld by the school` |
| `not_in_template_version` | `not in this form edition` |
| `not_extracted` / `conflict` / `invalid` | `no verified value` |
| derived, inputs incomplete | `not available` |
| round not offered | `not offered` |

**Coverage line** — `{n} of {m} verified` · `{k} not in this form edition` ·
`CDS {year}` — joined with ` · `. The word "missing" never appears.

**Severe caveats** — see §4.8's table. Verbatim.

**Ordinary caveats** (a selection; the full set lives beside each metric in §5)

- `of aid recipients, not all students — excludes PLUS and private loans`
- `The school defines the population behind this ratio; it is not comparable cell-for-cell across schools.`
- `Out-of-state and international are counted separately; these two figures do not add up to a share of non-local students.`
- `Bands overlap — the top tenth is inside the top quarter. They cannot be added or subtracted.`
- `Waitlist numbers swing widely year to year. Read them as context, not as odds.`
- `This is what the school says it weighs, not a measurement.`
- `Share of degrees conferred in one year — not program quality, not admission difficulty, and not a course catalogue. A blank row does not mean the major isn't offered.`

**Absent-topic rows** — `Not a Common Data Set field. Counselle checks the school's site when you ask.`
Action: `Ask Counselle to check {domain} →`

**Edition banners**

- `Older edition` / `These figures come from the {year} Common Data Set. {School} has not published a newer one we can read.`
- `Partial extraction` / `{n} of {m} sections came through incomplete. Values we could not verify are marked.`
- `Definition changed` / `This edition was read under an older metric definition. Its values are not directly comparable to a current-edition school.`

**Empty and error** — §7.2, §7.3, §7.4, verbatim.

---

## 12. Fixtures

The page is built against fixtures. Follow `explore/explore-fixtures.ts`: a loud
**FABRICATED** banner at the top of the file, and a set deliberately **worse than reality**,
because a clean fixture set hides exactly the render paths that matter.

Required in the set:

- one section with **no packet at all** (`packet: "missing"`)
- one **partial** packet
- one school on a **stale edition** (`currentness: "stale"`, `staleness_reason:
  "older_edition"`)
- at least three `not_in_template_version` values **with page proof**
- one `suppressed` and one `not_applicable`
- a test band **under 50% submitted**, to exercise the severe caveat
- a `"<1%"` string percent
- a legitimate **`0`** value, to prove zero renders as a fact and not as absence
- one school where `comprehensive_tuition_food_housing_amount` is populated and every
  itemized cost row is blank
- one school with **no admit rate at all**, so the derived-input-missing path renders
- one school with a **current-cycle deadline that differs from the CDS figure**, to exercise
  `ProvenanceLanes` disagreement

---

## 13. Types and files

### 13.1 The read model

```ts
type FactState =
  | { kind: "reported"; display: string; raw: unknown }
  | { kind: "not_reported" }
  | { kind: "not_applicable" }
  | { kind: "suppressed" }
  | { kind: "not_in_template_version" }
  | { kind: "no_verified_value" };      // not_extracted | conflict | invalid

type Evidence = {
  pageNumber: number;                   // positive physical PDF page
  excerpt: string;
  section: string | null;
  row: string | null;
  column: string | null;
};

type FactContext = { id: string; label: string; display: string };

type Fact = {
  ref: string;                          // qualified: "admissions.applicants_total"
  label: string;
  state: FactState;
  evidence: Evidence | null;
  contexts: FactContext[];              // compiled binders → the vintage suffix
  caveatRefs: string[];                 // NOT optional — the type enforces the pairing
};

type DerivedFact = {
  key: string;
  label: string;
  state: FactState;
  formula: string;
  inputs: string[];                     // qualified refs
};

type DomainCoverage = {
  verified: number;                     // N
  configured: number;                   // M — from the manifest, never len(metrics)
  notInTemplate: number;                // K — stated separately
  packet: "accepted" | "partial" | "missing";
};

type SchoolFacts = {
  unitid: number;
  identity: SchoolIdentity;
  edition: {
    academicYear: number;
    documentId: string;
    documentUrl: string;
    currentness: "current" | "stale";
    stalenessReason: string | null;
    partialDomainCount: number;
    currentDefinitionMatch: boolean;
  };
  coverage: Record<string, DomainCoverage>;
  facts: Record<string, Fact>;          // keyed by qualified ref
  derived: Record<string, DerivedFact>;
  requirements: SchoolRequirement[];    // existing type
  prompts: SchoolEssayPrompt[];         // existing type
  promptGroups: SchoolPromptGroup[];    // existing type
  absent: AbsentTopic[];
};
```

`contexts` render as the vintage suffix — "entering class, Fall 2025" — and are **omitted
entirely when any binder is missing**. Never guess a term or year from a surrounding cell.

### 13.2 Files

`SchoolWorkspace.tsx` is **1489 lines** against an 800-line house limit. None of this goes
in it.

**Step 0, its own commit, before any of the above:** extract `EssaysSection` and
`RequirementsSection` out of `SchoolWorkspace.tsx` into their own files. A refactor is its
own change, never smuggled into a feature.

```
features/schools/facts/
  SchoolFactsPanel.tsx        rail + panel shell for the About tab
  SchoolFactsNav.tsx          the rail, with coverage counts        §4.4
  FactRow.tsx                 THE atom                              §4.7
  FactGroup.tsx               <dl> wrapper; this IS stat_block      §4.6
  CaveatLine.tsx              ordinary + severe                     §4.8
  EvidenceChip.tsx            chip + hover card                     §4.9
  CoverageLine.tsx            N of M · K separately                 §4.5
  EditionBanner.tsx           stale / partial / definition-changed  §4.15
  ProvenanceLanes.tsx         official vs CDS                       §4.11
  AbsentRow.tsx               not-published + ask affordance        §4.12
  ShareBar.tsx                degree shares, the one legal bar      §4.13
  RoundsTable.tsx                                                   §4.14
  HeadlineStrip.tsx                                                 §4.2
  sections/GettingInSection.tsx
  sections/MoneySection.tsx
  sections/AcademicsSection.tsx
  sections/CampusLifeSection.tsx
  sections/OutcomesSection.tsx
  sections/ApplyingSection.tsx
  school-facts-types.ts
  school-facts-sections.ts    section config: refs → grouping + order
  school-facts-format.ts      display formatting + the derived values
  school-facts-fixtures.ts    FABRICATED banner
```

**`school-facts-sections.ts` is a presentation hint, not a catalogue.** `AGENTS.md` forbids
hardcoding domain ids, metric inventories, counts, or profile groups — the manifest is
dynamic. So the config maps qualified refs to grouping and order, and the renderer iterates
**whatever the packet returns**, dropping unrecognised refs into a final group called
**"Other published values."** Otherwise a manifest bump silently hides metrics, which is the
same failure mode as a blank cell, one layer up.

Files stay under 800 lines, functions under 50.

---

## 14. Tests that earn their place

No reflexive UI tests, no coverage target. These five are honesty-critical and do earn it:

1. `FactRow` renders **every** `FactState` as words — never blank, dash, or zero — and
   renders a legitimate `0` as a value.
2. A `Fact` with `caveatRefs` cannot render without its caveat; submitters < 50% escalates
   to severe.
3. `CoverageLine` reports M from the manifest and states K separately; the word "missing"
   never appears.
4. `not_in_template_version` never renders as "no", and carries page proof.
5. A `DerivedFact` with an unavailable input renders `not available` and names the missing
   input — never a partial computation.

Run `cd frontend && npm run typecheck && npm test` before calling anything done.

---

## 15. Screens to produce

Render at **1440×1024** unless noted. Light theme only — there is no dark variant.

| # | Screen | Must show |
|---|---|---|
| 1 | About → **Getting in**, good coverage | headline strip, rail with counts, 7 headline rows, 6 collapsed groups, absent group |
| 2 | About → **Money**, stale edition | `EditionBanner` "Older edition" above the first group, the derived need-met row, a `warning` "Check this" badge on a closed group |
| 3 | About → **Applying** | `RoundsTable` with `ProvenanceLanes`, one row where the two lanes disagree, the read-only prompt list |
| 4 | About → **Academics** | `ShareBar` list expanded, with its mandatory group caveat and one 0% row |
| 5 | **`FactRow` state gallery** | all six states stacked, plus: ordinary caveat, severe caveat, derived row, a legitimate `0`, a `"<1%"` string, a long wrapping label |
| 6 | **Evidence hover card**, open | over a `FactRow`, showing page · section · row, the italic excerpt well, the truncated path |
| 7 | **Evidence hover card, derived** | the arithmetic form with two chips |
| 8 | **Mobile 375** | `Select` instead of rail, stacked `FactRow`s, 2×3 headline strip |
| 9 | **Not on your list** | header with `[Add to list]`, About tab full, `Your application` tab showing its `Empty` |
| 10 | **No coverage at all** | the `Empty`, rail showing `—` for five sections, Applying still populated |
| 11 | **Loading** | the shaped skeleton from §7.1 |
| 12 | **Your application tab** | the existing workspace with the status field grid moved into it |

For every screen use the fabricated Yale figures from the fixture set — 4.6% admit,
1500–1560 SAT at 62% submitted, $87,400 cost, 100% need met, 97% six-year graduation, 99%
retention, $80 fee, test-optional, 6:1 ratio, 6,600 undergraduates — so the screens are
internally consistent and obviously not a real claim.
