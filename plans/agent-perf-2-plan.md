# Agent speed, round 2

Follows `plans/quick-answers-plan.md`, which is merged in #23. Goal: Focused Answer that is fast
and accurate.

## Changes

1. **Compact `get_school_profile` for the model.**
   - One school's profile was ~84,000 characters. Each of its 74 rows repeated the citation,
     a provenance receipt and the snapshot caveat, so every call spilled to a read-back round.
   - Rows now carry `profile_field`, `label`, `display` and `marker`. The shared citation (its
     vintage is the identity snapshot date) and the `profile_snapshot` caveat are stated once
     at top level.
   - The result is 9,474 characters, which comes back inline.
   - Provenance never reached anything but the model, and the model cites by marker, so
     nothing downstream changes.
2. **Measure Quick `none` against `low` under the new Focused Answer contract**, on the same
   code. `none` lost three cases under the old research-heavy prompt (2026-09-30). Rule: switch
   only if `none` passes at least as many cases as `low` with no new honesty failure and a
   real latency gain.

## Not changed (owner decision)

- **The ranking denominator.** `docs/DATABASE_GUIDE.md` (the honesty spec) defines
  `fact_coverage.schools_total` as crosswalked schools (2,239). The base prompt's composition law
  and the `denominator_honesty` evals say "out of all profiled schools" (2,746). Which one is
  honest is a product call. See `TODOS.md`.

## Results (same code, 2026-09-30)

| Run | Passed | Median | p95 | Median words | Median output tokens |
|---|---:|---:|---:|---:|---:|
| Before round 1 (DeepSeek `low`) | 29 | 24.4s | 145.4s | 177 | 1,289 |
| `low` | 29 | 17.2s | 70.4s | 95 | 763 |
| `none` | 25 | 12.2s | 58.8s | 117 | 360 |

- `low` is back to the baseline's 29/37 with the latency and length gains kept.
- `none` is 5s faster at the median but loses four cases that pass at `low`: two honesty cases
  (`v3-honesty-period-unstated`, `v3-honesty-score-band-not-a-cutoff`),
  `composition-mixed-db-web` and `workspace-create-tasks`. The rule fails, so Quick stays `low`.

## Implementation notes

- A review found two bugs in the first cut, both fixed with a test:
  - An unavailable profile row carries no citation, so an "all rows share one citation" check
    dropped the profile's vintage whenever any field was missing. The citation is now taken
    from the available rows.
  - `app/steps.py` counts a profile's values by each row's `available`. The compact rows keep
    it, so the step receipt does not read "Profile data unavailable" after a successful read.
