# Admissions Fit Estimation — Implementation Plan

**Status:** Draft for owner approval
**Date:** 2026-09-15
**Scope:** The Reach / Target / Safety estimate shown on School Explore cards
**Plan location:** `plans/` until the feature is implemented, verified, and accepted; then graduate it to `specs/admissions-fit/plan/implementation-plan.md`.

## 1. Outcome

Replace the current client-only admit-rate classifier with one deterministic, versioned, server-owned estimate that:

1. always starts from the school's observed overall admit rate;
2. uses only facts already present in the CollegeData facts store and fields already present in the authenticated student's saved Profile;
3. uses an optional factor only when the two sides are genuinely comparable;
4. gives a missing, stale, incompatible, or unusable optional factor exactly zero influence;
5. falls back to the current admit-rate-only result when no personalization is usable;
6. returns `Unknown` when no valid admit rate exists;
7. explains which factors were used without presenting a fabricated personal admission probability; and
8. never changes the student's editable `Application.list_type`.

The feature can be built now. It does not depend on another crawler field, a schema migration, a model-training dataset, an LLM, web search, application outcomes, activities, essays, or future Profile work.

## 2. Binding product and honesty decisions

These decisions are part of the implementation contract, not open questions.

### 2.1 What the card is claiming

The card reports a **planning category**, not a predicted probability:

- `Reach`
- `Target`
- `Safety`
- `Unknown` when the school has no usable admit rate

The card may say “Adjusted using your profile.” It must never say “You have an X% chance,” call the result a probability, or render the internal fit index as an admission chance.

This is explicitly a conservative, non-calibrated planning heuristic. The repository has no applicant-level outcome corpus capable of estimating individual admission probability. The v1 margins are chosen to make academics primary, tests secondary, cap all movement to one nearby category boundary, and preserve a Reach floor for highly selective schools. They improve the usefulness of a coarse school-rate label; they do not establish statistical accuracy.

### 2.2 Existing data only

The calculator may read only the allowlisted fields in §4. It must not:

- browse or search for admissions data;
- invoke an LLM;
- add new crawler mappings or wait for new facts;
- read activities, honors, essays, applications, memories, documents, or chat history;
- infer gender, residency treatment, applicant type, recruited status, test-submission intent, or intended program; or
- convert free text such as `rigor_summary` into a number.

No database table, materialized projection, or Profile schema is added in this feature.

### 2.3 Admit rate is mandatory and sovereign

`school_explore.admit_rate` is the baseline. A missing or invalid admit rate produces `Unknown`; GPA, rank, and test data cannot manufacture a category by themselves.

The current cut points remain unchanged:

```text
admit rate < 20%  -> Reach
admit rate < 50%  -> Target
otherwise         -> Safety
```

This preserves today's card behavior when personalization is absent.

### 2.4 Missing data never hurts the student

Missing is not zero, weak, average, or “below range.” An optional signal that cannot be formed contributes no adjustment. This includes:

- a missing Profile field;
- a missing school fact;
- an explicitly not-reported value or distribution bucket;
- an incomplete or malformed distribution;
- an incompatible GPA scale;
- a stale optional school fact;
- a rank distribution that fails monotonicity checks; and
- a test score without a usable matching school band and applicable test policy.

An empty saved Profile therefore returns exactly the admit-rate baseline.

### 2.5 Manual list type stays independent

`Application.list_type` is an application-organization field, not an estimator field. It is neither an input nor an output of this calculator. No estimate refresh may select, create, patch, or overwrite it. Explore quick-add retains its existing `Target` default; that separate behavior is not derived from the estimate.

## 3. Current-state evidence

### 3.1 Pre-implementation evidence (historical; updated after implementation)

This subsection records the state that was inspected before the admissions-fit
implementation. It is evidence for the migration, not a description of the
current shipped code. The browser-only classifier and the URL-local student
assumption name below were removed or renamed during implementation:

- The deleted `frontend/src/features/schools/explore/classify-fit.ts` classified solely from `admit_rate`: below 20 Reach, below 50 Target, otherwise Safety.
- The pre-implementation `SchoolResultCard.tsx` ran that classifier in the browser.
- The pre-implementation `VerdictBand.tsx` displayed one test band, but the band did not affect the verdict.
- Explore's pre-implementation `StudentProfile` was URL-local and contained only home state, SAT Math, SAT EBRW, and ACT. It was not the saved Profile. The current URL-local concept is `ExploreAssumptions`, and it remains only for existing filter/cost/preview behavior; it never supplies estimator inputs.
- `GET /v1/profile` and `useProfile()` exposed the authenticated saved Profile before this feature; Explore now receives its server-owned fit summary and does not call the mutating Profile GET as an estimator input path.

### 3.2 Existing facts measured in the local read-only database

The September 15 exploration found:

| Existing fact | Rows / usable coverage |
|---|---:|
| School identity profiles | 2,746 |
| Overall admit rate | 1,761–1,762 |
| Average GPA | 1,325–1,326 |
| GPA distribution rows | 2,238 |
| GPA distributions with at least one reported bucket | 1,006 |
| Complete GPA distributions summing to 99.5–100.5% | substantially fewer; validate per row |
| SAT Math p25/p75 | 1,032 |
| SAT EBRW p25/p75 | 1,031–1,032 |
| ACT Composite p25/p75 | 1,057 |
| Complete monotonic rank top-10/top-25/top-50 set | about 909 |
| Test policy | 1,437 |

Counts are a planning snapshot, not runtime assumptions. Runtime code must validate every fact it uses.

### 3.3 Architectural gap

`school_explore` already supplies the admit rate and test bands, but not the full GPA distribution, all rank shares, or detailed test policy. Those facts already exist in `current_school_facts`; they need one fixed-key batch read for the schools on the current page. The implementation must not fetch one facts response per card.

## 4. Exact input allowlist

### 4.1 School inputs

| Input | Use |
|---|---|
| `school_explore.admit_rate` | Mandatory baseline and displayed factual rate |
| `class_profile.gpa_distribution` | Preferred academic comparison when the distribution is complete and parseable |
| `class_profile.class_rank_top_tenth` | Rank comparison fallback |
| `class_profile.class_rank_top_quarter` | Rank comparison fallback |
| `class_profile.class_rank_top_half` | Rank comparison fallback |
| `class_profile.sat_math_p25/p75` | SAT Math comparison |
| `class_profile.sat_ebrw_p25/p75` | SAT EBRW comparison |
| `class_profile.act_composite_p25/p75` | ACT comparison |
| `admissions.test_policy_sat_or_act` | Permits a test adjustment only when the existing fact says SAT/ACT is required |
| Fact-row presence and `observed_at` | Reject missing, unusable, or stale optional evidence |

The overall admit rate may come from the existing Explore projection. The remaining keys are loaded from the existing facts view.

### 4.2 Student Profile inputs

| Input | Use |
|---|---|
| `academics.gpa_unweighted` | GPA comparison |
| `academics.gpa_scale` | Compatibility gate; GPA is usable only on an explicit 4.0 scale |
| `academics.class_rank` | Student rank percentile |
| `academics.class_size` | Student rank percentile |
| `academics.school_ranks` | Explicit `false` disables rank; rank fields must otherwise be present and valid |
| `testing.sat.math` | SAT Math comparison |
| `testing.sat.ebrw` | SAT EBRW comparison |
| `testing.act.composite` | ACT comparison |
| `background.residence.state` | Existing cost-basis behavior only; never an admissions adjustment |

Profile decimal strings are parsed with `Decimal`, not binary floating-point arithmetic.

### 4.3 Explicitly excluded from the calculation

The following current fields contribute no numeric adjustment in v1:

- weighted GPA and school average GPA, because the school facts do not establish a compatible weighting convention;
- SAT total, because section percentile endpoints cannot be added to synthesize a total band;
- PSAT, AP, IB, English-proficiency, planned-test, and test-date fields, because no comparable school-side admission benchmark is present;
- grade trend, current courses, and rigor summary, because the school-side selection label is not a quantitative comparable;
- school selection-factor labels, because they are ordinal descriptions rather than calibrated coefficients and current records contain material contradictions with the accompanying benchmarks;
- gender-specific admit rates, because the Profile has no verified admissions-gender field and pronouns are not a substitute;
- intended major and the school's major list, because no program-specific admit rate exists;
- residence, citizenship, visa, first-generation, hooks, circumstances, aid, narrative, preferences, people, activities, honors, essays, and recommendations, because the present school data has no matching quantitative admit-rate comparison;
- entrance difficulty, applicants, admitted, enrolled, and yield, because they duplicate or qualitatively restate the baseline rather than personalize it; and
- graduation, cost, aid, outcomes, student-life, and campus facts, because they measure school fit or affordability, not admission likelihood.

These exclusions are intentional accuracy controls. They do not wait for new data; they define what the current data can honestly support.

## 5. Versioned algorithm: `admissions-fit-v1`

### 5.1 Pure function

