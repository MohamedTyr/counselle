# UGA CDS 2023-2024 — AcroForm field → metric mapping

Source: `artifacts/cds-corpus/uga_2023-2024.pdf` (sha256 `f125787e6b71682faf36c717c6fb5821557ea52b50ce503f83a5d31e193f2de3`), 50 pages, **1086 interactive AcroForm fields** (777 carrying a non-empty, non-`/Off` value).

Extraction: `pypdf`, walking `/Root/AcroForm/Fields` to terminal fields; each terminal field's (or its `/Kids` widgets') indirect-object `idnum` was matched against every page's `/Annots` array to obtain the 1-indexed page. All 1086 fields resolved to a page.

Manifest: compiled live from `config/cds/` → **394 metrics**, version 5.0.2. **392 mapped**, 2 deliberately unmapped.

Status legend: `present` = the form carries the institution's answer (a filled cell, or a checkbox whose ticked/unticked state IS the answer); `blank` = a fill-in cell that exists and is empty, or a radio/Yes-No group left entirely unselected; `absent` = the question does not exist in this form edition.

## Mapping table

### academics (24 metrics)

| metric | AcroForm field(s) | page | status | value | type/unit |
|---|---|---|---|---|---|
| `academics.required_coursework_arts_fine_arts` | `ARTS` | 27 | present | true | boolean/boolean |
| `academics.required_coursework_biological_physical_sciences` | `SCI` | 27 | present | true | boolean/boolean |
| `academics.required_coursework_computer_literacy` | `CMPTR` | 27 | present | true | boolean/boolean |
| `academics.required_coursework_english_composition` | `ENG` | 27 | present | true | boolean/boolean |
| `academics.required_coursework_foreign_languages` | `LANG` | 27 | present | true | boolean/boolean |
| `academics.required_coursework_history` | `HIST` | 27 | present | true | boolean/boolean |
| `academics.required_coursework_humanities` | `HUM` | 27 | present | true | boolean/boolean |
| `academics.required_coursework_intensive_writing` | `INT_WRITING` | 27 | present | true | boolean/boolean |
| `academics.required_coursework_mathematics` | `MATH` | 27 | present | true | boolean/boolean |
| `academics.required_coursework_philosophy` | `PHILO` | 27 | present | true | boolean/boolean |
| `academics.required_coursework_physical_education` | `PHYS_EDUC` | 27 | present | true | boolean/boolean |
| `academics.required_coursework_social_science` | `SOCSCI` | 27 | present | true | boolean/boolean |
| `academics.special_study_accelerated_program` | `ACCEL_DEG` | 27 | present | true | boolean/boolean |
| `academics.special_study_cross_registration` | `CROSS_REG` | 27 | present | true | boolean/boolean |
| `academics.special_study_double_major` | `DOUBLE_MAJOR` | 27 | present | true | boolean/boolean |
| `academics.special_study_dual_enrollment` | `DUAL_ENROLL` | 27 | present | true | boolean/boolean |
| `academics.special_study_honors_program` | `SR_PROJ_SOME_HON` | 27 | present | true | boolean/boolean |
| `academics.special_study_independent_study` | `INDEP_STUDY` | 27 | present | true | boolean/boolean |
| `academics.special_study_internships` | `INTERN` | 27 | present | true | boolean/boolean |
| `academics.special_study_liberal_arts_career_combination` | `LIB_ARTS` | 27 | present | true | boolean/boolean |
| `academics.special_study_student_designed_major` | `DESIGN_MAJOR` | 27 | present | true | boolean/boolean |
| `academics.special_study_study_abroad` | `STUDY_ABRD` | 27 | present | true | boolean/boolean |
| `academics.special_study_teacher_certification` | `TEACH_CERT` | 27 | present | true | boolean/boolean |
| `academics.special_study_undergraduate_research` | `UG_RES` | 27 | present | true | boolean/boolean |

### admissions (98 metrics)

| metric | AcroForm field(s) | page | status | value | type/unit |
|---|---|---|---|---|---|
| `admissions.academic_electives_units_recommended` | `ACAD_ELECTIVE_REC` | 15 | present | 1 | number/carnegie_units |
| `admissions.academic_electives_units_required` | `ACAD_ELECTIVE_REQ` | 15 | blank | — | number/carnegie_units |
| `admissions.accepts_first_year_terms_other_than_fall` | `AP_ACCEPT_OTH` | 22 | present | true | boolean/boolean |
| `admissions.act_only_admission_policy` | `EXAM_CODE_ACT` | 17 | blank | — | enum/category |
| `admissions.admitted_residency_in_state` | `AP_ADMT_STATE_1ST_N` | 14 | present | 9149 | integer/students |
| `admissions.admitted_residency_international` | `AP_ADMT_INTL_1ST_N` | 14 | present | 289 | integer/students |
| `admissions.admitted_residency_out_of_state` | `AP_ADMT_NRES_1ST_N` | 14 | present | 6709 | integer/students |
| `admissions.admitted_total` | `AP_ADMT_1ST_N` | 14 | present | 16148 | integer/students |
| `admissions.applicants_residency_in_state` | `AP_RECD_STATE_1ST_N` | 14 | present | 18210 | integer/applicants |
| `admissions.applicants_residency_international` | `AP_RECD_INTL_1ST_N` | 14 | present | 1338 | integer/applicants |
| `admissions.applicants_residency_out_of_state` | `AP_RECD_NRES_1ST_N` | 14 | present | 23867 | integer/applicants |
| `admissions.applicants_total` | `AP_RECD_1ST_N` | 14 | present | 43416 | integer/applicants |
| `admissions.application_closing_date_fall` | `AP_DL_FRSH_DAY`, `AP_DL_FRSH_MON` | 22 | present | 1/1 | string/date |
| `admissions.application_fee_amount` | `AP_FEE_RES_D` | 22 | present | 70 | number/usd |
| `admissions.application_priority_date` | `AP_DL_PRIO_DAY`, `AP_DL_PRIO_MON` | 22 | present | 10/15 | string/date |
| `admissions.college_prep_program_requirement` | `AD_COL_PREP` | 15 | present | required | enum/category |
| `admissions.computer_science_units_recommended` | `CMPTR_UNITS_REC` | 15 | blank | — | number/carnegie_units |
| `admissions.computer_science_units_required` | `CMPTR_UNITS_REQ` | 15 | blank | — | number/carnegie_units |
| `admissions.decision_by_date` | `AP_NOTF_DL_FRSH_DAY`, `AP_NOTF_DL_FRSH_MON` | 22 | blank | — | string/date |
| `admissions.decision_notification_mode` | `AP_NOTF_DL_FRSH_I`, `AP_NOTF_DL_OTH` | 22 | present | other | enum/category |
| `admissions.decision_rolling_begin_date` | `AP_NOTF_DL_FRSH_DAY`, `AP_NOTF_DL_FRSH_MON` | 22 | blank | — | string/date |
| `admissions.deferred_enrollment_allowed` | `AD_DEFER` | 23 | present | true | boolean/boolean |
| `admissions.deferred_enrollment_max_period` | `AD_DEFER_MAX` | 23 | present | 1 academic year | string/text |
| `admissions.early_action_closing_date` | `AP_DL_EACT_DAY`, `AP_DL_EACT_MON` | 23 | present | 10/15 | string/date |
| `admissions.early_action_notification_date` | `AP_NOTF_DL_EACT_DAY`, `AP_NOTF_DL_EACT_MON` | 23 | present | 12/1 | string/date |
| `admissions.early_action_offered` | `AD_EACT` | 23 | present | true | boolean/boolean |
| `admissions.early_action_restrictive` | `AP_EACT_RESTRICT` | 23 | present | false | boolean/boolean |
| `admissions.early_decision_admitted_count` | `AP_ADMT_EDEC_N` | 23 | blank | — | integer/students |
| `admissions.early_decision_application_count` | `AP_RECD_EDEC_N` | 23 | blank | — | integer/applicants |
| `admissions.early_decision_first_closing_date` | `AP_DL_EDEC_1_DAY`, `AP_DL_EDEC_1_MON` | 23 | blank | — | string/date |
| `admissions.early_decision_first_notification_date` | `AP_NOTF_DL_EDEC_1_DAY`, `AP_NOTF_DL_EDEC_1_MON` | 23 | blank | — | string/date |
| `admissions.early_decision_offered` | `AD_EDEC` | 23 | present | false | boolean/boolean |
| `admissions.early_decision_other_closing_date` | `AP_DL_EDEC_2_DAY`, `AP_DL_EDEC_2_MON` | 23 | blank | — | string/date |
| `admissions.early_decision_other_notification_date` | `AP_NOTF_DL_EDEC_2_DAY`, `AP_NOTF_DL_EDEC_2_MON` | 23 | blank | — | string/date |
| `admissions.english_units_recommended` | `ENG_UNITS_REC` | 15 | present | 4 | number/carnegie_units |
| `admissions.english_units_required` | `ENG_UNITS_REQ` | 15 | present | 4 | number/carnegie_units |
| `admissions.enrolled_residency_international` | `EN_TOT_INTL_1ST_N` | 14 | present | 62 | integer/students |
| `admissions.enrolled_total` | `EN_TOT_1ST_N` | 14 | present | 6150 | integer/students |
| `admissions.foreign_language_units_recommended` | `LANG_UNITS_REC` | 15 | present | 3 | number/carnegie_units |
| `admissions.foreign_language_units_required` | `LANG_UNITS_REQ` | 15 | present | 2 | number/carnegie_units |
| `admissions.has_application_closing_date` | `AP_DL_FRSH` | 22 | blank | — | boolean/boolean |
| `admissions.has_application_fee` | `AP_FEE` | 22 | present | true | boolean/boolean |
| `admissions.has_waitlist_policy` | `AD_WAIT` | 14 | present | true | boolean/boolean |
| `admissions.high_school_completion_requirement` | `AD_HS_REQ_ALL` | 15 | present | diploma_required_ged_accepted | enum/category |
| `admissions.history_units_recommended` | `HIST_UNITS_REC` | 15 | blank | — | number/carnegie_units |
| `admissions.history_units_required` | `HIST_UNITS_REQ` | 15 | blank | — | number/carnegie_units |
| `admissions.housing_deposit_amount` | `HOUS_DEPOSIT_AMT` | 22 | present | 35 | number/usd |
| `admissions.housing_deposit_deadline` | `HOUS_DEPOSIT_DAY`, `HOUS_DEPOSIT_MON` | 22 | blank | — | string/date |
| `admissions.housing_deposit_refundability` | `HOUS_DEPOSIT_REFUND` | 22 | present | no | enum/category |
| `admissions.lab_science_units_recommended` | `SCI_LAB_UNITS_REC` | 15 | present | 2 | number/carnegie_units |
| `admissions.lab_science_units_required` | `SCI_LAB_UNITS_REQ` | 15 | present | 2 | number/carnegie_units |
| `admissions.mathematics_units_recommended` | `MATH_UNITS_REC` | 15 | present | 4 | number/carnegie_units |
| `admissions.mathematics_units_required` | `MATH_UNITS_REQ` | 15 | present | 4 | number/carnegie_units |
| `admissions.need_based_application_fee_waiver_available` | `AP_FEE_WAIVE` | 22 | present | true | boolean/boolean |
| `admissions.open_admission_all_students` | `AD_OPEN` | 16 | present | false | boolean/boolean |
| `admissions.open_admission_other` | `AD_OPEN_T_CHECK` | 16 | present | false | boolean/boolean |
| `admissions.open_admission_selective_out_of_state` | `AD_OPEN_MOST` | 16 | present | false | boolean/boolean |
| `admissions.open_admission_selective_programs` | `AD_OPEN_MOST` | 16 | present | false | boolean/boolean |
| `admissions.other_subject_label` | — | 15 | blank | — | string/text |
| `admissions.other_units_recommended` | `OTH_UNITS_REC` | 15 | blank | — | number/carnegie_units |
| `admissions.other_units_required` | `OTH_UNITS_REQ` | 15 | blank | — | number/carnegie_units |
| `admissions.program_specific_factor_differences` | `CDS_ACAD_NONACAD_FACTORS_TEXT` | 17 | blank | — | string/text |
| `admissions.reply_deadline` | `AP_REPLY_DL_DAY`, `AP_REPLY_DL_MON` | 22 | present | 5/1 | string/date |
| `admissions.reply_policy_mode` | `AP_REPLY_DL_MUST`, `AP_REPLY_DL_NO`, `AP_REPLY_OTH` | 22 | present | must_reply_by_date | enum/category |
| `admissions.reply_weeks_after_late_notification` | `AP_REPLY_DL_MAY1` | 22 | blank | — | integer/weeks |
| `admissions.sat_only_admission_policy` | `EXAM_CODE_SAT` | 17 | blank | — | enum/category |
| `admissions.sat_or_act_admission_policy` | `EXAM_CODE_S1A` | 17 | present | required_to_be_considered | enum/category |
| `admissions.science_units_recommended` | `SCI_UNITS_REC` | 15 | present | 4 | number/carnegie_units |
| `admissions.science_units_required` | `SCI_UNITS_REQ` | 15 | present | 4 | number/carnegie_units |
| `admissions.selection_factor_academic_gpa` | `Q111_3` | 16 | present | very_important | enum/category |
| `admissions.selection_factor_alumni_relation` | `Q112_6` | 16 | present | not_considered | enum/category |
| `admissions.selection_factor_application_essay` | `Q111_5` | 16 | present | considered | enum/category |
| `admissions.selection_factor_character_personal_qualities` | `Q112_4` | 16 | present | considered | enum/category |
| `admissions.selection_factor_class_rank` | `Q111_2` | 16 | present | not_considered | enum/category |
| `admissions.selection_factor_extracurricular_activities` | `Q112_2` | 16 | present | considered | enum/category |
| `admissions.selection_factor_first_generation` | `Q112_5` | 16 | present | considered | enum/category |
| `admissions.selection_factor_geographic_residence` | `Q112_7` | 16 | present | not_considered | enum/category |
| `admissions.selection_factor_interview` | `Q112_1` | 16 | present | not_considered | enum/category |
| `admissions.selection_factor_level_of_applicant_interest` | `Q112_13` | 16 | present | not_considered | enum/category |
| `admissions.selection_factor_recommendations` | `Q111_6` | 16 | present | considered | enum/category |
| `admissions.selection_factor_religious_affiliation_commitment` | `Q112_9` | 16 | present | not_considered | enum/category |
| `admissions.selection_factor_rigor_of_secondary_school_record` | `Q111_1` | 16 | present | very_important | enum/category |
| `admissions.selection_factor_standardized_tests` | `Q111_4` | 16 | present | important | enum/category |
| `admissions.selection_factor_state_residency` | `Q112_8` | 16 | present | not_considered | enum/category |
| `admissions.selection_factor_talent_ability` | `Q112_3` | 16 | present | considered | enum/category |
| `admissions.selection_factor_volunteer_work` | `Q112_11` | 16 | present | considered | enum/category |
| `admissions.selection_factor_work_experience` | `Q112_12` | 16 | present | considered | enum/category |
| `admissions.social_studies_units_recommended` | `SOC_UNITS_REC` | 15 | present | 3 | number/carnegie_units |
| `admissions.social_studies_units_required` | `SOC_UNITS_REQ` | 15 | present | 3 | number/carnegie_units |
| `admissions.test_policy_clarification` | `AD_TEST_POLICY_T` | 17 | blank | — | string/text |
| `admissions.total_academic_units_recommended` | `TOT_ACAD_UNITS_REC` | 15 | present | 19 | number/carnegie_units |
| `admissions.total_academic_units_required` | `TOT_ACAD_UNITS_REQ` | 15 | present | 17 | number/carnegie_units |
| `admissions.uses_entrance_exam_scores_in_admission` | `ADMS` | 17 | present | true | boolean/boolean |
| `admissions.visual_performing_arts_units_recommended` | `VISUAL_UNITS_REC` | 15 | blank | — | number/carnegie_units |
| `admissions.visual_performing_arts_units_required` | `VISUAL_UNITS_REQ` | 15 | blank | — | number/carnegie_units |
| `admissions.waitlist_accepted_place_count` | `AP_ACPT_WAIT_N` | 14 | present | 1904 | integer/students |
| `admissions.waitlist_admitted_count` | `AP_ADMT_WAIT_N` | 14 | present | 739 | integer/students |
| `admissions.waitlist_offered_place_count` | `AP_RECD_WAIT_N` | 14 | present | 3842 | integer/students |

