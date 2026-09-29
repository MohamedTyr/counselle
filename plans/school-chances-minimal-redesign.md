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

---

## 12. Divergence note (post-implementation)

Appended, not a rewrite of the sections above — those record what was planned; this records what actually shipped and where it differs, per the repo's `plans/` vs `specs/` convention (a plan is a historical record; a changed decision gets recorded as an addition).

1. **No dark mode.** §8's P5 gate lists "light and dark" and contrast "in both themes" as verification steps. This app has no dark theme: there is no `data-theme` attribute setter, no `ThemeProvider`, and no toggle anywhere in `frontend/src`. A `grep` for `data-theme`, `.dark`, `darkMode`, and `prefers-color-scheme` across `src/**/*.{ts,tsx,css}` turns up exactly one hit — `src/components/ui/chart.tsx`'s shadcn-shipped `.dark [data-chart=...]` CSS rule, which is inert boilerplate from the chart primitive itself, not a wired theme system. The dark half of the P5 gate is dropped as inapplicable to this codebase, not skipped as unverified work.

2. **`--school-chances-mark` retirement moved from P0 to P1.** §8 states P0 ("geometry and tokens") retires the token. In the shipped sequencing it was retired in P1 once `ClassShape.tsx`/`YouMark.tsx` replaced its last consumers (`academic-comparison-marks.tsx`, `GpaComparisonMarkers.tsx`) — P0 introduced the new tokens and left the old mark token alone until the code reading it was actually deleted, rather than dangling an unused-but-still-referenced token for a phase.

3. **SAT grid breakpoint: `md:`, not `sm:`.** §4's prose names both `sm:grid-cols-2` and "≥768px" for the two-lane SAT row. Tailwind's `sm` breakpoint is 640px, not 768px — the two values in §4 conflict. The implementation (`SatComparison.tsx`) uses `md:grid-cols-2`, following the stated pixel value (768px) over the literal class name written in the plan.

4. **SAT lane height exceeds the 108px/88px spec.** §4 specifies a 108px lane with an 88px rail. `ClassShape.tsx`'s `CLASS_SHAPE_HEIGHT` gives every lane with a distribution the shared 132px stepped-area height (`CLASS_SHAPE_HEIGHT.stepped`), so a SAT lane that has a distribution is taller than §4's number — there is no distribution-less 108px/88px SAT lane variant. The panel's overall height target was still met because the two SAT lanes sit side by side (`md:grid-cols-2`): the panel's total height is driven by one lane's height, not the sum of two stacked lanes, so the per-lane overshoot doesn't compound into the panel-level number.

5. **Measured panel heights, before → after, against target (P5, real browser, 1280px):**

   | Screen | Before | After | Target | Notes |
   |---|---|---|---|---|
   | GPA | 786px | 471.64px | ≈470px | On target |
   | ACT | 766px | 443.64px | ≈430px | On target |
   | SAT (`full-sat` fixture) | 1,340px | 494.78px | ≈520px | Under target |
   | SAT (`reported-periods` fixture) | — | 542.78px | ≈520px | ~23px over target |

   The `reported-periods` fixture's overshoot is not layout bloat — it comes from genuinely divergent per-field reporting-period caveat text (§6's "a per-field period that differs still prints" exception), which is exactly the kind of honesty-preserving line this redesign chose to keep visible rather than trim further.

6. **Carry-forward debt, recorded rather than hidden:**
   - Three dead CSS custom properties left behind: `--school-chances-track`, `--school-chances-band`, `--school-chances-profile-outline`. Their consumers were deleted across P1–P3 but the token declarations themselves were not swept.
   - `ScrubbablePlot.tsx` is ~854 lines, over this repo's 800-line file guideline (`AGENTS.md`).
   - Two empirically-calibrated constants in `ScrubbablePlot.tsx` — `RESET_DRAG_EXTRA_GAP_PX = 22` and `RESET_PILL_RELEASE_SETTLE_MS = 250` — are measured against `YouMark.tsx`'s pill grab-scale and release-tween duration. If either of those `YouMark.tsx` values changes, both constants need re-measuring; they are not derived algebraically from the pill's own transform. The cleaner root fix, not done here, is making the pill's grab scale not shift its own left edge in the first place — that would let both constants be deleted rather than re-measured.

