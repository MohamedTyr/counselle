# School About tab — composition, hierarchy, and the honesty surface

Third and final phase for the About tab. Companions:

- `plans/school-facts-page.md` — the honesty model (shipped)
- `plans/school-facts-visuals.md` — the chart layer (shipped, `edccd31`)

Those two built the *data* and the *marks*. This one builds the *page*: what
contains what, what the eye lands on first, and how the evidence the read model
already carries actually reaches the screen.

---

## 1. The diagnosis

The complaint was "bland and boring, and the attention goes to a thousand
things." Three independent reviews landed on the same cause, and it is not a
missing chart.

**Every group is a card, and the section that holds them is not a surface at
all.** `FactTable` renders `Table variant="card"` (`FactTable.tsx:32`), so a
six-group section draws six bordered, shadowed boxes at `gap-7`
(`SchoolFactsSection.tsx:43`) — six perimeters and six shadows competing before
a single hue enters. Meanwhile `SchoolFactsSection` itself is a bare
`<section>` (`SchoolFactsSection.tsx:32-35`) with no border, no fill, no
elevation, which is neither of the two container shapes DESIGN §17.2 permits (a
*list* — one raised panel — or a *board*).

The charts are the only thing on the page that got this right.
`chart-shell.tsx:6-9` argues a chart is not a card and must share the left edge
and surface of the rows around it. It could never actually achieve that,
because the rows around it were cards. `--school-chart-inset: 10px`
(`schools.css:159`) exists solely to fake the alignment that the card border
destroyed.

Second cause: **everything is at equal weight.** A 4.6% admit rate and "housing
deposit refundable: not reported" render at the same size, in the same box, one
after the other.

Third cause, and the reason the page feels *inert* rather than merely plain:
**the honesty layer is modelled and renders nowhere.** Verified by grep on
2026-08-27:

| Thing | Where it is | Consumers |
|---|---|---|
| `Fact.evidence` (page, excerpt, CDS section/row/column) | `school-facts-types.ts:49-68` | **zero** |
| `Caveat.severity` (`"ordinary" \| "severe"`) | `school-facts-types.ts:70-76` | **zero** in `facts/` |
| `--school-fact-caveat-severe-fg` / `-bg` | `schools.css:109-110` | **zero** |
| `SchoolFacts.coverage` (`Record<string, DomainCoverage>`) | `school-facts-types.ts:232` | **zero** |
| `--school-chart-axis: 200px` | `schools.css:154` | **zero** — dead token, see §6 |

`FactTableRow` carries only `{key, label, value, reported}`
(`school-facts-rows.ts:30-35`). A student cannot see which page of the CDS a
number came from, and a severe caveat renders identically to an ordinary one.

---

## 2. Decisions taken here

Three calls were open. I am taking them so the plan is executable; each is
cheap to reverse and flagged where it lands.

**D1 — Keep click-to-swap navigation. Fix its motion, add hash deep links.**
The alternative (one continuous scroll + scrollspy rail) was argued well: Facts
is stateless reference content, unlike Profile which swaps because sections
hold editing state (`ProfileRoute.tsx:269-271`). But it is a larger diff, it
forks the navigation model away from Profile, and scrollspy must observe the
page's own scroll container rather than `window` (the shell never scrolls),
which is exactly the kind of thing that silently desyncs. The six sections are
genuinely independent questions; swapping is honest to that. What is *not*
defensible is the current motion — see D1a in §4 Phase 3.

**D2 — Evidence and caveat wiring ships in this pass, as the last phase.**
It is the highest-value item on the list: it closes the gap between what
AGENTS.md principle 3 promises and what the page shows, and it is the fix for
"nothing to interact with." It is also the riskiest, so it goes last, behind
its own gate, and can be dropped without unpicking Phases 1–3.

