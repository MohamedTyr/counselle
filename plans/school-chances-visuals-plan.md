# School Chances — GPA, SAT, and ACT Visuals

**Status:** Draft for owner approval  
**Date:** 2026-09-15  
**Scope:** A per-school academic-comparison tab for GPA, SAT, and ACT only  
**Plan location:** Keep in `plans/` until the feature is implemented, browser-verified, and accepted; then graduate it to `specs/school-chances/plan/implementation-plan.md`.

## 1. Outcome

Add a product-visible `Compare` tab to every canonical school page, backed by `/app/schools/:unitid?tab=chances`. The route value keeps the feature's product intent clear in code, while the visible label accurately names what this first version delivers. The tab should feel as immediate and visually confident as Kollegio's analytics screen while making a narrower, more truthful claim:

> Show where the student's saved GPA, SAT sections, and ACT composite sit against the school's reported entering-class data.

This feature does **not** calculate an admission probability. It does **not** assign Reach, Target, or Safety. It does **not** use activities, essays, rigor, rank, or any other profile field. It does **not** call an AI model.

The result is one exceptional comparison surface, not three dashboard cards: the student switches among GPA, SAT, and ACT; sees one high-craft diagram at a time; and can drag a local what-if control to understand how a different value would move through the reported distribution or middle-50% band.

## 2. Binding scope boundary

### 2.1 Included

- A third school-detail tab, visibly labeled `Compare`, with URL state `?tab=chances`.
- GPA comparison using the school's explicitly 4.0-scale enrolled-freshman distribution and the student's unweighted GPA only when the student's saved scale is explicitly `4.0`.
- SAT comparison using separate Math and Reading and Writing school data and student scores.
- ACT comparison using composite data only.
- Read-only, session-local what-if controls.
- Honest partial, stale, missing, and incompatible-data states.
- Responsive, keyboard-operable, screen-reader-equivalent charts.

### 2.2 Explicitly excluded

- Activities in any form: no activity list, score, strength, AI review, chart, placeholder, or future-facing slot.
- Any personal admission percentage, odds, probability, confidence score, or simulated chance curve.
- Any Reach, Target, Safety, High Reach, Possible, Likely, or school-type calculation or presentation.
- Any import from, change to, or duplication of the parallel `admissions-fit-v1` work in `domain/admissions_fit/`, its adapter/API response, Explore cards, or `Application.list_type`.
- Any persistence or write triggered by the slider.
- Any LLM, search, new facts crawler mapping, schema migration, or new backend endpoint.
- SAT-total comparison, synthesized SAT-total range, synthesized median, GPA normalization, or inferred test-submission intent.

The parallel admissions-fit owner controls all automatic school-type labels and their explanations. If that work later needs to appear on the school page, it should be mounted by a separate integration change outside `SchoolChancesPanel`; this feature exposes no classification seam and never reads or writes the estimator result.

## 3. Current system and implementation seam

The feature adds no new backend contract because both required reads already exist:

- `SchoolDetailRoute.tsx` already resolves any school by UNITID, loads `GET /v1/schools/{unitid}/facts`, owns the school header, and stores its current tab in `?tab=`.
- `SchoolFactsResponse` already contains the GPA, SAT, and ACT facts, their five-state absence grammar, per-field `observed_at`, `reported_period`, and page-level freshness state.
- `useProfile()` already loads the authenticated student's saved Profile.
- Recharts and the project's shadcn-style `ChartContainer` already ship in the frontend.
- The school facts feature already owns accessible `ChartFigure`, responsive chart measurements, and reduced-motion behavior.

The cold-cache request order is intentionally sequential: the existing school page resolves facts first, then mounts `SchoolChancesPanel`, which starts `useProfile()` only when `tab=chances` is actually selected. This avoids fetching—and on first access lazily creating—an empty Profile row merely because someone opened About. The tradeoff is one geometry-matched in-panel Profile skeleton on the first cold visit; TanStack Query makes subsequent visits cache-backed.

`GET /v1/profile` is not physically read-only: the established workspace service lazily inserts the user's empty Profile row and locks it on first access. This plan accepts that existing contract and adds no new write endpoint or event. “Read-only” below means the comparison and scenario controls issue no `PATCH`, application mutation, estimator call, or feature-owned persistence. A route-level test must prove that `/profile` is not requested before `Compare` is selected and that slider/number-field interactions never issue a write request.

## 4. Reference direction: what to take from Kollegio

The supplied Kollegio screenshots establish a useful interaction hierarchy:

1. one focused analytics surface;
2. one selected factor at a time;
3. a concise interpretation above the diagram;
4. a small set of high-salience values;
5. a large, legible visual comparison; and
6. a persistent “drag to explore” control with a live value.

Counselle should copy that rhythm, not its unsupported claims. Replace Kollegio's smooth simulated-chance curve, green/orange danger gradient, threshold line, and exact percentage with the school's actual reported buckets or middle-50% band. Replace “Your chances” with a literal comparison such as “Within the reported middle 50%.” Replace “median” with `average` only when an average is actually reported, and never treat the average as a cutoff.

The visual character remains Counselle's: Instrument Sans, white canvas, restrained evergreen/brand accent, neutral institutional marks, 14px raised-surface radius, hairline internal divisions, no glass, no nested cards, no decorative school colors, and no new palette.

## 5. Exact screen design

### 5.1 Placement and page hierarchy

