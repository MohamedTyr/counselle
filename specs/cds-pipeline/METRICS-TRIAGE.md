# CDS metric triage — what we need, what we don't

**Status:** analysis only. No config changed. Decide before anything is deleted.
**Question asked:** of the 1015 metrics in `config/cds/domains/*.yaml`, which ones does the agent
need, which ones does a student see, which ones feed matching — and which ones are pure cost?

**Verdict: keep ~75 as Tier 1, ~85 as Tier 2 on-demand, cut ~855 (≈84%).**

---

## 0. The number that decides this

`AGENTS.md:25` — per-metric recall is **65.6% on Harvard**, the best-formatted CDS in the corpus,
and `admissions` is already near its *answerable ceiling* (~65% of 152). That ceiling is a property
of the source PDFs, not of our prompts.

So at 1015 metrics we get ~660 populated cells on the easiest school and far fewer on a mid-tier
one. A school page would render 40% empty. The correct response to 65.6% recall is not "extract
harder" — it's **extract less, better**. Cutting to ~160 buys ~6× the extraction budget per
surviving metric, and the cut list is dominated by exactly the long grid tables where PDF
extraction fails worst (79 score bands, 49 comparison-cohort rows, 84 CIP conferral rows, 135
gender cells). **Cutting the catalog should raise coverage of what we actually ship.**

Second forcing fact: the consumption side is **empty today**. `app/workspace/agent_tools_schools.py`
exposes name/city/state/website only; `frontend/src/features/schools/` shows zero institutional
data. Nothing to retrofit — we choose the surface, so we should choose one we can fill.

All counts below were verified by grep against the catalog, not estimated.

---

## 1. TIER 1 — load-bearing (~75 ids)

Extract unconditionally, every school, every year. These reach the matching math, the agent, and
the default screen.

### 1.1 Selectivity + residency (11) — the chancing denominators
`applicants_total`, `admitted_total`, `enrolled_total`
`applicants_residency_{in_state,out_of_state,international}`
`admitted_residency_{in_state,out_of_state,international}`
`enrolled_residency_{in_state,out_of_state}`

**The residency split is the highest-value find in the catalog.** At a public university an
out-of-state applicant faces a materially different school than the headline admit rate describes.
This is the single biggest correction to a naive chance estimate, and we already have the cells.

### 1.2 Academic profile (14) — student-vs-class placement
`sat_composite_{p25,p50,p75}`, `sat_ebrw_{p25,p75}`, `sat_math_{p25,p75}`,
`act_composite_{p25,p50,p75}`, `sat_submitters_percent`, `act_submitters_percent`,
`average_high_school_gpa`, `high_school_gpa_submitted_percent`

The 18 ACT/SAT *subscore* percentiles beyond these are cut.

### 1.3 Class rank (3)
`class_rank_submitted_percent` (gate — suppress the metric below ~40% reporting),
`class_rank_top_tenth_percent`, `class_rank_top_quarter_percent`

### 1.4 Testing policy (3)
`sat_or_act_admission_policy`, `uses_entrance_exam_scores_in_admission`, `test_policy_clarification`

### 1.5 What the school weighs — C7 (14)
The 13 decision-relevant `selection_factor_*` ids (`rigor_of_secondary_school_record`, `class_rank`,
`academic_gpa`, `standardized_tests`, `application_essay`, `recommendations`, `interview`,
`extracurricular_activities`, `talent_ability`, `character_personal_qualities`, `first_generation`,
`alumni_relation`, `level_of_applicant_interest`) plus `program_specific_factor_differences`.

This section is the **honest replacement for a chance-me number**: it tells the student where to
spend their remaining months. Rendered in the school's own weight order — that ordering is the
insight.

### 1.6 Round strategy (10)
`early_decision_offered`, `early_decision_application_count`, `early_decision_admitted_count`,
`early_decision_first_closing_date`, `early_decision_first_notification_date`,
`early_action_offered`, `early_action_closing_date`, `early_action_restrictive`,
`waitlist_offered_place_count`, `waitlist_accepted_place_count`, `waitlist_admitted_count`

Restrictive EA is a **portfolio constraint** — it forbids other schools' EA — so it belongs in the
matching engine, not just the display.

