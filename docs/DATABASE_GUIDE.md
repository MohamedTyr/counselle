# Counselle database contract

Counselle's student-facing agent is a read-only consumer of the CDS Library: it reads
only the five views granted to `cds_library_reader`, over `COUNSELLE_DB_RO_DSN`, and
nothing in that path has changed. This guide describes that contract and the honesty
rules for turning it into student-facing answers, and those rules are unweakened by
anything below.

Since ADR 0036, Counselle also *contains* the CDS extraction pipeline: a separate,
superuser-gated admin write path that populates the base tables the five views read.
§1 describes both paths and the hard boundary between them — a third role and a third
DSN, touched by exactly two files, never by the agent. Everywhere else in this
document, "Counselle" continues to mean the read-only agent path unless a sentence says
otherwise.

The CDS Library is a narrow, deep evidence store. It provides stable school identity
profiles and versioned Common Data Set (CDS) domain packets whose values carry physical
PDF evidence. It does not provide the old IPEDS/Scorecard time-series, program,
earnings, national-benchmark, or wide field-catalog surfaces.

## 1. Access and permissions

### The read path — student-facing agent, unchanged

Connect with the LOGIN role whose membership is limited to `cds_library_reader`, using
`COUNSELLE_DB_RO_DSN`. Use schema-qualified, parameterized SQL. The reader can select
exactly these views:

| View | Contract |
|---|---|
| `cds_library.school_profiles` | One row per school: typed identity columns, `basic_profile`, per-field `profile_provenance`, and profile version/snapshot/hash. |
| `cds_library.active_cds_documents` | One row per active school edition: document source, currentness, packet coverage, and deterministic latest extraction id/status/safe error code. |
| `cds_library.active_cds_domain_packets` | One row per active document × current-manifest domain, including rows with no accepted packet, plus definition-match and deterministic latest requested outcome. |
| `cds_library.cds_document_sources` | Immutable document metadata and exact PDF bytes, addressed by document id. |
| `cds_library.cds_manifest_snapshots` | Immutable compiled manifests, hashes, publication time, extraction-contract version, and current pointer. |

No base table is part of this path's API. In particular, the agent's connections
cannot select `schools`, `cds_school_years`, `cds_documents`, `cds_domain_packets`,
`cds_extractions`, or `cds_manifests` — only the five views above. Do not request
broader grants for the agent path or compensate for a missing view field with
base-table access. `cds_library_reader` is the only role, and `COUNSELLE_DB_RO_DSN`
the only DSN, the agent's own connections ever hold; the write path described at the
end of this section runs on an entirely separate role, DSN, and connection pool that
agent code never touches.

The manifest snapshot columns preserve their original order and append
`extractor_contract_version` then `is_current`. Exactly one row is current. Latest
extraction rows are selected by `created_at DESC, id DESC`; status and error code
therefore come from the same deterministic row even when timestamps tie. Views expose
safe `error_code` values only, never raw `error_message` or provider diagnostics.

### Exact view schemas

Column order and PostgreSQL types are contractual. Nullable columns are marked `?`;
all other columns are non-null in the underlying contract.

| View | Columns in order |
|---|---|
| `school_profiles` | `id integer`, `name text`, `aliases text[]`, `city text?`, `state text?`, `postal_code text?`, `latitude numeric?`, `longitude numeric?`, `official_website text?`, `official_domain text?`, `general_phone text?`, `is_currently_operating boolean?`, `is_main_campus boolean?`, `search_name text`, `basic_profile jsonb`, `profile_provenance jsonb`, `profile_version text`, `profile_snapshot_date date`, `profile_sha256 bytea`, `imported_at timestamptz` |
| `active_cds_documents` | `school_id integer`, `academic_year smallint`, `school_year_id bigint`, `document_id bigint`, `pdf_sha256 bytea`, `source_kind text`, `source_page_url text?`, `original_download_url text?`, `resolved_download_url text?`, `retrieved_at timestamptz`, `currentness text`, `staleness_reason text?`, `usable_domain_count integer`, `partial_domain_count integer`, `latest_extraction_id uuid?`, `latest_extraction_status text?`, `latest_error_code text?` |
| `active_cds_domain_packets` | `school_id integer`, `academic_year smallint`, `school_year_id bigint`, `document_id bigint`, `pdf_sha256 bytea`, `domain_id text`, `accepted_packet_status text?`, `packet jsonb?`, `extraction_id uuid?`, `manifest_version text?`, `domain_schema_hash bytea?`, `current_definition_match boolean`, `latest_requested_extraction_id uuid?`, `latest_requested_outcome text?`, `latest_error_code text?` |
| `cds_document_sources` | `document_id bigint`, `school_id integer`, `academic_year smallint`, `pdf_content bytea`, `pdf_sha256 bytea`, `mime_type text`, `original_filename text?`, `source_kind text`, `source_page_url text?`, `original_download_url text?`, `resolved_download_url text?`, `repository_school_name text?`, `retrieved_at timestamptz`, `created_at timestamptz`, `invalidated_at timestamptz?`, `superseded_at timestamptz?` |
| `cds_manifest_snapshots` | `version text`, `content_sha256 bytea`, `content jsonb`, `domain_hashes jsonb`, `published_at timestamptz`, `extractor_contract_version text`, `is_current boolean` |

