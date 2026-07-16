---
name: db-recipes
description: Parameterized SQL patterns over the five schema-qualified cds_library reader views, for the query_database escape hatch only — selected-edition and coverage-denominator recipes, numeric candidate filtering, and what never to select. Use only when a typed tool (resolve_school, get_school_profile, get_domain) can't answer the question.
---

# DB Recipes

Source: `specs/db-rewire/design.md` §§2, 5, 10; `docs/DATABASE_GUIDE.md` §8.

## Typed tools first — this is the rare path

`resolve_school`, `get_school_profile`, and `get_domain` cover almost every
question. Reach for `query_database` only for cross-school candidate
selection, ad-hoc aggregates/distributions, or coverage detail beyond what
`resolve_school`'s coverage block already gives you per school. If a typed
tool can answer it, use the typed tool — it's cheaper and it's already cited.

`query_database` accepts exactly one parameterized `SELECT`/`WITH`,
positional `$1..$n` only, under a row cap and statement timeout, restricted
to exactly five schema-qualified views:

- `cds_library.school_profiles`
- `cds_library.active_cds_domain_packets`
- `cds_library.active_cds_documents`
- `cds_library.cds_document_sources`
- `cds_library.cds_manifest_snapshots`

Never write a bare table name — always schema-qualify. No other relation is
reachable through this tool.

Profile groups come dynamically from `school_profiles.basic_profile`.
Manifest domains/metrics come dynamically from the current
`cds_manifest_snapshots.content`. Selected-edition facts come from
`active_cds_documents`; per-domain status comes from
`active_cds_domain_packets`. Never memorize those inventories or recreate
selected-edition logic in SQL when a typed tool already exposes it.

## Coverage denominator recipe

Any cross-school aggregate must state covered/total, never just the covered
count. Compute the covered side from `active_cds_documents` (schools with a
usable document) and the total from `school_profiles` (every profile), and
attach the `coverage_denominator` caveat wording — don't hand-write your own
denominator sentence:

```sql
SELECT count(DISTINCT d.school_id) AS covered,
       count(DISTINCT p.id) AS total
FROM cds_library.school_profiles p
LEFT JOIN cds_library.active_cds_documents d ON d.school_id = p.id
```

For a metric ranking, that broad document count is not the ranking
denominator: the numerator must count only schools whose selected packet has
that exact metric as verified, reported, and a JSON number, over the same
all-profiled-schools denominator.

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
  SELECT school_id, metric -> 'value' AS value
  FROM candidates
  WHERE metric ->> 'extraction_status' = 'verified'
    AND metric ->> 'availability_status' = 'reported'
    AND jsonb_typeof(metric -> 'value') = 'number'
)
SELECT v.school_id, p.name, v.value,
       count(*) OVER () AS covered,
       (SELECT count(*) FROM cds_library.school_profiles) AS total
FROM verified v
JOIN cds_library.school_profiles p ON p.id = v.school_id
ORDER BY v.value DESC
LIMIT $3
```

Packet-v8 `metrics` keys are already qualified refs (`domain_id.metric_id`).
`$1` is the live domain id, `$2` the exact qualified ref from the live
manifest/`get_domain`, and `$3` the result limit. Never strip the domain
prefix or reconstruct the ref in SQL. A result built this way is a
**candidate list**, not a citation: re-fetch each finalist's real value
through `get_domain` for a typed reading, display string, and page citation
before telling the student a number. Never cite the raw SQL row directly.

## What never to select

- `pdf_content` (bytea) — PDF bytes are served only by the dedicated
  document/page endpoint, never through `query_database`.
- The whole `packet` jsonb column, or `provider_contract` inside it — that's
  pipeline provenance, not agent-facing data; it never belongs in a query
  result you'd show or reason from as student truth.
- Raw, unprocessed rows presented directly to a student as a cited fact —
  `query_database` output is for your own candidate analysis and shaping the
  next typed call, not a citation source in itself.
