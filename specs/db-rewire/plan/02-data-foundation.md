# Phase 2 — Counselle data foundation and four-tool surface

## Mission

Replace the old wide-field data layer with a manifest/profile/packet reader behind the
existing Catalog/service/MCP seams. At the end of this phase all internal consumers can
read the new DB, the MCP advertises exactly four DB tools, and no old data helper is
reachable. Citations/rendering are completed in later phases, but the typed result
models and reading rules are established here.

## Read first

- `specs/db-rewire/design.md` §§2–6, 10, 13, 15.
- `docs/adr/0017*`, `0018*`, `0019*` and current `docs/DATABASE_GUIDE.md` as historical
  context only.
- All files under `counselle_db/`; `config/settings.py`; `app/deps.py`, `toolset.py`;
  `app/workspace/service_utils.py`, `service_reference.py`; `adapters/tavily_tools.py`;
  `api/main.py`, `api/routes/system.py`; all directly corresponding tests.
- The live Phase 1 five-view schemas and manifest 5.0.0 payload. Do not implement
  against the illustrative packet JSON in the design.

## 2.1 Settings: the single home of tunables

Remove `embed_model`, `embed_dimensions`, `reconcile_interval_minutes`, and
`vector_search_enabled`. Update the app-DSN comment to sessions/users/workspace, not
embeddings. Add validated settings with these exact meanings:

```python
data_catalog_refresh_seconds: int = 3600       # gt=0
supported_packet_extractor_versions: frozenset[str] = frozenset({
    "gemini-native-pdf-v2",
    "gemini-native-pdf-v5",
    "gemini-routed-extraction-v7",
    "gemini-routed-extraction-v8",
})
viz_max_cells: int = 600                       # gt=0
source_evidence_max_items: int = 50            # gt=0
db_row_cap: int = 500                          # keep the existing Settings name/default
query_database_max_bytes: int = 262_144        # gt=0; serialized JSON result ceiling
```

If the row cap already has a Settings name, keep it instead of adding a duplicate. The
300-character source excerpt cap already exists; move it to Settings only if it is not
currently named once. Update `.env.example` and `app/toolset.py`'s MCP child allowlist.
The DB child receives only the RO DSN, pool/timeout, catalog/version, query-limit, and
logging variables it actually uses; remove APP DSN, model credentials, embedding, and
reconciler variables from that child.

Validate extractor identifiers as nonempty exact strings. Settings parses an env CSV
into a frozen set once; code never splits it again.

## 2.2 Add `counselle_db/packets.py`: the anti-corruption seam

This module imports no pipeline code. It owns strict Pydantic models for the view row,
packet, metrics, evidence, manifest domain/metric definitions, and normalized read
result. Use `ConfigDict(extra="forbid", frozen=True)` for Counselle-owned normalized
models. Parse the raw packet by first removing only the known `provider_contract` key;
validate that the removed value is an object or null, then discard it permanently.

### 2.2.1 Required normalized shapes

The exact names can follow local conventions, but the serialized service result must
carry this information:

```python
class PacketEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    page_number: int = Field(ge=1)
    excerpt: str = Field(min_length=1)
    section: str | None = None
    row_label: str | None = None
    column_label: str | None = None

class ParsedMetric(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    ref: str                         # already-qualified key, validated not minted
    extraction_status: Literal["verified", "not_extracted", "conflict", "invalid"]
    availability_status: Literal[
        "reported", "not_reported", "not_applicable", "suppressed",
        "not_in_template_version"
    ] | None
    value: JsonValue | None
    raw_value: str | None
    evidence: PacketEvidence | None
    diagnostic_code: str | None     # internal/log-only

class ManifestContext(BaseModel):
    id: str
    label: str
    refs: tuple[str, ...]

class ManifestMetric(BaseModel):
    ref: str
    description: str
    type: Literal["integer", "number", "string", "boolean", "enum"]
    unit: str | None
    population: str | None
    denominator: str | None
    definition_variant: str | None
    period_kind: str | None
    source_hints: tuple[str, ...]
    contexts: tuple[ManifestContext, ...]
```

Represent packet status, counts, extractor/model/version/document identifiers, and the
complete manifest domain ordering too. Do not add a hardcoded domain Literal.

### 2.2.2 Parse the complete view row

The parser accepts the `active_cds_domain_packets` row plus selected-document metadata,
not just `row["packet"]`. Normalize every bytea once with:

```python
def hex_digest(value: bytes | bytearray | memoryview) -> str:
    return bytes(value).hex()
```

Reject the whole packet with a typed `ServiceError` if any invariant fails:

- exact extractor identifier is not in Settings;
- packet domain differs from row domain;
- a metric key is bare, double-qualified, or has another domain prefix;
- packet year differs from row year;
- extraction UUID differs from the row UUID string;
- manifest version differs from the row;
- accepted packet status differs from packet status;
- packet document/domain hashes differ from normalized view hashes;
- a metric status/value/evidence combination is impossible;
- recomputed status counts differ from packet counts;
- current manifest/snapshot needed to interpret the packet is absent.

For `current_definition_match=false`, interpret label/type/unit/binders against the
immutable manifest snapshot whose version equals the packet's version, then attach the
definition-drift caveat. Never apply current definitions to an old packet. Catalog
therefore retains all manifest snapshots, indexed by version, and one current pointer.

Log a stable internal error code, school, document, domain, version, and extraction id.
Do not log packet JSON, excerpts, provider contract, raw error messages, or diagnostics.
Surface only an honest D6 error such as “Stored CDS data for this domain uses an
unsupported/inconsistent contract; no values were returned.”

### 2.2.3 Reading-rule function

One pure function combines parsed metric + manifest definition + document metadata +
catalog caveat renderer into a normalized value. Pin these rules:

1. Available iff status is `verified`, availability is `reported`, typed value is
   non-null, and evidence exists.
2. Verified `not_reported`, `not_applicable`, `suppressed`, and
   `not_in_template_version` are unavailable; preserve their evidence internally and
   use the last state as its own caveat kind.
3. Other statuses are unavailable. `diagnostic_code` is logs-only.
4. Packet `partial`, definition mismatch, and stale edition attach independent caveats.
5. For each target's compiled context object, read its binder refs from the same
   selected document, append `label: verified display(s)` to the edition vintage in
   manifest order, and omit a context whose binders are missing/unavailable. Never
   invent context. Cross-domain refs are allowed and pass through the same packet seam.
6. Comparison mismatch is attached by the render resolver, after multiple schools are
   known.

Display formatting is deterministic and generic:

- prefer nonblank `raw_value` verbatim after outer whitespace trim;
- integer fallback: grouped decimal (`8,842`);
- finite number fallback: normalized decimal without exponent or gratuitous trailing
  zeros; never multiply based on a percent-like unit;
- boolean: `Yes` / `No`;
- enum/string: exact trimmed string;
- non-finite float, object/array for a scalar metric, or type mismatch fails the packet.

Use manifest `description` as the label; all current 1,149 metrics lack `title` and
underscore humanization would erase meaning. The packet parser is the sole validator
of qualified metric refs; downstream code never constructs them by concatenation.

### 2.2.4 Tests

Add `tests/counselle_db/test_packets.py` and
`tests/counselle_db/test_reading_rules.py`. Use frozen fixtures for v2/v5/v7/v8 and
property/table tests for every invariant/state combination. Assert input objects remain
unchanged, provider contract never appears in repr/dump, hashes normalize correctly,
old-manifest interpretation works, binders order correctly, percentage-looking raw
values are not scaled, simultaneous caveats survive, and failures return zero values.

## 2.3 Replace `Catalog` with one immutable snapshot

Keep public seams `Catalog.load(pool)`, `maybe_refresh()`, `school_name(unitid)`, and
`school_domain(unitid)` so workspace/steps do not fork their own caches. Replace all
mutable field/decode/calendar state with one frozen `CatalogSnapshot` swapped atomically
after a successful reload.

The snapshot contains:

- `refreshed_at` from the successful transaction, and separate last-attempt time;
- current manifest version/hash/contract/published time;
- every manifest snapshot by version;
- domains in manifest order and metric definitions/ref indexes in manifest order;
- total current metrics and per-domain counts;
- school rows indexed by unitid, plus normalized search-name/alias index;
- object-valued profile group names and profile snapshot date range;
- selected-document coverage per school and ambient aggregates.

### 2.3.1 Atomic load SQL

Load in one RO `REPEATABLE READ`, read-only transaction with schema-qualified view
names. Require:

- at least one profile;
- exactly one current manifest;
- manifest root/domain/ref uniqueness and valid compiled binder refs;
- profile IDs/names/search names valid;
- no duplicate selected document per school after the selector.

Select editions once:

```sql
WITH selected_documents AS (
  SELECT DISTINCT ON (school_id) *
  FROM cds_library.active_cds_documents
  ORDER BY school_id, academic_year DESC, document_id DESC
)
...
```

Derive current-manifest usable/partial counts by joining the selected document identity
to `active_cds_domain_packets`; do not trust an older packet count after a manifest
change. Aggregate definitions:

- `covered`: at least one current-domain row with non-null accepted packet;
- `fully`: accepted count equals current manifest domain count and partial count is 0;
- `partial`: covered and not fully;
- `stale`: covered selected document has `currentness='stale'`;
- `by_year`: covered selected documents grouped by academic year.