Add `Compare` after `About` and before `Your application` in the existing school-level tab list:

```text
School identity and actions

[ About ] [ Compare ] [ Your application 4 ]

┌──────────────────────────────────────────────────────────────────────┐
│ How your academics compare                              {freshness_line} │
│ [ GPA ] [ SAT ] [ ACT ]                                              │
│                                                                      │
│ Your {student_gpa} GPA sits in the {bucket_label} reported band.     │
│ {bucket_pct}% of enrolled freshmen were reported in this band.       │
│                                                                      │
│ You {student_gpa}                                                    │
│    │             school-reported bucket profile                      │
│ ▂  ▃  ▅  █  ▆  ▂                                                    │
│ 2.0      3.0       3.5       3.75        4.0                        │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│ Explore a GPA                                Scenario {scenario_gpa} │
│ ────────────────●────────────────────────────────────────────        │
│ 0.00                                                        4.00     │
│ [ precise value ]                      [ Reset to your GPA ]         │
├──────────────────────────────────────────────────────────────────────┤
│ Entering-class data is context, not a cutoff or admission chance.   │
└──────────────────────────────────────────────────────────────────────┘
```

The placeholders above are schematic, not example school or student facts. The outer frame is the page's one raised surface: `rounded-xl`, `--school-facts-panel-surface`, `--school-facts-panel-border`, and `--elevation-1`. Everything inside is flat and grouped by typography, spacing, and hairlines. There are no cards inside this panel.

### 5.2 Panel header

- Heading: `How your academics compare` (`text-lg`, semibold).
- Render the response's `freshness_line` verbatim on the far edge when it is present; omit the slot when it is null. It already distinguishes fresh (`Checked …`) from stale (`Last checked … — this may be out of date`) data; do not derive another date string from `observed_at`, add a local badge, or author a second staleness policy.
- The existing `SegmentedControl` directly below the heading with exactly three options: `GPA`, `SAT`, `ACT`.
- The selected metric uses `metric=gpa|sat|act` in the same search params as `tab=chances`, updated with `replace: true` so refresh/share preserve the view without turning every metric switch into a browser-history step. An absent/invalid metric defaults to the first metric with both a comparable Profile value and usable school data, then the first metric with either side present, then GPA. Preserve every unrelated query parameter.
- On mobile the segmented control spans the panel width. On larger screens it remains content-sized.

### 5.3 The interpretation line

The first sentence answers the student's immediate question in plain language. It must describe position, not quality or likelihood.

Allowed examples:

- `Your 3.82 GPA sits in the 3.75–3.99 reported band.`
- `Your SAT Math score is within the reported middle 50%.`
- `Your SAT Reading and Writing score is above the reported middle 50%.`
- `Your ACT composite is below the reported middle 50%.`
- `Add your SAT section scores to place yourself on this chart.`
- `Your GPA is saved on a 5.0 scale, so it cannot be placed on this 4.0-scale chart.`

Forbidden words and constructions:

- `chance`, `odds`, `probability`, `confidence`, `threshold`, `safe`, `competitive`, `strong`, or `weak` as a conclusion;
- `admitted-student median` when only an average or distribution exists;
- `better than X%` derived from buckets; and
- any sentence claiming that moving the slider improves the student's admission result.

### 5.4 The summary ledger

Use one inline typographic ledger, not statistic cards. Values use tabular numerals and at most one sanctioned oversized element; labels stay sentence case.

GPA:

- `You`: exact saved unweighted GPA plus `on a 4.0 scale`.
- `Reported band`: the bucket containing the student's value.
- `In this band`: the bucket's published percentage, only when that bucket reports one.

SAT:

- `Your SAT`: the saved total when present, explicitly labeled `shown for context`.
- `Math`: saved section score or `Not added`.
- `Reading and Writing`: saved section score or `Not added`.
- A visible `Compared by section` qualifier; no school total range is ever shown.

ACT:

- `You`: saved composite.
- `Middle 50%`: the reported p25–p75 range when present.
- `Reported average`: only the ACT composite average fact, when present.

Do not show the school's `average_gpa` in the comparison ledger: that fact has no explicit weighted/unweighted or scale contract, so placing it beside an unweighted 4.0 GPA would manufacture comparability. It remains available on About.

### 5.5 GPA diagram

Primary form: a left-to-right bucket profile using the school's actual `gpa_distribution` values.

- Draw each reported bucket as a neutral bar with its printed percentage.
- Keep buckets categorical; do not smooth them into a density curve or imply precision inside a bucket.
- Preserve the source's bucket order, but display low-to-high from left to right after a pure, tested reversal when the source arrives high-to-low.
- A `not_reported` or omitted bucket renders as a labeled gap/text state, never a zero-height bar.
- Do not normalize a partial distribution to 100%. If `sums_to` is present and not approximately 100, say `Reported buckets total {sums_to}%; missing buckets are not treated as zero.`
- When the student's explicit unweighted 4.0-scale GPA matches a bucket, place a brand-colored vertical marker over that bucket with a visible `You {value}` label. The marker's shape and word carry meaning independently of color.
- Match closed buckets from their finite `lo`/`hi` values. For an open-ended source bucket without numeric bounds, accept only the explicit source-label forms `{number} and Above` and `Below {number}` (case-insensitive) and preserve the original label in the UI. `and Above` is inclusive; `Below` is strictly less than its bound, so `Below 2.00` and `2.00–2.49` never both own `2.00`. If two closed source ranges share an endpoint, the bucket with the higher `lo` owns that exact boundary for marker/copy purposes; the printed source labels and percentages are never rewritten. Reject overlaps wider than one shared endpoint as malformed. The fixture form `4.00 and Above` must match a saved GPA of `4.00`.
- An unparseable open-ended label does not invalidate the categorical GPA bars, but it does prevent claiming which bucket contains a Profile/scenario value that might belong there. Return `unplaceable_profile_value`, keep the exact value in the ledger, omit its marker, and say `Your GPA cannot be placed in the school's published bucket labels.` Never fall through to `below` or `above`.
- Values outside the reported bucket span sit at an edge callout labeled `Below reported buckets` or `Above reported buckets`; never silently clamp them into a bucket.
- If no usable distribution exists, fall back to a school-only `Reported average` row without placing the student, because the average's scale contract is unknown. If neither exists, render the precise fact-state wording and no empty chart axes.