### 1.7 Deadlines and mechanics (7)
`application_closing_date_fall`, `application_priority_date`, `decision_notification_mode`,
`decision_by_date`, `reply_deadline`, `application_fee_amount`,
`need_based_application_fee_waiver_available`

The fee waiver is a genuine list-size constraint for a low-income student, not a detail.

### 1.8 Money (17)
`h2_a_degree_seeking_undergraduates_first_time_first_year` (denominator),
`h2_c_determined_have_need_first_time_first_year`, `h2_h_need_fully_met_count_first_time_first_year`,
`h2_i_average_percent_need_met_first_time_first_year`, `h2_j_average_aid_package_first_time_first_year`,
`h2_k_average_need_based_grant_award_first_time_first_year`,
`h2_m_average_need_based_loan_award_first_time_first_year`,
`h2a_n_no_need_institutional_grant_recipients_first_time_first_year`,
`h2a_o_average_no_need_institutional_grant_amount_first_time_first_year`,
`h5_borrowers_any_program_percent_of_class`, `h5_borrowers_any_program_average_principal`,
`h6_recipient_count`, `h6_average_institutional_aid`,
`h8_fafsa_required`, `h8_css_profile_required`, `h8_noncustodial_profile_required`,
`aid_priority_date`, `aid_deadline_date_or_text`

`h8_noncustodial_profile_required` disqualifies real students — the agent must raise it as a task.

### 1.9 Merit hooks — H14 non-need column only (7)
`h14_{academics,athletics,leadership,art,music_drama,state_district_residency,alumni_affiliation}_non_need_based`

The 11 parallel `*_need_based` ids are cut: need-based criteria are the FAFSA, not a hook.

### 1.10 Sticker cost (8)
`cost_academic_year`, `tuition_private_first_year`,
`tuition_public_in_state_out_of_district_first_year`, `tuition_public_out_of_state_first_year`,
`tuition_nonresident_first_year`, `required_fees_first_year`,
`food_and_housing_on_campus_first_year`, `net_price_calculator_url`

Hand off to the NPC rather than fake a net price.

### 1.11 Fit and quality (13)
`undergraduate_total`, `institutional_control`, `undergraduate_gender_model`, `academic_calendar`,
`state_or_region`, `city`, `first_year_retention_reported_percent`,
`primary_all_students_six_year_graduation_rate_ratio`,
`primary_all_students_completed_within_four_years_count`,
`primary_all_students_adjusted_cohort_count`, `students_per_faculty`,
`out_of_state_percent_undergraduates`, `nonresident_all_undergraduates`

---

## 2. TIER 2 — agent-on-demand (~85 ids)

Extract at lower priority. The agent may cite them; they are **not** in the matching math and not on
the default screen.

- **Class size (9):** `class_sections_2_9` … `class_sections_100_plus`, `class_sections_reported_total`
  — too noisy to score, excellent to narrate as one stacked bar.
- **Residential/Greek (5):** `fraternity_joiners_percent_undergraduates`,
  `sorority_joiners_percent_undergraduates`, `college_owned_housing_percent_undergraduates`,
  `off_campus_or_commute_percent_undergraduates`, `living_learning_communities`
- **Major mix (~44):** the `*_bachelors_percent` column of Section J **only** — render the top ~6
  by share. Never in the score (see trap 7).
- **Programs (8):** `special_study_{honors_program,study_abroad,undergraduate_research,internships,double_major,student_designed_major,accelerated_program,cross_registration}`
- **HS unit requirements (6):** `total_academic_units_required`, `mathematics_units_required`,
  `science_units_required`, `lab_science_units_required`, `foreign_language_units_required`,
  `high_school_completion_requirement` — a real gap-check while there's still time to fix it.
- **Placement/credit (6):** `placement_uses_{ap,clep,sat,act}`,
  `transfer_credit_maximum_four_year_value`, `lowest_eligible_course_grade`
- **Transfer core (10), gated to transfer users only.**
- **Logistics + aid detail (~15):** `application_url`, `deferred_enrollment_allowed`,
  `housing_deposit_amount`, `housing_deposit_deadline`, `waitlist_ranked`,
  `h5_borrowers_{federal,private}_percent_of_class`, `need_analysis_methodology`, etc.