### class_profile (36 metrics)

| metric | AcroForm field(s) | page | status | value | type/unit |
|---|---|---|---|---|---|
| `class_profile.act_composite_p25` | `ACT_COMP_25TH_P` | 19 | present | 27 | integer/score |
| `class_profile.act_composite_p50` | `ACT_COMP_50TH_P` | 19 | present | 30 | integer/score |
| `class_profile.act_composite_p75` | `ACT_COMP_75TH_P` | 19 | present | 32 | integer/score |
| `class_profile.act_english_p25` | `ACT_ENG_25TH_P` | 19 | present | 26 | integer/score |
| `class_profile.act_english_p50` | `ACT_ENG_50TH_P` | 19 | present | 31 | integer/score |
| `class_profile.act_english_p75` | `ACT_ENG_75TH_P` | 19 | present | 34 | integer/score |
| `class_profile.act_math_p25` | `ACT_MATH_25TH_P` | 19 | present | 25 | integer/score |
| `class_profile.act_math_p50` | `ACT_MATH_50TH_P` | 19 | present | 28 | integer/score |
| `class_profile.act_math_p75` | `ACT_MATH_75TH_P` | 19 | present | 31 | integer/score |
| `class_profile.act_reading_p25` | `ACT_READING_25TH_P` | 19 | present | 28 | integer/score |
| `class_profile.act_reading_p50` | `ACT_READING_50TH_P` | 19 | present | 32 | integer/score |
| `class_profile.act_reading_p75` | `ACT_READING_75TH_P` | 19 | present | 34 | integer/score |
| `class_profile.act_science_p25` | `ACT_SCIENCE_25TH_P` | 19 | present | 25 | integer/score |
| `class_profile.act_science_p50` | `ACT_SCIENCE_50TH_P` | 19 | present | 29 | integer/score |
| `class_profile.act_science_p75` | `ACT_SCIENCE_75TH_P` | 19 | present | 32 | integer/score |
| `class_profile.act_submitters_count` | `SUBMIT_ACT_N` | 19 | present | 2872 | integer/students |
| `class_profile.act_submitters_percent` | `SUBMIT_ACT_P` | 19 | present | 46.69 | string/percent |
| `class_profile.average_high_school_gpa` | `FRSH_GPA` | 21 | present | 4.14 | number/gpa |
| `class_profile.class_rank_bottom_half_percent` | `FRSH_HS_RANK_LESS50_P` | 21 | present | 0.92 | string/percent |
| `class_profile.class_rank_bottom_quarter_percent` | `FRSH_HS_RANK_LESS25_P` | 21 | blank | — | string/percent |
| `class_profile.class_rank_submitted_percent` | `FRSH_HS_RANK_SUBMIT_P` | 21 | present | 44.40 | string/percent |
| `class_profile.class_rank_top_half_percent` | `FRSH_HS_RANK_50_P` | 21 | present | 99.08 | string/percent |
| `class_profile.class_rank_top_quarter_percent` | `FRSH_HS_RANK_25_P` | 21 | present | 91.32 | string/percent |
| `class_profile.class_rank_top_tenth_percent` | `FRSH_HS_RANK_10_P` | 21 | present | 61.81 | string/percent |
| `class_profile.high_school_gpa_submitted_percent` | `FRSH_GPA_SUBMIT_P` | 21 | present | 100 | string/percent |
| `class_profile.sat_composite_p25` | `SAT1_COMP_25TH_P` | 19 | present | 1230 | integer/score |
| `class_profile.sat_composite_p50` | `SAT1_COMP_50TH_P` | 19 | present | 1320 | integer/score |
| `class_profile.sat_composite_p75` | `SAT1_COMP_75TH_P` | 19 | present | 1410 | integer/score |
| `class_profile.sat_ebrw_p25` | `SAT1_VERB_25TH_P` | 19 | present | 620 | integer/score |
| `class_profile.sat_ebrw_p50` | `SAT1_VERB_50TH_P` | 19 | present | 670 | integer/score |
| `class_profile.sat_ebrw_p75` | `SAT1_VERB_75TH_P` | 19 | present | 710 | integer/score |
| `class_profile.sat_math_p25` | `SAT1_MATH_25TH_P` | 19 | present | 600 | integer/score |
| `class_profile.sat_math_p50` | `SAT1_MATH_50TH_P` | 19 | present | 660 | integer/score |
| `class_profile.sat_math_p75` | `SAT1_MATH_75TH_P` | 19 | present | 710 | integer/score |
| `class_profile.sat_submitters_count` | `SUBMIT_SAT1_N` | 19 | present | 4289 | integer/students |
| `class_profile.sat_submitters_percent` | `SUBMIT_SAT1_P` | 19 | present | 69.73 | string/percent |

### class_size (17 metrics)

| metric | AcroForm field(s) | page | status | value | type/unit |
|---|---|---|---|---|---|
| `class_size.class_sections_100_plus` | `CLASS_SEC_7` | 40 | present | 250 | integer/sections |
| `class_size.class_sections_10_19` | `CLASS_SEC_2` | 40 | present | 1765 | integer/sections |
| `class_size.class_sections_20_29` | `CLASS_SEC_3` | 40 | present | 1088 | integer/sections |
| `class_size.class_sections_2_9` | `CLASS_SEC_1` | 40 | present | 586 | integer/sections |
| `class_size.class_sections_30_39` | `CLASS_SEC_4` | 40 | present | 502 | integer/sections |
| `class_size.class_sections_40_49` | `CLASS_SEC_5` | 40 | present | 321 | integer/sections |
| `class_size.class_sections_50_99` | `CLASS_SEC_6` | 40 | present | 313 | integer/sections |
| `class_size.class_subsections_100_plus` | `CLASS_SUBSEC_7` | 40 | blank | — | integer/sections |
| `class_size.class_subsections_10_19` | `CLASS_SUBSEC_2` | 40 | blank | — | integer/sections |
| `class_size.class_subsections_20_29` | `CLASS_SUBSEC_3` | 40 | blank | — | integer/sections |
| `class_size.class_subsections_2_9` | `CLASS_SUBSEC_1` | 40 | blank | — | integer/sections |
| `class_size.class_subsections_30_39` | `CLASS_SUBSEC_4` | 40 | blank | — | integer/sections |
| `class_size.class_subsections_40_49` | `CLASS_SUBSEC_5` | 40 | blank | — | integer/sections |
| `class_size.class_subsections_50_99` | `CLASS_SUBSEC_6` | 40 | blank | — | integer/sections |
| `class_size.ratio_basis_faculty_fte` | `UG_RATIO_FAC_N` | 39 | present | 2196 | number/faculty |
| `class_size.ratio_basis_student_fte` | `UG_RATIO_STUD_N` | 39 | present | 37090 | number/students |
| `class_size.students_per_faculty` | `UG_RATIO` | 39 | present | 17 | number/ratio |

