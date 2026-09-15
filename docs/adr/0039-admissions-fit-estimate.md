# ADR 0039 — Admissions-fit planning estimate on Explore cards

**Status:** Proposed — implementation in progress.

## Context

Explore currently assigns Reach, Target, and Safety from a school's overall
admit rate in the browser. The authenticated student's saved Profile already
contains some academic and testing fields, while the CollegeData facts store
already contains a limited, structured set of comparable entering-class facts:
GPA distributions, class-rank shares, SAT/ACT percentile bands, and the
school's SAT-or-ACT policy. The store has no applicant-level admission-outcome
corpus, no program- or residency-specific admit rate, and no Profile field
that says whether a student will submit an optional score.

That means the product can make a bounded planning classification, but cannot
honestly estimate a student's personal admission probability.

## Decision

1. Add one deterministic, server-owned `admissions-fit-v1` estimate to each
   authenticated Explore card. The estimate remains a planning category —
   `Reach`, `Target`, `Safety`, or `Unknown` — never an admission probability,
   percentage chance, or exposed internal score.
2. Use `school_explore.admit_rate` as the mandatory, sovereign baseline:
   `<20` is Reach, `<50` is Target, otherwise Safety. A missing or invalid
   rate is Unknown. Optional detail can never manufacture a result, and a
   sub-20% baseline cannot leave Reach.
3. Apply only comparable, current existing data. GPA distribution is the
   preferred academic signal; valid class-rank shares are its fallback. SAT
   requires both sections; ACT uses its published composite band. If both test
   types are usable, they must agree. A test adjustment is possible only for
   the raw normalized policy code `value_text == "required"`; all other codes
   mean no test adjustment.
4. Treat missing, absent, stale, malformed, incomplete, incompatible, or
   contradictory optional evidence as zero influence. In particular: a
   Profile with no usable comparison returns exactly the admit-rate baseline;
   absent distribution buckets are never converted to zero.
5. Fix the v1 bounded adjustment table in code: academic strong/weak is
   `+8/-8`, testing strong/weak is `+4/-4`, and total movement is clamped to
   `[-12,+12]`. These values are heuristic category margins, not learned
   probabilities. Changing them requires a new algorithm version, sensitivity
   evidence, and owner approval.
6. Keep the pure calculator in `domain/admissions_fit/`; translate Profile and
   `FactValueRow` shapes in an app-layer adapter. The database remains read
   only and no crawler mapping, schema, table, migration, LLM, search, or new
   Profile field is required.
7. Keep `Application.list_type` independent. An estimate must never create,
   select, patch, or overwrite it; existing Explore quick-add behavior is not
   derived from the estimate.

## Rationale

- Admit rate makes a useful, present-day fallback for every card with that
  fact, while bounded comparable inputs can improve a nearby classification
  without pretending to model the whole admissions process.
- A pure, versioned calculator makes the high-stakes classification
  deterministic, testable, and reusable without coupling it to HTTP, database
  rows, or React.
- The zero-influence rule is an honesty control: current data absence and
  incompatibility reveal nothing about the student's competitiveness.
- Requiring raw `required` avoids an unsupported inference about submitting,
  withholding, or applying to a program where scores differ in relevance.

## Alternatives considered

- **Personal admission-probability model.** Rejected: there is no labeled
  applicant/outcome dataset or matching inputs for holistic review, program,
  residency, and application-plan effects.
- **Use every Profile field and every school selection label.** Rejected:
  weighted GPA has no compatible school-side convention; selection-factor
  labels are ordinal rather than calibrated coefficients; the other fields do
  not have a comparable quantitative school fact.
- **Allow optional/recommended scores to move the category.** Rejected: the
  Profile does not say whether the score will be submitted, so either direction
  would be an ungrounded inference.
- **Keep a browser-side calculation.** Rejected: it would let URL-local
  assumptions diverge from the authenticated saved Profile and duplicate a
  high-stakes rule across clients.
- **Modify `Application.list_type` from the estimate.** Rejected: a planning
  estimate is not the student's organizational choice.

## Consequences

- The API will explain only applied signals and bounded unavailable reasons;
  the frontend supplies human wording and must state that entering-class
  benchmarks are context, not cutoffs or personal odds.
- The existing normalized facts contract is frozen in
  `tests/fixtures/admissions_fit/`, including the exact GPA payload selector
  and observed test-policy enum codes. Future adapter work must consume those
  shapes rather than invent aliases or crawl fields.
- A personalized response needs Profile-aware cache invalidation and a
  Profile read that has no write side effect.
- This is a narrow Explore-card feature. It does not create general agent
  chancing, change the facts-reader grant model, or claim statistical
  calibration.

## Relationship to earlier decisions

- **Amends ADR 0031 narrowly:** the saved Profile gains a server-owned Explore
  consumer, but this does not turn the agent into a personal admission-odds
  engine.
- **Follows ADR 0017:** deterministic fit rules live in the inward pure domain
  layer; row/Profile translation remains outside it.
- **Follows ADR 0038:** only the read-only, code-typed facts-store views and
  their per-field `observed_at` semantics are used; no new ingestion path is
  introduced.
- **Follows ADR 0027:** Profile changes continue to use the existing workspace
  mutation/event path; the estimate itself performs no workspace mutation.
