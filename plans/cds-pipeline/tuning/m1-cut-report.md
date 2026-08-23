# M1 — CDS metric catalog cut: 1,149 → 394

Mechanical shrink of `config/cds/domains/*.yaml` down to the exact keep set in
`plans/cds-pipeline/METRICS-KEEP.md`. Deletions only — no domain was restructured, no id
was renamed or moved, no metric was re-added to save a binding.

- **Final manifest content hash: `82e4a82d188cac0d164ba42696abda2914d7b7c7ef05a676650bc3465586c4b8`**
  (was `c821b2e6…`). `scripts/cds_manifest_check.py` compiles cleanly and then fails its
  hash-drift assertion, which is the expected and accepted outcome of this pass. The script
  was not modified.
- **Note on the numbers below.** The verification block and the diffstat in this report were
  captured after the *initial mechanical cut only*, when the hash was
  `c740dd64…` and the diff was 0 insertions / 13,520 deletions. Three later passes changed
  the tree and the hash: restoring the wrongly-deleted `student_life.cds_edition` binding,
  the stale-prose sweep across `instructions:`, and the `description:`/anchor-specificity
  repairs. The **set-equality, per-domain-count, and context_bindings findings below all
  still hold** — only the hash and the insertion count moved. Current diffstat is in the
  ledger; the authoritative end state is the M1 closing gate in
  `plans/cds-pipeline/tuning/experiments.md`.
- Reproduce with `uv run python plans/cds-pipeline/tuning/harness/apply_cut.py`;
  verify with `uv run python plans/cds-pipeline/tuning/harness/verify_cut.py`.

## Verification

```
manifest compiled OK  content_sha256=c740dd64e632b9b525baf899abbb419fc092a1f47249c222e1f8925358a92538

count in manifest : 394
count in keep list: 394
in manifest but NOT in keep list (0): []
in keep list but NOT in manifest (0): []

RESULT: PASS
```

Everything is keyed on `(domain, id)` tuples, not bare ids — `applicants_total`,
`admitted_total` and `enrolled_total` each appear in both the `admissions` and `transfer`
keep tables, and a flat id set collapses 394 to 391.

## Per-domain metric counts

| domain | before | after | cut |
|---|---:|---:|---:|
| `academics` | 34 | 24 | 10 |
| `admissions` | 152 | 98 | 54 |
| `class_profile` | 127 | 36 | 91 |
| `class_size` | 22 | 17 | 5 |
| `cost` | 47 | 43 | 4 |
| `degrees` | 129 | 41 | 88 |
| `enrollment` | 134 | 4 | 130 |
| `faculty` | 31 | 4 | 27 |
| `financial_aid` | 169 | 67 | 102 |
| `identity` | 50 | 14 | 36 |
| `outcomes` | 114 | 10 | 104 |
| `student_life` | 63 | 13 | 50 |
| `transfer` | 77 | 23 | 54 |
| **total** | **1149** | **394** | **755** |

## `context_bindings` disposition — all 21 blocks