Nullable packet columns are the intended left-join representation of a current domain
with no accepted packet. Nullable latest-extraction columns mean no matching request
exists. `staleness_reason` is null for a current edition. Source URL and filename
fields may be absent; PDF content and its SHA are never null.

`COUNSELLE_DB_RO_DSN` authenticates a LOGIN member of the NOLOGIN
`cds_library_reader` group and is the only credential the agent path may use to read
the five views. `COUNSELLE_DB_APP_DSN` owns Counselle's own application state in the
`counselle` schema (users, sessions, chats, workspace, feedback, and checkpointer); it
has zero grants on `cds_library` and must never be used to bridge to it. Never
substitute one DSN for another, or import pipeline code to bridge them.

### The write path — admin pipeline only, walled off by role and DSN

Since ADR 0036, Counselle also contains the CDS extraction pipeline that populates the
base tables the five views above read. This is a **separate, isolated write path**, not
an exception to anything above: the agent's own connections never gain write
capability, and every read-path rule in this document — the view contract, the honesty
rules in §5–§9 — applies to it exactly as written, unchanged.

- **Role and DSN.** The write path authenticates as `cds_library_app` over a third
  credential, `COUNSELLE_DB_PIPELINE_DSN` (`config/settings.py`'s `db_pipeline_dsn`,
  optional — the app boots fine without it, and the CDS admin router returns a clean
  503 until it is configured). `cds_library_app` holds `INSERT, SELECT, UPDATE` —
  **never `DELETE`** — on all 8 `cds_library` base tables (`schools`,
  `cds_school_years`, `cds_documents`, `cds_manifests`, `cds_extractions`,
  `cds_domain_packets`, `ct_index_entries`, `ct_index_state`). The missing `DELETE`
  grant was confirmed empirically against the live database, including a direct
  `DELETE` attempt that Postgres rejected (`plans/cds-pipeline/recon-db-live.md` §4),
  not just read from a grant table.
- **Code boundary.** Only `adapters/cds_store.py` and `adapters/cds_admin_queries.py`
  ever open a connection on this DSN, and only reachable behind the `current_superuser`
  dependency gating `/v1/admin/cds/*`. No other adapter, service, tool, or route holds
  this credential. The agent's own connection pool is constructed from
  `COUNSELLE_DB_RO_DSN` only and is never given `cds_library_app`'s credentials — the
  isolation is role-level and DSN-level, not just code-organizational, so a bug inside
  `app/cds/` cannot let the agent's request path write.
- **No deletes, ever, at any layer.** `cds_library_app` has no `DELETE` grant anywhere.
  Evidence columns (`cds_documents.pdf_content`, `cds_domain_packets.packet`) also
  carry a `BEFORE UPDATE` immutability trigger that rejects mutation even from
  `cds_library_app` — confirmed firing live against both a same-transaction row and
  pre-existing production data (`recon-db-live.md` §6).
- **Corrections are new rows, never edits.** An admin correction writes a new
  `cds_domain_packets` row carrying `human-review-v1` provenance
  (`provider_contract.human_review`); it is never a mutation of the row it corrects —
  the immutability trigger makes this the only possible shape, not just the chosen one.
  Every packet the write path builds — model (`counselle-cds-v1`) or human-corrected
  (`human-review-v1`) — is validated through the read path's own
  `counselle_db.packets.parse_packet_row()` inside the transaction, before COMMIT; a
  packet the read path could not parse is never written.

Read this section and you should know exactly which DSN may do what:
`COUNSELLE_DB_RO_DSN` reads five views and nothing else; `COUNSELLE_DB_APP_DSN` owns
`counselle.*` and nothing in `cds_library`; `COUNSELLE_DB_PIPELINE_DSN` is the only
credential that can write `cds_library`, and only through two files, only behind
`current_superuser`, and never with `DELETE`. The agent's own connections are never the
second or third of these.