Resolve per-school document/status live in `resolve_school`, rather than relying solely
on an hourly snapshot; the cache's aggregate staleness is allowed, per-school truth is
not.

### 2.3.2 Refresh behavior

- initial load failure fails startup;
- every prepare node calls `maybe_refresh()`;
- before cadence expiry return the existing snapshot without I/O;
- periodic refresh constructs all locals, validates, then performs one reference swap;
- periodic failure retains prior snapshot and its original truthful `refreshed_at`;
- record a separate failed-attempt timestamp to avoid hot-loop retrying;
- an unknown domain forces one immediate refresh/retry before returning the current
  valid-domain list.

Cadence comes only from Settings. Do not hardcode a ten-minute retry. A simple rule is
that failed attempts retry no sooner than `min(refresh_seconds, 300)`; if this is kept,
name `300` as a Settings value or use the full refresh cadence to avoid another knob.
Prefer the full cadence for KISS.

### 2.3.3 School resolution without pg_trgm

The pipeline does not install `pg_trgm` and has only 2,746 profiles. Do not call
`similarity()`. Resolve in this order:

1. numeric unitid exact;
2. normalized canonical name/alias exact;
3. normalized prefix/substring candidates;
4. deterministic Python fuzzy score over the cached name/alias index.

Use the existing normalization/abbreviation asset only where it still adds value; main
campus sorts before branches, then score descending, canonical name, unitid. Pin score
and ambiguity thresholds once in the Catalog/service module or Settings if operators
would tune them. Return candidates rather than guessing across close campuses.

## 2.4 Replace `counselle_db/models.py`

Keep `ServiceError`, resolution status variants, `SchoolBasics` (for workspace), and a
bounded `QueryResult`. Delete field/dossier/program/benchmark/diversity/tier/find
models. Add frozen typed models for:

- `SchoolCoverage`: selected year/document currentness, stale reason, current-manifest
  usable/partial counts, usable domain IDs in manifest order, latest status/error code;
- `ResolvedSchool` and candidate response;
- `ProfileGroupResult` with recursive leaf envelopes and profile metadata;
- `DomainResult` with packet/document metadata, rows in manifest order, and
  availability summary `{configured,verified,not_in_template_version}`;
- safe query rows/metadata.

No model exposes provider contract, PDF bytes, raw extraction error messages, or
diagnostic codes.

## 2.5 Replace service layer with four public DB tools

Keep internal `search_school_names()` because workspace typeahead uses it. The MCP
public service set is exactly:

```python
resolve_school(catalog, query)
get_school_profile(catalog, unitid, groups=None)
get_domain(catalog, unitid, domain_id)
query_database(catalog, sql, params=None)
```

### `resolve_school`

- validate a nonblank bounded query;
- use the Catalog resolver;
- fetch the selected document and current-manifest domain rows live;
- return `match|candidates|not_found`;
- include canonical name/unitid/city/state/domain and the complete coverage block;
- keep safe error code only;
- distinguish “active document, zero usable domains” from “no active document.”

### `get_school_profile`

- resolve the school by exact unitid; never accept a model-supplied user identity;
- dynamically derive valid groups from object-valued `basic_profile` roots;
- unknown group returns the live valid list;
- recursively walk leaves in stored order; canonical ref is `group.path.to.leaf`;
- typed profile columns supply school metadata; profile JSON supplies leaf values;
- find matching provenance receipt by the same path;
- generic display: null unavailable, bool Yes/No, finite numbers normalized, strings
  exact, lists joined with `, `, no whole dict emitted as a cell;
- every available leaf gets a profile citation with unitid/profile SHA/version/date and
  a `profile_snapshot` caveat;
- label comes from provenance/source column metadata if available, otherwise readable
  final path segment; do not add a hand-maintained profile label map.

### `get_domain`

- validate domain against refreshed manifest, with one forced refresh on miss;
- use the selected newest document and exactly that domain row;
- no older-year fallback;
- derive distinct binder-domain IDs from the target domain's compiled contexts and
  fetch those rows for the same selected `document_id` in one batched internal query;
  parse every binder packet through `packets.py`, but return only the requested
  domain's rows;
- parse through `packets.py` only;
- return configured metrics in manifest order, including explicit unavailable rows;
- compact agent row includes ref, label, display/availability, marker added later, and
  caveat kinds; excerpts remain out of the tool payload;
- summary text is rendered from caveat/catalog wording: `N of M metrics verified`,
  with template-version absences separate;
- packet absent/null returns status/outcome/safe code and zero values honestly.

### `query_database`

Preserve the existing proven guard but tighten it:

- one statement starting SELECT/WITH; reject comments/multiple statements, writes,
  volatile/admin functions, COPY, and catalog escapes;
