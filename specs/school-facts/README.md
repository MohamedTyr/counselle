# School facts — the About tab

The Common Data Set facts page on a school: what the school itself
published, rendered so a student can tell a number from an absence, and an
absence from a different kind of absence.

Three plans, in the order they shipped. Each depends on the one before it.

| File | What it built |
|------|---------------|
| [`plan/01-honesty-model.md`](plan/01-honesty-model.md) | The read model and the absence grammar. Six `FactState` kinds, each with its own sentence; `caveatRefs` required rather than optional; the section config as a presentation hint that never asserts what exists, with a stray-ref fallback so a manifest bump cannot silently drop metrics. |
| [`plan/02-chart-layer.md`](plan/02-chart-layer.md) | The marks. Monochrome bars, ordinal strips and range bands over `@shadcn/chart`, with the numeric gate (a chart may only draw a value the packet supplied AS a number), the honest-ceiling rule, and the zero rule. |
| [`plan/03-composition.md`](plan/03-composition.md) | The page. One raised panel per section instead of six group cards, hierarchy and absence compression, the waitlist mark and the section URL, and the honesty surface — evidence popovers and inline severe caveats. |

## Where it diverged from the plan

Recorded here because the plans themselves are historical records and are
not retro-edited.

- **`plan/02` §2 is wrong about the registry.** It lists preset blocks
  (`chart-bar-horizontal`, `chart-radial-shape`, `chart-bar-stacked`) as
  "verified live". They 404. `https://ui.shadcn.com/r/index.json` returns 63
  items with exactly one chart — `@shadcn/chart` — and the ~40 charts on
  `ui.shadcn.com/charts` are copy-paste examples, not registry items. Only
  the one installable item was ever used, so nothing was built on the error.
- **`plan/03` items 7 and 11 conflicted.** Item 11 asked for a chart on
  `required-units`; item 7 wanted that group paired side-by-side with
  `class-rank`. A group with a chart owns its full width, so the two could
  not both happen. The pair won: 20 required against 24 recommended is a
  difference the adjacent rows already make readable, and drawing it cost
  real vertical space for a mark nobody needed.
- **`plan/03` item 12 (`RadialBarChart`) was dropped**, as the plan's own
  risk 6 permitted. Every single share on the tab is already a bar inside a
  group whose point is the comparison between its bars; a ring would have
  had to be removed from one of those groups to exist.
- **`plan/03` item 13 removed the section-swap animation** rather than
  moving it to a CSS transition. Rail navigation is performed dozens of
  times a session, which is the tier where the answer is to remove the
  animation, not tune it — and Profile's identical rail-and-panel swap has
  never animated.
- **`plan/03` item 16 (`SchoolFactsSkeleton`) was not built.** The facts
  arrive synchronously and the route's own skeleton covers the only wait
  there is; it belongs with the change that makes the read async.
- **`plan/03` item 17 used a search param, not a URL hash** — the grammar
  the About/Applying tab one level up already uses.

## Bugs found while implementing, not predicted by any plan

- A chart group whose configured ceiling could not be read as a number
  collapsed to rows correctly, but rebuilt those rows through `takeRows`,
  which skips refs the numeric split had already marked seen. Every value
  that had *passed* the gate fell out of the page. This is the block
  invariant ("nothing is ever in neither") and it stayed invisible only
  because no group had reached that branch with points in hand.
- The value column was `w-[38ch]` rather than `max-w-`, reserving 38
  characters to print "20" and starving the label column it existed to
  protect.
- Bar-chart axis labels anchored right while the ordinal strip, range bands
  and every table row anchored left.
- Chart row pitch was a fixed 40px that assumed one-line labels.
- Italic absence sentences clipped their last letter at a flush right edge.
- A caveat cell inherited `whitespace-nowrap`, setting the table's min-width
  to the length of the sentence and pushing every value off a 375px screen.
