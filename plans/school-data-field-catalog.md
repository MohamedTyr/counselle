# School data field catalog — CollegeData (scraped) with the Niche inventory kept for the record

**Status:** 2026-09-05. Companion to `plans/school-data-rearchitecture.md` §2.
**Owner decision 2026-09-05: only CollegeData is scraped.** Niche was fully inventoried
and then dropped because of its per-IP block (>2.5 h after 11 pages); its columns below
are retained so the gap analysis in §16 stays honest and so nothing has to be
re-inventoried if it is ever revisited. Built from live captures of Yale University and
University of Georgia (all 6 CollegeData tabs; all 10 Niche pages for Yale, main page
for UGA). Raw per-site inventories: `artifacts/school-data/collegedata-fields.md`
(178 labels) and `artifacts/school-data/niche-fields.md` (~250 labels).

**How to read the Owner column now:** **CD** = scraped in phase 1. **N** = *not
scraped*; the key is a known gap, filled by the CDS PDF parser (phase 2) or by
Navigator/Scorecard backfill where §16 says so, otherwise absent. **CD+N** = CD only
(the Niche cross-check does not exist).

## 0. How the two sites are read (both are JSON, not HTML)

| | CollegeData | Niche |
|---|---|---|
| URL | `collegedata.com/college-search/<Slug>/{admission,money-matters,academics,campus-life,students}` | `niche.com/colleges/<slug>/{,admissions,cost,academics,majors,students,campus-life,after-college,rankings,reviews}` |
| Payload | `<script id="__NEXT_DATA__">` → `props.pageProps.profile` with a typed `bodyContent` tree (`ExpandableSection` → `TitleValue` / `LabeledTable` / `IconTable` / `NestedTitleValue` / `BarGraph` / `SubscreenNavigator`) | `window.__PRELOADED_STATE__` → `profile.content.blocks[]` → `buckets{}` → `contents[]`, each leaf `{key, template, label, value, country, state, metroArea}`; JSON-LD `CollegeOrUniversity` block as a fallback for grades/ratings |
| Vintage | Site-wide footer: "2024-25 academic year"; "2024 Graduates" baked into some labels; deadlines roll forward to the next cycle year | Per-widget; `Trend` widgets cite IPEDS; ranking badges cycle `2027` |
| Access | Homepage first to get the WAF cookie, then school pages (502 without it); no bot wall; server-rendered | PerimeterX: `curl_cffi` chrome impersonation passes; **~10 pages in ~35 s → IP block (403) lasting >20 min, all fingerprints**; ~1 page / 30 s per IP is the safe cadence until measured otherwise |
| Pages needed | 5 topic tabs (Overview is a strict subset) | main + admissions + cost + academics + majors + students + campus-life + after-college + rankings (9); reviews page only if review text is wanted (paginated, 20/page) |
| Pitfalls | BarGraph bucket sets vary per school (omit vs `-1` sentinel); public schools return `[in-state, out-of-state]` lists where privates return one value; same subsection label reused for different row groups; "Merit-Based Gift" packs two facts in one value array; three distinct absence states (explicit "Not reported", row absent, capture truncated) | Grades are numeric 0–4.33 mapped to letters; Scatterplot/Map/Disclaimer blocks are client-fetched and empty in static HTML; sports table is ~126 boolean rows; `value` missing = NG/unavailable |

## 1. Dedup rules (applied throughout)

1. **CollegeData owns every CDS-grade quantitative fact** (funnel, tests, GPA, rank,
   selection factors, sticker cost, need-based aid, faculty, class size, retention,
   graduation, headcounts, ethnicity). It is the CDS re-typed, with counts + percents and
   a stated vintage. Niche's copy of the same number is **not stored** except for the
   six cross-check keys in §12, which exist only to fire the `source_disagreement` caveat.
2. **Niche owns everything Niche-editorial or user-generated**: 15 grades, rankings
   (national, state, by major), polls, review aggregates and text, Q&A, editorial
   paragraphs, search tags.