### cost (42 metrics)

| metric | AcroForm field(s) | page | status | value | type/unit |
|---|---|---|---|---|---|
| `cost.books_supplies_commuter_at_home` | `BOOKS_COMMUTE_HOME_D` | 30 | present | 1002 | number/usd |
| `cost.books_supplies_commuter_not_at_home` | `BOOKS_COMMUTE_NOT_HOME_D` | 30 | present | 1002 | number/usd |
| `cost.books_supplies_on_campus` | `BOOKS_RES_D` | 30 | present | 1002 | number/usd |
| `cost.comprehensive_tuition_food_housing_amount` | `COMP_FEE_D` | 29 | blank | — | number/usd |
| `cost.final_costs_expected_date` | `ACAD_COA_TEXT` | 29 | present | 5/1 | string/date |
| `cost.final_costs_not_available` | `ACAD_COA` | 29 | present | true | boolean/boolean |
| `cost.food_and_housing_on_campus_first_year` | `RM_BD_1ST_D` | 29 | present | 11246 | number/usd |
| `cost.food_and_housing_on_campus_undergraduates` | `RM_BD_D` | 29 | present | 11246 | number/usd |
| `cost.food_and_housing_total_commuter_not_at_home` | `TOT_COMMUTE_NOT_HOME_D` | 30 | blank | — | number/usd |
| `cost.food_only_commuter_at_home` | `BD_COMMUTE_HOME_D` | 30 | blank | — | number/usd |
| `cost.food_only_commuter_not_at_home` | `BD_COMMUTE_NOT_HOME_D` | 30 | present | 4258 | number/usd |
| `cost.food_only_on_campus_first_year` | `BD_ONLY_1ST_D` | 29 | present | 4258 | number/usd |
| `cost.higher_program_price_payer_percent` | `TUIT_VARY_PROG_P` | 30 | blank | — | string/percent |
| `cost.housing_only_commuter_not_at_home` | `RM_COMMUTE_NOT_HOME_D` | 30 | present | 5640 | number/usd |
| `cost.housing_only_on_campus_first_year` | `RM_ONLY_1ST_D` | 29 | present | 6988 | number/usd |
| `cost.net_price_calculator_url` | `URL_ADDRESS_PRICE_CALC` | 29 | present | https://osfa.uga.edu/sites/default/files/npcalc.htm | string/url |
| `cost.other_annual_charge_response` | `TUIT_OTH_T` | 29 | blank | — | string/text |
| `cost.other_expenses_commuter_at_home` | `OTH_COMMUTE_HOME_D` | 30 | present | 4204 | number/usd |
| `cost.other_expenses_commuter_not_at_home` | `OTH_COMMUTE_NOT_HOME_D` | 30 | present | 4204 | number/usd |
| `cost.other_expenses_on_campus` | `OTH_RES_D` | 30 | present | 3284 | number/usd |
| `cost.required_fees_first_year` | `FEES_1ST_D` | 29 | present | 1390 | number/usd |
| `cost.required_fees_undergraduates` | `FEES_FT_D` | 29 | present | 1390 | number/usd |
| `cost.transportation_commuter_at_home` | `TRANSPORT_COMMUTE_HOME_D` | 30 | present | 1430 | number/usd |
| `cost.transportation_commuter_not_at_home` | `TRANSPORT_COMMUTE_NOT_HOME_D` | 30 | present | 1430 | number/usd |
| `cost.transportation_on_campus` | `TRANSPORT_RES_D` | 30 | present | 1430 | number/usd |
| `cost.tuition_fees_vary_by_instructional_program` | `TUIT_VARY_INST_PROG` | 30 | present | true | boolean/boolean |
| `cost.tuition_fees_vary_by_year_of_study` | `TUIT_VARY_YEAR_STUD` | 30 | present | false | boolean/boolean |
| `cost.tuition_nonresident_first_year` | `TUIT_INTL_1ST_FT_D` | 29 | blank | — | number/usd |
| `cost.tuition_nonresident_undergraduates` | `TUIT_INTL_FT_D` | 29 | blank | — | number/usd |
| `cost.tuition_per_credit_nonresident` | `TUIT_ALIEN_PT_D` | 30 | blank | — | number/usd |
| `cost.tuition_per_credit_private` | `TUIT_OVERALL_PT_D` | 30 | blank | — | number/usd |
| `cost.tuition_per_credit_public_in_district` | `TUIT_AREA_PT_D` | 30 | blank | — | number/usd |
| `cost.tuition_per_credit_public_in_state_out_of_district` | `TUIT_STATE_PT_D` | 30 | blank | — | number/usd |
| `cost.tuition_per_credit_public_out_of_state` | `TUIT_NRES_PT_D` | 30 | blank | — | number/usd |
| `cost.tuition_private_first_year` | `TUIT_OVERALL_1ST_FT_D` | 29 | blank | — | number/usd |
| `cost.tuition_private_undergraduates` | `TUIT_OVERALL_FT_D` | 29 | blank | — | number/usd |
| `cost.tuition_public_in_district_first_year` | `TUIT_AREA_1ST_FT_D` | 29 | present | 9790 | number/usd |
| `cost.tuition_public_in_district_undergraduates` | `TUIT_AREA_FT_D` | 29 | present | 9790 | number/usd |
| `cost.tuition_public_in_state_out_of_district_first_year` | `TUIT_STATE_1ST_FT_D` | 29 | blank | — | number/usd |
| `cost.tuition_public_in_state_out_of_district_undergraduates` | `TUIT_STATE_FT_D` | 29 | blank | — | number/usd |
| `cost.tuition_public_out_of_state_first_year` | `TUIT_NRES_1ST_FT_D` | 29 | present | 28830 | number/usd |
| `cost.tuition_public_out_of_state_undergraduates` | `TUIT_NRES_FT_D` | 29 | present | 28830 | number/usd |

### degrees (41 metrics)

| metric | AcroForm field(s) | page | status | value | type/unit |
|---|---|---|---|---|---|
| `degrees.agriculture_bachelors_percent` | `BACH_AGR` | 41 | present | 2.79 | string/percent |
| `degrees.architecture_bachelors_percent` | `BACH_ARCH` | 41 | present | .48 | string/percent |
| `degrees.area_ethnic_gender_studies_bachelors_percent` | `BACH_AEGS` | 41 | present | .19 | string/percent |
| `degrees.biological_life_sciences_bachelors_percent` | `BACH_BIOSCI` | 41 | present | 9.92 | string/percent |
| `degrees.business_marketing_bachelors_percent` | `BACH_MKTG` | 42 | present | 29.20 | string/percent |
| `degrees.communication_journalism_bachelors_percent` | `BACH_COMM` | 41 | present | 7.74 | string/percent |
| `degrees.communication_technologies_bachelors_percent` | `BACH_COMTECH` | 41 | blank | — | string/percent |
| `degrees.computer_information_sciences_bachelors_percent` | `BACH_CIS` | 41 | present | 2.86 | string/percent |
| `degrees.construction_trades_bachelors_percent` | `BACH_CONST` | 42 | blank | — | string/percent |
| `degrees.education_bachelors_percent` | `BACH_EDUC` | 41 | present | 2.48 | string/percent |
| `degrees.engineering_bachelors_percent` | `BACH_ENGR` | 41 | present | 4.90 | string/percent |
| `degrees.engineering_technologies_bachelors_percent` | `BACH_ENGTCH` | 41 | blank | — | string/percent |
| `degrees.english_bachelors_percent` | `BACH_ENG` | 41 | present | 1.1 | string/percent |
| `degrees.family_consumer_sciences_bachelors_percent` | `BACH_FAMCS` | 41 | present | 3.13 | string/percent |
| `degrees.foreign_languages_literatures_linguistics_bachelors_percent` | `BACH_FLTL` | 41 | present | 1.73 | string/percent |
| `degrees.health_professions_bachelors_percent` | `BACH_HEALTH` | 42 | present | 3.15 | string/percent |
| `degrees.history_bachelors_percent` | `BACH_HIST` | 42 | present | 0.89 | string/percent |
| `degrees.homeland_security_law_enforcement_protective_services_bachelors_percent` | `BACH_HOME` | 42 | present | 1.21 | string/percent |
| `degrees.interdisciplinary_studies_bachelors_percent` | `BACH_INTDS` | 41 | present | 3.22 | string/percent |
| `degrees.law_legal_studies_bachelors_percent` | `BACH_LLS` | 41 | blank | — | string/percent |
| `degrees.liberal_arts_general_studies_bachelors_percent` | `BACH_LAGS` | 41 | present | 0.06 | string/percent |
| `degrees.library_science_bachelors_percent` | `BACH_LIBSCI` | 41 | blank | — | string/percent |
| `degrees.mathematics_statistics_bachelors_percent` | `BACH_MSTAT` | 41 | present | 1.12 | string/percent |
| `degrees.mechanic_repair_technologies_bachelors_percent` | `BACH_MECH` | 42 | blank | — | string/percent |
| `degrees.military_science_cip_28_bachelors_percent` | `BACH_MSMT` | — | absent | — | string/percent |
| `degrees.military_science_cip_29_bachelors_percent` | `BACH_MSMT` | — | absent | — | string/percent |
| `degrees.military_science_combined_cip_28_29_bachelors_percent` | `BACH_MSMT` | 41 | blank | — | string/percent |
| `degrees.natural_resources_conservation_bachelors_percent` | `BACH_NATRC` | 41 | present | .87 | string/percent |
| `degrees.other_bachelors_percent` | `BACH_OTH` | 42 | blank | — | string/percent |
| `degrees.parks_recreation_bachelors_percent` | `BACH_PARKS` | 41 | present | 2.76 | string/percent |
| `degrees.personal_culinary_services_bachelors_percent` | `BACH_PCS` | 41 | blank | — | string/percent |
| `degrees.philosophy_religious_studies_bachelors_percent` | `BACH_PHILO` | 41 | present | .69 | string/percent |
| `degrees.physical_sciences_bachelors_percent` | `BACH_PSY` | 41 | present | .96 | string/percent |
| `degrees.precision_production_bachelors_percent` | `BACH_PROD` | 42 | blank | — | string/percent |
| `degrees.psychology_bachelors_percent` | `BACH_PSYCH` | 41 | present | 6.84 | string/percent |
| `degrees.public_administration_social_services_bachelors_percent` | `BACH_ADMIN` | 42 | present | .45 | string/percent |
| `degrees.science_technologies_bachelors_percent` | `BACH_SCTECH` | 41 | blank | — | string/percent |
| `degrees.social_sciences_bachelors_percent` | `BACH_SOCSI` | 42 | present | 8.66 | string/percent |
| `degrees.theology_religious_vocations_bachelors_percent` | `BACH_THEO` | 41 | blank | — | string/percent |
| `degrees.transportation_materials_moving_bachelors_percent` | `BACH_TRAN` | 42 | blank | — | string/percent |
| `degrees.visual_performing_arts_bachelors_percent` | `BACH_VIS` | 42 | present | 2.6 | string/percent |

