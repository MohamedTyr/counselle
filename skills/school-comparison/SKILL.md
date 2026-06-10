---
name: school-comparison
description: Procedure for comparing 2–6 schools side by side on fields that matter for a specific intent (cost, selectivity, outcomes, etc.). Always renders a comparison_table viz. Handles missing values honestly per cell. Use when a student wants to compare schools.
---

# School Comparison

Source: DATABASE_GUIDE §14.2, §14.3, §11; ARCHITECTURE §17.

## When to use this skill

A student asks to compare two or more schools: "Compare Duke and Harvard on cost", "Which of these schools has better outcomes: UNC, UVA, or William & Mary?", "Duke vs Princeton — selectivity and financial aid."

Maximum 6 schools in one comparison. If a student names more, ask which 6 matter most.

## Step 1 — Resolve all schools

Call `resolve_school` for each school name. Collect all unitids. If any school is not in the database, say so for that school and proceed with the rest. Do not fabricate data for missing schools.

## Step 2 — Identify the comparison intent

Determine which dimensions the student cares about. Map intent to field presets:

**Selectivity / admissions**
- `admissions.acceptance_rate`, `admissions.sat_average`, `admissions.act_composite_25`, `admissions.act_composite_75`, `admissions.yield_rate_total`
- CDS (if cds_extracted): `cds.c7_academic_gpa`, `cds.c7_standardized_test_scores`, `cds.c8a_test_policy`

**Cost & affordability**
- `cost.tuition_out_of_state`, `cost.tuition_in_state`, `aid.avg_net_price_title4`, `aid.avg_net_price_0_30k`, `aid.avg_net_price_30_48k`, `aid.avg_net_price_48_75k`, `aid.pct_ftft_pell`, `aid.median_debt_completers`
- CDS (if available): `cds.pct_need_met_freshmen`

**Outcomes & earnings**
- `outcomes.grad_rate_6yr_bach`, `retention.rate_full_time`, `earnings.median_4yr_postcompletion`, `earnings.median_6yr`, `outcomes.cohort_default_rate_3yr`

**Academics**
- `academics.student_faculty_ratio`, `academics.instruction_expenditure_per_fte_gasb`, `programs.offers_cs_bachelors`, `programs.offers_engineering_bachelors`

**Campus life / vibe**
- Combination of `enrollment.undergrad_total`, `demographics.*`, `students.share_first_gen` + Reddit search for community context.

If the student has not specified a dimension and a clarifying question would materially change the field selection, ask (one question, 2–4 options). If a reasonable default exists (e.g. a general "compare" question defaults to cost + selectivity + outcomes), use it.

## Step 3 — Fetch the comparison data

Call `compare_schools(unitids=[...], field_keys=[...])`. The tool returns an N×M matrix of citation envelopes — one envelope per school-field cell. Cells where data is unavailable have `available: false`.

For earnings: always pick `earnings.median_4yr_postcompletion` as the primary earnings field. Supplement with `median_6yr` if the student asked about longer-term outcomes. Always add the earnings-lag caveat in the prose ("these figures reflect students who entered around [year], not current students").

## Step 4 — Render the comparison table

**Always** call `render_viz(type="comparison_table", unitids=[...], field_keys=[...])`. Do not present a comparison in prose only. The table shows each school as a column, each field as a row, with per-cell citations and "not available" for missing values.

Return from the tool call, then write a brief prose synthesis of the key differences. Do not re-state numbers that are in the table — the table is the source of truth for the numbers. Your prose is the interpretation.

## Step 5 — Handle missing values honestly

If a cell is `available: false`, the table renders it as "not available." In your prose, note significant gaps: "Net price by income band is not available for [School X] — it may be a non-Title-IV recipient school." Never fill a missing value with an estimate.

For CDS-only fields (factor weights, % need met, etc.): note which schools have CDS data and which do not. "Harvard and Duke have extracted CDS data; for NYU these fields are not available — I'm using IPEDS/Scorecard instead."

## Step 6 — Cite by marker

The comparison table tool assigns citation markers per cell. Reference the markers in your prose when discussing specific values: "Duke's net price for families under $30k was $X [3], compared to Harvard's $Y [7]." Use the markers you were given; never invent one.

## Coverage note

A comparison across schools with mixed tiers is fine — just note what each school's tier means for the depth of data available. Base-tier schools still have most of what students need for a cost/selectivity/outcomes comparison.