3. **Niche owns IPEDS/Scorecard facts CollegeData does not carry**: net price (overall,
   trend, by income band), housing vs meal-plan split, earnings, employment, loan default,
   residency/age/household-income breakdowns, Pell share, faculty salary/gender/diversity,
   research funding, student-faculty ratio, athletic division/conference, test-submit
   percentages.
4. **Different definition ≠ duplicate.** Where the two sites report related but differently
   defined measures (CollegeData "average indebtedness of graduates" vs Niche "average loan
   amount"; CollegeData need-based "received financial aid" vs Niche "students receiving
   any financial aid"; CollegeData "graduates offered full-time employment within 6 months"
   vs Niche "employed 1 year after graduation"), both are kept as **separate keys** with
   their own definition text, never merged or averaged.
5. **Lists that overlap loosely** (CollegeData "Activities and Organizations" vs Niche
   "Clubs Offered"/"Music") go to CollegeData; Niche's are dropped.
6. Overview-tab rows on CollegeData are never scraped (all duplicated on topic tabs).

Key naming: `snake_case`, grouped by domain prefix; `_pct` for percentages, `_n` for counts,
`_usd` for money, `_lo`/`_hi` for ranges. Owner column: **CD** = CollegeData, **N** = Niche,
**CD+N** = CollegeData leads, Niche stored as cross-check only.

## 2. Identity & contact

| Key | Owner | Source | Type | Notes |
|---|---|---|---|---|
| `control` (Public/Private) | CD | Overview `universityType` (also on every tab header) | enum | Niche `SearchTags` has "Private" — dropped |
| `coed` | CD | Students › Coeducational | bool | |
| `description` | CD | `profile.description` | text | blank for many publics; Niche editorial summary kept separately as `niche_summary` (§11) |
| `address_street/city/state/zip` | CD | `profile.address` | text | Niche `About.CompactAddress` dropped |
| `admissions_phone`, `admissions_fax`, `admissions_email` | CD | Admission › Admissions Office | text | |
| `website` | CD | `profile.website` | url | |
| `admissions_website`, `application_website` | N | `Admissions.AdmissionsWebsite/ApplicationWebsite` | url | CD has no equivalent |
| `financial_aid_website`, `net_price_calculator_url` | CD | Money Matters › Applying (TitleLink) | url | Niche dup dropped; fall back to Niche `Cost.FinancialAidWebsite/NetPriceCalculator` when CD row absent |
| `virtual_tour_url`, `campus_map_url` | N / CD | Niche `CampusLife.VirtualTourTextCTA`; CD `campusMapUrl` | url | |
| `mascot`, `school_colors` | CD | Campus Life › Sports & Recreation | text | |
| `setting` (Midsize City…) | N | `Overview.CitySetting` | enum | CD has city population instead |
| `city_population`, `nearest_metro`, `campus_size_acres`, `nearest_bus_station`, `nearest_train_station` | CD | Campus Life › Location and Setting | int/text | Yale's nearest_metro is garbled at source |
| `avg_jan_temp`, `avg_sept_temp`, `rain` | CD | top-level profile fields | number | schema exists, empty for both samples — stub |
| `niche_search_tags` | N | `About.SearchTags.tags[]` | list | e.g. "Research College or University" |
| `athletic_division`, `athletic_conference` | N | `About.AthleticDivision/AthleticConference` | enum | CD "Athletic Conferences" rendered only for UGA and coarser — dropped |

## 3. Admissions — funnel, policy, dates (CDS C1–C2, C15–C20)

