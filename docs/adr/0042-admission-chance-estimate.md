# ADR 0042 — Admission-chance estimate on the school chances screen

**Status:** Proposed — implemented on `feat/school-chances-redesign`; owner acceptance pending.

Reverses the "never a percentage chance" position of ADR 0039 for one
surface: the school page's chances screen.

## Context

The chances screen compared a student's GPA, SAT or ACT with a school's
enrolled class and deliberately stopped short of a probability, because the
facts store has no applicant-level outcome data. Students read that screen as
needing a statistician, and the owner asked for a chance estimate.

A probability needs `P(admit | score)`. By Bayes that needs the applicant
pool's score distribution, which no school publishes. What is published is
the overall admit rate and the enrolled class's distribution.

## Decision

Estimate the chance with a one-parameter threshold selection model
(`frontend/src/features/schools/chances/admit-chance-model.ts`). An applicant
has a strength `z` within the applicant pool; the school admits on
`rho*z + sqrt(1-rho^2)*noise` above a cutoff fixed by the admit rate, so
`P(admit | z) = Phi((rho*z - t) / sqrt(1 - rho^2))`. The model's own admitted
distribution is what places a student from the enrolled class, by rank, never
by raw score.

`rho` — how much academics decide — is set from control (public/private) and
admit rate, interpolating four fitted anchors. The school's own
selection-factor ratings were considered and rejected: the scraped values are
unreliable (Harvard reads "religious affiliation: very important").

The screen shows a point estimate with a `likely low–high` range from a
`rho ± 0.1` uncertainty. The range is the screen's only signal that the number
is an estimate: a line naming what it cannot see (essays, activities, major,
residency, hooks) was built and removed at the owner's direction in favour of
a minimal screen. That is a known honesty trade-off, open for owner review.
With no admit rate, or no class distribution to rank against, there is no
estimate and the plain class comparison renders instead.

## Evidence

Fitted against the only public admit-rate-by-academic-strength tables found:
Arcidiacono, Kinsler & Ransom, "What the Students for Fair Admissions Cases
Reveal About Racial Preferences", Table 4 (Harvard, UNC in- and
out-of-state, by academic-index decile) and UCLA's fall-2019 freshman profile
(by GPA band). One `rho` per school reproduced every published decile with a
mean absolute error of 0.5–1.2 percentage points: 0.42 Harvard, 0.65 UNC
out-of-state, 0.67 UCLA, 0.85 UNC in-state. Harvard's top decile is 15.3%
published, 16.8% modelled.

## Consequences and limits

- The functional form is validated; the `rho` rule rests on four schools.
  Its uncertainty is shown to the student as the range, never hidden.
- Validation used applicant deciles directly. Placing a student from the
  enrolled class's buckets is not separately validated, and enrolled is
  treated as admitted: no yield correction.
- Each screen uses one measure (GPA, or SAT, or ACT); they are not combined.
- The estimate describes a typical applicant. Recruited athletes, legacies,
  major-specific and residency-specific admission are outside it.
- `admit-chance-model.test.ts` pins the honesty floor: the top of a
  5%-admit private class must stay a long shot.
