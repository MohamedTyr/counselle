---
name: db-recipes
description: Parameterized SQL patterns over the five schema-qualified cds_library reader views, for the query_database escape hatch only — selected-edition and coverage-denominator recipes, numeric candidate filtering, and what never to select. Use only when a typed tool (resolve_school, get_school_profile, get_domain) can't answer the question.
---

# DB Recipes

## Typed tools first — this is the rare path

`resolve_school`, `get_school_profile`, and `get_domain` cover almost every question.
Use `query_database` only for cross-school selection, aggregates, or coverage detail a typed tool cannot answer; typed reads are already cited.

`query_database` accepts exactly one parameterized `SELECT`/`WITH`, positional
`$1..$n` only, under a row cap and statement timeout, restricted to exactly five schema-qualified views:

- `cds_library.school_profiles`
- `cds_library.active_cds_domain_packets`
- `cds_library.active_cds_documents`
- `cds_library.cds_document_sources`
- `cds_library.cds_manifest_snapshots`

Never write a bare table name; no other relation is reachable through this tool.

Profile groups come dynamically from `school_profiles.basic_profile`. Manifest
domains/metrics come from the current `cds_manifest_snapshots.content`.
Selected-edition facts come from `active_cds_documents`; per-domain status comes from `active_cds_domain_packets`.
Never memorize those inventories or recreate selected-edition logic in SQL when a typed tool already exposes it.

There is no `manifest.metrics` relation or column. Check one exact candidate ref in the current snapshot's `content`, carrying the denominator with it:

```sql
SELECT m.version,
       m.published_at AS as_of,
       jsonb_path_exists(m.content,
         '$.domains[*].metrics[*] ? (@.id == $ref)',
         jsonb_build_object('ref', to_jsonb($1::text))) AS metric_ref_present,
       (SELECT count(*) FROM cds_library.school_profiles) AS total
FROM cds_library.cds_manifest_snapshots m
WHERE m.is_current
```

Copy that entire statement verbatim and bind `$1` to the exact qualified ref, with no wildcard.
If the guard rejects a manifest query, retry from this block; never improvise
a text scan, JSON join, or alternate JSONPath. When false, say `0 out of total`; do not invent a packet path, ranking, or school list.

## Coverage denominator recipe

Any cross-school aggregate must state covered/total, never just the covered count.
Compute the covered side from `active_cds_documents` (schools with a usable document)
and the total from `school_profiles` (every profile), and attach the
`coverage_denominator` caveat wording — don't hand-write your own denominator sentence:

```sql
SELECT count(DISTINCT d.school_id) AS covered,
       count(DISTINCT p.id) AS total,
       (SELECT published_at FROM cds_library.cds_manifest_snapshots WHERE is_current) AS as_of
FROM cds_library.school_profiles p
LEFT JOIN cds_library.active_cds_documents d ON d.school_id = p.id
```

For a metric ranking, that broad document count is not the ranking denominator: the numerator must count only schools whose selected packet has
that exact metric as verified, reported, and a JSON number, over the same all-profiled-schools denominator.
Every ranking query must return columns named `covered`, `total`, and `as_of`;
do not leave those facts implicit in a candidate count or tool-result timestamp.

## Numeric packet candidate filter (the one non-obvious rule)

For cross-school candidate selection over packet metrics ("which schools
report need-blind aid," "top 10 by lowest net price"), filter to exactly
three conditions before treating a jsonb value as a real number:
`extraction_status = 'verified'`, `availability_status = 'reported'`, and the
JSON value is actually a number (not a string, not null). Never treat
`not_extracted`/`conflict`/`invalid`/`reported = false` rows as numeric
candidates — they aren't verified facts.

The packet path is `packet -> 'metrics' -> $metric_id`; there is no
normalized metric table and no retired wide `fields`/`field_values` schema:

```sql
WITH selected AS (
  SELECT DISTINCT ON (school_id) school_id, document_id
  FROM cds_library.active_cds_documents
  ORDER BY school_id, academic_year DESC, document_id DESC
), candidates AS (
  SELECT d.school_id, d.packet -> 'metrics' -> $2 AS metric
  FROM cds_library.active_cds_domain_packets d
  JOIN selected s ON s.school_id = d.school_id AND s.document_id = d.document_id
  WHERE d.domain_id = $1
), verified AS (
  SELECT school_id, (metric ->> 'value')::numeric AS value
  FROM candidates
  WHERE metric ->> 'extraction_status' = 'verified'
    AND metric ->> 'availability_status' = 'reported'
    AND jsonb_typeof(metric -> 'value') = 'number'
)
SELECT v.school_id, p.name, v.value,
       count(*) OVER () AS covered,
       (SELECT count(*) FROM cds_library.school_profiles) AS total,
       (SELECT published_at FROM cds_library.cds_manifest_snapshots WHERE is_current) AS as_of
FROM verified v
JOIN cds_library.school_profiles p ON p.id = v.school_id
ORDER BY v.value DESC
LIMIT $3
```

Packet-v8 `metrics` keys are already qualified refs (`domain_id.metric_id`).
`$1` is the domain, `$2` the exact qualified ref, and `$3` the limit. Never
strip or reconstruct the ref. After the JSON-number guard, cast
`metric ->> 'value'` (text), never `metric -> 'value'` (jsonb). This produces a
**candidate list**, not a citation: re-fetch each finalist's real value
through `get_domain` for a typed reading, display string, and page citation
before telling the student a number. If visualizing a stored metric, use that exact
qualified ref in each finalist cell; never substitute an uncited derived value.
Never cite the raw SQL row directly.

## What never to select

- `pdf_content` (bytea) — PDF bytes are served only by the dedicated
  document/page endpoint, never through `query_database`.
- The whole `packet` jsonb column, or `provider_contract` inside it — that's
  pipeline provenance, not agent-facing data; it never belongs in a query
  result you'd show or reason from as student truth.
- Raw, unprocessed rows presented directly to a student as a cited fact —
  `query_database` output is for your own candidate analysis and shaping the
  next typed call, not a citation source in itself.