```text
estimate_admissions_fit(
    school: SchoolFitInputs,
    student: StudentFitInputs,
    now: datetime,
    stale_after_days: int,
) -> FitEstimate
```

The function is pure. It accepts immutable domain DTOs, knows nothing about asyncpg, HTTP, Pydantic workspace models, React, or the facts-store row shape.

### 5.2 Validate and classify the baseline

```text
if admit_rate is missing, non-finite, < 0, or > 100:
    return Unknown(basis="missing_admit_rate")

baseline_category = category_for(admit_rate)
fit_index = admit_rate
```

The overall admit rate remains usable as the baseline when it is present but old; the response carries the school's existing facts-vintage caveat. Stale **optional** facts are skipped so old detail cannot change the baseline.

### 5.3 Form at most one academic signal

Academic signals are `strong`, `neutral`, `weak`, or `unavailable`.

#### GPA distribution, preferred

Use GPA only when:

- student `gpa_unweighted` is present;
- student `gpa_scale` is exactly 4.0;
- the school distribution is in the normalized distribution shape;
- every counted bucket has a numeric, finite, nonnegative percentage;
- there are no omitted or overlapping buckets;
- the reported percentages sum to 99.5–100.5%;
- `value_type == "distribution"` and the normalized payload has `scale == "gpa"`;
- labels/ranges are recognized, including the open-ended `4.00 and Above` bucket; and
- the fact is not stale.

For a student GPA, calculate only interval-safe cumulative bounds:

```text
below   = percentage in buckets wholly below the student's GPA
through = below + percentage in the bucket containing the student's GPA

below >= 75%   -> strong
through <= 25% -> weak
otherwise      -> neutral
```

Do not interpolate inside a bucket. Parsed bucket endpoints are inclusive exactly as printed; ranges must not overlap. If the student's GPA falls into an unparseable gap or overlapping boundary, GPA is unavailable.

#### Class rank, fallback

Use rank only when GPA did not produce a usable signal and:

- `class_rank` and `class_size` are present and valid;
- `school_ranks` is not explicitly `false`;
- all three school shares are present, finite, in 0–100, and not stale; and
- `top_tenth <= top_quarter <= top_half`.

Calculate:

```text
student_percentile = 100 * class_rank / class_size

student tier:
  <= 10 -> top 10
  <= 25 -> top 25
  <= 50 -> top 50
  else  -> lower half

school typical tier (the smallest tier containing at least half the class):
  top_tenth >= 50  -> top 10
  top_quarter >= 50 -> top 25
  top_half >= 50    -> top 50
  else              -> lower half

student tier better than school typical tier -> strong
student tier worse than school typical tier  -> weak
same tier                                  -> neutral
```

GPA and rank never stack. GPA distribution wins when valid; rank is the fallback. This avoids double-counting two views of the same academic performance.

### 5.4 Form at most one testing signal

Test signals are `strong`, `neutral`, `weak`, or `unavailable`.

A test band is valid only when both endpoints are present, finite, in the official test range, `p25 < p75`, and not stale. Compare like with like:

- SAT Math to SAT Math;
- SAT EBRW to SAT EBRW;
- ACT Composite to ACT Composite.

Never synthesize a SAT total benchmark.

For each matching score:

```text
score >= p75 -> strong
score < p25  -> weak
otherwise    -> neutral
```

Combine SAT sections conservatively:

- two usable sections produce `strong` only when both are strong and `weak` only when both are weak; every mixed result is neutral;
- one usable SAT section is incomplete and produces no adjustment; and
- no complete two-section comparison means SAT is unavailable.

Combine SAT and ACT conservatively:

- if only one test type is usable, use it;
- if both are usable and have the same non-neutral direction, use that direction;
- if they disagree, or either is neutral, the combined result is neutral;
- never select whichever test makes the result more favorable.

Apply test policy. The only estimator policy enum is `required | not_required_or_unknown`. The adapter maps normalized current-facts `value_text == "required"` to `required`; every other optional, recommended, considered-if-submitted, required-for-some, not-used, not-reported, missing, or unrecognized code maps to `not_required_or_unknown` and contributes zero. Step 0 verifies the stored code and mapper contract. This avoids inferring a submit/withhold or program decision that the saved Profile does not contain.

| Adapter result | Effect |
|---|---|
| `required` | Strong and weak complete-test signals may adjust |
| `not_required_or_unknown` | No test adjustment in either direction |

Policy normalization belongs in the app-layer adapter. For v1, only the normalized current-facts enum code `required` maps to the domain's `required`; all other codes map to `not_required_or_unknown`. Step 0 verifies that exact code against the current mapper and live fixture before implementation proceeds. The adapter must not infer a policy from marketing copy or reuse `school_explore.test_policy` without proving the mapping to the raw current fact.

### 5.5 Bounded adjustments

The v1 point table is fixed and code-owned:

| Signal | Adjustment to internal fit index |
|---|---:|
| Strong academic | +8 percentage points |
| Weak academic | -8 percentage points |
| Neutral/unavailable academic | 0 |
| Strong complete test | +4 percentage points |
| Weak complete test | -4 percentage points |
| Neutral/unavailable test | 0 |

```text
adjustment = clamp(academic_adjustment + test_adjustment, -12, +12)
fit_index = clamp(admit_rate + adjustment, 0, 100)
category = category_for(fit_index)
```

Guards:

1. If `admit_rate < 20`, the final category remains `Reach`; profile strength cannot upgrade a highly selective school.
2. The bounded adjustment cannot skip two categories.
3. Missing optional inputs add no points and subtract no points.
4. Only a non-neutral signal makes the result `personalized`; merely having data does not.

The point values are not learned probabilities. The 2:1 academic/test ratio follows the product's current evidence priority: the saved academic record is the primary comparison, while an enrolled-submitter test band is supporting context. The ±12 total cap means only schools within 12 rate points of a category boundary can change, and the sub-20 guard prevents a highly selective school from being upgraded. Any later coefficient change requires a new algorithm version, a predeclared boundary review, the complete sensitivity report, and owner approval; it is not a configuration tweak performed silently in production.

### 5.6 Required invariants

Property and example tests must prove:

- identical inputs always produce identical output;
- adding unusable, absent, or explicitly not-reported evidence changes nothing;
- removing an optional signal returns the result to the remaining-signal or baseline result;
- within one fixed signal source and availability set, a stronger comparable result cannot make the category less favorable;
- within one fixed signal source and availability set, a weaker comparable result cannot make it more favorable;
- adding a preferred GPA signal may replace rank, and adding a second complete test type may neutralize a conflicting first test; golden vectors lock both precedence rules;
- no optional evidence moves the index by more than 12 points;
- no result crosses more than one category boundary;
- a sub-20% baseline remains Reach;
- invalid school data never throws from the calculator and never becomes a student penalty;
- SAT section percentiles are never added;
- GPA and rank never both contribute points; and
- SAT and ACT are never cherry-picked.

## 6. Output contract

Add a typed `fit` object to each `ExploreSchoolCard`:

```text
FitEstimate {
  category: "Reach" | "Target" | "Safety" | "Unknown"
  baseline_category: "Reach" | "Target" | "Safety" | "Unknown"
  baseline_admit_rate: number | null
  basis: "school_rate" | "personalized" | "missing_admit_rate"
  evidence_level: "baseline_only" | "one_comparison" | "two_comparisons"
  signals: [
    {
      factor: "academic" | "testing"
      source: "gpa_distribution" | "class_rank" | "sat" | "act" | "sat_and_act"
      assessment: "strong" | "weak"
    }
  ]
  unavailable: [
    {
      factor: "academic" | "testing"
      reason: <closed reason-code enum>
    }
  ]
  caveats: [<closed caveat-code enum>]
  algorithm_version: "admissions-fit-v1"
}
```

Add one bounded page-level summary to `ExploreResponse`:

```text
FitProfileSummary {
  has_academic_candidate: boolean
  has_complete_test_candidate: boolean
  suggested_profile_fields: [<closed field-code enum>]
}
```

Contract rules:

- Do not expose the internal fit index as a probability-like field.
- Render and explain `fit.baseline_admit_rate`; do not separately display a potentially divergent `fields.admit_rate` value.
- Do not return raw Profile values merely to explain the result.
- `signals` contains only non-neutral applied signals.
- `unavailable` is bounded to one academic and one testing reason, with deterministic priority; it cannot grow with arbitrary fact rows.
- Every personalized result carries the mandatory `entering_class_benchmark_not_cutoff` caveat: GPA, rank, and test ranges describe enrolled first-years, not applicant cutoffs or personal admission odds.
- The page-level Profile summary, not per-card `basis`, controls the missing-Profile prompt. A complete but neutral Profile must not be told to add data it already contains.
- Human-facing copy stays in the frontend, keyed by the closed enums, so the API remains typed and UI wording remains one edit point.
- The exact factual admit rate remains visible separately on the card.

## 7. Architecture and data flow