7. **Whole-plan close-out review findings (post-implementation, after owner review of the phases above).** A close-out pass reviewing the redesign as a whole — not any single phase — found two behavioral defects that no per-phase review had caught, plus two pieces of debt worth recording precisely. This is a signal about where this codebase's remaining risk concentrates: the two-lane SAT screen's cross-lane interactions, and functions that grew across several phases without a structural pass at the end of each one.

   - **Defect 1 (HIGH): a scrub on an unsaved SAT lane erased the other, saved lane's correct verdict.** `satVerdict` (`school-chances-copy.ts`) had two branches: a two-lane branch that correctly used the caller's gated `mathScenario`/`ebrwScenario` parameters (each null unless that lane's `profile.state === "value"`), and a single-lane fallback that read the raw, ungated `math.scenario` / `ebrw.scenario` fields instead. Because the plot stays interactive for a `missing_profile_value` lane (only `incompatible_profile_value` disables it), scrubbing an unsaved lane set its raw `.scenario` field even though the lane's own state was still `missing_profile_value` — so the fallback picked that lane, called `scoreInterpretation` on it, and hit its absence guard, silently replacing the other (saved) lane's correct, still-current sentence with an "Add your score" message. Nothing false was stated, but correct information vanished because the student touched an unrelated control. Fixed by reading the same gated parameters in the fallback: `const scenarioLane = mathScenario ? math : ebrwScenario ? ebrw : null;`. Covered by a new test in `SchoolChancesPanel.test.tsx` ("defect 1: scrubbing an unsaved Math lane does not erase the correct, still-current Reading and Writing verdict"), confirmed by mutation testing (revert the fix → test fails; restore → test passes).
   - **Defect 2 (contradicted §5): the verdict did not update live for a student with no saved value.** §5 states "the pill value and the verdict update live," but `gpaInterpretation`, `scoreInterpretation`, and `satVerdict` all returned only the absence message ("Add your GPA...") for a `missing_profile_value` metric, even after the student scrubbed a scenario against it — silently ignoring the single most useful case the scrubbable chart exists for: "what would I need?" Fixed, for GPA, SAT (both single- and dual-lane), and ACT, by showing both facts together rather than one instead of the other — the hypothetical sentence in the same unmistakably-counterfactual voice already used elsewhere, followed by the unchanged absence sentence, e.g. `"If your GPA were 3.60, it would sit in the 3.50 - 3.74 reported band. Add your unweighted GPA to place yourself on this chart."` The existing "a scenario never papers over the absence message" test was strengthened (not deleted) to assert this stronger both-present contract; four new tests cover GPA, ACT, single-lane SAT, and dual-lane SAT. `incompatible_profile_value` is unchanged (the plot is non-interactive there, so no scenario can exist to describe), and the no-scenario path is byte-identical to the pre-fix wording (also test-covered).
   - **Function-length debt: `ScrubbablePlot` itself, not just its file, is oversized.** Item 6 above records the file at ~854 lines, but the component function `ScrubbablePlot` is a single ~479-line function (lines ~297–775), far past this repo's 50-line guideline (`AGENTS.md`). Natural split seams identified during this review: the session-storage discovery-hint store (~lines 90–135) and the per-panel scrubbing store/context (~135–255) are both independent of JSX and could be extracted as their own modules; `ScrubEditInput` (~776–838) is already a separate component in the same file, showing the pattern already exists; and inside `ScrubbablePlot` itself, the Reset-flip/crossfade state machine (~360–475) and the pointer/keyboard handlers (~527–653) are each self-contained enough to become hooks — which would leave the render function itself under ~150 lines. Not done here: this file is outside this task's ownership boundary.
   - **`scoreDomain()` stranded indirection.** `academic-comparison-geometry.ts` marks `scoreDomain()` as superseded by `plotWindow()`, with a comment claiming its remaining callers are deleted in a later phase — but one live caller remains: `score-plot-copy.ts`'s `profilePlacementMessage`. Not a bug — `BandModel.min`/`max` genuinely are the instrument domain, so the value read is correct — just a stranded indirection the "deleted in a later phase" comment no longer describes accurately. The one-line resolution, for whoever next touches that file: read `SCORE_DOMAINS[lane.key]` (`school-chances-model.ts`) directly instead of going through `scoreDomain()`.

8. **Absence-duplication close-out: §0's original defect had partially survived into the verdict/caption seam, and item 7's Defect 2 fix briefly reopened it worse.** §0 lists "stated four times in two vocabularies" as one of the reasons this redesign exists. That pattern was never fully closed for the missing-value case: `AcademicComparisonPlot.tsx`'s and `GpaComparison.tsx`'s per-lane captions (`profilePlacementMessage`, `gpaProfileMessage`) always stated a lane's own "no saved value" absence, and once Defect 2 above made the verdict sentence state it too (so the scrubbable, missing-value case wasn't silently unstated), every metric duplicated that one fact — GPA and ACT byte-identically, and dual-lane SAT compounded to four statements of two facts once both lanes were scrubbed at once (`bothScoreScenarioInterpretation` now states both lanes' absences in one sentence, while each lane's own caption kept restating its own).

   Fixed by suppressing the caption only where the verdict provably already states that exact lane's absence, computed with `score-plot-copy.ts`'s new `absenceCoveredByVerdict(metric, lane, siblingMissing)` — mirroring `satVerdict`'s own branches rather than a separate rule: ACT (single-lane) is always covered, so its caption is always suppressed for a missing composite; GPA is likewise always covered (its verdict states the absence unconditionally); SAT is covered only inside `satVerdict`'s both-missing branch, and only for whichever lane(s) are actively being scrubbed — a missing, un-scrubbed lane (whether its sibling is saved or also missing-and-unscrubbed) gets no per-lane mention anywhere else, so its caption stays load-bearing and is never suppressed. `siblingMissing` is derived from the `profile`/`scenario` scenario-input props `AcademicComparisonPlot` already receives (via `profileValue`), so no new prop crosses the do-not-touch `SatComparison.tsx`/`ActComparison.tsx` boundary. GPA's wording was also consolidated: the caption's own text carried "on a 4.0 scale," which the verdict's shorter text didn't — since the caption is now the one being dropped, `gpaInterpretation`'s absence sentence adopted the richer wording so that detail survives. `gpaProfileMessage`/`profilePlacementMessage` themselves are untouched — the accessible-summary fallbacks that read them (`gpaSummary`'s `placement`, `scoreSummary`'s `student`) are a separate channel per plan §9/§6 and still carry the same text when a lane has no marker plotted; a lane that IS being actively scrubbed already reports its scenario mark there instead of the placement message, which is pre-existing `scoreSummary` behavior this fix does not touch.

   Covered by six new tests in `SchoolChancesPanel.test.tsx` (GPA, ACT, SAT-partial-not-suppressed, SAT-both-missing-neither-scrubbed-not-suppressed, SAT-one-lane-scrubbed, and the worst-case SAT-both-lanes-scrubbed), each asserting the exact-match caption count is 0 or 1 as appropriate rather than just checking presence. Mutation-tested: reverting `absenceCoveredByVerdict` to `return false` and the `GpaComparison.tsx` render guard to `true` reproduced the pre-fix duplication and failed 5 of the 6 new/updated tests with counts of 2 (GPA, ACT) instead of 1, or 1 instead of 0 (SAT one-lane and both-lanes-scrubbed cases); restoring the fix returned all 143 chances-suite tests to green. Verified live in a real browser (dev gallery, `no-student-score`/`sat-total-only`/`request-error` fixtures, 390px and 1280px): each absence renders exactly once at rest, exactly once while any lane is scrubbed, and the dual-lane SAT worst case goes from 4 statements of 2 facts to exactly 2 (both folded into the one verdict sentence, both per-lane captions gone). The three unaffected baseline fixture heights (`full-gpa` 471.64px, `act-band-only` 443.64px, `full-sat` 494.78px at 1280px) measured byte-identical to item 5's table, confirming saved-value screens — where no caption ever fires — were untouched.

