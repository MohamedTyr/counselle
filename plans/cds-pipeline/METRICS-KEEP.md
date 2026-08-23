# CDS metrics — the keep list

**Supersedes `METRICS-TRIAGE.md`**, which optimized for cost and cut too far. This document
answers the actual question: *what is the complete set of metrics the agent, the matching
algorithm, and the student need for the admissions process?*

**Verdict: keep 394 of 1149. Cut 755.**

Produced by three parallel domain triages plus two independent passes over the money domains,
then reconciled and put through two adversarial reviews. Every id below was verified to exist in
`config/cds/domains/*.yaml`.

> **Correction:** earlier drafts said the catalog held **1015** metrics. That was an undercount —
> it came from `grep '^  - id:'`, which misses the inline `{id: ...}` form that `enrollment.yaml`
> uses for all 134 of its metrics. The real total is **1149**. The keep list is unaffected; the
> cut count rises from 623 to 755.

---

## The three consumers

Every metric here earns its place by serving at least one of:

1. **The agent** — when a student asks about a university, it can answer anything that matters
   for admissions and decision-making without leaving the database. This is what separates a
   specialized admissions agent from a generic model with a search box.
2. **The chancing / matching algorithm** — classifies a school high-reach / reach / possible /
   likely *for this student*, weighing transcript rigor, grade trend, major pressure, test score
   against the current middle 50%, selectivity, affordability, and residency. It classifies risk.
   It never emits a fake probability.
3. **The student browsing the school page** — enough depth, in the right hierarchy, that they read
   our database instead of Niche, CollegeVine, or US News.

## Why 394 and not 160

The earlier pass reasoned from extraction cost — recall is 65.6% on Harvard, the best-formatted
CDS in the corpus (`AGENTS.md:25`), so fewer metrics extracted better. That logic is sound but it
answered the wrong question. Coverage for the three consumers is the requirement; the cut is a
byproduct.

The cuts are not a budget target — each family dies for a specific reason. These are the largest
families, independently counted by grep. **This table is not a complete accounting of all 755 cuts**;
the remainder is a long tail of one-off free-text, bookkeeping, and scaffolding fields listed in the
per-domain CUT sections of the source triage reports.

| Reason | Count | Verified |
|---|---|---|
| Gender-split cells (`*_men` / `*_women` / `*_another_gender` / `*_unknown`) | 135 | exact grep |
| Score/GPA band histograms (redundant with p25/p50/p75) | 86 | exact grep |
| Associate + diploma/certificate CIP columns | 84 | exact grep |
| `_all_full_time` / `_less_than_full_time` H2 population twins | 32 | exact grep |
| Race/ethnicity enrollment cells | 29 | see note below |
| Club, ensemble, and housing-type checkbox inventories | 33 | approx |
| H1 institutional aid dollar-ledger | 24 | exact |
| Pell / Stafford / prior-cohort graduation splits | 47 | approx |
| Two-year-college outcomes and transfer off-term duplication | 48 | approx |
| Faculty credential and demographic grid | 27 | approx |
| Contact-card atoms (street, phone, mailing address) | 26 | approx |
| Reporting scaffolding (`*_entry_term`, `*_window_start/end`, `cip_version`) | 34 | approx |

**Note on the race/ethnicity row:** the B2 grid holds 30 cells across 9 categories × 3 populations
plus reported-totals. **29 are cut; `nonresident_all_undergraduates` is kept** — international share
is a structural fit fact, not a race fact. An earlier draft of this table said 30 and contradicted
the keep list.

## What the liability cut removes, and why it is not negotiable

**164 metrics die because of what they invite a reader to infer, not because they cost anything.**
All 135 gender-split cells and 29 of the 30 race/ethnicity cells. `applicants_women` beside
`admitted_women` reads as a gendered admit rate; the same shape by race reads as odds-by-race.
The CDS never publishes admit rate by any protected class, so that inference is not in the data —
we would be manufacturing it. `_another_gender` cells are frequently 0–5 students at a named
institution, which is a disclosure problem on top of an inference problem.

Kept instead: `undergraduate_gender_model` (coed / women's / men's college), a structural fact
about the institution and a real search filter, and `nonresident_all_undergraduates` as an
international-share *fit* fact.

**Where the line actually falls: Pell is not a protected class.** An earlier draft cut the Pell and
subsidized-Stafford graduation splits under the same rule. That over-applied it. Pell status is a
socioeconomic fact, not a protected characteristic, and "do low-income students actually graduate
here?" is a question the College Scorecard and Third Way already publish answers to — it is
mainstream, checkable, and one of the more useful things a first-generation family can know.

So the rule is narrower than "no subgroup data." It is: **do not surface a subgroup cell that lets a
reader infer their own admissions odds or outcome from a characteristic they cannot change and that
the data does not actually measure.** Under that rule:

- **Cut:** the 47-cell Pell / Stafford / prior-cohort *grid* — eight-row cohort mechanics per group,
  mirrored across a stale comparison cohort. That is IPEDS plumbing, small-*n*, and six years old.
- **Kept:** `primary_pell_grant_six_year_graduation_rate_ratio` — the single published headline
  figure, displayed with its cohort year, never matched against the student's own aid profile as a
  prediction.

## Three schema decisions to make before consumption code lands

**1. `not_in_template_version` must survive to the UI as a third state.** The sentinel appears 178
times. An unchecked box is *not* a "no" — the school may have used an older template edition. If
storage or the renderer collapses it to `false`, we ship a false negative on every older-form
school, violating `AGENTS.md:94`. It also means **no boolean carrying this sentinel can ever be a
catalog filter** — filtering "has study abroad" would silently drop schools that used a different
form.

**2. Make the caveat structurally inseparable from the number.** In both the API shape and the
agent tool schema it must be *impossible* to fetch:
- `sat_composite_*` / `act_composite_*` without `sat_submitters_percent` / `act_submitters_percent`
- `class_rank_top_*` without `class_rank_submitted_percent`
- `average_high_school_gpa` without `high_school_gpa_submitted_percent`

Under test-optional review the percentiles describe *submitters only*, a self-selected high-scoring
subset. A caveat that lives in a tooltip is a caveat the agent drops.

**3. String-typed percents are the biggest correctness hazard in this list — bigger than it first
appears.** `primary_all_students_six_year_graduation_rate_ratio` is a 0–1 number ("0.94") sitting in
the same packet as `first_year_retention_reported_percent`, a string ("96%"). But this is not one
odd field: **58 of the 394 kept metrics are percent-semantic `type: string`**, deliberately
preserving tokens like `"<1%"`. That includes **every kept `*_bachelors_percent` (38), every class-rank
band, and both test-submitter rates** — precisely the fields the chancing and testing-strategy logic
does comparisons on.

The string typing is correct and must not be "fixed" at extraction — the qualifier is real
information. The contract belongs at the consumption boundary:
- Display keeps the raw string, qualifier and all.
- The matching math parses to a nullable float and treats unparseable as **missing, never zero**.
- No `type: string` percent may back a numeric sort or range filter without an explicit parsed
  companion field.

## Two domains no longer justify a packet

The agent fetches whole domains via `get_domain(unitid, domain_id)`. After the cut:

- **`enrollment` drops to 4 metrics** (undergrad / grad / total size, international share). Fold
  into an overview or identity-adjacent packet.
- **`faculty` drops to 4** (full-time / part-time and terminal-degree headcounts). `students_per_faculty`
  already lives in `class_size`; fold these there.

**`transfer` (23) should be gated** behind an explicit "I'm transferring" signal rather than shipped
in the default packet for a first-year applicant.

---

# The keep list

## admissions — keep 98 of 152

| metric id | why it matters | serves |
|---|---|---|
| `applicants_total` | base for admit rate; every chancing call starts here | chancing / browse |
| `admitted_total` | base for admit rate | chancing / browse |
| `enrolled_total` | base for yield | chancing / browse |
| `applicants_residency_in_state` | in-state applicant pool size at publics changes the whole odds calculus | chancing |
| `applicants_residency_out_of_state` | OOS pool for the residency-specific rate | chancing |
| `applicants_residency_international` | denominator for intl admit rate — the fingerprint that inverts the reach ladder | chancing |
| `admitted_residency_in_state` | numerator for in-state admit rate at publics | chancing |
| `admitted_residency_out_of_state` | numerator for OOS admit rate — often half the in-state rate | chancing |
| `admitted_residency_international` | intl admit rate is the single number that reclassifies "safety" publics into reaches for aid-needing internationals | chancing |
| `enrolled_residency_international` | only surviving count of the actual international population on campus once gender/race splits are cut | browse |
| `has_waitlist_policy` | tells the student whether "waitlisted" is even a live outcome here | agent / browse |
| `waitlist_offered_place_count` | waitlist size sets expectations for a waitlisted student | agent / browse |
| `waitlist_accepted_place_count` | how many stayed on the list — context for the offered→admitted rate | agent / browse |
| `waitlist_admitted_count` | numerator for waitlist admit rate — "is the waitlist real or theater" | chancing / browse |
| `high_school_completion_requirement` | eligibility gate — diploma/GED requirement | agent |
| `college_prep_program_requirement` | eligibility gate — some schools require a formal college-prep track | agent |
| `total_academic_units_required` | baseline rigor bar for the transcript-rigor read | chancing |
| `total_academic_units_recommended` | schools often recommend more than they require — the real expectation | chancing |
| `english_units_required` | subject-specific unit floor | chancing |
| `english_units_recommended` | subject-specific real expectation | chancing |
| `mathematics_units_required` | subject-specific unit floor | chancing |
| `mathematics_units_recommended` | subject-specific real expectation, esp. for STEM majors | chancing |
| `science_units_required` | subject-specific unit floor | chancing |
| `science_units_recommended` | subject-specific real expectation | chancing |
| `lab_science_units_required` | distinguishes lab science from general science — rigor detail | chancing |
| `lab_science_units_recommended` | rigor detail | chancing |
| `foreign_language_units_required` | unit floor, often the most-missed requirement by transfer/international students | chancing |
| `foreign_language_units_recommended` | real expectation | chancing |
| `social_studies_units_required` | unit floor | chancing |
| `social_studies_units_recommended` | real expectation | chancing |
| `history_units_required` | unit floor | chancing |
| `history_units_recommended` | real expectation | chancing |
| `academic_electives_units_required` | unit floor | chancing |
| `academic_electives_units_recommended` | real expectation | chancing |
| `computer_science_units_required` | rising requirement at CS-heavy schools | chancing |
| `computer_science_units_recommended` | real expectation, relevant to CS-major pressure | chancing |
| `visual_performing_arts_units_required` | unit floor | chancing |
| `visual_performing_arts_units_recommended` | real expectation | chancing |
| `other_units_required` | unit floor for institution-defined subject | chancing |
| `other_units_recommended` | real expectation | chancing |
| `other_subject_label` | names what the "other" unit category actually is — required to read the number above | agent |
| `open_admission_all_students` | tells the agent this school isn't selective at all — resets the whole chancing frame | chancing / browse |
| `open_admission_selective_out_of_state` | OOS applicants face real selection even at an open-admission school | chancing |
| `open_admission_selective_programs` | some programs are selective even at an open campus — major-pressure signal | chancing |
| `open_admission_other` | catches remaining open-admission carve-outs | agent |
| `selection_factor_rigor_of_secondary_school_record` | #1 weighted factor in the chancing order — literally what "rigor in school context" means to this school | chancing / agent |
| `selection_factor_class_rank` | tells the agent whether rank matters here before quoting class-rank data | chancing |
| `selection_factor_academic_gpa` | how heavily GPA is weighted vs. rigor/rank | chancing |
| `selection_factor_standardized_tests` | how heavily scores are weighted — feeds directly into testing-strategy's submit/withhold call | chancing / agent |
| `selection_factor_application_essay` | tells the student how much the essay can move the needle | agent |
| `selection_factor_recommendations` | weight of LORs in the file | agent |
| `selection_factor_interview` | whether to bother scheduling one | agent |
| `selection_factor_extracurricular_activities` | weight of ECs vs. academics | chancing |
| `selection_factor_talent_ability` | signals arts/athletic-talent pathways | agent |
| `selection_factor_character_personal_qualities` | holistic-review signal | agent |
| `selection_factor_first_generation` | first-gen boost — a real, checkable hook | chancing |
| `selection_factor_alumni_relation` | legacy weight — directly relevant, controversial, and asked about constantly | chancing / agent |
| `selection_factor_geographic_residence` | geographic diversity preference — matters for rural/underrepresented-region applicants | chancing |
| `selection_factor_state_residency` | residency weight in admission itself (distinct from the numeric split above) | chancing |
| `selection_factor_religious_affiliation_commitment` | relevant at faith-affiliated schools | agent |
| `selection_factor_volunteer_work` | weight of service record | agent |
| `selection_factor_work_experience` | weight of jobs/family-responsibility context | agent |
| `selection_factor_level_of_applicant_interest` | demonstrated-interest schools reward visits/opens — directly actionable | chancing / agent |
| `program_specific_factor_differences` | the one prose field that can name an oversubscribed-major carve-out no structured field captures | chancing |
| `uses_entrance_exam_scores_in_admission` | whether scores enter review at all this edition | chancing / agent |
| `sat_or_act_admission_policy` | required/optional/blind snapshot — starting point before the mandatory .edu re-verify | testing-strategy |
| `act_only_admission_policy` | ACT-only acceptance is a real, if rare, constraint | testing-strategy |
| `sat_only_admission_policy` | SAT-only acceptance is a real, if rare, constraint | testing-strategy |
| `test_policy_clarification` | the prose that can carry "test-blind except nursing" — no structured field holds this | testing-strategy |
| `has_application_fee` | affordability floor before a student even applies | browse / agent |
| `application_fee_amount` | actual dollar figure families budget against | browse |
| `need_based_application_fee_waiver_available` | removes a real barrier for low-income applicants | agent / chancing |
| `has_application_closing_date` | rolling vs. deadline-based — frames the whole round conversation | agent |
| `application_closing_date_fall` | the deadline itself | agent / browse |
| `application_priority_date` | earlier soft deadline that affects aid/scholarship consideration | agent |
| `accepts_first_year_terms_other_than_fall` | spring-admit option changes round strategy for borderline applicants | agent |
| `decision_notification_mode` | rolling vs. fixed-date framing for when to expect news | agent |
| `decision_rolling_begin_date` | when rolling notifications start, if rolling | agent |
| `decision_by_date` | fixed notification date | agent / browse |
| `reply_policy_mode` | how the reply deadline is structured | agent |
| `reply_deadline` | May 1-style deadline the family must hit | agent / browse |
| `reply_weeks_after_late_notification` | protects late admits/waitlist offers from missing the reply window | agent |
| `housing_deposit_deadline` | second deposit the family must budget and schedule for | browse |
| `housing_deposit_amount` | dollar figure for the housing deposit | browse |
| `housing_deposit_refundability` | whether the deposit is recoverable if plans change | browse |
| `deferred_enrollment_allowed` | gap-year feasibility | agent |
| `deferred_enrollment_max_period` | how long a gap year can run | agent |
| `early_decision_offered` | whether binding ED is even on the table — first round-strategy fork | chancing / agent |
| `early_decision_first_closing_date` | ED1 deadline | agent / browse |
| `early_decision_first_notification_date` | ED1 notification date | agent / browse |
| `early_decision_other_closing_date` | ED2 deadline, if offered — key for students who miss ED1 | agent / browse |
| `early_decision_other_notification_date` | ED2 notification date | agent / browse |
| `early_decision_application_count` | numerator/denominator base for the ED admit-rate edge (spend-a-round-here call) | chancing |
| `early_decision_admitted_count` | ED admit count — feeds the ED-vs-RD gap discussion | chancing |
| `early_action_offered` | non-binding early round availability | chancing / agent |
| `early_action_closing_date` | EA deadline | agent / browse |
| `early_action_notification_date` | EA notification date | agent / browse |
| `early_action_restrictive` | REA/SCEA blocks other EA/ED elsewhere — a binding constraint on the whole round plan | chancing / agent |

