---
name: school-comparison
description: Procedure for comparing schools side by side — resolve all schools, check coverage/edition parity before fetching, pull the same domain symmetrically per school, render with render_viz's v2 sourced/DB/unavailable cell grammar, and handle mismatch/partial/stale caveats and the ranking denominator honestly. Use when a student wants to compare schools.
user_invokable: true
display_name: School comparison
user_description: Compare schools across cost, admissions, outcomes, and fit.
---

# School Comparison

Source: `specs/db-rewire/design.md` §§5, 7-8, 11.

## When to use this skill

A student asks to compare two or more schools ("Compare Duke and Harvard on
cost", "better outcomes: UNC, UVA, or William & Mary?"). This skill is the
comparison judgment contract; for evidence ordering and source discovery use
`counselor-research`.

There is no fixed school-count cap: compare however many were named; if the
table gets too large to read, say so and offer to narrow it — a usefulness
call, not a hardcoded limit.

## Step 1 — Resolve every school first

Call `resolve_school` for each name before fetching. If a school isn't in the
database, say so for that one and continue with the rest — never fabricate data.
If a name matches multiple campuses, use the most likely one when responsible,
state the assumption, and continue; if no responsible default exists, exclude it
and explain why.

## Step 2 — Check coverage and edition parity before fetching

Before pulling any metric, read each resolved school's coverage block: which
domains are usable, and what edition/year each school's active document is.
Cross-edition comparisons (one school's 2024-25 CDS vs another's 2023-24) are
still worth doing but get the `edition_mismatch_comparison` caveat — say so once,
up front near the comparison, not per cell. Never call differently dated metrics
"the same period": preserve each `get_domain` row's top-level `vintage` so each
fact keeps its own vintage in prose (the compact render acknowledgement doesn't
echo those bindings).

## Step 3 — Pull the same domain symmetrically

For each dimension the student cares about, call `get_domain(unitid, domain_id)`
for the *same* `domain_id` across every school. Use the qualified refs each call
returns — never guess a ref a school didn't return. If no dimensions were
specified, pick the domains that best match the implied intent
(cost, selectivity, outcomes are common defaults), state briefly, and continue.

For cross-school selection or aggregates ("which of these report need-blind
aid"), use parameterized `query_database` (see `db-recipes`), resolve every
returned finalist, then re-fetch their actual values via `get_domain` before
citing — `query_database` rows are candidates, never citations themselves.

**Qualitative and program axes need substance, not a name.** Not every dimension
is a DB scalar. When an axis is a program, department, major, culture, or outcome
the student is choosing between, the differentiating substance is concrete — the
majors/tracks offered, program size and student-faculty ratio, structure,
specializations, access rules — pulled from `.edu`/web. A cell or bullet that
only restates the school's or program's name ("School of Engineering") is an
empty comparison. Fill it with substance you retrieved; if a site search returned
an oversized result, mine it for the offerings, don't collapse to the title.

## Step 4 — Render with the v2 cell grammar

Always call `render_viz(type="comparison_table", columns=[...], rows=[...])`.
Every cell is one of exactly four shapes:

- `{metric_ref}` — a qualified CDS ref; the resolver fetches and cites it.
- `{profile_field}` — a `group.field` profile reference; same deal.
- `{display, raw?, marker}` — a value you read from web/.edu/Reddit, citing a
  marker already registered this turn. Never invent a marker.
- `{unavailable: true}` — an honest hole. Use this whenever a school truly
  lacks the data for that row/column, including a **nullable web-only
  column** for a school with no first-party data on that dimension at all.

An unavailable hole means missing, not zero — say so when the student asked for
that fact. Never present a comparison in prose alone: the table owns the numbers,
prose is interpretation. For a cell one school lacks first-party data on but the
web answers (e.g. current tuition not in a packet), use the official-web fallback
via a registered `[n]` marker, never an invented one — only what you registered this turn.

## The retry protocol is all-or-nothing

`render_viz` validates every cell before rendering; any rejected cell returns no
card, just `rejected_cells` (with reasons) and a `valid_cells` count. Fix
exactly the named cells and retry the whole call. Never reinterpret a rejection
as "unavailable" — rejection means the reference was wrong; unavailable means
the data doesn't exist, and only you declare that.

## Step 5 — Caveats and the ranking denominator

State once, near the table, whichever of these apply:

- **`edition_mismatch_comparison`** — compared schools are on different CDS
  editions (see Step 2).
- **`stale_edition` / `partial_packet`** — any one school's packet is stale or
  partially extracted; note which school it's about. When both apply, voice
  both — neither caveat subsumes the other.
- **`coverage_denominator`** — if any analysis came from `query_database` over a
  candidate population, state the covered/total split for the exact ranked
  metric and its as-of date. The numerator is schools with usable data on that
  metric, never "has some CDS document" — never phrase a "best X" claim as if it
  covers every school in the database.

## Step 6 — Cite by marker in prose

Cite the table's markers when discussing specific numbers in prose ("Duke's net
price under $30k was $X [3] vs Harvard's $Y [7]"). Use the markers the tool
assigned; never invent one (see `citation-and-recency`).

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
   *list*, not just this pair — the honest move is balancing the list with more
   schools that match the constraint plus merit paths, not only picking between
   the two compared.
