# Schools page — UI/UX plan

Status: **design, not implemented.** Frontend-only, dummy data. No backend contract.

Two tabs on `/app/schools`: **Explore** (browse every profiled school) and **My list**
(the existing application tracker). This document is the UI/UX spec. The filter set it
renders is specified separately in [`schools-explore-filters.md`](./schools-explore-filters.md)
— that document owns *which* metrics may back a filter and why; this one owns *how the
page looks and behaves*.

Layout follows the approved static mockup. Everything below is about making that layout
land inside the app's real design system instead of beside it.

---

## 1. What's wrong with the mockup, and what replaces it

The mockup proved the information architecture. It is not shippable as-is. Eight
specific defects, each with the fix that this plan adopts:

| # | Mockup does | Why it's wrong | This plan does |
|---|---|---|---|
| 1 | Per-school hex crests (`#00356b`, `#a51c30`) | Color literals outside `primitives.css` — breaks the token layer's one law | Reuse the existing `SchoolAvatar` (favicon via `AvatarImage`, letter fallback). Zero literals, and real favicons look better than invented squares |
| 2 | Verdict is an inset rounded box inside the card | A card inside a card | The verdict becomes a **full-bleed tinted band** spanning the card's inner width. One box, one band |
| 3 | `.onlist` uses `linear-gradient(...) left/3px 100%` | A 3px colored side-stripe — banned outright | Full `--brand-subtle-border` perimeter + an "On list" badge in the header |
| 4 | Sort control orphaned in the filter bar | Sort belongs with the result count, not with the filters | Sort moves into the results header |
| 5 | Three stacked horizontal bands (personalization, coverage, results) before any content | Pushes cards below the fold and reads as three separate systems | Personalization + coverage + count + sort collapse into **one results header row** |
| 6 | Seven filter groups open simultaneously | Data quality isn't a filter — it's a lens over the whole result set | Six groups in a 3-column grid; **Data quality docks into the panel footer** beside Clear all |
| 7 | Caveat severity carried by a white-alpha chip on a tinted band | Amber chip on an amber band is invisible; alpha-over-tint is unpredictable | Severity is carried by **position**: mild caveats sit inline in the band, severe ones get promoted to their own row on the card's white surface |
| 8 | Uniform 14px gaps everywhere | No rhythm; everything reads at one emphasis level | Three-step spacing rhythm (6 / 12 / 20) and a real type-size ladder inside the card |