### 5.6 SAT diagram

Render one paired plot with two aligned lanes on the same `200–800` axis:

1. `Math`
2. `Reading and Writing` (use this human label in the UI; preserve `ebrw` only in code)

For each lane:

- Prefer the reported score distribution when it contains at least one numeric bucket.
- Always render the reported p25–p75 range when available as a darker neutral bracket/band over the full neutral track.
- Render the reported average as a small neutral diamond only when present; label it `Average`, never `median`.
- Render the student's matching section score as the brand `You` marker.
- Print the p25 and p75 endpoints next to the band; do not hide essential values in a tooltip.
- Keep Math and Reading and Writing separate even when both are present. Never add school-side p25 or p75 values to make a total range.
- If the student saved only an SAT total, show it in the ledger but state `Add your section scores to place yourself on these charts.`

The numeric distribution overlay is stricter than the existing generic fact chart. It renders on the `200–800` axis only when the fact's scale is exactly `sat_math` or `sat_ebrw` for the matching lane, `unit` is `percent`, every reported percentage is finite and within `0–100`, and every reported bucket has valid, in-domain geometry. Geometry may come from valid `lo`/`hi` or from the case-insensitive source forms `Score of {lo} - {hi}` / `{lo} - {hi}` using a hyphen or en dash. Shared endpoints are allowed and the higher range owns an exact-boundary marker; any wider overlap, gap-spanning inference, reversed range, or out-of-domain bound invalidates the overlay. If validation fails, omit only the distribution geometry and render its literal label/percentage pairs in a compact `Reported breakdown — not plotted to scale` list. A valid middle-50% band and student marker still render independently.

Show the school's existing SAT-or-ACT policy display as one quiet context line above the plot when available, for example `Testing policy: Considered if submitted.` It does not change the chart or produce a recommendation.

### 5.7 ACT diagram

Render one `1–36` composite lane using the same visual grammar as an SAT lane:

- distribution when useful;
- middle-50% band when p25/p75 are available;
- optional reported-average diamond;
- brand `You` marker for the saved composite; and
- printed scale endpoints and values.

Do not use ACT section scores. The Profile wire permits a section map, but the current Profile UI does not edit it and the school comparison contract required here is composite-only.

Show the same read-only testing-policy context used by SAT.

ACT distribution validation follows the SAT rule with exact scale `act_composite`, domain `1–36`, and accepted label forms `Score of {lo} - {hi}`, `{lo} - {hi}`, `Score of {hi} or Below`, and `{hi} or Below`. The `or Below` interval maps to the ACT domain minimum through the printed bound and is inclusive. Reject any other open-ended form rather than guessing. Invalid distribution geometry falls back to the same literal `not plotted to scale` list and does not suppress an independently valid middle-50% band.

### 5.8 Marker and label collision rules

The plot must remain deterministic when p25, p75, average, Profile, and scenario values coincide or nearly coincide.

- Every SAT/ACT lane reserves a minimum `112px` vertical pitch on desktop and `128px` below `sm`; GPA reserves a `56px` marker rail above its bucket profile.
- p25 and p75 values live in a fixed endpoint row below the track, anchored to the two ends of the band. If their labels would overlap, render one centered `Middle 50% {p25}–{p75}` row instead of two colliding labels.
- The average is always a diamond on the plot but its number lives in the keyed value row (`Average {value}`), never in a floating label.
- `You` and `Scenario` are the only floating callouts. If their projected centers are at least `64px` apart, each sits above its own marker. Below `64px`, stack the two callouts in a fixed two-row marker rail and connect each to its mark with a one-pixel elbow leader.
- When viewport or zoom leaves less than `160px` for that rail, move both callouts into the always-visible value row and leave only the hollow Profile tick and solid scenario tick on the plot.
- Collision priority is fixed: scenario callout, Profile callout, middle-50 row, average value row. No element measures DOM positions and guesses a different order at runtime.
- The same Profile/scenario stacking rule applies when both GPA values occupy one bucket.

### 5.9 What-if explorer

The bottom band adapts to the selected metric and is separated from the plot by a hairline. It is intentionally labeled `Explore`, not `Improve your chances`.