**D3 — Shared-primitive extraction is a separate PR.** `SchoolFactsNav`'s row
vocabulary duplicates `ProfileSectionNav`'s (both `h-9 rounded-[10px] px-3
text-sm transition-colors duration-150`, both `hover:bg-[var(--canvas-hover)]`,
both `focus-visible:ring-2 ring-[var(--focus-ring)]`), and `max-w-[1160px]` is
a literal in three files (`ProfileRoute.tsx:225`, `SchoolFactsPanel.tsx:46`,
`SchoolFactsGalleryPage.tsx:79`). Both are real. Both touch Profile. AGENTS.md:
"a refactor is its own change, never smuggled into an unrelated edit." Tracked
in §7, not built here.

---

## 3. The chart layer is settled — and it is not the lever

Registry search re-run from `frontend/` with the local CLI (v4.13.0) on
2026-08-27. **Correction to `school-facts-visuals.md` §2:** the preset blocks it
lists as "verified live" do not exist as installable items.
`https://ui.shadcn.com/r/index.json` returns 63 items, of which exactly one
matches "chart":

```
total items: 63 | chart items: 1
  chart
```

`@shadcn/chart-bar-horizontal`, `chart-radial-shape`, `chart-bar-stacked` all
404 (`.../r/styles/radix-nova/chart-bar-horizontal.json` — not found). The ~40
charts on `ui.shadcn.com/charts` are copy-paste example compositions, not
registry items. The one installable item is `@shadcn/chart`
(`ChartContainer` / `ChartTooltip` / `ChartTooltipContent` / `ChartLegend` /
`ChartLegendContent`) over Recharts — already vendored at
`components/ui/chart.tsx` with `recharts@^3.10.1`. Nothing was missed. `@coss`
and `@ai-elements` ship no charts; `@kokonutui` ships only decorative ones
(`bento-grid`, `apple-activity-card` rings), which are the wrong register for a
page whose job is to be believed.

Recharts 3.10 exports `AreaChart, BarChart, ComposedChart, FunnelChart,
LineChart, PieChart, RadarChart, RadialBarChart, Sankey, ScatterChart,
SunburstChart, Treemap`. We use `BarChart` only. Of the rest, exactly two
survive this page's honesty bar:

- **`RadialBarChart`** — one share of a real denominator. Rule: *share of a
  stated whole only, never a score.* Candidates: share in college housing
  (84%), share receiving need-based grant aid (53%). Not for coverage — "how
  much of the form we could read" is an artifact of data availability, and a
  ring would misrepresent it as a quality score.
- **`ReferenceLine`** on the existing `FactBarChart` — the honest form for
  "20 units required, 24 recommended": bars for required, a reference line at
  the recommendation. Better than a second series, which would imply every
  subject has a required/recommended pair when only the total does.

Refused, with reasons: **RadarChart** for the 11 selection factors (radar
asserts continuous multi-axis magnitude and area-as-value; these are four
ordinal levels — `FactOrdinal` stays). **Area/Line** (no time series exists; the
CDS is one edition). **FunnelChart** (already rejected at
`school-facts-sections.ts:251-254` — a trapezoid asserts a conversion story the
counts do not tell). **Pie** for degree shares (8+ categories).
**Treemap/Sankey/Scatter** (no honest fit).

**So: two new tools is the entire chart upside.** The blandness is a
composition problem, and Phases 1–2 carry the weight.

---

## 4. Phases

Each phase is independently shippable and has a gate. Standard tier per the
workflow: Phases 1–3 need no backend change.

### Phase 1 — One surface per section

The single highest-leverage change, and a DESIGN compliance fix rather than a
new rule.

1. Wrap `SchoolFactsSection`'s content in the raised-panel shell Profile
   already uses (`ProfileSectionCard.tsx:105`): `rounded-xl`, `border`
   `--edge`, `bg` `--surface-raised`. Add `--school-facts-panel-surface` /
   `-border` to `schools.css` aliasing those, matching how `profile.css`
   aliases its own.
2. Retire `variant="card"` from `FactTable` (`FactTable.tsx:32`) → `"default"`.
   Groups become hairline-divided bands (`--school-fact-divider`, already
   defined at `schools.css:111` and currently carried by the card).
