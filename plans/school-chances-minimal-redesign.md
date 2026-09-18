# Compare — minimal redesign

**Status:** Draft for owner approval
**Date:** 2026-09-16
**Scope:** The visual and interaction design of `frontend/src/features/schools/chances/` — the GPA, SAT and ACT screens of the school `Compare` tab. No backend, no new facts, no new claim.
**Supersedes visually, not contractually:** `plans/school-chances-visuals-plan.md` (that plan's §2.2 scope boundary and honesty rules stay binding word for word).

---

## 0. What I actually looked at

All three screens were rendered from the real fixtures at `http://127.0.0.1:4175/dev/school-chances` (1280px viewport, Chromium) and measured. Every number below is from those pixels, not from reading the code.

| Screen | Panel height | Distinct text elements | Date stamps | Mark languages in the plot |
|---|---|---|---|---|
| GPA | 786px | 17 | 2 | 3 (bars, brand rule, callout) |
| ACT | 766px | 16 | 4 | 5 (band fill, two p25/p75 rules, average diamond, your dot) |
| SAT | **1,340px** | 29 | **6** | 5, drawn twice |

Three findings dominate everything else.

**1. The plot is mostly empty, and that is a geometry bug, not a taste problem.**
`academic-comparison-geometry.ts:5` returns `lane.band ?? …` as the domain, and `BandModel` carries `min`/`max` that are the *instrument* scale, not the band. So ACT draws 1–36 and spends 89% of the chart width on the empty stretch below 30. SAT draws 200–800 and clusters everything into the right quarter. The single highest-leverage change in this document is windowing the axis to the data.

**2. The screen says everything twice, then footnotes itself.**
On GPA: the verdict sentence says "3.75 – 3.99 band", the ledger says "Reported band 3.75 – 3.99", and the bucket grid says "3.75 - 3.99 / 50%" — three renderings of one fact, plus `In this band 50%` which is a fourth. On SAT, `Reported 2025–26` is printed six times. `Reported breakdown: Score of 700 - 800: 55%` is a text list of numbers that the chart directly above it already draws.

**3. Nothing on the screen is the hero.**
Every element is 12–14px muted gray except one 18px heading that repeats the tab's own name. The competitor's screen works because `95%` is 40px and everything else defers to it. Ours has no focal point at all, so the eye has nowhere to land and the density reads as noise.

Secondary, but real: the `--brand` lime-500 slider track (`#7ccf00`) is the loudest thing on a screen where it carries no meaning — it is a control chrome, while the student's actual position is a thin gray-green rule. The colour is spent in exactly the wrong place.

---

## 1. The thesis

> One sentence, three numbers, one shape, one control. Nothing else above the hairline.

Everything the student needs is the answer to three questions, in this order:

1. **Am I in range?** → a sentence
2. **Where exactly, and how far?** → a shape with one mark on it
3. **What would a different score do?** → drag the mark

Bucket percentages, reported periods, reported breakdowns, instrument scales, sums-to caveats, and testing-policy text are all footnote material. They do not disappear — §6 gives every one of them a named destination — but none of them gets to sit at the same visual weight as the answer.

---

## 2. The graph

The bar-chart-with-callouts and the band-rail-with-five-marks both go. They are replaced by **one visual grammar used on all three screens**: *the class as a continuous silhouette along an axis, and you as the only high-contrast mark on it.*

### 2.1 Three renderers, one language

The renderer is chosen by what data actually exists — not by metric — so GPA, SAT and ACT look like the same product.

**A. Stepped area** — when a bucket distribution exists (GPA always; SAT/ACT when reported).
One continuous filled step-shape across the reported bucket edges. Flat top per bucket, vertical risers at edges, closed to the baseline.

```
                    ┏━━━━━┓
              ┏━━━━━┛     ┃
   ┏━━━━━━━━━━┛           ┗━━━━━┓
───┸───────────────────────────┸────────
  3.00                          4.00
```

*Why stepped and not a smooth curve.* A spline through bucket midpoints invents a value at every x between two reported edges, and this codebase does not invent values (AGENTS.md principle 3). A step asserts exactly what the school reported: this percentage, across this range, and nothing about the shape inside it. It also happens to look better — the risers give the silhouette an architectural edge that a soft curve does not have, and it reads as *measured* rather than *modelled*. **Recommendation: stepped. Do not smooth.**

**B. Band rail** — when only a middle 50% exists (the common SAT/ACT case).
A single rounded horizontal bar, 10px tall, spanning p25→p75 on a hairline axis. The fill's own two edges *are* the endpoints, so the two vertical p25/p75 rules are deleted. The reported average, when there is one, is a 1px tick through the rail — not a diamond glyph.

```
  ────────────────────█████████│██████────────────────
                     30        32        34
```

**C. Point** — when only an average exists. A hairline axis and a single tick. No shape is invented to fill the space.

### 2.2 The mark

Identical in all three renderers, and it is the only thing on the screen with full contrast:

- a **2px vertical rule** at the student's value, full plot height, in `--brand-scale-3` (`#2d4d08`, 9.65:1 — a deep evergreen that reads nearly black and looks expensive; *not* lime-500)
- a **value pill** riding the top of the rule: 13px, `tabular-nums`, `--brand-scale-3` on `--brand-subtle`, 6px radius
- while a local scenario differs from the saved profile, the scenario mark is the same geometry in `--brand` (lime-500) and the saved value stays as a 1px dashed rule in `--ink-faint`

This gives lime-500 an actual job — *"this is the hypothetical, not your real score"* — instead of being decorative slider chrome. Three marks on the plot, down from five.

### 2.3 Colour and tokens

New, in `frontend/src/styles/schools.css` (Tier 3 — resolves through `semantic.css`, no primitives, per that file's own header):

```css
--school-chances-class-fill:  color-mix(in oklch, var(--ink-faint) 14%, transparent);
--school-chances-class-edge:  color-mix(in oklch, var(--ink-faint) 45%, transparent);
--school-chances-axis:        var(--hairline);
--school-chances-you:         var(--brand-scale-3);   /* replaces profile-outline */
--school-chances-you-chip:    var(--brand-subtle);
--school-chances-scenario:    var(--brand);           /* unchanged, now load-bearing */
```

`--school-chances-mark` (currently `--ink-secondary`, `#524b48` at full strength — the mud brown in the screenshots) is retired. Institutional data is a *wash*, not a solid. Both themes get the fill from one `color-mix` over `--ink-faint`, so dark mode needs no second definition.

### 2.4 The axis window — the fix that changes everything

Replace `scoreDomain()` with `plotWindow()`:

```
span      = [min(drawn data lo, student value), max(drawn data hi, student value)]
padded    = span expanded by 12% of its own width on each side
window    = padded clamped to the instrument domain, then snapped outward
            to a nice tick (GPA .25 · SAT 20 · ACT 1)
minimum   = never narrower than 15% of the instrument scale
```

ACT 30–34 with a student at 33 becomes a window of roughly **28–36 instead of 1–36**: the band goes from 11% of the width to about 50%, and the 200px of dead space on the right of the current ACT screenshot disappears.

**The honesty trade-off, stated plainly.** Cropping magnifies. A 4-point ACT band filling half the width could read as wider than it is. Three mitigations, all required:

1. Both window endpoints are **always labelled with their real values** under the axis. The reader can always see what range they are looking at.
2. The `minimum` floor above stops a 1-point band from being blown up to full width.
3. The `ChartFigure` accessible summary keeps stating the **full instrument scale** ("on the 1–36 ACT scale") exactly as it does today, so the screen-reader text is not cropped at all.

This is what every competent chart does and it is not a misstatement — but it is a deliberate choice, so it is called out here rather than buried. **Decision needed from the owner: approve windowing, or keep full-scale.** Everything else in this plan works either way; it will just look emptier.

### 2.5 Geometry

| | Height |
|---|---|
| Stepped area (GPA) | 132px |
| Band rail (SAT/ACT) | 88px |
| Axis label row | 20px |

Full panel width, no left gutter, no y-axis, no gridlines, no legend. The step's flat tops carry the proportions; a y-axis would add a second reading task for a shape nobody needs to read numerically.

---

## 3. The screen

```
┌──────────────────────────────────────────────────────────────┐
│  [ GPA ][ SAT ][ ACT ]                    Checked Sept 2026   │
│                                                               │
│  Your 3.82 sits in the school's top reported GPA band.        │
│                                                               │
│  You              Reported band        Of the class           │
│  3.82             3.75–3.99            50%                    │
│                                                               │
│                              ┏━━━━━┓                          │
│                    ┏━━━━━━━━━┛     ┃  ▌3.82                   │
│         ┏━━━━━━━━━━┛               ┗━━━━┓                     │
│  ───────┸────────────────────────────────┸──────────          │
│   3.00                                        4.00            │
│                                                               │
├───────────────────────────────────────────────────────────────┤
│  Reported entering-class data — not a cutoff or a chance.     │
└───────────────────────────────────────────────────────────────┘
```

**Element by element:**

- **Metric control.** The `SegmentedControl` stays (three options, both visible at once, no click to discover — better than the competitor's dropdown). Restyled lighter: `--surface-raised` track, no border, 12px label.
- **`<h2>` "How your academics compare" is deleted.** The tab is already called Compare and the verdict sentence says what it is. It was a label for a labelled thing.
- **Verdict.** 17px / 1.45, `--ink-primary`, max 48ch, `text-wrap: pretty`. One sentence. This is the only prose on the screen.
- **The three numbers.** Label 12px `--ink-muted` above, value **30px weight 500 `tabular-nums` `-0.01em`** below. Three columns on ≥640px, a 2+1 grid below that.
  - GPA → `You` / `Reported band` / `Of the class`
  - ACT → `You` / `Middle 50%` / `Reported average`
  - SAT → handled per-lane, see §4
  - A cell with no value renders its server-owned absence wording at 15px in `--school-value-absent`, never blank, never a dash (DESIGN.md §15.5).
- **The shape.** §2.
- **One hairline**, above the footer. Currently there are three internal dividers; two of them separate things that do not need separating.
- **Footer.** The `CHANCES_TRUTH_FOOTER` line, shortened to *"Reported entering-class data — not a cutoff or a chance."* (from 96 chars to 58; same claim, and it now fits on one line at 390px). 12px `--ink-muted`.

> **Note on the impeccable "hero-metric template" ban.** That ban targets a decorative big-number-plus-supporting-stats SaaS hero. Here the three numbers *are* the data the screen exists to deliver, and the type contrast between them and the verdict is the hierarchy the current screen is missing entirely. Applying it: exactly three, no icons, no accent colour on the digits, no cards around them.

---

## 4. SAT — the screen that needs the most surgery

1,340px today, and it is two full copies of the ACT screen stacked with a shared header. Target: **≈520px.**

One verdict, one date, one footer, and **two compact lane rows sharing one visual scale**:

```
  Both sections sit inside the school's reported middle 50%.

  Math                                              Reading and Writing
  760                                               740
  ──────────────█████│███▌──────                    ──────────█████│██▌────────
   690      725     760                              680    715    750
```

- Each lane row is **108px**: inline label (13px `--ink-muted`), value (30px), rail (88px), endpoint labels.
- Two lanes, one grid, `sm:grid-cols-2` on ≥768px and stacked below. Side by side is the point: sections are meant to be compared to each other.
- The `<h3>` "Math" / "Reading and Writing" at 16px semibold becomes the inline 13px label. Two headings on one card was already too many.
- **Deleted from this screen:** `Your SAT 1500 shown for context` (the context claim is weak and it is the one number on the screen that is not compared to anything — move it to the verdict sentence when it exists), the `Comparison / Compared by section` ledger cell (says nothing), the per-lane `200–800 scale` caption, both `Reported breakdown` lists, and four of the six date stamps.
- **Testing policy** moves out of the body to a single 12px line beside the freshness stamp in the header, where the other metadata already lives.

---

## 5. Interaction — the chart *is* the control

`ScenarioExplorer` and `ScenarioLaneControl` are deleted as UI. Today they cost a section heading, a "Local scenario only" caption, a per-lane label, a range caption, a full-width lime slider, a bordered number field, an error slot, a position line and a hint line — roughly 120px per lane — to do something the chart can do by itself.

**The plot becomes the slider.**

- **Pointer:** press anywhere on the plot and drag. The mark follows 1:1, snapped to the metric's step grid (`scenario-explorer-model.ts`'s existing grid logic is kept and reused — it is the part worth keeping). The pill value and the verdict update live.
- **Keyboard:** the plot is a single `role="slider"` focusable element. `←/→` one step, `⇞/⇟` ten, `Home`/`End` window ends. `aria-valuetext` reuses `scenarioSetCopy()` verbatim, so the existing announcement contract survives the deletion.
- **Exact entry:** the pill itself is the number input. Click it (or press `Enter` on the focused plot) and it becomes a borderless 4-character `tabular-nums` field in place. Off-grid entry shows the existing `errorCopy()` inline under the pill. This keeps precise entry without a bordered box floating in its own column.
- **Reset:** a 13px text button appears next to the pill *only while a scenario differs*. `Reset` — one word; which metric is being reset is unambiguous from context, so the three variants of "Reset to your GPA" / "Reset SAT" / "Reset to your ACT" collapse to one string.
- **Affordance.** A chart that is secretly draggable is a chart nobody drags. On hover (`@media (hover: hover) and (pointer: fine)`) the cursor becomes `ew-resize` and a 1px ghost rule tracks the pointer; on touch and at rest, a 12px `--ink-muted` line under the axis reads **"Drag to try a different score"**, fading out permanently after the first successful drag in a session. On coarse pointers the plot gets 12px of vertical touch padding beyond its visual bounds so the 44px minimum is met without making the shape taller.
- **Nothing persists.** No `PATCH`, no mutation, no estimator call — the §2.2 boundary is unchanged, and the route-level test that proves it stays.

---

## 6. Everything being removed, and where it goes

Nothing here is deleted outright. Every caveat has a destination, because in this repo removing a caveat from view is a product decision and not a layout tidy.

| Removed from the screen | Destination |
|---|---|
| `<h2>` "How your academics compare" | Gone. Duplicated the tab name. |
| `ComparisonLedger` 3–4 cell `<dl>` | Becomes the three-number key row (§3) |
| `Comparison: Compared by section` | Gone. Asserts nothing. |
| `Your SAT 1500 shown for context` | The verdict sentence, when a total exists |
| GPA bucket grid (`gpa-comparison-buckets`) | The shape draws it; the scrub pill reads out the hovered bucket's label + % |
| `ScoreBreakdown` "Reported breakdown: …" | Same — the shape, plus the `ChartFigure` summary (unchanged) |
| `ScoreValueRow` run-on line (`200 … 800 Average 725 Reported 2025-26`) | Axis endpoint labels + the average tick + the numbers row |
| 5 of 6 `Reported 2025–26` stamps | One header freshness line. A per-field period that **differs** from the page freshness still prints, beside the number it belongs to. |
| `200–800 scale` / `1–36 scale` captions | Axis endpoints + the a11y summary's full-scale statement |
| `Explore` heading, `Local scenario only` | Gone. §5's affordance line replaces both. |
| Slider + bordered number field + range caption + hint | The plot itself; the pill is the input |
| `p25`/`p75` vertical rules, the average diamond glyph | The rail's own edges; a 1px tick |
| `sumsTo ≠ 100` caveat | **Stays visible, but conditionally**: inline only when `|sum − 100| > 5`; always in the a11y summary. A 99.4% total does not need a sentence. |
| `Testing policy: …` | One header line beside the freshness stamp |

**The `ChartFigure` accessible summary text does not shrink at all.** It already carries every bucket, period, band, average, policy and caveat in full, and it stays the canonical complete rendering. A test should assert exactly that: for each of the fixtures, every string removed from the visual tree still appears in the summary.

---

## 7. Motion

Restrained by policy — this is a functional data graph, not a marketing surface, and the drag is a high-frequency interaction.

| What | Treatment |
|---|---|
| Mark during drag | **No animation.** 1:1 with the pointer. A spring here reads as lag. |
| Mark on release / on keyboard step | `transform` 180ms `cubic-bezier(0.23, 1, 0.32, 1)` |
| Verdict + numbers on value change | 120ms opacity crossfade; `tabular-nums` so widths never jump |
| Metric switch (GPA↔SAT↔ACT) | Shape crossfades with `opacity` + `filter: blur(3px) → 0` over 160ms — blur bridges two dissimilar silhouettes that a plain crossfade shows as two overlapping objects |
| Pill grab | `scale(0.96)`, 160ms ease-out |
| First paint | No entrance. `MetricPlotReveal` is kept for the *first visit to an unseen metric* only, reduced from 200ms to 160ms. |
| `prefers-reduced-motion` | All of the above become instant. The mark still moves; only the tweening stops. |

Transitions name their exact properties (`transition-property: transform, opacity`), never `all`. Motion is never the only feedback channel: every value change also changes the printed number.

---

## 8. Build order

Each phase is independently shippable and independently reviewable.

**P0 — geometry and tokens** *(pure, no visual change yet)*
`plotWindow()` in `academic-comparison-geometry.ts` replacing `scoreDomain()`; the six new tokens in `schools.css`; retire `--school-chances-mark`. Unit tests for the window: clamping, the 15% floor, tick snapping, student-outside-band, student-outside-instrument-scale, single-point data.

**P1 — the shape**
New `ClassShape.tsx` with the three renderers (`stepped` / `rail` / `point`) and `YouMark.tsx`. Recharts stays — it is installed and the `ChartContainer`/`ChartFigure` shell is the accessible seam we already own. The stepped area is a Recharts `Area` with `type="stepAfter"`; the rail is a `ReferenceArea`. Deletes `academic-comparison-marks.tsx`, `GpaComparisonMarkers.tsx`, `ScoreBandDetails.tsx`.

**P2 — recomposition**
`SchoolChancesPanel.tsx`: the verdict, the three-number row, the single hairline, the shortened footer, the header metadata line. Deletes `ComparisonLedger`, `ScoreBreakdown.tsx`, the GPA bucket grid, `ScoreValueRow`. Copy edits in `school-chances-copy.ts` and `score-plot-copy.ts`.

**P3 — scrub**
The plot as `role="slider"`; the in-pill number input; the affordance line; one `Reset`. Deletes `ScenarioExplorer.tsx` and `ScenarioLaneControl.tsx`; **keeps** `scenario-explorer-model.ts` for grid/step validation and `scenarioSetCopy()` for announcements.

**P4 — SAT**
The two-lane shared-scale row (§4).

**P5 — verification** *(the gate)*
The dev gallery at `/dev/school-chances` already renders the full state matrix, so this is cheap and there is no excuse for skipping it. Real browser, all fixtures:
- 390 / 768 / 1280px; light and dark; `prefers-reduced-motion: reduce`
- keyboard-only: tab to plot, arrow, `Home`/`End`, `Enter`-to-type, reset — focus never lands on `<body>`
- every absence/incompatible/partial fixture still states its absence in its own words
- contrast: verdict and the three numbers ≥4.5:1 in both themes; the class fill vs. surface and the mark vs. fill ≥3:1 as graphical objects (WCAG 1.4.11)
- measured before/after panel heights recorded in the plan's divergence note

**Targets:** GPA 786 → **≈470px**. ACT 766 → **≈430px**. SAT 1,340 → **≈520px**.

---

## 9. Tests

Per AGENTS.md: no reflexive tests, honesty-critical paths tested hard.

- **Keep and extend:** `school-chances-model.test.ts` (980-line model is untouched by this work — it stays the contract), `school-chances-contract.test.ts`.
- **Add:** `plotWindow()` unit tests (P0); one summary-parity test asserting that every string removed from the visual tree still appears in the `ChartFigure` summary for every fixture; the existing route-level no-write assertion stays green.
- **Rewrite:** `SchoolChancesPanel.test.tsx` (649 lines) and `academic-comparisons.test.tsx` (553) assert the current DOM densely and will not survive. **This is the single largest cost in the plan** — budget it as roughly a third of the total effort, and rewrite them against the new structure rather than patching selectors.
- **Delete:** assertions on the bucket grid, the breakdown list, the value row, and the slider/number-field lane UI.

---

## 10. Decisions the owner needs to make

1. **Axis windowing (§2.4).** Crop to the data with labelled endpoints, or keep full instrument scale? Recommendation: **crop.** It is the difference between a chart and a mostly-empty rectangle, and the three mitigations hold the honesty line.
2. **Stepped vs. smoothed (§2.1).** Recommendation: **stepped**, and I would push back on smoothing even if asked — a spline invents values between reported bucket edges.
3. **The `sumsTo` caveat threshold (§6).** Always visible today; proposed at `|sum − 100| > 5`. That threshold is a judgement call about what counts as materially incomplete.
4. **Deleting the explicit slider (§5).** The chart-as-slider is better and much smaller, but it is a discoverability bet. The affordance line and the `ew-resize` cursor are the hedge; if P5 shows people do not find it, the fallback is a single 13px `Try a different score` text button that reveals a one-line slider — not the four-element lane control that exists now.

---

## 11. Out of scope — unchanged

No new backend, endpoint, facts mapping, migration or model call. No admission probability, odds, percentage or confidence. No Reach/Target/Safety. No activities. No persistence from the scenario control. `school-chances-model.ts`, `school-chances-contract.ts` and the five-state absence grammar are untouched: this is a rendering change over the same honest model.