## 2. School identity and profiles

`school_profiles.id` is the IPEDS UNITID and remains Counselle's canonical school key.
Resolve a school before school-specific reads. Names, `search_name`, aliases, location,
official domain, and main-campus status support resolution; ambiguous campuses remain
distinct schools.

`basic_profile` is stable identity context, not current institutional metrics. Its
top-level groups come from the stored profile itself; consumers must not maintain a
second enum. The exact live object-valued roots are `identity`, `location`, `contact`,
`official_links`, `classification`, `identity_and_mission`, and `operational`. They are
a checked snapshot, not a schema enum: code still derives roots from each stored
object. The profile intentionally
excludes annual admissions, enrollment, cost, aid, outcomes, earnings, demographics,
staffing, and other time-series facts.

Every profile leaf may have a receipt in `profile_provenance`: status, chosen source,
source column, vintage, source-file SHA, raw and normalized values, and normalization.
Use the stored receipt rather than inventing a source label. Every profile answer must
carry the profile snapshot/version caveat; a profile value must never be presented as a
live or current-cycle metric.

## 3. Manifest 5.0.2: the dynamic catalog

The row with `is_current = true` is the only current catalog. The coordinated
publication is manifest `5.0.2`, extraction contract `8`, extractor identifier
`gemini-routed-extraction-v8`. Counselle validates the current pointer and contract;
it does not hardcode the domain menu, metric counts, labels, or ordering.
The immutable `5.0.0` and `5.0.1` snapshots remain in history. `5.0.2` is the current
patch successor; consumers must never reinterpret older packets as having `5.0.2`
semantics.

Domain and metric definitions come from `content`; domain semantic hashes come from
`domain_hashes`. The active-packet view reports `current_definition_match`, which says
whether an accepted packet's domain schema hash still matches the current manifest.
A false match is a caveat, never permission to reinterpret the old packet with the new
definition.

### Qualified metric references

The canonical identifier is `<domain_id>.<metric_id>`, for example
`admissions.applicants_men`. Bare metric ids are not globally unique and must never
cross Counselle's typed packet boundary. Returned values, visualization cells,
evidence ids, and eval fixtures all use qualified refs. A ref is valid only when it is
minted from the packet's domain plus a manifest metric; do not guess one from prose.

### Compiled contexts

Some metrics are binders: printed terms, years, snapshot dates, cohorts, or reporting
windows that date surrounding values. Manifest 5.0.2 compiles each authored
`context_bindings` relationship onto selected target metrics as:

```json
{
  "contexts": [{
    "id": "admissions.c1_entering_class",
    "label": "entering class",
    "refs": [
      "admissions.first_year_admission_entry_term",
      "admissions.first_year_admission_entry_year"
    ]
  }]
}
```

Context ids, target ids, and refs are qualified. Context order follows authoring order;
refs follow global manifest order. Counselle consumes only compiled `contexts`: never
parse `instructions`, infer nearby cells, reverse selectors, or maintain a second
binder map. A binder remains a normal cited metric even when it supplies context.

## 4. Active documents and selected editions

`active_cds_documents` is the edition-selection contract. Treat separate academic
years as separate rows. For normal school-specific reads, select exactly one edition
per school by the greatest `(academic_year, document_id)` tuple: order by
`academic_year DESC, document_id DESC`. Once selected, every domain lookup stays
pinned to that document identity. There is no fallback to an older document's domain
packet when the selected edition lacks one. Retain its `academic_year`, and disclose:

- `currentness = stale` and `staleness_reason = older_edition`;
- `partial_domain_count` when any active packet is partial;
- the latest extraction status and safe error code when relevant;
- the document's source and retrieval metadata.

Never merge values across editions to fill holes. Never silently substitute an older
packet for a missing current-domain row. Comparisons must disclose edition mismatch;
current-cycle deadlines or facts beyond the CDS edition require an official-web
fallback even when a packet exists.

The active-domain view left-joins every current manifest domain. A row with
`packet IS NULL` means the current domain is explicitly unavailable for that selected
document; it is not evidence that the school did not report every metric. Preserve the
distinction between no document, no accepted packet, partial packet, stale packet, and
definition mismatch.

## 5. Packet v8 anti-corruption boundary

Parse packet JSON into typed local models before any value reaches application code.
Reject malformed identity rather than repairing it. At minimum, enforce:

- the selected view row retains `school_id`; packet document, domain, and
  academic-year identities agree with that row (packets do not carry `school_id`);
