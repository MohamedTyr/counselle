# School About tab — visuals plan

How all six sections should look once visuals land. Companion to
`plans/school-facts-page.md`, which covers the honesty model this builds on.

---

## 1. The diagnosis

The About tab is not bland because it lacks charts. It is bland because the
render layer throws away structure the data model already has.

`school-facts-sections.ts` models each section as a `headline` (the 3–10 facts
that matter) plus titled `groups`, with a `render: "shares"` hook.
`sectionRows()` (`school-facts-rows.ts:37`) concatenates all of it into one flat
`FactTableRow[]` before `FactTable` ever sees it. Consequences:

- headline facts and "housing deposit refundable" render at identical weight
- group titles never reach the DOM
- `DegreeShare.percent` — a parsed number sitting next to a comment reading
  *"the one place a bar is legal on this page"* (`school-facts-types.ts:218`) —
  is discarded at `school-facts-rows.ts:65` and rendered as text
- `schools.css` defines `--school-fact-well`, `--school-fact-caveat`,
  `--school-fact-caveat-severe-*` with zero consumers

So the prerequisite for every visual below is the same refactor. It also fixes
a large share of the blandness on its own, with no chart at all.

---

## 2. Components — what we use and why

Searched `@coss`, `@kokonutui`, `@ai-elements`, `@shadcn` (2026-08-26).

- **`@shadcn` ships `chart`** — a Recharts 3.8 wrapper (`ChartContainer`,
  `ChartTooltip`, `ChartLegend`, theme-aware `--chart-*` vars). Verified live
  alongside the preset blocks `chart-bar-horizontal`, `chart-bar-label`,
  `chart-bar-multiple`, `chart-bar-stacked`, `chart-line-dots`,
  `chart-line-step`, `chart-radial-simple`, `chart-tooltip-default`.
- **`@coss` has no chart component.** It ships `meter`, `progress`,
  `segmented-control`. `frontend/src/components/ui/meter.tsx` is already the
  COSS meter.
- **`@kokonutui`** — decorative/AI components only. Nothing relevant.
- **`@ai-elements`** — chat surfaces only. Nothing relevant.
- **watermelon** — no reachable registry on four candidate hosts. Unverified.

**Decision: use the shadcn `chart` component for every visual that shadcn has a
chart for.** Only build custom where shadcn genuinely has no equivalent.

```bash
cd frontend && npx shadcn@latest add @shadcn/chart
```

Snag to expect: `npx shadcn@latest` (4.19.0) failed with `Invalid Version`
during planning. Pin a working CLI version, or add the item from its registry
URL directly, before assuming the install is a no-op.

### Mapping

| Visual | shadcn base | Shape |
|---|---|---|
| Degree shares | `chart-bar-horizontal` | `BarChart layout="vertical"`, one bar per field, sorted descending |
| Applicant funnel | `chart-bar-horizontal` | three bars, shared domain `[0, applicants]` |
| Aid coverage | `chart-bar-horizontal` | three bars, domain `[0, 100]` |
| Campus composition | `chart-bar-horizontal` | three bars, domain `[0, 100]` |
| Class sizes | `chart-bar-horizontal` | one bar per bin, domain `[0, largest bin]` |
| Completion gap | `chart-bar-multiple` | two bars, one axis |
| Time to degree | `chart-line-dots` | cumulative line, dots at 4 / 5 / 6 years |
| SAT / ACT bands | `chart-bar-horizontal` | Recharts `Bar` accepts an **array** `dataKey` (`[p25, p75]`), which renders a floating bar — the range band, natively. `ReferenceLine` marks p50. |
| **Selection factors** | **none** | 12 ordinal categories, not magnitudes. No shadcn chart represents this; a bar would assert a numeric scale that does not exist. **The one custom component.** |

### Components to write

Thin wrappers over `ChartContainer`, not new chart engines:

- `FactBarChart` — horizontal bars. Props: rows, domain (`[0, n]` or `[0, 100]`),
  value formatter. Backs six of the eight visuals above.
- `FactRangeChart` — floating-bar range + p50 `ReferenceLine`. One per test.
- `FactStepChart` — cumulative line with dots.
- `FactOrdinal` — the 4-step strip. Plain CSS, the only non-shadcn piece.

### Theming the charts

shadcn charts default to `--chart-1…5`. We are monochrome (§4), so define those
vars for this surface as a single ink value rather than five hues, and let
`ChartContainer`'s existing theme plumbing carry dark mode. Do not hand-pass
`fill` per series — that bypasses the mechanism and breaks theming.

Also strip the chrome these presets ship with: no legend (one series), no grid,
no axis lines. Keep `ChartTooltip` off — every value is printed as text beside
its bar anyway (§4), so a tooltip would hide nothing and add a hover
dependency.