### enrollment (4 metrics)

| metric | AcroForm field(s) | page | status | value | type/unit |
|---|---|---|---|---|---|
| `enrollment.all_students_total` | `EN_TOT _N` | 5 | present | 41615 | integer/students |
| `enrollment.graduate_total` | `EN_TOT_GRAD_N` | 5 | present | 10101 | integer/students |
| `enrollment.nonresident_all_undergraduates` | `EN_TOT_NONRES_ALIEN_TOT_N` | 6 | present | 389 | integer/students |
| `enrollment.undergraduate_total` | `EN_TOT _UG_N` | 5 | present | 31514 | integer/students |

### faculty (4 metrics)

| metric | AcroForm field(s) | page | status | value | type/unit |
|---|---|---|---|---|---|
| `faculty.doctorate_or_terminal_degree_faculty_full_time` | `FT_DEG_TERM_N` | 39 | present | 2061 | integer/faculty |
| `faculty.doctorate_or_terminal_degree_faculty_part_time` | `PT_DEG_TERM_N` | 39 | present | 395 | integer/faculty |
| `faculty.total_instructional_faculty_full_time` | `FT_N` | 39 | present | 2210 | integer/faculty |
| `faculty.total_instructional_faculty_part_time` | `PT_N` | 39 | present | 584 | integer/faculty |

### financial_aid (67 metrics)

| metric | AcroForm field(s) | page | status | value | type/unit |
|---|---|---|---|---|---|
| `financial_aid.aid_deadline_date_or_text` | `AP_DL_DAY`, `AP_DL_MON` | 36 | blank | — | string/text |
| `financial_aid.aid_deadline_selected` | `AP_DL` | 36 | present | false | boolean/boolean |
| `financial_aid.aid_has_deadline` | — | — | absent | — | boolean/boolean |
| `financial_aid.aid_no_deadline_rolling_selected` | `AP_DL_NO` | 36 | present | true | boolean/boolean |
| `financial_aid.aid_notification_fixed_date` | `AP_NOTF_DL_DAY`, `AP_NOTF_DL_MON` | 36 | blank | — | string/date |
| `financial_aid.aid_notification_fixed_selected` | `AP_NOTIF_DL` | 36 | present | false | boolean/boolean |
| `financial_aid.aid_notification_rolling_selected` | `AP_NOTF_ROLL` | 36 | present | false | boolean/boolean |
| `financial_aid.aid_notification_rolling_start_date` | `AP_NOTF_ROLL_DAY`, `AP_NOTF_ROLL_MON` | 36 | blank | — | string/date |
| `financial_aid.aid_priority_date` | `AP_DL_PRIORITY_DAY`, `AP_DL_PRIORITY_MON` | 36 | present | 12/15 | string/date |
| `financial_aid.aid_priority_date_selected` | `AP_DL_PRIORITY` | 36 | present | false | boolean/boolean |
| `financial_aid.aid_reporting_academic_year` | `ACAD_YR` | 32 | present | 2023-2024 | string/academic_year |
| `financial_aid.aid_reporting_status` | `ACAD_YR` | 32 | present | estimated | enum/category |
| `financial_aid.graduating_class_first_time_bachelors_count` | `UG_CLASS_N` | 34 | present | 5198 | integer/students |
| `financial_aid.h11_reply_deadline_date` | `AP_REPLY_DL_DAY_FA`, `AP_REPLY_DL_MON_FA` | 36 | blank | — | string/date |
| `financial_aid.h11_reply_weeks_after_notification` | `AP_REPLY_DL_WEEK` | 36 | present | 2 | number/weeks |
| `financial_aid.h12_institution_loan_available` | `LOAN_INST` | 37 | present | true | boolean/boolean |
| `financial_aid.h12_state_loan_available` | `LOAN_STATE` | 37 | present | true | boolean/boolean |
| `financial_aid.h14_academics_non_need_based` | `ACADS_NN` | 37 | present | false | boolean/boolean |
| `financial_aid.h14_alumni_affiliation_non_need_based` | `ALUMAFF_NN` | 37 | present | false | boolean/boolean |
| `financial_aid.h14_art_non_need_based` | `ART_NN` | 37 | present | false | boolean/boolean |
| `financial_aid.h14_athletics_need_based` | `ATHL_NB` | 37 | present | false | boolean/boolean |
| `financial_aid.h14_athletics_non_need_based` | `ATHL_NN` | 37 | present | true | boolean/boolean |
| `financial_aid.h14_job_skills_non_need_based` | `JOB_NN` | 37 | present | false | boolean/boolean |
| `financial_aid.h14_leadership_non_need_based` | `LEAD_NN` | 37 | present | false | boolean/boolean |
| `financial_aid.h14_minority_status_non_need_based` | `MINOR_NN` | 37 | present | false | boolean/boolean |
| `financial_aid.h14_music_drama_non_need_based` | `MUSIC_NN` | 37 | present | false | boolean/boolean |
| `financial_aid.h14_religious_affiliation_non_need_based` | `RELG_NN` | 37 | present | false | boolean/boolean |
| `financial_aid.h14_rotc_non_need_based` | `ROTC_NN` | 37 | present | true | boolean/boolean |
| `financial_aid.h14_state_district_residency_non_need_based` | `STATE_NN` | 37 | present | true | boolean/boolean |
| `financial_aid.h2_a_degree_seeking_undergraduates_first_time_first_year` | `FRSH_FT_N` | 33 | present | 6122 | integer/students |
| `financial_aid.h2_b_applied_for_need_based_aid_first_time_first_year` | `FRSH_FT_AP_N` | 33 | present | 5347 | integer/students |
| `financial_aid.h2_c_determined_have_need_first_time_first_year` | `FRSH_FT_ND_N` | 33 | present | 2139 | integer/students |
| `financial_aid.h2_d_awarded_any_aid_first_time_first_year` | `FRESH_FT_REC_AID_N` | 33 | present | 2085 | integer/students |
| `financial_aid.h2_e_awarded_need_based_grant_aid_first_time_first_year` | `FRSH_FT_NB_GIFT_N` | 33 | present | 2020 | integer/students |
| `financial_aid.h2_f_awarded_need_based_self_help_aid_first_time_first_year` | `FRSH_FT_NB_SH_N` | 33 | present | 620 | integer/students |
| `financial_aid.h2_g_awarded_non_need_based_grant_aid_first_time_first_year` | `FRSH_FT_NN_GIFT_N` | 33 | present | 570 | integer/students |
| `financial_aid.h2_h_need_fully_met_count_first_time_first_year` | `FRSH_FT_ND_MET_N` | 33 | present | 702 | integer/students |
| `financial_aid.h2_i_average_percent_need_met_all_full_time` | `UG_FT_ND_MET_P` | 33 | present | 76.64 | number/percent |
| `financial_aid.h2_i_average_percent_need_met_first_time_first_year` | `FRSH_FT_ND_MET_P` | 33 | present | 80.8 | number/percent |
| `financial_aid.h2_j_average_aid_package_all_full_time` | `UG_FT_AVG_PKG_D` | 33 | present | 14107 | number/usd |
| `financial_aid.h2_j_average_aid_package_first_time_first_year` | `FRSH_FT_AVG_PKG_D` | 33 | present | 14732 | number/usd |
| `financial_aid.h2_k_average_need_based_grant_award_first_time_first_year` | `FRSH_FT_AVG_NB_GIFT_D` | 33 | present | 11850 | number/usd |
| `financial_aid.h2_l_average_need_based_self_help_award_first_time_first_year` | `FRESH_FT_AVG_NB_SH_D` | 33 | present | 3584 | number/usd |
| `financial_aid.h2_m_average_need_based_loan_award_first_time_first_year` | `FRESH_FT_AVG_NB_LOAN_D` | 34 | present | 3335 | number/usd |
| `financial_aid.h2a_n_no_need_institutional_grant_recipients_first_time_first_year` | `FRESH_FT_NN_NONEED_N` | 34 | present | 240 | integer/students |
| `financial_aid.h2a_o_average_no_need_institutional_grant_amount_first_time_first_year` | `FRESH_FT_NN_NONEED_D` | 34 | present | 3117 | number/usd |
| `financial_aid.h2a_p_institutional_athletic_grant_recipients_first_time_first_year` | `FRESH_FT_NN_ATHL_N` | 34 | present | 74 | integer/students |
| `financial_aid.h2a_q_average_institutional_athletic_grant_amount_first_time_first_year` | `FRESH_FT_NN_ATHL_D` | 34 | present | 25124 | number/usd |
| `financial_aid.h5_borrowers_any_program_average_principal` | `UG_CLASS_AVG_DEBT_D` | 35 | present | 20819 | number/usd |
| `financial_aid.h5_borrowers_any_program_percent_of_class` | `UG_CLASS_LOAN_P` | 35 | present | 33 | number/percent |
| `financial_aid.h5_borrowers_private_average_principal` | `UG_CLASS_AVG_DEBT_PRIVATE_D` | 35 | present | 25939 | number/usd |
| `financial_aid.h5_borrowers_private_percent_of_class` | `UG_CLASS_LOAN_PRIVATE_P` | 35 | present | 4 | number/percent |
| `financial_aid.h6_average_institutional_aid` | `INTL_AVG_D` | 35 | blank | — | number/usd |
| `financial_aid.h6_grants_unavailable` | `INTL_NO` | 35 | present | true | boolean/boolean |
| `financial_aid.h6_need_based_grants_available` | `INTL_NB` | 35 | present | false | boolean/boolean |
| `financial_aid.h6_non_need_based_grants_available` | `INTL_NN` | 35 | present | false | boolean/boolean |
| `financial_aid.h6_recipient_count` | `INTL_RECD_N` | 35 | blank | — | integer/students |
| `financial_aid.h6_total_institutional_aid` | `INTL_TOT_D` | 36 | blank | — | number/usd |
| `financial_aid.h7_css_profile_required` | `FORM_INTL_CSS` | 36 | present | false | boolean/boolean |
| `financial_aid.h7_institution_form_required` | `FORM_INTL_INST` | 36 | present | false | boolean/boolean |
| `financial_aid.h8_business_farm_supplement_required` | `FORM_DOM_BUS` | 36 | present | false | boolean/boolean |
| `financial_aid.h8_css_profile_required` | `FORM_DOM_CSS` | 36 | present | false | boolean/boolean |
| `financial_aid.h8_institution_form_required` | `FORM_DOM_INST` | 36 | present | false | boolean/boolean |
| `financial_aid.h8_noncustodial_profile_required` | — | — | absent | — | boolean/boolean |
| `financial_aid.h8_state_aid_form_required` | `FORM_DOM_STATE` | 36 | present | false | boolean/boolean |
| `financial_aid.need_analysis_methodology` | `METH_FM_IM`, `METH_IM` | 32 | present | federal | enum/category |
| `financial_aid.recent_affordability_initiative_details` | `FA_PROGS_T` | 37 | blank | — | string/text |

