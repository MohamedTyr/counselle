---
name: citation-and-recency
description: How to weave citation markers and caveat kinds into prose honestly — markers copied verbatim right after the fact they support, db phrasing derived only from the citation you were given, when to voice each of the eight caveat kinds without re-authoring its wording, and the official/community tier distinction for external sources. Use whenever you state a fact that came from a tool result.
---

# Citation and Recency

## The core principle

Every fact you state from a tool result arrives with a `marker` field already
attached (`"[3]"`, sometimes with an invisible internal token appended — copy
the whole `marker` string verbatim, exactly as given, immediately after the
prose it supports). You never invent a marker, renumber one, or move it away
from the value it belongs to. The runtime strips the invisible part before the
student sees it; your job is only to place the visible `[n]` correctly and
never touch what follows it.

This applies identically to `render_viz` sourced cells: a `{display, raw?,
marker}` cell must reuse a marker that already resolved earlier in this turn.
An unknown or invented marker gets that cell rejected, not rendered — see
`school-comparison` and `school-deep-dive` for what to do with a rejection.

## Database phrasing: derive it, never assume it

A value from `resolve_school`, `get_school_profile`, or `get_facts` carries a
`db` citation — Counselle's own facts, not a named external document. It
carries a `school_unitid` and a `vintage` (an identity-snapshot date, or when
the fact came from `get_facts`, when Counselle's facts for that school were
last checked) — and nothing else: no edition, no page, no document identity,
and no source tier (`tier` is always `null` for `db`). **Never attribute the
value to a source the student would recognize** — no "per the school's
Common Data Set," no page number, no document name. State the fact plainly
with its marker; the marker is what reveals provenance, not your prose.

If a student's question is really about something that changes year to year
(current tuition, this cycle's deadlines, this year's acceptance rate), a
profile field is the wrong source even if a same-named field exists there —
profile facts are identity, sealed at a point in time; route to `get_facts`
or the web instead.

For a current official-web number, retrieval date proves nothing: require
`source_currentness: current` plus page/metadata `source_period_evidence`;
retry `undated`/`historical` results with a year-specific official query or
say current data could not be verified.

Each `get_facts` row also carries its own per-fact `vintage` string, distinct
from the shared citation's vintage — keep it beside that fact; never replace
it with the citation's generic vintage or merge two facts' vintages into "the
same period."

## Caveat kinds: voice them, don't re-author them

Every envelope's `caveats` list gives you `{kind, text}` pairs, and `text` is
already canonical, catalog-authored wording — not a draft for you to improve,
shorten, or paraphrase. Use it verbatim, or weave it naturally into a sentence
without changing its meaning or precision. Your job is *when and how often* to
surface it, never *what it says*. There are exactly eight kinds:

- **`profile_snapshot`** — every profile fact. Mention once per section, not
  after every single bullet; repeating it line-by-line is noise.
- **`coverage_denominator`** — attaches to `query_database` aggregates.
  Always state the covered/total split and the as-of date; never present an
  aggregate as if it covers every school in the database.
- **`not_reported`** — the school's page was checked and this fact was
  blank. Not a zero; the school simply didn't publish it.
- **`not_collected`** — there is no CollegeData crawl for this school at
  all. Say this plainly rather than "not in our database" — the school
  itself may still be profiled.
- **`not_fetched`** — Counselle could not read this fact's page on the last
  check, or has never checked it. The value is unknown, not absent.
- **`not_published`** — this school's site has no page of this kind at all,
  so there's nothing to report — not a value the school withheld.
- **`stale_facts`** — this value hasn't been re-confirmed recently; say when
  it was last checked and that it may have changed since.
- **`observed_at_spread`** — a cross-school comparison mixed facts checked
  at different times. Say this once, near the comparison, not per cell.

`not_reported`, `not_collected`, `not_fetched`, and `not_published` are four
distinct absences with four distinct meanings — never collapse them into a
generic "no data," and never fold one into another.

Any unavailable or missing value is not zero; say so when the student asked
for it, and never turn absence into a numeric claim.

## Sidebar and evidence behavior

A citation marker resolves to a document-level sidebar entry (school and
vintage; for external sources, the official/community tier chip plus
acquisition/retrieval info). Clicking a value-level chip on a rendered cell
scrolls to and highlights that value's own evidence item — page, section,
row/column label, and the verbatim excerpt, when the source carries one. A
bare marker in prose resolves to the same sidebar entry. You don't need to
explain this mechanism to the student — just place markers correctly and let
the sidebar do the rest.

## Official versus community tier

An external citation (`web`, `edu`, `reddit`) carries a `tier`: `official`
(the school's own web/.edu pages) or `community` (Reddit). A `db` citation
carries no tier at all — never invent one or imply "official" for it. Never
present a community-tier fact as if it were official — phrase it as
sentiment, not statistic: "students on r/[sub] say…", never "the acceptance
rate is…". When a `render_viz` table mixes tiers in adjacent cells, the
renderer labels tier visibly per cell on its own; your prose should still
make the distinction in words wherever a community number appears, so
nothing reads as officially verified when it isn't.

## What this skill does not cover

It never tells you *which* tool to call, *which* sections to read, or *how*
to structure a dossier or comparison — that's `school-deep-dive` and
`school-comparison`. It never gives you SQL — that's `db-recipes`. It only
teaches how to phrase what you've already been given.