| Key | Owner | Source | Type | Notes |
|---|---|---|---|---|
| `applicants_n`, `admitted_n`, `admit_rate_pct` | CD | Admission › Profile of Fall Admission › Overall Admission Rate (parsed from "5% of 50,264 applicants were admitted") | int/pct | Niche `TotalApplicants`/`AcceptanceRate` = cross-check (§12) |
| `applicants_women_n`, `admitted_women_n`, `admit_rate_women_pct`, same for `_men_` | CD | nested Women/Men rows | int/pct | CDS C1 gender split; Niche lacks |
| `enrolled_n`, `yield_pct`, `enrolled_women_n`, `enrolled_men_n`, `yield_women_pct`, `yield_men_pct` | CD | Students Enrolled (+nested) | int/pct | |
| `waitlist_offered_n`, `waitlist_accepted_n`, `waitlist_admitted_n` | CD | Students Offered/Accepting/Admitted Wait List | int | admitted row absent for some schools (absence ≠ 0) |
| `waitlist_used` | CD | Applying › Waiting List Used | bool | |
| `entrance_difficulty` | CD | Admissions › Entrance Difficulty | enum | CollegeData-derived rating; label as third-party derived |
| `early_decision_offered`, `early_action_offered` | CD | Early Admission | bool | Niche `OffersEarlyDecision/EarlyAction` = cross-check |
| `early_decision_admit_rate_pct` | N | `AdmissionsStatistics.EarlyDecisionAcceptanceRate` | pct | CD lacks; often null |
| `early_decision_deadline`, `early_action_deadline`, `early_action_notification` | CD | Early Admission | date | Niche ED/EA deadline dup dropped |
| `regular_deadline`, `regular_notification`, `reply_date` | CD | Application Dates & Fees | date | CD rolls the year forward; store month/day + inferred cycle |
| `application_fee_usd`, `fee_waiver_available` | CD | same | money/enum | Niche fee = cross-check |
| `defer_admission_allowed`, `transfer_applications_accepted` | CD | same | enum | |
| `accepts_common_app` | CD | Application Form › Common Application | bool | Niche dup dropped |
| `accepts_coalition_app` | N | `AdmissionsDeadlines.AcceptsCoalitionApp` | bool | CD lacks |
| `electronic_application` (+url) | CD | Application Form (TitleLink) | enum+url | |
| `need_blind` | CD | Other Application Requirements › Financial Need | enum→bool | "Financial need is not a consideration…" |

## 4. Admissions — requirements & selection factors (CDS C4, C7, C9)

| Key | Owner | Source | Type | Notes |
|---|---|---|---|---|
| `hs_graduation_requirement`, `hs_program_requirement` | CD | Freshman Admission Reqs › High School Preparation | enum | |
| `hs_units_required.{english,math,science,foreign_language,social_studies,electives}` and `hs_units_recommended.*` | CD | High School Units table (Req/Reco columns) | int | table absent for many privates |
| `test_policy` (Required / Considered if submitted / Not required…) | CD | Examinations table › "SAT or ACT" › Required Units | enum | Niche `SATACT` requirement = cross-check; FairTest list is the tiebreaker later |
| `test_due_date` | CD | Examinations › Due in Admissions Office | text | |
| `act_writing_policy`, `sat_subject_tests_policy` | CD | Examinations rows | enum | mostly "Not reported" now |
| `interview_requirement`, `essay_requirement`, `recommendations_requirement`, `other_requirement` | CD | Other Application Requirements | enum/text | rows absent for some schools |
| `req_high_school_gpa`, `req_high_school_rank`, `req_transcript`, `req_college_prep_courses` | N | `AdmissionsRequirements.*` (Required / Considered but not required / Neither…) | enum | CD has no per-item row for these four |
| `selection_factor.{rigor,gpa,tests,class_rank,recommendations,essay,interview,interest,extracurriculars,volunteer,talent,character,first_gen,state_residency,geography,legacy,religion,work}` | CD | Selection of Students table | enum(Very Important / Important / Considered / Not Considered) | CDS C7, all 18 factors, identical set both schools |

## 5. Class profile — tests, GPA, rank (CDS C9–C12)