### identity (13 metrics)

| metric | AcroForm field(s) | page | status | value | type/unit |
|---|---|---|---|---|---|
| `identity.academic_calendar` | `MAIN_CALENDAR` | 4 | present | semester | enum/category |
| `identity.admissions_email` | `AD_EMAIL` | 3 | blank | — | string/email |
| `identity.application_url` | `URL_APP_OTH` | 3 | present | ttps://apply.uga.edu/apply/ | string/url |
| `identity.city` | `CITY` | 3 | present | Athens | string/text |
| `identity.country` | `COUNTRY_CODE` | 3 | blank | — | string/text |
| `identity.degree_offered_bachelors` | `DEG_BACH` | 4 | present | true | boolean/boolean |
| `identity.degree_offered_doctoral_research_scholarship` | `DEG_DOCTOR_RESEARCH` | 4 | present | true | boolean/boolean |
| `identity.degree_offered_masters` | `DEG_MASTER` | 4 | present | true | boolean/boolean |
| `identity.institution_name` | `NAME` | 3 | present | University of Georgia | string/text |
| `identity.institutional_control` | `MAIN_INST_CONTROL` | 4 | present | public | enum/category |
| `identity.main_website` | `AD_URL` | 3 | present | www.uga.edu | string/url |
| `identity.state_or_region` | `STATE_CODE` | 3 | present | GA | string/text |
| `identity.undergraduate_gender_model` | `MAIN_STUDENT_BODY` | 4 | present | coeducational | enum/category |

### outcomes (10 metrics)

| metric | AcroForm field(s) | page | status | value | type/unit |
|---|---|---|---|---|---|
| `outcomes.first_year_retention_entering_cohort_count` | — | — | absent | — | integer/students |
| `outcomes.first_year_retention_reported_percent` | `RETENTION_FRSH_P` | 12 | present | 94.6 | string/percent |
| `outcomes.first_year_retention_still_enrolled_next_fall_count` | — | — | absent | — | integer/students |
| `outcomes.primary_all_students_adjusted_cohort_count` | `GRS_BACH_ADJUST_N` | 8 | present | 5809 | integer/students |
| `outcomes.primary_all_students_completed_after_five_within_six_years_count` | `GRS_6YR_N` | 9 | present | 106 | integer/students |
| `outcomes.primary_all_students_completed_after_four_within_five_years_count` | `GRS_5YR_N` | 9 | present | 821 | integer/students |
| `outcomes.primary_all_students_completed_within_four_years_count` | `GRS_4YR_N` | 8 | present | 4189 | integer/students |
| `outcomes.primary_all_students_completed_within_six_years_count` | `GRS_BACH_TOT_N` | 9 | present | 5116 | integer/students |
| `outcomes.primary_all_students_six_year_graduation_rate_ratio` | `GRS_BACH_TOT_P` | 9 | present | 0.8807 | number/ratio |
| `outcomes.primary_pell_grant_six_year_graduation_rate_ratio` | `GRS_BACH_PELL_P` | 9 | present | .83534 | number/ratio |

### student_life (13 metrics)

| metric | AcroForm field(s) | page | status | value | type/unit |
|---|---|---|---|---|---|
| `student_life.age_25_or_older_percent_undergraduates` | `EN_OLD_P` | 28 | present | 2 | string/percent |
| `student_life.air_force_rotc_at_cooperating_institution` | `ROTC_AF` | 28 | present | false | boolean/boolean |
| `student_life.air_force_rotc_on_campus` | `ROTC_AF` | 28 | present | true | boolean/boolean |
| `student_life.army_rotc_at_cooperating_institution` | `ROTC_ARMY` | 28 | present | false | boolean/boolean |
| `student_life.army_rotc_on_campus` | `ROTC_ARMY` | 28 | present | true | boolean/boolean |
| `student_life.average_age_full_time_undergraduates` | `EN_OLD_FT` | 28 | present | 20 | number/years |
| `student_life.college_owned_housing_percent_undergraduates` | `HOUS_UG_P` | 28 | present | 35 | string/percent |
| `student_life.fraternity_joiners_percent_undergraduates` | `FRAT_P` | 28 | present | 24 | string/percent |
| `student_life.naval_rotc_at_cooperating_institution` | `ROTC_NAVY` | 28 | present | false | boolean/boolean |
| `student_life.naval_rotc_on_campus` | `ROTC_NAVY` | 28 | present | false | boolean/boolean |
| `student_life.off_campus_or_commute_percent_undergraduates` | `HOUS_COMMUTE_P` | 28 | present | 65 | string/percent |
| `student_life.out_of_state_percent_undergraduates` | `EN_NRES_P` | 28 | present | 16 | string/percent |
| `student_life.sorority_joiners_percent_undergraduates` | `SORO_P` | 28 | present | 37 | string/percent |

### transfer (23 metrics)

| metric | AcroForm field(s) | page | status | value | type/unit |
|---|---|---|---|---|---|
| `transfer.admitted_total` | `AD_TFER_N` | 24 | present | 2302 | integer/students |
| `transfer.allows_advanced_standing_from_external_coursework` | `AD_TFER_CRDT` | 24 | present | true | boolean/boolean |
| `transfer.applicants_total` | `AP_TFER_N` | 24 | present | 3114 | integer/applicants |
| `transfer.enrolled_total` | `EN_TFER_N` | 24 | present | 1693 | integer/students |
| `transfer.enrolls_transfer_students` | `AD_TFER` | 24 | present | true | boolean/boolean |
| `transfer.lowest_eligible_course_grade` | `AD_TFER_GRADE` | 25 | present | 65 | string/text |
| `transfer.minimum_college_gpa` | `AD_TFER_COLLEGE_GPA` | 25 | present | 2.8 | number/gpa |
| `transfer.minimum_high_school_gpa` | `AD_TFER_HS_GPA` | 24 | blank | — | number/gpa |
| `transfer.minimum_prior_credit_threshold_applies` | `AD_TFER_CRDT_MIN` | 24 | present | true | boolean/boolean |
| `transfer.minimum_prior_credit_unit` | `AD_TFER_CRDT_MIN_UNIT` | 24 | blank | — | string/text |
| `transfer.minimum_prior_credit_value` | `AD_TFER_CRDT_MIN_N` | 24 | present | 30 | number/source_unit_value |
| `transfer.open_admission_policy_applies` | `AD_TFER_OPEN_AD` | 25 | blank | — | boolean/boolean |
| `transfer.transfer_closing_date_fall` | `AP_DL_TFER_DAY`, `AP_DL_TFER_MON` | 25 | present | 4/1 | string/date |
| `transfer.transfer_notification_date_fall` | `AP_NOTF_DL_TFER_DAY`, `AP_NOTF_DL_TFER_MON` | 25 | blank | — | string/date |
| `transfer.transfer_priority_date_fall` | `AP_PRIO_DL_TFER_DAY`, `AP_PRIO_DL_TFER_MON` | 25 | blank | — | string/date |
| `transfer.transfer_reply_date_fall` | `AP_REPLY_DL_TFER_DAY`, `AP_REPLY_DL_TFER_MON` | 25 | blank | — | string/date |
| `transfer.transfer_requirement_college_transcripts` | `REQ_CODE_CG_TRANSCRIPT` | 24 | present | required_all | enum/category |
| `transfer.transfer_requirement_essay_personal_statement` | `REQ_CODE_ESSAY` | 24 | present | not_required | enum/category |
| `transfer.transfer_requirement_high_school_transcript` | `REQ_CODE_HS_TRANSCRIPT` | 24 | present | not_required | enum/category |
| `transfer.transfer_requirement_interview` | `REQ_CODE_INTERVIEW` | 24 | present | not_required | enum/category |
| `transfer.transfer_requirement_prior_institution_good_standing` | `REQ_CODE_GDSTAND` | 24 | present | recommended_some | enum/category |
| `transfer.transfer_requirement_standardized_test_scores` | `REQ_CODE_TEST_SCORES` | 24 | present | recommended_some | enum/category |
| `transfer.transfer_rolling_admission_fall` | `AP_DL_TFER_1` | 25 | present | true | boolean/boolean |

## Metrics left unmapped (no GT entry emitted)

| metric | why |
|---|---|
| `identity.academic_year` | The academic year (`2023-2024`) appears only as running page-header **text** (`Common Data Set 2023-2024`); the AcroForm field `CDS_TITLE` that would carry it is empty. Recording it would mean reading rendered text, not a field, so it is omitted rather than guessed. Cheap adjudication target. |
| `cost.cost_academic_year` | The Section G cost year (`2024-2025`) appears only in G0/G1 prose ("Provide 2024-2025 academic year costs of attendance"); no AcroForm field holds it. Same reasoning. Cheap adjudication target. |

## Metrics recorded `absent` (question not in this form edition)

| metric | why |
|---|---|
| `degrees.military_science_cip_28_bachelors_percent` | Section J in this edition prints ONE combined 'Military science and military technologies 28 and 29' row (field BACH_MSMT); no separate CIP 28 row exists |
| `degrees.military_science_cip_29_bachelors_percent` | Section J in this edition prints ONE combined 'Military science and military technologies 28 and 29' row (field BACH_MSMT); no separate CIP 29 row exists |
| `financial_aid.aid_has_deadline` | H9 in this edition offers three date/checkbox rows and no separate has-a-deadline yes/no question |
| `financial_aid.h8_noncustodial_profile_required` | H8 in this edition lists FAFSA / institution form / CSS Profile / state aid form / business-farm supplement / other; no Noncustodial Profile row exists |
| `outcomes.first_year_retention_entering_cohort_count` | B22 in this edition reports only a single retention percentage; no cohort-count cell exists |
| `outcomes.first_year_retention_still_enrolled_next_fall_count` | B22 in this edition reports only a single retention percentage; no still-enrolled cell exists |

## AcroForm fields not attributed to any metric (675)

These are real fields in the document that no manifest metric asks for. The dominant families are: B1/B2 gender- and race-split enrollment cells, B3 degrees-conferred counts, B4-B21 graduation-rate sub-cohorts, C1 gender/full-time-part-time splits, C9 score-range distributions, C11 GPA bands, F2/F4 activity and housing checklists, I-1 faculty demographic rows, and Section J's Diploma/Certificate and Associate columns (the manifest models only the Bachelor's column).

**p2 · cover** — `CDS_CITY`, `CDS_COUNTRY`, `CDS_EMAIL`, `CDS_ITEMS`, `CDS_LASTNAME`, `CDS_LINE1`, `CDS_LINE2`, `CDS_LINE3`, `CDS_NAME`, `CDS_OFFICE`, `CDS_PHONE`, `CDS_RESPONSE`, `CDS_STATE`, `CDS_TITLE`, `CDS_URL`, `CDS_ZIPCODE`

