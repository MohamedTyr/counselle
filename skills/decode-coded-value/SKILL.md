---
name: decode-coded-value
description: How to handle coded integer fields so students never see raw IPEDS codes. Covers the R1 rule, which columns need decoding, the get_values decode path, and when to use query_database with counselle.decode_ipeds. Never show a raw code like "control: 2" or "ADMCON7: 3".
---

# Decode Coded Values (R1)

Source: DATABASE_GUIDE §6 R1, §8 (enum decoding); ARCHITECTURE §8.

## The rule: never show a raw code

Some integer fields in the database store IPEDS numeric codes that are meaningless to a student. Showing `control: 2` instead of "Private (nonprofit)" is a data error. This skill tells you how to always show the decoded label.

## The safe path: use get_values or get_dossier

The `get_values` and `get_dossier` tools apply the normalization engine (R1–R12) automatically. Every coded field comes back already decoded in the `display` field of the citation envelope. You never see the raw code. This is the correct path for 90%+ of questions.

Example: `get_values(unitid, ["institution.control", "admissions.req_test_scores"])` returns:
- `institution.control` → `display: "Private (nonprofit)"` (not `2`)
- `admissions.req_test_scores` → `display: "Test-optional"` (not `3`)

Use `get_values` or `get_dossier` for all standard lookups. You are done.

## Common coded columns you will encounter

These columns require decoding. The tool handles it for you when using get_values:

| Field key | Raw column | Common decoded values |
|---|---|---|
| `institution.control` | `CONTROL` | 1=Public, 2=Private (nonprofit), 3=Private (for-profit) |
| `admissions.req_test_scores` | `ADMCON7` | 1=Required, 3=Test-blind, 5=Test-optional |
| `academics.calendar_system` | `CALSYS` | 1=Semester, 2=Quarter, 3=Trimester |
| `institution.hbcu` / `institution.is_hbcu` | `HBCU` | 1=Yes, 2=No (prefer Scorecard `institution.hbcu` bool instead) |
| `institution.carnegie_2021_basic` | `C21BASIC` | See IPEDS valueset |
| `institution.locale` | `LOCALE` | 11-13=City, 21-23=Suburb, 31-33=Town, 41-43=Rural |
| CDS factor weights | text strings | Already title-case strings — no decode needed, just R7 formatting |

Admission condition columns `ADMCON1`–`ADMCON12` (all `admissions.c7_*` factor fields) are also coded. The tool decodes them.

## When using query_database (the SQL escape hatch)

If you need to write raw SQL (for ranking, filtering, or aggregation the typed tools don't cover), the raw values in `field_values` are uncoded integers. Use the helper:

```sql
-- Decode one value inline
SELECT counselle.decode_ipeds(raw_table, raw_column, value::text) AS decoded_label
FROM field_values fv
JOIN fields f ON f.key = fv.field_key
WHERE fv.unitid = $1 AND fv.field_key = $2;
```

Or join the valueset directly:
```sql
SELECT vs."ValueLabel"
FROM raw.ipeds_valuesets24 vs
WHERE lower(vs."TableName") = lower(replace($1, 'raw.ipeds_', ''))
  AND lower(vs."VarName")   = lower($2)
  AND vs."Codevalue"        = $3::text;
```

The reading rules still apply to SQL escape-hatch results. Never present uncoded integers to a student.

## Scorecard coded columns (no decode endpoint — use hardcoded maps)

Scorecard has no decode table. Use these maps directly when needed:

- `PREDDEG`/`HIGHDEG`: 0=Non-degree, 1=Certificate, 2=Associate, 3=Bachelor's, 4=Graduate
- `CONTROL` (Scorecard): 1=Public, 2=Private (nonprofit), 3=Private (for-profit)
- `MAIN`: 0=Branch campus, 1=Main campus

Again, `get_values` handles this for you. Only reference these maps if writing raw SQL.

## CDS fields (no decode needed — use R7 formatting)

CDS text fields are already human-readable strings. They need light formatting only:
- `cds.c8a_test_policy` values like `"test_optional"` → display as "Test-optional"
- Factor weight strings like `"very_important"` → "Very important"
- Apply title-case. No lookup required.

## What to do if a value looks like a number but seems wrong

If `get_values` returns a value that looks like a raw integer (e.g. `display: "2"` for a known coded column), that is a bug in the normalization engine — do not show it to the student. Use `search_fields` to check the field's metadata, then fall back to a web search for that specific fact.