| domain | context id | binders | disposition | rule | targets |
|---|---|---|---|---|---|
| `admissions` | `c1_entering_class` | `first_year_admission_entry_term`, `first_year_admission_entry_year` | **DELETED** | R3a | n/a (35 before) — cut binder(s): `first_year_admission_entry_term`, `first_year_admission_entry_year` |
| `admissions` | `c8a_testing_cohort` | `testing_policy_entry_term`, `testing_policy_entry_year` | **DELETED** | R3a | n/a (4 before) — cut binder(s): `testing_policy_entry_term`, `testing_policy_entry_year` |
| `admissions` | `c21_early_decision_cohort` | `early_decision_entry_term`, `early_decision_entry_year` | **DELETED** | R3a | n/a (8 before) — cut binder(s): `early_decision_entry_term`, `early_decision_entry_year` |
| `class_profile` | `c9_entering_class` | `class_profile_entry_term`, `class_profile_entry_year` | **DELETED** | R3a | n/a (125 before) — cut binder(s): `class_profile_entry_term`, `class_profile_entry_year` |
| `class_size` | `i2_reporting_term` | `student_faculty_ratio_reporting_term` | **DELETED** | R3a | n/a (4 before) — cut binder(s): `student_faculty_ratio_reporting_term` |
| `class_size` | `i3_reporting_term` | `class_size_reporting_term` | **DELETED** | R3a | n/a (16 before) — cut binder(s): `class_size_reporting_term` |
| `cost` | `reporting_academic_year` | `cost_academic_year` | **KEPT** | R3b | 42 of 46 kept (4 pruned) |
| `degrees` | `reporting_window` | `degree_reporting_window_start`, `degree_reporting_window_end` | **DELETED** | R3a | n/a (127 before) — cut binder(s): `degree_reporting_window_start`, `degree_reporting_window_end` |
| `enrollment` | `enrollment_snapshot` | `enrollment_snapshot_term_or_date` | **DELETED** | R3a | n/a (133 before) — cut binder(s): `enrollment_snapshot_term_or_date` |
| `faculty` | `i1_reporting_term` | `faculty_reporting_term` | **DELETED** | R3a | n/a (30 before) — cut binder(s): `faculty_reporting_term` |
| `financial_aid` | `aid_reporting_period` | `aid_reporting_academic_year`, `aid_reporting_status` | **KEPT** | R3b | 22 of 78 kept (56 pruned) |
| `financial_aid` | `h4_h5_graduating_class` | `graduating_class_year`, `degree_award_window_start`, `degree_award_window_end` | **DELETED** | R3a | n/a (16 before) — cut binder(s): `graduating_class_year`, `degree_award_window_start`, `degree_award_window_end` |
| `outcomes` | `b3_awards_window` | `awards_window_start`, `awards_window_end` | **DELETED** | R3a | n/a (9 before) — cut binder(s): `awards_window_start`, `awards_window_end` |
| `outcomes` | `primary_bachelors_cohort` | `bachelors_primary_cohort_year` | **DELETED** | R3a | n/a (37 before) — cut binder(s): `bachelors_primary_cohort_year` |
| `outcomes` | `comparison_bachelors_cohort` | `bachelors_comparison_cohort_year` | **DELETED** | R3a | n/a (37 before) — cut binder(s): `bachelors_comparison_cohort_year` |
| `outcomes` | `primary_two_year_cohort` | `two_year_primary_cohort_year` | **DELETED** | R3a | n/a (10 before) — cut binder(s): `two_year_primary_cohort_year` |
| `outcomes` | `comparison_two_year_cohort` | `two_year_comparison_cohort_year` | **DELETED** | R3a | n/a (10 before) — cut binder(s): `two_year_comparison_cohort_year` |
| `outcomes` | `b22_retention_window` | `first_year_retention_entering_term`, `first_year_retention_followup_term` | **DELETED** | R3a | n/a (3 before) — cut binder(s): `first_year_retention_entering_term`, `first_year_retention_followup_term` |
| `student_life` | `f1_reporting_period` | `student_life_reporting_term`, `student_life_reporting_year` | **DELETED** | R3a | n/a (16 before) — cut binder(s): `student_life_reporting_term`, `student_life_reporting_year` |
| `student_life` | `cds_edition` | `identity.academic_year` | **KEPT** | R3b | 6 of 6 kept (0 pruned) — cross-domain binder `identity.academic_year` survived the cut |
| `transfer` | `d2_entering_class` | `transfer_volume_entry_term`, `transfer_volume_entry_year` | **DELETED** | R3a | n/a (15 before) — cut binder(s): `transfer_volume_entry_term`, `transfer_volume_entry_year` |

3 of 21 blocks survive. Domains whose `context_bindings:` key was removed entirely (R4, matching `academics.yaml` / `identity.yaml`, which never had one): `admissions`, `class_profile`, `class_size`, `degrees`, `enrollment`, `faculty`, `outcomes`, `transfer`.

## Stale prose inventory — 117 references