## class_profile — keep 36 of 127

| metric id | why it matters | serves |
|---|---|---|
| `sat_submitters_percent` | tells the agent how much weight the SAT band below actually carries under test-optional review | testing-strategy |
| `sat_submitters_count` | small submitter counts make the band noisier — context for how much to trust the percentile | testing-strategy |
| `act_submitters_percent` | same, for ACT | testing-strategy |
| `act_submitters_count` | same, for ACT | testing-strategy |
| `sat_composite_p25` | the withhold threshold in the testing-strategy decision rule | testing-strategy / chancing |
| `sat_composite_p50` | the submit threshold in the testing-strategy decision rule | testing-strategy / chancing |
| `sat_composite_p75` | top of the middle 50 — "did I clear the range" browse stat | browse / testing-strategy |
| `sat_ebrw_p25` | section-specific band for a humanities-file submit call | testing-strategy |
| `sat_ebrw_p50` | section-specific median | testing-strategy |
| `sat_ebrw_p75` | section-specific top-of-range | testing-strategy |
| `sat_math_p25` | section-specific band for a STEM-file submit call | testing-strategy |
| `sat_math_p50` | section-specific median | testing-strategy |
| `sat_math_p75` | section-specific top-of-range | testing-strategy |
| `act_composite_p25` | ACT withhold threshold | testing-strategy / chancing |
| `act_composite_p50` | ACT submit threshold | testing-strategy / chancing |
| `act_composite_p75` | top of ACT middle 50 | browse / testing-strategy |
| `act_math_p25` | STEM-file section read | testing-strategy |
| `act_math_p50` | STEM-file section read | testing-strategy |
| `act_math_p75` | STEM-file section read | testing-strategy |
| `act_english_p25` | humanities-file section read | testing-strategy |
| `act_english_p50` | humanities-file section read | testing-strategy |
| `act_english_p75` | humanities-file section read | testing-strategy |
| `act_science_p25` | STEM-adjacent section read; part of ACT's 4 core sections | testing-strategy |
| `act_science_p50` | same | testing-strategy |
| `act_science_p75` | same | testing-strategy |
| `act_reading_p25` | humanities-adjacent section read | testing-strategy |
| `act_reading_p50` | same | testing-strategy |
| `act_reading_p75` | same | testing-strategy |
| `class_rank_submitted_percent` | tells the agent how much weight to put on the rank stats below | chancing |
| `class_rank_top_tenth_percent` | classic "how academically strong is the enrolled class" stat, used constantly in real counselor conversations | chancing / browse |
| `class_rank_top_quarter_percent` | same, wider band | chancing / browse |
| `class_rank_top_half_percent` | same, wider band | browse |
| `class_rank_bottom_half_percent` | shows the class isn't all top-decile — realistic-fit context | browse |
| `class_rank_bottom_quarter_percent` | same | browse |
| `average_high_school_gpa` | the single most-quoted stat for "is my GPA competitive here" | chancing / browse |
| `high_school_gpa_submitted_percent` | tells the agent how reliable the average above is | chancing |

## identity — keep 14 of 50

| metric id | why it matters | serves |
|---|---|---|
| `institution_name` | the school's canonical name — anchors every answer | agent / browse |
| `academic_year` | the vintage stamp every other domain's numbers must be read against; without it a stale admit-rate looks current | agent / chancing |
| `city` | location is a top-3 fit factor for families — urban/rural, distance from home | browse |
| `state_or_region` | needed for residency classification and regional fit | chancing / browse |
| `country` | needed for international-applicant framing | chancing / browse |
| `main_website` | the student's jumping-off point to verify current policy per the skills' `.edu` mandate | agent / browse |
| `admissions_email` | practical contact when a family has a question the database can't answer | browse |
| `application_url` | direct link to apply — high practical value, zero ambiguity | browse |
| `institutional_control` | public vs. private — drives residency-based cost/odds logic and culture fit | chancing / browse |
| `undergraduate_gender_model` | coed vs. women's/men's college — structural fact that changes the applicant pool itself, not a liability field | agent / browse |
| `academic_calendar` | semester/quarter/trimester affects course load pacing, transfer credit, internship timing | agent / browse |
| `degree_offered_bachelors` | confirms this is a 4-year-degree-granting institution | agent |
| `degree_offered_masters` | signals graduate-program depth relevant to major-and-fit (research access, 4+1 pathways) | agent / browse |
| `degree_offered_doctoral_research_scholarship` | research-doctorate offering is a real research-intensity signal for a student weighing undergrad research access | agent / browse |

## financial_aid — keep 67 of 169

