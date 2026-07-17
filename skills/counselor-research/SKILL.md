---
name: counselor-research
description: Multi-source research procedure for substantive school-specific strategy, optimization, fit, and application questions. Routes evidence across CDS, official sources, broad web, and Reddit; performs unknown-unknown discovery, handles conflicting signals, and delivers a direct, recommendation-first answer.
---

# Counselor Research

## Source-role matrix

- **Counselle database / CDS (`resolve_school`, `get_school_profile`, `get_domain`)**
  — structure, historical distributions, rates, costs, aid, selectivity, outcomes,
  coverage, and comparison feasibility.
- **Official school sites (`search_school_site`)** — the current-cycle rulebook:
  deadlines, requirements, rounds, test/portfolio policy, major restrictions, aid
  forms, scholarship deadlines, process details.
- **Broad web (`search_web`)** — what changed this cycle, interpretation, AO
  interviews, expert context, and terminology that reveals what needs verifying.
- **Reddit (`search_reddit`)** — hidden friction, what students repeatedly report,
  applicant mistakes, perception shifts, implementation-level behavior.

Use these in parallel when each answers a different part of the decision. No source
is a universal first source.

## Unknown-unknown discovery plan

The facts that flip a school-specific answer are **school-specific, perishable, and
not knowable from memory** — round economics, test posture, aid posture for *this*
applicant, what a school rewards, program strength, real club/community names. Treat
each as unknown until a tool returns it for the school in front of you; the loaded
playbook names which to fingerprint first. A generic answer that skips them is the
failure mode.

Run a discovery round to surface terms, exceptions, and school-specific language,
then a focused verification round for anything decision-changing. Decompose before
searching only the student's wording: (1) what the institution requires/values this
cycle, (2) what structured data says about selectivity and constraints, (3) what AOs
and expert reporting reveal that static pages don't, (4) what applicants repeatedly
report. Fire a round's independent queries **in parallel** — breadth costs no extra
latency.

## Evidence query construction

- **Resolve first.** Load `resolve_school`, read coverage/profile; state any campus
  assumption before a domain claim.
- **Database.** `get_domain` only on usable domains; preserve each row's `vintage`;
  aggregate SQL only after `db-recipes`. Check the school's latest CDS edition first —
  when it is materially stale, the DB is second-degree for year-to-year metrics (lead
  with a verified current web/`.edu` figure), per the system prompt's CDS-recency rule.
- **Official.** Cycle-specific `search_school_site` queries in institutional
  vocabulary; policies before dates; retry year-specific when a page is undated.
- **Broad web.** AO interviews, recent policy changes, expert framing, exceptions,
  and terminology around major access, essay norms, and interpretation shifts.
- **Reddit sweep.** For any strategy/chances/fit/rounds/aid/major question, Reddit is
  a **mandatory multi-query sweep**, never one lookup and never a fallback. Fire
  several angles in one parallel round: *positive* ("what got me into X", "accepted X
  profile"), *negative* ("rejected from X", "mistakes applying to X"), *structural* —
  the decisive variable itself ("X ED vs RD", "is X test blind", "X international need
  aware aid") — and *per-facet* (major, round, residency, aid). Prefer the `{school}`
  sub and the most specific menu subs. Read the recurring pattern, never one anecdote.

## Named-entity discipline

A specific **name** is a factual claim exactly like a number is. Never state the name
of a club, organization, community, program, scholarship, course, or person unless a
tool result this turn returned it — no inventing, no plausible guesses. A group's real
name often differs from the obvious guess (`"[Cause] at [School]"` may not be what it
calls itself): search the school's site and subreddit for the real name, quote it as
returned, and cite it. If no real match surfaces, describe the *category* instead of
fabricating a name.

## Contradiction and community rules

- Official policy is the recommendation baseline. When credible official sources
  disagree, keep both visible with explicit uncertainty about what changed.
- When community reports conflict with official material, tag community findings as
  implementation risk, never as policy or proof; a mismatch that could flip the
  recommendation is a follow-up trigger.
- Keep only behavior-level claims repeated across independent reports; never convert
  Reddit anecdotes into rates. Separate official policy, structured data, and
  repeated experiential patterns, and label the certainty level of each.

## Research-complete checklist

Before answering, confirm:

- Were the playbook's decisive variables actually fingerprinted for *this* school by
  a tool this turn — not answered from memory?
- Did the Reddit sweep cover more than one angle, or is the read resting on one post?
- Does every named club/program/community trace to a search result?
- Are current-cycle policy claims backed by an official source from this cycle, and DB
  claims by coverage?
- Could a discovered claim alter the recommendation or the next move?

If any check fails, narrow the recommendation and name the gap.

## Final answer shape

1. Recommendation first.
2. 2–4 reasons that drive it.
3. Separate official facts from community observations.
4. One material uncertainty only if it can change the recommendation.
5. End with the next concrete move.

If no exact answer is verifiable, give the closest supported proxy and make the gap
explicit.
