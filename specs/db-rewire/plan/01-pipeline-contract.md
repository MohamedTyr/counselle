# Phase 1 — Pipeline reader and extraction contract

## Mission

Make the already-renamed pipeline expose every contract the canonical design requires
before Counselle is rewritten against it. Complete the pipeline-only rename gate in
`06-rename-cutover-rollback.md` §§7.0, 7.1, and 8.1 first. This phase belongs in the
renamed pipeline repo. Counselle
must not compensate for a missing reader pointer, infer template absence, parse binder
instructions, or import pipeline models.

## Read first

- Counselle: `specs/db-rewire/design.md` §§2, 5, 6, 9, 10, 16.
- Pipeline: `AGENTS.md`, `migrations/0001_initial.sql`,
  `migrations/0002_extraction_claim.sql`, `migrations/0003_field_index.sql`.
- Pipeline: `src/counselle_data_pipeline/library/manifest.py`, `extractor.py`,
  `repository.py`, `service.py`, and `profiles.py`.
- Pipeline: `config/cds/manifest.yaml`, every `config/cds/domains/*.yaml`, and current
  extractor/provider prompt assets.
- Pipeline: `docs/reference/db-schema.md`, `school-profiles.md`, and tests that publish
  manifests, build packets, query reader views, and exercise the extractor.
- Preserve the untracked proposed `specs/queue-progress-and-bulk-extraction/`; it is not
  implemented and its planned migration must move from 0004 to 0005.

## 1A. Reader contract migration

### 1A.1 Add `migrations/0004_reader_contract.sql`

Use `CREATE OR REPLACE VIEW` and preserve every existing column in its current order.
Append `extractor_contract_version` and `is_current` to
`cds_manifest_snapshots`. Replace the two active views only to add deterministic latest
extraction ordering; do not add raw error messages.

The manifest view must end as:

```sql
CREATE OR REPLACE VIEW cds_library.cds_manifest_snapshots AS
SELECT
  version,
  content_sha256,
  content,
  domain_hashes,
  published_at,
  extractor_contract_version,
  is_current
FROM cds_library.cds_manifests;

ALTER VIEW cds_library.cds_manifest_snapshots OWNER TO cds_library_owner;
REVOKE ALL ON cds_library.cds_manifest_snapshots FROM PUBLIC;
```

In both lateral “latest extraction” subqueries change the final order to:

```sql
ORDER BY x.created_at DESC, x.id DESC
LIMIT 1
```

Retain `latest_error_code`; do not project `error_message`. Reassert owner, revoke
PUBLIC, and grant reader access on every replaced view. Then reassert the complete
five-view grant:

```sql
GRANT SELECT ON
  cds_library.school_profiles,
  cds_library.active_cds_documents,
  cds_library.active_cds_domain_packets,
  cds_library.cds_document_sources,
  cds_library.cds_manifest_snapshots
TO cds_library_reader;
```

If the pipeline migration runner requires a rollback, add
`migrations/0004_reader_contract.rollback.sql` that restores the original view column
sets/order and original latest ordering. This migration is reversible because it does
not destroy data.

### 1A.2 Contract tests

Add/extend the pipeline migration and live-reader tests to prove:

- exactly one snapshot has `is_current=true`;
- that row exposes `extractor_contract_version` and its value matches
  `content->>'extraction_contract_version'`;
- a reader can select all columns of exactly the five views;
- the reader cannot select `cds_library.cds_manifests`, `schools`,
  `cds_domain_packets`, `cds_documents`, or `cds_extractions`;
- the latest status and safe error code come from the same deterministically selected
  extraction when timestamps tie;
- current-domain left joins still return a row with `packet IS NULL`;
- separate academic years remain separate rows;
- applying and rolling back 0004 does not alter base-table counts or hashes.

Use a temporary LOGIN member of `cds_library_reader` for the positive/negative test;
`SET ROLE` under an owner is not sufficient proof of login permissions.

### 1A.3 Exit gate

Run pipeline tests with operator env disabled for settings-default tests:

```bash
uv sync --extra test
uv run pytest
```

Apply 0004 to a disposable clone first, then the live development DB. Capture the five
view schemas and the current-row query in `artifacts/db-rewire/`.