**p3 · A1** — `AD_EMAIL_OTH`, `CITY_AD`, `COUNTRY_CODE_AD`, `INSTATE_AREA_CODE`, `INSTATE_EXT`, `INSTATE_PHONE`, `INST_EMAIL`, `LINE1`, `LINE1_AD`, `LINE2`, `LINE2_AD`, `LINE3`, `LINE3_AD`, `OFFICIAL_AREA_CODE`, `OFFICIAL_EXT`, `OFFICIAL_PHONE`, `OUTSTATE_AREA_CODE`, `OUTSTATE_EXT`, `OUTSTATE_PHONE`, `STATE_CODE_AD`, `ZIPCODE`, `ZIPCODE_AD`

**p4 · A2-A5** — `CDS_DIV_EQ_INC_URL`, `CERTIF`, `CERTIF_POST_BACH`, `CERTIF_POST_MASTER`, `DEG_ASSOC`, `DEG_ASSOC_TERM`, `DEG_ASSOC_TFER`, `DEG_DOCTOR_OTH`, `DEG_DOCTOR_PROF`, `DIPLOMA`, `MAIN_CALENDAR_DIFFERS`, `MAIN_OTHER_CALENDAR`

**p5 · B1** — `CDS_EN_CRDT_FT_NON_BINARY_N`, `CDS_EN_CRDT_PT_NON_BINARY_N`, `CDS_EN_DEG_FT_NON_BINARY_N`, `CDS_EN_DEG_PT_NON_BINARY_N`, `CDS_EN_FRSH_FT_NON_BINARY_N`, `CDS_EN_FRSH_PT_NON_BINARY_N`, `CDS_EN_GRAD_CRDT_FT_NON_BINARY_N`, `CDS_EN_GRAD_CRDT_PT_NON_BINARY_N`, `CDS_EN_GRAD_DEG_FT_NON_BINARY_N`, `CDS_EN_GRAD_DEG_PT_NON_BINARY_N`, `CDS_EN_GRAD_FT_NON_BINARY_N`, `CDS_EN_GRAD_OTH_FT_NON_BINARY_N`, `CDS_EN_GRAD_OTH_PT_NON_BINARY_N`, `CDS_EN_GRAD_PT_NON_BINARY_N`, `CDS_EN_OTH_1ST_FT_NON_BINARY_N`, `CDS_EN_OTH_1ST_PT_NON_BINARY_N`, `CDS_EN_TOT_DEG_FT_NON_BINARY_N`, `CDS_EN_TOT_DEG_PT_NON_BINARY_N`, `CDS_EN_UG_FT_NON_BINARY_N`, `CDS_EN_UG_PT_NON_BINARY_N`, `EN_CRDT_FT_MEN_N`, `EN_CRDT_FT_WMN_N`, `EN_CRDT_PT_MEN_N`, `EN_CRDT_PT_WMN_N`, `EN_DEG_FT_MEN_N`, `EN_DEG_FT_WMN_N`, `EN_DEG_PT_MEN_N`, `EN_DEG_PT_WMN_N`, `EN_FRSH_FT_MEN_N`, `EN_FRSH_FT_WMN_N`, `EN_FRSH_PT_MEN_N`, `EN_FRSH_PT_WMN_N`, `EN_GRAD_CRDT_FT_MEN_N`, `EN_GRAD_CRDT_FT_WMN_N`, `EN_GRAD_CRDT_PT_MEN_N`, `EN_GRAD_CRDT_PT_WMN_N`, `EN_GRAD_DEG_FT_MEN_N`, `EN_GRAD_DEG_FT_WMN_N`, `EN_GRAD_DEG_PT_MEN_N`, `EN_GRAD_DEG_PT_WMN_N`, `EN_GRAD_FT_MEN_N`, `EN_GRAD_FT_WMN_N`, `EN_GRAD_OTH_FT_MEN_N`, `EN_GRAD_OTH_FT_WMN_N`, `EN_GRAD_OTH_PT_MEN_N`, `EN_GRAD_OTH_PT_WMN_N`, `EN_GRAD_PT_MEN_N`, `EN_GRAD_PT_WMN_N`, `EN_OTH_1ST_FT_MEN_N`, `EN_OTH_1ST_FT_WMN_N`, `EN_OTH_1ST_PT_MEN_N`, `EN_OTH_1ST_PT_WMN_N`, `EN_TOT_DEG_FT_MEN_N`, `EN_TOT_DEG_FT_WMN_N`, `EN_TOT_DEG_PT_MEN_N`, `EN_TOT_DEG_PT_WMN_N`, `EN_TOT_FT_MEN_N`, `EN_TOT_FT_NON_BINARY_N`, `EN_TOT_FT_WMN_N`, `EN_TOT_PT_MEN_N`, `EN_TOT_PT_NON_BINARY_N`, `EN_TOT_PT_WMN_N`, `EN_UG_FT_MEN_N`, `EN_UG_FT_WMN_N`, `EN_UG_PT_MEN_N`, `EN_UG_PT_WMN_N`

**p6 · B2** — `EN_1ST_ASIAN_NONHISPANIC_N`, `EN_1ST_BLACK_NONHISPANIC_N`, `EN_1ST_HISPANIC_ETHNICITY_N`, `EN_1ST_ISLANDER_NONHISPANIC_N`, `EN_1ST_MULTIRACE_NONHISPANIC_N`, `EN_1ST_NATIVE_NONHISPANIC_N`, `EN_1ST_NONRES_ALIEN_1ST_N`, `EN_1ST_RACE_ETHNICITY_TOT_N`, `EN_1ST_RACE_ETHNICITY_UNKNOWN_N`, `EN_1ST_WHITE_NONHISPANIC_N`, `EN_ASIAN_NONHISPANIC_N`, `EN_BLACK_NONHISPANIC_N`, `EN_HISPANIC_ETHNICITY_N`, `EN_ISLANDER_NONHISPANIC_N`, `EN_MULTIRACE_NONHISPANIC_N`, `EN_NATIVE_NONHISPANIC_N`, `EN_NONRES_ALIEN_N`, `EN_RACE_ETHNICITY_TOT_N`, `EN_RACE_ETHNICITY_UNKNOWN_N`, `EN_TOT_ASIAN_NONHISPANIC_N`, `EN_TOT_BLACK_NONHISPANIC_N`, `EN_TOT_HISPANIC_ETHNICITY_N`, `EN_TOT_ISLANDER_NONHISPANIC_N`, `EN_TOT_MULTIRACE_NONHISPANIC_N`, `EN_TOT_NATIVE_NONHISPANIC_N`, `EN_TOT_RACE_ETHNICITY_TOT_N`, `EN_TOT_RACE_ETHNICITY_UNKNOWN_N`, `EN_TOT_WHITE_NONHISPANIC_N`, `EN_WHITE_NONHISPANIC_N`

**p7 · B3** — `CERTIF_DIPLOMA_N`, `CERTIF_POST_BACH_N`, `CERTIF_POST_MASTER_N`, `DEG_ASSOC_N`, `DEG_BACH_N`, `DEG_DOCTOR_OTH_N`, `DEG_DOCTOR_PROF_N`, `DEG_DOCTOR_RESEARCH_N`, `DEG_MASTER_N`

**p8 · B4-B11** — `GRS_4YR_NO_AID_N`, `GRS_4YR_PELL_N`, `GRS_4YR_STAFFORD_N`, `GRS_BACH_ADJUST_NO_AID_N`, `GRS_BACH_ADJUST_PELL_N`, `GRS_BACH_ADJUST_STAFFORD_N`, `GRS_BACH_EXCLUDE_N`, `GRS_BACH_EXCLUDE_NO_AID_N`, `GRS_BACH_EXCLUDE_PELL_N`, `GRS_BACH_EXCLUDE_STAFFORD_N`, `GRS_BACH_INIT_N`, `GRS_BACH_INIT_NO_AID_N`, `GRS_BACH_INIT_PELL_N`, `GRS_BACH_INIT_STAFFORD_N`

**p9 · B4-B11** — `GRS_5YR_NO_AID_N`, `GRS_5YR_PELL_N`, `GRS_5YR_STAFFORD_N`, `GRS_6YR_NO_AID_N`, `GRS_6YR_PELL_N`, `GRS_6YR_STAFFORD_N`, `GRS_BACH_PELL_N`, `GRS_BACH_STAFFORD_N`, `GRS_BACH_STAFFORD_P`, `GRS_BACH_TOT_NO_AID_N`, `GRS_BACH_TOT_NO_AID_P`

**p10 · B4-B11** — `GRS_LY_4YR_N`, `GRS_LY_4YR_NO_AID_N`, `GRS_LY_4YR_PELL_N`, `GRS_LY_4YR_STAFFORD_N`, `GRS_LY_5YR_N`, `GRS_LY_5YR_NO_AID_N`, `GRS_LY_5YR_PELL_N`, `GRS_LY_5YR_STAFFORD_N`, `GRS_LY_6YR_N`, `GRS_LY_6YR_NO_AID_N`, `GRS_LY_6YR_PELL_N`, `GRS_LY_6YR_STAFFORD_N`, `GRS_LY_BACH_ADJUST_N`, `GRS_LY_BACH_ADJUST_NO_AID_N`, `GRS_LY_BACH_ADJUST_PELL_N`, `GRS_LY_BACH_ADJUST_STAFFORD_N`, `GRS_LY_BACH_EXCLUDE_N`, `GRS_LY_BACH_EXCLUDE_NO_AID_N`, `GRS_LY_BACH_EXCLUDE_PELL_N`, `GRS_LY_BACH_EXCLUDE_STAFFORD_N`, `GRS_LY_BACH_INIT_N`, `GRS_LY_BACH_INIT_NO_AID_N`, `GRS_LY_BACH_INIT_PELL_N`, `GRS_LY_BACH_INIT_STAFFORD_N`, `GRS_LY_BACH_PELL_N`, `GRS_LY_BACH_PELL_P`, `GRS_LY_BACH_STAFFORD_N`, `GRS_LY_BACH_STAFFORD_P`, `GRS_LY_BACH_TOT_N`, `GRS_LY_BACH_TOT_NO_AID_N`, `GRS_LY_BACH_TOT_NO_AID_P`, `GRS_LY_BACH_TOT_P`

**p11 · B12-B21** — `GRS_2YR_LESS_150_N`, `GRS_2YR_LESS_N`, `GRS_2YR_MORE_150_N`, `GRS_2YR_MORE_N`, `GRS_ASSOC_ADJUST_N`, `GRS_ASSOC_EXCLUDE_N`, `GRS_ASSOC_INIT_N`, `GRS_LY_2YR_LESS_150_N`, `GRS_LY_2YR_LESS_N`, `GRS_LY_2YR_MORE_150_N`, `GRS_LY_2YR_MORE_N`, `GRS_LY_ASSOC_ADJUST_N`, `GRS_LY_ASSOC_EXCLUDE_N`, `GRS_LY_ASSOC_INIT_N`, `GRS_LY_TFER_2YR_N`, `GRS_LY_TFER_4YR_N`, `GRS_LY_TFER_TOT_N`, `GRS_TFER_2YR_N`, `GRS_TFER_4YR_N`, `GRS_TFER_TOT_N`

