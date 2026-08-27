# Recon: old `counselle-data-pipeline` CDS engine (being replaced)

Source repo: `/home/saifuddin/Projects/counselle-data-pipeline` (read-only recon; nothing in that repo was modified).

This is the single source of truth for porting the **data schema** (what gets extracted from every
CDS) and understanding the old **extraction engine** and **DB contract** well enough to build a
replacement inside the Counselle app.

---

## 1. The data schema — `config/cds/` (MOST IMPORTANT)

### 1.1 File inventory

```
config/cds/manifest.yaml            # root: version, extraction_groups, page_routing_enabled
config/cds/extraction-prompt.md     # the one shared system prompt (verbatim below)
config/cds/extractor-version.yaml   # pinned extractor/contract identity (verbatim below)
config/cds/domains/*.yaml           # 13 domain files, the actual metric definitions
```

### 1.2 Per-domain metric count table

Counted directly from the YAML (`- id:` block-style entries, or `{id: ...}` flow-style entries for
`enrollment.yaml`, which is authored in flow style — see the critique in §5 for why that
inconsistency matters).

| Domain file | id | # metrics | has `context_bindings` | lines |
|---|---|---:|:---:|---:|
| `academics.yaml` | `academics` | 34 | no | 725 |
| `admissions.yaml` | `admissions` | 152 | yes | 2613 |
| `class_profile.yaml` | `class_profile` | 127 | yes | 2323 |
| `class_size.yaml` | `class_size` | 22 | yes | 617 |
| `cost.yaml` | `cost` | 47 | yes | 801 |
| `degrees.yaml` | `degrees` | 129 | yes | 4039 |
| `enrollment.yaml` | `enrollment` | 134 | yes | 277 (flow-style, one metric per line) |
| `faculty.yaml` | `faculty` | 31 | yes | 766 |
| `financial_aid.yaml` | `financial_aid` | 169 | yes | 3496 |
| `identity.yaml` | `identity` | 50 | no | 809 |
| `outcomes.yaml` | `outcomes` | 114 | yes | 2444 |
| `student_life.yaml` | `student_life` | 63 | yes | 1273 |
| `transfer.yaml` | `transfer` | 77 | yes | 893 |
| **Total** | | **1149** | 11/13 domains | 21,076 |

`identity.yaml` carries the document-level metric `identity.academic_year` — the CDS edition label
that every other domain's *own* period-context metrics explicitly refuse to fall back to (a
recurring instruction pattern: "do not substitute the CDS edition academic_year for this
item-specific period").

### 1.3 Metric YAML shape — every allowed key

From `manifest.py`'s `_METRIC_ALLOWED` / `_REQUIRED_METRIC_KEYS`:

```
id                 required, snake_case, unique within domain (authoring-local; compiled to
                    "<domain_id>.<id>", see §2)
title               optional, presentational only — stripped before hashing/packets
                    (_NON_SEMANTIC_METRIC_KEYS = {"title"})
description         required, free text
type                required, one of: integer | number | string | boolean | enum
unit                required, one of a closed vocabulary (~34 values): applicants, awards,
                    boolean, carnegie_units, category, count, credits, date, email, faculty,
                    gpa, percent, ratio, score, sections, students, text, url, usd, weeks,
                    years, academic_year, source_unit_value, ...
population          required, one of a closed vocabulary (~50 values) describing the exact
                    cohort the metric counts (e.g. first_time_first_year,
                    enrolled_first_time_first_year_sat_submitters,
                    undergraduate_class_sections, ...)
denominator         required, one of a closed vocabulary (~40 values) — "none" for raw
                    counts, or the named population the metric is a share/rate of
                    (e.g. sat_composite_submitters, associate_conferred_majors)
definition_variant  required, one of: availability | average | capacity | deadline | derived |
                    estimated | maximum | minimum | percentile_25 | percentile_50 |
                    percentile_75 | policy | printed | published | rate | recommended |
                    reported | required | selected | selected_list | share | total
period_kind         required, one of: academic_year | admission_cycle | aid_year |
                    cohort_year | cost_year | degree_window | document | fall_term | policy |
                    reporting_cycle
source_hints        required, nonempty list of strings — literal CDS item labels printed in
                    the document (e.g. ["C9"], ["G0"], ["I-3"], ["cover page", "A1"]). Used
                    both as page-routing search terms and as the section-boundary framing in
                    the extraction prompt.
instructions        required, free text — the actual per-metric extraction guidance sent to
                    the model verbatim (see examples below)
enums               only for type: enum — nonempty list of unique lowercase-ID strings
formula             optional — {operation: ratio|sum|difference, inputs: [metric_id, ...]}
                    for DERIVED metrics only (rare; validated as an acyclic dependency graph
                    across the whole manifest, see §2). Formula metrics are excluded from the
                    provider schema (never sent to the model — computed, not extracted).
```

No `availability` rules live in the metric YAML itself — availability is a *response-time*
concept (`availability_status`, see §3), not an authoring-time one. The authoring-time signal
closest to "does this exist on the form" is `source_hints` (where to look) plus prose in
`instructions` telling the model when a row is `not_in_template_version`.

### 1.4 Three full verbatim metric examples (different shapes)

**Boolean checklist item** (`academics.yaml`):
```yaml
- id: special_study_accelerated_program
  description: Accelerated program identified as available in E1.
  type: boolean
  unit: boolean
  population: institution
  denominator: none
  definition_variant: availability
  period_kind: academic_year
  source_hints: [E1]
  instructions: >-
    Bind this metric to the CDS edition reported by
    `identity.academic_year`; do not substitute an item-specific period.
    Harvard 2025-26 and Yale 2024-25 both label this E1 row exactly
    "Accelerated program". Extract that row only.
    Emit true only when the box is visibly checked; emit false only when
    the complete E1 checklist is visible and this box is unambiguously
    unmarked. A row absent from this form version is
    not_in_template_version, never false. Do not infer availability from
    any other major, service, or policy described elsewhere in the CDS.
```

**Integer count bound to a context metric** (`admissions.yaml`):
```yaml
- id: applicants_men
  description: "Men among degree-seeking first-time first-year applicants, per C1."
  type: integer
  unit: applicants
  population: first_time_first_year
  denominator: none
  definition_variant: total
  period_kind: fall_term
  source_hints: [C1]
  instructions: >-
    Extract C1 row "Total first-time, first-year men who applied" (Yale)
    or "Total first-time, first-year males who applied" (Harvard) at the
    "TOTAL" column, bound to first_year_admission_entry_term and
    first_year_admission_entry_year.
    The C1 gender block prints no additional overall-total response;
    never sum the four gender rows to derive one. Keep separate from
    women, another-gender, and unknown-gender counts.
```