- GPA: one slider, `0.00–4.00`, step `0.01`, plus the existing `NumberField` for exact entry.
- SAT: two compact slider rows, Math and Reading and Writing, each `200–800`, step `10`, each paired with a `NumberField`.
- ACT: one slider, `1–36`, step `1`, plus a `NumberField`.
- Seed scenario values from the saved Profile when they exist and lie on the control's step grid.
- An off-grid saved value remains fully comparable in the diagram: preserve it exactly in the ledger and calculate its marker position without rewriting it. Because the slider cannot faithfully own that value, start only that explorer lane unseeded. For GPA, show `Your saved GPA is more precise than this 0.01 explorer. Enter a two-decimal scenario to start.` For an SAT section not divisible by 10, show the equivalent `This explorer moves in 10-point steps.` Reset removes the scenario and restores the exact Profile-only marker. Do not round or silently snap a saved value.
- A missing Profile value starts **unseeded**: show an empty labeled `NumberField` and the instruction `Enter a value to start exploring`; render no slider thumb and no scenario marker. Committing a valid in-range number creates the scenario, enables the slider at that exact value, and moves focus predictably to the enabled slider only when the action came from pointer—not from keyboard. Never manufacture a midpoint.
- SAT lanes seed independently. A saved Math score must not fabricate Reading and Writing, and an entered scenario on one lane must not activate the other.
- A NumberField commit is valid for the explorer only when it is in range **and on that metric's step grid**: a numeric multiple of `0.01` for GPA (so `3.8` and `3.800` remain valid), a multiple of 10 for SAT sections, and an integer for ACT. An empty, malformed, out-of-range, or off-grid entry leaves the last valid scenario untouched and exposes the normal inline `aria-invalid`/`aria-describedby` error (`Use increments of 0.01`, `Use 10-point increments`, or `Use whole numbers`). Input is rejected, never rounded or silently clamped. Home/End are the only controls that intentionally move to a bound.
- Scenario state is local to this mounted page. It is not put in the URL, cache, Profile, application, or estimator request.
- While unchanged, the chart has one solid marker labeled `You`.
- Once changed, preserve the saved value as a hollow `Your profile` marker and move a solid marker labeled `Scenario` to the explored value. Marker labels and shapes prevent a color-only distinction.
- The interpretation sentence and summary ledger always describe the saved Profile and never change their subject from `Your` to the scenario. A separate line under the explorer readout says, for example, `A scenario of {value} falls within the reported middle 50%.` When no saved value exists, only that scenario sentence appears.
- Show `Reset to your GPA`, `Reset SAT`, or `Reset to your ACT` only while changed.
- Slider movement updates the chart immediately with chart animation disabled. Announce the committed value on pointer/key release through one polite live region; do not announce every pointermove.
- Keyboard behavior is native: arrows move one step, Page Up/Down moves a larger step, Home/End moves to bounds. Touch targets are at least 44px.

The repository has no shared Slider primitive. Before implementation, search registries in the mandated order: shadcn MCP, COSS, `@ai-elements`, then shadcn. Add one registry-backed `components/ui/slider.tsx` and adapt it to Counselle's `data-slot`, `cn()`, focus, disabled, coarse-pointer, and token rules. Do not hand-roll drag math.

Hide the explorer entirely when the selected school metric has no usable distribution, band, or comparable scale. A disabled slider on an empty chart suggests that a comparison exists but is temporarily unavailable.

### 5.10 Footer truth statement

End the panel with one subdued, always-visible sentence:

`These are reported entering-class comparisons, not cutoffs or a personal admission chance.`

For SAT/ACT, append the server-owned band meaning without rewriting it: `This band holds the middle half of the enrolled students who reported a score. We don't know how many reported one — treat it as context, not a cutoff.`

Do not surface a CollegeData source label or source tier; the facts store is Counselle's own product data and the current student-facing contract intentionally omits those labels.

## 6. Deterministic comparison model

Create one pure, immutable frontend view-model builder. It may extract and compare facts; it may not estimate admission fit.

### 6.1 Inputs

- `SchoolFactsResponse`
- `Profile`
- selected metric
- optional local scenario values

### 6.2 Exact fact allowlist

- `class_profile.gpa_distribution`
- `class_profile.average_gpa` for school-only fallback display
- `class_profile.sat_math`
- `class_profile.sat_math_avg`
- `class_profile.sat_math_distribution`
- `class_profile.sat_ebrw`
- `class_profile.sat_ebrw_avg`
- `class_profile.sat_ebrw_distribution`
- `class_profile.act_composite`
- `class_profile.act_composite_avg`
- `class_profile.act_composite_distribution`
- `admissions.test_policy_sat_or_act`

The p25/p75 pairs arrive from the current endpoint already merged into the band facts `class_profile.sat_math`, `class_profile.sat_ebrw`, and `class_profile.act_composite`.

### 6.3 Profile allowlist

- `academics.gpa_unweighted`
- `academics.gpa_scale`
- `testing.sat.total` for context only
- `testing.sat.math`
- `testing.sat.ebrw`
- `testing.act.composite`

Everything else is ignored, including weighted GPA and ACT sections.

### 6.4 Comparison states

The pure model returns only literal, presentational states:

- distribution: `in_bucket | below_reported_buckets | above_reported_buckets | unplaceable_profile_value`
- score band: `below_band | within_band | above_band`
- student side: `missing_profile_value | incompatible_profile_value`
- school side: `school_value | distribution_unscaled | not_reported | not_fetched | not_published | not_collected | malformed`

Band boundaries are inclusive: a score equal to p25 or p75 is `within_band`. These states never map to a school type.

### 6.5 Validation and honesty rules