- relation allowlist is exactly the five schema-qualified view names; reject unqualified
  relations so `search_path` cannot redirect them;
- placeholders are contiguous `$1..$n`, match params exactly, and values are passed
  separately to asyncpg;
- apply statement timeout, row cap, and serialized result-byte cap;
- if any returned value is bytes/memoryview, fail the result and advise selecting
  metadata such as `octet_length(pdf_content)`; never base64 PDF bytes to the model;
- remove old decode hints;
- include `as_of`, row count, truncation, and a warning that raw rows bypass typed
  normalization and student-facing named values must be re-fetched through typed reads.

Document SQL as a candidate/aggregate analysis path. It cannot fabricate per-document
citations. If an aggregate is spoken, require the computed-as-of attribution and
coverage denominator caveat defined in the overview.

## 2.6 Thin MCP and runtime consumers

Rewrite `counselle_db/server.py` to register exactly the four wrappers. Preserve
lifespan/catalog loading, D6 safe errors, tool docstrings beside wrappers, and overflow
middleware. Remove vector probing/capability flags.

Update:

- `app/deps.py`: keep two pools and Catalog load; no reconciler.
- `api/main.py`: delete `ReconcilerState`, one-shot/forever tasks, state, and cleanup.
- `api/routes/system.py`: delete `/v1/admin/reconcile`; remove health reconciler data.
- `adapters/tavily_tools.py`: replace deleted `get_values` use with
  `Catalog.school_domain()`/official domain; update Citation construction in Phase 3.
- `app/workspace/service_utils.py`: select `id AS unitid,name,city,state,official_domain`
  from `cds_library.school_profiles` through the RO pool; no raw `FROM schools`.
- `app/workspace/service_reference.py`: read test policy through the admissions domain
  result and compiled binder context. Keep this reference path fused to the service,
  not a hardcoded SQL/normalization helper.
- `domain/urls.py`: update old field-name comments only.
- `scripts/mcp_smoke.py`: assert exact tool names and exercise resolve/profile/domain/
  parameterized query dynamically from current data.
- `scripts/setup_db.sql`: fully rewritten in Phase 7; remove old grants now only when
  the coordinated ops branch is ready.

Delete code:

- `counselle_db/search_fields.py`, `reconcile.py`, `service_find.py`, `static_map.py`;
- `adapters/embeddings.py`;
- `domain/normalize.py`, `vintage.py`, `tiers.py`;
- `scripts/gen_static_map.py`, `scripts/embed_smoke.py`.

Delete their direct tests; do not delete unrelated Hypothesis/model dependencies still
used elsewhere. Replace brittle `test_school_columns.py` with semantic view/model tests.

## 2.7 Migration 0012

Add `migrations/0012_drop_old_db_objects.sql`:

```sql
-- Retire old-reader helpers and vector index after DB rewire.
-- depends: 0011_school_workspace

DROP FUNCTION IF EXISTS counselle.decode_ipeds(text, text, text);
DROP FUNCTION IF EXISTS counselle.value_vintage(integer, text);
DROP TABLE IF EXISTS counselle.field_index;
```

Add `0012_drop_old_db_objects.rollback.sql` that raises an explicit exception:

```sql
DO $$
BEGIN
  RAISE EXCEPTION USING
    MESSAGE = '0012 is not SQL-reversible: retired helpers depend on the old database',
    HINT = 'Stop Counselle and restore the pre-cutover DSNs/old database per the db-rewire rollback runbook.';
END
$$;
```

Do not edit applied migration bodies 0002/0003. Update the 0009 comment only if policy
permits comments in applied migrations; otherwise explain vestigial pg_trgm in the new
ADR/docs and leave the historical file byte-identical.

## 2.8 Phase exit gate

Required targeted tests:

- packet/parser and reading rules;
- catalog atomic refresh/stale fallback/forced domain refresh;
- resolver exact/alias/ambiguous/not-found without pg_trgm;
- profile dynamic groups/provenance/snapshot caveat;
- multi-year selected-document consistency across resolve/domain/coverage;
- domain missing/partial/drift/stale/unsupported/inconsistent paths;
- query guard, bytea rejection, row/byte caps, placeholder safety;
- four-wrapper inventory and D6 redaction;
- workspace/typeahead/Tavily consumers;
- reconciler route/task absence;
- migration 0012 catalog assertions.

Then run:

```bash
uv run pytest -m "not live_llm and not live_search and not live_db"
uv run ruff check .
uv run mypy .
uv run pytest -m live_db
```

The live suite uses only the new five-view login. It derives schools/domains/refs from
the current manifest rather than pinning Harvard/Yale as permanent catalog facts.
Phase 2 is not complete until the MCP inventory is exactly four and representative
base-table queries fail under `COUNSELLE_DB_RO_DSN`.