Fix while in there: `meter.tsx`'s `MeterIndicator` has an unconditional
`transition-all duration-500` with no reduced-motion gate.

---

## 3. The seam

`sectionRows()` → `sectionBlocks(data, section): SectionBlock[]`, where

```ts
type SectionBlock =
  | { kind: "rows";     rows: FactTableRow[] }
  | { kind: "bars";     title: string; foot: string | null; bars: BarDatum[] }
  | { kind: "scale";    title: string; foot: string | null; scales: ScaleDatum[] }
  | { kind: "ordinal";  title: string; foot: string | null; items: OrdinalDatum[] }
```

`SchoolFactsSection` maps blocks to renderers. `GroupConfig.render` becomes the
discriminant that decides which block a group produces; groups without one
still produce `{ kind: "rows" }`, so nothing regresses.

**Data must arrive typed, never parsed from display strings.** `DegreeShare` is
the precedent: a named array field on `SchoolFacts` carrying its own numbers
plus its `FactState`. Every new visual family gets the same shape
(`TestScoreBand[]`, `ClassSizeBin[]`, …), populated server-side against the live
manifest. This is what reconciles a chart's need for named refs with the
"no hardcoded metric inventories" rule: the catalogue of what is plotted lives
server-side; the client iterates whatever array it is given and treats empty as
legitimate.

Verified while planning: `p25/p50/p75` exist as separate refs with
numeric-string raws in the fixtures (`reported("740")`, `fixtures/shared.ts:39`),
but the composite is display-only (`"1500–1560"`). Bands need numeric bounds
supplied by the packet. **Do not parse the display string.**

---

## 4. Shared design rules

**Monochrome.** Bars, bands and ticks in `--ink`; tracks in `--control-track`;
absent states in `--school-fact-absent`, italic. No categorical palette, no
per-section accent hue. This page's only job is to be trustworthy, and coloured
charts read as marketing.

**Numbers stay printed.** Every bar, band and dot prints its value as text
beside it. The shape is the affordance; the number is still the fact. Screen
readers, print and greyscale all get everything without a separate path.

**Visuals are not boxed.** A visual block sits exactly where its group's rows
would have sat: same card, same left edge, full width, group title above it in
the same style as every other group title. No borders, no tint, no nested card.
One surface top to bottom.

**Hierarchy is density, not scale.** Headline rows `py-5` / `text-base` /
`font-medium`. Body rows `py-3.5` / `text-sm` / `font-normal`. No hero numbers.

**Group titles** return as spanning rows inside the table: `text-sm
font-medium`, `--ink-secondary`, `pt-6 pb-1`. Extra top space is the only
separator — no rules, no eyebrows, no icons, no numbering.

**Motion.** Bars and bands animate their width on first mount only, 340ms
`cubic-bezier(0.16, 1, 0.3, 1)`, staggered 40ms, capped at the first ~8 items.
Never on refetch. Panel keeps its existing 200ms fade. All gated behind
`prefers-reduced-motion`.

**Section footers.** A chart that cannot be read correctly without a qualifier
carries one line of `text-xs` `--school-fact-caveat` directly beneath it, and
nowhere else. This is the single place prose returns to this tab — see §8.

**Responsive.** `ChartContainer` is already `ResponsiveContainer`-backed, so
width is handled. Below `sm`, `FactRangeChart` drops interior tick labels and
keeps its endpoints; `FactBarChart` moves its printed value under the label
rather than to the right. Known existing bug to fix: `FactTable`'s `sm:w-[38ch]` value cap does not
apply below 640px, so a long prose value can crush the label column at 375px.

---

## 5. Section by section

### Getting in — the densest, and the one with the most shape

1. **Headline rows.** Admit rate, in-state / out-of-state / international /
   ED rates, SAT + ACT middle 50, GPA, top-tenth share. Promoted density. Admit
   rates stay as rows — "3.7%" needs no bar.
2. **How they weigh your file** → `FactOrdinal`. Twelve factors, each a 4-step
   strip (Not considered → Considered → Important → Very important), sorted by
   importance descending so the top of the block *is* the answer. Filled steps
   in `--ink`, empty in `--control-track`. This is the single most
   spreadsheet-looking block on the page today and the cheapest to fix.
3. **Test scores in detail** → `FactRangeChart`. Four tracks: SAT
   composite, SAT EBRW, SAT math, ACT composite. Each on **its own scale**
   (200–800 and 1–36 never share an axis), endpoints labelled, band from p25 to
   p75, 2px tick at p50, values printed at the band edges.
   Foot: the submitter rate, e.g. "62% of enrolled students submitted an SAT score."