```text
GET /v1/schools/explore (authenticated)
  |
  +-- app DB: read saved Profile once for user.id, return in-memory empty Profile if absent
  |
  +-- facts DB
       +-- REPEATABLE READ, READ ONLY snapshot
       |    +-- run the main Explore page statement
       |    +-- fixed-key batch read from current_school_facts for page school IDs
       +-- existing ancillary count/tail queries may run separately
  |
  +-- app/facts adapter
       +-- Profile -> StudentFitInputs
       +-- Explore row + fact bundle -> SchoolFitInputs
  |
  +-- pure domain calculator, once per returned school
  |
  +-- ExploreResponse.schools[].fit
       |
       +-- frontend renders category, factual admit rate, basis, and explanation
```

### 7.1 Layer ownership

Create:

- `domain/admissions_fit/__init__.py`
- `domain/admissions_fit/models.py` — frozen enums and input/output DTOs
- `domain/admissions_fit/calculator.py` — validation-independent pure rules and `admissions-fit-v1`
- `app/facts/admissions_fit_inputs.py` — translate saved Profile and typed fact rows into domain inputs
- `app/workspace/service_profile.py` — add a select-only `read_profile_or_empty` helper for non-Profile read surfaces

Modify:

- `counselle_db/service.py` — add one Explore-plus-fixed-facts executor that performs the main page statement and dependent batch inside one `REPEATABLE READ, READ ONLY` transaction, preserving the rule that this module is the only reader of `current_school_facts`;
- `app/facts/service_explore.py` — request the batch after the page IDs are known, calculate one fit per card, and attach it;
- `app/facts/explore_models.py` — add the typed wire result;
- `api/routes/schools_facts.py` — load the authenticated saved Profile once and pass it to `run_explore`;
- `frontend/src/api/schools/explore.ts` — mirror the wire contract;
- `frontend/src/api/workspace/hooks/profile.ts` and `frontend/src/api/workspace/events.ts` — invalidate active personalized Explore data on local/external Profile changes;
- the existing Explore components listed in §9.

The domain layer must not import `app`, `api`, `adapters`, `asyncpg`, or frontend concepts. The app-layer adapter may depend inward on domain types and sideways on existing Profile/fact response models.

### 7.2 Batch-read contract

Add a narrowly named executor such as:

```text
explore_with_admissions_fit_facts(
    catalog,
    statements: list[parameterized statement],
) -> (explore_results, mapping[unitid, tuple[FactValueRow, ...]])
```

Requirements:

- execute the main page statement first, derive page school IDs, and run the dependent fact query before committing the same `conn.transaction(isolation="repeatable_read", readonly=True)` transaction;
- preserve existing ancillary control/exclusion/tail/narrowest queries without claiming they share that snapshot; only the page rows and their fit inputs require atomic source coherence;
- return an empty mapping when the page has no rows;
- hard-code or validate against the feature's closed fact-key allowlist; do not expose HTTP- or caller-selected fact keys;
- use bound `ANY(...)` parameters;
- keep `school_explore.admit_rate` as the sole canonical v1 baseline and displayed rate, preserving exact empty-Profile behavior; an optional raw-fact mismatch audit may log a data-integrity diagnostic but must not change the baseline;
- preserve `value`, typed columns, `observed_at`, and absence semantics; and
- return an empty tuple for a school with no matching facts.

This is one additional facts query per Explore response, not one query per card. Do not add a migration or widen `school_explore_rows`.

### 7.3 Profile ownership and caching

The server, not the browser, owns the estimate. It loads the Profile by authenticated `user.id`; client-supplied GPA, rank, or score values never drive the calculation. `read_profile_or_empty` performs one plain `SELECT`, returns `Profile()` in memory when no row exists, and never inserts, locks, records a workspace change, or emits an event. Lazy Profile-row creation remains confined to the Profile surface.

The existing URL-local `home`, `satm`, `satebrw`, and `act` values are not estimate inputs. To keep this feature narrow, they remain temporarily responsible for the existing cost display and score-fit filtering; changing those behaviors is out of scope. During this change:

- Explore does **not** call `useProfile()`; otherwise the current `GET /v1/profile` would lazily insert an empty row. The server-returned `FitProfileSummary` owns the page prompt/completeness state;
- the API ignores URL-local home/scores when calculating `fit` even though the existing Explore SQL may still use them for cost/filter behavior;
- the header copy labels URL values as Explore filters/preview and states that the saved Profile powers the estimate; and
- `StudentProfile` is renamed to `ExploreAssumptions` (or an equally explicit name) so it cannot be confused with the persisted Profile;
- `VerdictBand` may use an assumption only to select which **institutional** middle-50% band is shown; it must remove the current `you {score}` wording and label the line `Explore preview — does not affect estimate`; and
- saved-Profile comparisons are explained only through the server's signal enums, without echoing raw scores.

Because Explore now varies by saved Profile:

- retain authenticated `private` caching but require revalidation (`private, no-cache`) rather than allowing a stale 60-second personalized verdict;
- add `profile` to `frontend/src/api/workspace/events.ts`'s subscribed object types; on `profile.updated`, invalidate `workspaceKeys.profile.detail()` and every `['schools', 'explore']` query;
- update `frontend/src/api/workspace/hooks/profile.ts` so a successful local Profile mutation also invalidates every Explore query; and
- while an active Explore query is refetching after either invalidation, preserve card layout but replace personalized verdict/detail content with a single `Refreshing estimate…` state so a newly displayed Profile summary is never paired with an old estimate;
- set personalized Explore's React Query `staleTime` to `0`, so remount, focus, and reconnect revalidate rather than serving a 60-second-old personalized response;
- test two users with identical school queries and different Profiles to prove cache isolation.

An empty or partially completed Profile is normal and returns the baseline. A Profile database outage is an infrastructure failure and follows the normal route error contract; it must not be silently misrepresented as an empty Profile. Capture one request-start UTC instant in `run_explore` and pass it, together with the existing `settings.facts_stale_days` value (default 120), to every adapter/calculator call so all cards apply the same existing stale boundary consistently. Do not add a second staleness setting.

## 8. Card behavior

### 8.1 Visible states

`VerdictBand` renders these states:

| Result | Visible treatment |
|---|---|
| Missing admit rate | `Not classified` and `Admit rate not available` |
| Baseline only | Category + exact admit rate + `Based on school admit rate` |
| Personalized, category unchanged | Category + exact admit rate + `Checked against your profile` |
| Personalized, category changed | Category + exact admit rate + `Adjusted using your profile` |

The explanation surface lists at most the two applied factors and may state what was unavailable. It must describe comparisons (“GPA is in the upper part of the reported entering-class distribution”), not causal certainty (“your GPA gets you admitted”).

Whenever any Profile comparison is applied, the disclosure and accessible description also say that entering-class GPA/rank/test ranges are context, not admission cutoffs or personal odds.

### 8.2 Missing Profile prompt

Show one page-level prompt, not repeated warnings on every card. Drive it from `FitProfileSummary`, not from whether the returned cards happened to have neutral comparisons:

- when every result is baseline-only because the relevant Profile inputs are absent: “Add GPA, class rank, or scores to refine these estimates.”;
- link to the existing Profile surface;
- do not block browsing; and
- do not imply completing the Profile guarantees accuracy.

### 8.3 Design and accessibility

- Preserve the existing evidence hierarchy: factual admit rate remains more prominent than the verdict word.
- Keep Reach / Target / Safety badges on the neutral `secondary` treatment required by `DESIGN.md`; Reach is not an error state and Safety is not a guarantee state.
- Extend the verdict group's accessible name with basis and applied-factor labels.
- Do not add `aria-live` to every card. One polite header-level status may announce that refreshed estimates are available after a Profile change.
- Render explicit “Not classified” / “not available” copy; never use zero, a blank, or a bare dash for missing data.
- Verify wrapping and touch behavior at 375 px, 768 px, and desktop widths.

### 8.4 Separate application list semantics

Do not change a saved application's `list_type` in this feature. Current Explore quick-add continues to create its existing `Target` default; changing that separate workflow or adding a chooser is out of scope. Add a regression test proving a recalculated estimate cannot patch an existing application, alter quick-add's current behavior, or change My List filtering.

The estimate appears on Explore cards only in v1. Reusing it on School Detail or in an agent tool is a later feature that must consume this same server-owned calculator rather than reimplementing the rules.

## 9. TDD execution plan

Each numbered step is independently reviewable and should be one focused PR/commit unless implementation reveals a smaller safe split. The order below is binding except where the dependency graph permits parallel work.

### Step 0 — Record the decision and freeze fixtures

**Files**

- Add `docs/adr/0039-admissions-fit-estimate.md` using the next actually available ADR number at implementation time.
- Update `docs/adr/README.md`.
- Add representative normalized fact fixtures under `tests/fixtures/admissions_fit/`.

**Work**