3. Delete `--school-chart-inset` (`schools.css:158-159`) and its two consumers
   in `SchoolFactsSection.tsx:69,115`. With no card border there is nothing to
   inset from; the section's own padding is the left edge for rows and charts
   alike. **This is the moment `chart-shell.tsx`'s doctrine finally becomes
   true.**
4. Section header gains a second line: the coverage sentence from the
   already-computed `SchoolFacts.coverage` (`school-facts-types.ts:232`) —
   e.g. "62 of 74 published metrics on file" — in `--ink-secondary`, `text-xs`.
   Plain text. **Not** a `Meter`: `Meter` is a progress-toward-a-goal
   primitive, and CDS coverage is not a goal a student is progressing toward.

**Gate:** one perimeter per section, not six. Charts and rows share a left
edge, verified in-browser at 1440 and 375. No card inside a card. Routine
suite green.

### Phase 2 — Hierarchy and density

5. **Lead band.** Each section's `headline` renders first at the existing
   `emphasis` density (`FactTable.tsx:19-28` — already built, taller rows,
   15px, medium weight). **No hero number.** `FactTable.tsx:19-20` and
   `SchoolFactsSection.tsx` both ban it in writing; DESIGN's one precedent
   (`VerdictBand`'s `text-[1.625rem]`) is a different surface. If we ever want
   to break that rule it is its own decision, not a drive-by.
6. **Promote each section's strongest mark into the lead band.** Today the
   marks sit wherever their group falls in config order. Specifically: Money's
   aid-coverage bars are the emotional core of that section and currently sit
   buried between two tables; Getting in's test-score bands sit mid-page below
   `required-units`.
7. **Grid the small groups at `lg:`.** `required-units` (7 rows) +
   `class-rank` (4) + `waitlist` (5) are 16 rows with no dependency on each
   other and are currently queued vertically. `lg:grid-cols-2 lg:gap-x-8`,
   collapsing to one column below. Precedent is `ProfileSectionCard.tsx:203`'s
   field grid, one level up. **Constraint: grid cells are hairline-divided
   regions, never cards** — a card per cell inside the Phase 1 panel is a
   card-in-a-card and is banned outright. This is the item most likely to drift
   during implementation.
8. **Compress all-absent runs.** Yale's `applicant-pool` carries four
   `not_applicable` rows for the in-state/out-of-state split
   (`yale-getting-in.ts:296-320`, private institution). Four identical
   sentences become one line that still names the reason: "In-state /
   out-of-state split: not applicable — private institution." This is a
   *compression*, not a hide: the reason stays on screen. Applies only to a run
   of three or more consecutive absences sharing one reason.
9. **`OTHER_GROUP_TITLE` becomes a disclosure** (`school-facts-blocks.ts:159-167`)
   — it is explicitly the overflow bucket, not curated content. Collapsed past
   ~8 rows behind "Show N more" with the count on the toggle. Curated groups
   stay always-open; collapsing curated content would hide the thing the page
   exists to show. **A severe caveat is never behind the fold** (DESIGN §15.2's
   "never hide an error behind a click", extended).

**Gate:** scroll depth for "Getting in" measurably down at 1440. The first
thing the eye lands on in each section is that section's actual answer. Nothing
absent has been removed, only compressed with its reason intact.

### Phase 3 — Marks, motion, states

10. **Give `waitlist` its missing `render`.** Verified: the group has `entries`
    only, no `render` (`school-facts-sections.ts:231-242`), despite being the
    identical shape to `applicant-pool` — three nested counts, 1,020 ⊇ 704 ⊇ 0.
    Same house pattern: three bars on one baseline, `maxRef` the largest stage,
    **not** a funnel. It also exercises `FactBarChart`'s zero rule — 0 admitted
    is a reported fact and gets the documented 2px tick, never a vanished bar.
11. **`ReferenceLine` on `required-units`** for the recommended total (§3).
12. **`RadialBarChart` for single shares** (§3), used sparingly — two places at
    most across the whole tab.
13. **D1a — fix the section-switch motion.** `SchoolFactsPanel.tsx:68` uses
    `motion-safe:animate-in fade-in slide-in-from-bottom-1 duration-200`, which
    is keyframe-based. Keyframes restart from zero on re-trigger; a student
    clicking quickly through Getting in → Money → Academics gets a stutter
    rather than a crossfade. Move to a CSS transition, which retargets cleanly
    mid-flight. This is the high-frequency interaction on the page — the chart
    entrance is once per visit, this is dozens of times per session.
14. **Use the named curve.** `chart-tokens.ts:74` passes the string
    `"ease-out"`; the app's list-entrance curve is
    `cubic-bezier(0.16, 1, 0.3, 1)` and Recharts accepts a cubic-bezier
    directly. The built-in is the weak curve; we already have a stronger one
    reserved for exactly this tier.
15. **No stagger across blocks.** A section's blocks are heterogeneous (a
    table, then a chart, then a table) and there are 1–4 of them. Stagger is
    for lists of many similar items. Adding it here is the uniform-reflex tell.