| Key | Owner | Source | Type | Notes |
|---|---|---|---|---|
| `sat_math_lo/hi`, `sat_math_avg`, `sat_ebrw_lo/hi`, `sat_ebrw_avg` | CD | Profile of Fall Admission › BarGraph titles ("SAT Math: 740-790 range…") | int | Niche `SATReading/SATMath` dup dropped; Niche composite `SATRange` = cross-check |
| `sat_math_dist.{700_800,600_700,500_600,400_500,300_400,200_300}_pct`, same `sat_ebrw_dist` | CD | BarGraph rows | pct | always 6 buckets, `-1` = not reported |
| `act_composite_lo/hi`, `act_composite_avg`, `act_math_avg`, `act_english_avg` | CD | ACT BarGraph titles | int | Niche `ACTEnglish/ACTMath` ranges dropped (CD gives distributions) |
| `act_composite_dist.*`, `act_math_dist.*`, `act_english_dist.*` (6 buckets each) | CD | BarGraph rows | pct | |
| `sat_submitted_pct`, `act_submitted_pct` | N | `AdmissionsStatistics.StudentsSubmittingSAT/ACT` | pct | **CD lacks; honesty-critical for reading any band** (`classify-fit.ts` trap 1) |
| `gpa_avg`, `gpa_weighted` | CD | Qualifications of Enrolled Freshmen › Average GPA ("4.17 (based on weighted GPAs)") | float/bool | |
| `gpa_dist.{4_00_plus,3_75_3_99,3_50_3_74,3_25_3_49,3_00_3_24,2_50_2_99,2_00_2_49}_pct` | CD | GPA BarGraph | pct | bucket omitted vs `-1` both occur |
| `class_rank_top_tenth_pct`, `_top_quarter_pct`, `_top_half_pct` | CD | High School Class Rank | pct | row absent for many publics |
| `national_merit_n`, `valedictorian_n`, `class_president_n`, `student_gov_officer_n` | CD | Profile rows | int | almost always "Not reported"; keep as keys |

## 6. Cost (CDS G)

| Key | Owner | Source | Type | Notes |
|---|---|---|---|---|
| `tuition_fees_in_state_usd`, `tuition_fees_out_of_state_usd` | CD | Money Matters header widget `tuitionFeesCost` (list of 1 or 2) | money | private → same value both; Niche `InStateTuition/OutOfStateTuition` = cross-check |
| `room_board_usd` | CD | `roomBoardCost` | money | combined |
| `housing_usd`, `meal_plan_usd` | N | `Cost.AverageHousingCost/AverageMealPlanCost` | money | the split CD lacks |
| `books_supplies_usd`, `other_expenses_usd` | CD | `suppliesCost/otherExpensesCost` | money | Niche books = dup dropped |
| `cost_of_attendance_in_state_usd`, `_out_of_state_usd` | CD (computed) | sum of the four lines above; CD's own `attendanceCost` widget is unreliable ("No data available" for UGA out-of-state) | money | store the sum, keep CD's printed value as `cost_of_attendance_printed` |
| `payment_plans` | CD | `paymentPlans` | list | empty for both samples |
| `tuition_guarantee_plan`, `tuition_payment_plan`, `prepaid_tuition_plan` | N | `StickerPrice.*` | bool | Cost sub-page only |
| `net_price_usd` | N | `Cost.NetPrice` (+`country`/`state` comparators) | money | IPEDS; CD lacks |
| `net_price_trend[]` (year, value), `net_price_change_pct`, `net_price_direction` | N | `Cost.NetPriceTrend.trends[0]` | series | explicit IPEDS citation |
| `net_price_income_{lt30k,30_48k,49_75k,76_110k,110k_plus}_usd` | N | `NetPrice.NetPriceIncome1..5` | money | Cost sub-page only |
| `cost_per_credit_in_state_usd`, `_out_of_state_usd` | N | `Cost.*CostPerCredit` | money | null for 4-year schools; keep for 2-year |

## 7. Financial aid (CDS H)

All CD rows come twice (Freshman, All Undergraduates); store both with a `population` dimension.