## 1B. Extraction contract v8 and manifest 5.0.0

This is one coordinated publication. Do not publish a manifest whose provider schema,
packet builder, domain hashes, and runtime version disagree.

### 1B.1 One runtime version source

In `library/manifest.py`:

```python
EXTRACTION_CONTRACT_VERSION = "8"
```

The extractor continues deriving:

```python
EXTRACTOR_VERSION = f"gemini-routed-extraction-v{EXTRACTION_CONTRACT_VERSION}"
```

Set `config/cds/manifest.yaml` to version `5.0.0`, contract `8`, and the exact
extractor identifier `gemini-routed-extraction-v8`. Remove or rewrite any
documentation-only `7.0.0` record so no checked-in asset claims that packet identifier.
Do not introduce another runtime constant.

### 1B.2 Implement `not_in_template_version`

Extend the extractor `Finding.availability_status` and generated provider schema with:

```text
not_in_template_version
```

Pin its semantics in the extraction prompt and tests:

- use it only when visible table/header structure proves the configured row or column
  does not exist in that school's CDS template edition;
- absence of a value, blank cell, failed OCR, missing routed page, or a model's failure
  to find it is not proof;
- require page evidence and enough header/table excerpt to substantiate the structural
  absence;
- store `value=null` and `raw_value=null`;
- preserve the finding as `extraction_status="verified"` and
  `availability_status="not_in_template_version"` with evidence;
- do not reinterpret old `not_extracted` packets or missing metrics as this state;
- retain existing found-only handling for `not_reported` in v8 unless a separately
  evidenced source-state finding is intentionally accepted by the current builder.

The typed value function must explicitly accept the new state and return null typed/raw
values. Packet counts still count it as verified because the source-state assertion is
verified; Counselle decides that it is unavailable, not a value.

Test every provider state:

| Extraction state | Availability | Value/evidence result |
|---|---|---|
| verified | reported | typed value + evidence |
| verified | not_reported | unavailable; preserve evidence where legacy packet has it |
| verified | not_applicable | unavailable + evidence |
| verified | suppressed | unavailable + evidence |
| verified | not_in_template_version | unavailable + distinct evidence-backed status |
| not_extracted/conflict/invalid | null | no student value; diagnostic internal only |

### 1B.3 Add machine-readable vintage binders

Add an optional `context_bindings` list at each target domain's authoring root. This
supports same-domain binders and existing cross-domain instructions such as
`identity.academic_year`.

```yaml
context_bindings:
  - id: c1_entering_class
    label: "entering class"
    binders:
      - first_year_admission_entry_term
      - first_year_admission_entry_year
    targets:
      source_hints: [C1]
      metric_id_prefixes: [applicants_, admitted_, enrolled_]
```

Cross-domain binders are explicitly qualified:

```yaml
context_bindings:
  - id: cds_edition
    label: "CDS edition"
    binders: [identity.academic_year]
    targets:
      source_hints: [F2, F3]
```

Supported target selectors are exactly `all`, `source_hints`, `metric_ids`,
`metric_id_prefixes`, and `period_kinds`. Rules:

- `all:true` is exclusive; otherwise at least one selector is required;
- selector dimensions combine with AND and values within one dimension with OR;
- `metric_ids` is preferred for irregular grids; prefixes are used only for genuinely
  stable matrix families and the expanded set is reviewed;
- targets are in the domain that owns the binding;
- local binder refs qualify to that domain; cross-domain refs must be qualified;
- context `id` compiles to `<target_domain>.<id>`;
- empty/unmatched selectors, unknown target IDs/hints/prefixes/periods, unknown binder
  refs, duplicates, self-targeting, or context cycles fail compilation;
- a binder remains a normal metric; context use is the relationship, not a second
  manually maintained `context_only` flag.

Resolve relationships in a second compiler pass after every domain is canonicalized,
so cross-domain refs can be validated. Materialize on each compiled target metric:

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

Target IDs and binder refs are fully qualified. Order contexts by authoring order and
refs by global manifest order. Derived `contexts` participates in semantic domain/root
hashing; Counselle never parses `instructions` or reverses selectors.

