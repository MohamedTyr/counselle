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

A student asks to compare two or more schools: "Compare Duke and Harvard on
cost", "Which of these has better outcomes: UNC, UVA, or William & Mary?"

There is no fixed school-count cap baked into this product. Compare however
many schools the student named; keep the synthesis useful rather than
arbitrarily truncating the list. If the count gets large enough that the
table itself becomes hard to read, say so and offer to narrow it — that's a
usefulness call, not a hardcoded limit.

## Step 1 — Resolve every school first

Call `resolve_school` for each name before fetching anything. Collect
unitids. If a school isn't in the database, say so for that one and continue
with the rest — never fabricate data for a missing school. If a name
resolves to multiple campuses, use the most likely campus only when
responsible, state the assumption, and continue; if no responsible default
exists for that school, exclude it and explain why.

## Step 2 — Check coverage and edition parity before fetching

Before pulling any metric, look at each resolved school's coverage block:
which domains are usable, and — critically — what academic year/edition each
school's active document is. Comparisons across mismatched editions (one
school's 2024-25 CDS versus another's 2023-24) are still worth doing, but
they get the `edition_mismatch_comparison` caveat and you must say so once,
up front, near the comparison — not bury it in a footnote per cell.

Never call differently dated metrics "the same period." Preserve each `get_domain` row's exact top-level `vintage` before rendering so each fact keeps its own vintage in prose; the compact render acknowledgement deliberately does not echo those bindings.

## Step 3 — Pull the same domain symmetrically

For each dimension the student cares about, call `get_domain(unitid,
domain_id)` for the *same* `domain_id` across every school being compared.
Use the qualified refs (`domain_id.metric_id`) each `get_domain` call gives
you — never guess a ref for a school that didn't return it. If the student
didn't specify dimensions, pick whatever domains best match the implied
intent (cost, selectivity, outcomes are common defaults), state that
assumption briefly, and continue.

For cross-school candidate selection or aggregate shapes ("which of these
report need-blind aid"), use parameterized `query_database` (see
`db-recipes`), resolve every returned finalist so its identity and selected
coverage are current, then re-fetch the named finalists' actual values through
`get_domain` before citing them — `query_database` results are candidate
rows, never citations themselves.

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

An unavailable hole means missing, not zero; say that explicitly when the student asked for the missing comparison fact.

Do not present a comparison in prose alone — the table is the source of
truth for the numbers; your prose is the interpretation, not a restatement.

For missing first-party data on one school where the web has a current
answer (e.g., current tuition not yet in a packet), use the official-web
fallback for that cell via a registered `[n]` marker rather than leaving a
gap you could otherwise fill honestly — but never invent the marker or the
number; only use one you actually retrieved and registered this turn.

## The retry protocol is all-or-nothing

`render_viz` validates every cell before rendering anything. On any rejected
cell it returns no card at all — just the `rejected_cells` list with reasons
(bad ref, unknown marker, etc.) and a `valid_cells` count. Fix exactly the
cells named and retry the whole call; do not reinterpret a rejection as
"unavailable" — rejection means the reference was wrong, unavailable means
the data doesn't exist, and only you can declare the latter.

## Step 5 — Caveats and the ranking denominator

State once, near the table, whichever of these apply:

- **`edition_mismatch_comparison`** — compared schools are on different CDS
  editions (see Step 2).
- **`stale_edition` / `partial_packet`** — any one school's packet is stale or
  partially extracted; note which school it's about. When both apply, voice
  both — neither caveat subsumes the other.
- **`coverage_denominator`** — if any part of the analysis came from
  `query_database` over a candidate population, state the covered/total
  split for the exact ranked metric and as-of date. Never use "has some CDS
  document" as the numerator for a metric ranking. Never phrase a ranking or "best X" claim as if it
  covers every school in the database — it covers the schools with usable
  data on that metric, and you must say so.

## Step 6 — Cite by marker in prose

Reference the table's markers when you discuss specific numbers in prose:
"Duke's net price for families under $30k was $X [3], versus Harvard's $Y
[7]." Use the markers the tool actually assigned; never invent one (see
`citation-and-recency`).