- `domain_id` agrees with every qualified metric ref;
- `manifest_version`, `domain_schema_hash`, and extractor identifier are retained;
- only `validated` and `partial` packets are accepted by the active view;
- provider contract payloads are dropped and never enter tool output, state, receipts,
  citations, or logs;
- evidence page numbers are positive physical PDF page numbers;
- unavailable and failed states cannot carry a student value;
- packets are readable only under these explicitly supported extractor identifiers
  (`config/settings.py`'s `supported_packet_extractor_versions`): the legacy
  `gemini-native-pdf-v2`, `gemini-native-pdf-v5`, and `gemini-routed-extraction-v7`;
  the retired pipeline's final engine, `gemini-routed-extraction-v8`; and, since
  ADR 0036, the in-app admin pipeline's two identities — `counselle-cds-v1` for model
  extractions and `human-review-v1` for admin corrections. An identifier says which
  engine wrote a packet, nothing more; a packet is never relabeled to a different
  identifier or upgraded by inference, and every identity is validated the same way,
  through the same `parse_packet_row()` call, regardless of which engine produced it.

A packet contains document SHA, academic year, extraction id, manifest/domain pins,
extractor/model identity, packet status and counts, and a metrics map. Packet counts are
diagnostic source facts. Counselle's student-facing availability summary uses the
current manifest denominator and typed states, not `len(metrics)`.

### School coverage aggregates

Coverage aggregates use the one selected document per school and current-manifest
domain rows joined to that exact document:

- `covered`: at least one current-manifest domain row has a non-null accepted packet;
- `fully`: the accepted-packet count equals the current manifest's domain count and
  the selected document has zero partial packets;
- `partial`: covered but not fully.

An older edition's packet never contributes to these counts for the selected document.

## 6. Reading states and display rules

`extraction_status` and `availability_status` answer different questions. Apply this
table in code, before the model sees a value:

| Extraction | Availability | Student display |
|---|---|---|
| `verified` | `reported` | Display the typed value and retain its evidence. |
| `verified` | `not_reported` | Unavailable: the visible source does not report a value; retain valid legacy evidence if present. |
| `verified` | `not_applicable` | Unavailable/not applicable, with evidence. |
| `verified` | `suppressed` | Unavailable/suppressed, with evidence; never infer the hidden value. |
| `verified` | `not_in_template_version` | Unavailable because that row/column is structurally absent from this form edition, with proof. |
| `not_extracted` | null | No student value; extraction did not yield a verified finding. |
| `conflict` | null | No student value; conflicting findings remain internal diagnostics. |
| `invalid` | null | No student value; diagnostic code remains internal. |

Only `verified + reported` is a student value. Zero and false are valid reported values
when explicitly extracted; they are never synonyms for missing, blank, suppressed, or
not applicable. Copy the canonical formatted display produced by code—do not ask the
model to reformat or paraphrase it.

### Structural template absence

`not_in_template_version` is a verified source-state assertion introduced in v8. It
requires a physical page and enough visible table/header excerpt to prove the configured
row or column does not exist in that school's CDS template edition. Its typed and raw
values are null. A blank cell, failed OCR, missing routed page, failed extraction, or a
model's inability to find a metric is not proof. Never reinterpret a legacy
`not_extracted` result or an absent metric as template absence, and never fold template
absence into “not reported.”

### Availability summary

For a domain, say “N of M metrics verified,” where M is the number of configured
metrics in the current manifest and N is the verified count. State K
`not_in_template_version` metrics separately. Do not use packet-map length as M and do
not call every non-reported state “missing.”

## 7. Evidence, citations, vintage, and caveats

Every reported CDS value and verified source-state assertion is tied to evidence:
physical `page_number`, verbatim excerpt, and available section/row/column labels. The
document id and SHA anchor the exact immutable PDF. Counselle registers this evidence
once in the source registry and returns compact markers in tool payloads; it does not
repeat packet excerpts throughout model context.

The citation identifies the school, CDS edition, document, and page from stored data.
The model must copy citation markers verbatim. It must not manufacture a page, edition,
source, or marker. Live aggregates over raw query rows receive an explicit as-of date
and covered/total denominator, not a fake value citation; named final values are
re-fetched through typed reads for evidence.

Compiled contexts supply value-specific vintage. Resolve each context ref through the
same typed metric map and attach the binder's reported display/evidence. Omit a context
when any binder is missing or unavailable; never guess a term or year from the
surrounding PDF.

The code-owned caveat catalog supplies canonical text for these kinds:

- profile snapshot / identity-only limitation;
- stale or older CDS edition;
- partial packet;
- current-definition mismatch;
- cross-school edition mismatch;
- unavailable/not reported/not applicable/suppressed;
- not in this template version;
- covered-population denominator for cross-school queries.

Prompts and skills may name caveat kinds and explain when to voice them, but must not
duplicate or improvise canonical wording.

## 8. Query recipes

Typed tools are the normal path: `resolve_school` resolves the school, `get_school_profile`
reads profile identity, then `get_domain` reads a usable whole domain. `query_database` is
a rare escape hatch for cross-school candidate selection, aggregates, and detailed
coverage. It accepts one parameterized `SELECT`/`WITH`, applies timeout and row limits,
and remains restricted to the five views.

The guarded query path accepts one `SELECT` or `WITH`, positional `$1..$n` parameters,
and applies the configured statement timeout and row cap. Select only needed columns.
Never select `pdf_content` or whole packet JSON through general query results. PDF
bytes are not currently served by Counselle: the authorization-checked document/page
endpoint is a deferred fast follow. Until it exists, clients use stored evidence
metadata and cannot retrieve PDFs through this service. `bytea` hashes are binary
32-byte SHA-256 values, not preformatted hex strings.

### Configured safety limits

The database contract is read-only. `query_database` enforces these named settings
(`config/settings.py`) on every call:

| Boundary | Exact configured value |
|---|---:|
| PostgreSQL statement timeout (`db_statement_timeout_ms`) | `8,000` ms |
| Guarded-query row cap (`db_row_cap`) | `500` rows |
| Serialized guarded-query result cap (`query_database_max_bytes`) | `262,144` bytes |
| Pipeline PDF upload/download cap | `50,000,000` bytes |

The statement timeout is set per-connection via `set_config('statement_timeout', ...)`;
the row cap wraps the caller's query as `SELECT * FROM (<query>) AS counselle_query
LIMIT db_row_cap + 1` and reports truncation when the extra row is present; the
serialized-result cap rejects a response whose JSON encoding exceeds
`query_database_max_bytes`. The PDF limit is the pipeline's own upload/download
contract, not a Counselle setting, and is never a license to select `pdf_content`
through `query_database`.

Examples are schematic; bind all values as `$n` parameters.

```sql
SELECT id, name, state
FROM cds_library.school_profiles
WHERE state = $1
ORDER BY name
```

```sql
SELECT school_id, academic_year, currentness,
       usable_domain_count, partial_domain_count
FROM cds_library.active_cds_documents
WHERE school_id = $1
ORDER BY academic_year DESC
```

Application-cycle dates are not CDS edition years. Counselle workspace records use
`cycle_year` for the applicant's admissions cycle; reader views use `academic_year`
for the CDS document edition; compiled binders may supply a metric-specific term or
year. Never join, compare, or relabel these merely because their numbers match.

```sql
SELECT school_id, academic_year, domain_id,
       accepted_packet_status, current_definition_match,
       latest_requested_outcome, latest_error_code
FROM cds_library.active_cds_domain_packets
WHERE school_id = $1 AND domain_id = $2
ORDER BY academic_year DESC
```

For numeric cross-school candidates, filter packet metrics to
`extraction_status = 'verified'`, `availability_status = 'reported'`, and a JSON number.
State both the covered and total population. Never select the full packet,
`provider_contract`, PDF bytes, excerpts, diagnostics, or raw rows into a cited student
answer. Re-fetch named finalists through the typed domain reader.

## 9. Fallback ladder and hard prohibitions

The honest routing order is:

1. resolve an in-database school;
2. use the profile for stable identity/classification/contact/official links;
3. use only domains listed as usable for the selected document;
4. when first-party data is absent or the question is current-cycle, use the school's
   official site/search and disclose the fallback;
5. use guarded SQL only for rare candidate/aggregate work, with denominator honesty.

Never, from this path:

- read or write pipeline base tables — the agent's own connections hold only
  `cds_library_reader` and cannot write under any circumstance; the separate,
  superuser-gated admin write path described in §1 is not reachable from here and is
  not an exception to this rule;
- treat the profile as current admissions, cost, aid, or outcomes data;
- resurrect old field keys, IPEDS decoding, source-priority tiers, or CDS breadth
  assumptions;
- merge editions, fabricate a value, convert unavailable to zero, or infer template
  absence;
- expose PDF bytes, provider contracts, error messages, excerpts, packets, or
  diagnostics in receipts/logs/model state;
- parse binder prose or hardcode domain/group/metric inventories;
- cite an aggregate as if it were a source-reported school value.

The data is the product. If the contract cannot support a claim, say what is known,
what is unavailable, which edition and population were checked, and where the answer
falls back to an external source.