| metric id | why it matters | serves |
|---|---|---|
| `aid_reporting_academic_year` | pins every H1-H6 figure to a year so the agent can flag a stale/last-edition number before quoting it | agent / chancing |
| `aid_reporting_status` | estimated vs final tells the agent whether to hedge the number as provisional | agent |
| `need_analysis_methodology` | Federal vs Institutional methodology changes whether home equity/business assets count against the family — directly moves the real net-price number | agent / browse |
| `h2_a_degree_seeking_undergraduates_first_time_first_year` | base cohort size for every other H2 rate below — needed to sanity-check the percentages | agent |
| `h2_b_applied_for_need_based_aid_first_time_first_year` | how many incoming freshmen even bothered applying for aid — signals aid culture | agent / browse |
| `h2_c_determined_have_need_first_time_first_year` | % of applicants with demonstrated need — baseline for "will we likely have need" | agent / chancing |
| `h2_d_awarded_any_aid_first_time_first_year` | headline "how many freshmen get any aid" stat families ask first | agent / browse |
| `h2_e_awarded_need_based_grant_aid_first_time_first_year` | % who got need-based grant (not just loans) — core affordability signal | agent / chancing / browse |
| `h2_f_awarded_need_based_self_help_aid_first_time_first_year` | % whose need package leans on loans/work-study vs grants — debt-load signal | agent |
| `h2_g_awarded_non_need_based_grant_aid_first_time_first_year` | % getting merit aid regardless of need — the merit-scholarship path families ask about | agent / chancing |
| `h2_h_need_fully_met_count_first_time_first_year` | count with 100% need met — the real test of a "meets full need" claim, not the marketing pledge | agent / chancing |
| `h2_i_average_percent_need_met_first_time_first_year` | THE number for "can we afford this" — average % of demonstrated need actually covered | agent / chancing / browse |
| `h2_j_average_aid_package_first_time_first_year` | average total aid $ — headline comparison figure across schools | agent / chancing / browse |
| `h2_k_average_need_based_grant_award_first_time_first_year` | average free-money (grant) portion — separates real aid from loans | agent / browse |
| `h2_l_average_need_based_self_help_award_first_time_first_year` | average loan+work-study burden in the need package — debt exposure | agent |
| `h2_m_average_need_based_loan_award_first_time_first_year` | average loan-only amount — direct debt-at-entry estimate | agent / browse |
| `h2a_n_no_need_institutional_grant_recipients_first_time_first_year` | count getting merit aid with zero demonstrated need — proves merit scholarships exist beyond marketing | agent / chancing |
| `h2a_o_average_no_need_institutional_grant_amount_first_time_first_year` | average merit-only award size — what a strong applicant can realistically expect | agent / chancing / browse |
| `h2a_p_institutional_athletic_grant_recipients_first_time_first_year` | athletic aid recipient count — relevant for recruited-athlete families | agent |
| `h2a_q_average_institutional_athletic_grant_amount_first_time_first_year` | average athletic award size | agent |
| `h5_borrowers_any_program_percent_of_class` | % of graduates who borrowed at all — headline debt-risk stat used everywhere (Niche/US News quote this) | agent / browse |
| `h5_borrowers_any_program_average_principal` | average cumulative debt at graduation — the "how much debt will my kid have" number | agent / browse |
| `h5_borrowers_private_percent_of_class` | % relying on private (non-federal, no borrower protections) loans — red flag for aid-package gaps | agent |
| `h5_borrowers_private_average_principal` | average private-loan debt — quantifies the red flag above | agent |
| `h6_need_based_grants_available` | whether need-based institutional aid exists for **nonresident/international** students — the fingerprint fact that inverts the international chancing ladder | agent / chancing |
| `h6_non_need_based_grants_available` | whether merit aid exists for international students — alternate path when need-based aid is thin | agent / chancing |
| `h6_grants_unavailable` | explicit "no institutional aid for internationals" flag — the bluntest form of the international-affordability check | agent / chancing / browse |
| `h6_recipient_count` | how many internationals actually got aid — tests whether availability is real or symbolic | agent / chancing |
| `h6_average_institutional_aid` | average aid $ per international recipient — lets the agent size a realistic package instead of guessing | agent / chancing / browse |
| `h7_css_profile_required` | CSS Profile requirement for international/nonresident applicants signals a deeper (institutional-methodology) review — process a family must plan for | agent |
| `h8_css_profile_required` | CSS Profile requirement for domestic applicants — same methodology signal, decides which calculator to trust | agent / browse |
| `h8_noncustodial_profile_required` | divorced/separated-parent families must plan for a second parent's financial disclosure — named explicitly in the costs-and-aid playbook as a number-mover | agent |
| `h8_business_farm_supplement_required` | business/farm-owning families face extra asset scrutiny — named explicitly in the costs-and-aid playbook as a number-mover | agent |
| `h14_academics_non_need_based` | academic merit scholarships exist — real path to reduce cost for a strong student | agent / chancing |
| `h14_alumni_affiliation_non_need_based` | legacy merit money exists — niche but real lever for legacy families | agent |
| `h14_art_non_need_based` | talent-based art scholarships exist — relevant to arts-focused applicants | agent / chancing |
| `h14_athletics_non_need_based` | athletic merit money exists outside formal recruiting — relevant to walk-on/club athletes | agent |
| `h14_athletics_need_based` | at need-based-only schools (Ivies, most D3) this is the ONLY athletic-aid field — without it the recruited-athlete question is unanswerable exactly where it's asked most | agent / chancing |
| `h14_job_skills_non_need_based` | job-skills-based merit criterion — niche but a real differentiator between schools | agent |
| `h14_rotc_non_need_based` | ROTC-linked institutional aid exists — relevant to military-track families | agent |
| `h14_leadership_non_need_based` | leadership-based merit scholarships exist — common differentiator for holistic-admit schools | agent / chancing |
| `h14_minority_status_non_need_based` | minority-status merit scholarships exist — real, policy-sensitive differentiator (verify current legality via .edu, but existence-as-of-CDS is a fact) | agent |
| `h14_music_drama_non_need_based` | performing-arts talent scholarships exist — relevant to arts applicants | agent / chancing |
| `h14_religious_affiliation_non_need_based` | religious-affiliation merit aid exists — relevant at faith-affiliated schools | agent |
| `h14_state_district_residency_non_need_based` | residency-linked merit aid exists — stacks with the in-state/out-of-state cost delta | agent / chancing |
| `recent_affordability_initiative_details` | verbatim narrative of no-loan/free-tuition-below-$X-income pledges — the closest thing CDS has to an income-threshold commitment; often names a real dollar threshold | agent / chancing / browse |
| `h2_i_average_percent_need_met_all_full_time` | paired with the fttf value, exposes whether packages get less generous after freshman year — a real family fear | agent |
| `h2_j_average_aid_package_all_full_time` | front-loading check against the fttf package — catches "generous year 1, cut after" | agent |
| `graduating_class_first_time_bachelors_count` | base cohort size behind every H5 debt stat — needed to judge whether the debt figures are robust | agent |
| `h6_total_institutional_aid` | total dollars committed to nonresident aid — signals how seriously the school funds this population | agent |
| `h7_institution_form_required` | tells an international family whether they must also file the school's own form, not just apply | agent (process step) |
| `h8_institution_form_required` | domestic applicants' extra-form burden beyond FAFSA | agent |
| `h8_state_aid_form_required` | flags a state-grant-eligibility step families often miss | agent |
| `aid_has_deadline` | whether a hard filing deadline exists at all — first fact needed to build the money calendar | agent |
| `aid_priority_date_selected` | whether an earlier priority date exists — the skill's core "earliest binding money date" trap | agent |
| `aid_priority_date` | the actual priority date — the number that goes in the answer | agent |
| `aid_deadline_selected` | whether a fixed hard deadline exists | agent |
| `aid_deadline_date_or_text` | the actual hard deadline date | agent |
| `aid_no_deadline_rolling_selected` | rolling filing changes the family's urgency calculus entirely | agent |
| `aid_notification_fixed_selected` | whether aid notification lands on a fixed date | agent |
| `aid_notification_fixed_date` | the date the family finds out what they'll pay | agent |
| `aid_notification_rolling_selected` | rolling notification changes how long the family waits in uncertainty | agent |
| `aid_notification_rolling_start_date` | when rolling notifications begin | agent |
| `h11_reply_deadline_date` | commit-by date — feeds directly into the ED-tradeoff and "earliest binding date" answer | agent / chancing |
| `h11_reply_weeks_after_notification` | alternate reply-window format some schools use instead of a fixed date | agent |
| `h12_state_loan_available` | not universal — signals an extra borrowing option specific to this school/state | agent |
| `h12_institution_loan_available` | not universal — an institutional loan program (or its absence, e.g. a loan-free policy) is a real differentiator | agent / browse |

