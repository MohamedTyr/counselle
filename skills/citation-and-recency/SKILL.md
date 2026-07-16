---
name: citation-and-recency
description: How to weave citation markers and caveat kinds into prose honestly — markers copied verbatim right after the fact they support, CDS phrasing derived only from the Citation/evidence you were given, when to voice each caveat kind without re-authoring its wording, and the official/community tier distinction. Use whenever you state a fact that came from a tool result.
---

# Citation and Recency

Source: `specs/db-rewire/design.md` §§8-10; `docs/DATABASE_GUIDE.md` §7.

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

## CDS phrasing: derive it, never assume it

When you cite a CDS-sourced value (`get_domain`), the school name, edition,
and page all come from the `Citation`/evidence you were actually given for
that value — never from what you remember about the school or a prior turn.
Phrase it plainly from those fields: "…per Duke's Common Data Set 2024-25,
p. 7 [4]." If the citation names a different edition than you expected (a
stale packet is in play — see below), say the edition you were actually
given, not the one you assumed. Never state a school, edition, or page that
isn't present on the envelope in front of you; if you need it and don't have
it, that's a sign to re-read the domain, not to guess.

## The profile is identity, not a current metric

`get_school_profile` facts (location, control, classification, official
links, mission, HBCU/HSI/tribal designations, …) carry the `profile_snapshot`
caveat on every leaf. Treat everything from the profile as **who the school
is**, sealed at a point in time — never as a current, time-sensitive number.
If a student's question is really about something that changes year to year
(current tuition, this cycle's deadlines, this year's acceptance rate), the
profile is the wrong source even if a same-named field exists there; route to
`get_domain` or the web instead.

## Caveat kinds: voice them, don't re-author them

Every envelope's `caveats` list gives you `{kind, text}` pairs, and `text` is
already canonical, catalog-authored wording — not a draft for you to improve,
shorten, or paraphrase. Use it verbatim, or weave it naturally into a sentence
without changing its meaning or precision. Your job is *when and how often* to
surface it, never *what it says*.

Kinds you'll see, and when they matter to the student:

- **`profile_snapshot`** — every profile fact. Mention once per section, not
  after every single bullet; repeating it line-by-line is noise.
- **`stale_edition`** — the packet is an older CDS edition than the current
  one. Say this whenever you cite a metric from that packet — the number may
  not reflect the school's current class.
- **`partial_packet`** — the whole domain packet was only partially
  extracted. Say this once near the top of that domain's section, so the
  student knows some rows may simply be missing, not zero.
- **`definition_drift`** — the source's definition of the metric differs from
  the current manifest's definition. Voice this specifically for the metric
  it attaches to; it changes how the number should be read, not just how
  fresh it is.
- **`not_in_template_version`** — see below; always voice this distinctly
  from "not reported."
- **`edition_mismatch_comparison`** — a cross-school comparison pulled
  packets from different academic years or manifest versions. Say this once,
  near the comparison, not per cell.
- **`coverage_denominator`** — attaches to `query_database` aggregates.
  Always state the covered/total split and the as-of date; never present an
  aggregate as if it covers every school in the database.

## Template absence is neither zero nor "not reported"

`not_in_template_version` means the CDS template edition that school filed
does not have the row or column at all — the question was structurally
unanswerable from that document, not that the school reported a zero or
declined to answer. Never fold it into "not reported" or drop it silently.
When you give a domain's availability summary ("N of M metrics verified"),
state the `not_in_template_version` count as its own clause ("K aren't in
this school's CDS edition") rather than lumping it into what's missing. Use
the summary sentence you're given — it's built from the catalog for you —
rather than recomputing your own count.

## Sidebar and evidence behavior

A citation marker resolves to a document-level sidebar entry (school +
edition, official/community tier chip, acquisition/retrieval info). Clicking
a value-level chip on a rendered cell scrolls to and highlights that value's
own evidence item — page, section, row/column label, and the verbatim
excerpt. A bare marker in prose resolves to the same document entry but shows
every evidence item registered so far this turn, unhighlighted. You don't
need to explain this mechanism to the student — just place markers correctly
and let the sidebar do the rest. Don't repeat page numbers or excerpts
yourself beyond natural phrasing ("p. 7"); the excerpt lives in the sidebar.

## Official versus community tier

Every citation carries a `tier`: `official` (profile, CDS, the school's own
web/.edu pages) or `community` (Reddit). Never present a community-tier fact
as if it were official — phrase it as sentiment, not statistic: "students on
r/[sub] say…", never "the acceptance rate is…". When a `render_viz` table
mixes tiers in adjacent cells, the renderer labels tier visibly per cell on
its own; your prose should still make the distinction in words wherever a
community number appears, so nothing reads as officially verified when it
isn't.

## What this skill does not cover

It never tells you *which* tool to call, *which* domains to read, or *how* to
structure a dossier or comparison — that's `school-deep-dive` and
`school-comparison`. It never gives you SQL — that's `db-recipes`. It only
teaches how to phrase what you've already been given.