1. Record the existing-data-only scope, admit-rate sovereignty, pure calculator boundary, point table, no-probability language, no-schema decision, and separation from `Application.list_type`.
2. Recheck the exact stored fact keys and real enum spellings against `facts_sections.yaml`, mapper assets, and a read-only DB sample. The adapter's fixed key list follows the stored contract; do not rename crawler facts as part of this feature.
3. Freeze small sanitized fixtures for complete GPA distribution, partial/not-reported distribution, valid/invalid rank shares, test bands, policies, and stale observations.
4. Record the school-side GPA scale contract: the current mapper selector for the `class_profile.gpa_distribution` payload is the source heading containing “(4.0 Scale),” while the normalized payload carries `value_type="distribution"` and `scale="gpa"`. Add a mapper-contract test for that selector; reject payloads without the expected normalized type/scale.
5. Freeze the exact test-policy mapping. Only normalized `value_text == "required"` maps to the domain's `required`; every other observed or unknown enum code maps to zero adjustment.

**Exit criteria**

- ADR makes no claim of statistical calibration.
- Every fixture originates in an existing normalized shape; no invented field is introduced.
- Any mapper/reader alias mismatch is resolved in the adapter and covered by tests, not through a schema or crawl change.

### Step 1 — Pure domain calculator: RED → GREEN → REFACTOR

**Tests first**

- Add `tests/domain/admissions_fit/test_calculator.py`.
- Write the table and property tests in §10 before production code.
- Confirm the new focused test module fails because the domain implementation is absent.

**Implementation**

- Add frozen DTOs/enums in `domain/admissions_fit/models.py`.
- Add the pure calculation in `domain/admissions_fit/calculator.py`.
- Keep functions below the project size/nesting limits; isolate baseline classification, GPA, rank, testing, and output assembly.

**Exit criteria**

- Focused tests pass.
- Branch coverage for the new domain package is at least 95%; project-wide coverage remains at least 80%.
- No outer-layer imports, I/O, mutable inputs, implicit current time, or user-facing prose exists in the calculator.

### Step 2 — Fact/Profile adapter: RED → GREEN → REFACTOR

**Tests first**

- Add `tests/app/facts/test_admissions_fit_inputs.py`.
- Cover Decimal parsing, Profile omissions, absent fact rows, distribution validation, aliases, policy normalization, stale facts, and deterministic unavailable-reason priority.

**Implementation**

- Add `app/facts/admissions_fit_inputs.py`.
- Define the one fixed tuple of fact keys.
- Translate `Profile` and `FactValueRow` objects into immutable domain inputs.
- Reject malformed optional evidence locally and return reason codes; never throw away the whole card for one bad optional fact.

**Exit criteria**

- No weighted GPA or GPA average reaches the domain input.
- No absent bucket or missing fact row becomes `0%`.
- No SAT total is synthesized.
- Existing Profile validators remain the system-boundary validation source.

### Step 3 — Same-snapshot Explore/facts executor: RED → GREEN → REFACTOR

**Tests first**

- Extend the `counselle_db` service tests for bound multi-ID/multi-key reads, empty results, invalid IDs, caps, and read-only transaction behavior.

**Implementation**

- Add `explore_with_admissions_fit_facts` to `counselle_db/service.py` so the main Explore page statement and page-dependent fixed-key fact batch run inside one acquired connection and `REPEATABLE READ, READ ONLY` transaction. Preserve ancillary query orchestration separately.
- Keep SQL parameterized and code-owned.
- Return immutable rows grouped without mutating shared collections.

**Exit criteria**

- One page causes one batch detail-facts query, never N queries, inside the same repeatable-read transaction as the main page query.
- Query count is asserted in a service test.
- Transaction isolation and read-only mode are asserted, not inferred from `readonly=True`.
- Reader-role grants remain unchanged and no write SQL is introduced.

### Step 4 — Explore service and API contract: RED → GREEN → REFACTOR

**Tests first**

- Extend `tests/app/facts/test_service_explore.py` for batch assembly and per-card estimates.
- Extend `tests/api/test_schools_explore_route.py` for authenticated Profile ownership, empty Profile fallback, per-user isolation, cache headers, and error behavior.
- Add response-model serialization tests for every category/basis enum.

**Implementation**

- Add fit response models to `app/facts/explore_models.py`.
- Add and unit-test `read_profile_or_empty` in `app/workspace/service_profile.py`; load the Profile once in `api/routes/schools_facts.py` without an insert or `FOR UPDATE`.
- Pass the typed Profile to `run_explore`.
- After obtaining current page IDs, batch-read the fixed detail facts, adapt inputs, calculate, and attach `fit` to every card.
- Change the personalized route cache header to `private, no-cache`.

**Exit criteria**

- The same school query returns Profile-specific fit objects only for the authenticated owner.
- A first-time Explore request does not create a `counselle.profiles` row or emit a workspace event.
- Empty Profile + valid admit rate exactly matches the legacy category.
- Missing admit rate always returns `Unknown` even when every other fact exists.
- An optional malformed/stale fact degrades one signal, not the entire Explore response.
- No route accepts GPA/rank as client-controlled estimator inputs.

### Step 5 — Frontend contract and saved-Profile source: RED → GREEN → REFACTOR

**Tests first**

- Update Explore API parsing tests for the typed `fit` object.
- Update `useExploreFilters.test.tsx` to prove URL-local score/home assumptions still serve their existing filter/cost/preview behavior but never override the server estimator.
- Add local Profile-mutation and `profile.updated` SSE invalidation tests.

**Implementation**

- Update `frontend/src/api/schools/explore.ts`.
- Update `frontend/src/features/schools/explore/explore-types.ts`.
- Remove category computation from `classify-fit.ts`; retain only genuinely shared display helpers or delete the module when unused.
- Render header completeness from `ExploreResponse.fit_profile_summary`; do not call `useProfile()` from Explore.
- Rename the URL-local `StudentProfile` concept to `ExploreAssumptions`; keep its existing cost/filter behavior and make its non-estimator role explicit in copy and types.
- Update `frontend/src/api/workspace/hooks/profile.ts` and `frontend/src/api/workspace/events.ts` to invalidate Profile/Explore after local and external Profile updates.
- Expose the active Explore query's refetch state and suppress stale personalized verdict/details until the matching response arrives.
- Set `useExplore`'s `staleTime` to `0` and test remount/focus/reconnect revalidation.

**Exit criteria**

- The browser renders the server category verbatim.
- There is one saved Profile source of truth for the estimate; URL-local assumptions remain explicitly separate filter/cost inputs.
- Existing score-fit filtering and cost behavior are regression-tested as unchanged.
- Institutional score-band preview no longer labels URL-local values as the student's saved score and explicitly says it does not affect the estimate.
- A profile update refreshes cards without a hard reload.
- Neither a direct mutation nor an SSE update briefly presents an old estimate as if it used the newly displayed Profile.

### Step 6 — Card explanation, accessibility, and list separation: RED → GREEN → REFACTOR

**Tests first**

- Update `SchoolResultCard.test.tsx` for all four visible states.
- Update `explore-a11y.test.tsx` for neutral badges, accessible basis/factors, explicit absence, and one page-level status.
- Add regression coverage proving fit changes never write or derive `Application.list_type`.

**Implementation**

- Update `SchoolResultCard.tsx`, `VerdictBand.tsx`, `ExploreResultsHeader.tsx`, and `ExplorePanel.tsx`.
- Add the one page-level missing-Profile prompt.
- Keep explanations compact and map closed reason codes to frontend-owned copy.
- Render the mandatory entering-class-benchmark caveat in the disclosure and accessible description for every personalized result.

**Exit criteria**

- Exact admit rate remains prominent.
- No percentage chance or internal index is rendered.
- No card-level live-region storm.
- Missing and stale states use the design system's established honesty vocabulary.
- Mobile cards have no clipped actions, labels, or explanations.

### Step 7 — Agent/docs consistency and final verification

**Files**

- Update `skills/chancing/SKILL.md` so it distinguishes this code-owned card estimate from an individualized admission probability and uses the same category boundaries when referring specifically to the card.
- Update `docs/ARCHITECTURE.md` with the pure calculator and two-database read flow.
- Update `docs/DATABASE_GUIDE.md` with the fixed-key batch read and the distribution/staleness rules.
- Add `scripts/admissions_fit_sensitivity.py` and `scripts/admissions_fit_benchmark.py` with hermetic unit tests for their deterministic report/argument logic.
- Update this plan with an implementation divergence and verification record; graduate it only after owner acceptance.

**Verification**

1. Run the focused backend and frontend suites after each step.
2. Run the full routine suite, lint, type-check, and frontend suite in §12.
3. Generate the reproducible current-data sensitivity report in §11 without writing production data.
4. Use the browser E2E runner for the scenarios in §10.5 at 375 px, 768 px, and desktop; run `jest-axe` on the rendered card/header states; inspect the real browser accessibility tree; and retain one manual VoiceOver/Safari or NVDA/Firefox reading-order check as an owner-acceptance artifact.
5. Run code review, TypeScript/Python review, security review of auth/cache isolation, and accessibility review; resolve all Critical/High findings.