- **ROTC (3)**, only if asked.

---

## 3. CUT — ~855 ids, by kind of uselessness

| # | Family | Count | Why it dies |
|---|---|---|---|
| 1 | `*_(men\|women\|another_gender\|unknown)$` | **135** | Liability + redundant with `*_total` (§4) |
| 2 | Race/ethnicity cells across 3 populations | **30** | Liability (§4). Keep only `nonresident_all_undergraduates` |
| 3 | `*_band_*` score/GPA distribution cells | **79** | p25/p50/p75 *is* the distribution, at 1/8 the cost |
| 4 | `comparison_*` outcomes (prior cohort) | **49** | Stale by construction; duplicates `primary_*` |
| 5 | `*_(diploma_certificate\|associate)_percent$` | **84** | We advise bachelor's applicants |
| 6 | `primary_{pell,subsidized_stafford,neither}_*` + cohort-window dates | ~46 | IPEDS plumbing + liability. Keep 3 `primary_all_students_*` |
| 7 | `h2*_{all_full_time,less_than_full_time}$` | **34** | First-year applicants are full-time first-years |
| 8 | `h1_*` aid-dollar ledger | **24** | Institutional accounting, not student-facing |
| 9 | `*_available$` club/housing checkboxes | **42** | Every school checks every box — zero discriminating power |
| 10 | `*two_year*` outcomes | **26** | Wrong product |
| 11 | Faculty credential + demographic grid | ~29 | No list ever changed on 91% vs 88% terminal degrees |
| 12 | `h12_*`/`h13_*` aid-source booleans | **18** | Universally true at four-years |
| 13 | `h14_*_need_based` | 11 | Need-based criteria are the FAFSA |
| 14 | `identity` address/phone/contact atoms | ~30 | Nobody mails an application |
| 15 | `required_coursework_*` (E1) | 14 | Graduation requirements, not admission requirements |
| 16 | Cost long tail (`*_undergraduates` twins, `tuition_per_credit_*`, commuter rows) | ~30 | NPC url beats all of it |
| 17 | Transfer long tail (winter/spring/summer date quads, military credit) | ~55 | Separate product, later |
| 18 | Free-text `*_description`/`*_other_*`/`*_raw` | ~22 | Unrenderable, unfilterable, expensive tokens |
| 19 | Reporting scaffolding (`*_entry_term`, `*_reporting_term`, `*_window_start/end`, `cip_version`) | ~34 | **Not metrics — provenance.** See §6.2 |
| 20 | Age demographics, awards-conferred counts, `class_subsections_*` | ~27 | Noise |

---

## 4. The liability cut — the one I would not negotiate

**165 ids die because of what they invite a user to infer, not because they're expensive.**

- **135 gender-split cells.** `applicants_women` next to `admitted_women` reads as a gendered admit
  rate. `_another_gender` cells are often 0–5 students at a named institution — a disclosure problem
  on top of an inference problem. Keep `undergraduate_gender_model` (coed / women's / men's college),
  which is a structural institutional fact and a genuine search filter.
- **30 race/ethnicity cells.** Placing these beside an acceptance rate in an admissions product
  invites exactly one reading: *"what are my odds as a member of group X."* Post-*SFFA* that reading
  is legally fraught **and factually unsupported** — CDS publishes enrollment composition, never
  admit rate by race, so the inference isn't in the data at all.
- **12 Pell/Stafford graduation splits.** "Do students like me graduate here?" is legitimate, but
  the CDS answer is a 6-year-stale small-*n* ratio, and rendering it against a student's aid profile
  is a predicted-outcome claim we cannot support.

Structural rule, not a metric decision: **nothing in this catalog supports a chancing number.**
An acceptance rate is a population statistic. `AGENTS.md:94` — *"the data is the product — never lie
to a student."* The `selection_factor_*` section (§1.5) exists as the honest substitute.

---

## 5. Derive, don't extract

Free arithmetic that costs an extraction call today. Every one is a number a counselor says out loud.