| Key | Owner | Source | Type | Notes |
|---|---|---|---|---|
| `aid_applicants_n/_pct` | CD | Profile of Financial Aid › Financial Aid Applicants | int/pct | |
| `need_found_n/_pct`, `aid_received_n/_pct`, `need_fully_met_n/_pct` | CD | same block | int/pct | CDS H2/H4 |
| `need_met_avg_pct` | CD | Average Percent of Need Met | pct | Niche lacks |
| `award_avg_usd` | CD | Average Award | money | |
| `need_gift_recipients_n/_pct`, `need_gift_avg_usd`, `need_selfhelp_recipients_n/_pct`, `need_selfhelp_avg_usd` | CD | nested Need-Based Gift / Self-Help | int/pct/money | CDS H6 |
| `merit_to_need_recipients_n/_pct`, `merit_no_need_n/_pct`, `merit_no_need_avg_usd` | CD | Merit-Based Gift value[0] / value[1] | int/pct/money | two facts in one label — split by position |
| `grads_with_loans_pct`, `indebtedness_avg_usd` (+ `graduating_class_year`) | CD | 2024 Graduates Who Took Out Loans / Average Indebtedness | pct/money | CDS H8; year from label text |
| `aid_deadline`, `aid_award_notification`, `aid_methodology` | CD | Applying For Financial Aid | date/text/enum | |
| `fafsa_code`, `css_profile_required`, `css_profile_fee_text` | CD | Forms Required table | text/bool | CSS row absent = not required (state as such, not "not reported") |
| `federal_loans[]`, `other_loans[]`, `need_based_programs[]`, `non_need_programs[]` | CD | Financial Aid Programs › Loans / Scholarships and Grants | list | |
| `non_need_award_areas.{academic,creative,special_achievement,special_characteristics}` (+ counts) | CD | Non-Need Awards | text/int | |
| `work_study_programs`, `on_campus_employment_avg_usd` | CD | Employment | enum/money | |
| `any_aid_recipients_pct`, `aid_total_avg_usd` | N | `Cost.AnyFinancialAid`, `Cost.AverageFinancialAidAmount` | pct/money | **different definition** from CD need-based rows (rule 4); IPEDS all-aid |
| `pell_recipients_pct` | N | `Students.PellGrantPercent` | pct | CD lacks |
| `household_income_dist.{lt30k,30_48k,49_75k,76_110k,110k_plus}_pct` | N | `AboutStudentsPoll.HouseholdIncomeLevelBreakdown` | pct | Students sub-page |

## 8. Academics, faculty, class size (CDS E, I)

| Key | Owner | Source | Type | Notes |
|---|---|---|---|---|
| `calendar` | CD | Academics header › Academic Calendar System | enum | Niche `Calendar` dropped |
| `summer_session` | CD | Academics header | enum | |
| `majors_n`, `majors[]` | CD | Undergraduate Majors (SubscreenNavigator, "View All Majors (90)") | int/list | list is a sub-screen fetch; Niche full major catalog with graduate counts kept separately below |
| `popular_disciplines[]` | CD | Most Popular Disciplines | list | Peterson's top-disciplines |
| `popular_majors[]` (name, graduates_n), `majors_by_category{}` | N | `Majors.PopularMajorsCollege.entities[]`; `MajorsExpansionWithOverview` | list | IPEDS completions counts — CDS J analogue; CD lacks counts |
| `special_programs[]` (accelerated, double major, honors, internships, study abroad, distance learning, co-op, ESL, student-designed…) | CD | Special Programs | list of flags | CDS E1; Niche `StudyAbroad`/`TeacherCertification`/`EveningCollege` dropped |
| `combined_degree_programs` | CD | same section | enum | |
| `online_degrees` | CD | Online Degrees | enum | Niche `OnlineAcademics.*` (programs entirely online, how students learn breakdown) kept as `online_programs_n`, `learning_mode_dist` — N, distinct facts |
| `gen_ed_required`, `foreign_language_required`, `math_science_required`, `computer_required` | CD | Curriculum and Graduation Requirements | enum | |
| `faculty_full_time_n`, `faculty_part_time_n`, `faculty_terminal_degree_pct` | CD | Faculty and Instruction | int/pct | CDS I1 |
| `student_faculty_ratio` | N | `Academics.StudentFacultyRatio` | ratio | CD lacks ratio (only counts) |
| `class_size_dist.{2_9,10_19,20_29,30_39,40_49,50_99,100_plus}_pct` | CD | Regular Class Size BarGraph | pct | CDS I3, 7 buckets, omitted bucket = 0 or not reported (log which); Niche 4-bucket `ClassSizeBreakdown` dropped |
| `faculty_female_pct`, `faculty_male_pct`, `faculty_salary_avg_usd`, `faculty_diversity_dist{}` | N | `AboutTheProfessors.*` | pct/money | CD lacks |
| `research_funding_per_student_usd` | N | `AcademicStatistics.ResearchFundingPerStudent` | money | |
| `ap_policy`, `ib_policy`, `sophomore_standing` | CD | Advanced Placement | enum | |
| `library_on_campus`, `library_holdings_n`, `computers_available` | CD | Academic Resources | bool/int | |
| `remedial_instruction`, `tutoring`, `learning_disabled_services`, `physically_disabled_services[]` | CD | Academic Support Services | enum/list | |
| `masters_degrees[]`, `masters_programs_n`, `doctoral_degrees[]`, `doctoral_programs_n` | CD | Graduate/Professional School Education | list/int | |