**Percentage as a string (qualifier-preserving) + enum example**, both from `admissions.yaml`:
```yaml
- id: selection_factor_rigor_of_secondary_school_record
  description: "Importance of rigor of secondary-school record in admission decisions, per C7."
  type: enum
  unit: category
  population: prospective_undergraduate
  denominator: none
  definition_variant: selected
  period_kind: policy
  enums: [very_important, important, considered, not_considered]
  source_hints: [C7]
  instructions: >-
    Map the exact visible labels "Very Important" to very_important,
    "Important" to important, "Considered" to considered, and "Not
    Considered" to not_considered. Return exactly one of very_important,
    important, considered, or not_considered, matched to the single
    selected C7 "Rigor of secondary school record" cell. "Considered"
    must never be reported as "important," and a blank cell is
    not_reported, never not_considered.
```
```yaml
# class_profile.yaml — percent kept as STRING type deliberately, to preserve "<1%" qualifiers
- id: sat_submitters_percent
  type: string
  unit: percent
  population: enrolled_first_time_first_year
  denominator: enrolled_students
  definition_variant: share
  period_kind: fall_term
  source_hints: [C9]
  instructions: >-
    Extract the C9 SAT row's "percent submitting" cell exactly as printed,
    preserving any qualifier such as "<1%". Bind to `class_profile_entry_term` and
    `class_profile_entry_year`. SAT and ACT submitter populations overlap; never
    derive one from the other or sum them. ...
```
Recurring authorial rules baked into `instructions` prose across nearly every metric: never
derive/sum/compute a value from siblings, a blank cell is `not_reported` not zero, a printed
zero stays zero, preserve `<1%` and fractional Carnegie-unit precision exactly, and cite the
literal Harvard vs. Yale row-label wording differences (the two schools this manifest was
authored against — see critique).

### 1.5 `context_bindings` — full mechanics

11 of 13 domains declare `context_bindings` at the top of the file, e.g. (`class_size.yaml`):
```yaml
context_bindings:
- id: i2_reporting_term
  label: student-faculty ratio reporting term
  binders:
  - student_faculty_ratio_reporting_term
  targets:
    metric_ids:
    - students_per_faculty
    - ratio_basis_student_fte
    - ratio_basis_faculty_fte
    - undergraduate_supplemental_reported_value
```
Shape (`_CONTEXT_ALLOWED = {id, label, binders, targets}`):
- **`id`** — local authoring id, compiled to `<domain_id>.<id>`.
- **`label`** — human-readable description of what the binder(s) mean.
- **`binders`** — nonempty unique list of metric IDs (local or already-qualified
  `domain.metric`) that themselves carry the printed context value (e.g. a term/year
  string extracted from a section heading like "Fall 2025"). These are ordinary metrics in
  the same domain, not a separate concept — they get extracted like everything else.
- **`targets`** — a selector object choosing which metrics this binding applies to. Exactly
  one of:
  - `all: true` (exclusive — no other keys)
  - or a nonempty combination of: `source_hints` (list of CDS item labels), `metric_ids`
    (explicit local metric IDs), `metric_id_prefixes` (string prefixes), `period_kinds`
    (list from the closed `period_kind` vocabulary).

At compile time (`_compile_contexts` in `manifest.py`) every binder/target reference is resolved
to a fully-qualified metric id, the binder list is sorted into global manifest metric order, a
binding may never target its own binder(s) (`self_targets` check), every referenced ID must
exist, and a global cycle check runs across all context dependencies (metric → binder chains)
using the same visiting/visited DFS pattern as the formula-DAG check. The compiled result is
attached directly onto each selected metric as `metric["contexts"] = [{id, label, refs}, ...]`
(one entry per binding that targets it) — so a packet's metric definition, embedded in
`provider_contract`, carries its own binding refs; the model never has to infer scope from
prose alone, though the *values* of the binder metrics still have to be independently extracted
and cross-referenced by the consumer.

This is the single most valuable structural device in the schema to port: it lets a huge sheet
of "count of X for gender Y" metrics all point at one shared "which entering class/term is this"
metric instead of repeating that context in every row's prose (which they *also* do, redundantly,
in `instructions`).

### 1.6 `manifest.yaml` (root) — verbatim

```yaml
version: "5.0.2"
description: "Evidence-backed source states and compiled metric-context bindings."
page_routing_enabled: true
extraction_groups:
  - [financial_aid, class_size]
  - [admissions, faculty]
  - [enrollment, academics]
  - [degrees, cost]
  - [class_profile, identity]
  - [transfer, student_life]
  - [outcomes]
```
`extraction_groups` must exactly partition all 13 configured domains (validated in
`_validate_extraction_groups`) — every domain appears in exactly one group, whole domains only
(a domain is never split across two model calls). 7 groups ⇒ 7 extraction calls + 1 routing call
= 8 Gemini calls to fully extract one CDS PDF from scratch.

### 1.7 `extractor-version.yaml` — verbatim

```yaml
extractor_version: "gemini-routed-extraction-v8"
extraction_contract_version: "8"
input_scope: routed_page_subset
metric_partition_strategy: configured_domain_groups
routing_call: true
page_pad: 2
max_output_tokens: 65535
input_mime_type: application/pdf
provider_api_version: v1
model_resolution: Settings.cds_extract_model
```
Note: this file is documentation/pinning metadata only — the *actual* runtime constants
(`EXTRACTOR_VERSION`, `MAX_OUTPUT_TOKENS`, `ROUTING_PAGE_PAD`, etc.) are hard-coded in
`extractor.py` and must match this file's values, else `claim_next()` in `queue.py` refuses to
run a queued extraction (`incompatible_extractor_contract` — the code and the pinned manifest
row must agree byte-for-byte on extractor identity before a worker will touch it).

### 1.8 `extraction-prompt.md` — verbatim (the one shared system prompt)

```
You extract only the requested CDS metrics from the supplied PDF document.
Check every requested metric, but return it only when the document contains a visible
institution-provided response value or marker. Leave every metric without a visible response empty.
Ignore Common Data Set Definitions pages and glossary prose. Do not infer missing values. Cite the
exact one-indexed physical PDF page and a short supporting excerpt for every finding.

Use `not_in_template_version` only when visible table or header structure proves that the
configured row or column does not exist in that school's CDS template edition. A blank
cell, absent value, failed OCR, missing routed page, or failure to find the metric is
not proof. For this state return null `value` and `raw_value`, and cite the page with
enough table/header excerpt to substantiate the structural absence.
```

