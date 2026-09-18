# ADR 0040 — The Explore estimate is the admit rate, and nothing else

**Status:** Accepted — implementation complete; owner acceptance pending.

**Supersedes ADR 0039.**

## Context

ADR 0039 shipped `admissions-fit-v1`: an admit-rate baseline that the saved
Profile could then move by up to twelve percentage points, using GPA
distributions, class-rank shares, SAT/ACT bands, and the school's test policy.
It was careful — bounded adjustments, zero-influence on absent or stale
evidence, a closed vocabulary of applied signals and unavailable reasons, a
hover popover on every card explaining which comparisons ran and which did
not.

That care is what made it wrong. The machinery it took to be honest about a
±12-point nudge — a 662-line calculator, a 600-line Profile/facts adapter, a
fixed-key batch read on every page of results, release-evidence
instrumentation, two tuning scripts, ~3,300 lines of tests, an owner-scoped
response cache, Profile-change invalidation, and a card popover whose job was
to list what the estimate could *not* see — cost far more than the nudge was
worth. Worse, it was expensive in the one currency the product cannot spend:
a student reading "Adjusted using your profile" reasonably hears a personal
odds claim, and the twelve points behind it are heuristic margins, not
calibrated probabilities.

## Decision

1. The Explore card's category is a pure function of
   `school_explore.admit_rate` and nothing else: `<20` is Reach, `<50` is
   Target, otherwise Safety. A rate that is absent, non-numeric, or outside
   `[0,100]` is Unknown, and an Unknown card claims no band at all.
2. No student value is an input. The saved Profile, URL-local score
   assumptions, and the facts store's entering-class comparables have no path
   into the estimate.
3. The whole algorithm is `domain/admissions_fit.py` — one enum, one frozen
   result, one function. There is no adapter, no fact batch, no versioned
   algorithm identifier, and no adjustment table.
4. The wire result is `{category, admit_rate}`. `admit_rate` is the validated
   rate the category came from, so the badge and the figure beside it can
   never disagree. `signals`, `unavailable`, `caveats`, `basis`,
   `evidence_level`, `baseline_category`, `algorithm_version`, and the
   page-level `fit_profile_summary` are removed from the response.
5. The card shows the rate and the band, with no disclosure. There is nothing
   to explain that the number beside the badge does not already say.
6. The Explore response is identical for every authenticated reader, so its
   cache is no longer owner-scoped and a Profile write no longer invalidates
   it.

## Rationale

- Absent any information about an applicant, the school's admit rate *is* the
  honest estimate — it is the base rate, and a base rate is a statement about
  the school, not a prediction about the reader.
- A rule a student can verify by looking at the same number we do needs no
  reasoning surface. ADR 0039's popover existed to make an opaque adjustment
  legible; with the adjustment gone, the popover was explaining an argument
  that had become self-evident.
- The deletion is the point: ~5,700 lines of code and tests, one DB read per
  results page, one telemetry path, and one cache-invalidation edge all go
  away, and the honesty-critical surface shrinks to a function whose bands a
  single test file pins.

## Alternatives considered

- **Keep ADR 0039 and only hide the popover.** Rejected: it would leave a
  personalized category on the card with its explanation removed — strictly
  less honest than either endpoint.
- **Rename the bands to selectivity words** (Highly selective / Selective /
  Less selective). Rejected for now: Reach/Target/Safety is the vocabulary
  students already plan in, and printed immediately beside the admit rate it
  reads as a fact about the school. Worth revisiting if the band is ever shown
  away from its rate.
- **Recompute the category in the browser** — it is three comparisons.
  Rejected: a high-stakes classification stays server-owned and single-sourced
  (ADR 0039 carried this point and it survives).
- **Retune the thresholds.** Not attempted: 20/50 is the conventional split
  and was already the shipped baseline; changing it is a separate decision
  with its own evidence.

## Consequences

- `domain/admissions_fit/` (package), `app/facts/admissions_fit_inputs.py`,
  `counselle_db/admissions_fit_evidence.py`, the fixed-key batch executor in
  `counselle_db/service.py`, `scripts/admissions_fit_*.py`, and
  `tests/fixtures/admissions_fit/` are deleted, not parked — nothing consumed
  them but the estimate.
- The Explore route no longer reads the saved Profile, so it makes one fewer
  query per request and has no Profile-failure path.
- `Application.list_type` remains independent of the estimate, unchanged from
  ADR 0039.

## Relationship to earlier decisions

- **Supersedes ADR 0039** entirely.
- **Reverts the ADR 0031 amendment** ADR 0039 made: the saved Profile has no
  server-owned Explore consumer again.
- **Follows ADR 0017:** the rule stays in the pure `domain/` layer.
- **Follows ADR 0038:** it reads one column of one facts-store view.