4. **Applicant pool** → `FactBarChart` in count mode. Three bars — applicants,
   admitted, enrolled — sharing one `max` (applicants), left-aligned on one
   baseline. Not a trapezoid funnel; three bars make the ratio readable. The
   in-state/out-of-state split renders as a second trio only when both counts
   exist, never as a broken half.
5. **Required units**, **Class rank**, **Waitlist** → tables. Class rank bands
   overlap and can never be charted; a waitlist funnel would visually assert a
   conversion rate the data explicitly is not.

### Money — the "will they cover me" section

1. **Headline rows.** Sticker cost, in-state and out-of-state tuition, share
   whose need was fully met, average need-based award, share receiving
   need-based grant, average debt at graduation.
2. **Aid coverage** → `FactBarChart`, three proportion bars on one 0–100 scale:
   share receiving need-based grant aid, share whose need was **fully** met,
   average percent of need met. Three independent percentages, same axis, so
   the difference between "most students get aid" and "few get all of it" lands
   in one glance. Each bar labels its own denominator, because the third one's
   base is aid *recipients*, not all students.
3. **Cost of attendance, itemized** → table. Itemized rows and the combined
   comprehensive figure are documented **alternatives**, not a total and its
   parts; a stacked bar tells a reader the missing segments are $0.
4. **Living arrangements**, **price escalation**, **merit aid**,
   **international aid**, **forms and deadlines** → tables.

### Academics — the flagship visual lives here

1. **Headline rows.** Students per faculty, share of classes under 20, share
   50+, full-time faculty share, terminal-degree share.
2. **What students graduate in** → `FactBarChart`, one bar per field of study,
   sorted descending, label left / bar / percent right. Single ink fill — not a
   stacked bar, not a rainbow. This is the block the type system already
   named and then never rendered. Edge cases already enumerated in its type
   comments: `"<1%"` renders as a ~2px sliver carrying its literal string; a
   genuinely reported `0%` renders a labelled zero-width tick, never omitted;
   anything not reported drops to a text row beneath the bars.
3. **Class sizes** → `FactBarChart` in **count** mode. One bar per size bin, scaled
   to the largest bin — never to a total, so a missing bin cannot corrupt the
   picture. Lecture sections and subsections are two separate groups of bars,
   never merged: subsections are where the small-group experience behind a
   large course actually shows up.
4. **Special study options**, **core curriculum**, **faculty** → tables.

### Campus life — modest, honestly

1. **Headline rows.** Undergraduate and graduate totals, share in college
   housing, share international, share out-of-state, academic calendar.
2. **Who's here** → `FactBarChart`, three proportion bars on one 0–100 scale: share
   in college-owned housing, share international, share out-of-state. Same
   primitive as Money's aid coverage.
3. **Greek life**, **who's on campus**, **ROTC** → tables. Greek shares sit on
   two different population bases (percent of men, percent of women); putting
   them on one axis would invite a comparison that is not there.

This section simply has less shape than the others. It should not be padded to
match their weight.

### Outcomes — short, and that is information

1. **Headline rows.** First-year retention, four-year completion, six-year
   graduation, Pell six-year graduation.
2. **Time to degree** → `FactStepChart`. One 0–100% cohort track
   with three labelled dots at four, five and six years. The gap between the
   four-year and six-year dot is the entire point: it is a year of tuition,
   made visible instead of requiring mental subtraction.
3. **Completion gap** → `FactBarChart`, two bars on one axis: all students vs Pell
   recipients, six-year rate. Two numbers, but the gap is the story and it is
   currently invisible several rows apart.

A half-height section is honest. Do not inflate it.

### Applying — no charts, a genuinely different shape