## cost — keep 43 of 47

| metric id | why it matters | serves |
|---|---|---|
| `net_price_calculator_url` | the skill's own playbook tells the agent to point families at the NPC before anchoring on any number — this is the link | agent / browse |
| `cost_academic_year` | pins every cost figure to a year so the agent can flag staleness before quoting sticker price | agent / chancing |
| `final_costs_not_available` | flags when the printed figures are provisional estimates, not final — an honesty gate before the agent presents a number as settled | agent |
| `tuition_private_first_year` | sticker tuition for the exact population the applicant is (incoming private-school freshman) | agent / chancing / browse |
| `tuition_public_in_district_first_year` | lowest-cost public tuition tier — relevant when family lives in the taxing district | agent / chancing / browse |
| `tuition_public_in_state_out_of_district_first_year` | the standard in-state public tuition rate most state-resident applicants pay | agent / chancing / browse |
| `tuition_public_out_of_state_first_year` | the large out-of-state premium at publics — directly reshapes affordability and the reach/target ladder by residency | agent / chancing / browse |
| `tuition_nonresident_first_year` | CDS's own separate nonresident category (can differ from out-of-state) — needed for international/nonresident cost accuracy | agent / chancing |
| `required_fees_first_year` | mandatory fees on top of tuition — part of the real sticker total families budget against | agent / browse |
| `food_and_housing_on_campus_first_year` | the other half of cost of attendance beyond tuition — what most incoming residential freshmen actually pay | agent / chancing / browse |
| `housing_only_on_campus_first_year` | lets the agent separate housing from food when a family is pricing a meal-plan-optional or off-campus scenario | agent / browse |
| `food_only_on_campus_first_year` | same, for food-plan-optional scenarios | agent |
| `comprehensive_tuition_food_housing_amount` | fallback all-in figure for schools that don't itemize — keeps the domain coherent even when the itemized rows are blank | agent / browse |
| `other_annual_charge_response` | catches large non-tuition mandatory charges (e.g. international health insurance) that would otherwise blindside a family's budget | agent |
| `tuition_fees_vary_by_year_of_study` | tells the agent whether the freshman-year sticker price is what all four years cost, or whether it rises — a real 4-year total-cost driver | agent / chancing |
| `tuition_fees_vary_by_instructional_program` | flags major-specific tuition surcharges (common in engineering/business/nursing) — changes the answer for a specific intended major | agent / chancing |
| `higher_program_price_payer_percent` | tells the agent whether a program surcharge affects nearly everyone or a small minority, calibrating how much to warn about it | agent |
| `books_supplies_on_campus` | standard cost-of-attendance component used in aid/FAFSA budgeting and total-cost answers | agent / browse |
| `books_supplies_commuter_at_home` | budget for the "live at home and commute" affordability alternative families weigh against full sticker | agent |
| `books_supplies_commuter_not_at_home` | budget for the off-campus-but-not-with-parents scenario | agent |
| `transportation_on_campus` | cost-of-attendance component | agent |
| `transportation_commuter_at_home` | commuting cost is the dominant new expense in the live-at-home savings scenario | agent |
| `transportation_commuter_not_at_home` | same, off-campus scenario | agent |
| `other_expenses_on_campus` | rounds out the standard COA estimate used for aid/net-price comparisons | agent |
| `other_expenses_commuter_at_home` | same, live-at-home scenario | agent |
| `other_expenses_commuter_not_at_home` | same, off-campus scenario | agent |
| `food_only_commuter_at_home` | food budget for a live-at-home student — real number for a real affordability path | agent |
| `food_only_commuter_not_at_home` | food budget, off-campus commuter | agent |
| `housing_only_commuter_not_at_home` | housing budget, off-campus commuter — the biggest single line the family controls by choosing this path | agent |
| `food_and_housing_total_commuter_not_at_home` | printed combined total for the off-campus commuter scenario — lets the agent quote one number without summing itself | agent / browse |
| `tuition_per_credit_private` | enables part-time / reduced-courseload cost modeling (a real affordability lever some families use) | agent |
| `tuition_per_credit_public_in_district` | same, in-district | agent |
| `tuition_per_credit_public_in_state_out_of_district` | same, in-state | agent |
| `tuition_per_credit_public_out_of_state` | same, out-of-state | agent |
| `tuition_per_credit_nonresident` | same, nonresident/international | agent |
| `final_costs_expected_date` | gives the family a concrete date instead of a shrug when costs aren't final | agent |
| `tuition_private_undergraduates` | compared to first_year, reveals whether price rises after year one at a private school | agent |
| `tuition_public_in_district_undergraduates` | confirms in-district price stability across years | agent |
| `tuition_public_in_state_out_of_district_undergraduates` | year-over-year in-state price trajectory | agent |
| `tuition_public_out_of_state_undergraduates` | whether the OOS premium persists past year one | agent |
| `tuition_nonresident_undergraduates` | year-over-year check on the nonresident rate | agent |
| `required_fees_undergraduates` | fee trajectory across years | agent |
| `food_and_housing_on_campus_undergraduates` | whether R&B rises after year one | agent |

## outcomes — keep 10 of 114

| metric id | why it matters | serves |
|---|---|---|
| `primary_all_students_adjusted_cohort_count` | denominator for every graduation-rate comparison a family makes across schools | agent / chancing / browse |
| `primary_all_students_completed_within_four_years_count` | direct answer to "will my kid finish in 4 years" — the number families actually ask for | agent / browse |
| `primary_all_students_completed_after_four_within_five_years_count` | flags schools where students routinely need a 5th year — turns the 4-year answer into a caveat | agent / browse |
| `primary_all_students_completed_after_five_within_six_years_count` | completes the curve; high 6yr with low 4yr is a real time-to-degree (and cost) risk | agent / browse |
| `primary_all_students_completed_within_six_years_count` | cumulative completion count, needed to sanity-check the printed rate | agent / browse |
| `primary_all_students_six_year_graduation_rate_ratio` | the official comparable completion rate families put next to other schools | agent / chancing / browse |
| `first_year_retention_entering_cohort_count` | retention denominator — small cohorts mean a noisier rate | agent / browse |
| `first_year_retention_still_enrolled_next_fall_count` | retention numerator; lets the agent flag a discrepancy instead of trusting the printed percent blindly | agent / browse |
| `first_year_retention_reported_percent` | the single most-compared "will they stick it out" stat, in the school's own printed form | agent / chancing / browse |
| `primary_pell_grant_six_year_graduation_rate_ratio` | whether low-income students actually finish here — a published socioeconomic outcome (Scorecard, Third Way), not a protected-class inference; see the liability note below | agent / browse |

