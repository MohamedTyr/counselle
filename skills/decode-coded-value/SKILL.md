---
name: decode-coded-value
description: How to use code-produced displays from the typed profile and CDS readers. Never expose an undecoded raw source code to a student.
---

# Decode Coded Values (R1)

Source: DATABASE_GUIDE §6 R1, §8 (enum decoding); ARCHITECTURE §8.

## The rule: never show a raw code

Some integer fields in the database store IPEDS numeric codes that are meaningless to a student. Showing `control: 2` instead of "Private (nonprofit)" is a data error. This skill tells you how to always show the decoded label.

## The safe path: use typed reads

The `get_school_profile` and `get_domain` tools apply the typed reading rules automatically. Every returned fact includes a code-produced `display`; never reinterpret a raw code yourself.

Example: `get_school_profile(unitid, ["classification"])` returns profile leaves with code-produced displays.
- `institution.control` → `display: "Private (nonprofit)"` (not `2`)
- `admissions.req_test_scores` → `display: "Test-optional"` (not `3`)

Use `get_school_profile` for identity facts or `get_domain` for CDS metrics. You are done.

## Common coded columns you will encounter

The profile reader handles source decoding before values reach you:

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

Again, the typed read tools handle this for you. Raw SQL is only for candidate or aggregate analysis.

## CDS fields (no decode needed — use R7 formatting)

CDS text fields are already human-readable strings. They need light formatting only:
- `cds.c8a_test_policy` values like `"test_optional"` → display as "Test-optional"
- Factor weight strings like `"very_important"` → "Very important"
- Apply title-case. No lookup required.

## What to do if a value looks like a number but seems wrong

If a typed read returns a display that appears inconsistent with its definition, do not show it to the student. Re-read the relevant domain, then fall back to an official web search for that specific fact.
