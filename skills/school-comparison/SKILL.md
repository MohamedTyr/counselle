---
name: school-comparison
description: Procedure for comparing schools side by side — resolve all schools, check each one's facts status before fetching, pull the same section symmetrically per school, render with render_viz's v2 sourced/DB/unavailable cell grammar, and handle the absence-state and ranking-denominator caveats honestly. Use when a student wants to compare schools.
user_invokable: true
display_name: School comparison
user_description: Compare schools across cost, admissions, outcomes, and fit.
---

# School Comparison

## When to use this skill

A student asks to compare two or more schools ("Compare Duke and Harvard on
cost", "better outcomes: UNC, UVA, or William & Mary?"). This skill is the
comparison judgment contract; for evidence ordering and source discovery use
`counselor-research`.

There is no fixed school-count cap: compare however many were named; if the
table gets too large to read, say so and offer to narrow it.

## Step 1 — Resolve every school first

Call `resolve_school` for each name before fetching. If a school isn't in the
database, say so for that one and continue with the rest — never fabricate
data. If a name matches multiple campuses, use the most likely one when
responsible and state the assumption; if no responsible default exists,
exclude it and explain why.

## Step 2 — Check each school's facts status before fetching

Before pulling any metric, read each resolved school's facts status
(`resolve_school`'s `data`: `has_collegedata`, `facts_updated_at`, `tabs`). A
school with `has_collegedata: false` has no CollegeData facts at all — say so
for that school and lean on its profile plus official web sources instead of
silently dropping it from the table. When the schools were last confirmed at
meaningfully different times, the comparison still stands but carries the
`observed_at_spread` caveat once, up front, rather than implying one shared
as-of date. Never call differently-dated values "the same period": preserve
each `get_facts` row's own `vintage` in prose.

## Step 3 — Pull the same section symmetrically

For each dimension the student cares about, call `get_facts(unitid, sections=[...])`
for the *same* section(s) across every school — the six sections are
`getting-in`, `money`, `academics`, `campus-life`, `outcomes`, and `applying`,
each already including its own `other` group. Use the `fact_key`s each call
returns — never guess a key a school didn't return. Check `unavailable` for
any requested key a school doesn't have a value for, and say which absence
state it is (`not_reported`, `not_fetched`, `not_published`, `not_collected`)
rather than treating a blank cell as a zero. If no dimensions were specified,
pick the sections that best match the implied intent (cost, selectivity,
outcomes are common defaults), state briefly, and continue.

For cross-school selection or aggregates ("which of these report the lowest
net price"), use parameterized `query_database` (see `db-recipes`), resolve
every returned finalist, then re-fetch their actual values via `get_facts`
before citing — `query_database` rows are candidates, never citations.

**Qualitative and program axes need substance, not a name.** Not every dimension
is a DB scalar. When an axis is a program, department, major, culture, or outcome
the student is choosing between, the differentiating substance is concrete —
majors/tracks, program size, structure, specializations, access rules — pulled
from `.edu`/web. A cell that only restates the school's or program's name
("School of Engineering") is an empty comparison; mine the source for the real
offerings instead of collapsing to the title.

## Step 4 — Render with the v2 cell grammar

Always call `render_viz(type="comparison_table", columns=[...], rows=[...])`.
Every cell is one of exactly four shapes:

- `{fact_key}` — a fact key from `get_facts`; the resolver fetches and cites it.
- `{profile_field}` — a `group.field` profile reference; same deal.
- `{display, raw?, marker}` — a value you read from web/.edu/Reddit, citing a
  marker already registered this turn. Never invent a marker.
- `{unavailable: true}` — an honest hole. Use this whenever a school truly
  lacks the data for that row/column, including a **nullable web-only
  column** for a school with no first-party data on that dimension at all.

An unavailable hole means missing, not zero — say so when the student asked for
that fact. Never present a comparison in prose alone: the table owns the numbers,
prose is interpretation. For a cell one school lacks first-party data on but the
web answers, use the official-web fallback via a registered `[n]` marker, never
an invented one.

## The retry protocol is all-or-nothing

`render_viz` validates every cell before rendering; any rejected cell returns
no card, just `rejected_cells` (with reasons) and a `valid_cells` count. Fix
exactly the named cells and retry the whole call. Never reinterpret a
rejection as "unavailable" — rejection means the reference was wrong;
unavailable means the data doesn't exist, and only you declare that.

## Step 5 — Caveats and the ranking denominator

State once, near the table, whichever of these apply:

- **`observed_at_spread`** — compared schools' facts were confirmed at
  meaningfully different times (see Step 2).
- **`stale_facts`** — any one school's value hasn't been re-confirmed
  recently; name which school it's about.
- **`not_collected` / `not_fetched` / `not_published`** — one school lacks the
  requested facts entirely, its page couldn't be read, or it has no page for
  that section — say which of the three it is, never a generic "no data."
- **`coverage_denominator`** — if any analysis came from `query_database` over
  a candidate population, state the covered/total split for the exact ranked
  fact key and its as-of date. The numerator is schools with a real value for
  that fact key, never "has some CollegeData facts."

## Step 6 — Cite by marker in prose

Cite the table's markers when discussing specific numbers in prose ("Duke's
net price under $30k was $X [3] vs Harvard's $Y [7]"). Use the markers the
tool assigned; never invent one (see `citation-and-recency`).

## Final answer shape

1. Start with the recommendation for the stated goal.
2. Give the strongest reasons — and give the non-recommended school its genuine
   due: name the axes where *it* is the better pick, so the student decides with
   the real tradeoff visible instead of a one-sided verdict. A comparison that
   only argues for the winner is worse than one that maps who wins on which axis.
3. Separate official facts from community observations.
4. State material uncertainty that could invert the ranking.
5. End with the immediate next move. When a student-fact inverts the safety
   ladder (full-aid international, capped major, residency), close on the
   *list*, not just this pair — balance it with more schools that match the
   constraint plus merit paths, not only pick between the two compared.