16. **Add `SchoolFactsSkeleton`**, mirroring `ProfileSkeleton`
    (`ProfileRoute.tsx:39-46`) — rail + panel shape. Currently missing.
17. **URL hash for the selected section** (D1), so a section is linkable and
    survives reload. Parity with the About/Application tab split already in
    `SchoolDetailRoute.tsx:171-180`. Needs `scroll-margin-top` for the sticky
    header.

**Gate:** rapid nav clicking is smooth, not stuttery. Reduced-motion verified
(the `useChartEntrance` hook already gates correctly). Skeleton matches the
loaded layout — no shift.

### Phase 4 — The honesty surface (D2)

The one that changes what the page *says*, not just how it looks. Honesty-
critical: hard tests, per AGENTS.md.

18. **Thread evidence and caveat through the row shape.** Add two optional
    fields to `FactTableRow` (`school-facts-rows.ts:30-35`) and carry them
    through `entryRow`, `laneRow`, `roundRows`. Small in scope, but it touches
    the honesty-critical path.
19. **Evidence disclosure: `Popover`, not `HoverCard`.** Radix `hover-card` is
    hover-only by contract, so it does not exist on a phone — which is exactly
    what `chart-shell.tsx:16-17` already refuses for caveats. Render a
    `reported` value with non-null evidence as a real keyboard-operable
    `<button>`; the popover shows page / CDS section / row / column plus the
    excerpt, reusing the sources-rail evidence-row shape (DESIGN §15.4) rather
    than inventing a second evidence card. `aria-describedby` gives desktop a
    lightweight hint without requiring a click per row.
    Motion: 150ms, scale `0.95 → 1` + opacity, `transform-origin` at the
    trigger row — origin-aware, never centered (that is modals only).
20. **Wire severe caveats.** `Badge variant="warning"` + `AlertTriangle` +
    the word, inline before the caveat sentence, never replacing it — the same
    triple-redundant pattern `VerdictBand.tsx:99-106` already uses. Consumes
    the two dead tokens at `schools.css:109-110`. Ordinary caveats keep their
    current plain treatment: most caveats are ordinary, and badging them all
    is the everything-highlighted failure.

**Gate:** every evidence popover reachable by keyboard, dismissible with
`Escape`, and openable by tap on a 375px viewport. Zero hover-only disclosure.
`school-facts-honesty.test.tsx` extended, not replaced.

---

## 5. Honesty rules (unchanged, restated because Phases 2 and 4 touch them)

The rules in `school-facts-visuals.md` §6 stand in full. Two additions specific
to this phase:

1. **Compression is not hiding.** A collapsed run of absences must still state
   its reason on the collapsed line, and the toggle must carry the count. A
   disclosure that reads "3 more" without saying what kind of nothing they are
   fails this.