Annotate all currently identified context groups in the domain YAMLs, including:

- admissions C1 entry term/year, C8A testing term/year, C21 early-decision term/year;
- class-profile C9 term/year for C9–C12 fall-term values;
- class-size I-2 and I-3 reporting terms separately;
- cost reporting academic year;
- degrees reporting-window start/end;
- enrollment B1/B2 snapshot term/date;
- faculty I-1 reporting term;
- financial-aid aid year/status, graduating-class year, and H4/H5 award window;
- outcomes B3 window, primary/comparison bachelor cohorts, two-year equivalents, and
  B22 entering/follow-up terms;
- student-life F1 term/year;
- transfer D2 entry term/year.

For every annotation, add a compiler golden asserting the complete expected target set
and a nearby unintended metric. Include a cross-domain `identity.academic_year` case.
Review the compiled 5.0.0 manifest diff; a domain reviewer confirms every expanded
target/ref relationship rather than accepting selectors or hashes alone.

### 1B.4 Preserve qualified metric IDs

Current compiled manifests and packets already use qualified metric keys. Retain that
behavior and strengthen tests:

- authoring YAML ID: `applicants_men`;
- compiled/packet ID: `admissions.applicants_men`;
- a target's compiled `contexts[*].refs` contains qualified refs;
- prefixing is idempotent only inside compiler-controlled authoring conversion; a
  double-qualified or cross-domain ID is rejected.

Do not change packet output back to flat IDs merely to match the illustrative JSON in
the design. Counselle's boundary will validate the actual qualified contract.

### 1B.5 Publish and re-extract

1. Compile 5.0.0 and review the full semantic diff, counts, group constraints, schema,
   domain hashes, and root hash.
2. Publish it as a new immutable manifest; never update 4.0.0 in place.
3. Run deterministic provider/builder tests for the new availability state.
4. Re-extract every currently active document with v8/5.0.0 and promote accepted
   packets. Do not mix new manifest definitions with old packet interpretation.
5. Confirm all selected latest documents have a v8 request outcome, and record any
   accepted legacy packets that remain active.
6. If a real source visibly lacks a configured row/column, confirm at least one
   evidence-backed `not_in_template_version` packet. If no source truthfully qualifies,
   do not fabricate one: the deterministic fixture remains the acceptance proof and
   the live eval case stays skipped with a recorded reason until such a document lands.
7. Recompute the live contract signature: manifest version/contract/hash, domain and
   metric counts, packet status/version counts, PDF/profile hashes, coverage by school.

Bulk extraction remains outside this phase. Re-extracting the three current active
documents is required because the consumer cannot validate the new state/binders
against packets that never used the contract.

## 1C. Documentation and acceptance

Update live pipeline docs—`README.md`, `docs/architecture.md`,
`docs/reference/db-schema.md`, `docs/reference/config.md`, and extractor/manifest
reference docs—with:

- the appended manifest-view columns;
- contract 8 / manifest 5.0.0;
- qualified persisted metric IDs;
- `not_in_template_version` evidence semantics;
- compiled `context_binders`;
- the fact that error codes, not raw messages, are the reader surface.

Do not edit historical `specs/` or `plans/` narratives. Update the untracked proposed
bulk spec's future migration number only when it is promoted to live work; preserve it
during this phase.

Before Phase 2 code starts, fully rewrite Counselle `docs/DATABASE_GUIDE.md` against the
landed five-view/5.0.0/v8 contract using the content checklist in
`05-guidance-evals-docs.md` §6.5. This is the implementation contract, not a late
documentation cleanup. Phase 6 later reconciles it with the shipped code and examples.

Phase 1 is complete only when:

- pipeline tests pass independent of real `.env` defaults;
- the reader selects one authoritative current manifest and still only five views;
- manifest 5.0.0 and extractor v8 agree everywhere;
- compiled targets expose validated qualified context objects/binder refs;
- v8 packet tests cover every availability/extraction state;
- current documents have been reprocessed or a written accepted-packet exception is
  reviewed;
- the new `docs/DATABASE_GUIDE.md` is reviewed against live view columns and packets;
- Counselle can obtain the entire required contract without a base-table grant.
