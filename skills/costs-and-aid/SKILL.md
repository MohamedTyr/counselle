---
name: costs-and-aid
description: Judgment procedure for affordability, net price, FAFSA/CSS, and merit questions — need-blind is not affordable, admitted-but-priced-out is real, aid mechanics are cycle-perishable facts to verify, and the answer is a process with the earliest deadline that matters. Use when a student asks about cost, financial aid, or scholarships.
---

# Costs and Aid

Source: `plans/research-counselor-judgment.md` (cost/aid playbook).

## The hidden decision

"How much does X cost?" means "can my family actually do this, and how do
we avoid being blindsided in April?" The sticker price answers neither.
Answer with the family's likely path: what they'd plausibly pay, what
determines it, what's uncertain, and the earliest date that binds them.

## Evidence plan

Use `counselor-research` for source routing. In one round after `resolve_school`,
pull:

- CDS cost/aid structure and historical price/need context.
- `.edu` for current-cycle aid mechanics, forms, deadlines, and calculator links.
- Broad web for federal platform shifts (FAFSA/tax-year/process changes).
- Reddit for friction points around calculator behavior, aid appeals, and real timelines.

## Fingerprint this school first (unknown until searched)

Aid posture is school-specific and applicant-type-specific — fetch it for each
school in play before comparing or reassuring:

- **Posture for THIS applicant type** (`.edu` + DB): is the school need-blind or
  **need-aware**, and does it **meet full demonstrated need** — for domestic *and*
  for **international** applicants separately? `"[school] financial aid international
  need aware meet full need"`. These often differ sharply by residency and
  citizenship; never assume the domestic posture carries over.
- **The actual numbers, side by side.** An aid comparison is answered with figures,
  not vibes: pull each school's net-price / aid-by-income-band from the database,
  its net price calculator and aid page (`.edu`), and real reported packages from
  Reddit (financialaid + `{school}` sub). Put the concrete amounts next to each
  other and explain *why* one is better for this family's income band, residency,
  and major — never resolve a comparison with "it depends."
- **The earliest binding money date** (`.edu`): merit/honors/priority deadlines
  that land before the admission deadline and silently forfeit money if missed.

Never estimate one school's aid from another's numbers; methodologies differ
school by school.

## Deductions

- **Need-blind is not affordable.** Need-blind speaks to admission, not to
  the aid package; the questions are "is full need met?" and "how is need
  calculated?" A family can be admitted and priced out — treat that as a
  real outcome to design against, not an edge case.
- **The net price calculator is the family's homework, and it's an
  estimate.** Recommend running it before anchoring on any school; never
  convert its output into a promise, and say which inputs (home equity,
  business income, divorced parents) most often move the real number.
- **ED trades away leverage.** A binding commitment means no competing
  offers to compare. When affordability is uncertain, that is usually the
  deciding argument against ED — say so before the student commits.
- **Changed income is a process, not a dead end**: aid offices reconsider
  through professional-judgment review when family finances changed after
  the base tax year. Point the family to that path when it applies.
- **A need-aware or full-aid-international posture reshapes the list, not just
  this school.** When aid posture removes admission-safety — need-aware for this
  applicant type, or an international student needing full need met — the honest
  answer doesn't end at "pick the need-blind one." Say that neither marginal
  school is safe, and that the list needs more schools matching this aid
  constraint plus real merit-scholarship paths. Answer the ladder, not the pair.

## Traps

- Merit and honors deadlines often land **before** admission deadlines —
  missing them silently forfeits money. Surface every money date, not just
  the application date.
- FAFSA mechanics (tax-year basis, contributor consent steps) have changed
  in recent cycles and failing a required step can cost all federal aid —
  verify the current process rather than describing last year's.
- "We won't qualify for aid" is often wrong at high-sticker schools with
  strong aid; the income bands in the database tell that story — use them.
- Never estimate a family's aid from a comparable school's numbers; aid
  methodologies differ school by school.

## Final answer shape

1. Start with the realistic affordability result for this family.
2. State process drivers (forms, key dates, quirks) and what controls the outcome.
3. Separate official policy from community implementation risk.
4. Name the next decisive action (calculator run, deadline check, docs update).

Never promise an aid or merit outcome. If no exact number is verifiable, give
the closest actionable proxy and disclose the uncertainty.

## Exemplar shape

"Can we afford Boston University?" The veteran answer starts with the net
price for their income band, not the sticker; names what drives the real
number for this family; flags that the merit deadline is earlier than the
admission deadline if it is; and ends with the one action that most reduces
uncertainty — run this school's calculator with real numbers this week.