- Parse Profile GPA from its validated decimal string; reject malformed, non-finite, or out-of-range values instead of coercing them. Preserve the original GPA string for display so entered precision is not silently rewritten.
- Plot a GPA marker only when `gpa_unweighted` and `gpa_scale` both exist and the scale is numerically equal to four (`4`, `4.0`, and `4.00` are compatible). Never use raw-string equality to the literal `"4.0"`.
- Never use weighted GPA as fallback and never normalize another scale.
- A distribution is presentationally useful only when its fact scale matches the exact expected key (`gpa`, `sat_math`, `sat_ebrw`, or `act_composite`), its fact unit is `percent`, at least one bucket contains a finite numeric `pct`, every present `pct` is within `0–100`, and `sums_to` is null or finite within `0–100.5` (the half-point tolerance permits aggregate source rounding). Row presence alone is insufficient.
- GPA bars remain categorical, so a valid percentage bucket with an unparseable label may still be printed; only numeric student placement becomes `unplaceable_profile_value`. SAT/ACT distribution geometry additionally requires every percentage-bearing bucket to parse into a valid, in-domain, non-overlapping interval under Sections 5.6/5.7. If that geometry check fails, return `distribution_unscaled` and use the literal categorical fallback while evaluating a valid band independently.
- Preserve reported zero as a real 0% bar with a minimum visible tick. Preserve absent as words.
- Validate band bounds and domains before plotting: finite numbers, `min <= p25 <= p75 <= max`.
- Do not infer a median from a band and do not infer SAT sections from a total.
- Do not infer score submission from policy or Profile presence.
- Use each fact's `reported_period` beside that fact when present. Render only the server-owned page-level `freshness_line` for checked/stale wording; do not locally format `observed_at` or invent an observation-spread/mixed-vintage caveat that the HTTP response does not carry.
- The model returns new arrays/objects and never mutates `SchoolFactsResponse`, Profile, or fact bucket arrays.

## 7. Component and file plan

### 7.1 Reuse without alteration where possible

- `components/workspace/PageContainer.tsx`
- `components/ui/tabs.tsx`
- `components/ui/segmented-control.tsx`
- `components/ui/button.tsx`
- `components/ui/number-field.tsx`
- `components/ui/skeleton.tsx`
- `components/ui/error-card.tsx`
- `components/ui/empty.tsx`
- `components/ui/chart.tsx` (`ChartContainer`, config contract)
- `features/schools/facts/charts/chart-shell.tsx` (`ChartFigure` and text-equivalent pattern)
- `features/schools/facts/charts/chart-tokens.ts` where its measurements genuinely match

Do not broaden `FactRangeChart` or `FactDistributionChart` until their one-fact About-tab contract becomes unclear. Reuse their low-level shell and zero/absence rules in dedicated Chances visual components.

### 7.2 Create

- `frontend/src/features/schools/chances/SchoolChancesPanel.tsx` — query/profile orchestration and top-level states.
- `frontend/src/features/schools/chances/school-chances-model.ts` — pure extraction, validation, comparison, and immutable view models.
- `frontend/src/features/schools/chances/school-chances-copy.ts` — finite state-to-copy mapping; no free-form chart prose scattered through components.
- `frontend/src/features/schools/chances/AcademicComparisonPlot.tsx` — accessible plot shell and shared marker/band vocabulary.
- `frontend/src/features/schools/chances/GpaComparison.tsx` — categorical bucket composition.
- `frontend/src/features/schools/chances/SatComparison.tsx` — paired aligned section lanes.
- `frontend/src/features/schools/chances/ActComparison.tsx` — composite lane.
- `frontend/src/features/schools/chances/ScenarioExplorer.tsx` — local scenario state and metric-specific controls.
- `frontend/src/components/ui/slider.tsx` — registry-backed commodity primitive only after the required registry search.
- `frontend/src/features/dev-school-chances/SchoolChancesGalleryPage.tsx` — development-only fixture gallery containing the complete state matrix; statically imported nowhere in the production graph.
- `frontend/playwright.config.ts` — a narrowly scoped local web-server and browser-project configuration for this feature's visual journey.
- `frontend/e2e/school-chances.spec.ts` — pointer, keyboard, responsive, reduced-motion, and screenshot checks against the development fixture gallery.
- `frontend/playwright.real.config.ts` and `frontend/e2e/school-chances.real.spec.ts` — opt-in authenticated smoke/visual pass against one real local school and the real API/data store; never part of the zero-infrastructure fixture run.
- Focused colocated unit/component/a11y tests for the files above.

Keep components below 400 lines and pure helpers below 200 where practical. Split by responsibility rather than creating one large chart file or a directory of tiny one-use wrappers.

### 7.3 Modify

- `frontend/src/features/schools/SchoolDetailRoute.tsx` — add the URL-backed tab and pass the already-loaded facts response to the panel.
- `frontend/src/features/schools/SchoolDetailRoute.test.tsx` — tab URL/default/back behavior.
- `frontend/src/app/router.tsx` — add `/dev/school-chances` through the existing `import.meta.env.DEV` lazy-route pattern; coordinate this narrow hunk with the unrelated dirty landing-page change and do not overwrite it.
- `frontend/src/styles/schools.css` — add only feature-role aliases required for the student/scenario marker; point them to existing semantic roles. No color literal or new ramp.
- `frontend/package.json` and `frontend/package-lock.json` — add version-compatible `@vitest/coverage-v8` and `@playwright/test` dev dependencies plus only the three feature-specific scripts named in Phase 5.
- `.gitignore` — ignore `frontend/playwright/.auth/` so the local authenticated browser state can never be committed.
- `DESIGN.md` — document the Chances plot vocabulary, correct the stale statement that the frontend has no charting library, and reconcile the width-tier section with the already-shipped `PageContainer width="panel"` contract.
- `docs/ARCHITECTURE.md` — add the read-only Profile + school-facts composition after implementation is verified.