2. **Nothing severe goes behind a fold.** A severe caveat, and any absence that
   changes how a neighbouring number should be read, renders outside every
   collapsed region.

### Tests

Extending `school-facts-honesty.test.tsx` across all three fixtures:

- a run of ≥3 same-reason absences renders one line that still contains the
  reason string, and the individual rows are reachable
- a severe caveat renders outside any `<details>`, with its badge word present
  in the accessible name (not colour alone)
- a row with `evidence` exposes a `<button>` with an accessible name, and the
  popover content contains the page number and CDS section
- a row with no evidence renders no button (no empty affordance)
- the waitlist zero renders a labelled "0" distinguishable from not-plotted

---

## 6. Dead code and drift to clear while in these files

Verified 2026-08-27, all zero-consumer:

- `--school-chart-axis: 200px` (`schools.css:154`) — **dead.** Its comment
  claims it mirrors `AXIS_WIDTH` "for the few places CSS needs it"; there are
  none. Delete it. (An earlier review flagged this as a mobile desync risk
  because `useAxisWidth()` drops to 116 and the CSS token does not — that risk
  is not real, because nothing reads the token. Deleting is the whole fix.)
- `--school-fact-caveat-severe-fg` / `-bg` (`schools.css:109-110`) — dead until
  Phase 4 wires them. If Phase 4 is dropped, delete them.
- `gap-7` (`SchoolFactsSection.tsx:43`) is off the DESIGN §7.1 spacing ladder.
  Land on `gap-6` or `gap-8` while the file is open.
- `components/ui/table.tsx:64` hover uses a raw
  `color-mix(in srgb, …, 2%)` instead of `--surface-hover` (already noted in
  the visuals plan, still open).

---

## 7. Explicitly out of scope

- **Shared-primitive extraction** (D3): a `SectionRailNav` shared by Profile
  and Facts, and a named constant for `max-w-[1160px]`. Both real, both touch
  Profile, both their own PR.
- **Scrollspy navigation** (D1 alternative). Revisit if click-swap still feels
  wrong after Phase 3.
- **A hero number.** Needs a written decision against this page's own stated
  rule, not a drive-by.
- **Multi-year CDS editions**, which would unlock the trend charts Recharts
  offers and we currently have no honest use for.
- **The 33 pre-existing type errors** in `ai-chat/`, `shell/sidebar-icons.tsx`,
  and `api/workspace/`. Confirmed pre-existing by stashing this branch's
  changes and rebuilding to an identical count. Not this work's to fix, but
  they mean `npm run build` cannot be a clean gate — use it as a delta check.

---

## 8. Risks

1. **Phase 1 is a bigger diff than it sounds.** `FactTable`'s card variant, its
   hover states, and the inset padding math all assume block-level card
   boundaries. Retiring that touches every block's spacing, not just a wrapper.
2. **The Phase 2 grid can slide into a stat-tile dashboard** if cells stop
   looking like the same list-shaped rows used elsewhere. Mitigation: identical
   border, radius and hover vocabulary in every cell; no icons; no per-cell
   colour.
3. **Compression risks becoming a hide** if implemented as a filter rather than
   a fold. The `strayRefs` discipline exists precisely to stop metrics
   disappearing silently.
4. **Phase 4 adds an interactive surface to a previously read-only page** —
   needs its own a11y pass (focus management, `Escape`, no focus trap), and it
   ripples through four files on the honesty-critical path.
5. **Label wrap at 375px.** `AXIS_WIDTH_MOBILE` is 116px while
   `CHART_ROW_HEIGHT` is a fixed 40px pitch not derived from label height. A
   three-line wrapped label could collide between rows. Unresolved from static
   reading — needs an actual viewport check, independent of this plan.
6. **`RadialBarChart` is one step from the KPI-gauge look** the page should
   refuse. If it cannot be made to read as quiet as the bars beside it, drop it
   — the plan does not depend on it.