Defects 1 and 3 are hard blockers under `AGENTS.md` ("frontend visual changes must go
through the design system first"). The rest are craft.

---

## 2. Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Schools                                             [+ Add school  ⌘K]     │  page header
│                                                                             │
│  ┌─────────┬─────────────┐                                                  │
│  │ Explore │ My list · 4 │  ← underline tabs, heading weight                 │
│  └━━━━━━━━━┴─────────────┘                                                   │
└─────────────────────────────────────────────────────────────────────────────┘

═══ EXPLORE ══════════════════════════════════════════════════════════════════

  ┌───────────────────────────────────────────────────────────────────────┐
  │ ⌕  Search schools…                        or describe what you want   │   search
  └───────────────────────────────────────────────────────────────────────┘

  [Location MA·NY·CT ▾] [Admit rate 4–60% ▾] [Size ▾] [Type ▾] [Cost ▾]
  [Test fit ▾]                                          [⊟ More filters ③]      Tier 1
       ▲ each opens its own Popover                            ▲ toggles panel

  ┌─ MORE FILTERS ────────────────────────────────────────────── panel ───┐
  │  Money            Rounds & deadlines      Testing                     │
  │  Outcomes         Campus                  Student body                │
  │  ─────────────────────────────────────────────────────────────────── │
  │  Data: [Any | Within 2 yrs | Current]      Clear all       [ Done ]   │
  └───────────────────────────────────────────────────────────────────────┘

  184 schools  ·  [You: MA resident · SAT 1480 ▾]  ·  38 hidden, no admit
                                        rate [include]      [Sort: Admit ▾]     results header

  ┌────────────────────┐ ┌────────────────────┐ ┌────────────────────┐
  │ [av] Yale       +Add│ │ [av] Northeastern  │ │ [av] UMass  ✓On list│
  │      New Haven, CT …│ │      Boston, MA …  │ │      Amherst, MA … │
  ├────────────────────┤ ├────────────────────┤ ├────────────────────┤   ← full-bleed band
  │ REACH     4.6%     │ │ REACH     5.2%     │ │ SAFETY    58%      │
  │ SAT 1500–1560      │ │ SAT 1480–1550 · 62%│ │ SAT 1300–1450 · 88%│
  ├────────────────────┤ └────────────────────┘ └────────────────────┘
  │ ⚠ 41% submitted    │       ▲ mild caveat stays inline in the band
  ├────────────────────┤   ▲ severe caveat promoted to white surface
  │ $87,400  100%  88% │
  │ Your cost Need Grad│
  ├────────────────────┤
  │ REA RD      Nov 1  │
  └────────────────────┘

  Showing 8 of 184                                        [ Load more ]

═══ MY LIST ══════════════════════════════════════════════════════════════════

  ┌───────────────────────────────────────────────────────────────────────┐
  │  Your list                                                4 schools   │
  │  ████████████████████████████████████████████████████████████████     │  balance bar
  │  ▪ Reach 0    ▪ Target 4    ▪ Safety 0                                │
  │  ⚠ No safety schools — find some →                    [Sort: Deadline]│
  └───────────────────────────────────────────────────────────────────────┘

  School            Status    List    Round  Deadline    Progress  Essays
  ──────────────────────────────────────────────────────────────────────────
  [av] Harvard      Applying  Target  RD     Jan 1 · 12d  ▬▭▭▭ 1/4    0/1
  …
```

**Why cards on Explore, table on My list.** They answer different questions. Explore is
*"which of these do I want?"* — a comparison read, where each school needs six numbers
visible at once and the eye moves between whole units. My list is *"what do I owe and
when?"* — a status read down aligned columns. Same data model, correctly different
affordances. Don't unify them.

---

## 3. Design direction

**Color strategy: Restrained.** The product register's floor, and correct here — this is
a task surface, not a brand surface.

**The brand appears in exactly four places on this page**, holding to `semantic.css`'s
under-3%-of-pixels budget for `--brand`:

1. The `Add school` CTA (`Button` default variant — already correct in `SchoolsRoute.tsx`)
2. The active tab's underline indicator
3. On-list cards: `--brand-subtle-border` perimeter + `--brand-subtle` badge
4. Focus rings (`--focus-ring`)

Nothing else. Active filter chips are **not** brand-filled — see below.

**The fit ladder is not the accent.** Reach / Target / Safety already map to
warning / info / success in `schools-config.ts` (`listTypeVariant`). Explore reuses that
mapping verbatim, which is what makes adding a school from Explore land in My list
looking like the same object. Three tints, each `-50` (L 95–96%, chroma 0.02–0.036) —
pale enough that eight of them in a grid read as a scannable distribution, not as
decoration.

**Surfaces.**

| Element | Fill | Edge | Reason |
|---|---|---|---|
| Page | `--canvas` | — | The sand ground, unchanged |
| School card | `--surface-raised` | `--edge` hairline | It's a card |
| Filter panel | `--surface-raised` | `--edge-panel` | It's a large *input surface*, not a card — the same distinction `workspace.css` makes for the composer. A 3:1 `--edge-control` stroke around a full-width panel is exactly the "black box" defect that token was created to fix |
| Filter chip, inactive | `--control-quiet-surface` | transparent | The composer's control-chip language, reused. Filter bar and composer now speak one dialect |
| Filter chip, active | `--brand-subtle` | `--brand-subtle-border` | Tint + border, ink at `--brand-subtle-ink` (10.91:1) |
| Search field | `--field-surface-canvas` | `--edge-control` | This token exists in `semantic.css` with no consumer yet, written explicitly as "forward vocabulary… so a canvas-level search or filter field has a named token to reach for." This is that consumer |

**Typography.** One family (Instrument Sans Variable), per the product register. The
ladder inside a card is the point — the mockup rendered everything at one weight:

| Role | Size / weight | Notes |
|---|---|---|
| Page title | `text-2xl font-heading` | Unchanged from today |
| Card school name | `text-[15px] font-medium leading-tight` | `text-wrap: balance`, 2-line clamp |
| Card meta line | `text-xs text-ink-muted` | |
| Verdict label | `Badge size="sm"` | The word, categorical |
| **Admit rate** | `text-lg font-medium tabular-nums` | The largest thing in the band |
| Test band | `text-xs text-ink-secondary tabular-nums` | |
| Stat value | `text-base font-medium tabular-nums` | |
| Stat label | `text-xs text-ink-muted` | |
| Filter group heading | `text-xs font-medium text-ink-secondary`, **sentence case** | Not `MONEY` — tracked uppercase eyebrows are the saturated AI tell |

`font-variant-numeric: tabular-nums` on every rate, cost, ratio, count, and date. Cards
sit in a grid; digits that shift width make the grid shimmer as you scan it.

**Why the verdict word is small and the rate is large.** The verdict is our *conclusion*;
the rate is the *evidence*. `METRICS-KEEP.md` licenses the categorical verdict precisely
because the chancing consumer "classifies risk, it never emits a fake probability" — so
the honest hierarchy puts the observed number above our label. This is `AGENTS.md`
principle 3 expressed as type scale.

**Radius.** Cards `rounded-xl` (12px). Chips/badges `rounded-sm`. Buttons unchanged.
Nothing above 16px.

**Elevation.** Cards carry `--edge` at rest and `--elevation-1` on hover only. Never
border-plus-wide-shadow at rest.

---

## 4. Design-system work required first

Three real gaps found by reading the token files. Do these before any component work —
`AGENTS.md`: "Frontend visual changes must go through the design system first."

### 4.1 `--success-border` is missing

`semantic.css` has `--danger-border`, `--warning-border`, `--info-border` but not
`--success-border`, with this note:

> `--success-border` was dropped — no existing or planned consumer could be named for it…
> Add it back if a bordered success banner is ever built.

The Safety verdict band is that consumer. Adding it requires a `-200` step on the leaf
ramp, which doesn't exist (leaf currently has only 50 / 600 / 700).

```css
/* primitives.css — matches the L 85–86% of amber-200, blue-200, red-200 */
--leaf-200: oklch(86% 0.075 143);

/* semantic.css — alongside the other three status borders */
--success-border: var(--leaf-200);
```

Verify contrast in-browser before accepting; the sibling `-200` steps are the reference.

### 4.2 New family file `frontend/src/styles/schools.css`

Per `styles/README.md`: "Building a new feature area with its own recurring colors? Give
it its own family file, name-prefixed by the feature, resolving only through
`semantic.css`." Add to `index.css` after `profile.css`, before `shadcn.css`.

```css
/* schools.css — Explore + My list surfaces. Resolves only through
 * semantic.css. No primitives, no literals. */
:root {
  /* Verdict bands — the fit ladder. Values are the existing status roles;
   * these aliases exist so a future retune of the fit ladder does not
   * silently move every warning/info/success surface in the app. */
  --school-verdict-reach-surface:  var(--warning-surface);
  --school-verdict-reach-border:   var(--warning-border);
  --school-verdict-reach-ink:      var(--warning-fg);
  --school-verdict-target-surface: var(--info-surface);
  --school-verdict-target-border:  var(--info-border);
  --school-verdict-target-ink:     var(--info-fg);
  --school-verdict-safety-surface: var(--success-surface);
  --school-verdict-safety-border:  var(--success-border);   /* new, §4.1 */
  --school-verdict-safety-ink:     var(--success-fg);

  /* Card */
  --school-card-surface:        var(--surface-raised);
  --school-card-border:         var(--edge);
  --school-card-border-hover:   var(--edge-strong);
  --school-card-onlist-border:  var(--brand-subtle-border);

  /* Missing-value ink — one tier weaker than muted, for "not published" */
  --school-value-absent: var(--ink-faint);
}
```

### 4.3 No per-school color, ever

The mockup's crests were invented brand colors. `SchoolAvatar` already exists
(`school-cells.tsx:52`) and does the right thing: favicon from `websiteUrl` via
`AvatarImage`, letter fallback on a neutral. Explore cards use it unchanged. This is
both a token-law fix and a fidelity win — real favicons beat invented squares.

---

## 5. Components — search registries first

`AGENTS.md` §"Frontend components — search registries first." The project runs on
**Base UI** (`@base-ui/react ^1.6.0`), which is what COSS ships on, so COSS components
drop in without an adapter layer. Verified against `https://coss.com/ui/r/registry.json`.

### 5.1 Already in the project — reuse unchanged

`tabs` (has a `variant="underline"`), `button`, `badge`, `card`, `popover`, `command`,
`checkbox`, `select`, `dropdown-menu`, `separator`, `skeleton`, `empty`, `tooltip`,
`avatar`, `input`, `scroll-area`, `sheet`, `table`, `meter`, `sonner`.

Plus feature-local: `SchoolAvatar`, `PageHeader`, `AddSchoolDialog`, `SchoolsTable`,
`SchoolMobileList`, `WorkspaceScrollIndicator`.

### 5.2 Install from COSS — three components

```bash
cd frontend
npx shadcn@latest add @coss/segmented-control
npx shadcn@latest add @coss/number-field
npx shadcn@latest add @coss/kbd
```

| Component | Used by | Why not hand-rolled |
|---|---|---|
| `segmented-control` | Test policy, Greek life, institution type, CDS edition | Four instances of the mockup's hand-rolled `.seg` with `aria-pressed`. Real keyboard semantics, real states. Zero registry deps, only `class-variance-authority` (already installed) |
| `number-field` | Every min/max range pair | Increment/decrement, clamping, `inputMode`, locale formatting. Deps: `@base-ui/react` (installed), `@coss/label` |
| `kbd` | The `⌘K` chip in the page header | One file, no registry deps. Alternative: extract `MenuShortcut` from `menu.tsx:274` — more code for the same result |

**Install one at a time and read the diff.** COSS `registryDependencies` can pull
`@coss/input`, `@coss/label`, `@coss/scroll-area` — the project's versions of those are
theme-customized and must not be clobbered. Never pass `--overwrite`.

### 5.3 Deliberately *not* installed

| Considered | Verdict |
|---|---|
| `@coss/slider` | **No.** Admit rate is heavily right-skewed — on a linear 0–100 slider the entire selective range (4–20%) lives in the first fifth of the track and is unhittable. Number-field pairs are more precise, degrade gracefully when the metric is missing, and read as "at least / at most" rather than implying a distribution we aren't showing |
| `@coss/combobox` | **No.** Location multi-select = existing `Popover` + `Command` + `Checkbox`. Already how `AddSchoolDialog` does search. Avoids the `@coss/input` + `@coss/scroll-area` overwrite risk entirely |
| `@coss/checkbox-group` | **No.** A `<fieldset>` around existing `Checkbox`es is the same thing with less surface |
| `@coss/field` | **No.** Filter rows are label + control. No wrapper needed |
| `@ai-elements/*` | **No.** Nothing on this page is chat- or agent-shaped |

### 5.4 Built new (the differentiating surfaces)

`SchoolResultCard`, `ExploreFilterBar`, `ExploreFilterPanel`, `ExploreResultsHeader`,
`ListBalanceBar`. These are Counselle's honesty surfaces — the verdict band, the caveat
ladder, the coverage disclosure, the balance nudge. No registry ships them because no
other product tells the user what its own search is hiding.

---

## 6. Component specs

### 6.1 Tab shell

`Tabs variant="underline"` with `TabsList` / `TabsTab` / `TabsPanel`. Tabs sit in heading
weight below the `PageHeader`, above both panels.

The existing All types / Reach / Target / Safety pill row is **removed** from My list.
Two stacked pill rows have no hierarchy — that row's job is taken over by the balance
bar's clickable legend, which does it better because it also surfaces "you have zero
safeties," a fact the pill row hid behind a count of `0`.

My list tab label carries a count. Explore does not (the result count lives in the
results header, where it changes with every filter).

### 6.2 Search field

Full-width. `--field-surface-canvas` + `--edge-control`, focus swaps to `--focus-ring`
with a `ring-2 ring-[var(--focus-ring)]/30` — matching `AiComposer`'s focus language.
Trailing hint "or describe what you want" in `--ink-faint`, hidden below `sm`.

The natural-language path is a **seam, not a feature** here: the hint is honest about the
intent, and the field debounces into name/city matching for now. Don't build query
parsing in this pass.

### 6.3 Filter bar (Tier 1)

Six chips in a `flex-wrap` row. Each chip is a `PopoverTrigger`; each `PopoverPopup`
holds that filter's own control:

| Chip | Popup contains |
|---|---|
| Location | `Command` list of states, `Checkbox` per row, searchable |
| Admit rate | Two `NumberField`s, `%` suffix |
| Size | Four `Checkbox`es (Under 2k / 2–10k / 10–25k / 25k+) |
| Public or private | `SegmentedControl` — Any / Public / Private, with facet counts |
| Your cost | Two `NumberField`s, `$` prefix, plus the residency note |
| Test fit | `RadioGroup` — three presets anchored to the student's score |

An active chip shows its value inline (`Location **MA · NY · CT**`) and switches to the
brand-subtle treatment. Popovers must render in a portal — `PopoverPopup` already does,
but the results area scrolls, so verify no clipping.

`More filters` sits at the far right with a count badge and toggles the panel.

**Facet counts on enums only** (`Public (168) / Private (244)`). Never on ranges — the
query cost isn't worth it and the number moves under the user's cursor.

### 6.4 Filter panel (Tier 2)

Disclosed inline below the bar, not a modal — the user needs to see the result count move
as they set filters, and modals are the lazy first thought.

`--surface-raised` on `--edge-panel`, `rounded-xl`, six groups in
`grid-cols-1 md:grid-cols-2 lg:grid-cols-3`:

```
Money              Rounds & deadlines    Testing
Outcomes           Campus                Student body
```

Group heading is `text-xs font-medium text-ink-secondary`, sentence case, followed by a
`Separator`. Rows are `label` + control, `gap-1.5` within a group, `gap-5` between groups.

**Data quality docks into the footer**, not into the grid:

```
Data: [ Any | Within 2 years | Current only ]      3 active   Clear all   [ Done ]
```

It's a lens over the whole result set, not a property of a school. Its explanatory note
("Admit rates from different reporting years aren't comparable. Schools outside your
window stay visible but are marked.") sits below it in `text-xs text-ink-muted`.

That drop takes the grid from seven groups to six — a clean 3×2 with no orphan.

**Below `md`** the panel becomes a `Sheet` from the bottom. Same content, scrollable, with
a sticky footer holding the count and Done.

Disclosure animation: `grid-template-rows: 0fr → 1fr` on a wrapper with
`overflow: hidden`, 200ms `ease-out`. Never animate `height: auto`.

### 6.5 Results header

One row replacing the mockup's two bands:

```
184 schools · [You: MA resident · SAT 1480 ▾] · 38 hidden — no admit rate [include]   [Sort ▾]
```

- **Count** — `font-medium tabular-nums`, the anchor
- **Personalization** — a `DropdownMenu` trigger styled as a quiet chip. It is load-bearing
  (it picks which tuition row and which admit rate every card shows), so it must be
  visible and editable at the point of consequence, not buried in settings
- **Exclusions** — one chip per active range filter that hid rows for missing data, each
  with an inline `include` button. This is the coverage-disclosure rule from the filter
  spec §6, and it is the single most differentiating thing on the page: no competitor
  tells you what its search dropped
- **Sort** — `DropdownMenu`, right-aligned

Below `md`: count + sort on line one, personalization and exclusions wrap to line two.

### 6.6 School result card

Grid: `repeat(auto-fill, minmax(min(100%, 340px), 1fr))`, `gap-3.5`, `align-items: stretch`.

Anatomy, top to bottom:

**Header** — `SchoolAvatar` (size `lg`, `rounded-lg`), name + meta stacked, action at the
right. Action is `+ Add` (`Button size="sm" variant="outline"`) or, when already on the
list, a non-interactive `Badge variant="outline"` reading `✓ On list`.

**Verdict band** — full-bleed via negative inline margin equal to the card's padding, so
it meets both inner edges with hairlines above and below. Never an inset rounded box.

```
[ REACH ]                              4.6% admit
SAT 1500–1560 · 41% submitted
```

`Badge size="sm"` carrying the verdict word (variant from `listTypeVariant`), rate at
`text-lg tabular-nums`, band line below at `text-xs`.

**Caveat ladder.** Severity is carried by *position and prominence*, not by a second
color — colour alone would be invisible on a same-hue tint and would fail for colourblind
users:

| Submitted % | Treatment |
|---|---|
| > 80% | Inline in the band, `--ink-muted`. No ornament |
| 50–80% | Inline in the band, `--ink-secondary` |
| < 50% | **Promoted** to its own row below the band, on the card's white surface, with an `AlertTriangle` in `--warning-fg` and text at `--ink`: "Under half submitted scores — this range describes the top third of the class" |

Promoting it out of the band is deliberate: `--warning-fg` reads correctly on white and
does not on an amber tint. It also means severe caveats are the only thing on the card
that changes the card's *shape*, which is the loudest available signal that costs nothing
on the majority of cards.

Filter spec §7.3: "a caveat in a tooltip is a caveat that gets dropped."

**Stats** — three columns, `min-h` reserved so cards with a missing stat don't collapse:

```
Your cost        Need fully met     Grad in 4 yrs
$87,400          100%               88%
sticker, private of those with need
```

Value on top at `text-base font-medium tabular-nums`, label above it at `text-xs`,
qualifier below at `text-xs text-ink-faint`. Missing values render the literal string
`not published` in `--school-value-absent` — never `—`, never `0`, never omitted. A blank
cell reads as zero and that is a lie.

When `Need fully met` is absent the slot backfills with `Got merit aid` and says
`need data missing` in the qualifier, rather than leaving a hole.

**Footer** — `mt-auto`, hairline top. Available rounds as small chips with the earliest
highlighted; next deadline right-aligned, `tabular-nums`.

**Interaction.** The card is a link to the school page, but it contains a button. Use the
stretched-link pattern, not a `div` with `onClick`:

```tsx
<article className="relative …">
  <a href={`/app/schools/${id}`} className="after:absolute after:inset-0">
    {name}
  </a>
  <Button className="relative z-10" …>Add</Button>
</article>
```

One real link for screen readers and middle-click, whole-card hit area, and the Add button
stays its own target.

Hover: `--edge` → `--edge-strong`, `--elevation-0` → `--elevation-1`, 150ms. No transform.

### 6.7 My list

`SchoolsTable` and `SchoolMobileList` are unchanged. Two additions above them:

**Balance bar** — a `--surface-raised` card on `--edge`:

- Title row: "Your list" + count
- A single proportional bar, three segments (`--warning-solid` / `--info-solid` /
  `--success-solid`), `h-2 rounded-full`, `overflow-hidden`. Custom, ~20 lines of flex —
  `meter` is single-value and doesn't fit
- Legend: three clickable swatch + label + count items that act as the list-type filter.
  Zero-count entries render dimmed and disabled
- Nudge: when Safety count is 0 (or Reach > 60% of the list), an amber inline message
  linking to Explore with the Safety preset applied

The nudge is the page's counselor voice. It is the reason the pill row is being replaced
rather than just restyled — a pill reading `Safety 0` states a fact; the nudge tells the
student it's a problem and hands them the fix.

**Sort** moves next to the balance bar, matching Explore's results header.

---

## 7. States

Every one of these is missing from the mockup and all of them ship.

| State | Treatment |
|---|---|
| **Explore, loading** | Six skeleton cards matching the real card's block rhythm (header / band / stats / footer). Not a spinner — the layout must not shift when data lands |
| **Explore, filtering** | Results dim to `opacity-60` with `pointer-events: none` for >200ms fetches. Filter controls stay live. Never unmount and re-skeleton on every keystroke |
| **Explore, no results** | `Empty` naming the culprit: *"No schools match. Admit rate 4–20% is the narrowest filter — 140 schools match everything else."* with a one-click **Relax admit rate**. Generic "no results found" is a dead end |
| **Explore, error** | Inline card, one-sentence cause, retry button. Match the existing error block in `SchoolsRoute.tsx:214` |
| **My list, empty** | Existing `Empty` block, plus a second action: **Browse schools** → Explore. First-run students have nothing to add *from* yet |
| **Card, partial data** | Per §6.6 — `not published` in `--school-value-absent`. Never blank |
| **Add in flight** | Button → `Spinner`, disabled. On success the card flips to the on-list treatment in place and a `sonner` toast confirms with an **Undo** |
| **Filter chip, no data for filter** | Chip disabled with a tooltip naming why. Don't hide it — a missing filter is more confusing than a disabled one |

---

## 8. Motion

`motion/react` is already a dependency. Use it in exactly three places; CSS transitions
everywhere else.

| What | How | Duration |
|---|---|---|
| Tab switch | Crossfade panels + the underline indicator slides (`tabs.tsx` already ships `data-slot="tab-indicator"`) | 180ms `ease-out` |
| Filter panel disclosure | `grid-template-rows: 0fr → 1fr`, opacity on content | 200ms `ease-out` |
| Card entrance | Stagger 30ms × index, **capped at 8**, and **only on first paint of a result set** — not on Load more, not on refilter | 160ms |
| Card hover | CSS: border + shadow | 150ms |
| Add → on-list flip | Border + badge crossfade in place | 200ms |
| Result count change | `tabular-nums` means no reflow; no animation | — |

Re-staggering on every filter change is the reflex to avoid — it turns a fast filter into
a slideshow. Stagger once, then results just update.

`@media (prefers-reduced-motion: reduce)` → all of the above become instant or a plain
crossfade. Non-negotiable.

---

## 9. Responsive

| Breakpoint | Explore | My list |
|---|---|---|
| `≥1280` | 3–4 card columns; filter panel 3-col | Full table |
| `1024–1279` | 3 columns; filter panel 3-col | Full table |
| `768–1023` | 2 columns; filter panel 2-col | Full table, horizontal scroll |
| `<768` | 1 column; filter bar scrolls horizontally with edge fade; **More filters opens a bottom `Sheet`**; results header wraps to two lines | `SchoolMobileList` |

Card min-width 340px means the grid never produces a card too narrow for a three-column
stat row. Below `sm` the stat row stays three columns — the values are short enough
(`$87,400`, `100%`, `88%`) and dropping to two would orphan one.

Touch targets ≥44px: the `+ Add` button, filter chips, and legend items all need
`min-h-11` on coarse pointers. `badge.tsx` already handles this with its
`pointer-coarse:after:min-h-11` hit-area expansion — follow that pattern.

---

## 10. Accessibility

- **Status is never color-only.** The verdict is a word; the caveat is a sentence; the
  balance legend has counts. All survive greyscale
- Verdict band gets `role="group"` + `aria-label="Fit: Reach. 4.6% admit rate."` so the
  card reads as one unit
- `Tabs` and `SegmentedControl` from Base UI ship correct roles and arrow-key nav — don't
  re-implement
- Filter popovers: `aria-expanded` on the trigger, focus moves into the popup, `Esc`
  closes and returns focus
- Results count is an `aria-live="polite"` region so filter changes are announced
- Card stretched-link keeps exactly one real anchor per card
- Every foreground/background pair verified against `semantic.css`'s documented ratios.
  `--ink-faint` (5.33:1 on canvas, 5.51:1 on raised) is the floor for the qualifier text
  and it clears AA. The one new value, `--leaf-200`, is a **border**, so 3:1 non-text
  applies — verify in-browser
- Filter panel disclosure is a real `<button aria-expanded>` controlling a region, not a
  CSS-only checkbox hack

---

## 11. State and data

**Filter state lives in the URL** (filter spec §7.1):

```
/app/schools?tab=explore&state=MA,NY,CT&admit=4-60&size=lt25k&sort=admit
```

Shareable, back-button-safe, survives reload. Each tab keeps its own params. Use the
`useSearchParams` already imported in `SchoolsRoute.tsx`. Debounce URL writes 300ms so
typing in a number field doesn't spam history — use `replace: true` for in-tab changes
and `push` only for the tab switch itself.

**Dummy data.** All Explore data comes from `explore-fixtures.ts` in this pass. Shape it
as the real read model so swapping in a query is a one-line change:

```ts
type ExploreSchool = {
  unitid: string; name: string; city: string; state: string;
  control: "public" | "private"; undergraduates: number | null;
  admitRate: { value: number; basis: "overall" | "in-state" | "out-of-state" } | null;
  testBand: { p25: number; p75: number; submittedPercent: number | null } | null;
  cost: { amount: number; basis: string } | null;
  needMet: number | null; meritAid: number | null; gradFourYear: number | null;
  rounds: { code: string; deadline: string | null }[];
  onList: boolean;
};
```

Every metric field is nullable. Null is a first-class render path, not an error path —
that's what §6.6's `not published` treatment exists for. Do **not** default any of these
to `0` in the fixture; a fixture that never exercises the null path will let a real `0`
ship as a lie.

Verdict classification lives in one pure function, `classifyFit(school, profile)`, taking
the student's state and score. It returns a category plus a reason string plus a
confidence flag — never a probability.

---

## 12. Files

```
frontend/src/styles/
  primitives.css                    ~1 line   + --leaf-200
  semantic.css                      ~1 line   + --success-border
  schools.css                       NEW       ~40 lines, --school-* family
  ../index.css                      ~1 line   + import

frontend/src/components/ui/
  segmented-control.tsx             NEW       @coss
  number-field.tsx                  NEW       @coss
  kbd.tsx                           NEW       @coss

frontend/src/features/schools/
  SchoolsRoute.tsx                  REWORK    → tab shell only, ~120 lines
  MyListPanel.tsx                   NEW       balance bar + existing table
  ListBalanceBar.tsx                NEW
  explore/
    ExplorePanel.tsx                NEW       composition + state
    ExploreFilterBar.tsx            NEW       Tier 1 chips + popovers
    ExploreFilterPanel.tsx          NEW       Tier 2 grid + footer
    ExploreResultsHeader.tsx        NEW       count, personalization, exclusions, sort
    SchoolResultCard.tsx            NEW       the centerpiece
    SchoolResultCardSkeleton.tsx    NEW
    explore-config.ts               NEW       filter definitions, one source of truth
    explore-types.ts                NEW
    explore-fixtures.ts             NEW       dummy data
    classify-fit.ts                 NEW       pure, testable
    useExploreFilters.ts            NEW       URL state
```

Unchanged: `SchoolsTable`, `SchoolMobileList`, `school-cells`, `schools-config`,
`schools-filters`, `schools-sort`, `AddSchoolDialog`, `SchoolWorkspace`.

Every file under 800 lines, every function under 50. `SchoolResultCard.tsx` is the one at
risk — if the caveat ladder and stat-fallback logic push it past ~250 lines, split the
band into `VerdictBand.tsx`.

---

## 13. Build order

1. **Tokens** — §4.1 + §4.2 + `index.css` import. Nothing renders yet; this is the gate
2. **Registry installs** — the three COSS components, one at a time, diff each
3. **Tab shell** — `SchoolsRoute.tsx` splits into two panels. My list moves into
   `MyListPanel.tsx` behaving exactly as today. **Ship-able checkpoint: nothing regressed**
4. **Balance bar** — replaces the pill row. My list is now finished
5. **Card + fixtures** — `SchoolResultCard` with all eight fixture schools, rendered in a
   bare grid with no filters. This is where the design either works or doesn't; look at
   it in a browser before going further
6. **Results header** — count, personalization, exclusions, sort
7. **Tier-1 filter bar** — six popovers, URL state
8. **Tier-2 panel** — six groups + docked data-quality footer, `Sheet` below `md`
9. **States** — skeletons, empty, no-results-with-culprit, error, add-in-flight
10. **Motion + responsive + a11y pass** — in a real browser at 375 / 768 / 1024 / 1440

Steps 3 and 5 are the two places to stop and look. Everything after step 5 is filling in
a design that's already been judged.

### Verification

Not TDD — `AGENTS.md`: "no reflexive tests, a test has to earn its place." Two tests earn
it, both on the honesty path:

- `classify-fit.test.ts` — the verdict must degrade to admit-rate-only when the test band
  is missing or `submittedPercent < 50`, and must never claim a fit it can't support
- A render assertion that a `null` metric produces `not published` and never `0`, `—`,
  or an empty cell

Everything else is verified by looking at it. Screenshots go in `artifacts/`.

---

## 14. Out of scope

- Compare tray / multi-select. Real want, separate surface, don't smuggle it in
- Map view
- Saved searches
- Natural-language query parsing — the search hint is a seam, not a feature
- Backend filter API. This pass is fixtures only
- Card ↔ table toggle on Explore. The two tabs already are the two affordances

## 15. Open decisions

| # | Decision | Default taken |
|---|---|---|
| 1 | Verdict band full-bleed tint on every card, or tint only the badge? | **Full-bleed.** Eight pale bands give a scannable fit distribution across the whole result set. If it reads busy in-browser at step 5, fall back to `--surface-sunken` bands with only the badge tinted — that's a one-token change |
| 2 | Do the 8 fixture cards represent the real coverage rate? | Make them worse than reality on purpose: at least 3 of 8 must have a missing metric, and at least 1 a severe caveat. A clean fixture set hides exactly the paths that matter |
| 3 | Does the personalization chip ship in v1? | **Yes** (filter spec §8.2). It's what separates this from a directory. Without a home state, cost and admit rate pick a default and must say which |
| 4 | Facet counts on the enum filters? | **Yes** for enums, never for ranges (filter spec §8.1) |

---

## References

- [`schools-explore-filters.md`](./schools-explore-filters.md) — which metrics may back a filter
- `frontend/src/styles/README.md` — the four-tier token law
- `frontend/src/styles/semantic.css` — role tokens and their measured contrast ratios
- `AGENTS.md` — principle 3 (never lie to a student), the design-system-first rule, registry-first
- `docs/adr/0026` — the MVP3 design system decision