## degrees — keep 41 of 129

| metric id | why it matters | serves |
|---|---|---|
| `agriculture_bachelors_percent` | only signal that this CIP family is a live discipline here | chancing / major-and-fit |
| `architecture_bachelors_percent` | architecture is admit-by-major at many schools; flags whether the program exists at all | chancing / major-and-fit |
| `area_ethnic_gender_studies_bachelors_percent` | discipline presence for humanities-track applicants | agent |
| `biological_life_sciences_bachelors_percent` | pre-med/bio track signal | agent / major-and-fit |
| `business_marketing_bachelors_percent` | business is often admit-by-major; presence + rough scale matters | chancing / major-and-fit |
| `communication_journalism_bachelors_percent` | discipline presence | agent |
| `communication_technologies_bachelors_percent` | discipline presence | agent |
| `computer_information_sciences_bachelors_percent` | CS is the single most common oversubscribed major; presence/scale is core to chancing | chancing / major-and-fit |
| `construction_trades_bachelors_percent` | discipline presence | agent |
| `education_bachelors_percent` | discipline presence | agent |
| `engineering_bachelors_percent` | engineering is admit-by-major almost everywhere; core to chancing | chancing / major-and-fit |
| `engineering_technologies_bachelors_percent` | distinct from engineering proper — technology vs. ABET-engineering track | major-and-fit |
| `english_bachelors_percent` | discipline presence | agent |
| `family_consumer_sciences_bachelors_percent` | discipline presence | agent |
| `foreign_languages_literatures_linguistics_bachelors_percent` | discipline presence | agent |
| `health_professions_bachelors_percent` | nursing/allied health is classically admit-by-major | chancing / major-and-fit |
| `history_bachelors_percent` | discipline presence | agent |
| `homeland_security_law_enforcement_protective_services_bachelors_percent` | discipline presence | agent |
| `interdisciplinary_studies_bachelors_percent` | signals flexible/self-designed track availability | major-and-fit |
| `law_legal_studies_bachelors_percent` | pre-law adjacent discipline presence | agent |
| `liberal_arts_general_studies_bachelors_percent` | discipline presence | agent |
| `library_science_bachelors_percent` | discipline presence | agent |
| `mathematics_statistics_bachelors_percent` | discipline presence, data-science-adjacent | agent / major-and-fit |
| `mechanic_repair_technologies_bachelors_percent` | discipline presence | agent |
| `military_science_cip_28_bachelors_percent` | split-template variant of military science presence | agent |
| `military_science_cip_29_bachelors_percent` | split-template variant of military science presence | agent |
| `military_science_combined_cip_28_29_bachelors_percent` | combined-template variant of military science presence | agent |
| `natural_resources_conservation_bachelors_percent` | discipline presence | agent |
| `other_bachelors_percent` | Harvard-only catch-all row, preserves total coherence | agent |
| `parks_recreation_bachelors_percent` | discipline presence | agent |
| `personal_culinary_services_bachelors_percent` | discipline presence | agent |
| `philosophy_religious_studies_bachelors_percent` | discipline presence | agent |
| `physical_sciences_bachelors_percent` | pre-med/STEM track signal | agent / major-and-fit |
| `precision_production_bachelors_percent` | discipline presence | agent |
| `psychology_bachelors_percent` | one of the most commonly declared majors nationally; scale signal | agent / browse |
| `public_administration_social_services_bachelors_percent` | discipline presence | agent |
| `science_technologies_bachelors_percent` | discipline presence | agent |
| `social_sciences_bachelors_percent` | discipline presence | agent |
| `theology_religious_vocations_bachelors_percent` | discipline presence, relevant for religious-affiliation-driven searches | agent |
| `transportation_materials_moving_bachelors_percent` | discipline presence | agent |
| `visual_performing_arts_bachelors_percent` | art/music/theater track signal, BFA-adjacent | agent / major-and-fit |

## enrollment — keep 4 of 134