**Exit criteria**

- All automated gates pass with at least 80% project coverage.
- The current-data sensitivity gates pass.
- Browser artifacts prove the baseline, personalized, unknown, missing-Profile, and Profile-refresh paths.
- Docs, skill language, API, calculator, and card use one category vocabulary.
- Owner explicitly accepts the visible behavior before the plan moves into `specs/`.

## 10. Required test matrix

### 10.1 Golden algorithm vectors

| Case | Expected |
|---|---|
| Null/invalid admit rate, complete Profile | Unknown; no adjustment |
| 19.9% rate, empty Profile | Reach; school-rate basis |
| 20% rate, empty Profile | Target; school-rate basis |
| 50% rate, empty Profile | Safety; school-rate basis |
| 35% rate, strong academic only | 8-point internal movement; still Target; personalized |
| 35% rate, weak academic only | -8; still Target; personalized |
| 45% rate, strong academic + strong complete test | +12; Safety |
| 55% rate, weak academic + weak complete test | -12; Target |
| 19% rate, strongest profile | Reach because of selective-school guard |
| 4.0-scale GPA vs complete distribution | Interval-safe GPA result |
| 5.0-scale GPA vs 4.0 distribution | GPA unavailable; fallback rank or baseline |
| Weighted GPA only | GPA unavailable |
| Partial 68.4% distribution | GPA unavailable; fallback rank or baseline |
| Explicit not-reported buckets | Never counted as zero |
| Non-monotonic rank shares | Rank unavailable |
| SAT Math strong + EBRW weak | Neutral SAT |
| One strong SAT section only | Testing unavailable; zero |
| SAT and ACT disagree | Neutral testing |
| Required policy + strong complete SAT | +4 test movement |
| Required policy + weak complete SAT | -4 test movement |
| Optional/recommended/considered policy + strong test | Zero |
| Optional/recommended/considered policy + weak test | Zero |
| Missing/unrecognized policy + any test | Zero |
| Stale optional facts | Zero; stale caveat |
| Rigor/current courses only | Exact rate-only baseline |
| GPA exactly on a printed bucket endpoint | Included in that bucket; overlapping endpoints reject the distribution |
| Score exactly at p25 | Neutral |
| Score exactly at p75 | Strong |
| Complete neutral Profile inputs | Baseline category without missing-Profile prompt |
| Valid GPA added after usable rank | GPA replaces rank deterministically |

### 10.2 Property tests

Use Hypothesis to generate bounded valid inputs and prove every invariant in §5.6, especially source-scoped monotonicity, the ±12 cap, one-category maximum movement, and exact unusable/missing-data fallback. Add separate examples showing that a preferred GPA may replace rank and a second, conflicting complete test type may neutralize the first; those are precedence changes, not monotonicity failures.

### 10.3 Adapter/data-contract tests

- every allowlisted fact type and absence state;
- actual normalized distribution payload shape;
- real policy enum spellings;
- malformed JSON, percentages, and ranges;
- old and future `observed_at` values;
- Decimal parsing and boundary values;
- rank values exactly at 10%, 25%, and 50%; and
- school fact key aliases found during Step 0, if any.

### 10.4 API/integration tests

- one select-only Profile read per request and zero Profile writes/locks/events;
- one fixed-key fact batch per result page;
- the main page row and dependent batch share one explicitly asserted `REPEATABLE READ, READ ONLY` transaction/snapshot;
- two authenticated users receive their own estimates;
- URL query assumptions can retain existing filter/cost behavior but cannot impersonate or override the saved Profile used for `fit`;
- empty Profile gets baseline categories;
- Profile DB failure follows the normal error envelope;
- malformed optional school fact does not fail the page;
- private revalidating cache headers are present; and
- serialized enums and nullable values match the TypeScript contract.

### 10.5 Browser scenarios

1. Empty Profile: cards load with rate-based labels and one Profile-completion prompt.
2. Complete comparable Profile: applicable cards explain which factors were used.
3. Local Profile edit and externally emitted `profile.updated`: active Explore shows `Refreshing estimate…`, then recomputed cards without a hard reload or a stale Profile/estimate pairing.
4. School without admit rate: explicit Not classified state.
5. School with partial/stale optional facts: baseline remains, explanation stays honest.
6. Existing URL-local score-fit and cost assumptions remain functional and are visibly distinct from saved-Profile estimation.
7. Keyboard navigation, `jest-axe`, browser accessibility-tree inspection, and one manual AT/browser reading-order check through verdict explanations.
8. Mobile/tablet/desktop wrapping with long school names and two factor labels.
9. Add School: the existing Target quick-add default is unchanged, and later estimate refreshes never mutate the application list type.

## 11. Current-data sensitivity gate

The repository has no applicant outcome corpus, so this feature cannot honestly claim empirical probability calibration. Before rollout, run a deterministic, read-only sensitivity analysis using only current school facts and synthetic low/middle/high valid Profiles.

Step 7 adds `scripts/admissions_fit_sensitivity.py`. One read-only invocation exports a sanitized calculator-input snapshot plus `manifest.json` and `report.md` under `artifacts/admissions-fit/<UTC timestamp>/`. The manifest records the script/algorithm version, explicit `--as-of` UTC instant used for all stale checks, fixed fact-key list, source row count, SHA-256 of the input export, and the three exact synthetic Profiles:

| Fixture | GPA/rank | Tests |
|---|---|---|
| `low-v1` | unweighted 2.75/4.0; rank 75 of 100 | SAT 450/450; ACT 18 |
| `middle-v1` | unweighted 3.50/4.0; rank 25 of 100 | SAT 600/600; ACT 26 |
| `high-v1` | unweighted 4.00/4.0; rank 1 of 100 | SAT 800/800; ACT 36 |

These fixtures test the rule surface; they do not represent real students or population quantiles. Re-running against the exported input snapshot and manifest must reproduce the report byte-for-byte apart from an explicitly excluded generation timestamp.

The report records:

- coverage by basis: Unknown, admit-rate-only, academic-only, test-only, both;
- category transition counts by baseline band;
- reasons auxiliary data was rejected;
- GPA distribution and rank validation failure counts;
- test-policy gating counts;
- examples nearest the 20 and 50 boundaries; and
- monotonicity/invariant failures, which must be zero.

Release gates:

- no sub-20% school upgrades from Reach;
- no estimate skips a category;
- no missing/invalid/stale input changes a category;
- no school receives different results from identical normalized inputs;
- every changed estimate has a baseline within the mathematically possible adjustment window (12 rate points) of the crossed threshold;
- every changed-category row has a traceable non-neutral signal and the mandatory entering-class benchmark caveat; and
- the owner reviews every changed-category row for `middle-v1` plus deterministic boundary samples for `low-v1` and `high-v1` before enabling personalized cards.

The analysis is a release artifact, not a new runtime dependency or a source of student data. If a gate fails, fix the algorithm and increment its pre-release version; do not weaken the gate silently.

## 12. Verification commands

```bash
# Focused backend tests while implementing
uv run pytest tests/domain/admissions_fit tests/app/facts/test_admissions_fit_inputs.py tests/app/facts/test_service_explore.py tests/api/test_schools_explore_route.py

# Routine backend suite and coverage
uv run pytest -m "not live_llm and not live_search and not live_db" --cov --cov-report=term-missing

# Backend static checks
uv run ruff check .
uv run mypy .

# Frontend contract, component, integration, and accessibility tests
cd frontend && npm run typecheck && npm test
```

No live LLM or live-search test is necessary. A live read-only DB check is useful for the Step 0 fixture/coverage audit and sensitivity report, but the calculator and CI suite must remain hermetic.

## 13. Dependency graph and safe parallelism

```text
Step 0 ADR + fixtures
        |
        +------> Step 1 pure calculator ------+
        |                                      |
        +------> Step 2 adapter ---------------+--> Step 4 service/API
        |                                      |           |
        +------> Step 3 snapshot executor ------+           v
        |                                             Step 5 frontend contract
        |                                                     |
        +-----------------------------------------------------v
                                                    Step 6 card/a11y
                                                            |
                                                            v
                                                    Step 7 verification/docs
```

After Step 0 freezes the contract, Steps 1 and 3 can run in parallel. Step 2 can begin its pure payload parsing in parallel but cannot finalize until Step 1 DTOs exist. Frontend rendering fixtures can begin after the Step 4 response model is frozen; frontend request integration waits for Step 4.

Every worker owns disjoint files, must preserve unrelated dirty-worktree changes, and must not revert another worker's edits.

## 14. Rollout and observability

### 14.1 Rollout

1. Ship the backend first with required `fit`; the old frontend ignores the additive field.
2. Verify the production response contract, then ship the frontend consuming required `fit` and remove the local category calculation.
3. Do not dual-run two visible verdicts. In non-production tests, a shadow assertion may compare empty-Profile output against the legacy classifier.
4. Record `algorithm_version` in the response; do not persist per-user estimates.