**Strategy**: this file is intentionally tiny — it states the *global* invariants (omission over
inference, cite page+excerpt, definitions pages don't count as evidence, the precise semantics of
`not_in_template_version`). Everything metric-specific lives in each metric's own `instructions`
field instead of one giant prompt; `worker.py` concatenates this prompt with a further large block
of runtime-generated instructions built in `GeminiExtractor.extract_document()` (page framing,
section focus, and a repeated restatement of "never return `not_reported`", "omission is the only
correct way to report absence", etc. — see §4.2 for the full runtime prompt).

---

## 2. Manifest compilation — `library/manifest.py`

**Location**: `/home/saifuddin/Projects/counselle-data-pipeline/src/counselle_data_pipeline/library/manifest.py`

### 2.1 Pipeline (`compile_manifest(config_dir)`)

1. Load `manifest.yaml` with a **strict YAML loader** (`_StrictLoader`) that raises on duplicate
   mapping keys (`_mapping` override) — prevents silent last-key-wins authoring bugs.
2. Validate root has exactly `{version, description, extraction_groups, page_routing_enabled}`.
3. Load `extraction-prompt.md`, require nonblank.
4. Glob `domains/*.yaml` **sorted by filename**, for each: validate `{id, title, metrics}` (+
   optional `context_bindings`), require `domain["id"] == path.stem` (filename must match id),
   reject duplicate domain ids, then `_validate_metric()` every metric against the closed
   vocabularies in §1.3 and require unique metric ids *within* the domain.
5. `_validate_extraction_groups()` — groups must exactly partition the domain id set.
6. `_canonicalize_domains()` — **this is where the qualified-ref rule is applied**: every
   metric's local `id` is rewritten to `f"{domain_id}.{id}"`, and any `formula.inputs` reference
   without a `.` is qualified the same way. This is the *only* place bare local ids get expanded;
   everything downstream operates on qualified ids.
7. `_compile_contexts(authored, canonical)` — resolves and validates every `context_bindings`
   entry against the now-fully-qualified metric index (§1.5), attaches `contexts` onto selected
   metrics, and DFS-checks for binder/target cycles.
8. `_validate_formula_references()` — same DFS-cycle pattern for `formula.inputs` dependency
   chains across the *whole* manifest (formulas can reference metrics in other domains).
9. Compute:
   - **`domain_hashes[domain_id]`** = `sha256(canonical_json({"id", "metrics": [metric minus
     "title" keys], "prompt": <the shared prompt text>, "contract": "8"}))` — i.e. each domain's
     hash is a function of *that domain's* metrics **and** the shared prompt **and** the pinned
     contract version. Changing the prompt changes every domain's hash; changing one domain's
     metrics changes only that domain's hash.
   - **`content_sha256`** = `sha256(canonical_json({"root": <root yaml dict>, "domains": [...],
     "prompt": ..., "extraction_contract_version": "8"}))` over the *entire* compiled content.
   - Canonical JSON = `json.dumps(value, sort_keys=True, separators=(",", ":"),
     ensure_ascii=False)` — deterministic byte-for-byte across runs (reimplement exactly this for
     hash-compatible re-derivation).
   - **`provider_schema`** — one static JSON Schema for the whole model response shape (§3.2),
     built once from *all* non-formula metric ids across every domain (`enum: metric_ids`) — the
     schema is never per-metric; it's one `findings: Finding[]` array shape with `metric_id`
     constrained to the known set.
10. Returns an immutable `CompiledManifest(content, content_sha256, domain_hashes,
    provider_schema)`.

### 2.2 Qualified-ref rule (reimplementation-critical)

- **Authoring** (in the YAML files): bare snake_case ids, unique *within* the domain file only.
- **Compiled** (everywhere else — packets, DB, formulas, context refs, the provider schema
  `enum`): always `<domain_id>.<metric_id>`, e.g. `identity.academic_year`,
  `admissions.applicants_men`. This is enforced by `_FULL_METRIC_ID = r"^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$"`.
- A formula/context reference in the YAML *may* already contain a `.` (cross-domain reference,
  resolved as-is) or be bare (resolved against `domain_id` of the file it's authored in).

### 2.3 Publishing (`publish_manifest`)

Runs inside a single transaction under `pg_advisory_xact_lock(hashtext('cds_library:manifest-publish'))`.
Immutability rule: a given `version` string, once inserted, can never have its `content_sha256`
change (`ManifestError` if a republish attempt has different content under the same version
string — versions are content-addressed by convention, not by DB constraint alone). Exactly one
row has `is_current = true` at a time (partial unique index). Publishing **never** enqueues
extraction work itself — `manifest_diff()` is returned to the operator so they can decide, and
actual re-extraction is a separate explicit `enqueue_bulk` call driven by `derive_requested_domains`
comparing each school-year's currently-active packet `domain_schema_hash` against the new
manifest's `domain_hashes` (§4.3).

---

## 3. The packet v8 output contract — `cds_domain_packets.packet`

### 3.1 Full JSON shape (one packet per `(document_id, domain_id)`, built in
`extractor.py::_packets_from_claims`)

```jsonc
{
  "document_sha256": "…64 hex chars…",
  "academic_year": 2025,
  "extraction_id": "…uuid…",
  "manifest_version": "5.0.2",
  "domain_id": "admissions",
  "domain_schema_hash": "…64 hex chars, from cds_manifests.domain_hashes[domain_id]…",
  "extractor_version": "gemini-routed-extraction-v8",
  "model_id": "gemini-3.1-flash-lite",
  "metrics": {
    "admissions.applicants_men": {
      "availability_status": "reported",
      "extraction_status": "verified",
      "value": 1247,
      "raw_value": "1,247",
      "evidence": {
        "page_number": 6,
        "excerpt": "Total first-time, first-year men who applied ... TOTAL 1,247",
        "section": "C1",
        "row_label": "Total first-time, first-year men who applied",
        "column_label": "TOTAL"
      }
    },
    "admissions.applicants_another_gender": {
      "availability_status": null,
      "extraction_status": "not_extracted",
      "value": null,
      "raw_value": null,
      "evidence": null
    },
    "admissions.high_school_completion_requirement": {
      "availability_status": "not_in_template_version",
      "extraction_status": "verified",
      "value": null,
      "raw_value": null,
      "evidence": {
        "page_number": 4,
        "excerpt": "C3 header shows only two checkbox rows on this edition; no third option row is printed",
        "section": "C3",
        "row_label": null,
        "column_label": null
      }
    },
    "admissions.selection_factor_class_rank": {
      "availability_status": null,
      "extraction_status": "invalid",
      "value": null,
      "raw_value": null,
      "evidence": null,
      "diagnostic_code": "type_mismatch"
    }
  },
  "provider_contract": {
    "requested_domains": ["admissions", "faculty"],
    "allowed_metric_ids": ["admissions.applicants_men", "…"],
    "metric_definitions": [ /* full compiled domain objects sent to the model */ ],
    "response_schema": { /* WindowExtraction.model_json_schema() */ }
  },
  "counts": { "verified": 140, "not_extracted": 8, "conflict": 0, "invalid": 4 },
  "status": "partial"
}
```

### 3.2 Field-by-field contract

- **`extraction_status`** (per metric) ∈ `{verified, not_extracted, conflict, invalid}` —
  computed locally by `_metric_outcome()`, never returned by the model directly:
  - `verified`: exactly one distinct `(availability_status, semantic_value)` outcome across all
    claims for this metric in this run → pick the claim with lowest `(page_number, evidence json,
    claim json)` for determinism.
  - `conflict`: more than one distinct outcome (only possible if a metric is somehow claimed by
    more than one call/finding in the same run — see critique §5, this path is largely unreachable
    in the current single-call-per-group flow).
  - `invalid`: zero valid claims but at least one rejected claim (type mismatch, template-absence
    with a nonnull value, page number beyond the document, or an unallowed/wrong-group metric id).
  - `not_extracted`: zero claims and zero errors — the model simply never mentioned this metric
    (the common "no visible response" case).
- **`availability_status`** (per metric, only present when `extraction_status == "verified"`) ∈
  `{reported, not_reported, not_applicable, suppressed, not_in_template_version}` — but
  **`not_reported` never survives into a packet**: `build_packets_from_results` explicitly drops
  any finding with `availability_status == "not_reported"` before it ever reaches
  `_metric_outcome` ("the prompt forbids this status: a blank cell is an omission, not a claim").
  So `not_reported` exists in the Pydantic/JSON-schema vocabulary the model is allowed to emit, but
  by design it is filtered out server-side and the resulting metric ends up `not_extracted`
  instead — a deliberate two-layer safety net against the model marking blanks as facts.
- **`value`** — typed per the metric's declared `type` (see `_typed_value`): only *lossless*
  coercion is allowed (an integral float like `170.0` may become `170`; nothing else is coerced).
  Any type mismatch → `invalid` with `diagnostic_code: "type_mismatch"`. `null` whenever
  `availability_status != "reported"`.
- **`raw_value`** — the literal printed string as the model transcribed it, kept independently of
  `value` (so a downstream consumer can see e.g. `"11 to 1"` alongside a normalized `value: 11`).
- **`evidence`** — `{page_number (1-indexed, physical, ORIGINAL document page even if a narrowed
  sub-PDF was sent to the model — see §4.2 page-map), excerpt (nonblank, required), section,
  row_label, column_label}` — `section`/`row_label`/`column_label` are all optional/nullable.
- **`diagnostic_code`** — present only on `invalid` metrics; one of `type_mismatch`,
  `template_absence_has_value`, `page_not_in_document`, or an omitted-metric case. This key is
  **absent** (not null) on `verified`/`not_extracted`/`conflict` metrics — Python dict literal, no
  `diagnostic_code` key at all in those branches.
- **`counts`** — `{configured, verified, not_extracted, conflict, invalid}` (a running total is
  also computed across the whole extraction run and stored in `cds_extractions.validation_summary`,
  with additional `scheduled_calls`, `incomplete_calls`, `routed_groups`, `total_groups`, and
  token-usage totals appended by `worker.py`).
- **`status`** (packet-level) — `"validated"` if every configured metric in the domain came back
  `verified` (100% coverage, none missing/invalid/conflicted), `"partial"` if at least one metric
  came back `verified` but not all, `"parse_failed"` if literally zero metrics verified.
- **`provider_contract`** is embedded **verbatim inside every packet** — i.e. the packet is
  self-describing: you can reconstruct exactly what was asked of the model (which domains, which
  metric ids were allowed, the full metric definitions sent, and the JSON schema enforced) without
  needing the manifest row at all. This is a deliberate evidence-completeness choice worth keeping.

This packet shape was reverse-derived from `extractor.py::_packets_from_claims` /
`_metric_outcome` / `_typed_value` plus `tests/test_phase5_extractor.py`
(`test_verifier_enforces_membership_page_type_and_complete_counts`,
`test_not_reported_findings_are_omissions_not_claims`,
`test_template_absence_rejects_a_value`) — no single fixture file contains a ready-made complete
packet, but the fields above are exhaustively confirmed against both the building code and its
tests, not guessed.

---

## 4. The extraction engine — `src/counselle_data_pipeline/`

### 4.1 Module map

```
config.py                  Settings (pydantic-settings): DATABASE_URL (must point at
                            "counselle_data" db, enforced by a validator), CDS_EXTRACT_MODEL
                            (must be a stable id, rejects any "...latest" suffix),
                            EXTRACTION_LEASE_SECONDS, WORKER_POLL_SECONDS, upload/download
                            byte+timeout limits, VERTEX_API_KEY (SecretStr, optional —
                            absence just disables extraction, doesn't crash the app).
db.py                      thin asyncpg helpers (not read in full; small, 143 lines).
cli.py                     `cds-library` console entrypoint (migrate / seed-schools /
                            cds-manifest validate|publish / worker) — 143 lines.
logging.py                 structlog-style configure_logging()/logger.

library/
  manifest.py               §2 above — compile, hash, publish, diff.
  extractor.py               §1.7/§3/§4.2 — Gemini calls, packet building, all pure/testable
                            logic (page routing math, narrowing, typed-value enforcement).
  worker.py                  §4.3 — the one serial worker process: claim → route → extract
                            per group → build packets → complete.
  queue.py                   §4.4 — transactional enqueue/claim/lease/complete/candidate-
                            activation logic; the only writer of cds_extractions /
                            cds_domain_packets.
  documents.py                Immutable PDF upload/validation/slot lifecycle
                            (DocumentStore: add_upload, add_repository, discard_candidate,
                            retire, pdf-by-id). PDF sniffing via puremagic + PyMuPDF page
                            parse before any DB write.
  ct_index.py                 §4.5 — College Transitions repository scrape/search.
  ct_download.py              §4.5 — bounded, SSRF-guarded PDF download/export from the
                            repository into a candidate document.
  http_security.py            SSRF allowlisting helpers (require_google_url,
                            require_college_transitions_url) — not read in full, referenced
                            by ct_index.py/ct_download.py/config.py.
  source_map.py                One-time legacy-export column-classification guard (not part
                            of the live extraction path; exhaustive_at_export coverage +
                            block_seed_promotion policy for a historical data migration).
  profiles.py, spike.py, vertex.py    not read in this pass (school-profile import glue and
                            an apparent early prototype file — flag for follow-up if the new
                            engine needs school-profile seeding logic).

api/
  app.py, ct_routes.py, security.py, upload_guard.py, templates/*.html, static/*
                            Server-rendered HTMX admin UI (not a JSON API) — enqueue/upload
                            routes, CSRF (security.py, 55 lines), upload guard rate/size
                            checks (upload_guard.py, 80 lines). Not deeply read; low
                            relevance to the extraction/schema port, high relevance only if
                            the new admin manager wants a similar HTMX-over-Postgres UI
                            pattern.
```

### 4.2 End-to-end flow (fetch → route → call model → validate → write packets)

1. **Enqueue** (`queue.py::enqueue_slot`/`enqueue_bulk`): locks the target `cds_school_years`
   row(s), locks the current `cds_manifests` row, derives `requested_domains` per school-year via
   `derive_requested_domains(target_kind, manifest_hashes, active_packets)`:
   - `target_kind = "candidate"` (a newly uploaded/downloaded PDF pending review) or
     `"full_reextract"` → **all** domains in the manifest.
   - otherwise (`"active_update"`, i.e. re-checking an already-active PDF against a newer
     manifest) → only domains whose `active_packets[domain] != (current_domain_hash,
     "validated")` — i.e. skip any domain that's already fully verified under the *current*
     manifest's hash. This is the mechanism that makes a manifest republish cheap: only
     semantically-changed domains get re-billed.
   - Refuses to enqueue a `"candidate"` run whose domain set doesn't include `identity`
     (candidate activation always needs identity to gate on, see §4.4).
   - One row inserted into `cds_extractions` with `status='queued'`, `requested_domains` sorted+
     deduped (`is_sorted_distinct_text_array` DB check).
2. **Claim** (`queue.py::claim_next`, called every `WORKER_POLL_SECONDS`=5s by `worker.py::run_worker`):
   `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1` on the oldest `queued` row → flips to `running`,
   sets `lease_expires_at = now() + EXTRACTION_LEASE_SECONDS` (900s). Immediately re-checks that
   the claimed row's pinned `extractor_contract_version`/`extractor_version` match the *running
   code's* constants — a mismatch terminal-fails the run instantly (`incompatible_extractor_contract`)
   rather than attempting extraction with a stale/foreign contract.
3. **Route** (`worker.py::_route_pages`, best-effort, skipped if
   `manifest.root.page_routing_enabled` is false): one Gemini call over the **whole native PDF**
   with a cheap schema (`DocumentRouting`, `ROUTING_MAX_OUTPUT_TOKENS=4096`) asking only for a
   contiguous `(first_page, last_page)` span per requested domain, keyed by that domain's
   `source_hints` labels. Any failure (exception, incomplete finish reason) just yields `{}` — the
   caller then falls back to sending the whole document for every group. A successful routing
   result is padded ±2 pages (`ROUTING_PAGE_PAD`) via `padded_domain_ranges`.
4. **Per extraction group** (7 groups from `manifest.root.extraction_groups`, filtered to the
   domains actually requested this run — a partial re-extraction still respects the *original*
   grouping, it just runs fewer groups):
   - `group_page_clusters()` intersects the group's domains' routed ranges; if *any* domain in the
     group wasn't routed, returns `()` and the **whole document** is sent for that group instead
     (never a partial/wrong-content document — narrowing is strictly an optimization).
   - `_merge_page_ranges()` collapses overlapping/adjacent (gap ≤ 1 page) ranges into disjoint
     clusters.
   - `narrow_document()` uses PyMuPDF (`fitz`) to build a physical-page-order sub-PDF from those
     clusters, and — critically — returns a `page_map: tuple[int, ...]` mapping each position in
     the narrowed document back to the **original** physical page number. `_page_framing()` then
     tells the model explicitly, in the prompt, either "cite physical pages 1–N" (whole doc) or the
     full `position N = original page M` table (narrowed doc) — every citation the model returns is
     always translated back to the *original* PDF's page numbering before it ever reaches a packet.
   - `GeminiExtractor.extract_document()` — one `google-genai` `generate_content` call:
     - `contents = [Part.from_bytes(pdf_bytes, mime_type="application/pdf"), prompt]` — **whole
       native PDF bytes uploaded inline**, not OCR/text-extracted first, not a separate File API
       upload (no caching of shared boilerplate across calls).
     - `config = GenerateContentConfig(temperature=0, max_output_tokens=65535,
       response_mime_type="application/json", response_schema=WindowExtraction,
       http_options=HttpOptions(api_version="v1", timeout=MODEL_TIMEOUT_SECONDS*1000,
       retry_options=HttpRetryOptions(attempts=3)))` — structured-output enforced by the SDK,
       zero temperature, 3 SDK-level transport retries only (no application-level retry/backoff
       beyond that).
     - Prompt = shared `extraction-prompt.md` text + a large runtime block (verbatim, reconstructed
       from `extract_document()`): the JSON-encoded `{allowed_metric_ids, domains: metric
       definitions}` contract, the page-framing sentence, the `_section_focus()` sentence (e.g.
       "Every requested metric in this call is answered in CDS section C, CDS section G; locate
       those sections wherever they appear in the document and ignore all other sections."), and a
       final fixed instruction paragraph repeating: check every allowed metric, omit rather than
       guess, never emit `not_reported` (redundant enforcement — belt and suspenders with the
       server-side filter in §3.2), the `not_in_template_version` bar, and to ignore CDS
       "Definitions"/glossary pages as evidence.
   - Any `finish_reason != "STOP"` (i.e. truncated/incomplete candidate) → the **whole run fails**
     immediately (`IncompleteExtractionError`) rather than accepting a partial JSON response — no
     silent partial-parse tolerance.
5. **Build packets** (`build_packets_from_results` → `_packets_from_claims`, pure functions, no I/O)
   — merges every group's `Finding`s into one `by_metric` map, applies membership/page/type
   validation (§3.2), and emits one packet dict per requested domain.
6. **Complete** (`queue.py::complete_run`) — inside one transaction, re-validates every fence
   before writing anything active: lease still valid & not expired, the school-year's
   active/candidate pointer still equals the claimed `document_id`, the document's `pdf_sha256`
   still matches what was claimed, `manifest_version`/`extractor_version`/`model_id` all still
   match. **Packets are always stored** (even for a run that ultimately gets rejected) — only
   *activation* (flipping `is_active`) is conditional. For `target_kind == "candidate"`, activation
   additionally requires `_candidate_identity_ok()` — see §4.4.

### 4.3 Model / provider / SDK

- **Provider**: Google **Vertex AI Gemini**, via the `google-genai` Python SDK
  (`from google import genai; from google.genai import types`), `genai.Client(vertexai=True,
  api_key=settings.vertex_api_key)`.
- **Model id**: configurable (`Settings.cds_extract_model`, default `gemini-3.1-flash-lite` in both
  `.env.example` and `docker-compose.yml`), but a validator rejects any id ending in `latest` —
  pinned/stable model ids only, presumably so `extractor_version`/`model_id` stay meaningfully
  reproducible per packet.
- **Two call types per extraction run**: 1 routing call (whole PDF, cheap schema, 4096 max output
  tokens) + up to 7 extraction calls (one per requested domain-group, native PDF or narrowed
  sub-PDF, 65,535 max output tokens each, full metric-definition JSON embedded in the prompt).
- **Structured output**: enforced via `response_schema=<pydantic model>` +
  `response_mime_type="application/json"` — the SDK/Vertex validates the top-level JSON shape;
  `Finding`'s own field-level Pydantic validators (`min_length=1` excerpt, `ge=1` page number,
  `Literal[...]` for `availability_status`) are a second validation layer once the response is
  parsed locally.
- **Retry**: only `HttpRetryOptions(attempts=3)` at the transport layer inside the SDK call itself
  — no application-level retry loop wraps `extract_document`/`route_domain_pages`; a failure just
  fails the run (`ExtractionError` subclasses) and the queue's `retry_run()` requeues a fresh
  attempt on operator/caller request.

### 4.4 Worker / queue / lease mechanism

- **Single serial worker** (`worker.py::run_worker`) — an infinite loop: `recover_expired()` (sweep
  any `running` row whose `lease_expires_at` has passed back to `failed`/`worker_lost`), then
  `claim_next()`, then (if claimed) `process_run()`, then sleep `WORKER_POLL_SECONDS` (5s). No
  concurrency inside one worker process; the architecture assumes exactly one worker container
  (compose has exactly one `worker` service, no replica count).
- **Fencing**: the `cds_extractions.id` UUID **is** the fence token — every mutating queue call
  (`renew_lease`, `claimed_document`, `complete_run`, `fail_run`) re-checks `status='running' AND
  lease_expires_at > now()` (and in `complete_run`, additionally re-checks the school-year pointer,
  document SHA, manifest/extractor/model identity) before writing anything. A worker that loses its
  lease (e.g. GC pause, crash, or two workers racing) can never activate stale results.
- **`LeaseKeeper`** (`worker.py`): while the synchronous Gemini SDK call runs inside
  `asyncio.to_thread`, a background `asyncio.Task` renews the DB lease every
  `EXTRACTION_LEASE_SECONDS/3` (300s at default); `ensure_active()` is checked immediately before
  and after every provider call, and losing the ability to renew (exception or explicit `False`
  return) sets an `asyncio.Event` that makes every subsequent `ensure_active()` raise
  `LeaseLostError` — the run is aborted rather than risking a late write after some other process
  reclaimed the slot.
- **Candidate activation gate** (`queue.py::_candidate_identity_ok`): for a `target_kind ==
  "candidate"` run (i.e. "is this newly uploaded/downloaded PDF actually the right document for
  this school-year"), after packets are stored, the `identity` domain's `institution_name` and
  `academic_year` metrics must both be `extraction_status == "verified"`, the extracted name must
  fuzzy-match (casefold, punctuation/underscore-stripped, whitespace-collapsed —
  `_identity_normal`) either the school's canonical name or one of its `aliases`, and the extracted
  academic-year string must parse (`_year_start`, regex `^\d{4}[-/](?:\d{2}|\d{4})$`) to exactly the
  school-year row's stored `academic_year` int. Failing this gate stores the packets as evidence but
  does **not** flip the active pointer (`_terminal(..., rejection_code, ...)` with a detailed
  `_candidate_failure_summary` diagnostic persisted onto the extraction row) — `reactivate_candidate()`
  lets an operator re-run just this gate later (after fixing e.g. a wrong `academic_year` on the
  school-year row) **without re-calling the provider**, reusing the already-stored packets.
- **Non-candidate activation** (`_activate_packets`): a `validated` packet always activates
  (deactivating any prior active packet for that domain); a `partial` packet activates only if
  there is no existing `validated` packet under the *same* `domain_schema_hash` already active
  (i.e. a worse result never clobbers a strictly-better already-active one for an unchanged schema).

### 4.5 College Transitions (`ct_index`) scraping — where it lives

- **Source**: `library/ct_index.py` (`CollegeTransitionsIndex`) + `library/ct_download.py`
  (`CollegeTransitionsDownloader`).
- **What it does**: `ct_index.py` fetches `settings.ct_index_source_url` (default
  `https://www.collegetransitions.com/dataverse/common-data-set-repository/`), a public,
  server-rendered HTML page. It parses one specific table via BeautifulSoup:
  `table[data-ninja_table_instance][aria-label='CDS Repository']`, reads academic-year column
  headers matching `^(20\d{2})[-–]\d{2}$`, and for every `<tr>` extracts `(school_name, academic_year,
  anchor href)` triples, unwraps any Google `/url?q=` redirect wrapper, and keeps only links to
  `drive.google.com/file/d/...` or `docs.google.com/{spreadsheets,document}/d/...` (link kinds
  `drive`/`sheet`/`document`).
- **Refresh is generation-versioned**: each refresh inserts a fresh batch of rows tagged with a
  monotonically incrementing `generation` (all under one `pg_advisory_xact_lock`), then atomically
  flips `ct_index_state.active_generation` — so a mid-refresh crash or a bad parse never exposes a
  half-written table; `search()`/`entry()` always join against the currently-active generation only
  (migration `0002_ct_index_generations.sql`).
- **Download** (`ct_download.py::export_url`): converts a Drive/Docs *view* link into a direct
  export URL (`drive.google.com/uc?export=download&id=...` or
  `docs.google.com/{kind}/d/{id}/export?format=pdf`), then streams it with a manual redirect loop
  (max 5 hops), SSRF-checking every hop via `require_google_url`/`require_college_transitions_url`
  (`http_security.py`), and a hard byte cap (`download_max_bytes`, default 50 MB) enforced both from
  `Content-Length` and while streaming.
- **Never auto-extracts**: a repository download only ever calls `DocumentStore.add_repository()`,
  which stores the PDF as a **candidate** document (immutable evidence + provenance columns
  `source_page_url`, `original_download_url`, `resolved_download_url`, `repository_school_name`) —
  starting extraction is always a separate, explicit operator action (both README and code confirm
  this — "Repository acquisition never starts extraction automatically").

---

## 5. Honest critique

### Good — worth keeping/porting

1. **Evidence-first immutability model.** PDF bytes, manifest snapshots, and packets are all
   trigger-enforced immutable in Postgres (`reject_immutable_document/manifest/packet` triggers) —
   every extracted value is permanently traceable to the exact PDF bytes, exact manifest version,
   and exact page+excerpt that produced it. This is a genuinely strong compliance/defensibility
   property and should be ported wholesale.
2. **Content-hash-driven re-extraction scoping** (`domain_hashes`, `derive_requested_domains`).
   Republishing a manifest only re-bills domains that *semantically* changed; a purely presentational
   YAML edit (only `title`, which is stripped before hashing) costs nothing. Smart, cheap-to-reason-about
   cost control.
3. **`context_bindings`.** A clean, general device for "this whole block of counts is scoped to a
   printed term/year/cohort extracted elsewhere" without repeating that scoping prose N times per
   metric (even though the current YAML *also* repeats it in prose redundantly — the compiled
   structure itself is sound and should be kept even if the redundant prose isn't).
4. **Page-routing-as-optimization-only design.** A bad or missing routing result never produces
   wrong data — it only costs the token-savings; `group_page_clusters()`'s fallback-to-whole-document
   is a correct, low-risk way to get cheaper extraction on the common case without betting
   correctness on it. The original-page-number remapping through a narrowed sub-PDF
   (`_page_framing`/`page_map`) is a well-thought-out detail that's easy to get wrong.
5. **Typed-value coercion discipline** (`_typed_value`): only lossless coercions are permitted
   (`170.0 → 170`), everything else is `invalid`. No silent stringly-typed drift.
6. **Lease-fencing** around long synchronous provider calls run via `asyncio.to_thread`, with a
   background renewal task and hard `ensure_active()` checks bracketing every provider call — a
   correct pattern for "one worker, long external calls, must never activate stale work."
7. **Candidate identity/year verification gate** before ever flipping a school-year's active
   pointer to a newly-uploaded PDF — prevents silently swapping in the wrong school's or wrong
   year's document, with a documented recovery path (`reactivate_candidate`) that doesn't require
   re-billing the provider.
8. **DB privilege separation**: three roles (owner/app/reader), reader restricted to exactly 5
   views with no table access, app role has no `DELETE` grant at all. Solid, cheap security
   hygiene for a service with exactly one external consumer.
9. **Self-describing packets** — `provider_contract` embedded in every packet means you can audit
   exactly what was asked of the model without needing the manifest row at all.

### Bad — genuinely problematic, do not copy verbatim

1. **The metric `instructions` prose is hand-authored against exactly two real institutions**
   ("Harvard 2025-26" and "Yale 2024-25" — these literal school names appear in *hundreds* of
   metrics' instructions, e.g. `"Harvard 2025-26 and Yale 2024-25 both label this E1 row exactly
   ..."`). This does not generalize to a third school with different literal CDS phrasing, and it
   is an enormous authoring/maintenance burden per metric (1149 metrics × several sentences each).
   **Port the taxonomy** (units/populations/definition_variants/period_kinds, the
   context_binding structure, the metric ID naming), **do not port the two-school-specific
   instruction prose verbatim** — it needs to be rewritten to be genuinely school-agnostic, or the
   new engine will inherit the same narrow-coverage risk.
2. **The `conflict` extraction_status is largely dead code.** The schema/DB/packet contract all
   support multiple disagreeing claims per metric resolving to `conflict`, but in the actual single
   provider-call-per-group flow, one metric only ever gets claimed once per run — `conflict` can
   only be reached via a bug (duplicate findings from the same call) or a code path that doesn't
   exist yet (e.g. redundant/ensemble calls for self-consistency). There is **no actual N-of-M
   voting or self-consistency check anywhere** despite the machinery clearly being built to
   anticipate it — a real reliability gap for a system whose entire value proposition is "verified"
   values.
3. **Cost/latency**: 7 extraction calls (up to 65,535 output tokens each, declared) + 1 routing
   call per full CDS PDF, each shipping the (possibly narrowed) native PDF bytes inline with every
   call — no visible use of Gemini context caching for the shared prompt/schema/PDF content across
   the 7 calls in one run, no batching API. For processing hundreds of schools this is a real,
   avoidable cost center worth re-architecting (e.g. fewer, larger groups; explicit context
   caching; or a cheaper first-pass model).
4. **No local cross-check of model output against document content.** The entire correctness
   story rests on Gemini's native-PDF vision output; there's no secondary verification that a
   claimed `excerpt` actually appears near the claimed `page_number` (e.g. via local text
   extraction/fuzzy match). A confidently-wrong page citation is currently undetectable by the
   pipeline itself.
5. **Extraction-group pairing is an opaque, manually-curated list** (`manifest.yaml`
   `extraction_groups`) with no documented rationale for *why* e.g. `financial_aid` is paired with
   `class_size` rather than any other domain. This is a hidden cost/quality tuning knob a new
   engine should either derive systematically (e.g. by CDS section adjacency) or document
   explicitly, not silently copy.
6. **`manifest.py` is 690 lines of fairly bespoke validation/compilation logic** (closed-vocabulary
   checks, two independent DFS cycle-checkers for formulas and contexts, a hand-rolled selector
   algebra for `targets`) for what is conceptually "load YAML, validate against a schema, hash it."
   Given the project's own `AGENTS.md` explicitly preaches "never reinvent the wheel" / KISS, a
   schema-validation library (Pydantic models directly over the YAML, or JSON Schema + a jsonschema
   validator) would likely replace much of this with less custom code — worth evaluating for the
   rewrite rather than porting the bespoke validator as-is.
7. **Authoring-style inconsistency**: `enrollment.yaml` is written in YAML flow style
   (`{id: ..., description: ..., ...}` all on one line per metric) while all 12 other domain files
   use block style. Both parse fine and both hash identically once loaded, but it's an unexplained
   inconsistency (looks script-generated) that a new authoring tool/linter should not carry forward
   as an "acceptable" split — pick one style and enforce it.
8. **College Transitions scraping is a single-page, single-selector HTML scrape** of a third-party
   site with zero API contract (`table[data-ninja_table_instance][aria-label='CDS Repository']`).
   Fine as an internal convenience tool, but it is inherently fragile against any redesign of that
   page — flag as an inherited maintenance risk, not a foundation to build more on.

---

## 6. The DB contract — `migrations/*.sql`

### 6.1 File-by-file

| File | What it does |
|---|---|
| `0001_initial.sql` | Full baseline: `cds_library` schema (product objects never live in `public`, which has `CREATE`/usage revoked from `PUBLIC`); 3 roles (`cds_library_owner`, `cds_library_app`, `cds_library_reader`); tables `schools`, `cds_school_years`, `cds_documents`, `cds_manifests`, `cds_extractions`, `cds_domain_packets`, `ct_index_entries`, `ct_index_state`; immutability triggers on documents/manifests/packets; a `schools` self-consistency trigger (`reject_school_projection_mismatch`) that forces the typed columns to always match derived values inside `basic_profile` jsonb; 5 reader views (see below); role grants (app: SELECT/INSERT/UPDATE, no DELETE; reader: SELECT on the 5 views only). |
| `0002_ct_index_generations.sql` | **Breaking change** to `ct_index_entries`: adds `generation bigint NOT NULL DEFAULT 0`, **drops** the old unique constraint `(normalized_name, academic_year, resolved_url)` and replaces it with `(generation, normalized_name, academic_year, resolved_url)`; adds `ct_index_state.active_generation`. Enables the atomic-refresh-without-downtime pattern described in §4.5. |
| `0003_candidate_reactivation.sql` | Additive: `cds_extractions.reactivated_at timestamptz` + a check constraint that it may only be set when `status IN ('succeeded','partial')` — backs `reactivate_candidate()` in §4.4. |
| `0004_reader_contract.sql` | **Changes the live reader-facing contract** (the one Counselle actually depends on). `CREATE OR REPLACE VIEW` for all 3 of the non-trivial reader views: <br>• `active_cds_documents` / `active_cds_domain_packets`: the "latest extraction/request" `LATERAL` subquery's `ORDER BY` gains a tie-break `, x.id DESC` (was `ORDER BY x.created_at DESC` alone in 0001) — fixes nondeterministic tie resolution when two extraction rows share a `created_at` timestamp, guaranteeing the returned `latest_..._id`/`..._status`/`..._error_code` always come from the *same* row. <br>• `cds_manifest_snapshots`: **gains two columns not present in 0001** — `extractor_contract_version` and `is_current`. This is a genuine schema-contract expansion a consumer needs to know about if it was written against the 0001 shape of that view. <br>Also re-grants `SELECT` on all 5 views to `cds_library_reader` (defensive re-grant after `CREATE OR REPLACE VIEW`, which can reset privileges in some Postgres versions). |

### 6.2 Views Counselle reads (exactly 5, per README and `docs/reference/db-schema.md`)

| View | Contract |
|---|---|
| `school_profiles` | Typed core columns + complete `basic_profile`/`profile_provenance` jsonb + `profile_version`/`profile_snapshot_date`/`profile_sha256`. |
| `active_cds_documents` | One row per active school-year document: source/freshness (`currentness`, `staleness_reason` — computed from an academic-year-vs-current-date cutoff at July 1), `usable_domain_count`/`partial_domain_count`, and the deterministic latest extraction id/status/error code (post-0004). |
| `active_cds_domain_packets` | One row per (school-year × currently-configured domain), left-joined against the currently-active accepted packet (so a domain with no active packet still appears, with nulls) plus the deterministic latest *requested* extraction outcome, separated from whether a packet is actually currently accepted (`accepted_packet_status` vs `current_definition_match`). |
| `cds_document_sources` | Immutable PDF bytes + SHA + full provenance by document id, including historical (superseded/invalidated) documents — the by-ID evidence path. |
| `cds_manifest_snapshots` | `version, content_sha256, content, domain_hashes, published_at` (0001) **plus** `extractor_contract_version, is_current` (added in 0004). |

The reader role has **no** direct grant on `cds_manifests`, `schools`, `cds_domain_packets`,
`cds_documents`, or `cds_extractions` — only these 5 views. A new engine's reader contract should
replicate at least this same boundary (typed/current projection + full evidence-by-id + manifest
snapshot), and must publish `extractor_contract_version`/`is_current` on the manifest view from day
one (0004 shows the original 0001 view shape was insufficient and had to be patched later).

---

## 7. Ops — how it runs today

### 7.1 `Dockerfile`
```dockerfile
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY pyproject.toml uv.lock ./
COPY migrations ./migrations
COPY config/cds ./config/cds
COPY src ./src
RUN pip install --no-cache-dir .
EXPOSE 8000
CMD ["uvicorn", "counselle_data_pipeline.api.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
```
One image, 3 different commands/roles at runtime (see compose below) — same image, no separate
worker/migration image.

### 7.2 `docker-compose.yml` — 4 services

| Service | Image/command | Notes |
|---|---|---|
| `db` | `postgres:16-alpine` | `POSTGRES_DB=counselle_data`. Bound to **`127.0.0.1:${CDS_DB_PORT:-5433}:5432`** — confirmed: local Postgres is reachable on host port **5433**, loopback-only. Named external volume `counselle-data-pipeline_postgres_data`. |
| `migrate` | `cds-library migrate` | Runs once, `depends_on: db (service_healthy)`, uses `MIGRATION_DATABASE_URL` (superuser `postgres` role) — separate from the app's `DATABASE_URL` (least-privilege `cds_library_app` role). |
| `app` | uvicorn factory app | `depends_on: migrate (service_completed_successfully)`. Bound to `127.0.0.1:${APP_PORT:-8000}:8000`. `VERTEX_API_KEY` is present here only for UI presence-checks — **the app process itself never calls Gemini** (comment in compose confirms this explicitly). |
| `worker` | `cds-library worker` | `depends_on: app (service_healthy)`. This is the **only** process that calls Gemini. Healthcheck is just `kill -0 1` (process-alive only, no real liveness probe of the poll loop). |

Team deployment note (from `docker-compose.yml` comment + README): loopback binds are
intentional; "team deployment keeps this loopback bind and publishes it with Tailscale HTTPS."
No public bind by default anywhere.

### 7.3 `Makefile` targets
`install` (`uv sync --extra test`), `test`/`check` (`uv run pytest`), `up`/`down`/`logs` (compose),
`migrate`, `seed-dry-run`/`seed` (`cds-library seed-schools`), `manifest-validate`/`manifest-publish`
(`cds-library cds-manifest validate|publish`), `worker` (`uv run cds-library worker`, for
host-Python dev without compose).

### 7.4 Env vars / credentials (`.env.example`, `config.py::Settings`)

| Var | Default / requirement |
|---|---|
| `POSTGRES_PASSWORD`, `CDS_LIBRARY_APP_PASSWORD` | required secrets, no default, compose fails fast if unset (`${VAR:?message}`) |
| `DATABASE_URL` | must resolve to path `/counselle_data` exactly (validator rejects Ascensia/other DBs) |
| `MIGRATION_DATABASE_URL` | superuser connection for `migrate` only |
| `APP_ORIGIN` | must be absolute http(s) origin, no path/query/creds; HTTP allowed only on `localhost`/`127.0.0.1`/`::1` |
| `CSRF_SECRET` | required, no default |
| `VERTEX_API_KEY` | optional (blank disables extraction cleanly — `GeminiExtractor(settings)` raises `ExtractionError` only when actually asked to extract, and `run_worker` just sets `extractor = None` and later runs fail with `extractor_unconfigured` rather than crashing the whole worker) |
| `CDS_CONFIG_DIR` | path to `config/cds` (mounted `/app/config/cds` in the container) |
| `CDS_EXTRACT_MODEL` | default `gemini-3.1-flash-lite`; validator forbids any id ending `latest` |
| `CT_INDEX_ENABLED` / `CT_INDEX_SOURCE_URL` | default `true` / the collegetransitions.com URL; validator requires the URL pass `require_college_transitions_url` at settings-load time |
| `UPLOAD_MAX_BYTES` / `DOWNLOAD_MAX_BYTES` | default 50,000,000 (50 MB) each |
| `UPLOAD_TIMEOUT_SECONDS` / `DOWNLOAD_TIMEOUT_SECONDS` | default 30s each |
| `MODEL_TIMEOUT_SECONDS` | default 120s (Gemini call timeout) |
| `EXTRACTION_LEASE_SECONDS` | default 900s (15 min) |
| `WORKER_POLL_SECONDS` | default 5s |

### 7.5 Where the DB lives
Local/dev: Postgres 16 (alpine image) in Docker Compose, **host port 5433** (`CDS_DB_PORT`,
container port 5432, loopback-only bind). Database name `counselle_data`. Three roles as in §6.
No managed/cloud Postgres reference found in this repo (deployment target beyond "Tailscale HTTPS"
loopback publishing is not specified here).

---

## Appendix: files read for this recon (all read-only, nothing modified)

- `config/cds/manifest.yaml`, `extraction-prompt.md`, `extractor-version.yaml`
- `config/cds/domains/*.yaml` (all 13; full read for academics/admissions/class_profile/
  class_size/cost/degrees/enrollment/identity(head)/financial_aid(head)/outcomes(head)/
  faculty(head); metric-count-verified via grep for all 13)
- `src/counselle_data_pipeline/config.py`
- `src/counselle_data_pipeline/library/manifest.py`, `extractor.py`, `worker.py`, `queue.py`,
  `documents.py`, `ct_index.py`, `ct_download.py`, `source_map.py`
- `migrations/0001_initial.sql`, `0002_ct_index_generations.sql`,
  `0003_candidate_reactivation.sql`, `0004_reader_contract.sql`
- `Dockerfile`, `docker-compose.yml`, `Makefile`, `.env.example`
- `README.md`, `AGENTS.md`, `docs/reference/db-schema.md`
- `tests/test_phase5_extractor.py` (packet-shape confirmation only, not the whole suite)
- `docs/adr/` directory listing (titles only, not opened): 0001 product-schema-ui, 0002
  immutable-evidence-manifests-queue, 0003 ct-permission-gating, 0004 private-deployment-boundary,
  0005 enable-college-transitions, 0006 native-pdf-partitioned-extraction, 0007
  whole-document-domain-group-extraction, 0008 page-routed-extraction-and-candidate-packet-persistence
  — these titles map directly onto the architecture evolution described in §4 and are worth a
  follow-up read if the new engine's design doc wants the *history* of why whole-PDF/page-routing
  was chosen over alternatives, not just the current end state captured here.

Not read in this pass (flagged for follow-up, low relevance to schema/engine/DB contract):
`library/profiles.py`, `library/spike.py`, `library/vertex.py`, `api/app.py`, `api/ct_routes.py`,
`api/security.py`, `api/upload_guard.py`, `db.py`, `cli.py`, `specs/cds-library/*`.
