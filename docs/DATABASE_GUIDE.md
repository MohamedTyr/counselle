# Counselle — Database Guide for the AI Agent

> **What this is.** The single, exhaustive reference for everything the Counselle AI agent needs to know about the underlying data, so we can build the agent the best way possible — now and in the future. It was produced by reading the data-pipeline docs **and** verifying every claim against the **live database** (snapshot **2026-06-09**), then reviewed for accuracy, completeness, and clarity.
>
> **The data lives in the `ascensia-data-pipeline` repo/DB** (`~/Projects/ascensia-data-pipeline`). Counselle (the agent) is a read-only consumer. This guide is the contract between the data and the agent.
>
> **Source-of-truth precedence:** the live DB > this guide > the pipeline's generated docs (a few of which have drifted — see [§13](#13-known-gotchas--doc-discrepancies)).

---

## Table of contents

1. [The 60-second mental model](#1-the-60-second-mental-model)
2. [Connecting & querying](#2-connecting--querying)
3. [The core data model](#3-the-core-data-model)
4. [Hard invariants the agent must respect](#4-hard-invariants-the-agent-must-respect)
5. [The fields catalog (the agent's main surface)](#5-the-fields-catalog-the-agents-main-surface)
6. [Value semantics & reading rules (anti-misread)](#6-value-semantics--reading-rules-anti-misread)
7. [The curated dossier field shortlist](#7-the-curated-dossier-field-shortlist)
8. [Raw sources, multi-row data & enum decoding](#8-raw-sources-multi-row-data--enum-decoding)
9. [Data recency & provenance — how to date any value](#9-data-recency--provenance--how-to-date-any-value)
10. [Query surface: API endpoints & direct SQL](#10-query-surface-api-endpoints--direct-sql)
11. [School identity & name resolution](#11-school-identity--name-resolution)
12. [The CDS pipeline & current coverage](#12-the-cds-pipeline--current-coverage)
13. [Known gotchas & doc discrepancies](#13-known-gotchas--doc-discrepancies)
14. [How-to recipes for the agent](#14-how-to-recipes-for-the-agent)
15. [Appendix: live snapshot & full table inventory](#15-appendix-live-snapshot--full-table-inventory)

---

## 1. The 60-second mental model

- **2,746 schools** (all currently `level='4-year'`, Title-IV, bachelor's+), keyed by IPEDS `unitid` (integer PK).
- **1,093 "fields"** (curated, student-meaningful metrics) defined in `public.fields`, projected into **~2.09M rows** in `public.field_values` — one value per `(school, field, year)`.
- **3 data sources**: `ipeds` (417 fields), `scorecard` (392 fields), `cds` (284 fields).
- **`field_values` is the agent's primary surface.** Almost every "what about school X" question is one or more lookups here. `value` is a **`jsonb`** column.
- **Beyond `field_values`**, two multi-row datasets need dedicated reads: **programs** (earnings/debt by major, `raw.scorecard_fos`) and **diversity** (race/sex enrollment, `raw.ipeds_ef2024a`). IPEDS **coded values** (e.g. `control=2`) need decoding via a dictionary table.
- **Vintage matters and is knowable.** IPEDS ≈ 2024-25 (provisional); Scorecard is a snapshot dated in its filename (currently **March 2026**), and its earnings figures lag ~4–11 years; CDS is per academic year (2024-25), only for the handful of schools processed so far.
- **CDS is rich but sparse today**: only **8 schools** have extracted CDS data (218–249 fields each). The agent must always fall back to IPEDS/Scorecard.

---

## 2. Connecting & querying

### Two ways in

**A. Direct Postgres (full SQL power — recommended for the agent).**
```
postgresql://ascensia:ascensia@localhost:5432/ascensia
```
Port 5432 is exposed on the host. Role `ascensia`, db `ascensia`. Host verification:
```bash
cd ~/Projects/ascensia-data-pipeline && docker compose exec -T db psql -U ascensia -d ascensia -c "SQL"
```

**B. The HTTP API** at `http://localhost/api` (Caddy → FastAPI). Good for the read shapes it already exposes (school detail, fields, programs, diversity, enum decode). See [§10](#10-query-surface-api-endpoints--direct-sql).

### The one non-negotiable rule: parameterized SQL only (pipeline ADR 0001)

**Never** build SQL with f-strings, `%`-format, `.format()`, or string concatenation of literals. Use bound params (`$1..$n` for asyncpg, `%s`/`%(name)s` for psycopg2). **Dynamic identifiers** (table/column names — relevant because of 50+ dynamically named `raw.*` tables) must be safely quoted: `psycopg2.sql.Identifier` for psycopg2, or a trusted query-builder/whitelist for asyncpg (asyncpg has no `Identifier` helper). Never f-string a table name. The agent issues **SELECT only**.

### jsonb decoding

`field_values.value` and `settings.value` are `jsonb`. Over asyncpg (the API path) a codec decodes them to native Python objects. Over psycopg2 they arrive as **strings** unless `register_json()` is called — the agent's DB layer must normalize either way. `cds_files.content` (bytea) arrives as `memoryview` under psycopg2 — coerce with `bytes(...)`.

---

## 3. The core data model

Two schemas: **`public`** (application read model — what the agent reads) and **`raw`** (verbatim ingest artifacts, rebuildable). Most enums are enforced via inline `CHECK (col IN (...))`. The only extensions are `pg_trgm` (fuzzy name search) and `plpgsql`.

### `schools` — the institution list (2,746 rows)

| Column | Type | Null | Notes |
|---|---|---|---|
| `unitid` | integer | ✗ | **PK**. IPEDS Unit ID; stable across years. |
| `name` | text | ✗ | Official IPEDS name; may carry a campus suffix. |
| `city` | text | ✓ | Only returned by `GET /schools/{unitid}`. |
| `state` | text | ✓ | 2-letter postal code. Indexed. |
| `control` | text | ✓ | **Decoded string** populated by pipeline transform (NOT a DB-enforced enum): `public` / `private_nonprofit` / `private_forprofit`. |
| `level` | text | ✓ | `4-year` / `2-year` / `less-than-2-year`. **All current rows are `4-year`.** |
| `is_tracked` | boolean | ✗ | Admin flag for CDS collection. Partial index on `true`. |
| `tracked_at` | timestamptz | ✓ | |
| `raw_coverage_filled` / `raw_coverage_total` | integer | ✓ | Precomputed raw-column coverage. |
| `created_at` | timestamptz | ✗ | |

Indexes: PK on `unitid`; `schools_state_idx` (state); `schools_is_tracked_idx` (partial); `schools_name_trgm` (GIN trigram on `name`).

> **Note:** `schools.control` is a **decoded string** (prefer it when you just need public/private). The `institution.control` *field_value* (from raw `CONTROL`) stores the raw integer 1/2/3 and needs decoding. Don't confuse the two.

### `fields` — the metric catalog (1,093 rows)

| Column | Type | Null | Notes |
|---|---|---|---|
| `key` | text | ✗ | **PK**. Dot-namespaced: `category.name`, e.g. `admissions.acceptance_rate`. |
| `label` | text | ✗ | Human-readable display name. |
| `category` | text | ✓ | One of **17** categories (see [§5](#5-the-fields-catalog-the-agents-main-surface)). |
| `data_type` | text | ✗ | `int` / `number` / `percent` / `currency` / `text` / `bool` / `date` / `json`. (`date`/`json` defined but **unused** today.) |
| `source` | text | ✗ | `ipeds` / `scorecard` / `cds`. |
| `raw_table` | text | ✓ | FQ raw table (e.g. `raw.ipeds_adm2024`). **NULL for all CDS fields.** |
| `raw_column` | text | ✓ | Raw column or Scorecard JSON key. **NULL for all CDS fields.** |
| `transform` | jsonb | ✓ | How the raw value is cast (see [§6](#6-value-semantics--reading-rules-anti-misread)). NULL = passthrough. |
| `enabled` | boolean | ✗ | All 1,093 enabled today. |
| `sort_order` | integer | ✗ | Display order within category. |
| `extraction_hint` | text | ✓ | **CDS-only** LLM hint. Perfectly partitioned: every CDS field has one; no non-CDS field does. |
| `created_at` | timestamptz | ✗ | |

### `field_values` — the value store (2,087,998 rows) — **the agent's main table**

| Column | Type | Null | Notes |
|---|---|---|---|
| `unitid` | integer | ✗ | FK → `schools` (CASCADE). |
| `field_key` | text | ✗ | FK → `fields` (CASCADE). |
| `cycle_year` | integer | ✓ | Start year of academic year. **NULL for all Scorecard.** IPEDS=2024 (or 2023 for aid/finance). CDS=2024. |
| `value` | jsonb | ✓ | The payload. **NULL = attempted-but-not-found (sentinel/suppressed), not an error.** |
| `source` | text | ✗ | `ipeds` / `scorecard` / `cds`. |
| `raw_file_id` | bigint | ✓ | FK → `raw.files` (SET NULL). Provenance anchor (date). Schema-nullable (goes NULL if a raw file is deleted), but **all 2,087,998 current rows are populated** — so the provenance INNER JOIN in [§9](#9-data-recency--provenance--how-to-date-any-value) is safe today. |
| `trace_id` | text | ✓ | structlog trace of the ingest run. |
| `updated_at` | timestamptz | ✗ | |

**Unique key:** `(unitid, field_key, cycle_year)` **NULLS NOT DISTINCT** → exactly one value per school/field/year, and for Scorecard (year NULL) exactly one per school/field. Indexes also on `unitid` and `field_key`.

**Live distribution by source × year:**

| source | cycle_year | rows |
|---|---|---|
| scorecard | NULL | 1,054,480 |
| ipeds | 2024 | 954,162 |
| ipeds | 2023 | 77,458 (aid/finance: SFA/F tables) |
| cds | 2024 | 1,898 (8 schools) |

### `source_columns` — the raw-column catalog (6,087 rows)

Every raw column is registered with `label`, `sample_value`, `is_pickable`. 5,398 pickable, 689 non-pickable (multi-row + dict tables). 2,603 IPEDS, 3,484 Scorecard, **0 CDS** (CDS bypasses this catalog). Mostly an admin concern, but it's how "any raw column is trackable" works, and the join target for enum decoding.

### `settings` — runtime knobs (16 rows, jsonb values)

Notable: `current_cycle_year = 2024` (default year for new CDS jobs; the canonical "current year" signal). The rest are `cds.*` (models, caps, index TTL — see [§12](#12-the-cds-pipeline--current-coverage)).

### CDS operational tables

`cds_jobs` (per school/year status board), `cds_files` (downloaded PDF bytes in `content` bytea), `cds_job_steps` (curated GUI timeline), `cds_index_entries` + `cds_index_meta` (the College Transitions URL index). Detail in [§12](#12-the-cds-pipeline--current-coverage).

---

## 4. Hard invariants the agent must respect

1. **One value per cell.** `(unitid, field_key, cycle_year)` is unique with `NULLS NOT DISTINCT`. For Scorecard fields query `cycle_year IS NULL`; for IPEDS/CDS query the integer year. Don't mix NULL-year and integer-year rows for the same field without understanding they're different sources/vintages.
2. **`value IS NULL` ≠ "never collected".** It means projected-but-not-found (a sentinel or suppression). A **missing row** means the source was never consulted for that school. **The agent treats both as "not available"** — never invent a value, never read a sentinel as data.
3. **Parameterized SQL only** (pipeline ADR 0001). SELECT only.
4. **`value` is `jsonb`** and may arrive as native object (asyncpg) or string (psycopg2) — normalize.
5. **Multi-row data is never in `field_values`** — programs and diversity must come from their own queries/endpoints ([§8](#8-raw-sources-multi-row-data--enum-decoding)).
6. **CDS is admin-initiated only** (pipeline ADR 0004). Data appears only after a human queued a job, **and `extract_status='done'` does NOT prove values were written** (Stanford is the counter-example). Always confirm coverage with a `field_values` count ([§14](#14-how-to-recipes-for-the-agent)).
7. **`schools` is a curated subset.** `raw.ipeds_hd2024` has 6,072 institutions; `schools` has 2,746 (active, 4-year, Title-IV). The DB is **not** the full universe of US higher ed — don't claim completeness.

---

## 5. The fields catalog (the agent's main surface)

**By source:** IPEDS 417 · Scorecard 392 · CDS 284 = **1,093**. (4 **CDS** fields have no values yet — `cds.d6_min_hs_gpa_transfer`, `cds.d7_min_college_gpa_transfer`, `cds.tuition_instate`, `cds.tuition_outofstate` — so 1,089 distinct keys are present in `field_values`.)

**By data_type:** percent 381 · currency 225 · int 183 · bool 125 · number 103 · text 76. (Over half the catalog is directly-comparable numeric data.)

**By category (17 total).** Column 2 = total; columns 3–5 sum to it.

| Category | Total | IPEDS / Scorecard / CDS | What's in it |
|---|---|---|---|
| admissions | 185 | 54 / 30 / 101 | Test ranges, admit/yield, requirements, **CDS: C7 factor weights, test policy, GPA dist, HS rank, ED/EA dates, waitlist** |
| aid | 150 | 55 / 54 / 41 | Net price by income band, grants/loans, debt, repayment, **CDS: % need met, CSS Profile flag** |
| outcomes | 120 | 64 / 56 / 0 | Grad/completion/retention/default rates |
| programs | 107 | 23 / 63 / 21 | CIP degree-offered flags, degree counts |
| cost | 92 | 49 / 31 / 12 | Tuition/fees/room&board, net price |
| institution | 77 | 47 / 30 / 0 | Identity, Carnegie, HBCU/HSI, locale, URLs, endowment |
| academics | 75 | 39 / 10 / 26 | Student-faculty ratio, expenditures, services, **CDS: class-size dist, grad requirements** |
| enrollment | 73 | 37 / 6 / 30 | Headcounts, FTE, FT/PT |
| demographics | 68 | 39 / 29 / 0 | Race/ethnicity, sex, age |
| earnings | 53 | 0 / 53 / 0 | **Scorecard only.** Post-entry/post-completion earnings (lagged — see [§9](#9-data-recency--provenance--how-to-date-any-value)) |
| retention | 24 | 4 / 20 / 0 | Retention & multi-year persistence |
| student_life | 20 | 0 / 0 / 20 | **CDS only.** On-campus living, Greek life, housing |
| faculty | 15 | 0 / 0 / 15 | **CDS only.** Class sizes, terminal-degree %, ratio |
| transfer | 13 | 0 / 0 / 13 | **CDS only.** Transfer admission detail |
| students | 10 | 0 / 10 / 0 | Scorecard family-income/first-gen/veteran |
| completers | 6 | 6 / 0 / 0 | IPEDS bachelor's completers by race/sex |
| general | 5 | 0 / 0 / 5 | CDS Section A (control, calendar, DEI URL) |

**Coverage / fill rate** (fraction of 2,746 schools with a value) — the agent must know reliability:

| Tier | Fill | Examples |
|---|---|---|
| Near-universal | 97–100% | All Scorecard fields (~98%, 2,690 schools); IPEDS institution/academics/enrollment/demographics/programs |
| High | 77–89% | IPEDS grant amount/percent fields (`aid.avg_grant_*`, `aid.pct_receiving_any_grant`) |
| Moderate | 62–65% | **IPEDS selectivity** (admit rate, test percentiles, applicant counts) — ~37% of schools are open-access and don't report. **Use Scorecard equivalents (98%) for broad comparisons.** |
| Low | 27–53% | **IPEDS net price by income band** (`aid.avg_net_price_*`) — only Title-IV grant recipients, and split by sector. Don't assume net-price data is broadly present. |
| Sparse (today) | 0.3% | **All 284 CDS fields** — only 8 schools processed. Always have an IPEDS/Scorecard fallback. |

**`cycle_year` reality:** IPEDS = 2024 (**386 fields**); 31 IPEDS aid/finance fields = 2023; all 392 Scorecard fields = NULL year; all 284 CDS fields = 2024. **No field currently has two years of data**, so true time-series isn't available yet (the schema supports it; the data doesn't have it).

**Carnegie classifications:** both the 2021 basic (`institution.carnegie_2021_basic`, raw `C21BASIC`) and the **new-this-vintage 2025 set** (`institution.carnegie_2025_*` from `CARNEGIEIC`/`CARNEGIESAEC`/`CARNEGIERSCH`/`CARNEGIESIZE`/`CARNEGIEAPM`) coexist and serve different analytic purposes. The 2025 fields are coded (decode via valuesets) and some are sparse (`CARNEGIESAEC` has many NULLs; `CARNEGIEIC` is well-populated). Use 2025 for "is this a research university today?".

**The `GET /schools/{unitid}/fields` endpoint returns only the latest year per field** (`DISTINCT ON (key) ORDER BY cycle_year DESC`), grouped by source (cds, ipeds, scorecard).

---

## 6. Value semantics & reading rules (anti-misread)

> This section exists to stop the agent from lying to a student. Every rule below is empirically verified against the live DB.

### How each `data_type` is stored in the `value` jsonb

| data_type | Stored as | Example | Display rule |
|---|---|---|---|
| `percent` | **0-to-1 fraction**, JSON number (all 3 sources; max value = 1.0) | `0.0361` | **×100 → "3.6%"**. Never show the raw fraction. |
| `currency` | US **dollars** (not cents), JSON number; averages/medians carry fractional cents; **net-price fields can be negative** (grants > cost) and that's valid | `59885.0`, `17146.5`, `-2536.0` | Round to whole dollars; keep the sign. |
| `int` | JSON number with trailing zeros (`6370.0000…`) — jsonb has no integer type | `34.0` | Parse `round(value::numeric)::int`; **may be a coded enum — see R1.** |
| `number` | Decimal JSON number (FTE, GPA, ACT-from-CDS) | `318.67`, `3.85` | Context-appropriate decimals. |
| `bool` | Native JSON `true`/`false` (never "1"/"0"/"Yes") | `true` | "Yes"/"No". |
| `text` | JSON string; may be an enum string, a URL, or a surviving sentinel | `"Private (nonprofit)"` | See R4/R8. |

### The reading rules (R1–R12) — the agent's checklist

- **R1 — Decode coded `int` fields, but only the ones that are actually coded.** Some `int` fields hold raw IPEDS codes meaningless to a student (**never show `control: 2`**); others are plain counts/scores (SAT/ACT percentiles, applicant counts, enrollment, student-faculty ratio) that must **not** be "decoded". **The safe, programmatic rule:** for any `data_type='int'` IPEDS field, look up its `raw_table`/`raw_column` (from `fields`) and call the enum endpoint / query `raw.ipeds_valuesets24`; **if a decode exists, always apply it; if not, display the integer as-is.** Cache the result (codes are static). Confirmed coded columns include all `ADMCON1..12` (admission factors), `CONTROL`, `LOCALE`, `SECTOR`, `INSTCAT`, `ICLEVEL`, `HLOFFER`, `OPENADMP`, `CALSYS`, `ATHASSOC`, `DISTCRS`/`DISTPGS`/`DISTNCED`, `F1SYSTYP`, `HBCU`, and all `CARNEGIE*`/`CC*`. Common decodes: `ADMCON7` 1=Required/3=Test-Blind/5=Test-Optional (also `-1`/`-2` exist in the codebook but are suppressed to NULL in `field_values`); `CONTROL` 1=Public/2=Private-NP/3=Private-FP; `CALSYS` 1=Semester/2=Quarter/3=Trimester; `LOCALE` 11–43 city/suburb/town/rural; `HBCU` 1=Yes/2=No. **Decode endpoint is IPEDS-only** — for Scorecard coded columns use hardcoded maps (see [§14](#14-how-to-recipes-for-the-agent)).
- **R2 — Multiply `percent` by 100.** `0.042` = 4.2%.
- **R3 — NULL and missing row both mean "not available."** Don't distinguish to the student; never invent.
- **R4 — Detect text-field sentinels & range tokens:**
  - `institution.system_name = "-2"` (1,884 schools) → "not part of a system", don't print "-2".
  - The balance-based repayment/default fields `outcomes.bbrr2_pell_default` / `bbrr2_nopell_default` (and any `BBRR*`-sourced field) hold a **mix**: most rows are **exact decimal strings** (`"0.03"`), but some are **privacy-range tokens** (`"<=0.05"`, `"0.05-0.09"`, `"0.10-0.14"`). Detect a token by the presence of `<` or `-`; present tokens as approximate ranges with **no arithmetic**; treat plain decimals as numeric percents. (The aggregate `outcomes.bbrr2_ug_default` is a clean numeric percent.)
- **R5 — Round currency.** Don't show `$10,653.4832`. Keep negative signs (valid for net price).
- **R6 — Strip `int` trailing zeros.** `6370.0000000000000000` is 6,370.
- **R7 — CDS enum strings need light formatting.** `cds.c8a_test_policy ∈ {"required","considered_if_submitted","not_considered",…}` — no *decode* needed, but title-case for display ("Considered if submitted"). (IPEDS/Scorecard ADMCON7 codes still need R1.)
- **R8 — Fix URLs.** ~58% of `institution.website` values lack a scheme (stored `www.…`); the rest are already `https://`. **Prepend `https://` when no scheme is present** (never `http://`).
- **R9 — Source preference per concept** (see table below).
- **R10 — Annotate vintage** ([§9](#9-data-recency--provenance--how-to-date-any-value)). Scorecard fields have no cycle_year and earnings lag years.
- **R11 — FTE ≠ headcount.** For "how many students attend", use headcount; pick `enrollment.undergrad_total` for undergrad and `enrollment.total_headcount` for total-institution size. Never use `enrollment.fte` or `*_per_fte` fields for a student count.
- **R12 — `schools.control` is decoded text; `institution.control` field_value is a raw code.** Prefer the `schools` table's decoded value when you just need public/private.

### The string-vs-number gotcha

After projection, all numeric fields are stored as JSON **number** (verified: zero string-typed values in percent/currency/int/number). But over **psycopg2** the jsonb arrives as a string needing `json.loads`; over **asyncpg** it's already native. Normalize in the DB layer. IPEDS percents were `divisor:100`-converted from 0–100 integers; Scorecard percents are native fractions — **both end up 0–1**, so the agent never handles the raw difference, only the tiny precision gap (IPEDS rounds to whole percent, e.g. admit rate 0.58 vs Scorecard 0.5795).

### Source preference for overlapping concepts

| Concept | Preferred field | Fallback | Why |
|---|---|---|---|
| Acceptance rate | `admissions.acceptance_rate` (scorecard, higher precision, 62.2%) | `admissions.admit_rate_total` (ipeds, 62.4%) | Near-equal fill; Scorecard more precise. ~38% of schools have neither (open-access). |
| Undergrad enrollment (headcount) | `enrollment.undergrad_total` (ipeds, 98%) | `enrollment.total_undergrad` (scorecard, 89%, degree-seeking only) | IPEDS is inclusive headcount. Use `total_headcount` only when the question is about *total* (incl. grad) institution size, not undergrad. |
| Median earnings | `earnings.median_4yr_postcompletion` (institution-specific, 86%) | `earnings.median_10yr`/`_6yr` | **Avoid `*_all_institutions` — it's a national benchmark, not the school's own value**, despite 98% fill. |
| Test policy | `cds.c8a_test_policy` (display-ready, when present) | decode IPEDS `admissions.req_test_scores` (ADMCON7) | CDS richer; IPEDS broader coverage. |
| HBCU status | `institution.hbcu` (scorecard, native bool) | decode IPEDS `institution.is_hbcu` (1=Yes/2=No) | Prefer the Scorecard bool — no decode needed. `is_hbcu` is a raw code. |

---

## 7. The curated dossier field shortlist

For the MVP1 "deep school dossier" wedge: ~90 high-value fields grouped into student-meaningful sections. CDS fields are listed where they add unique value but are **sparse today** (fall back to IPEDS/Scorecard). Field keys are written in full so they can be pasted into a query.

**A. Admissions & Selectivity** — `admissions.acceptance_rate` (sc), `admissions.admit_rate_total` (ipeds), `admissions.sat_average`, `admissions.sat_ebrw_25`, `admissions.sat_ebrw_75`, `admissions.sat_math_25`, `admissions.sat_math_75`, `admissions.act_composite_25`, `admissions.act_composite_75`, `admissions.yield_rate_total`, `admissions.open_admissions`, `admissions.req_test_scores` (decode), `cds.c8a_test_policy`, `cds.c11_pct_gpa_4_0`, `cds.c12_avg_hs_gpa`, `cds.c10_pct_top_tenth`, `cds.c7_academic_gpa`/`c7_standardized_test_scores`/`c7_application_essay`/`c7_extracurricular_activities`/`c7_recommendations` (factor weights), `cds.early_decision_offered`/`ed1_closing_date`/`ed1_notification_date`, `cds.early_action_offered`/`ea_is_restrictive`, `cds.application_deadline_fall`, `cds.waitlist_offered`/`waitlist_admitted`, `cds.c9_sat_composite_25th`/`c9_sat_composite_75th` (SAT *composite* range — which IPEDS lacks — but extra-sparse: only ~4 schools today, so lean on the IPEDS SAT-section percentiles above for breadth). *(The only truly-empty CDS fields are `cds.d6_min_hs_gpa_transfer`, `cds.d7_min_college_gpa_transfer`, `cds.tuition_instate`, `cds.tuition_outofstate` — 0 rows.)*

**B. Cost & Aid** — `cost.tuition_in_state`, `cost.tuition_out_of_state`, `cost.room_and_board`, `cost.books_supplies`, `aid.avg_net_price_title4`, `aid.avg_net_price_0_30k`, `aid.avg_net_price_30_48k`, `aid.avg_net_price_48_75k`, `aid.avg_net_price_75_110k`, `aid.avg_net_price_over_110k`, `aid.pct_ftft_pell`, `aid.pct_receiving_any_aid`, `aid.median_debt_completers`, `aid.cumulative_debt_p25`, `aid.cumulative_debt_p75`, `aid.repayment_rate_3yr_completers`, `cds.pct_need_met_freshmen`, `cds.avg_financial_aid_package_freshmen`, `cds.required_aid_forms_domestic` (CSS Profile/FAFSA). **See the COA-composition caveat in [§13](#13-known-gotchas--doc-discrepancies) — `cost.room_and_board` is null for many schools after the 2024-25 restructure; have a fallback.**

**C. Outcomes & Earnings** — `retention.rate_full_time`, `retention.ft_4yr`, `outcomes.grad_rate_6yr_bach`, `outcomes.completion_150_4yr`, `cds.grad_rate_6yr_total`, `cds.first_to_second_year_retention_rate`, `earnings.median_4yr_postcompletion`, `earnings.median_6yr`, `earnings.median_10yr`, `earnings.median_10yr_income_low`, `earnings.pct_above_hs_threshold_6yr`, `outcomes.cohort_default_rate_3yr`.

**D. Academics & Majors** — `academics.student_faculty_ratio`, `academics.instruction_expenditure_per_fte_gasb`, `academics.avg_faculty_salary_9mo`, `academics.pct_full_time_faculty`, `academics.ap_credits_accepted`, `academics.study_abroad`, `academics.undergraduate_research`, `academics.calendar_system` (decode), `cds.special_study_honors_program`, `cds.pct_class_sections_under_20`, `programs.offers_cs_bachelors`, `programs.offers_engineering_bachelors`. **Plus programs/earnings-by-major via `/programs`** ([§8](#8-raw-sources-multi-row-data--enum-decoding)).

**E. Student Body & Diversity** — `demographics.pct_white_total`, `demographics.pct_black_total`, `demographics.pct_hispanic_total`, `demographics.pct_asian_total`, `demographics.pct_women_total`, `students.share_first_gen`, `students.pct_ever_pell`, `institution.hbcu` (sc bool; prefer over `institution.is_hbcu`), `institution.hispanic_serving`. **Plus full breakdown via `/diversity`.**

**F. Institution basics** — `schools.city`, `schools.state`, `schools.control`, `institution.carnegie_2021_basic` (decode) and/or `institution.carnegie_2025_*`, `enrollment.total_headcount` (total institution, incl. grad), `enrollment.undergrad_total`, `institution.endowment_per_fte_gasb`, `institution.admissions_url`.

---

## 8. Raw sources, multi-row data & enum decoding

### The 57 `raw.*` tables

52 IPEDS data tables (loaded from a 590 MB `IPEDS202425.accdb`), 2 IPEDS dictionary tables (`valuesets24`, `vartable24`), 2 Scorecard tables (`scorecard_institution`, `scorecard_fos`), and `raw.files`. Every table has internal `_file_id` (→ `raw.files`) and a derived `unitid` (indexed); **all data columns are `text`** (typing happens at projection). Useful single-row "DRV*" tables (`drvadm2024`, `drvef2024`, `drvgr2024`, …) are IPEDS's own pre-computed per-school summaries.

**2024-25 structural change (important for citations & cost fields):** this vintage moved tuition/fees out of `IC` into **`raw.ipeds_cost1_2024`**, and net price/aid out of `SFA` into **`raw.ipeds_cost2_2024_netprice`** / **`raw.ipeds_cost2_2024_financialaid`**. So a single `cycle_year=2024` IPEDS value can come from ADM (admissions), COST1 (tuition), COST2 (net price), SFA2324 (aid, year 2023), HD (identity), etc. When citing the exact raw source of a cost number, check the field's `raw_table`.

**Uncurated single-row tables** (pickable but no projected fields yet — future field sources): `raw.ipeds_al2024`/`drval2024` (libraries), `raw.ipeds_effy2024_hs` (HS dual-enrollment), `raw.ipeds_f2324_f1a`/`f2`/`f3` (finance by GASB/FASB/for-profit — endowment, revenue, expenses), `raw.ipeds_gr2024_l2` (<2-year grad rates), `raw.ipeds_sal2024_nis` (non-instructional salaries). Cross-school finance comparison needs the accounting-standard flag from `raw.ipeds_flags2024`.

### Multi-row data — NOT in `field_values`, read via dedicated paths

**Programs / Field-of-Study** — `raw.scorecard_fos` (227,980 rows; 1 row per `unitid × CIP × credential level`; 178 columns). Earnings & debt **by major**.
- Endpoint `GET /schools/{unitid}/programs` exposes per program: `{cipcode, cipdesc, credlev, creddesc, completions, debt_median, debt_monthly_payment, earnings_1yr, earnings_4yr, earnings_5yr}`. Suppressed cells (`PS`/`NA`/n<30) → `null`. No pagination, no CIP filter — filter client-side.
- **Full CREDLEV decode:** 1=UG cert, 2=Associate, **3=Bachelor's**, 4=Post-bacc cert, 5=Master's, 6=Doctoral, 7=First-professional, 8=Grad cert, 99=Non-credential (prep/teacher-cert). Filter to `credlev=3` for bachelor's-level earnings.
- **Not exposed by the endpoint** (query `raw.scorecard_fos` directly if needed): debt by gender (`DEBT_MALE_*`/`DEBT_NOTMALE_*`) and Pell status (`DEBT_PELL_*`/`DEBT_NOPELL_*`), balance-based repayment rates (`BBRR1_*` — which also use range tokens, R4), and post-entry (vs post-completion) earnings windows.

**Diversity** — `raw.ipeds_ef2024a` (113,833 rows). The endpoint pins `EFALEVEL='2'` (undergrad total).
- Endpoint `GET /schools/{unitid}/diversity` → `{total, men, women, by_race:[{race_label, total, men, women}]}` across 9 race/ethnicity groups (incl. "Two or more", "Unknown", "U.S. Nonresident"). Hard-pinned to the 2024 vintage; negative sentinels → `null`.

20 other multi-row IPEDS tables (completions detail, HR/staff, full graduation-rate detail, age/residence enrollment) are catalogued but have **no read endpoint** — reachable only by direct SQL.

### Enum decoding (so the agent never shows raw codes)

- **`raw.ipeds_valuesets24`** (12,143 rows, 328 coded variables): `VarName, TableName, Codevalue, ValueLabel, ValueOrder`. The decode table.
- **`raw.ipeds_vartable24`** (2,599 rows): variable definitions. **`LongDescription` holds the exact IPEDS survey-question text** — the authoritative definition to use when *explaining a field to a student* (query on `VarName = raw_column`; it can have duplicate rows, use `LIMIT 1`). `MultiRecord='1'` marks multi-row tables (blank otherwise; use `source_columns.is_pickable` as the reliable signal).
- **Endpoint:** `GET /sources/columns/enum?raw_table=raw.ipeds_adm2024&column=ADMCON7` → `[{code, label}, …]`. **IPEDS-only.** Casing handled via `lower()`. Note the decode table name differs from the field's display table (e.g. `CALSYS` lives in `raw.ipeds_ic2024`, not `hd2024`).
- **Scorecard has no decode endpoint.** Use hardcoded maps for common coded columns: `PREDDEG`/`HIGHDEG` 0=Non-degree/1=Cert/2=Associate/3=Bachelor/4=Graduate; `CONTROL` 1=Public/2=Private-NP/3=Private-FP; `MAIN` 0=branch/1=main.

---

## 9. Data recency & provenance — how to date any value

> MVP1 requires the agent to know the date of every value (CDS / IPEDS / Scorecard) so it knows what it doesn't know and when to go to the web. This is how.

### Universal provenance query

```sql
SELECT fv.source, fv.cycle_year,
       rf.filename       AS file_name,
       rf.downloaded_at  AS db_loaded_at,
       cf.source_url     AS cds_pdf_url,
       cf.created_at     AS cds_pdf_fetched_at
FROM field_values fv
JOIN raw.files rf ON rf.id = fv.raw_file_id
LEFT JOIN cds_files cf
       ON cf.unitid = fv.unitid AND cf.cycle_year = fv.cycle_year AND fv.source = 'cds'
WHERE fv.unitid = $1 AND fv.field_key = $2;
-- A field key may exist in more than one source (e.g. acceptance rate in ipeds AND scorecard);
-- this can return one row per source. Add `AND fv.source = $3` to pin one.
```

### Interpretation cheat-sheet

| source | cycle_year | Real-world vintage | File signal | What the agent should say |
|---|---|---|---|---|
| `ipeds` | `2024` | Fall 2024, **provisional** (enrollment, scores, costs, admissions) | `IPEDS202425.accdb`, loaded 2026-06-05 | "IPEDS 2024-25 (provisional)" |
| `ipeds` | `2023` | 2023-24 financial aid (SFA/F tables) | same `.accdb` | "IPEDS 2023-24 financial-aid data" |
| `scorecard` | NULL | Most-recent cohort as of the **publication date in the filename** | `College_Scorecard_Raw_Data_03232026.zip` → **March 23, 2026** | "College Scorecard, published Mar 2026" + earnings-lag caveat |
| `cds` | `2024` | 2024-25 CDS (describes the fall-2024 entering class) | PDF in `cds_files` | "2024-25 Common Data Set filed by the school" |

### Provisional vs. Final (IPEDS)

IPEDS publishes each cycle twice: **Provisional** (full data, may be revised) then **Final** (~2 years later, with corrections via the Prior Year Revision System). The current DB holds **Provisional** 2024-25 data — so enrollment, test scores, and admit rates may still be revised. Say "provisional" when citing `cycle_year=2024` IPEDS values.

### The earnings-lag caveat (critical for honesty)

Scorecard earnings reflect students who entered **years ago**. Entry cohort ≈ `publication_year − N` for a `_Nyr` field. For the March-2026 file: `_4yr` → ~2022 entrants, `_6yr` → ~2020, `_10yr` → ~2016, `_11yr` → ~2015. Disclose: *"This earnings figure reflects students who entered around [year], not current students."*

### `settings.current_cycle_year = 2024`

The canonical "current year" signal and the default target year for new CDS jobs. It does **not** affect IPEDS/Scorecard vintages (those are fixed by the files on disk).

---

## 10. Query surface: API endpoints & direct SQL

### Read endpoints (the agent's ready-made paths)

| Endpoint | Returns | Notes |
|---|---|---|
| `GET /health` | `{status, db, version}` | Fast DB probe. |
| `GET /schools?q=&tracked=&limit=&offset=` | paged list `{items[], total}` | `q` = `ILIKE %q%` on name **or** exact unitid. limit default 25, **max 200**. Includes coverage. |
| `GET /schools/search?q=&limit=` | `{items:[{unitid,name}]}` | **Faster typeahead; not in api.md but live.** Best for name→unitid. limit default 50, max 200. |
| `GET /schools/{unitid}` | `SchoolDetail` (+`city`,`level`,`last_updated`) | Only endpoint with `city`/`level`. 404 on unknown. |
| `GET /schools/{unitid}/fields` | `{groups:[{source, fields:[{key,label,category,data_type,value,cycle_year,updated_at}]}]}` | **Dossier backbone.** Latest year per field. **Returns all 284 CDS fields even when null** (placeholders from the catalog — don't read null CDS as "school lacks X"; confirm via [§14](#14-how-to-recipes-for-the-agent)). |
| `GET /schools/{unitid}/programs` | earnings/debt by major | See [§8](#8-raw-sources-multi-row-data--enum-decoding). |
| `GET /schools/{unitid}/diversity` | race/sex enrollment | See [§8](#8-raw-sources-multi-row-data--enum-decoding). |
| `GET /fields` | full catalog (all 1,093) | The agent's map of what exists + how to interpret keys. |
| `GET /sources` | per-source file registry + `last_sync` | Freshness check. |
| `GET /sources/columns?q=&source=&pickable=&limit=&offset=` | raw-column catalog | limit max 500. |
| `GET /sources/columns/enum?raw_table=&column=` | IPEDS code→label | Decode coded fields. |

Values cross the wire already jsonb-decoded (percent = fraction, currency = dollars, int = float). Most per-school endpoints are **not paginated** (everything for one school in one call).

### What the API does NOT do yet (the agent must use direct SQL, or we build it)

These are real gaps the agent will hit constantly for MVP1's "think and compare" job:

- **No cross-school filter/rank** ("schools with admit rate < 15% ordered by SAT_75"). → direct SQL.
- **No multi-school batch fetch** (comparison = N calls). → direct SQL `WHERE unitid = ANY($1)`.
- **No value-based school filtering** ("public 4-year in CA with a quarter system"). → direct SQL.
- **No aggregates / percentiles** ("how does X compare to the national median?"). → direct SQL.
- **No per-school CDS status endpoint** (only via `GET /schools?tracked=true` `cds_years`). → SQL recipe in [§14](#14-how-to-recipes-for-the-agent).
- **No history** (single vintage per source).

**Implication for the agent build:** give the agent **direct, read-only SQL** over `public.*` (plus the two multi-row raw tables), because ranking, filtering, comparison, and aggregation — the core of "think and answer" — are not in the API. See the recipes in [§14](#14-how-to-recipes-for-the-agent).

---

## 11. School identity & name resolution

- A school is one IPEDS `unitid`. **Multi-campus systems are separate unitids** with separate data: "Ohio State" returns 5 rows (Main Campus, 204796, is what students mean); "University of Michigan" → Ann Arbor (193900) + Dearborn + Flint. Group campuses by `raw.ipeds_hd2024.F1SYSNAM`/`F1SYSCOD` (the `institution.system_name` field; `"-2"` = not in a system) — these aren't in `field_values`, query `hd2024` directly.
- Name search is **substring `ILIKE`, not ranked similarity** (the trigram index only accelerates it). Results are alphabetical, not relevance-ranked. `stanf` matches via `%stanf%`.
- **Abbreviations don't match**: "MIT" ≠ "Massachusetts Institute of Technology", "Caltech" ≠ "California Institute of Technology", "NYU" ≠ "New York University". Expand common abbreviations before searching.
- Some rows are administrative units (e.g. "University of California-System Administration Central Office") or specialized schools (separate law/optometry units) — low/no student-facing data.
- **Geographic filtering options:** `schools.state` (indexed), `schools.city` (use `ILIKE`), plus IPEDS `LOCALE`/`CBSATYPE` (metro type, coded) and `LATITUDE`/`LONGITUD` (text in `hd2024`, cast to numeric for distance) for "schools near X" queries.

**Recommended resolution flow:** `GET /schools/search?q=` → 1 hit ⇒ use it → multiple (multi-campus) ⇒ prefer the name without a city/campus suffix or the highest-coverage row, else ask → 0 ⇒ expand abbreviations and retry → else ask the user to confirm.

---

## 12. The CDS pipeline & current coverage

**What CDS is:** the Common Data Set — a standardized form schools publish annually. It's the richest admissions-process source (factor weights, test policy, GPA distribution, ED/EA dates, waitlist, class sizes, % need met). 284 fields, all `source='cds'`, filled by an LLM reading the school's CDS PDF.

**Current coverage (sparse):** 9 PDFs downloaded; **8 schools have extracted field data** (per-school field counts): **U Penn 249, Yale 243, Harvard 241, Pitzer 241, Princeton 240, Northwestern 236, U Chicago 230, Duke 218** (all cycle_year 2024). **Stanford** has a downloaded PDF and `extract_status='done'` but **0 extracted values** (root cause not recorded in the DB — likely processed before the CDS fields were seeded; re-extractable). The agent must treat CDS as opportunistic and fall back to IPEDS/Scorecard.

> **Two CDS traps:** (1) `extract_status='done'` does **not** guarantee values exist (Stanford). (2) `GET /schools/{unitid}/fields` returns all 284 CDS fields as `null` for the 2,738 uncovered schools — these are catalog placeholders, not stored values. **Always confirm CDS coverage with a `field_values` count** ([§14](#14-how-to-recipes-for-the-agent)).

**Lifecycle (admin-initiated only, pipeline ADR 0004):** a job is created (`POST /cds/jobs` or the CLI) → worker claims it (`FOR UPDATE SKIP LOCKED`) → **scout** resolves the PDF URL (Tier 1 exact index match → Tier 2 LLM name-match with a strict single-candidate guard → Tier 3 browser scout) → **download** (httpx, format-sniff, store bytes in `cds_files.content`) → **extract** (Gemini 2.5 Pro reads the PDF, writes `field_values`).

**Tables & live counts:** `cds_jobs` (18: 9 download-done, 7 cancelled, 2 failed — the failures are MIT, no URL found, and Pitzer's first attempt), `cds_files` (9 PDFs in-DB; resolve via `unitid`+`cycle_year`, not filename — the earliest, Stanford's, is named differently), `cds_job_steps` (155, curated ≤~15/stage), `cds_index_entries` (~1,983 College-Transitions links, years 2017–2024), `cds_index_meta` (1, status `ok`).

**From a CDS value to its PDF:** `field_values.raw_file_id` → `cds_files` (match `unitid`+`cycle_year`) → bytes in `content`, served by `GET /cds/files/{id}/raw`. `download_status='done'` guarantees a linked PDF (CHECK `cds_jobs_done_requires_file`).

**Config (`settings cds.*`):** extract model `vertex:gemini-2.5-pro`, scout model `vertex:gemini-2.5-flash`, `max_steps=35`, `wall_clock_s=180`, `size_cap_bytes=50MB`, index TTL 24h. (`cds.auto_extract`, `cds.max_retries`, `cds.max_spend_usd` are seeded but not yet read.)

---

## 13. Known gotchas & doc discrepancies

1. **`field_values.value` NULL ≠ no data attempted** (R3/§4). The single most important thing to get right.
2. **CDS fields are 0.3% filled** — only 8 schools. Always fall back. `extract_status='done'` ≠ data exists.
3. **`percent` is a fraction (0.0361 = 3.6%)** — the agent must ×100.
4. **Some `int` fields are raw codes** (`control: 2`, `calendar_system: 2`, `is_hbcu: 1`) — decode (R1); others are plain counts — don't.
5. **Surviving text sentinels/ranges** — `institution.system_name="-2"`; BBRR fields mix exact decimals and range tokens (R4).
6. **`*_all_institutions` earnings & `cost.median_net_price_all_institutions` are national benchmarks**, not the school's own value — high fill but misleading if shown as the school's number.
7. **COA composition trap:** after the 2024-25 COST1/COST2 restructure, `cost.room_and_board` is **null for many schools** while the value moved to a sibling field (e.g. `cost.on_campus_room_board_other`). There are also multiple "total cost" concepts (in-district vs in-state vs out-of-state; Scorecard `COSTT4_A` academic-year vs `COSTT4_P` program-year — a school has one, never both). Don't present null room-and-board as missing without checking the sibling field.
8. **Negative currency is valid** — net-price fields can be negative when grants exceed cost (68 rows). Don't clip.
9. **IPEDS imputation:** IPEDS estimates missing values for non-reporting schools. There is **no `is_imputed` flag** on `field_values` rows; if the agent needs a data-quality signal (e.g. for chancing), join `raw.ipeds_flags2024` (`IMP_ADM`, `IMP_EF`, … and parent-child `PRCH_*` indicators) via direct SQL.
10. **Generated `db-schema.md` drift:** lists `field_values.source` CHECK as `fsa` (it's `cds`); references `cds_files.on_disk_path` (dropped in migration 0009). Trust the live DB.
11. **`GET /schools/search` is missing from `api.md`** but is live and is the best name→unitid path.
12. **`schools` ≠ full universe** — 2,746 curated vs 6,072 in `raw.ipeds_hd2024`; all are 4-year.
13. **Not yet loaded (future):** the Scorecard zip also contains 29-year MERGED panel CSVs and OPEID→UNITID crosswalks — useful later for time-series and FSA joins, but absent from the DB today.
14. **Stats caveat:** `pg_stat_user_tables.n_live_tup` reads 0 (no ANALYZE since load); use `COUNT(*)` for exact counts.

---

## 14. How-to recipes for the agent

> Copy-paste-ready patterns for the operations the agent runs most. All parameterized (asyncpg `$n`). `percent` filters use the 0-to-1 scale (`< 0.30`, not `< 30`). For Scorecard fields add `AND cycle_year IS NULL`.

### 14.1 Assemble a full dossier for one school

1. `GET /schools/{unitid}` → identity (name, city, state, control, level).
2. `GET /schools/{unitid}/fields` → all latest-year values, grouped by source (one call; CDS placeholders come back null).
3. `GET /schools/{unitid}/programs` → filter to `credlev=3` for bachelor's earnings/debt by major.
4. `GET /schools/{unitid}/diversity` → race/sex breakdown.
5. For each coded `int` field, decode via `GET /sources/columns/enum?raw_table=&column=` (use the field's `raw_table`/`raw_column`).
6. Apply reading rules **R1–R12** ([§6](#6-value-semantics--reading-rules-anti-misread)) before presenting any value.
7. For citations, attach vintage via the provenance query ([§9](#9-data-recency--provenance--how-to-date-any-value)).

Direct-SQL alternative for a targeted set of fields:
```sql
SELECT f.key, f.label, f.data_type, f.source, fv.value, fv.cycle_year
FROM field_values fv
JOIN fields f ON f.key = fv.field_key
WHERE fv.unitid = $1
  AND f.key = ANY($2::text[])     -- list of field keys; asyncpg: pass a Python list
  AND fv.value IS NOT NULL
ORDER BY f.sort_order;
```

### 14.2 Compare N schools on one field
```sql
SELECT s.name, fv.value, fv.cycle_year
FROM field_values fv
JOIN schools s ON s.unitid = fv.unitid
WHERE fv.unitid = ANY($1::int[])   -- array of unitids
  AND fv.field_key = $2
  AND fv.value IS NOT NULL
ORDER BY s.name;
```

### 14.3 Find schools matching criteria ("thinking partner" filter)
```sql
SELECT s.unitid, s.name, s.city, s.state,
       ar.value AS admit_rate, sat.value AS sat_average
FROM schools s
JOIN field_values ar  ON ar.unitid  = s.unitid AND ar.field_key  = 'admissions.acceptance_rate'
JOIN field_values sat ON sat.unitid = s.unitid AND sat.field_key = 'admissions.sat_average'
WHERE s.state = $1 AND s.control = $2
  AND (ar.value::numeric)  < $3      -- e.g. 0.30  (fraction, not 30)
  AND (sat.value::numeric) > $4
  AND ar.value IS NOT NULL AND sat.value IS NOT NULL
ORDER BY ar.value::numeric
LIMIT 20;
```

### 14.4 National benchmark / percentile for "how does X compare?"
```sql
SELECT
  percentile_cont(0.5) WITHIN GROUP (ORDER BY (value::numeric)) AS median,
  avg(value::numeric)                                          AS mean
FROM field_values
WHERE field_key = $1 AND value IS NOT NULL;
```

### 14.5 Decode a coded value
1. From `fields`, read the field's `raw_table` + `raw_column`.
2. IPEDS: `GET /sources/columns/enum?raw_table={raw_table}&column={raw_column}` → `[{code,label}]`; map the stored integer; cache (codes are static).
3. Scorecard: no endpoint — use the hardcoded maps in [§8](#8-raw-sources-multi-row-data--enum-decoding).

### 14.6 Check CDS coverage for a school (don't trust `extract_status`)
```sql
SELECT j.cycle_year, j.download_status, j.extract_status,
       count(fv.field_key) FILTER (WHERE fv.value IS NOT NULL) AS extracted_fields
FROM cds_jobs j
LEFT JOIN field_values fv
       ON fv.unitid = j.unitid AND fv.source = 'cds' AND fv.cycle_year = j.cycle_year
WHERE j.unitid = $1
GROUP BY j.cycle_year, j.download_status, j.extract_status;
-- extracted_fields = 0 means "no CDS content available" regardless of status.
```

### 14.7 Date a value for a citation
Use the universal provenance query in [§9](#9-data-recency--provenance--how-to-date-any-value), pinning `fv.source` when a key spans sources.

---

## 15. Appendix: live snapshot & full table inventory

**Snapshot date:** 2026-06-09. **Counts:** schools 2,746 · fields 1,093 (ipeds 417 / scorecard 392 / cds 284) · field_values 2,087,998 · source_columns 6,087 (5,398 pickable) · raw tables 57.

**`public` app tables:** `schools` (2,746), `fields` (1,093), `field_values` (2,087,998), `source_columns` (6,087), `settings` (16), `cds_files` (9), `cds_jobs` (18), `cds_job_steps` (155), `cds_index_entries` (~1,983), `cds_index_meta` (1). Plus yoyo infra tables (`_yoyo_*`, `yoyo_lock`) — never query in app logic.

**`raw` tables (57):** `raw.files` (12), `raw.scorecard_institution` (6,322; all 3,307 Scorecard columns in a `data jsonb`), `raw.scorecard_fos` (227,980), `raw.ipeds_valuesets24` (12,143), `raw.ipeds_vartable24` (2,599), `raw.ipeds_hd2024` (6,072; the master directory), `raw.ipeds_adm2024` (1,956; admissions/test scores), `raw.ipeds_ef2024a` (113,833; diversity source), `raw.ipeds_cost1_2024` / `cost2_2024_netprice` / `cost2_2024_financialaid` (the 2024-25 cost restructure), `raw.ipeds_flags2024` (imputation/response flags), and ~40 more IPEDS survey/derived tables (aid SFA, enrollment EF/EFFY, graduation GR, finance F, HR S/SAL, completions C, outcomes OM, libraries AL). 22 IPEDS/Scorecard tables are multi-row (`is_pickable=false`) and never projected.

**`raw.files` (the provenance registry, 12 rows):** IPEDS `.accdb` (loaded 2026-06-05), Scorecard zip `College_Scorecard_Raw_Data_03232026.zip` + the `Most-Recent-Cohorts-Field-of-Study.csv` (loaded 2026-06-05), and 9 CDS PDFs (loaded 2026-06-05 → 2026-06-09).

**Migrations 0001–0009:** init → coverage cols → drop FSA/rebuild (source enum `ipeds,scorecard`) → add CDS (source enum `ipeds,scorecard,cds`; CDS fields nullable raw_table; extraction_hint; cds_* tables) → orphan-done CHECK → CDS index → raw unitid indexes → cds_files FK CASCADE → **CDS PDF bytes in DB** (`content bytea`, dropped `on_disk_path`).

---

*This guide reflects the live DB on 2026-06-09. When the pipeline re-ingests (new IPEDS/Scorecard vintage, more CDS schools), re-verify counts, fill rates, and vintages against the live DB.*