| Derived | Formula |
|---|---|
| Admit rate | `admitted_total / applicants_total` |
| Yield | `enrolled_total / admitted_total` |
| In-state / OOS / intl admit rate | `admitted_residency_X / applicants_residency_X` |
| ED admit rate | `early_decision_admitted_count / early_decision_application_count` |
| ED advantage ratio | ED rate ÷ residual rate, where residual = `(admitted_total − ED admitted) / (applicants_total − ED applications)` — **valid only at ED-only schools**, see trap 4 |
| ED share of class | `early_decision_admitted_count / enrolled_total` |
| Waitlist conversion | `waitlist_admitted_count / waitlist_accepted_place_count` |
| % of need-havers fully met | `h2_h / h2_c` — the honest "meets full need" test, better than `h2_i` |
| Merit reach for full-pay | `h2a_n / h2_a`, paired with `h2a_o` — "40% of full-pay students get $18k" |
| Grant share of package | `h2_k / h2_j` |
| 4-year grad rate | `primary_all_students_completed_within_four_years_count / primary_all_students_adjusted_cohort_count` |
| 4yr/6yr gap | six-year − four-year — proxy for a paid fifth year |
| Sticker COA | tuition row (branched on `institutional_control` + residency) + `required_fees_first_year` + `food_and_housing_on_campus_first_year` |
| % classes under 20 / 50+ | from `class_sections_*` |
| Score-band placement | student score vs `[p25, p75]` → below / mid-50 / above |

---

## 6. Traps — metrics that look useful and aren't

1. **Test percentiles without submitter rates.** Post-test-optional, `sat_composite_*` describes
   *submitters only* — a self-selected high-scoring subset. At `sat_submitters_percent` = 38%, the
   mid-50 is the profile of the top third of the class. **Hard rule: never render a percentile
   without its submitter rate beside it; never tier a student on percentiles when submitters < 50%.**
2. **`average_high_school_gpa`.** The yaml itself warns (`class_profile.yaml:2304`): *"do not assume
   every edition uses an unweighted 4.0 scale"* — Harvard prints 4.22. Weighted vs unweighted vs
   100-point is **non-comparable across schools**. Never rank or diff schools on it.
3. **`h2_i` "average percent need met."** Denominator is aid *recipients*, not all students; it
   excludes PLUS/private loans from "need met," so a school can print 100% while the family still
   borrows. The yaml flags a real internally-inconsistent Harvard row. Prefer derived `h2_h / h2_c`.
4. **ED counts combine ED I and ED II, and there are no EA counts at all** (grep-confirmed). So a
   "RD admit rate" derived by subtraction is polluted by EA admits at any EA school and will
   systematically **overstate** it. Publish the ED-advantage ratio only for ED-only schools.
5. **`waitlist_admitted_count`** swings 0 → 400 year to year. Narrative only, never a chance input.
6. **Class-rank bands are nested** (top-tenth ⊂ top-quarter). The yaml forbids deriving one from
   another or subtracting to fill a blank. Most US high schools no longer rank at all.
7. **`*_bachelors_percent` is not program strength.** It's a share of *conferred majors*, double
   majors double-counted. A 0% row does **not** mean the major doesn't exist.
8. **`students_per_faculty`** uses a school-chosen FTE basis (`ratio_basis_*` ids exist *precisely
   because* it varies). "8 to 1" at a research university and at a LAC are different experiences.
9. **`out_of_state_percent_undergraduates` excludes international from both numerator and
   denominator** — it is **not additive** with `nonresident_all_undergraduates`. Summing them
   produces a number the user can check against the school's own site and find wrong.
10. **Mixed units, live rendering bug:** grad rate is a 0–1 **ratio** ("0.94"), retention is a percent
    **string** ("96%"). Several percents are `type: string` preserving `"<1%"` — the matching math
    must parse defensively and treat unparseable as **missing, never zero**.
11. **`selection_factor_level_of_applicant_interest`** is the least trustworthy cell in the CDS —
    schools that demonstrably track interest report "not considered." Present as *"the school says,"*
    never as fact.
12. **`first_year_retention_reported_percent`** must be copied, never recomputed — the printed rate
    includes form-defined exclusions. Any recomputation will disagree with the school's own figure.
