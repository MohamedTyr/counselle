---
name: chancing
description: Judgment procedure for "what are my chances" and reach-target-safety questions — read the student before the school, classify risk instead of predicting outcomes, check major pressure and affordability, and end with what the classification means for the list and round strategy. Use when a student asks about admission chances or how realistic a school is.
user_invokable: true
display_name: Chancing
user_description: Classify reach, target, and likely odds without fake predictions.
---

# Chancing

Source: `plans/research-counselor-judgment.md` (triage instinct; chances playbook).

## The hidden decision

"What are my chances at X?" is never a statistics request. It is one of:
"Do I have a realistic shot?", "Should X stay on my list?", "Should I spend
an early round on X?", or "Am I heading for a shutout?" Work out which from
the student context and the conversation, and answer that. If the profile
block is thin (no GPA, no rigor signal), give the honest partial read, say
exactly what you'd need to classify properly, and invite it — don't stall.

## Evidence plan

Use `counselor-research` for routing. In the post-`resolve_school` round, collect:

- CDS coverage + admissions/selectivity context.
- official `.edu` data for current-cycle policy and restrictions.
- broad web when institutional language is conflicting or ambiguous.
- Reddit for recurring applicant-level implementation signals.

## Fingerprint the applicant type first (it can invert the whole ladder)

Some facts about *the student* don't just add nuance — they recompute every
classification. Check these before you place a single school, and search the
school-specific policy that each one triggers:

- **International + needs full aid.** For this student there is effectively **no
  admission-safety school**. Aid-needing internationals face need-aware review and
  far lower effective admit rates, so schools that would be safeties or targets for
  a full-pay domestic applicant become reaches, and a financial safety is not the
  same thing as an admission safety. Verify each school's international-aid posture
  (`"[school] international financial aid need aware"`, IntltoUSA sweep) and say the
  ladder is different — never hand this student a standard reach/target/safety list
  with a public university labelled "safety".
- **Residency.** In-state vs out-of-state changes both admit odds and cost at public
  universities — fetch the split before classifying.
- **Oversubscribed / capped major.** CS, engineering, business, nursing, architecture
  are often admit-by-major, so the institution-wide rate is a lie for this student —
  check the school's major-specific policy (`.edu`) before placing it.

## How to classify

Weigh in this order — the order decides, not a formula:

1. Transcript and rigor in school context — the strongest signal, readable
   only from the student block; say so when it's missing.
2. Grade trend — rising beats flat at the same GPA.
3. Intended-major pressure (below).
4. Test score against the school's current middle-50% from the database,
   and the submit-or-not call (load `testing-strategy` when that's live).
5. Current selectivity, cited from the database or official site.
6. Affordability — a school the family can't afford isn't really on the list.

Then classify: **high-reach / reach / possible / likely — for this student.**
Sub-25% admit rates are reach territory for everyone, regardless of stats;
say that plainly when it applies.

## Deductions and traps

- A moderate overall admit rate can hide a reach: CS, engineering, business,
  and nursing are oversubscribed at many schools, and admit-by-major or
  restricted switching makes the effective rate far lower. When the
  student's major is one of these, check the school's major-specific policy
  on its site before classifying.
- Raw admit rates are distorted by counting practices (ED share, waitlist
  offers). Never compare schools on the headline rate alone.
- Stale rates misclassify: last year's public number can move a school a
  whole category. Use the database's cited value, note its vintage, and
  voice the stale-edition caveat when it applies.
- Lower admit rate never means higher quality — don't let the student's
  anxiety smuggle that equation in.

## Final answer shape

1. Recommendation-first classification and reasons.
2. Hidden variable that most changes it, with what to check if unavailable.
3. The exact move (keep, cut, or change round) that follows.
4. Separate official facts from community observations.
5. One short uncertainty only if it can change the recommendation.

Avoid personal probabilities. Do not stop at a bare admit rate + range.

## Exemplar shape

A student from a small rural school asks, "Do I even have a chance at top
schools against coastal applicants with research internships?" The veteran
answer: admissions readers review in school and regional context — the real
question is whether you maximized what was available to you, not whether
you match someone else's opportunity set. Then: what their file shows, what
is checkable this cycle, and the list move that follows.
