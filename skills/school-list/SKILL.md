---
name: school-list
description: Judgment procedure for building, trimming, or auditing a college list — treat the list as a portfolio, test membership on affordability and would-attend, verify current selectivity instead of trusting stale public rates, and recommend concrete cuts and adds. Use when a student wants list help or asks whether their list is balanced.
---

# School List

Source: `plans/research-counselor-judgment.md` (list-building playbook).

## The hidden decision

"Is my list okay?" means "will I end up with real choices in April?" A list
is a portfolio, not a collection of names: it fails when it has too few
likely admits the student would happily attend, when it carries schools the
family can't afford, or when every school was picked for its name. Audit
against those failure modes, not against an ideal reach/target/safety count.

## Evidence plan

Use `counselor-research` for routing. In the first evidence round:

- `view_schools` to audit the actual board when workspace tools are mounted.
- `query_database` (after loading `db-recipes`) for candidate discovery, then
  resolve and re-fetch each finalist through typed reads.
- CDS domains for admissions/selectivity and cost/aid context.
- `.edu` for current admitted-class or policy pages when needed for current-cycle
  decisions.
- Reddit and broad web only to identify real-world fit, hidden friction, and recurring
  implementation risk.

## Fingerprint before you build (unknown until searched)

- **Applicant type can invert the ladder.** For an **international needing full aid**,
  there is effectively no admission-safety school and the whole reach/target/likely
  frame is recomputed — verify each candidate's international-aid posture and do not
  label a public university a "safety". Residency and an oversubscribed/capped major
  reshape the ladder the same way. (See `chancing` for the inversion rules.)
- **Every candidate gets a current, real fingerprint**, not a guidebook memory:
  current admit rate (DB, with vintage), major-specific rate where the major is
  capped (`.edu`), affordability for this family, and would-attend.
- **Adds must be real, named schools you searched**, matched to what the student
  actually likes in their reaches — not prestige vibes and never an invented name.
  Search for the fitting alternatives; quote their real names and the reason each is
  both likely *and* lovable.

## Membership tests — every school must pass all three

1. **Affordable**: survivable net price, not sticker; if unknown, that's the
   first thing to find out, not a footnote.
2. **Would attend**: never keep a school the student wouldn't actually choose
   over their likely options. Applying costs time, essays, and focus.
3. **Honestly classified**: with a current rate, not last year's guidebook
   number — stale data moves schools a whole category (see `chancing` for
   the classification order).

## Deductions and traps

- The most common failure is over-reaching: too many sub-25% schools because
  the student likes the names. Sub-25% is reach territory for everyone —
  the portfolio needs likely admits the student is excited about, found by
  looking for what the student actually likes in their reaches.
- Balance is about outcomes, not counts: two likely schools the student
  loves beat four they'd resent attending.
- Major access is a membership test too: a balanced-looking list where every
  school restricts the student's oversubscribed major is not balanced.
- Visits and specific engagement sharpen judgment and sometimes count as
  demonstrated interest — when a student is torn, the school they've
  actually engaged with is usually the honest tiebreaker.

## Final answer shape

A great list answer names the moves: cut these (and why each fails a
membership test), add schools like these (and what makes them likely *and*
lovable), and fix this structural gap (no affordable likely option, every
reach in the same major, no financial safety).

1. State the list recommendation first.
2. Give 2–4 reasons, each tied to membership tests.
3. Separate official facts from community observations.
4. Finish with specific list actions and the next concrete step.

When workspace tools are mounted and the student agrees to changes, make
them (`add_schools`, `archive_schools` with confirmation) and say plainly
what changed on the board.

## Exemplar shape

"Are elite schools even worth it?" The veteran answer redefines "worth it"
in the student's own terms — cost, merit money, honors programs, warmth,
outcomes for their major — then names concrete alternative schools that fit
those terms, warning which of them have become newly selective themselves.
Directional advice with names in it, not prestige vibes.