No backend, migration, facts mapper, Explore, application, activity, agent, prompt, or admissions-fit file belongs in this change.

## 8. Visual system rules

- Institutional data is neutral ink; brand color means `the student's current/scenario position` and nothing else.
- Ordinary, below, within, and above states do not receive green/amber/red semantic colors. The words and geometry carry the comparison.
- One raised frame, no nested cards, no border-plus-wide-shadow ghost cards.
- `rounded-xl` for the outer panel, `rounded-lg` for controls, `rounded-md` for controls nested inside the scenario band, and full rounding only for tracks/marker dots.
- Use Instrument Sans only, `font-medium` for normal emphasis, `font-semibold` for headings, and never `font-bold`.
- Essential values are printed; no hover-only tooltip, legend, or hidden axis meaning.
- All icons are Lucide/currentColor and decorative icons are `aria-hidden`.
- Every custom part has `data-slot`; every className composes with `cn()`; variants use `cva` when there are more than two visual states.

## 9. Motion and interaction specification

- Reuse the existing segmented-control and button interactions; do not add bespoke tab choreography.
- Set `isAnimationActive={false}` on every Recharts mark unconditionally. Recharts must never animate a refetch or scenario update.
- The plot wrapper may perform one explicit 200ms `ease-out` opacity reveal the first time each metric is viewed. It must not replay on refetch, return to a visited metric, reset, keyboard input, or slider movement. This is the only Chances-specific entrance motion.
- Scenario markers track input directly with no tween while dragging or using arrow keys.
- Hover/focus/pressed color changes use the existing 150ms token language and name exact CSS properties; never `transition-all`.
- No hover transform. Button tactility comes from the existing Button primitive rather than a new scale rule.
- Under `prefers-reduced-motion`, skip the one-time wrapper reveal. Marker movement is always instant. Nothing is invisible by default waiting for animation.
- During implementation, inspect the reveal and marker changes at 10% speed and verify that labels do not crossfade into illegibility or jump between lanes.

## 10. Responsive and accessibility contract

### 10.1 Responsive

- Verify at 375px, 768px, and 1440px, plus 200% zoom.
- At 375px: full-width metric control, ledger wraps into a single readable column or two-column pair, SAT lanes stack their labels above tracks, plot never requires horizontal scrolling, and scenario controls become full-width rows.
- At 768px: retain a single panel; do not introduce the About tab's section rail for only three factors.
- At 1440px: cap the panel with the existing `PageContainer width="panel"`; use breathing room inside the chart rather than stretching marks indefinitely.
- Long school names remain owned by the existing truncated identity/header implementation.

### 10.2 Accessibility

- The top metric switch remains a real radio-group-based `SegmentedControl` with arrow-key roving focus.
- Every chart is a `<figure>` with a complete text equivalent in `<figcaption>`; SVG marks are `aria-hidden`.
- Text equivalents list the student's value, every plotted band/bucket value, absent buckets, comparison state, cohort/period, and caveat needed to interpret the figure.
- Slider controls have visible labels, `aria-valuemin/max/now`, a human `aria-valuetext`, visible focus rings, and 44px coarse-pointer targets.
- Do not make SVG marks focusable when they have no action.
- Do not rely on color: `You`, `Your profile`, `Scenario`, `Average`, p25, and p75 are all printed or shape-distinguished.
- Profile-query failure is an inline `role="alert"` with Retry; it does not erase still-available school data.
- Loading uses a geometry-matched skeleton, never a spinner in the middle of the panel.

## 11. State matrix

| State | Result |
|---|---|
| Full school data + compatible Profile | Ledger, comparison sentence, complete diagram, and seeded explorer |
| Profile metric missing | School-only diagram plus `Add your … in Profile`; empty NumberField start state; no slider thumb or fake `You` marker until valid entry |
| Profile request fails | School-only diagram plus inline retry alert |
| GPA is weighted, scale missing, or scale is not 4.0 | Explain incompatibility; school distribution remains visible; no GPA marker |
| SAT total exists but sections do not | Total shown for context; both school lanes remain; CTA to add section scores |
| One SAT section exists | Place one marker and explicitly mark the other as `Not added` |
| Distribution is partial | Plot numeric buckets without normalization; write absent buckets and `sums_to` note |
| Distribution has all buckets absent | Treat it as unavailable, not as a zero distribution |
| GPA bucket labels cannot place an otherwise compatible value | Keep categorical bars and exact Profile value; no marker; explicit `cannot be placed` copy |
| Score distribution is malformed but band is valid | Omit only distribution geometry; render literal breakdown as `not plotted to scale`; keep the valid band and marker |
| Band is malformed but score distribution is valid | Omit only the band and its comparison claim; keep valid distribution geometry and marker with `Middle 50% unavailable` |
| Both band and score distribution are malformed | No numeric chart geometry; render `Data could not be compared` plus the literal non-scaled breakdown when safe |
| School fact is absent | Render the endpoint's exact absence word; no empty axes; hide the explorer |
| School data is stale | Keep values visible and render `freshness_line` verbatim; add no client-authored badge or warning |
| Scenario differs from Profile | Hollow `Your profile` marker + solid `Scenario` marker + Reset action |