## 9. Students — headcount, demographics (CDS B1–B2)

| Key | Owner | Source | Type | Notes |
|---|---|---|---|---|
| `undergrad_n`, `undergrad_women_n/_pct`, `undergrad_men_n/_pct`, `undergrad_full_time_n`, `grad_n` | CD | Students › Student Body | int/pct | Niche `TotalUndergrad/FullTimeUndergrad/PartTimeUndergrad` = cross-check on `undergrad_n` only |
| `undergrad_nonbinary_pct` | N | `AboutStudentsPoll.NonBinaryUndergraduatePercent` | pct | CD lacks |
| `ethnicity_dist.{aian,asian,black,hispanic,multiracial,nhpi,white,unknown}_pct` | CD | Ethnicity of Students from U.S. BarGraph (8 fixed rows) | pct | CDS B2; Niche 9-category `RacialDiversityUndergraduateBreakdown` dropped |
| `international_pct`, `international_countries_n` | CD | International Students ("1.3% from 90 countries") | pct/int | |
| `residency_dist.{in_state,out_of_state,international,unknown}_pct` | N | `AboutStudentsPoll.StudentPrimaryResidenceBreakdown` | pct | CD lacks — the C1 residency analogue |
| `age_avg` | CD | Average Age | int | |
| `age_dist.{under_18,18_19,20_21,22_24,over_25}_pct`, `undergrads_over_25_pct` | N | `CollegeAgeBreakdown`, `Students.UndergradsOver25` | pct | |
| `varsity_athletes_pct` | N | `Students.VarsityAthletes` | pct | |

## 10. Campus life (CDS F)

| Key | Owner | Source | Type | Notes |
|---|---|---|---|---|
| `housing_offered`, `housing_types[]`, `students_in_housing_pct`, `off_campus_pct`, `freshman_housing_guarantee`, `off_campus_assistance` | CD | Campus Life › Housing | enum/list/pct | Niche `UndergradsInCollegeHousing` dropped |
| `freshmen_on_campus_pct`, `freshmen_required_on_campus`, `meal_plan_available` | N | `CampusLife.FreshmenLivingOnCampus`, `Housing.FreshmenRequiredLiveOnCampus`, `Food.MealPlanAvailable` | pct/bool | CD lacks |
| `security.{emergency_phones,patrols_24h,late_night_transport,electronic_entrances}` | CD | Security | bool | |
| `health_service`, `personal_counseling`, `child_care` | CD | Personal Support Services | enum | Niche `DaycareServicesCollege` dropped |
| `activities[]`, `rotc[]` (branch, on/off campus) | CD | Student Activities | list | Niche `ClubsOffered`/`Music` dropped (rule 5) |
| `sorority_participation_pct`, `fraternity_participation_pct` | CD | Sororities / Fraternities | pct | Niche Greek % null in samples |
| `varsity_sports[]` (sport, women_offered, women_scholarship, men_offered, men_scholarship) | CD | Intercollegiate Sports & Scholarships IconTable | rows | scholarship flags are CD-only; Niche ~126-row sports table dropped |
| `club_sports[]`, `intramural_sports[]` | CD | Club Sports / Intramural Sports | list | |

## 11. Outcomes (CDS B22 + Scorecard)