**p13 · C1** — `AP_ADMT_1ST_MEN_N`, `AP_ADMT_1ST_NON_BINARY_N`, `AP_ADMT_1ST_WMN_N`, `AP_RECD_1ST_MEN_N`, `AP_RECD_1ST_NON_BINARY_N`, `AP_RECD_1ST_WMN_N`, `EN_TOT_1ST_FT_MEN_N`, `EN_TOT_1ST_FT_NON_BINARY_N`, `EN_TOT_1ST_FT_WMN_N`, `EN_TOT_1ST_MEN_N`, `EN_TOT_1ST_NON_BINARY_N`, `EN_TOT_1ST_PT_MEN_N`, `EN_TOT_1ST_PT_NON_BINARY_N`, `EN_TOT_1ST_PT_WMN_N`, `EN_TOT_1ST_WMN_N`

**p14 · C1-C2** — `AP_ADMT_UNK_1ST_N`, `AP_RECD_UNK_1ST_N`, `EN_TOT_NRES_1ST_N`, `EN_TOT_STATE_1ST_N`, `EN_TOT_UNK_1ST_N`, `WAITLIST_INFO_SCH`, `WAITLIST_INFO_STUD`, `WAITLIST_RANK`

**p17 · C8A-C8F** — `AP_SAT1_ACT_DL_DAY`, `AP_SAT1_ACT_DL_MON`, `AP_TEST_ADVISE`

**p18 · C8G** — `ACT_PLACE`, `AP_PLACE`, `CLEP_PLACE`, `INST_PLACE`, `SAT1_PLACE`, `STATE_PLACE_T`, `STATE_PLACE_T_CHECK`

**p19 · C9** — `ACT_WRITING_25TH_P`, `ACT_WRITING_50TH_P`, `ACT_WRITING_75TH_P`

**p20 · C9 ranges** — `ACT_1_P`, `ACT_2_P`, `ACT_3_P`, `ACT_4_P`, `ACT_5_P`, `ACT_6_P`, `ACT_ENG_1_P`, `ACT_ENG_2_P`, `ACT_ENG_3_P`, `ACT_ENG_4_P`, `ACT_ENG_5_P`, `ACT_ENG_6_P`, `ACT_MATH_1_P`, `ACT_MATH_2_P`, `ACT_MATH_3_P`, `ACT_MATH_4_P`, `ACT_MATH_5_P`, `ACT_MATH_6_P`, `ACT_READING_1_P`, `ACT_READING_2_P`, `ACT_READING_3_P`, `ACT_READING_4_P`, `ACT_READING_5_P`, `ACT_READING_6_P`, `ACT_SCIENCE_1_P`, `ACT_SCIENCE_2_P`, `ACT_SCIENCE_3_P`, `ACT_SCIENCE_4_P`, `ACT_SCIENCE_5_P`, `ACT_SCIENCE_6_P`, `SAT1_COMP_1000_P`, `SAT1_COMP_1200_P`, `SAT1_COMP_1400_P`, `SAT1_COMP_400_P`, `SAT1_COMP_600_P`, `SAT1_COMP_800_P`, `SAT1_MATH_200_P`, `SAT1_MATH_300_P`, `SAT1_MATH_400_P`, `SAT1_MATH_500_P`, `SAT1_MATH_600_P`, `SAT1_MATH_700_P`, `SAT1_VERB_200_P`, `SAT1_VERB_300_P`, `SAT1_VERB_400_P`, `SAT1_VERB_500_P`, `SAT1_VERB_600_P`, `SAT1_VERB_700_P`

**p21 · C10-C12** — `EN_FRSH_GPA_1_P`, `EN_FRSH_GPA_2_P`, `EN_FRSH_GPA_3_P`, `EN_FRSH_GPA_4_P`, `EN_FRSH_GPA_5_P`, `EN_FRSH_GPA_6_P`, `EN_FRSH_GPA_7_P`, `EN_FRSH_GPA_8_P`, `EN_FRSH_GPA_9_P`, `FRSH_GPA_NO_SUB_1_P`, `FRSH_GPA_NO_SUB_2_P`, `FRSH_GPA_NO_SUB_3_P`, `FRSH_GPA_NO_SUB_4_P`, `FRSH_GPA_NO_SUB_5_P`, `FRSH_GPA_NO_SUB_6_P`, `FRSH_GPA_NO_SUB_7_P`, `FRSH_GPA_NO_SUB_8_P`, `FRSH_GPA_NO_SUB_9_P`, `FRSH_GPA_SUBMIT_1_P`, `FRSH_GPA_SUBMIT_2_P`, `FRSH_GPA_SUBMIT_3_P`, `FRSH_GPA_SUBMIT_4_P`, `FRSH_GPA_SUBMIT_5_P`, `FRSH_GPA_SUBMIT_6_P`, `FRSH_GPA_SUBMIT_7_P`, `FRSH_GPA_SUBMIT_8_P`, `FRSH_GPA_SUBMIT_9_P`, `TOT_EN_FRSH_GPA_P`, `TOT_FRSH_GPA_NO_SUB_P`, `TOT_FRSH_GPA_SUBMIT_P`

**p22 · C13-C17** — `AP_FEE_ONLINE`, `AP_FEE_ONLINE_WAIVE`, `AP_NOTF_DL_OTH_T`, `AP_REPLY_OTH_T`

**p23 · C18-C22** — `AD_EAD`, `AP_EDEC_T`

**p24 · D1-D6** — `AD_TFER_FALL`, `AD_TFER_MEN_N`, `AD_TFER_NON_BINARY_N`, `AD_TFER_SPRI`, `AD_TFER_SUMM`, `AD_TFER_WINT`, `AD_TFER_WMN_N`, `AP_TFER_MEN_N`, `AP_TFER_NON_BINARY_N`, `AP_TFER_WMN_N`, `EN_TFER_MEN_N`, `EN_TFER_NON_BINARY_N`, `EN_TFER_WMN_N`

**p25 · D7-D17** — `AD_TFER_ADD_REQ_T`, `AD_TFER_CRDT_2_N`, `AD_TFER_CRDT_2_UNIT`, `AD_TFER_CRDT_4_N`, `AD_TFER_CRDT_4_UNIT`, `AD_TFER_POLICIES_T`, `AD_TFER_REQS_T`, `AP_DL_TFER_SPRI_DAY`, `AP_DL_TFER_SPRI_I`, `AP_DL_TFER_SPRI_MON`, `AP_DL_TFER_SUMM_DAY`, `AP_DL_TFER_SUMM_I`, `AP_DL_TFER_SUMM_MON`, `AP_DL_TFER_WINT_DAY`, `AP_DL_TFER_WINT_I`, `AP_DL_TFER_WINT_MON`, `AP_NOTF_DL_TFER_SPRI_DAY`, `AP_NOTF_DL_TFER_SPRI_MON`, `AP_NOTF_DL_TFER_SUMM_DAY`, `AP_NOTF_DL_TFER_SUMM_MON`, `AP_NOTF_DL_TFER_WINT_DAY`, `AP_NOTF_DL_TFER_WINT_MON`, `AP_PRIO_DL_TFER_SPRI_DAY`, `AP_PRIO_DL_TFER_SPRI_MON`, `AP_PRIO_DL_TFER_SUMM_DAY`, `AP_PRIO_DL_TFER_SUMM_MON`, `AP_PRIO_DL_TFER_WINT_DAY`, `AP_PRIO_DL_TFER_WINT_MON`, `AP_REPLY_DL_TFER_SPRI_DAY`, `AP_REPLY_DL_TFER_SPRI_MON`, `AP_REPLY_DL_TFER_SUMM_DAY`, `AP_REPLY_DL_TFER_SUMM_MON`, `AP_REPLY_DL_TFER_WINT_DAY`, `AP_REPLY_DL_TFER_WINT_MON`, `TFER_CRDT_ASSOC_N`, `TFER_CRDT_ASSOC_UNIT`, `TFER_CRDT_BACH_N`, `TFER_CRDT_BACH_UNIT`

**p26 · D13-D17** — `AD_TFER_CLEP_SUBJECT`, `AD_TFER_CRDT_ACE`, `AD_TFER_CRDT_ACE_N`, `AD_TFER_CRDT_ACE_UNIT`, `AD_TFER_CRDT_CLEP`, `AD_TFER_CRDT_CLEP_UNIT`, `AD_TFER_CRDT_DANTES`, `AD_TFER_CRDT_VET`, `AD_TFER_CRDT_VET_T`, `AD_TFER_CRDT_VET_URL`

**p27 · E1-E3** — `COMP_TRANS_POSTSEC_PROG`, `DIST_LEARN`, `ESL`, `EXT_DEG`, `EX_STUD`, `PROGS_OTH`, `PROGS_OTH_CHECK`, `REQ_OTH`, `REQ_OTH_CHECK`, `WEEKEND_COLL`

**p28 · F1-F4** — `EN_1ST_NRES_P`, `EN_1ST_OLD_ALL`, `EN_1ST_OLD_FT`, `EN_1ST_OLD_P`, `EN_OLD_ALL`, `FRAT_1ST_P`, `HOUS_1ST_COMMUTE_P`, `HOUS_1ST_UG_P`, `HOUS_COED`, `HOUS_COOP`, `HOUS_DISABLED`, `HOUS_FRAT_SORO`, `HOUS_INTL`, `HOUS_LIVING_LEARN`, `HOUS_MARRIED`, `HOUS_MEN`, `HOUS_OTH`, `HOUS_OTH_TEXT`, `HOUS_SINGLE`, `HOUS_THEME`, `HOUS_WELL`, `HOUS_WMN`, `LIFE_BAND`, `LIFE_CAMPUS`, `LIFE_CHORUS`, `LIFE_CONCERT`, `LIFE_DANCE`, `LIFE_DRAMA`, `LIFE_FILMSOC`, `LIFE_ISO`, `LIFE_JAZZ`, `LIFE_LITMAG`, `LIFE_MODEL`, `LIFE_MUSIC`, `LIFE_MUSIC_THEATRE`, `LIFE_NEWS`, `LIFE_OPERA`, `LIFE_PEPBAND`, `LIFE_RADIO`, `LIFE_STUDGOV`, `LIFE_SYMPH`, `LIFE_TELEVISION`, `LIFE_YEARBOOK`, `ROTC_AF_TEXT`, `ROTC_ARMY_TEXT`, `ROTC_NAVY_TEXT`, `SORO_1ST_P`

**p29 · G0-G1** — `BD_ONLY_D`, `RM_ONLY_D`

**p30 · G2-G6** — `MAX_CRDT_FT`, `MIN_CRDT_FT`

**p32 · H1** — `NB_PARENT_D`, `NN_PARENT_D`, `SCHOL_NB_EXT_D`, `SCHOL_NB_FED_D`, `SCHOL_NB_INST_D`, `SCHOL_NB_STATE_D`, `SCHOL_NB_TOT_D`, `SCHOL_NN_EXT_D`, `SCHOL_NN_FED_D`, `SCHOL_NN_INST_D`, `SCHOL_NN_STATE_D`, `SCHOL_NN_TOT_D`, `SH_NB_FWS_D`, `SH_NB_STATE_D`, `SH_NB_STUD_LOAN_D`, `SH_NB_TOT_D`, `SH_NN_STATE_D`, `SH_NN_STUD_LOAN_D`, `SH_NN_TOT_D`