## 12. Test-driven delivery plan

### Phase 0 — Freeze contracts and component choices

1. Rebase/coordinate after the parallel admissions-fit work if it is touching shared school files; do not edit or import its domain/API/classification code.
2. Record representative fixtures for full, partial, all-absent, stale, malformed, and no-crawl facts plus compatible, missing-row, partially filled, incompatible, and request-failure Profile states.
3. Search component registries in the required order and record the selected Slider primitive.
4. Confirm the existing school facts endpoint includes every allowlisted fact in its current response; add no endpoint if it does.
5. Pin the existing Profile read contract in route tests: opening About must not call `GET /v1/profile`; selecting Compare may call it once and may trigger the service's established lazy empty-row insert; no scenario action may call a write endpoint.

**Gate:** exact inputs, absence states, component ownership, and scope exclusions are testable before UI work begins.

### Phase 1 — Pure comparison model (RED → GREEN → IMPROVE)

Write failing tests first for:

- fact lookup across sections/groups;
- immutable low-to-high bucket ordering;
- exact 4.0 GPA compatibility;
- distribution bucket matching and outside-span states;
- open-ended `4.00 and Above`/`Below {number}` parsing and unparseable-label refusal;
- strict-below, inclusive-above, shared-closed-endpoint, and wider-overlap boundary behavior;
- inclusive p25/p75 comparisons;
- malformed bands;
- exact per-metric scale/unit checks, `pct` and `sums_to` bounds, score-label grammars, out-of-domain/reversed/overlapping ranges, and categorical score fallback;
- reported zero versus absent bucket;
- partial `sums_to` without normalization;
- SAT total never producing section values or a total school range; and
- the exact fact/Profile allowlists.

Implement the smallest pure model that passes. No React, queries, or chart code enters this module.

### Phase 2 — Reusable visual grammar (RED → GREEN → IMPROVE)

1. Add the registry-backed Slider primitive and its focus, keyboard, touch, disabled, and form semantics tests.
2. Build `AcademicComparisonPlot` on the existing `ChartContainer`/`ChartFigure` contract.
3. Add neutral range/distribution marks, printed endpoints, named marker shapes, and the deterministic non-scaled fallback list.
4. Build the GPA, paired-SAT, and ACT compositions from that grammar.
5. Add reduced-motion and no-tooltip tests.

**Gate:** each diagram is correct and understandable without color, hover, or SVG accessibility traversal.

### Phase 3 — Panel composition and school route

1. Build the one-frame panel, metric switch, ledger, interpretation copy, scenario band, footer truth statement, skeleton, and error/empty states.
2. Add the visible `Compare` tab to `SchoolDetailRoute`, backed by `tab=chances`, and preserve all unrelated query parameters.
3. Verify deterministic default metric selection and per-metric local scenario state, including exact saved `3.825` GPA and `755` SAT values that must never be rounded onto their explorer grids.
4. Test the accepted cold-request order explicitly: facts resolve, the selected Compare panel mounts, then Profile loads behind the geometry-matched skeleton; cached revisits do not flash the skeleton.
5. Confirm no scenario interaction causes a network request, Profile mutation, application mutation, or estimator refresh.
6. Exercise the missing-value flow with pointer and keyboard: empty field, malformed, out-of-range and off-grid input, both bounds, valid on-grid commit, enabled slider, metric switch/return, and Reset. Confirm focus never jumps after keyboard entry and no midpoint, rounding, or clamping is invented.

**Gate:** every school can open the tab, including a school not on the student's list, and back/forward/shareable `?tab=chances` behavior is correct.

### Phase 4 — Visual craft pass

Build the dev-only fixture gallery named in Section 7 and render at least:

1. full GPA distribution with a compatible student;
2. partial GPA distribution;
3. non-4.0 GPA;
4. full paired SAT with both markers;
5. SAT total only;
6. ACT band with no distribution;
7. no student score;
8. no school data; and
9. stale data using only the supplied `freshness_line`; and
10. facts with different `reported_period` labels, shown beside their own values without inventing a mixed-vintage warning;
11. wrong-scale/out-of-domain SAT and ACT distributions beside independently valid bands; and
12. exact off-grid `3.825` GPA and `755` SAT Profile values plus unparseable and shared-boundary GPA buckets.

Run a real-browser pass at 375px, 768px, and 1440px. Inspect initial view, all three factors, drag, keyboard adjustment, reset, focus order, long labels, 200% zoom, reduced motion, and slow-motion chart reveal. Capture screenshots for owner review and compare the information hierarchy—not the color palette—to the supplied Kollegio references.

Do not accept the screen while any mark overlaps its label, any mobile chart scrolls horizontally, any scenario/profile state is ambiguous, or any empty state leaves a blank graph.

### Phase 5 — Verification, review, and docs