| Key | Owner | Source | Type | Notes |
|---|---|---|---|---|
| `retention_first_year_pct` | CD | First-Year Students Returning | pct | CDS B22; Niche `FullTimeRetentionRate` = cross-check |
| `grad_rate_4yr_pct`, `grad_rate_5yr_pct`, `grad_rate_6yr_pct` | CD | Undergraduate Retention & Graduation | pct | CDS B; Niche `CollegeGraduationRate` = cross-check on 6-yr |
| `employed_6mo_pct`, `starting_salary_avg_usd`, `advanced_study_pct`, `disciplines_pursued` | CD | After Graduation | pct/money | Peterson's-sourced |
| `earnings_1yr_median_usd`, `earnings_5yr_median_usd`, `employed_1yr_pct`, `employed_5yr_pct` | N | `AfterCollege*.Median…/Employed…` (+ country/state comparators) | money/pct | Scorecard-derived; **different definition** from CD 6-month figure (rule 4) |
| `loan_default_rate_pct`, `loan_amount_avg_usd` | N | `StudentDebt.*` | pct/money | distinct from CD `indebtedness_avg_usd` (rule 4) |
| `retention_part_time_pct` | N | `AcademicStatistics.PartTimeRetentionRate` | pct | |

## 12. Cross-check keys (stored from both, Niche never leads)

`admit_rate_pct`, `applicants_n`, `sat_composite_lo/hi` (CD math+EBRW vs Niche composite —
compare sums), `act_composite_lo/hi`, `tuition_fees_in_state_usd`, `grad_rate_6yr_pct`,
`regular_deadline`, `application_fee_usd`, `undergrad_n`. Tolerance per key lives in
config; a miss fires `source_disagreement` with both vintages shown.

## 13. Niche-only: grades, rankings, sentiment (third-party tier, never a "school fact")

| Key | Source | Type | Notes |
|---|---|---|---|
| `niche_grade_overall` + `niche_grade.{academics,value,diversity,campus,athletics,party_scene,professors,location,dorms,campus_food,student_life,safety,student_wellness,future_readiness}` | `ReportCard` (numeric 0–4.33 → letter; missing = NG) | grade | keep numeric + letter; JSON-LD letters as fallback |
| `niche_rankings[]` (title, rank, of_n, scope: national/state/major, cycle) | `RankingsExpansion.badgeGroups[]`, `MajorListTopRankedMajors` | list | 65 for Yale |
| `niche_review_avg`, `niche_review_n`, `niche_review_dist{1..5}` | `Reviews.ReviewStars/ReviewChart` | float/int | |
| `niche_review_summary`, `niche_review_keywords[]` | `Reviews.ReviewSummary` | text/list | AI-generated by Niche — label as such |
| `niche_reviews[]` (guid, rating, author_class, created, body, categories, helpfulness) | Reviews page, paginated | rows | **decision pending** whether body text is stored (RAG) or only aggregates + short excerpts |
| `niche_qanda[]` (question, answer) | `ReviewQanda` (32 pairs for Yale) | rows | AI-synthesized from reviews |
| `niche_summary`, `niche_admissions_summary` | `Overview.Editorial`, `AdmissionsEditorialWithLinks` | text | templated from stats |
| `niche_polls{}` — one key per poll: `professors_effort`, `classes_you_want`, `workload_manageable`, `attendance`, `office_hours`, `professors_passionate/care/engaging/approachable`, `admissions_cared`, `evaluated_as_person`, `one_word_school[]`, `one_word_student[]`, `greek_life_role`, `varsity_sports_popularity{}`, `campus_community{}`, `facility_quality.{athletics,dining,performing_arts}`, `dorm_quality`, `dorm_social`, `best_food_options[]`, `feel_safe`, `peer_pressure{}`, `campus_police{}`, `favorite_traditions[]`, `party_scene{}`, `biggest_party[]`, `political_self{}`, `political_campus{}`, `ethnic_diversity`, `international_diversity`, `confident_job`, `money_worth`, `alumni_network`, `career_center` | `Poll*` templates: `summedResponseCount/totalResponseCount` or `options[]{body,responseCount}` | pct or distribution | always store the response `n` beside the % — small samples (n=27) are common |

## 14. Counts

| | Keys (leaf facts, excluding repeated dimensions) |
|---|---|
| CollegeData-owned | ~150 (+ per-population aid rows, per-sport rows, per-bucket distributions) |
| Niche-owned facts (§2–§11) | ~45 |
| Niche-only editorial (§13) | 15 grades + rankings + reviews + ~40 polls |
| Cross-checks | 9 |