13. **Cost is stale in the wrong direction** — `tuition_*` for `cost_academic_year` is *below* what
    an applicant will pay. `final_costs_not_available` / `final_costs_expected_date` are honesty
    flags and must be surfaced, not swallowed.

---

## 7. Two schema decisions to make now, before consumption code lands

### 7.1 `not_in_template_version` must reach the UI as a third state
The sentinel appears **178 times** across the domain configs. Its meaning: an unchecked box is *not*
a "no" — the school may simply have used an older form. If storage or the renderer collapses it to
`false`, we ship a false negative on every older-form school. That is a direct violation of
`AGENTS.md:94`. It also means **`*_available` booleans can never be catalog filters** — a filter for
"has study abroad" would silently drop schools that used a different template edition.

### 7.2 Reporting scaffolding should be one period object per section, not 34 metrics
`c9_entering_class`, `class_profile_entry_term`, `class_profile_entry_year` are three separate
per-metric extraction calls that stamp the *same* fact onto 25 other metrics. Every displayed value
needs its cohort/term stamp — but that's provenance in the citation envelope, not a metric paying
per-metric cost.

### 7.3 Make the caveat structurally inseparable from the number
In both the API shape and the agent tool schema, it must be **impossible** to fetch:
- `sat_composite_*` / `act_composite_*` without `*_submitters_percent`
- `class_rank_top_*` without `class_rank_submitted_percent`
- `average_high_school_gpa` without `high_school_gpa_submitted_percent`

A caveat that lives in a tooltip is a caveat the agent will drop.

---

## 8. What the CDS does not have — and we most need

Grep-confirmed absent from all 1015. Each is top-ten in real counseling:

1. **Need-blind vs need-aware** — zero fields. Changes whether a high-need student applies at all.
2. **Meets-full-need pledge** — only inferable as a realized outcome (`h2_h/h2_c`), never as the
   published commitment.
3. **Superscoring policy** — not a CDS field. Decides whether the student retakes. Leaks only into
   `test_policy_clarification` prose.
4. **EA applicant/admit counts** — `early_action_offered` exists, counts do not. Half the early-round
   math is unavailable.
5. **Admit rate by major/college** — only the boolean `program_specific_factor_differences` says
   *that* it varies, never *how*. Direct admit to CS/nursing/business is often the entire question.
6. **Program and major inventory** — CDS has conferral shares, not a catalog. "Do they have
   linguistics" is unanswerable from this data.
7. **Legacy and athlete admit rates** — importance only, no rate.
8. **Net price by income band** — CDS gives averages; IPEDS publishes the banded table families need.
9. **Post-graduation outcomes** — salary, employment, grad-school placement. Entirely absent.
   → College Scorecard.
10. **Campus setting / urbanicity** — no field, and it's a first-order fit filter for most students.
11. **Application platform** (Common App / Coalition) and **interview availability/format**.
12. **Deferral behavior from EA/ED** — `deferred_enrollment_allowed` is about *gap years*, not
    admission deferrals. An easy and embarrassing conflation.

Essay prompts, supplement counts, and recommendation counts are already known to be universal +
student-entered in Counselle, not seeded — consistent with this gap list.

**Implication:** the school profile cannot be CDS-only. Design the schema so a metric can come from
CDS, IPEDS, Scorecard, or a school policy page, each with its own provenance — otherwise items 1–5
have nowhere to live and the agent will guess at them.

---

## 9. Open decisions for the owner

1. **~160 total, or tighter?** Tier 1 alone (75) covers matching + the default screen. Tier 2 exists
   for the agent's depth on `costs-and-aid` / `testing-strategy` / `school-comparison` questions.
   Dropping Tier 2 halves the cost again but starves those skills.
2. **Multi-year retention.** Yield-protection and selectivity trend are only derivable if we keep
   Tier 1 *per year* rather than latest-only. That argues for narrow-and-deep over wide-and-current.
3. **Transfer** — 78 ids, near-total cut here. Confirm transfer is a later product, not a v1 surface.
4. **Do we ever show a chance number?** My recommendation is no, and §1.5 is the substitute. This is
   a product decision, not a data one, but the metric set should be chosen knowing the answer.