| domain | surviving metric | dead id referenced | referencing sentence |
|---|---|---|---|
| `class_profile` | `sat_submitters_percent` | `class_profile_entry_term` | Bind to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `sat_submitters_percent` | `class_profile_entry_year` | Bind to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `sat_submitters_count` | `class_profile_entry_term` | Bind to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `sat_submitters_count` | `class_profile_entry_year` | Bind to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_submitters_percent` | `class_profile_entry_term` | Bind to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_submitters_percent` | `class_profile_entry_year` | Bind to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_submitters_count` | `class_profile_entry_term` | Bind to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_submitters_count` | `class_profile_entry_year` | Bind to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `sat_composite_p25` | `class_profile_entry_term` | Denominator is enrolled first-time, first-year submitters of SAT Composite scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `sat_composite_p25` | `class_profile_entry_year` | Denominator is enrolled first-time, first-year submitters of SAT Composite scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `sat_composite_p50` | `class_profile_entry_term` | Denominator is enrolled first-time, first-year submitters of SAT Composite scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `sat_composite_p50` | `class_profile_entry_year` | Denominator is enrolled first-time, first-year submitters of SAT Composite scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `sat_composite_p75` | `class_profile_entry_term` | Denominator is enrolled first-time, first-year submitters of SAT Composite scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `sat_composite_p75` | `class_profile_entry_year` | Denominator is enrolled first-time, first-year submitters of SAT Composite scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `sat_ebrw_p25` | `class_profile_entry_term` | Denominator is enrolled first-time, first-year submitters of SAT Evidence-Based Reading and Writing (EBRW) scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `sat_ebrw_p25` | `class_profile_entry_year` | Denominator is enrolled first-time, first-year submitters of SAT Evidence-Based Reading and Writing (EBRW) scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `sat_ebrw_p50` | `class_profile_entry_term` | Denominator is enrolled first-time, first-year submitters of SAT Evidence-Based Reading and Writing (EBRW) scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `sat_ebrw_p50` | `class_profile_entry_year` | Denominator is enrolled first-time, first-year submitters of SAT Evidence-Based Reading and Writing (EBRW) scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `sat_ebrw_p75` | `class_profile_entry_term` | Denominator is enrolled first-time, first-year submitters of SAT Evidence-Based Reading and Writing (EBRW) scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `sat_ebrw_p75` | `class_profile_entry_year` | Denominator is enrolled first-time, first-year submitters of SAT Evidence-Based Reading and Writing (EBRW) scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `sat_math_p25` | `class_profile_entry_term` | Denominator is enrolled first-time, first-year submitters of SAT Math scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `sat_math_p25` | `class_profile_entry_year` | Denominator is enrolled first-time, first-year submitters of SAT Math scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `sat_math_p50` | `class_profile_entry_term` | Denominator is enrolled first-time, first-year submitters of SAT Math scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `sat_math_p50` | `class_profile_entry_year` | Denominator is enrolled first-time, first-year submitters of SAT Math scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `sat_math_p75` | `class_profile_entry_term` | Denominator is enrolled first-time, first-year submitters of SAT Math scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `sat_math_p75` | `class_profile_entry_year` | Denominator is enrolled first-time, first-year submitters of SAT Math scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_composite_p25` | `class_profile_entry_term` | Denominator is enrolled first-time, first-year submitters of ACT Composite scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_composite_p25` | `class_profile_entry_year` | Denominator is enrolled first-time, first-year submitters of ACT Composite scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_composite_p50` | `class_profile_entry_term` | Denominator is enrolled first-time, first-year submitters of ACT Composite scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_composite_p50` | `class_profile_entry_year` | Denominator is enrolled first-time, first-year submitters of ACT Composite scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_composite_p75` | `class_profile_entry_term` | Denominator is enrolled first-time, first-year submitters of ACT Composite scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_composite_p75` | `class_profile_entry_year` | Denominator is enrolled first-time, first-year submitters of ACT Composite scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_math_p25` | `class_profile_entry_term` | Denominator is enrolled first-time, first-year submitters of ACT Math scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_math_p25` | `class_profile_entry_year` | Denominator is enrolled first-time, first-year submitters of ACT Math scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_math_p50` | `class_profile_entry_term` | Denominator is enrolled first-time, first-year submitters of ACT Math scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_math_p50` | `class_profile_entry_year` | Denominator is enrolled first-time, first-year submitters of ACT Math scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_math_p75` | `class_profile_entry_term` | Denominator is enrolled first-time, first-year submitters of ACT Math scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_math_p75` | `class_profile_entry_year` | Denominator is enrolled first-time, first-year submitters of ACT Math scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_english_p25` | `class_profile_entry_term` | Denominator is enrolled first-time, first-year submitters of ACT English scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_english_p25` | `class_profile_entry_year` | Denominator is enrolled first-time, first-year submitters of ACT English scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_english_p50` | `class_profile_entry_term` | Denominator is enrolled first-time, first-year submitters of ACT English scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_english_p50` | `class_profile_entry_year` | Denominator is enrolled first-time, first-year submitters of ACT English scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_english_p75` | `class_profile_entry_term` | Denominator is enrolled first-time, first-year submitters of ACT English scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_english_p75` | `class_profile_entry_year` | Denominator is enrolled first-time, first-year submitters of ACT English scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_science_p25` | `class_profile_entry_term` | Denominator is enrolled first-time, first-year submitters of ACT Science scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_science_p25` | `class_profile_entry_year` | Denominator is enrolled first-time, first-year submitters of ACT Science scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_science_p50` | `class_profile_entry_term` | Denominator is enrolled first-time, first-year submitters of ACT Science scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_science_p50` | `class_profile_entry_year` | Denominator is enrolled first-time, first-year submitters of ACT Science scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_science_p75` | `class_profile_entry_term` | Denominator is enrolled first-time, first-year submitters of ACT Science scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_science_p75` | `class_profile_entry_year` | Denominator is enrolled first-time, first-year submitters of ACT Science scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_reading_p25` | `class_profile_entry_term` | Denominator is enrolled first-time, first-year submitters of ACT Reading scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_reading_p25` | `class_profile_entry_year` | Denominator is enrolled first-time, first-year submitters of ACT Reading scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_reading_p50` | `class_profile_entry_term` | Denominator is enrolled first-time, first-year submitters of ACT Reading scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_reading_p50` | `class_profile_entry_year` | Denominator is enrolled first-time, first-year submitters of ACT Reading scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_reading_p75` | `class_profile_entry_term` | Denominator is enrolled first-time, first-year submitters of ACT Reading scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `act_reading_p75` | `class_profile_entry_year` | Denominator is enrolled first-time, first-year submitters of ACT Reading scores, bound to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `class_rank_submitted_percent` | `class_profile_entry_term` | Bind to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `class_rank_submitted_percent` | `class_profile_entry_year` | Bind to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `class_rank_top_tenth_percent` | `class_profile_entry_term` | Bind to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `class_rank_top_tenth_percent` | `class_profile_entry_year` | Bind to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `class_rank_top_quarter_percent` | `class_profile_entry_term` | Bind to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `class_rank_top_quarter_percent` | `class_profile_entry_year` | Bind to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `class_rank_top_half_percent` | `class_profile_entry_term` | Bind to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `class_rank_top_half_percent` | `class_profile_entry_year` | Bind to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `class_rank_bottom_half_percent` | `class_profile_entry_term` | Bind to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `class_rank_bottom_half_percent` | `class_profile_entry_year` | Bind to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `class_rank_bottom_quarter_percent` | `class_profile_entry_term` | Bind to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `class_rank_bottom_quarter_percent` | `class_profile_entry_year` | Bind to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `average_high_school_gpa` | `class_profile_entry_term` | Bind to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `average_high_school_gpa` | `class_profile_entry_year` | Bind to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `high_school_gpa_submitted_percent` | `class_profile_entry_term` | Bind to `class_profile_entry_term` and `class_profile_entry_year`. |
| `class_profile` | `high_school_gpa_submitted_percent` | `class_profile_entry_year` | Bind to `class_profile_entry_term` and `class_profile_entry_year`. |
| `faculty` | `total_instructional_faculty_full_time` | `faculty_reporting_term` | Bind this value to `faculty_reporting_term`; |
| `faculty` | `total_instructional_faculty_part_time` | `faculty_reporting_term` | Bind this value to `faculty_reporting_term`; |
| `faculty` | `doctorate_or_terminal_degree_faculty_full_time` | `faculty_reporting_term` | Bind this value to `faculty_reporting_term`; |
| `faculty` | `doctorate_or_terminal_degree_faculty_part_time` | `faculty_reporting_term` | Bind this value to `faculty_reporting_term`; |
| `financial_aid` | `aid_reporting_academic_year` | `graduating_class_year` | H4/H5 use the separate `graduating_class_year` and degree-award-window context, while H6 policy selections and H7-H15 use policy context; |
| `financial_aid` | `graduating_class_first_time_bachelors_count` | `degree_award_window_start` | Extract the H4 count of first-time-entering students (excluding transfer-ins) who were awarded a bachelor's degree within the `degree_award_window_start`/`degree_award_window_end` window. |
| `financial_aid` | `graduating_class_first_time_bachelors_count` | `degree_award_window_end` | Extract the H4 count of first-time-entering students (excluding transfer-ins) who were awarded a bachelor's degree within the `degree_award_window_start`/`degree_award_window_end` window. |
| `identity` | `main_website` | `cds_responses_url` | Keep distinct from the online `application_url` and from `cds_responses_url`. |
| `identity` | `admissions_email` | `main_email` | Keep distinct from `main_email`. |
| `outcomes` | `primary_pell_grant_six_year_graduation_rate_ratio` | `bachelors_primary_cohort_year` | This is CDS item B11 and is bound to `bachelors_primary_cohort_year`. |
| `outcomes` | `primary_pell_grant_six_year_graduation_rate_ratio` | `primary_sixth_year_interval_end` | Bind the six-year cutoff to `primary_sixth_year_interval_end`. |
| `outcomes` | `primary_all_students_adjusted_cohort_count` | `primary_all_students_initial_cohort_count` | Use arithmetic against `primary_all_students_initial_cohort_count` and `primary_all_students_allowable_exclusions_count` only for validation; |
| `outcomes` | `primary_all_students_adjusted_cohort_count` | `primary_all_students_allowable_exclusions_count` | Use arithmetic against `primary_all_students_initial_cohort_count` and `primary_all_students_allowable_exclusions_count` only for validation; |
| `outcomes` | `primary_all_students_adjusted_cohort_count` | `bachelors_primary_cohort_year` | This is CDS item B6 and is bound to `bachelors_primary_cohort_year`. |
| `outcomes` | `primary_all_students_completed_within_four_years_count` | `primary_four_year_completion_cutoff` | Extract the "Total (sum of 3 columns to the left)" column "completed within four years" row from the first/most recent visible B4-B11 cohort grid, bound to `primary_four_year_completion_cutoff`. |
| `outcomes` | `primary_all_students_completed_within_four_years_count` | `bachelors_primary_cohort_year` | This is CDS item B7 and is bound to `bachelors_primary_cohort_year`. |
| `outcomes` | `primary_all_students_completed_after_four_within_five_years_count` | `primary_fifth_year_interval_start` | Extract the "Total (sum of 3 columns to the left)" column "completed after four, within five years" row from the first/most recent visible B4-B11 cohort grid, bound to `primary_fifth_year_interval_start` and `primary_fifth_year_interval_end`. |
| `outcomes` | `primary_all_students_completed_after_four_within_five_years_count` | `primary_fifth_year_interval_end` | Extract the "Total (sum of 3 columns to the left)" column "completed after four, within five years" row from the first/most recent visible B4-B11 cohort grid, bound to `primary_fifth_year_interval_start` and `primary_fifth_year_interval_end`. |
| `outcomes` | `primary_all_students_completed_after_four_within_five_years_count` | `bachelors_primary_cohort_year` | This is CDS item B8 and is bound to `bachelors_primary_cohort_year`. |
| `outcomes` | `primary_all_students_completed_after_five_within_six_years_count` | `primary_sixth_year_interval_start` | Extract the "Total (sum of 3 columns to the left)" column "completed after five, within six years" row from the first/most recent visible B4-B11 cohort grid, bound to `primary_sixth_year_interval_start` and `primary_sixth_year_interval_end`. |
| `outcomes` | `primary_all_students_completed_after_five_within_six_years_count` | `primary_sixth_year_interval_end` | Extract the "Total (sum of 3 columns to the left)" column "completed after five, within six years" row from the first/most recent visible B4-B11 cohort grid, bound to `primary_sixth_year_interval_start` and `primary_sixth_year_interval_end`. |
| `outcomes` | `primary_all_students_completed_after_five_within_six_years_count` | `bachelors_primary_cohort_year` | This is CDS item B9 and is bound to `bachelors_primary_cohort_year`. |
| `outcomes` | `primary_all_students_completed_within_six_years_count` | `bachelors_primary_cohort_year` | This is CDS item B10 and is bound to `bachelors_primary_cohort_year`. |
| `outcomes` | `primary_all_students_completed_within_six_years_count` | `primary_sixth_year_interval_end` | Bind the six-year cutoff to `primary_sixth_year_interval_end`. |
| `outcomes` | `primary_all_students_six_year_graduation_rate_ratio` | `bachelors_primary_cohort_year` | This is CDS item B11 and is bound to `bachelors_primary_cohort_year`. |
| `outcomes` | `primary_all_students_six_year_graduation_rate_ratio` | `primary_sixth_year_interval_end` | Bind the six-year cutoff to `primary_sixth_year_interval_end`. |
| `outcomes` | `first_year_retention_entering_cohort_count` | `first_year_retention_entering_term` | Bind this count to `first_year_retention_entering_term`. |
| `outcomes` | `first_year_retention_still_enrolled_next_fall_count` | `first_year_retention_entering_term` | Bind this count to `first_year_retention_entering_term` and `first_year_retention_followup_term`. |
| `outcomes` | `first_year_retention_still_enrolled_next_fall_count` | `first_year_retention_followup_term` | Bind this count to `first_year_retention_entering_term` and `first_year_retention_followup_term`. |
| `outcomes` | `first_year_retention_reported_percent` | `first_year_retention_entering_term` | Bind this rate to `first_year_retention_entering_term` and `first_year_retention_followup_term`. |
| `outcomes` | `first_year_retention_reported_percent` | `first_year_retention_followup_term` | Bind this rate to `first_year_retention_entering_term` and `first_year_retention_followup_term`. |
| `student_life` | `out_of_state_percent_undergraduates` | `student_life_reporting_term` | Bind this metric to `student_life_reporting_term` and `student_life_reporting_year` from the F1 heading. |
| `student_life` | `out_of_state_percent_undergraduates` | `student_life_reporting_year` | Bind this metric to `student_life_reporting_term` and `student_life_reporting_year` from the F1 heading. |
| `student_life` | `fraternity_joiners_percent_undergraduates` | `student_life_reporting_term` | Bind this metric to `student_life_reporting_term` and `student_life_reporting_year` from the F1 heading. |
| `student_life` | `fraternity_joiners_percent_undergraduates` | `student_life_reporting_year` | Bind this metric to `student_life_reporting_term` and `student_life_reporting_year` from the F1 heading. |
| `student_life` | `sorority_joiners_percent_undergraduates` | `student_life_reporting_term` | Bind this metric to `student_life_reporting_term` and `student_life_reporting_year` from the F1 heading. |
| `student_life` | `sorority_joiners_percent_undergraduates` | `student_life_reporting_year` | Bind this metric to `student_life_reporting_term` and `student_life_reporting_year` from the F1 heading. |
| `student_life` | `college_owned_housing_percent_undergraduates` | `student_life_reporting_term` | Bind this metric to `student_life_reporting_term` and `student_life_reporting_year` from the F1 heading. |
| `student_life` | `college_owned_housing_percent_undergraduates` | `student_life_reporting_year` | Bind this metric to `student_life_reporting_term` and `student_life_reporting_year` from the F1 heading. |
| `student_life` | `off_campus_or_commute_percent_undergraduates` | `student_life_reporting_term` | Bind this metric to `student_life_reporting_term` and `student_life_reporting_year` from the F1 heading. |
| `student_life` | `off_campus_or_commute_percent_undergraduates` | `student_life_reporting_year` | Bind this metric to `student_life_reporting_term` and `student_life_reporting_year` from the F1 heading. |
| `student_life` | `age_25_or_older_percent_undergraduates` | `student_life_reporting_term` | Bind this metric to `student_life_reporting_term` and `student_life_reporting_year` from the F1 heading. |
| `student_life` | `age_25_or_older_percent_undergraduates` | `student_life_reporting_year` | Bind this metric to `student_life_reporting_term` and `student_life_reporting_year` from the F1 heading. |
| `student_life` | `average_age_full_time_undergraduates` | `student_life_reporting_term` | Bind this metric to `student_life_reporting_term` and `student_life_reporting_year` from the F1 heading. |
| `student_life` | `average_age_full_time_undergraduates` | `student_life_reporting_year` | Bind this metric to `student_life_reporting_term` and `student_life_reporting_year` from the F1 heading. |

## Notes and judgement calls

**18 of 21 context bindings died, and all 18 died under R3a.** This was not a close call in any
single case: every dead binder metric is reporting scaffolding — `*_entry_term`, `*_entry_year`,
`*_window_start` / `*_window_end`, `*_cohort_year`, `*_reporting_term`, `enrollment_snapshot_term_or_date`
— and `METRICS-KEEP.md` cuts that family wholesale ("Reporting scaffolding … 34"). A binding
cannot survive without its binder, so cutting the scaffolding cut the binding layer with it.
The three survivors (`cost.reporting_academic_year`, `financial_aid.aid_reporting_period`,
`student_life.cds_edition`) are the only ones whose binder(s) are kept metrics. Nothing was
re-added to rescue a binding.

**Consequence worth flagging to the orchestrator:** period context for most surviving metrics is
now carried only by each metric's own `period_kind`, not by a compiled `contexts` entry. 10 domains
lost their period-binding layer entirely (`student_life` keeps `cds_edition` for its 6 ROTC metrics).
That is the correct application of the stated rules, but it is a semantic change beyond "fewer
metrics" and downstream consumption code should know it.

**`student_life.cds_edition` is the one cross-domain binding, and it survives.** Its binder is the
qualified `identity.academic_year` — a dot-qualified reference into another domain, not a
`student_life`-local metric. `identity.academic_year` was never on the cut list, so this binding
was never eligible for R3a; it is a plain R3b keep, the same as the other two survivors. **Correction
note:** the original pass in this report mis-resolved the dot-qualified cross-domain binder — it
looked up `academic_year` as if it needed to exist inside `student_life.yaml`, didn't find it there,
and marked the block DELETED. The reusable lesson: any binder-survival check must resolve
`domain.id`-qualified binder references against the *target* domain's manifest, not the referencing
domain's, or it will misclassify every cross-domain binding as dead.

**Two authoring formats, both handled.** `enrollment.yaml` uses the inline `- {id: ...}` mapping for
all 134 of its metrics; the other 12 use the block `- id:` form. A `grep '^  - id:'` sweep silently
misses enrollment entirely.

**Orphaned section comments.** Naive span-splitting (entry runs from its `- ` line to the next one)
leaves a deleted section's heading comment stranded above an unrelated surviving metric — this
happened on the first run in `degrees.yaml` and `transfer.yaml`. Fixed by attaching each blank/comment
preamble to the entry *below* it, so a section header dies with the section it introduces. The one
comment that now precedes no metric entry is `class_size.yaml` line 1, which is the pre-existing
file header and was already like that.

**`context_bindings: []` was never left behind.** When a domain lost all its bindings the key itself
was removed, matching `academics.yaml` and `identity.yaml`, which never carried one.

**No formula breakage.** `_validate_formula_references` passes — no surviving metric's `formula.inputs`
points at a cut metric. That was luck rather than design; it is a compile-time gate and it held.

**Prose was left alone deliberately (R5).** The 117 references above are inventory for a follow-up
pass, not defects introduced here that anyone should fix inline.