Rollback order is the reverse: restore the old frontend classifier first, then roll back the backend field. The new frontend never deploys against a backend whose `fit` contract has not been verified.

### 14.2 Metrics/logging

Emit exactly one aggregate, non-identifying `admissions_fit_explore_observed`
structured event per Explore request, on success or failure. Its fields are:

- `outcome`;
- `basis_counts` and `category_counts`;
- `applied_signal_counts`;
- `unavailable_reason_counts`;
- `validation_failure_counts` and `fact_row_drop_counts`; and
- `batch_query_latency_ms` and `total_explore_latency_ms`.

Source-validation diagnostics are recorded before estimate assembly and survive a
safe fallback, such as rank replacing an invalid GPA distribution. Do not log
school-row identifiers, user identifiers, GPA, rank, class size, student test
scores, full Profile JSON, or per-row input/output traces. Use the existing
request context for operational correlation without adding profile contents.

Step 7 also adds `scripts/admissions_fit_benchmark.py`. Measure 20 warmed requests for page sizes 1, the configured default, and the configured maximum against the same local read-only snapshot, before and after fit assembly. Retain raw timings beside the sensitivity report. The p95 latency increase must remain below the explicit 100 ms interaction budget, and the asserted SQL statement/transaction count must remain constant with page size.

## 15. Rollback

Rollback is code-only because there is no migration and no stored estimate.

1. Frontend rollback: render the existing admit-rate classifier if the deployed backend predates the additive `fit` field.
2. Backend rollback: remove fit assembly and its batch read; the original Explore row contract remains otherwise intact.
3. Do not roll back or modify Profile data, school facts, application list types, or crawler state.
4. If production validation failures spike, roll back the personalized backend release after restoring the old frontend as above. Continue serving the proven admit-rate classifier; do not invent an undeclared runtime flag or return stale personalized results.

## 16. Risk register

| Risk | Prevention / gate |
|---|---|
| Users read Safety as a guarantee | Planning-category copy, exact admit rate prominence, neutral badge, no probability |
| Arbitrary personalization masquerades as accuracy | Small versioned point table, only comparable inputs, sensitivity and property gates |
| Missing data penalizes a student | Unavailable always zero; golden/property tests |
| GPA scales are incomparable | Explicit unweighted 4.0 gate; no weighted/average fallback |
| Enrolled-student bands are mistaken for admit cutoffs | Conservative comparisons and explanatory caveat; no probability claim |
| Test optionality makes a weak score misleading | Policy-aware asymmetric handling; no inferred submission choice |
| GPA and rank double-count academics | One academic signal; GPA first, rank fallback |
| SAT and ACT are cherry-picked | Agreement rule; never choose favorable test |
| Raw fact irregularities change categories | Strict distribution/rank/band validation and stale gating |
| One request makes N facts calls | Fixed-key multi-school batch; asserted query count |
| User A receives User B's estimate | Authenticated server-side Profile load, private revalidation, isolation tests |
| Profile edit leaves stale cards | React Query/event invalidation and no-cache response |
| Estimate overwrites manual list | No workspace write path; explicit regression test |
| Agent and card use conflicting language | ADR/docs/chancing-skill consistency pass |
| Rules silently drift | `algorithm_version`, golden vectors, coefficient change requires version bump |

## 17. Definition of done

The feature is complete only when all are true:

- [x] Empty/missing optional Profile fields reproduce the current admit-rate category exactly.
- [x] Missing admit rate returns Unknown regardless of Profile completeness.
- [x] Only the school/Profile allowlists in §4 can affect the result.
- [x] GPA, rank, tests, policies, absence, and staleness follow §5 exactly.
- [x] A sub-20% school cannot be upgraded out of Reach.
- [x] The internal adjustment is bounded to ±12 and is never shown as probability.
- [x] Explore performs one saved-Profile read and one fixed-key school-facts batch, not per-card reads.
- [x] Server and frontend share one typed fit contract; the browser does not recalculate.
- [x] URL-local pseudo-profile values no longer override saved Profile data.
- [x] `Application.list_type` remains outside the estimator and is never derived from it.
- [x] Backend/frontend automated suites pass with at least 80% project coverage.
  Automated evidence now passes: backend 2,367 passed/270 deselected, frontend
  1,280 passed across 127 files, and coverage is 80.0763%. The former
  suite-order `TasksLayout.test.tsx` browser-state issue was resolved test-only by
  `6093885`; no product behavior changed.
- [x] Current-data sensitivity gates pass and the report is retained with implementation evidence.
- [ ] Real-browser mobile, keyboard, and screen-reader-visible states are verified.
- [x] ADR, architecture, database guide, and chancing skill agree with shipped behavior.
- [x] Critical/High review findings are resolved.
- [ ] Owner accepts the visible copy and behavior before the plan graduates to `specs/`.

The checked items are machine-proven by the automated suites, deterministic
sensitivity report/replay, code and contract inspections, and recorded review
evidence. Real-browser/mobile/keyboard/screen-reader verification and owner
acceptance remain intentionally open; this plan therefore stays in `plans/`.

## 18. Exploration record

This plan was grounded in five parallel read-only Luna explorations on 2026-09-15:

1. school fact keys, normalized semantics, live coverage, and data hazards;
2. saved Profile models, validators, persistence, and current Explore disconnect;
3. deterministic algorithm alternatives and boundary vectors;
4. card/API/UI, accessibility, and manual-list behavior; and
5. domain/app/database placement, batching, caching, ADR constraints, and verification seams.

The subsequent Terra review rounds and their dispositions are recorded below before owner handoff.

## 19. Terra review log

### Round 1 — 2026-09-15 — Iterate

Five independent Terra reviews covered algorithm honesty, architecture/data access, frontend/a11y, test executability, and adversarial product risk. Material dispositions:

| Finding | Disposition |
|---|---|
| Optional-score logic inferred favorable submission intent | Fixed: only a proven required policy permits test movement; every optional/unknown policy is zero in both directions |
| Incomplete one-section SAT could move the category | Fixed: incomplete SAT is unavailable and contributes zero |
| `get_profile` writes and locks on first read | Fixed: plan adds select-only `read_profile_or_empty`; Explore creates no Profile row/event |
| Page and dependent fact batch could observe different snapshots | Fixed: the main page row and its fit-fact batch share one explicit `REPEATABLE READ, READ ONLY` transaction; ancillary counts keep their existing orchestration |
| Current test-policy vocabulary was not frozen | Fixed: Step 0 freezes actual raw values; domain receives only `required | not_required_or_unknown` |
| “Missing-data monotonicity” contradicted GPA precedence and cross-test disagreement | Fixed: invariant narrowed; explicit replacement/conflict vectors added |
| Coefficients and 15% sensitivity threshold lacked calibration/rationale | Fixed: plan calls the output a non-calibrated heuristic, explains the 2:1/cap choices, removes the arbitrary percentage gate, and requires owner boundary review |
| Profile SSE events are not currently subscribed in the frontend | Fixed: `events.ts` and local mutation invalidation are explicit work with cross-tab tests |
| Old estimate could appear beside newly refreshed Profile data | Fixed: personalized content is suppressed behind `Refreshing estimate…` during invalidation/refetch |
| Missing-Profile prompt could mislabel a complete neutral Profile | Fixed: bounded page-level Profile capability summary owns the prompt |
| Plan contradicted current Target quick-add behavior | Fixed: quick-add stays unchanged; only non-mutation of existing list type is promised |
| URL-local filter/cost controls were pulled into an unnecessary migration | Fixed: they remain scoped to existing filter/cost/preview behavior and cannot affect server fit |
| Backend/frontend version-skew strategy contradicted required `fit` | Fixed: backend-first additive deploy and reverse-order rollback are explicit |
| Entering-class benchmarks could look like admissions cutoffs | Fixed: personalized estimates require a visible and accessible benchmark-not-cutoff caveat |
| Sensitivity/performance gates were not reproducible | Fixed: named scripts, exact synthetic fixtures, snapshot manifest/hash, fixed `as-of`, report location, iterations, and gates are specified |

### Round 2 — 2026-09-15 — Iterate

Four fresh Terra gates re-read the corrected plan against the repository. Material dispositions:

| Finding | Disposition |
|---|---|
| `readonly=True` defaults to READ COMMITTED and did not guarantee one snapshot | Fixed: the main page row and dependent fit bundle now require and test `REPEATABLE READ, READ ONLY`; ancillary Explore queries are not falsely included in that promise |
| Explore calling `useProfile()` would still lazily create an empty Profile row | Fixed: Explore consumes the response's `FitProfileSummary` and never calls the mutating Profile GET |
| URL-local `you {score}` could contradict the saved score used by the estimate | Fixed: the band is institutional preview context, never labels the assumption as the saved student score, and explicitly does not affect the estimate |
| React Query's 60-second `staleTime` contradicted immediate personalized revalidation | Fixed: `staleTime: 0` plus mutation/SSE/remount/focus/reconnect tests |
| Raw and projected admit-rate precedence could change empty-Profile behavior | Fixed: `school_explore.admit_rate` is the sole v1 baseline/display rate; raw mismatch is diagnostic only |
| Proposed per-fact absence semantics were not available from `current_school_facts` | Fixed: row presence/absence and payload absence are used; no unsupported per-fact state is claimed |
| GPA payload does not carry a numeric `4.0` field | Fixed: runtime validates distribution/`scale="gpa"`; Step 0 locks the existing mapper's “(4.0 Scale)” source-heading contract |
| Staleness source was implicit | Fixed: all cards receive one request-start UTC and existing `settings.facts_stale_days`; no new setting |