9. **INCOMPATIBLE-value duplication, missed by item 8: the same defect survived for a saved-but-unplaceable value, not just a missing one.** Item 8 closed "stated twice" only for `missing_profile_value` — it explicitly left `incompatible_profile_value` alone because that state wasn't in the measured defect table. A close-out re-check (browser, `non-four-gpa` fixture, 390px and 1280px, `git diff` against `score-plot-copy.ts`) confirmed the same pattern was live there: the verdict ("Your GPA is saved on a 5.0 scale, so it cannot be placed on this 4.0-scale chart.") and `GpaComparison.tsx`'s own caption ("Your GPA uses a different scale and cannot be placed on this 4.0-scale chart.") stated the identical fact in two different sentences, confirmed both in the DOM snapshot and in `SchoolChancesPanel.test.tsx`'s pre-existing "an incompatible saved value suppresses the slider" describe block (which asserted the verdict text only, never noticed the caption sat beside it). The same class of duplication exists for ACT (verdict: "Your ACT composite cannot be placed on this chart."; caption: "Your ACT composite cannot be placed on this 1–36 chart.") — no dev-gallery fixture exercises it, but `SchoolChancesPanel.test.tsx`'s existing ACT-incompatible unit test does, and confirms it live.

   Fixed the same way as item 8, extending `absenceCoveredByVerdict` rather than a second mechanism: ACT now returns covered for either non-`"value"` state (`scoreInterpretation` states an incompatible composite unconditionally, same as a missing one); GPA's separate inline `GpaComparison.tsx` guard (`model.profile.state !== "missing_profile_value"`) is now dead for both non-`"value"` states once `gpaProfileMessage` never has anything left to say that the verdict doesn't — the now-always-false caption paragraph was deleted rather than left as an always-off guard (`AGENTS.md`'s "remove obsolete paths, don't add compatibility layers"), and the same redundant restatement inside `GpaFallback` (the no-usable-distribution branch, unreachable by any fixture but reachable by a hand-built model) was deleted for the same reason. **SAT's incompatible case is deliberately left uncovered.** Unlike the missing case, an incompatible lane can never carry a scenario (the plot is non-interactive for it — `AcademicComparisonPlot.tsx`'s own `interactive` guard), so whether `satVerdict`'s value-only fallback (`scoreInterpretation(math.profile.state === "value" ? math : ebrw)`) would ever restate a given lane's incompatible text depends on the *sibling* lane's resolved `profile.state` — data `AcademicComparisonPlot.tsx` doesn't have without a new prop crossing the do-not-touch `SatComparison.tsx` boundary, since `profile`/`scenario` here only carry raw saved values, not derived states. Analysis (not fixture- or test-confirmed, since no SAT fixture produces it) shows the duplication is real but narrow: `satVerdict`'s fallback always resolves to the EBRW lane whenever Math isn't in `"value"` state, so only an incompatible EBRW lane can ever be restated by the verdict, and only when Math is also missing or incompatible — an edge case requiring two simultaneously out-of-domain saved SAT scores. Approximating the sibling's state locally (re-deriving `validScore`'s domain check instead of reading the real `ScoreLaneModel`) was rejected as a correctness risk: a wrong approximation in the "sibling looks compatible" direction would suppress a caption the verdict never actually states, landing on zero statements of a real fact — the one outcome this whole close-out exists to prevent. Left as recorded debt for whoever next threads a `ScoreLaneModel`-level sibling reference through `SatComparison.tsx`.

   Covered by four new tests in `SchoolChancesPanel.test.tsx` (GPA main path, GPA no-distribution fallback, ACT, and a SAT case confirming an incompatible lane next to a saved sibling correctly stays load-bearing rather than being over-suppressed), asserting exact-match caption counts of 0 or 1. Mutation-tested: reverting `absenceCoveredByVerdict` to its item-8 form and restoring both deleted `GpaComparison.tsx`/`GpaFallback` caption paragraphs reproduced the pre-fix duplication and failed exactly the 3 tests asserting suppression (GPA main path, GPA fallback, ACT) with counts of 1 instead of 0, while the SAT not-over-suppressed test correctly stayed green throughout (it was never testing the reverted code); restoring the fix returned all 147 chances-suite tests to green (143 baseline + 4 new). Verified live in a real browser at 390px and 1280px on the `non-four-gpa` fixture with `sessionStorage` cleared: the caption paragraph that used to sit between the number cells and the truth footer is gone, the verdict states the fact exactly once, and the three baseline panel heights (`full-gpa` 471.640625px, `act-band-only` 443.640625px, `full-sat` 494.78125px) measured byte-identical to items 5 and 8, confirming compatible-value screens — where no caption ever fires — stayed untouched.