Dropped as pure duplicates (kept in the raw inventories, not in the store): ~35 Niche
top-line numbers that CollegeData carries with more granularity, the whole CollegeData
Overview tab, Niche's 4-bucket class size, 9-category ethnicity, clubs/music lists,
~126-row sports table, and Niche's copies of deadlines, fees, Common App flag, calendar,
study abroad, and daycare.

## 15. Open items

- **Niche cadence is the real risk, measured 2026-09-04:** 11 pages in ~35 s from one
  residential IP → 403 on every subsequent request, every browser fingerprint, for **more
  than 2.5 hours and still blocked** when this was written (probe continues). Until the
  block clears and a slow-pace test (1 page / 5 min for an hour) shows what rate survives,
  assume Niche is a *trickle* source from a single free IP: main page only (~100 facts),
  top schools first, spread over weeks — not a full pass. If the slow rate also trips
  the block, Niche needs either rotating residential IPs (not free) or Firecrawl, which is
  the recorded fallback in `plans/school-data-rearchitecture.md` §3.
- CollegeData `majors[]`, `masters_programs`, `doctoral_programs` live behind
  SubscreenNavigator sub-fetches — confirm the endpoint before counting on the full lists.
- Two CollegeData captures were truncated (UGA Financial Aid Programs, Yale Academic
  Support onward); re-verify those sections live before finalizing parsers.
- Niche `Scatterplot` (admit rate by GPA/SAT) is client-fetched from an API — if that API
  is reachable it is chancing-relevant; not in scope of this catalog.

## 16. Gap analysis after dropping Niche (what the store will NOT have from CollegeData)

| Gap (was Niche-owned) | Matters for | Cheapest fill |
|---|---|---|
| `sat_submitted_pct`, `act_submitted_pct` | Honesty: a test band without its submitter share is a manufactured fact (`classify-fit.ts` trap 1) | CDS PDF C9 (phase 2 parser); College Navigator also lists "percent submitting" |
| `net_price_usd`, `net_price_income_*_usd`, `net_price_trend[]` | Facts page money section, Explore net-price filter, costs-and-aid skill | College Navigator (unitid-keyed, trivial; 1–2 yr lag) or Scorecard API |
| `residency_dist.*` (in-state / out-of-state / international) | Chancing feature; publics' selectivity split | CDS PDF C1 residency table (phase 2) |
| `earnings_1yr/5yr_median_usd`, `employed_1yr/5yr_pct`, `loan_default_rate_pct` | Outcomes / ROI advice | Scorecard (unitid-keyed) |
| `student_faculty_ratio` | Facts page academics headline | compute from CD `faculty_full_time_n` / `undergrad_full_time_n` (label as computed) or Navigator |
| `pell_recipients_pct`, `household_income_dist.*`, `age_dist.*`, `undergrad_nonbinary_pct`, `varsity_athletes_pct` | Demographics detail | Navigator (Pell), otherwise absent |
| `faculty_salary_avg_usd`, `faculty_female/male_pct`, `faculty_diversity_dist{}`, `research_funding_per_student_usd` | Academics detail | absent (IPEDS HR survey if ever needed) |
| `housing_usd` / `meal_plan_usd` split, `freshmen_on_campus_pct`, `freshmen_required_on_campus` | Campus life detail | CD has combined `room_board_usd` and `students_in_housing_pct`; rest absent |
| `athletic_division`, `athletic_conference` | Facts page campus life | CD renders "Athletic Conferences" for some schools only; otherwise Wikidata/official site |
| `early_decision_admit_rate_pct` | Chancing round-level prior | CDS PDF C21 (phase 2); College Kickstart (phase 3) |
| `accepts_coalition_app`, `req_transcript`, `req_college_prep_courses` | Requirements — out of scope | absent |
| All of §13 (grades, rankings, reviews, Q&A, polls, editorial) | The qualitative layer for guided-counselor mode | absent by decision; live Tavily/Reddit search remains the qualitative fallback |

Cross-check keys (§12) no longer exist; `source_disagreement` fires only between the CDS
PDF, CollegeData, and Navigator for the same key.
