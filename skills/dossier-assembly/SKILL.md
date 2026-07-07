---
name: dossier-assembly
description: Step-by-step procedure for assembling a complete, cited school dossier from the database. Covers school resolution, tier handling, which tools to call, section ordering, and fallback logic. Use when a student asks about a single school in depth.
---

# Dossier Assembly

Source: DATABASE_GUIDE §14.1, §7, §11, §12; ARCHITECTURE §11.

## When to use this skill

A student asks about one school in any depth — "tell me about Duke", "what's MIT like", "can you give me a full breakdown of UCLA". Also use it when building one school's side of a multi-school comparison before rendering the table.

## Agent voice and shape

Make the dossier useful as work product, not a casual chat reply. Lead with the most decision-relevant takeaway, then use compact section headings and cited bullets. Keep the order below unless the student asked for a narrower slice. Explain admissions terms inline only when they affect interpretation.

## Step 1 — Resolve the school

Call `resolve_school(name_or_unitid)` and branch on its `status`. On a found school, use the returned identity fields and `coverage_tier` (`base` | `cds_pdf_only` | `cds_extracted`).

If the status says the school is not in the database: stop immediately. Tell the student the school is not in the database. Do not proceed. Do not fabricate data.

If the name matches multiple campuses, do not use a clarify tool call in Agent V1. Use the most likely campus only when responsible, state the campus assumption, and continue. If no responsible default exists, explain the ambiguity and avoid school-specific facts.

## Step 2 — Note the coverage tier and set expectations

The tier tells you what depth is available:

- **cds_extracted**: Full depth. CDS-only fields (factor weights, GPA distribution, deadlines, waitlist stats) are available alongside IPEDS and Scorecard. This is the richest tier.
- **cds_pdf_only**: CDS PDF on file but not yet extracted. IPEDS and Scorecard cover most admissions, cost, aid, and outcomes questions; CDS-only detail is not available.
- **base**: IPEDS and Scorecard only. This covers ~98% of what most students need. Tell the student what is not available if they ask for it.

Say this once, briefly, at the start of the dossier. Example: "Duke has the deepest coverage — its Common Data Set has been extracted, so I have factor weights, GPA bands, and deadlines alongside the standard admissions and financial data [tier citation]."

## Step 3 — Fetch the dossier

Call `get_dossier(unitid, sections=None)` — fetches all six shortlist sections in one call. The tool returns citation envelopes. All values are already decoded, scaled, and formatted per the reading rules.

For programs and diversity (Section D sub-data and Section E):
- Programs/earnings by major: use `get_programs(unitid)`. Filter to `credlev=3` for bachelor's-level earnings.
- Diversity breakdown: use `get_diversity(unitid)`.

## Step 4 — Present sections in order

Present the dossier in this order. Each section heading matches the shortlist. If a section has little data, keep it brief and say what is not available instead of padding:

**A — Admissions & Selectivity**
Lead with the accept rate (prefer Scorecard `admissions.acceptance_rate` over IPEDS). Add test policy and score ranges. If cds_extracted: add factor weights, GPA distribution, ED/EA dates. Describe the SAT/ACT middle-50% ranges from the field values (keep SAT EBRW and Math separate — never a composite), and teach the middle-50% meaning when you show them.

**B — Cost & Aid**
Show tuition (in-state and out-of-state), room and board, net price by income band, Pell %, and median debt. Net price by income band is the most student-useful cost number. Note COA composition caveat if room_and_board is null — check the sibling field `cost.on_campus_room_board_other`. If cds_extracted: add % need met and avg aid package.

**C — Outcomes & Earnings**
Graduation rate (6-year), retention, and earnings. Always give the earnings-lag caveat with the exact entry cohort year from the citation. Example: "Median earnings 6 years after entry were $X [n] — reflecting students who entered around 2020, not today's students."

**D — Academics & Majors**
Student-faculty ratio, calendar system (decoded), special programs. Link to programs if the student asked about a specific major. Render a stat_block viz for 4+ numeric facts.

**E — Student Body & Diversity**
Headcount, demographics, first-gen %, Pell %, HBCU/HSI status. Use the `/diversity` data for the full breakdown.

**F — Institution Basics**
City, state, control (public/private), Carnegie classification (decoded), endowment per FTE (if relevant to the question).

## Step 5 — Cite everything

Every value carries a citation marker assigned by the source registry. Write the marker immediately after the fact: "The acceptance rate was 3.6% [1]." The tool already provides the markers — do not invent them.

## Fallback logic

- CDS field missing on a `cds_extracted` school: fall back to IPEDS/Scorecard equivalent. Note the gap.
- IPEDS field missing: fall back to Scorecard equivalent where one exists (see source-preference table in the DB guide). Note the source.
- No data at all: say "not available for this school." Never invent.
- Room and board null: try `cost.on_campus_room_board_other` before saying unavailable.
- Scorecard earnings: always add the entry-cohort caveat. Never omit it.