| metric id | why it matters | serves |
|---|---|---|
| `undergraduate_total` | headline school-size number every student compares first | browse / chancing |
| `graduate_total` | tells the student whether this is undergrad-heavy or a research university with a large grad population — shapes campus feel and TA-taught-class risk | browse |
| `all_students_total` | grand total, needed alongside the two above for a coherent size story | browse |
| `nonresident_all_undergraduates` | international/nonresident share is a legitimate structural fit fact (campus diversity, and directly gates the chancing skill's "international + full aid → no admission-safety school" rule) | chancing / browse |

## transfer — keep 23 of 77

| metric id | why it matters | serves |
|---|---|---|
| `enrolls_transfer_students` | gate check — is this school even in play for a transfer applicant | agent / chancing |
| `allows_advanced_standing_from_external_coursework` | whether credit from other colleges counts toward standing, distinct from admission itself | agent |
| `applicants_total` | transfer applicant pool size | chancing |
| `admitted_total` | with applicants_total, gives the transfer admit rate — the transfer-specific chancing baseline | chancing |
| `enrolled_total` | actual transfer yield context | agent |
| `minimum_prior_credit_threshold_applies` | below this the applicant must apply as first-year instead — changes which application track to use | agent / chancing |
| `minimum_prior_credit_value` | the actual credit-hour cutoff | agent |
| `minimum_prior_credit_unit` | unit for the cutoff (semester vs. quarter hours) — without it the value is meaningless | agent |
| `transfer_requirement_high_school_transcript` | required-document checklist — what to submit | agent |
| `transfer_requirement_college_transcripts` | required-document checklist | agent |
| `transfer_requirement_essay_personal_statement` | required-document checklist | agent |
| `transfer_requirement_interview` | required-document checklist | agent |
| `transfer_requirement_standardized_test_scores` | required-document checklist | agent |
| `transfer_requirement_prior_institution_good_standing` | eligibility bar | agent / chancing |
| `minimum_high_school_gpa` | hard eligibility floor | chancing |
| `minimum_college_gpa` | hard eligibility floor, the dominant transfer-chancing variable | chancing |
| `transfer_priority_date_fall` | actionable deadline | agent |
| `transfer_closing_date_fall` | actionable deadline | agent |
| `transfer_notification_date_fall` | actionable deadline | agent |
| `transfer_reply_date_fall` | actionable deadline | agent |
| `transfer_rolling_admission_fall` | whether deadlines even apply | agent |
| `open_admission_policy_applies` | overrides the whole chancing calculus if true | chancing |
| `lowest_eligible_course_grade` | eligibility bar on individual prior coursework | agent |

## student_life — keep 13 of 63

| metric id | why it matters | serves |
|---|---|---|
| `out_of_state_percent_undergraduates` | tells a student whether this is a mostly-local or national/regional draw campus | browse |
| `fraternity_joiners_percent_undergraduates` | Greek-life scale — a real social-culture differentiator | browse |
| `sorority_joiners_percent_undergraduates` | Greek-life scale | browse |
| `college_owned_housing_percent_undergraduates` | residential vs. commuter campus — changes the whole social experience | browse |
| `off_campus_or_commute_percent_undergraduates` | complements housing percent; a high commuter share means weekend life looks very different | browse |
| `age_25_or_older_percent_undergraduates` | traditional-age vs. adult-learner-heavy campus | browse |
| `average_age_full_time_undergraduates` | quick single-number "typical student" signal for full-time undergrads | browse |
| `army_rotc_on_campus` | structural fact for ROTC-scholarship applicants, real discriminating power (not every school has it) | agent |
| `army_rotc_at_cooperating_institution` | school may lack on-campus Army ROTC but allow cross-enrollment — changes feasibility | agent |
| `naval_rotc_on_campus` | same, Navy/Marine option | agent |
| `naval_rotc_at_cooperating_institution` | same | agent |
| `air_force_rotc_on_campus` | same, Air Force option | agent |
| `air_force_rotc_at_cooperating_institution` | same | agent |

## academics — keep 24 of 34

| metric id | why it matters | serves |
|---|---|---|
| `special_study_accelerated_program` | signals a compressed-degree option, relevant for cost-conscious families | agent |
| `special_study_cross_registration` | access to a consortium's courses (e.g. Five College, Claremont) — real curriculum-breadth differentiator | agent / major-and-fit |
| `special_study_double_major` | whether combining fields is formally supported — directly answers a common major-and-fit question | major-and-fit |
| `special_study_dual_enrollment` | relevant to students entering with dual-enrollment credit | agent |
| `special_study_honors_program` | a real, non-universal differentiator that changes cohort/curriculum experience | browse / major-and-fit |
| `special_study_independent_study` | signals self-directed study availability, relevant for research-minded applicants | major-and-fit |
| `special_study_internships` | career-prep infrastructure, frequently asked about | agent |
| `special_study_liberal_arts_career_combination` | flags 3-2 style combined programs (e.g. LAC + engineering) — a genuine structural path some students specifically search for | major-and-fit |
| `special_study_student_designed_major` | flags whether a student can build a custom major — key for interdisciplinary-track applicants | major-and-fit |
| `special_study_study_abroad` | one of the most frequently asked "does this school offer X" questions | browse |
| `special_study_teacher_certification` | relevant for education-track applicants, changes licensure path | major-and-fit |
| `special_study_undergraduate_research` | core signal for pre-med/STEM-research-track applicants | major-and-fit |
| `required_coursework_arts_fine_arts` | one line-item in the school's core-curriculum shape | agent |
| `required_coursework_computer_literacy` | core-curriculum shape | agent |
| `required_coursework_english_composition` | core-curriculum shape | agent |
| `required_coursework_foreign_languages` | core-curriculum shape, relevant to language-avoidant or language-focused students | agent / major-and-fit |
| `required_coursework_history` | core-curriculum shape | agent |
| `required_coursework_physical_education` | core-curriculum shape | agent |
| `required_coursework_humanities` | core-curriculum shape | agent |
| `required_coursework_intensive_writing` | core-curriculum shape, relevant to writing-intensive-averse students | agent |
| `required_coursework_mathematics` | core-curriculum shape, relevant to math-avoidant humanities applicants | agent / major-and-fit |
| `required_coursework_philosophy` | core-curriculum shape | agent |
| `required_coursework_biological_physical_sciences` | core-curriculum shape | agent |
| `required_coursework_social_science` | core-curriculum shape | agent |

## faculty — keep 4 of 31

| metric id | why it matters | serves |
|---|---|---|
| `total_instructional_faculty_full_time` | with part-time, lets the agent state "% of faculty are full-time" — a real quality/access signal (adjunct-heavy vs. full-time-heavy) | agent / browse |
| `total_instructional_faculty_part_time` | see above | agent / browse |
| `doctorate_or_terminal_degree_faculty_full_time` | with part-time, supports "% of faculty hold a terminal degree" — a commonly cited credibility stat | agent / browse |
| `doctorate_or_terminal_degree_faculty_part_time` | see above | agent / browse |

## class_size — keep 17 of 22

| metric id | why it matters | serves |
|---|---|---|
| `students_per_faculty` | the single most-quoted college-comparison number; anchors every "is this a big or small school" conversation | browse / chancing / agent |
| `ratio_basis_student_fte` | lets the agent sanity-check/caveat the ratio (e.g. flag a grad-heavy FTE base inflating faculty access) | agent |
| `ratio_basis_faculty_fte` | same caveat role, faculty side | agent |
| `class_sections_2_9` | raw section-size band, needed for the "% of classes under 20" browse stat | browse |
| `class_sections_10_19` | same | browse |
| `class_sections_20_29` | same, needed for the 20-29 band and to bound the under-30 stat | browse |
| `class_sections_30_39` | same | browse |
| `class_sections_40_49` | same | browse |
| `class_sections_50_99` | needed for the "% of classes 50+" large-lecture stat | browse |
| `class_sections_100_plus` | same | browse |
| `class_subsections_2_9` | discussion/lab subsection size — reveals the "real" small-group experience hiding behind a big lecture | browse |
| `class_subsections_10_19` | same | browse |
| `class_subsections_20_29` | same | browse |
| `class_subsections_30_39` | same | browse |
| `class_subsections_40_49` | same | browse |
| `class_subsections_50_99` | same | browse |
| `class_subsections_100_plus` | same | browse |
---

# Derive, don't extract

Free arithmetic. Every one is a number a counselor says out loud, and none should cost an
extraction call.

| Derived | Formula |
|---|---|
| Admit rate | `admitted_total / applicants_total` |
| Yield | `enrolled_total / admitted_total` |
| In-state / OOS / international admit rate | `admitted_residency_X / applicants_residency_X` |
| ED admit rate | `early_decision_admitted_count / early_decision_application_count` |
| ED share of class | `early_decision_admitted_count / enrolled_total` |
| Waitlist conversion | `waitlist_admitted_count / waitlist_offered_place_count` |
| % of need-havers fully met | `h2_h_need_fully_met_count_first_time_first_year / h2_c_determined_have_need_first_time_first_year` |
| Grant share of package | `h2_k_average_need_based_grant_award_first_time_first_year / h2_j_average_aid_package_first_time_first_year` |
| Merit reach for full-pay | `h2a_n_no_need_institutional_grant_recipients_first_time_first_year / h2_a_degree_seeking_undergraduates_first_time_first_year` |
| Aid front-loading check | `h2_i_average_percent_need_met_first_time_first_year` vs `h2_i_average_percent_need_met_all_full_time` |
| 4-year completion rate | `primary_all_students_completed_within_four_years_count / primary_all_students_adjusted_cohort_count` |
| 4yr/6yr gap (paid fifth year) | six-year rate − four-year rate |
| Sticker COA | tuition row (by `institutional_control` + residency) + `required_fees_first_year` + `food_and_housing_on_campus_first_year` + books + transportation + other |
| % classes under 20 / 50+ | from the `class_sections_*` bands — **not printed on the CDS form**, must be computed |
| % faculty full-time / with terminal degree | from the four kept `faculty` headcounts |
| % international undergraduates | `nonresident_all_undergraduates / undergraduate_total` |
| Score-band placement | student score vs `[p25, p75]` → below / mid-50 / above |

---

# Traps — metrics that look useful and mislead

1. **Test percentiles without submitter rates.** Post-test-optional these describe submitters only.
   At `sat_submitters_percent` = 38%, the mid-50 is the profile of the top third of the class. A
   median that rose across a required→optional switch is a **selection artifact**, not a stronger
   class. Never tier a student on percentiles when submitters < 50%.
2. **`average_high_school_gpa`.** Scales differ (weighted 5.0, unweighted 4.0, 100-point) and CDS
   does not report which was used — Harvard prints 4.22. Never rank or diff schools on it.
3. **`h2_i_average_percent_need_met_*`.** Denominator is aid *recipients*, not all students, and it
   excludes PLUS/private loans from "need met" — a school can print 100% while the family still
   borrows. Prefer the derived `h2_h / h2_c`.
4. **ED counts combine ED I and ED II, and there are no EA counts at all** (grep-confirmed). An "RD
   rate" derived by subtraction is polluted by EA admits at any EA school and will overstate it.
   Publish the ED-advantage ratio only for ED-only schools.
5. **`waitlist_admitted_count`** swings 0 → 400 year to year. Narrative only, never a chance input.
6. **Class-rank bands are nested** (top-tenth ⊂ top-quarter). Never derive one from another or
   subtract to fill a blank. Most US high schools no longer rank.
7. **`*_bachelors_percent` is not program strength or availability.** It is a share of *degrees
   conferred* in one year, not a measure of program quality, admission difficulty, or enrollment.
   **A 0% or blank row does not mean the major doesn't exist** — it means zero conferrals that year
   or an unreported row. Use as a rough scale signal only; never say "this school doesn't offer X"
   from a blank row. *(An earlier draft also claimed double majors are double-counted, so the column
   cannot sum to 100. `degrees.yaml` contains no support for that — the word "double" does not appear
   in the file. The claim is dropped as unverified; if it matters for rendering, confirm against the
   CDS definitions page before relying on it.)*
8. **`students_per_faculty`** uses a school-chosen FTE basis (`ratio_basis_*` exist because it
   varies), and must not be recomputed from those bases. "8 to 1" at a research university and at a
   LAC are different experiences.
9. **`out_of_state_percent_undergraduates` excludes international from both numerator and
   denominator** — it is **not additive** with `nonresident_all_undergraduates`.
10. **`first_year_retention_reported_percent` must be copied, never recomputed** — the printed rate
    includes form-defined exclusions, and a recomputation will disagree with the school's own figure.
11. **`selection_factor_level_of_applicant_interest`** is the least trustworthy cell in the CDS.
    Present the whole factor table as *"the school says,"* never as fact — and check
    `program_specific_factor_differences` first, since it can override the general table for an
    oversubscribed major.
12. **Cost is stale in the wrong direction** — printed tuition is *below* what an applicant will pay.
    `final_costs_not_available` / `final_costs_expected_date` are honesty flags; surface them.
13. **`comprehensive_tuition_food_housing_amount` and the itemized cost rows are alternatives.**
    Schools that can't itemize populate one and blank the other. Check which shape is populated
    before summing or the page silently shows $0.
14. **`nonresident` ≠ `out_of_state`.** The first is citizenship/immigration status, the second is
    state residency. `h6_*` international aid must never be conflated with out-of-state tuition.

---

# What the CDS does not have — and we most need

Grep-confirmed absent from all 1015. Each is top-ten in real counseling, and each is something the
existing skills already try to reach for:

1. **Need-blind vs need-aware** — zero fields. `costs-and-aid` fingerprints this on `.edu` per school.
2. **Meets-full-need pledge** — only inferable as a realized outcome (`h2_h / h2_c`), never the pledge.
3. **Superscoring policy** — not a CDS field. `testing-strategy` routes it to `.edu`. Decides retakes.
4. **EA applicant/admit counts** — `early_action_offered` exists, counts do not. Half the early-round
   math is unavailable, which is exactly why `application-rounds` searches for the ED-vs-RD gap.
5. **Admit rate by major or college** — only the boolean `program_specific_factor_differences` says
   *that* it varies, never *how*. Direct admit to CS / nursing / business is often the whole question.
6. **Program and major inventory** — CDS has conferral shares, not a catalog. "Do they have
   linguistics" is unanswerable from this data.
7. **Net price by income band** — **confirmed absent from both money domains.** There is no income
   dimension in any metric's population or denominator. This is an IPEDS table.
   **`skills/costs-and-aid/SKILL.md` instructs the agent to "pull net price / aid-by-income-band
   from the database" — that instruction cannot be satisfied today.** Either add an IPEDS-sourced
   domain or correct the skill to point at `net_price_calculator_url` plus the kept averages.
8. **Post-graduation outcomes** — salary, employment, grad-school placement. → College Scorecard.
9. **Campus setting / urbanicity** — no field, and it is a first-order fit filter.
10. **Legacy and athlete admit rates** — importance only, no rate.
11. **Application platform** (Common App / Coalition) and **interview availability and format**.
12. **Deferral behavior from EA/ED** — `deferred_enrollment_allowed` is about *gap years*, not
    admission deferrals. An easy and embarrassing conflation.
13. **Institutional religious affiliation** — grep-confirmed absent from `identity.yaml`. There is
    `selection_factor_religious_affiliation_commitment` (whether faith commitment is weighed in
    admission) and `h14_religious_affiliation_non_need_based` (whether it attracts merit money), but
    **nothing states the school's own affiliation.** That is a first-order browse filter and a real
    fit question, and it is easy to mistake the two selection fields for it.

**Implication:** the school profile cannot be CDS-only. The schema should let a metric come from
CDS, IPEDS, Scorecard, or a school policy page, each carrying its own provenance — otherwise items
1–7 have nowhere to live and the agent will guess at them.

---

# Open decisions

1. **The 86 score/GPA band histograms** are the biggest reversible cut. `p25/p50/p75` answers every
   submit-or-withhold and "did I clear the middle 50" question, and the bands are the highest
   extraction-risk grids in the corpus. Restoring just the top band as an elite-scorer differentiator
   is the cheapest partial reversal if you want finer resolution.
2. **Aid deadlines (H9–H11, 12 metrics) were contested** between the two money passes — one cut them
   as perishable, one kept them. Kept here: missing a priority aid date forfeits the money even with
   an admission, and a stale baseline the agent verifies on `.edu` beats no baseline. Revisit if
   staleness proves misleading in practice.
3. **`h2_*_all_full_time` twins** — 32 of 34 cut, but `h2_i` and `h2_j` kept in both populations
   specifically so the agent can detect **aid front-loading** (freshman packages richer than
   continuing-student packages), a real practice worth naming to a family.
4. **Transfer** — 23 metrics, gated. Confirm transfer is not a v1 surface.
5. **Multi-year retention.** Yield protection and selectivity trend are only derivable if Tier-1
   metrics are kept *per year* rather than latest-only.