1. Run focused frontend tests during each phase.
2. Add `@vitest/coverage-v8` at the exact installed Vitest version and this script: `"test:chances:coverage": "vitest run src/features/schools/chances --coverage.enabled --coverage.provider=v8 --coverage.include='src/features/schools/chances/**/*.{ts,tsx}' --coverage.thresholds.lines=80 --coverage.thresholds.functions=80 --coverage.thresholds.branches=80 --coverage.thresholds.statements=80"`.
3. Add `@playwright/test`, `frontend/playwright.config.ts`, and this script: `"test:e2e:chances": "playwright test e2e/school-chances.spec.ts"`. The config starts Vite on a fixed localhost port, uses Chromium, captures a trace on first retry, and targets only the dev-only fixture route; it must not require live auth, the API, or the database.
4. Add `frontend/playwright.real.config.ts`, `frontend/e2e/school-chances.real.spec.ts`, and `"test:e2e:chances:real": "playwright test --config playwright.real.config.ts e2e/school-chances.real.spec.ts"`. This config does not start servers: it requires the API on `:8000`, Vite on a fixed documented port, `REAL_SCHOOL_UNITID`, and a local untracked `playwright/.auth/local.json` storage state.
5. Run `cd frontend && npm run typecheck && npm test && npm run test:chances:coverage`.
6. Run the DESIGN grep checks for color literals, raw Tailwind palette classes, tier violations, `transition-all`, and off-scale durations.
7. Run component-level axe coverage, then `cd frontend && npx playwright install chromium && npm run test:e2e:chances`. The fixture journey covers Compare → switch metrics → enter a missing value → explore by pointer and keyboard → reset → Profile CTA, at 375px and 1440px plus a reduced-motion project.
8. Run the authenticated gate separately and honestly:
   - start the configured local Postgres/facts store and API with the documented repo commands;
   - start Vite on the port named by `playwright.real.config.ts`;
   - create or use an owner-approved local test account, then run `npx playwright codegen --save-storage=playwright/.auth/local.json http://127.0.0.1:{port}/login` and complete login manually—never place credentials or the resulting cookie state in source control;
   - identify one `REAL_SCHOOL_UNITID` whose live facts response carries usable GPA, SAT, and ACT data, record that UNITID and the response observation time in the QA artifact, then run `REAL_SCHOOL_UNITID={unitid} npm run test:e2e:chances:real`;
   - have the E2E runner inspect the real page at all three target widths and save screenshots/traces under `artifacts/school-chances/{timestamp}/`. If the data store or approved login is unavailable, this gate remains visibly open; the fixture pass cannot substitute for it.
9. Invoke the TypeScript reviewer and code reviewer; invoke the E2E runner for both browser passes; fix every critical/high finding.
10. Update `DESIGN.md` and `docs/ARCHITECTURE.md` only after the behavior is verified.

## 13. Acceptance criteria

The feature is ready for owner review only when all of the following are true:

- The school page has a visible `Compare` tab backed by shareable `tab=chances` state and containing exactly GPA, SAT, and ACT.
- There is no activity UI, activity data read, activity code path, or activity placeholder.
- There is no admission percentage, probability curve, simulated chance, threshold, or school-type output.
- No Reach/Target/Safety calculator, API, domain object, or `Application.list_type` path is modified or duplicated.
- GPA is plotted only for an explicit unweighted 4.0-scale Profile value.
- Exact saved GPA precision is preserved; a value off the explorer's `0.01` grid is never rounded or snapped.
- SAT is compared by section only; no total school band or median is synthesized.
- ACT uses composite only.
- Wrong-scale, out-of-domain, overlapping, or otherwise malformed score distributions never receive numeric geometry; valid bands remain independently usable.
- Every absent/partial/stale fact preserves the established honesty grammar, and absent buckets never become zero.
- Scenario controls are local, reversible, keyboard/touch accessible, and write nothing.
- Each chart has an equivalent complete text description and works without hover or color.
- The surface uses existing components/tokens, one raised level, and no nested cards.
- Mobile, tablet, desktop, zoom, reduced-motion, and real-browser checks pass with approved screenshots.
- Frontend typecheck/tests pass and new code reaches at least 80% coverage.

## 14. Risks and controls

| Risk | Control |
|---|---|
| The feature's internal/URL name `chances` implies a prediction | The product-visible tab is `Compare`; the panel and permanent footer say comparison, not chance; no output resembles an odds result |
| A gorgeous chart overstates weak data | Plot only typed reported values; print cohorts/caveats; never smooth, normalize, or interpolate buckets |
| Average GPA is mistaken as comparable | Keep it out of the student ledger and never place it on the 4.0 distribution |
| SAT total is falsely derived | Treat total as context only; tests prohibit synthesized section/total school ranges |
| Slider feels like a hidden estimator | Label it `Explore`; scenario changes geometry and position copy only; no category/probability/network effect |
| Parallel fit work overlaps | Own only `features/schools/chances/` plus the school tab/style/docs seams; no admissions-fit, Explore, or application files |
| Recharts interaction becomes janky | Disable chart animation during input, memoize the view model, keep drag in a registry primitive, test at 10% speed and on touch |
| Visual polish creates inaccessible meaning | Printed values, labeled shapes, figcaption equivalents, native keyboard semantics, focus rings, and coarse-pointer sizing are release gates |

## 15. Deliberate non-goals after v1

Do not leave speculative hooks in this implementation for activities, essays, holistic AI scoring, calibrated probabilities, applicant outcome scattergrams, intended-major odds, or automatic school-type labels. Those require different evidence and ownership. If future data justifies them, they should arrive through a new plan and explicit contract rather than unused props in this surface.
