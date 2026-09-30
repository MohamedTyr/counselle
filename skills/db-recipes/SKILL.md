---
name: db-recipes
description: Parameterized SQL patterns over the five schema-qualified cds_library reader views (school_profiles, school_facts_sql, school_explore, school_data_status, fact_coverage), for the query_database escape hatch only — fact-key coverage denominators, numeric candidate filtering, and what never to select. Use only when a typed tool (resolve_school, get_school_profile, get_facts) can't answer the question.
---

# DB Recipes

## Typed tools first — this is the rare path

`resolve_school`, `get_school_profile`, and `get_facts` cover almost every
question. Use `query_database` only for cross-school selection, aggregates, or
coverage detail a typed tool cannot answer; typed reads are already cited.

`query_database` accepts exactly one parameterized `SELECT`/`WITH`, positional
`$1..$n` only, under a row cap and statement timeout, restricted to exactly
five schema-qualified views:

- `cds_library.school_profiles`
- `cds_library.school_facts_sql`
- `cds_library.school_explore`
- `cds_library.school_data_status`
- `cds_library.fact_coverage`

Never write a bare table name; no other relation is reachable through this
tool. `cds_library.current_school_facts` is reader-granted but deliberately
never allow-listed here — it carries a raw jsonb `value` column that
`query_database` must never project. `school_facts_sql` is the flattened,
JSON-free view to read instead: one row per school per fact key, with
`value_num`, `value_text`, `value_bool`, `value_date`, a preformatted
`display`, and `observed_at`.

Fact keys are exact `<domain>.<name>` strings from `get_facts`/
`resolve_school`, never a substring — `fact_key LIKE`/`ILIKE` is rejected
outright. Bind a fact key as a parameter used inside a `fact_key = $n` or
`fact_key IN (...)` predicate; that binding is what lets the guard attach a
real `fact_coverage` denominator to the result. An inlined literal, an
unresolved string, or a param never used against `fact_key` earns none.

## Coverage denominator recipe

Any cross-school aggregate or ranking must state covered/total, never just the
covered count. `fact_coverage` already has this precomputed per fact key —
read it directly rather than recomputing a denominator by hand, and attach the
`coverage_denominator` caveat wording rather than hand-writing your own
sentence:

```sql
SELECT schools_with_value AS covered,
       (SELECT count(*) FROM cds_library.school_profiles) AS total,
       computed_at AS as_of
FROM cds_library.fact_coverage
WHERE fact_key = $1
```

Every ranking or aggregate query you write yourself must still return columns
named `covered`, `total`, and `as_of` — bind the ranked fact key as a
`fact_key = $n`/`IN` parameter so those columns reflect a real denominator,
not an implicit row count.

The total is every profiled school, not the view's own `schools_total` (only the
schools with a CollegeData crawl): a ranking is out of all the schools Counselle
knows, and the coverage block `query_database` attaches uses the same total.

## Numeric candidate filter

For cross-school candidate selection over `school_facts_sql` ("which schools
report a net price under $20k," "top 10 by lowest admit rate"), filter to a
bound `fact_key` and the real numeric column, `value_num` — never a text or
`display` column:

```sql
SELECT f.school_id, p.name, f.value_num, f.display, f.observed_at,
       count(*) OVER () AS covered,
       (SELECT count(*) FROM cds_library.school_profiles) AS total,
       (SELECT computed_at FROM cds_library.fact_coverage WHERE fact_key = $1) AS as_of
FROM cds_library.school_facts_sql f
JOIN cds_library.school_profiles p ON p.id = f.school_id
WHERE f.fact_key = $1 AND f.value_num IS NOT NULL
ORDER BY f.value_num ASC
LIMIT $2
```

This produces a **candidate list**, not a citation: re-fetch each finalist's
real value through `get_facts` for its typed display string, vintage, and
citation before telling the student a number. If visualizing a stored fact,
use that exact `fact_key` in each finalist cell; never substitute an uncited
derived value. Never cite the raw SQL row directly.

`school_explore` carries a wide set of already-typed, already-numeric columns
(admit rate, cost, test-score bands, majors, and more) for filtering and joins
that don't need a `fact_key` at all — join it to `school_profiles` on
`school_id = id`:

```sql
SELECT p.name, e.admit_rate
FROM cds_library.school_explore e
JOIN cds_library.school_profiles p ON p.id = e.school_id
WHERE e.control = $1 AND e.cost_attendance_out_of_state < $2
ORDER BY e.admit_rate ASC LIMIT $3
```

## Majors membership (the one non-obvious rule)

A school's major list has no standard vocabulary, so a
`school_explore.majors @> ARRAY[...]` membership test always carries the
`academics.undergraduate_majors` denominator and the printed-name caveat — a
match is a match on the school's own printed name, never a normalized
taxonomy:

```sql
SELECT name FROM cds_library.school_explore WHERE majors @> ARRAY[$1]
```

## What never to select

- `school_profiles.profile_sha256` (binary), `basic_profile` and
  `profile_provenance` (internal jsonb), and `school_data_status.tabs`
  (internal jsonb) are blocked before execution. Use `get_school_profile` for
  typed, decoded identity fields instead of reaching for the raw column.
- Raw, unprocessed rows presented directly to a student as a cited fact —
  `query_database` output is for your own candidate analysis and shaping the
  next typed call, not a citation source in itself.
- An inlined literal fact key with no `fact_key = $n`/`IN` binding — it never
  earns a `fact_coverage` denominator, so either bind it as a parameter or
  state the number without a population claim.