### Round 3 — 2026-09-15 — Approved

Three final independent Terra gates reviewed algorithm/product behavior, architecture/executability, and the full cold-start plan. One remaining contradiction was found and corrected before re-review: §2.5 had said Add School required an explicit list choice even though the actual scoped decision preserves Explore's existing `Target` quick-add default. The final wording keeps `Application.list_type` entirely outside the estimator without changing quick-add.

Final verdicts:

- Algorithm/product gate: **APPROVE** — no Critical/High findings.
- Architecture/executability gate: **APPROVE** — no Critical/High findings after the list-type wording correction.
- Holistic cold-start gate: **APPROVE** — no Critical/High findings.

## 20. Implementation / divergence / verification record

**Status:** Implementation complete; owner acceptance pending. This plan remains in `plans/`. Owner acceptance is pending and
no plan file has been moved to `specs/`.

### Phase 7 evidence tooling and consistency pass — 2026-09-15 (historical; superseded)

**Commit:** `dd61daf11115e26cfb8ea8bcb2ea629375a23f35` — `feat: harden admissions fit rollout`.
Phase 7 is committed; the feature's other phases and their review gates remain
documented in the shared worktree.

The feature implementation itself is present in these shipped commits, including
the committed Phase 7 record:

- `7a483c1e` — freeze admissions-fit data contracts
- `156bfbbd` — add the admissions-fit calculator
- `0ac1345d` — adapt Profile and school fit inputs
- `309958a3` — batch admissions-fit facts consistently
- `b776c7e3` — serve Profile-based admissions fit
- `74db050f` — consume Profile-based fit in Explore
- `179e74cd` — explain admissions-fit estimates
- `dd61daf11115e26cfb8ea8bcb2ea629375a23f35` — feat: harden admissions fit rollout

**Implemented:**

- `scripts/admissions_fit_sensitivity.py` exports a content-addressed, sanitized
  `SchoolFitInputs` snapshot, a manifest, and a deterministic report. It uses the
  exact fixed eleven-key set and `school_explore.admit_rate`, uses only the three
  named synthetic profiles, requires explicit `--as-of`, pins
  `facts_stale_days`, and rejects a replay whose input hash, as-of, algorithm,
  fixed-key list, or synthetic fixtures differ. The exported snapshot contains no
  real student Profile, student scores, or PII; it is school-side domain input only
  and includes the existing school SAT/ACT p25/p75 bands.
- Both scripts consume narrow `counselle_db.service` evidence APIs rather than
  carrying `current_school_facts` SQL. The sensitivity exporter receives only the
  fixed eleven-key rate/fact snapshot. The benchmark imports the service-owned,
  locally exported snapshot and receives instrumented statement/transaction receipts
  from the actual fixed request-shape seam; no script supplies SQL, fact keys, or
  school IDs to that seam.
- `scripts/admissions_fit_benchmark.py` runs one warm-up plus 20 before/after
  request-shaped measurements for page sizes 1, configured default, and configured
  maximum. Each measured request imports one DB-exported
  `REPEATABLE READ, READ ONLY` snapshot; before/after measurements therefore share
  the benchmark's one local snapshot. It records all raw timings and measured logical
  query/transaction receipts and fails if the expected `1/2/1/1` receipt shape or the
  `<100 ms` p95 incremental budget is not met.
- Hermetic argument, canonical-snapshot, manifest/replay, report-field, exact-fixture,
  GPA/rank invalid-or-stale fallback parity, p95, timing-retention, query-count, pool
  preflight, and budget tests are in
  `tests/scripts/test_admissions_fit_sensitivity.py` and
  `tests/scripts/test_admissions_fit_benchmark.py`.
- `skills/chancing/SKILL.md`, `docs/ARCHITECTURE.md`, and
  `docs/DATABASE_GUIDE.md` now distinguish the code-owned card heuristic from a full
  chancing judgment/probability; record exact card boundaries and guards; describe the
  separate select-only application-Profile and facts-store reads; state the fixed
  batch, staleness, distribution, test-policy/no-SAT-composite rules; preserve manual
  application-list separation; and limit observability to aggregate,
  non-identifying counters.

**Intentional evidence-tooling divergence:** The sensitivity input file captures the
immutable *post-adapter* `SchoolFitInputs` DTO rather than raw fact JSON. That makes an
offline replay byte-identical without retaining arbitrary crawler presentation content
or any student data. Capture still runs the production adapter against the fixed raw
fact-key set, so duplicate/malformed/missing facts receive the same unavailable/zero
influence semantics before the DTO is frozen. The benchmark proves same-snapshot
before/after behavior using its own exported PostgreSQL snapshot; it is explicitly an
independent database snapshot from a prior sensitivity process, not a false
cross-process snapshot claim. The report deliberately imports the calculator's two
private source-validation helpers as a documented non-wire release-analysis parity
seam: it counts a bad GPA source even when a valid rank safely replaces it (and vice
versa), without changing the response contract or duplicating calculator validation.

**Historical read-only artifacts (superseded by the final record below):**

- `artifacts/admissions-fit/20260915T062158Z/input.json`
- `artifacts/admissions-fit/20260915T062158Z/manifest.json` — input SHA-256
  `5b31fcd8dc57317365346509129546bbd627350bd5c8f8fe7c1895f58468fccd`, 2,239
  school-side input rows, 12,692 fixed-key fact rows, as-of
  `2026-09-15T06:21:58Z`.
- `artifacts/admissions-fit/20260915T062158Z/report.md` — every automated
  sensitivity/nullification invariant passes; the manual owner review remains
  pending. The report records 58 nullification checks, 0 mismatches, and 0
  discriminating-control failures.
- `artifacts/admissions-fit/20260915T062158Z-replay/report.md` — byte-identical to
  the source report (`cmp` exit 0), replayed from the same input hash.
- `artifacts/admissions-fit/20260915T062158Z/benchmark.json` — p95 incremental fit
  costs were 1.149 ms (size 1), 11.922 ms (size 24/default), and 34.762 ms
  (size 100/max), all below 100 ms; every measured receipt was baseline 1 SELECT / 1
  transaction and with-fit 2 SELECTs / 1 transaction.

The sensitivity artifact is deliberately school-side only: it contains no real
student Profile, real student score, workspace/user data, or PII. It does include
the schools' existing SAT/ACT p25/p75 bands because those are allowlisted school
facts used by the adapter. The three synthetic Profiles are fixtures only.

**Executed evidence:**

```text
uv run pytest tests/scripts/test_admissions_fit_sensitivity.py tests/scripts/test_admissions_fit_benchmark.py -q
# 16 passed
uv run pytest tests/counselle_db/test_service.py tests/scripts/test_admissions_fit_sensitivity.py \
  tests/scripts/test_admissions_fit_benchmark.py -q
# 64 passed
uv run ruff check scripts/admissions_fit_sensitivity.py scripts/admissions_fit_benchmark.py \
  tests/scripts/test_admissions_fit_sensitivity.py tests/scripts/test_admissions_fit_benchmark.py \
  counselle_db/service.py tests/counselle_db/test_service.py
# passed
uv run mypy scripts/admissions_fit_sensitivity.py scripts/admissions_fit_benchmark.py \
  counselle_db/service.py
# passed
uv run python scripts/admissions_fit_sensitivity.py --as-of 2026-09-15T06:21:58Z \
  --output-dir artifacts/admissions-fit/20260915T062158Z
# exit 0
uv run python scripts/admissions_fit_sensitivity.py --as-of 2026-09-15T06:21:58Z \
  --snapshot artifacts/admissions-fit/20260915T062158Z/input.json \
  --manifest artifacts/admissions-fit/20260915T062158Z/manifest.json \
  --output-dir artifacts/admissions-fit/20260915T062158Z-replay
cmp -s artifacts/admissions-fit/20260915T062158Z/report.md \
  artifacts/admissions-fit/20260915T062158Z-replay/report.md
# both exit 0
uv run python scripts/admissions_fit_benchmark.py \
  --artifact-dir artifacts/admissions-fit/20260915T062158Z
# exit 0
uv run pytest tests/domain/admissions_fit tests/app/facts/test_admissions_fit_inputs.py \
  tests/app/facts/test_service_explore.py tests/api/test_schools_explore_route.py -q
# 146 passed
uv run ruff check . && uv run mypy .
# passed (385 source files)
cd frontend && npm run typecheck
# passed
cd frontend && npx vitest run src/api/schools/explore.test.tsx \
  src/api/workspace/events.test.tsx src/api/workspace/hooks/profile.test.tsx \
  src/features/schools/explore/explore-a11y.test.tsx \
  src/features/schools/explore/SchoolResultCard.test.tsx \
  src/features/schools/explore/ExplorePanel.test.tsx \
  src/features/schools/explore/useExploreFilters.test.tsx
# 56 passed
uv run pytest -m "not live_llm and not live_search and not live_db" -q
# 2,367 passed, 270 deselected (37.49s, exit 0)
# Final logging fix: test-only capture/rebind/state restoration; production logging
# unchanged.
cd frontend && npm test -- --run
# exit 0: 1,280 passed across 127 files (126.04s)
# Suite-order TasksLayout browser-state isolation was resolved test-only by
# 6093885; no product behavior changed.
cd frontend && npx vitest run src/features/tasks/TasksLayout.test.tsx --run
# 5 passed
uv run ruff check . && uv run mypy .
# both passed globally
```