Applying is already structurally unlike the other five: it is dual-lane truth
(the school's current page vs the CDS, allowed to disagree), not name/value.
Lean into that.

- **Rounds** render as a real table with round code / deadline / decision date,
  one row per round. A round the school does not offer says "not offered"; a
  round whose flag we could not read says "not reported" — these never collapse.
- **Decision notification**, **other terms**, **deposits** → tables.
- A timeline chart for two or three dates would be decoration, and several
  entries are un-plottable absence states.

Applying's identity is that it looks like a schedule. That is enough.

---

## 6. Honesty rules for visuals

These are non-negotiable and get hard tests (the AGENTS.md carve-out — this is
data-integrity code).

1. **An absence is a sentence, never a visual zero.** A `state.kind !==
   "reported"` entry renders the absence sentence in the absent ink. It must not
   render a zero-width bar, an empty segment, a gap in a scale, or a dropped
   row. This is the page's worst possible failure and the exact reason
   `DegreeShare.percent` is `number | null`.
2. **A reported `0` is a fact.** It renders its label and "0%" at full value
   weight even when the bar itself has no width, so it is never visually
   identical to "no data".
3. **Never chart a total that a missing input could corrupt.** Counts scale to
   the largest bar, not to a sum. Percentages are only charted when the packet
   supplies them; they are never computed client-side from partial inputs. This
   is the existing `DerivedFact.blockedBy` discipline applied to geometry.
4. **Never chart overlapping bands** (class rank) **or alternatives**
   (itemized vs comprehensive cost).
5. **An empty backing array is legitimate** and renders the section's existing
   "doesn't cover this section" copy — never an empty frame or bare axis.
6. **A qualifier a chart cannot be read without renders with the chart**, not
   in a tooltip and not behind a disclosure.

### Tests to write

Extending `school-facts-honesty.test.tsx`, per new datum type, across all three
fixtures (Yale, Northeastern, city-college):

- a non-`reported` entry renders its sentence and produces **no** bar/band/dot
  element (assert absence of the element, not a zero width)
- a reported `0` renders a labelled "0%" distinguishable from not-plotted
- an empty array renders the existing empty-state copy, not an empty frame

---

## 7. Build order

| # | Work | Why here |
|---|---|---|
| 0 | `sectionRows` → `sectionBlocks`; group titles render; headline density step | Prerequisite for everything, and fixes much of the blandness alone |
| 1 | `FactBarChart` + degree shares (Academics) | Data, type and hook already exist; highest certainty win |
| 2 | `FactOrdinal` + selection factors (Getting in) | No numbers, so no arithmetic honesty risk; biggest visual change per line of code |
| 3 | `FactBarChart` reuse: aid coverage, campus composition, completion gap, applicant funnel | One primitive, four blocks, all from data that exists today |
| 4 | `FactStepChart` + time to degree (Outcomes) | Cheap once the primitive exists |
| 5 | `FactRangeChart` + SAT/ACT (Getting in) | **Blocked** on typed numeric p25/p50/p75 from the packet |
| 6 | `FactBarChart` count mode + class sizes (Academics) | Lowest value of the set; ship if it still feels thin |

Steps 0–4 need no backend change. Step 5 is a Standard-tier change (new type,
new packet field), not frontend polish — scope it separately.

Fold in while touching these files: `components/ui/table.tsx:64` hover uses a
raw `color-mix(in srgb, …, 2%)` instead of the `--surface-hover` token, and
`meter.tsx`'s indicator transition needs a reduced-motion gate.

---

## 8. Decisions made here

- **shadcn `chart` (Recharts) is the chart layer.** Every visual that shadcn
  has a chart for uses it. `FactOrdinal` is the only custom component, because
  twelve ordinal categories are not a magnitude and no shadcn chart represents
  them. The presets ship with grid, axes, legend and tooltip — strip all four;
  what we keep is the geometry and the theming plumbing.
- **Prose stays out, with one exception.** The earlier instruction for this tab
  was name and value only. That holds for rows. But a range band without its
  submitter rate presents a percentile drawn from a self-selected half of the
  class as if it described everyone, so a chart that cannot be honest without a
  qualifier carries one `text-xs` line directly beneath it. This applies to the
  test-score bands and the average-percent-of-need-met bar, and to nothing
  else. Group caveat prose does **not** come back.
- **Monochrome, numbers always printed.** Follows from the page's purpose;
  also makes the accessible and print paths free rather than a second system.

---

## 9. Changed during the build

Two deviations from §5, both found by looking at the rendered page.

**Time to degree is bars, not `chart-line-dots`.** On a zero-anchored cohort
axis Yale's three points (1,367 / 1,478 / 1,507 of 1,554) drew a flat line
pinned to the top of a mostly empty plot, and the left tick clipped. The same
three numbers as bars against the cohort put the four-to-six-year gap back in
view, sit in the page's one visual language, and removed a whole component —
`FactStepChart` and the `markers` block kind are gone.

**A configured denominator that is missing collapses the group to rows.** The
first cut fell back to self-scaling when `maxRef` could not be read. On
Northeastern — which does not report its applicant count — that would have
drawn "3,850 admitted" at full width against a ceiling nobody supplied,
reading as *everyone got in*. `barDomain()` now returns null in that case and
the group degrades to rows. Covered by a test.

Three smaller ones, all honesty-adjacent:

- Recharts draws **nothing** for a value of `0` — no rect, and so no label
  either. Yale's genuinely-reported 0% field of study vanished from the chart.
  `minPointSize={2}` gives a reported zero a tick that keeps its printed "0%".
- The bar equal to the domain had its value label drawn past the SVG edge,
  where it clipped — "689" rendered as "68". Right margin is now reserved from
  the longest printed value rather than the domain being padded, which would
  have misstated every other bar.
- A high band sits hard against the right end of its scale, so the range label
  clipped there too. The range now reads as a heading above the track.