**p33 · H2** — `NB_ATHL_D`, `NB_WAIVER_D`, `NN_WAIVER_D`, `UG_FT_AP_N`, `UG_FT_AVG_NB_GIFT_D`, `UG_FT_AVG_NB_SH_D`, `UG_FT_NB_GIFT_N`, `UG_FT_NB_SH_N`, `UG_FT_ND_MET_N`, `UG_FT_ND_N`, `UG_FT_NN_GIFT_N`, `UG_FT_N_N`, `UG_FT_REC_AID_N`, `UG_PT_AP_N`, `UG_PT_AVG_NB_GIFT_D`, `UG_PT_AVG_NB_SH_D`, `UG_PT_AVG_PKG_D`, `UG_PT_NB_GIFT_N`, `UG_PT_NB_SH_N`, `UG_PT_ND_MET_N`, `UG_PT_ND_MET_P`, `UG_PT_ND_N`, `UG_PT_NN_GIFT_N`, `UG_PT_N_N`, `UG_PT_REC_AID`

**p34 · H2-H4** — `UG_FT_AVG_NB_LOAN_D`, `UG_FT_NN_ATHL_D`, `UG_FT_NN_ATHL_N`, `UG_FT_NN_NONEED_D`, `UG_FT_NN_NONEED_N`, `UG_PT_AVG_NB_LOAN_D`, `UG_PT_NN_ATHL_D`, `UG_PT_NN_ATHL_N`, `UG_PT_NN_NONEED_D`, `UG_PT_NN_NONEED_N`

**p35 · H5-H6** — `UG_CLASS_AVG_DEBT_FED_D`, `UG_CLASS_AVG_DEBT_INST_D`, `UG_CLASS_AVG_DEBT_STATE_D`, `UG_CLASS_LOAN_FED_N`, `UG_CLASS_LOAN_FED_P`, `UG_CLASS_LOAN_INST_N`, `UG_CLASS_LOAN_INST_P`, `UG_CLASS_LOAN_N`, `UG_CLASS_LOAN_PRIVATE_N`, `UG_CLASS_LOAN_STATE_N`, `UG_CLASS_LOAN_STATE_P`

**p36 · H6-H11** — `FORM_DOM_FAFSA`, `FORM_DOM_OTH`, `FORM_DOM_OTH_T`, `FORM_INTL_OTH`, `FORM_INTL_OTH_T`

**p37 · H12-H15** — `ACADS_NB`, `ALUMAFF_NB`, `ART_NB`, `COVID_POLICY`, `JOB_NB`, `LEAD_NB`, `LOAN_DIRECT_PLUS`, `LOAN_DIRECT_STAFFORD_SUB`, `LOAN_DIRECT_STAFFORD_UNSUB`, `LOAN_NURSING`, `LOAN_OTH`, `LOAN_OTH_T`, `LOAN_PERKINS`, `MINOR_NB`, `MUSIC_NB`, `RELG_NB`, `SCHOL_NB_INST`, `SCHOL_NB_NURSING`, `SCHOL_NB_OTH`, `SCHOL_NB_OTH_T`, `SCHOL_NB_PELL`, `SCHOL_NB_PRIVATE`, `SCHOL_NB_SEOG`, `SCHOL_NB_STATE`, `SCHOL_NB_UNCF`, `STATE_NB`

**p39 · I-1/I-2** — `BACH_FT_N`, `BACH_PT_N`, `FT_MEN_N`, `FT_WMN_N`, `GRAD_FT_N`, `GRAD_PT_N`, `GRAD_TOT_N`, `MASTER_FT_N`, `MASTER_PT_N`, `MASTER_TOT_N`, `MIN_FT_N`, `MIN_PT_N`, `MIN_TOT_N`, `NRES_FT_N`, `NRES_PT_N`, `NRES_TOT_N`, `PT_MEN_N`, `PT_WMN_N`, `TOT_DEG_TERM_N`, `TOT_MEN_N`, `TOT_WMN_N`, `UNKNOWN_FT_N`, `UNKNOWN_PT_N`, `UNKNOWN_TOT_N`

**p40 · I-3** — `CLASS_SEC_TOT`, `CLASS_SUBSEC_TOT`

**p41 · J** — `ASSOC_AEGS`, `ASSOC_AGR`, `ASSOC_ARCH`, `ASSOC_BIOSCI`, `ASSOC_CIS`, `ASSOC_COMM`, `ASSOC_COMTECH`, `ASSOC_EDUC`, `ASSOC_ENG`, `ASSOC_ENGR`, `ASSOC_ENGTCH`, `ASSOC_FAMCS`, `ASSOC_FLTL`, `ASSOC_INTDS`, `ASSOC_LAGS`, `ASSOC_LIBSCI`, `ASSOC_LLS`, `ASSOC_MSMT`, `ASSOC_MSTAT`, `ASSOC_NATRC`, `ASSOC_PARKS`, `ASSOC_PCS`, `ASSOC_PHILO`, `ASSOC_PSY`, `ASSOC_PSYCH`, `ASSOC_SCTECH`, `ASSOC_THEO`, `CERTIF_P_AEGS`, `CERTIF_P_AGR`, `CERTIF_P_ARCH`, `CERTIF_P_BIOSCI`, `CERTIF_P_CIS`, `CERTIF_P_COMM`, `CERTIF_P_COMTECH`, `CERTIF_P_EDUC`, `CERTIF_P_ENG`, `CERTIF_P_ENGR`, `CERTIF_P_ENGTCH`, `CERTIF_P_FAMCS`, `CERTIF_P_FLTL`, `CERTIF_P_INTDS`, `CERTIF_P_LAGS`, `CERTIF_P_LIBSCI`, `CERTIF_P_LLS`, `CERTIF_P_MSMT`, `CERTIF_P_MSTAT`, `CERTIF_P_NATRC`, `CERTIF_P_PARKS`, `CERTIF_P_PCS`, `CERTIF_P_PHILO`, `CERTIF_P_PSY`, `CERTIF_P_PSYCH`, `CERTIF_P_SCTECH`, `CERTIF_P_THEO`

**p42 · J** — `ASSOC_ADMIN`, `ASSOC_CONST`, `ASSOC_HEALTH`, `ASSOC_HIST`, `ASSOC_HOME`, `ASSOC_MECH`, `ASSOC_MKTG`, `ASSOC_OTH`, `ASSOC_PROD`, `ASSOC_SOCSCI`, `ASSOC_TOT_P`, `ASSOC_TRAN`, `ASSOC_VIS`, `CERTIF_P_ADMIN`, `CERTIF_P_CONST`, `CERTIF_P_HEALTH`, `CERTIF_P_HIST`, `CERTIF_P_HOME`, `CERTIF_P_MECH`, `CERTIF_P_MKTG`, `CERTIF_P_OTH`, `CERTIF_P_PROD`, `CERTIF_P_SOCSCI`, `CERTIF_P_TOT_P`, `CERTIF_P_TRAN`, `CERTIF_P_VIS`

## Cases I was not fully certain about (adjudication targets)

1. **`Q112_10` does not exist.** C7's nonacademic block has 12 rows but fields run `Q112_1..9, 11, 12, 13`. I resolved
   the 1-row offset risk positionally: widget y-centres are a uniform 18.5 pt apart from `Q112_1` (317.8) through
   `Q112_13` (112.9) with no gap, and the row labels extracted at y 319.8/301.2/282.7/264.1/245.5 line up with
   `Q112_1..5`. So `Q112_11` sits in the **10th** row (Volunteer work), not the 11th. Verified, but worth a second eye.
2. **Unselected radio groups → `blank`, not `false`.** `EXAM_CODE_ACT`, `EXAM_CODE_SAT` (C8A ACT-only / SAT-only rows),
   `AP_DL_FRSH` (C14 Yes/No), `AD_TFER_OPEN_AD` (D10 Yes/No) all have no `/V`. These are enum or Yes/No groups, not
   standalone checkboxes, so an unselected group is an unanswered question, not a "no". Recorded `blank`.
3. **`AD_OPEN_MOST` is one radio serving two metrics.** C6's "selective for out-of-state" (`/O`) and "selective for some
   programs" (`/S`) are two widgets of a single radio field. Its value is `None`, so both
   `open_admission_selective_out_of_state` and `open_admission_selective_programs` are `false`. Had one been ticked, the
   other could not have been derived independently — flagging the structure, not the value.
4. **C16 date pair is shared.** Page 22 has one `AP_NOTF_DL_FRSH_MON/DAY` pair sitting between the "rolling basis
   beginning" and "By (date)" checkbox rows. Both `decision_rolling_begin_date` and `decision_by_date` were mapped to it;
   both are empty (`' '`), so both are `blank` either way. The attribution would matter only if it were filled.
5. **H9 priority date is internally contradictory in the source.** `AP_DL_PRIORITY` (the checkbox) is `/Off` while
   `AP_DL_PRIORITY_MON/DAY` are `12`/`15`. Recorded literally: `aid_priority_date_selected = false`,
   `aid_priority_date = "12/15"`. This is UGA's filing error, not a mapping choice.
6. **`admissions.other_subject_label`** — C5 prints an "Other (specify)" row, but that row has `OTH_UNITS_REQ`/`REC`
   number cells and **no** label text field. Recorded `blank` (the row exists, the label is unfilled) rather than
   `absent`. Both score as abstention, so the choice is cosmetic.
7. **`identity.main_website ← AD_URL`.** The field name suggests admissions, but its widget (y 509.7) sits on the
   "Main Institution Website" row; the admissions email field `AD_EMAIL` is far below at y 240.5. Positionally verified.
8. **`academics.special_study_honors_program ← SR_PROJ_SOME_HON`.** A legacy field name ("senior project"), but its
   widget is the first item of E1's right-hand column (y 655.7) = "Honors program". Positionally verified.
9. **ROTC option letters.** `/B` = "On campus", `/C` = "At cooperating institution", inferred from widget order within
   each group (Navy additionally carries a leading `/NEW56` = "Marine Option" widget). Army and Air Force are `/B`.
10. **`financial_aid.aid_reporting_academic_year` / `aid_reporting_status` share one field.** `ACAD_YR = /2024`, and the
    `/2024` widget is the left-hand box labelled "2023-2024 Estimated" (the `/2023` widget is "2022-2023 Final"). So
    year = `2023-2024`, status = `estimated`.
11. **Absent-token guard.** No `present` entry carries an absent token as its value; the builder raises if one would.
    `BACH_LLS` and `AD_TFER_HS_GPA` hold literal empty strings and are recorded `blank`, not `present ""`.

## Sanity battery

55 identities computed, 52 pass. The three that do not are documented in the GT file's `seal.identities_failed`:

- **C1 enrolled full-time+part-time gender rows sum to 6140, but the C1 enrolled total row reads 6150.** UGA's own
  sub-rows do not reconcile with their total row. No manifest metric maps to those sub-rows; `enrolled_total` maps to
  `EN_TOT_1ST_N = 6150`, which agrees with both the gender-total row (2426+3719+5) and the residency row
  (5036+1051+62+1). Mapping is unaffected — this is a defect in the source document.
- **H2 row A = 6122 vs C1 full-time enrolled first-year = 6115**, and **vs B1 first-time full-time degree-seeking = 6121.**
  These are cross-section comparisons between deliberately different CDS cohorts, not within-table identities;
  `FRSH_FT_N` is confirmed by widget position to be H2 row A, column 1.