**Coverage status:** the post-hardening routine measurement is **80.07629427792915%**
(displayed as 80%), with 17,715 of 21,423 statements and a branch-aware aggregate
of **80.0763%**. The project-wide 80% coverage gate is therefore met. Test-only
coverage hardening is recorded by commits `515f378` (Wave 1), `ec83cba` (Wave 2),
and `da0cc001` (Wave 3); these changes do not alter production behavior. The
previous 72.08% measurement and its proposed divergence are historical and
superseded.

**Automated browser-matrix evidence:** the broad responsive and accessibility
matrix is complete as a real Chromium run with mocked/intercepted API responses.
That matrix's authoritative report is
[artifacts/admissions-fit/20260915T062158Z/browser/REPORT.md](../artifacts/admissions-fit/20260915T062158Z/browser/REPORT.md).
It proves pointer click and focus+Enter disclosure behavior, refresh suppression
while personalized data is revalidated, one quick-add POST with `list_type=Target`
and no PATCH requests, no horizontal overflow at 375/768/1440 px, a 44 px
minimum coarse-pointer target, and the expected ARIA/accessibility-tree state.
This matrix alone does **not** prove live backend, authentication, database, or
persistence behavior, and it makes no VoiceOver/NVDA claim. Complementary real
local-stack evidence is recorded below.

**Implementation divergence/regression recorded by browser QA:** the school-link
overlay initially intercepted the estimate disclosure. The fix is the estimate
container's `relative z-10` stacking context. This is retained as a regression
note and must remain covered by the browser hit-target assertion.

**Review disposition:** the final Terra reproducibility review approved the corrected
evidence scripts, tests, documentation, and record. Its initial direct-reader,
precedence-hidden validation-count, self-reported benchmark-count, one-connection-pool,
and static-check findings were resolved before the current artifact was generated.

**Still required before completion:** the project-wide 80% coverage DoD item and
the frontend automated-suite gate are met by the evidence recorded above. The
former suite-order `TasksLayout.test.tsx` browser-state issue was resolved
test-only by `6093885`; no product behavior changed. The actual VoiceOver/Safari
or NVDA/Firefox reading-order check remains pending despite the completed
automated/mock browser matrix. Owner review of every
`middle-v1` changed-category row, the deterministic low/high boundary samples, and
the visible changed-row/copy wording is still required before enabling personalized
cards. No owner acceptance or off-workstation copy/backup acceptance is claimed by
this record. The plan remains ungraduated in `plans/`.

### Phase 7 final backend hardening and evidence record — 2026-09-15

This is the authoritative Phase 7 record. The earlier 06:21:58Z artifact and any
intermediate 12:10:00Z record are historical and superseded; they are retained only
for audit history. Phase 7 is committed in
`dd61daf11115e26cfb8ea8bcb2ea629375a23f35` (`feat: harden admissions fit rollout`),
and the plan remains in `plans/` pending owner acceptance.

Post-Phase-7 verification provenance is limited to the admissions-fit work: commit
`42aab2e` is the initial verification record, commit `7036958` adds the neutral-GPA/
rank-precedence regression coverage, and commit `2437eae` records the real
authenticated local E2E evidence. These are the only post-Phase-7 provenance
commits relevant to this plan.

Final backend hardening:

- stale provenance/caveat is preserved through malformed optional fallbacks;
- route-level telemetry emits exactly one aggregate event per Explore request,
  including Profile read successes and failures;
- persisted test-score summaries are validated before they can affect the response;
- the evidence/receipt `ContextVar` concurrency regression is fixed; and
- evidence wording identifies retained school IDs as public IPEDS UNITIDs, not
  student identifiers.

**Authoritative artifacts:**

- [`artifacts/admissions-fit/20260915T120111Z/input.json`](../artifacts/admissions-fit/20260915T120111Z/input.json)
  and [`manifest.json`](../artifacts/admissions-fit/20260915T120111Z/manifest.json):
  2,239 school-side rows, 12,692 fixed-key fact rows, as-of
  `2026-09-15T12:00:00Z`, input SHA-256
  `542443379ad100089efe9c30bdfc69969cca14eb279e7694a858509ca9d17062`.
- [`report.md`](../artifacts/admissions-fit/20260915T120111Z/report.md): SHA-256
  `c3ae6ad23e402983951aef57ee47c52dec7948ad32125edcca7dc6ab6a753079`; 58 checks,
  0 nullification mismatches, and 0 discriminating-control failures.
- [`artifacts/admissions-fit/20260915T120111Z-replay/report.md`](../artifacts/admissions-fit/20260915T120111Z-replay/report.md)
  has the same SHA-256 and is byte-identical to the source report.
- [`benchmark.json`](../artifacts/admissions-fit/20260915T120111Z/benchmark.json):
  incremental p95 of 3.189 ms (page size 1), 36.525 ms (24/default), and 89.267 ms
  (100/max), below the 100 ms budget; each measured receipt is baseline 1 SELECT / 1
  transaction and with-fit 2 SELECTs / 1 transaction.

The sensitivity artifact is school-side only: it contains no real student Profile,
student score, workspace/user data, or PII. Retained IDs are public IPEDS UNITIDs;
the three Profiles are synthetic fixtures only.

**Final executed evidence:** routine backend suite: **2,367 passed, 270 deselected**
(37.49s, exit 0).
The final targeted backend/evidence review record reports **241 passed**, including
**97 admissions-fit domain tests**. Global Ruff and mypy checks passed. The report and
replay contain **58 checks / 0 mismatches / 0 control failures**.

### Real local authenticated E2E — 2026-09-15

The mock Chromium matrix above and the two real local-stack runs are
complementary evidence; browser evidence is not exclusively mocked. The
authoritative reports are:

- [`artifacts/admissions-fit/20260915T124934Z/live-e2e/REPORT.md`](../artifacts/admissions-fit/20260915T124934Z/live-e2e/REPORT.md)
  — real registration/login/onboarding, empty-Profile baseline, private/no-cache
  response headers, card disclosure, active Explore refetch after a real Profile
  PATCH, and quick-add with `list_type: "Target"` and no application PATCH.
- [`artifacts/admissions-fit/20260915T131205Z/live-e2e-rank/REPORT.md`](../artifacts/admissions-fit/20260915T131205Z/live-e2e-rank/REPORT.md)
  — a fresh no-GPA rank-only Profile, with the real Profile read showing
  `gpa_unweighted: null` and `gpa_scale: null`, followed by real UAB
  (`UNITID 100663`) Explore output using the personalized strong `class_rank`
  signal and the matching card explanation. This validates rank-only
  personalization; because GPA is null, it does not validate neutral-GPA/rank
  precedence. Commit `7036958` supplies deterministic test coverage for valid
  neutral-GPA precedence; it is not a functional production fix.

Both runs used an isolated local server, local database, rendered UI, and real
authenticated cookies. Both reports retain disposable accounts; the first also
retains its disposable application, and its read-only facts diagnostic is
supporting evidence rather than a browser/product-flow input. Only the run-local
API/Vite processes started for the respective run were stopped. The browser and
product flows used no direct database writes and no fixture injection; no
production services were used. These runs are local evidence only, not
production verification. They do not cover live
GPA/SAT/ACT/multifactor paths, unknown/stale/partial states, URL score or cost
behavior, or the live responsive browser matrix; no browser screenshot or trace
is claimed beyond what the reports contain.

**Open gates:** the repo-wide 80% coverage gate and frontend automated-suite gate
are met at **80.0763%** and 1,280 passing tests across 127 files, respectively.
The former suite-order `TasksLayout.test.tsx` browser-state issue was resolved
test-only by `6093885`; no product behavior changed. No VoiceOver/NVDA check has
run. Owner review of all `middle-v1` changed rows, low/high boundary samples, and
visible changed-row/copy wording remains required, as does owner acceptance. The
plan stays ungraduated in `plans/`.
