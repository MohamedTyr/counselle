# DB Rewire — Counselle on the new data pipeline (CDS Library)

> **Status:** Scoped; implementation not started. **Revision 3** — hardened after a
> two-agent design review (architecture critique + repo-grounded accuracy audit), then
> a third full-repo old-DB residue sweep; all findings integrated.
> **What this is:** The complete design record for rewiring Counselle from the old
> `ascensia` database to the new data pipeline's database (the CDS Library, repo
> `~/Projects/councelle-data-pipeline` — being renamed, see §16). Covers the database
> contract, the full replacement tool surface, the ambient data picture, the
> `render_viz` redesign, the citation/evidence model, the new reading rules, the
> guidance stack, evals, the lego design principles (single-edit-point matrix +
> tunables registry), blast radius, sequencing, the project rename, and every decision
> made along the way — including what was cut and why.
> **Design bar (owner-set):** nothing hardcoded, everything dynamic, lego modularity —
> changing one feature must never require edits across many files; every value a dev
> might want to change lives in exactly one named place. House rules in `AGENTS.md`
> apply throughout (KISS, value×ease, one source of truth, DRY-about-knowledge,
> ADR 0017 layering, prompts-as-versioned-content, tool-schemas-are-an-API,
> typed-output-at-the-tool-boundary, eval-don't-unit-test-agent-behavior).
> **Sources of truth referenced:** pipeline `migrations/*.sql`,
> `config/cds/manifest.yaml` + `config/cds/domains/*.yaml`,
> `src/councelle_data_pipeline/library/extractor.py`,
> `docs/reference/school-profiles.md`, `docs/reference/db-schema.md`; counselle
> `counselle_db/` (incl. `service_find.py`, `static_map.py`), `app/viz.py`,
> `app/sources.py`, `app/tool_specs.py`, `domain/envelope.py`, `domain/normalize.py`,
> `domain/vintage.py`, `domain/tiers.py`, `domain/events.py`, `app/prompt.py`,
> `config/assets/` (prompts, `step_labels.yaml`, `dossier_shortlist.yaml`,
> `static_field_map.md`), `skills/`, `frontend/src/api/chat/types.ts`,
> `frontend/src/features/ai-chat/citations.ts`, `tests/fixtures/protocol/*.json`,
> `docs/DATABASE_GUIDE.md` (old-DB contract, to be replaced).

---

## 1. Context and goal

Counselle today is a read-only consumer of the old `ascensia` pipeline DB. That DB has
been replaced by the new data pipeline, but Counselle itself has not been touched yet.
This spec is the agreed design for that rewire.

The two databases are **fundamentally different animals**, so this is bigger than a
connection-string swap:

- **Old DB (`ascensia`)** — a *wide, shallow metric store*: 2,746 schools keyed by IPEDS
  `unitid`; a 1,093-field typed catalog (`public.fields`) across 3 sources (IPEDS 417,
  Scorecard 392, CDS 284) projected into ~2.09M `field_values` rows; 57 `raw.*` tables
  for programs/diversity; IPEDS code dictionaries; provenance via `raw.files`.
- **New DB (schema `cds_library`)** — a *narrow, deep evidence store*: the same 2,746
  schools with a static identity profile, plus per-school CDS **domain packets**
  (1,149 metrics across 13 domains) where **every value carries a PDF page number,
  verbatim excerpt, and section/row/column labels**, extracted from immutable stored
  PDFs under a versioned manifest.

What survives unchanged: Counselle's architecture (four layers, service layer → thin MCP
shell → citation envelope → source registry → SSE protocol → frontend). What gets
rewritten: the *contents* of the data layer, the tool surface, the citation payload, the
reading rules, the prompt, and the skills. What gets dramatically better: citations.

---

## 2. The new database — what Counselle consumes

### 2.1 The consumption contract: five reader views, nothing else

The pipeline defines a `cds_library_reader` role (NOLOGIN) with SELECT on exactly five
views. **These five views are the entire contract.** Counselle never reads base tables.

| View | What it provides |
|---|---|
| `school_profiles` | One row per school: typed identity columns (`id`, `name`, `aliases[]`, `city`, `state`, `search_name`, `official_domain`, `is_main_campus`, …) + `basic_profile` jsonb + `profile_provenance` jsonb + `profile_version` / `profile_snapshot_date` / `profile_sha256`. |
| `active_cds_domain_packets` | Per school × current-manifest domain: the accepted packet (or NULL), `accepted_packet_status` (`validated`/`partial`), `current_definition_match` (bool — packet's domain schema hash vs. current manifest), latest requested extraction outcome/error. Left-joins current definitions so "no packet" is explicit, never inferred. |
| `active_cds_documents` | Per school-year with an active document: `academic_year`, `pdf_sha256`, `source_kind`, source/download URLs, `retrieved_at`, `currentness` (`current`/`stale`), `staleness_reason` (`older_edition`), `usable_domain_count`, `partial_domain_count`, latest extraction id/status/error. |
| `cds_document_sources` | Document metadata + `pdf_content` (the actual PDF bytes) — backs the future page-serving endpoint. |
| `cds_manifest_snapshots` | The manifest rows: `version`, `content` jsonb (all domain + metric definitions), `domain_hashes`, `published_at`. The current one (`is_current`) is **the catalog**. |

### 2.2 School identity is preserved

`school_profiles.id` **is the IPEDS UNITID** (confirmed in
`docs/reference/school-profiles.md`). Everything in Counselle keyed on `unitid` —
workspace school references, resolve logic, viz `SchoolRef` — survives without a
remapping step.

### 2.3 The school profile (`basic_profile`)

The checked-in seed: 2,746 canonical schools from the archived 2024 IPEDS snapshot with
Scorecard fallbacks; profile version `2026-07-13`, snapshot date `2024-12-31`, SHA-256
sealed. **The canonical group vocabulary is the profile's own top-level keys** (one
source of truth — the pipeline's `school-profile.schema.json`); Counselle derives the
group list from the jsonb at read time and never re-enumerates it:

`identity` (unitid, OPEID, EIN, UEI, system, main_campus) · `location` (address →
coordinates, region, locale, CBSA, congressional district) · `contact` · `official_links`
(homepage, admissions, application, financial aid, **net-price calculator**, disability
services, veterans, athletics, mission) · `classification` (control, sector, level,
Carnegie ×6, size band, …) · `identity_and_mission` (HBCU/tribal/land-grant/HSI/…
designations, religious affiliation, accreditor, mission statement,
hospital/medical/distance-only) · `operational` (currently operating, Title IV, …).

All decoded to human labels; `profile_provenance` carries a per-field receipt (status,
chosen source, source column, vintage, file sha, raw + normalized value, normalization
name).

**Hard limitation, verbatim from the pipeline docs:** "Annual admissions, enrollment,
cost, aid, outcomes, earnings, demographics, staffing, and other time-series Scorecard
fields are explicitly excluded from this stable profile." The profile is **identity, not
current data** — not refreshed at runtime; every consumer must caveat time-sensitive
facts.

### 2.4 The CDS manifest and domains (the new catalog)

Current manifest `4.0.0`, extraction contract v7 (page-routed, domain-grouped,
found-only). **13 domains, 1,149 metrics** (counted from `config/cds/domains/*.yaml`;
`manifest.yaml`'s `extraction_groups` enumerates the same 13):

| Domain | Metrics | Domain | Metrics |
|---|---|---|---|
| financial_aid | 169 | transfer | 77 |
| admissions | 152 | student_life | 63 |
| enrollment | 134 | identity | 50 |
| degrees | 129 | cost | 47 |
| class_profile | 127 | academics | 34 |
| outcomes | 114 | faculty | 31 |
| — | — | class_size | 22 |

(Counts are informational — implementation always derives them from the live manifest,
never from this table. Note for tooling: `enrollment.yaml` alone uses single-line
flow-mapping YAML; any generic counter must parse YAML, not grep.)

Each metric definition carries: `id`, `description`, `type`, `unit`, `population`,
`denominator`, `definition_variant`, `period_kind`, `source_hints` (CDS section labels
like C1/B1/H2), `instructions`. Some metrics are **context binders** (e.g.
`first_year_admission_entry_term`, `enrollment_snapshot_term_or_date`) — printed source
context that dates the surrounding counts; they are not institution responses.

**Metric ids are flat and NOT globally unique.** 15 ids collide across domains today
(`applicants_*`, `admitted_*`, `enrolled_*` exist verbatim in both `admissions` and
`transfer`). Consequence: a bare metric id is ambiguous. **Counselle's canonical metric
currency is therefore the qualified ref `"<domain_id>.<metric_id>"`** (e.g.
`admissions.applicants_men` vs `transfer.applicants_men`), minted in exactly one place —
the typed packet model (§10.2) — and used by every downstream surface (`get_domain`
results, `render_viz` cells, evidence `eid`s, eval questions). The pipeline's flat ids
never leak past the packet parser.

### 2.5 The packet shape (what Counselle actually reads)

From `extractor.py` (`build_packets_from_results` / `_packets_from_claims`), a stored
packet is:

```json
{
  "document_sha256": "…", "academic_year": 2024,
  "extraction_id": "…", "manifest_version": "4.0.0",
  "domain_id": "admissions", "domain_schema_hash": "…",
  "extractor_version": "7.0.0", "model_id": "…",
  "status": "validated | partial | parse_failed",
  "counts": {"verified": n, "not_extracted": n, "conflict": n, "invalid": n},
  "provider_contract": { "…large…": "requested_domains, allowed_metric_ids, full metric_definitions prose, response_schema" },
  "metrics": {
    "applicants_men": {
      "availability_status": "reported | …(not_in_template_version, …) | null",
      "extraction_status": "verified | not_extracted | conflict | invalid",
      "value": 8842, "raw_value": "8,842",
      "diagnostic_code": "…only when extraction_status = invalid…",
      "evidence": {
        "page_number": 7, "excerpt": "…verbatim…",
        "section": "C1", "row_label": "…", "column_label": "…"
      }
    }
  }
}
```

Two consequences the service layer must own (in the packet parser, §10.2, nowhere
else):

- **`provider_contract` is a large blob** (the full metric-definition prose + response
  schema) stored inside every packet. It is *pipeline provenance, not agent data* — the
  parser drops it on read; it never reaches tool payloads, envelopes, or state.
- For `conflict`/`not_extracted`/`invalid` metrics the extractor nulls
  `availability_status`/`value`/`raw_value`/`evidence` and (for `invalid`) attaches
  `diagnostic_code` — the typed model represents these states explicitly.

Packets are immutable evidence; `is_active` is the mutable pointer (one active packet
per document/domain). Only `validated`/`partial` packets can be active.

---

## 3. The gap — what the old DB had that the new one doesn't

**Counselle's data breadth now equals CDS extraction coverage.** The old DB answered
"acceptance rate at any of 2,746 schools" from IPEDS/Scorecard even with zero CDS
coverage. The new DB has **no IPEDS/Scorecard metrics at all** — a school without an
extracted CDS document has only its identity profile.

| Old capability | Fate |
|---|---|
| `get_programs` (Scorecard field-of-study earnings/debt by major) | **Gone — no backing data exists.** Route to web, or (future, optional) a first-party time-series surface (§17.1). |
| `national_benchmark` | **Deferred** until bulk extraction gives it a real population. Trivially buildable then (percentiles across packets). |
| `find_schools` (filter all schools by admit rate/SAT/net price) | Only meaningful over covered schools; ad-hoc via `query_database` with the denominator caveat. `counselle_db/service_find.py` (and its `_DERIVED_FILTERS` old-field-key dict) is retired. |
| `get_diversity` (IPEDS EF race/sex grid) | **Rebuildable from packets** — CDS B2 race/ethnicity lives in the `enrollment` domain. |
| `search_fields` / the 1,093-field catalog / pgvector field index | Replaced by the manifest + `get_domain` (§5; a metric-search tool was considered and **cut**). |
| IPEDS code decoding (R1, `decode_ipeds`) | **Whole problem class deleted** — packets are typed, profiles pre-decoded. |

The unblocking dependency for breadth is the pipeline's **bulk extraction** work
(`specs/queue-progress-and-bulk-extraction/` in the pipeline repo). Until coverage is
wide, the agent's fallback ladder is: **packet → basic profile → web/.edu search** (the
existing Tavily tools already handle that tier).

---

## 4. Wiring

- **Connection:** create a LOGIN role in the pipeline DB granted `cds_library_reader`;
  point `COUNSELLE_DB_RO_DSN` at it. Read the five views only. Parameterized SQL only
  (unchanged, pipeline ADR 0001 inherited).
- **Counselle's own schema** (`counselle.*` — sessions/checkpointer, users, feedback,
  workspace, and today the field_index) currently lives inside the *old* ascensia
  Postgres. It needs a new home: either a `counselle` schema inside the pipeline DB
  (one Postgres, simple) or its own database. `COUNSELLE_DB_APP_DSN` vs
  `COUNSELLE_DB_RO_DSN` already anticipates the split. **Open decision — §17.**
- **Transition note:** old docs assume the pipeline DB at `localhost:5432`; while both
  DBs exist, ports/DSNs must be disambiguated. The rename (§16) lands first, so all new
  DSNs reference the corrected `counselle_data` name from day one.
- The old `counselle.field_index` (pgvector) has no successor — the metric-search tool
  was cut (§5.6). The embedding reconciler machinery is retired with it.
- **No shared code with the pipeline** (unchanged principle): Counselle shares only
  credentials; the DB views are the contract — hardened by the packet anti-corruption
  seam in §10.2.

---

## 5. The tool surface — 4 DB tools (final)

All tools: logic in `counselle_db/service.py`, thin MCP wrappers in
`counselle_db/server.py` for the LLM tool loop, direct in-process imports for
`render_viz`/internal checks (ADR 0017 deviation, unchanged). Every value returned as a
`CitationEnvelope`. D6-shaped tool errors unchanged.

### 5.1 `resolve_school(query)`

Name / abbreviation / alias / unitid → one school. Queries `school_profiles` against
`search_name` (indexed, normalized) + `aliases[]`, trigram/ILIKE fuzzy fallback. Returns
the same three statuses as today: `match`, `candidates` (multiple campuses, main campus
first via `is_main_campus`), `not_found` (say so honestly, never invent).

The match embeds the **coverage block** (replaces the old `coverage_tier` /
`is_tracked` tier system — `domain/tiers.py` is deleted), from `active_cds_documents` +
`active_cds_domain_packets`:

- has active CDS document? which `academic_year`?
- `currentness` (`current`/`stale`) + `staleness_reason`
- `usable_domain_count` / `partial_domain_count`
- **which domain ids actually have usable packets for this school** — so the agent knows
  exactly which `get_domain` calls will pay off before making any
- latest extraction status/error

### 5.2 `get_school_profile(unitid, groups?)`

The identity card: `basic_profile` projected into envelopes per group. **The `groups`
filter accepts the profile's own top-level key names (§2.3) — derived from the data,
never a hand-maintained enum in the tool schema.** Unknown group → error listing the
groups actually present. Every envelope carries the `profile_snapshot` caveat (§10.4).
Citation vintage from `profile_version`/`profile_snapshot_date`; source labels from the
per-field `profile_provenance` receipts (HD2024, Scorecard-school, …).

### 5.3 `get_domain(unitid, domain_id)` — the workhorse, the **only** metric read

One whole CDS domain as a cited bundle. Reads the school's packet from
`active_cds_domain_packets` through the typed packet model (§10.2), applies the reading
rules (§10) in code, returns every metric with its **qualified ref**
(`domain_id.metric_id`, §2.4), label, display value, page-level citation, plus the
availability summary, grouped/ordered per the manifest.

**Availability summary semantics (pinned — this is student-facing honesty text):** the
summary is *"N of M metrics verified"* where **M = metrics configured for the domain in
the current manifest** and **N = `verified` count**; metrics with
`availability_status = not_in_template_version` are stated separately ("K aren't in
this school's CDS edition"), never folded into "not reported." The sentence is built
from the caveat catalog (§10.4), not ad-hoc strings.

Design consequences of it being the sole read path:

- **Metric refs flow from data, not discovery.** The agent learns qualified refs by
  reading a domain; those refs are then valid currency for `render_viz` DB cells. No
  search step, no guessing.
- **Self-correcting errors:** invalid `domain_id` → error listing the currently valid
  ids from the loaded manifest. Never a hardcoded enum anywhere (not in tool schemas,
  prompts, or tests).
- **Payload discipline:** tool results carry compact rows (qualified ref, label,
  display, marker); `provider_contract` is stripped at the parser; verbatim excerpts
  live in the source registry (sidebar snippets), **not** repeated per metric in the
  tool payload. The existing `tool_overflow` middleware guards the extreme.

### 5.4 `query_database(sql, params?)`

The guarded Layer-3 escape hatch, unchanged in mechanics (single SELECT/WITH,
parameterized `$1..$n`, row cap, statement timeout, read-only role), now scoped to the
five views. Use cases: cross-school jsonb-path filters ("which schools report
need-blind"), ad-hoc aggregates/distributions, manifest/coverage detail beyond the
ambient block. Raw rows bypass envelope normalization — docstring keeps the warning that
the reading rules still apply and typed tools are preferred. jsonb recipes over
`packet->'metrics'` documented in the new DATABASE_GUIDE + the `db-recipes` skill (§11).

### 5.5 Unchanged tools (not part of this rewire)

The three Tavily tools (`search_web`, `search_school_site`, `search_reddit`) with their
source-config gating (ADR 0013), all workspace/memory/document tools, `write_plan`,
`load_skill`. One improvement lands free: the school-website/logo lookup that today
round-trips `compare_schools` on `institution.website` becomes a read of the typed
`official_domain` column on `school_profiles`.

### 5.6 The dropped-tools ledger (what was cut, and why)

| Tool (proposed or existing) | Verdict | Reason |
|---|---|---|
| `search_metrics` (hybrid pgvector metric discovery) | **Cut** | Unreliable and slow in practice; `get_domain` + ambient domain menu makes discovery unnecessary — refs come from domain reads. |
| `get_metrics(unitid, metric_ids)` (precision fetch) | **Cut** | Folded into `get_domain` — one read path, domains are the natural granularity. |
| `get_data_coverage()` | **Cut as a tool** | The agent shouldn't need a call for this — became the ambient data picture (§6). Per-school detail lives in `resolve_school`; rare detail via `query_database`. |
| `get_dossier(unitid, sections?)` | **Cut** | Fails value×ease: everything reachable via `get_school_profile` + `get_domain`; the agent curates per-conversation better than a hardcoded shortlist asset (`dossier_shortlist.yaml` is deleted). The curated-dossier *procedure* becomes the `school-deep-dive` skill (§11). |
| `compare_schools(unitids, metric_refs)` | **Cut (may return)** | Pure convenience over N× `get_domain`. Real cost of cutting: token bloat on multi-school questions (~150 metrics pulled to use 5, per school). Measured problem: **add back only if evals show genuine token/latency pain** — a trivial batched jsonb pluck then. |
| `get_programs` | **Cut** | No backing data in the new DB (§3). |
| `national_benchmark` | **Deferred** | Needs bulk-extraction coverage to be meaningful (§3). |
| `get_diversity` | **Cut as a tool** | B2 race/ethnicity grid ships inside `get_domain(enrollment)`. |
| `get_data_calendar` | **Cut** | Superseded by the ambient data picture + per-school coverage in `resolve_school`. |

Also cut: an intermediate design where `compare_schools`/`get_dossier` accepted the
two-channel CellInput grammar (agent-composed cells). Rejected as redundant — sourced
values are already in the agent's context; handing them back to a fetch tool teaches the
agent nothing. **Composition-with-sourced-cells only earns its keep where output goes
somewhere the agent's context can't: the student's screen.** See §7/§8.

---

## 6. The ambient data picture (no tool — automatic context)

The agent must always know what the database holds **without calling anything**. A
`{data_picture}` block is rendered into the system prompt every turn.

**Template is content, not control flow (AGENTS.md / ADR 0018):** the block's wording
lives as a versioned prompt asset (`config/assets/prompts/data_picture.md`) with named
slots — `{as_of}`, `{n_schools}`, `{snapshot_date}`, `{manifest_version}`,
`{total_metrics}`, `{covered}`, `{fully}`, `{partial}`, `{stale}`, `{by_year}`,
`{domain_menu}` (rendered `id (n)` lines) — and the prepare node only fills slots from
the hourly-refreshed in-memory manifest + coverage cache. Rewording the block never
touches the loop. Illustrative render:

```
## What's in the database (live, as of 2026-07-15)
- 2,746 US 4-year schools — every one has an identity profile
  (IPEDS/Scorecard snapshot dated 2024-12-31; identity only, verify
  time-sensitive facts).
- CDS data (manifest 4.0.0, 1,149 metrics) for 214 schools —
  180 fully extracted, 34 partial; 61 are older editions (stale).
  Editions: 2024-25 (61), 2025-26 (153).
- Domains: admissions (152) · financial_aid (169) · enrollment (134) ·
  degrees (129) · class_profile (127) · outcomes (114) · transfer (77) ·
  student_life (63) · identity (50) · cost (47) · academics (34) ·
  faculty (31) · class_size (22)
- No first-party data for a school/question → its profile + web search
  are your sources. Never answer "across all schools" questions as if
  2,746 schools have CDS data.
```

(All numbers illustrative — every one is a slot filled live: domain menu + metric
counts + manifest version from the current `cds_manifest_snapshots` row; coverage
aggregates from `active_cds_documents`; school count + snapshot date from
`school_profiles`.)

Mechanics and guarantees:

- **Nothing hardcoded, ever.** Publish a new manifest (add/rename/remove a domain) →
  Counselle picks it up on the next refresh with zero code changes. No code path
  enumerates domain names — not tool schemas, prompts, or tests.
- **First-party data classes are a derived list, not prose.** The block enumerates
  *available first-party data classes* (today: profile, CDS). A future third class
  (e.g. a Scorecard time-series surface, §17.1) appears as one more rendered line and
  one more routing rung — no re-authoring of the doctrine, whose fallback rung is
  phrased "no **first-party** data → web," not "no packet → web."
- **The old `{school_count}` prompt slot is retired** — its number is one of this
  block's slots now. One source for the school count, not two.
- **Staleness bound:** as fresh as the refresh cadence (a Settings value), and says so
  ("as of …"). If bulk extraction lands 500 schools mid-hour, the prompt is off until
  refresh — acceptable; `resolve_school` still tells the per-school truth immediately.
  A pipeline-poked refresh hook is possible later but is cross-service coupling we
  don't buy now.
- **Validation backstop:** `get_domain` validates `domain_id` against the loaded
  manifest and returns the valid list in errors, so even a stale-prompt edge
  self-corrects in one round trip.
- **Denominator honesty:** the block is what lets the agent answer universe-level
  questions honestly ("I have detailed CDS data for 214 of 2,746 schools; for the rest
  I can check the web") — and what any `query_database` sweep inherits as its caveat.

---

## 7. `render_viz` redesign — free composition over verified channels

### 7.1 The problem and the principle

Today `render_viz(type, unitids, field_keys)` is DB-welded: the tool fetches every cell
itself. That was the honesty boundary, but it blocks web-only and mixed cards. The
redesign: **the agent has total freedom over the shape — rows, columns, labels, schools,
titles. It has zero freedom over how a value enters. Every cell arrives through a
verified channel, and there is no third way to get a number in.** Freedom lives entirely
in *selection and arrangement*; truth is enforced entirely in *provisioning*.

`CitationEnvelope` stays the universal cell: the `viz` SSE event, frontend renderers,
staging/dedupe (`viz_signature.py`), placement markers, and the batch-flush protocol all
keep working untouched.

### 7.2 The cell grammar

```
render_viz(
  type: stat_block | comparison_table,      # an OPEN set — see §7.8
  columns: [{unitid?} | {name, domain?}],   # stat_block: exactly one column
  rows: [{label, cells: [CellInput]}],      # cells aligned to columns
  title?
)

CellInput =
  {metric_ref}                      # DB channel — qualified "domain_id.metric_id" (§2.4)
  | {profile_field}                 # DB channel — "group.field" from basic_profile
  | {display, raw?, marker: "[n]"}  # sourced channel — must reference a registered source
  | {unavailable: true}             # an honest hole
```

- **DB channel — hallucination impossible by construction.** The agent passes a
  *reference*; the resolver fetches in-process through the typed packet model, applies
  the reading rules, and produces the value, display string, and page citation itself.
  The model contributed a pointer. Qualified refs (§2.4) make the pointer unambiguous —
  `admissions.applicants_men` and `transfer.applicants_men` are different cells.
- **Sourced channel — hallucination bounded by the registry.** The agent may include a
  number it read from a web/.edu/Reddit result, but only with the `[n]` marker that
  result was registered under. The resolver looks the marker up in the turn's
  `SourceRegistry`; the citation (source, tier, url, vintage, snippet) is copied
  **verbatim from the registry entry** — the model never authors citation metadata. No
  marker or unknown marker → cell rejected. This is exactly the trust level web numbers
  already have in prose; the bar is extended, not lowered. An invented number would need
  an invented marker, and invented markers don't resolve.
- **`unavailable`** — the agent's explicit honest hole, rendered "not available".
  Essential in mixed rows so the agent is never forced to invent or drop a row.

### 7.3 Columns become entities (SchoolRef v2 — wire bump)

```python
class SchoolRef(BaseModel):   # v2
    unitid: int | None = None   # None = not in our database (web-only school)
    name: str
    domain: str | None = None   # logo host; agent may supply for web-only columns
```

DB-backed columns get `domain` from `school_profiles.official_domain` (typed column —
cheaper than today's lookup). Web-only columns may carry an agent-supplied host —
validated as a plausible domain, **decoration only, never data** (unchanged logo
philosophy). Wire change → `RenderSpec.v: 2`; the frontend's independent TS mirror
(`frontend/src/api/chat/types.ts` currently types `SchoolRef.unitid: number`,
non-nullable) updates in the same change, and columns key by name when `unitid` is null.

### 7.4 Scale: no product caps, no speculative machinery

The old caps (stat_block = 1 school, comparison ≈ 6×25) are removed — that's *deleting*
code, which is free. Truth enforcement is **per-cell and therefore scale-invariant**:
a 40×12 grid is 480 independently-verified cells; there is no whole-table freeform
path, so scale adds zero hallucination surface. One **safety ceiling in Settings**
(max cell count) guards a runaway loop — generous but modest; a config value, no magic
numbers.

**Deferred (value×ease):** dedicated big-grid frontend machinery (sticky header/first
column, virtualization). A student applicant does not compare 40 schools × 12 metrics
in one card; the existing horizontal-scroll-in-container rule (wide content scrolls
inside the card, never the page) is enough at ship. `RenderSpec` is size-agnostic, so
the affordances can land later with zero rework if a real need shows up.

### 7.5 The per-cell error protocol

The call **validates all cells first and renders only if all pass.** On any failure it
returns no card — just a precise defect list:

```json
{"ok": false, "rejected_cells": [
  {"row": 17, "col": 2, "reason": "unknown metric_ref 'admissions.yeild_rate' — did you mean 'admissions.yield_rate'?"},
  {"row": 31, "col": 5, "reason": "marker [14] not in this turn's sources"}
], "valid_cells": 478}
```

Retry is surgical (fix two references, not the table). **Rejected ≠ unavailable** —
"not available" means *the data doesn't exist* and only the agent can declare it;
rejection means *the reference was wrong* and must never silently render as a hole.
Invariant: **everything the student ever sees in a card is verified truth or a declared
unavailable. There is no third rendered state.**

### 7.6 Token economics: compact ack, no table echo

Today's `result_for_agent` echoes every cell. At hundreds of cells that's waste — the
agent composed the table; the data is already in its context. The success ack becomes:
placement marker, cell/source counts, and the distinct source markers used
(`["[1]","[3]","[7]"]`). Nothing else. Citation dedupe keeps the sources panel sane: 400
CDS cells from four schools collapse to a handful of document-level entries (§9).

### 7.7 Frontend

`RenderSpec` shape (columns + rows of envelopes) is size-agnostic; skeleton sizing from
row/column counts keeps CLS ≈ 0. Cells from both channels render identically — a
Reddit-sourced cell sits next to a CDS-p.7 cell **visibly tier-labeled**, so mixing
never launders a community number into looking official. Frontend touch points are
named in §13's manifest (TS wire types, citations icon branches, protocol fixtures).

### 7.8 `type` is an open set (the community-card seam)

The tabular columns×rows×cells grammar is **one family of viz types, not the universal
shape**. The already-designed-but-unbuilt **community card** (qualitative
Reddit/community content; ARCHITECTURE §17, TODOS.md) will land as a distinct
`RenderSpec.type` with its own payload shape — it reuses the *sourced-channel rule*
(content only via registered markers, citations copied from the registry) and the
staging/dedupe/placement machinery, but not `CellInput`. Design consequence now: the
resolver, `RenderSpec`, and the client dispatch on `type` as an open set (unknown type
→ graceful degrade), so a new type is: one payload model + one resolver branch + one
client component. No rework of the tabular grammar.

### 7.9 Composition invariants (honesty-critical, tested hard)

1. Values enter through the resolver only; no code path accepts an agent number without
   a resolving marker.
2. Registry citations are copied, never merged with or overridden by agent input.
3. DB display strings are produced by the data layer; surfaces render *our* string, not
   a paraphrase.
4. Per-cell failure with corrective messages; all-or-nothing render per call.
5. Tier visible on every cell.
6. All-unavailable composition → the "tell the student honestly" error, as today.

Optional future tightening (explicitly not a blocker): warn — never block — when a
sourced cell's `raw` doesn't appear in the registered snippet (cheap transcription
tripwire; snippets are capped and often exclude the number, so blocking would misfire).

---

## 8. The read/render doctrine

- **Read tools** (`resolve_school`, `get_school_profile`, `get_domain`,
  `query_database`) — direction **DB → agent context**, audience *the agent*, input
  *references only*. They exist to get verified data into the agent's head cheaply. The
  agent can't compose anything here; it can only ask for what exists.
- **Render tool** (`render_viz`) — direction **agent context → student's screen**,
  audience *the student*, the **only** surface with the two-channel CellInput grammar,
  because it's the only surface whose output the agent's context can't already vouch
  for to the student.

The natural flow: **read tools and searches fill context with cited material → the agent
reasons in prose (citing markers) → when something deserves a card, `render_viz`
composes any subset of that verified material, mixing DB and web freely.**

---

## 9. Citations — the two-level document/evidence model

The packet evidence (`page_number`, `excerpt`, `section`, `row_label`, `column_label`)
travels end-to-end: packet → envelope → registry → `sources` event → sidebar.

### 9.1 Source vocabulary v2 (one home)

`SourceName` becomes `"cds" | "profile" | "web" | "edu" | "reddit"` (IPEDS/Scorecard as
*metric sources* are gone; profile provenance labels like `HD2024` ride inside the
citation, not the vocabulary). **This vocabulary lives in exactly one backend place —
`domain/envelope.py`** — and today it is illegally duplicated in `domain/vintage.py`
(`Source` Literal) and `domain/normalize.py` (`FieldMeta.source`); both files are
deleted by this rewire (§13), which resolves the duplication by removal. The frontend's
mirror in `types.ts` + the icon/tier branches in `citations.ts` are the one documented
cross-language pair (§13.2), kept honest by the shared protocol fixtures.

### 9.2 Two levels

**Level 1 — the source entry: one marker per CDS document.** The registry dedupe key is
**source-conditional** (an explicit branch in `app/sources.py`, replacing today's single
4-tuple): CDS dedupes on `(source, document_sha256)`; web/edu/reddit keep
`(source, url, vintage)`; profile dedupes per school snapshot. The sidebar reads like a
bibliography ("3. Yale University — Common Data Set 2024-25"), not 47 near-identical
entries.

**Level 2 — evidence items under the entry.** Each registration of a CDS envelope
appends (deduped) its evidence to the document's entry:

```json
{
  "index": 3,
  "label": "Yale University — Common Data Set 2024-25",
  "citation": {
    "source": "cds", "tier": "official",
    "vintage": "Common Data Set 2024-25",
    "document_sha256": "ab12…",
    "source_kind": "upload",            // or college_transitions
    "retrieved_at": "2026-05-02",
    "url": null                          // future: PDF-page deep link (§9.5)
  },
  "evidence": [
    {
      "eid": "admissions.applicants_men",   // qualified metric ref = stable anchor
      "value_display": "8,842",
      "label": "First-time first-year applicants — men",
      "page": 7, "section": "C1",
      "row_label": "Total first-time, first-year men who applied",
      "column_label": "TOTAL",
      "excerpt": "Total first-time, first-year men who applied… 8,842"
    }
  ]
}
```

`Citation` gains the CDS fields; `RegisteredSource` gains `evidence[]`. Envelope/wire
version bump (v2); web/edu/reddit and profile citations keep a flat shape; frontend
tolerates entries without `evidence` (old turns). **Every wire bump in this section and
§7 regenerates the shared protocol fixtures (`tests/fixtures/protocol/*.json`) — they
are the FE↔BE contract; stale fixtures are silent drift.**

### 9.3 Click behavior

- **Chip on a viz cell / envelope-backed value:** the envelope knows its
  `document_sha256` + qualified ref → open sidebar, scroll to the entry, **highlight
  that value's evidence item**: "Page 7 · Section C1 · row: *Total first-time,
  first-year men who applied*" + the verbatim excerpt, directly under the value clicked.
- **Marker in prose (`[3]` in deltas):** plain text → resolves to the document entry
  showing all evidence items registered this turn, page-numbered and excerpted, not
  pre-highlighted. Right degradation; no text-stream anchoring machinery.
- **Entry header:** school + edition, official tier chip, acquisition (`upload` vs
  `college_transitions`), retrieved date. Evidence list ordered by page.

### 9.4 State-size discipline

`state.source_registry` rides checkpointed graph state and turn records — unbounded
evidence is a durability bug. Rules: excerpts capped (the existing snippet-chars
constant); evidence items per entry capped via Settings (past the cap keep the count —
"…and 31 more values from this document"); **register evidence only for values the agent
actually uses** (cells rendered / envelopes whose markers appear), never all 152 metrics
of an exploratory `get_domain` read.

### 9.5 Fast follow (not a blocker): the PDF page endpoint

`pdf_content` is in `cds_document_sources`. A tiny authenticated Counselle endpoint
serving a single page of the stored PDF lets every evidence item deep-link
(`citation.url`) to *the actual page of the actual document* — student → value →
excerpt → source page, the full trust chain. The sidebar design works without it and
gains the links for free when it lands.

### 9.6 Wire-key hygiene: "domains" means two things

The existing `StepDetail.domains` wire key means *searched web hostnames* (Tavily
receipts) and is already in the frontend types and protocol fixtures. The new CDS
concept never reuses that key: tool receipts and step details for the new tools use
`domain_id` (singular, CDS sense). No consumer ever has to disambiguate.

---

## 10. Truth machinery — packet seam, reading rules, caveat catalog

### 10.1 Layer placement

All of §10 lives in code (data layer / `domain/`), never in prompts. The prompt and
skills teach *routing and when-to-say*, never *what is true* — a bad prompt day
degrades tone, not truth.

### 10.2 The packet anti-corruption seam (`counselle_db/packets.py`)

The packet interior is **pipeline extractor output, not a typed DB contract** — the
five views guarantee columns, not the jsonb shape inside `packet`. Per AGENTS.md
("don't couple to the pipeline"), exactly one module parses that jsonb into a
**Counselle-owned typed model** (the ADR 0006 typed-at-the-boundary pattern):

- Validates `extractor_version` against a **supported-versions set in Settings**;
  unsupported version → loud, typed error ("packet extractor v8.0.0 not supported")
  surfaced honestly to the agent — never a silent misread.
- Mints qualified metric refs (`domain_id.metric_id`, §2.4).
- Drops `provider_contract`; represents the nulled-fields states and
  `diagnostic_code` explicitly (§2.5).
- Everything downstream (reading rules, envelopes, viz resolver, evidence) consumes
  the typed model only. A pipeline extractor bump touches **this one file** plus one
  Settings entry.

### 10.3 The reading rules (successors to R1–R12 — honesty-critical, tested hard)

1. **Only `extraction_status == "verified"` becomes a value.** `not_extracted`,
   `conflict`, `invalid` → `available: false` with the honest reason (and
   `diagnostic_code` logged, never shown). Conflict/invalid are never rendered as
   numbers anywhere.
2. **`availability_status` semantics preserved:** `not_in_template_version` is *not*
   zero and *not* "the school didn't report it" — the CDS template edition lacks the
   row/column. Distinct caveat kind; distinct phrasing (§10.4).
3. **Packet `status: "partial"`** → domain-level caveat on every envelope from that
   packet.
4. **`current_definition_match == false`** → definition-drift caveat.
5. **`currentness == "stale"` / `older_edition`** → stale-edition caveat (the view
   computes it; the service attaches it).
6. **Profile facts always carry the snapshot caveat.**
7. **Context-binding metrics are folded into vintage strings** — counts dated by what
   the PDF printed (entry term/year, enrollment snapshot date), not the edition alone.
8. **Cross-school comparisons attach the mismatch caveat** when compared packets come
   from different academic years or manifest versions.
9. **Values are never invented; display strings are produced by the data layer** and
   used verbatim by every surface.
10. **Parameterized SQL only; SELECT only; five views only** (inherited, unchanged).

### 10.4 The caveat catalog — one home for every honesty phrase

Caveat *wording* previously risked living in four places (envelope strings, reading
rules, prompt grammar, citation skill). Resolution: **one versioned data asset**
(`config/assets/caveats.yaml`) — a catalog of `kind → canonical text (+ optional
slots)`:

`profile_snapshot`, `stale_edition`, `partial_packet`, `definition_drift`,
`not_in_template_version`, `edition_mismatch_comparison`, `coverage_denominator`, …

- The **data layer** attaches structured caveats to envelopes: `{kind, text}` with
  `text` rendered from the catalog. Envelope `caveat` becomes structured (part of the
  v2 bump).
- The **prompt** (§11.1) references caveat *kinds* in one line, teaching only that
  they exist and must be voiced.
- The **citation skill** (§11.3) teaches *when and how to weave them into prose* — it
  never re-authors the canonical wording.
- **Adding or rewording a caveat = one asset entry** (+ one attach-condition in the
  reading rules if it's a new kind). This is the single-edit-point rule (§13.1) applied
  to the highest-value surface in the product.

---

## 11. The guidance stack — making the agent use all of this

Four layers; each teaches only what belongs to it.

### 11.1 Layer 1 — system prompt (`counselor.md` slots rebuilt)

Out: `static_field_map` (no field catalog — `counselle_db/static_map.py` +
`config/assets/static_field_map.md` deleted), `dossier_shortlist_summary` (no dossier
tool — `dossier_shortlist.yaml` deleted), `tier_note` (tier system replaced —
`domain/tiers.py` deleted), `school_count` (folded into `{data_picture}`, §6).

In:
- **`{data_picture}`** — the ambient block (§6; template is its own prompt asset).
- **The routing doctrine** — a ~10-line decision tree: identity/links/classification →
  `get_school_profile` · any metric → `resolve_school` first, then `get_domain` on
  domains its coverage block lists · **no first-party data** for what's asked → web
  tools, say so · cross-school/aggregate shapes → `query_database` · past the CDS
  edition / live-cycle → web.
- **The composition rules** (always-on, never skill-gated): markers verbatim; viz cells
  only via refs or registered markers; no number without a marker; rejected ≠
  unavailable.
- **The caveat kinds, by name only** (one line; wording lives in the catalog, §10.4).

Kept unchanged: `{temporal_context}`, `{student_context}`, `{subreddit_menu}`.

### 11.2 Layer 2 — tool docstrings + step labels

Tool descriptions are prompt too. Each of the 4 DB tools + `render_viz` gets the full
contract treatment (what it returns, what statuses mean, what to do on failure, honesty
framing). `step_labels.yaml`: rows for the new tool names, old tool rows deleted;
receipt builders for the new tools. (Note: `step_labels.yaml` also carries the
`viz_labels` dict — a second enumeration of viz type names; it stays the *label* home
while `RenderSpec.type` stays the *schema* home, and §7.8's open-set dispatch means an
unlabeled new type degrades to the generic label instead of breaking.)

### 11.3 Layer 3 — skills (4 total; each earns its place)

| Today (4 on disk) | Becomes |
|---|---|
| `decode-coded-value` | **Deleted** — no IPEDS codes exist; problem class gone. |
| `citation-and-recency` | **Rewritten**: CDS edition phrasing ("per Yale's Common Data Set 2024-25, p. 7"), when/how to voice each caveat kind (§10.4 — wording referenced, never re-authored), sidebar evidence behavior and how to reference it in prose. |
| `dossier-assembly` | **Rewritten as `school-deep-dive`** — the procedure replacing the cut `get_dossier`: resolve → read coverage block → profile + the 2–3 domains the question calls for → compose; the no-packet fallback path (profile official links feed `search_school_site` targets — the net-price-calculator URL is in the profile). |
| `school-comparison` | **Rewritten**: resolve all schools; check coverage parity *first*; same domain per school; build the `render_viz` table including the mixed-channel case (DB cells + sourced cells + `unavailable` holes) and the edition-mismatch caveat. |
| *(new)* `db-recipes` | Parameterized jsonb query patterns over the 5 views for `query_database` (successor to old DATABASE_GUIDE §14 recipes). Rare-path knowledge that would waste always-on prompt space. |

### 11.4 Layer 4 — code (the enforcement floor)

§10 in full: packet seam, reading rules, caveat catalog attachment, marker validation,
per-cell rejection, registry copy-verbatim. The prompt never begs the model to be
honest.

---

## 12. Evals — the loop that makes it actually work

Prompts and skills are hypotheses; `evals/questions.yaml` + the judge get re-baselined
against the new surface (old questions reference dead field keys like
`admissions.acceptance_rate` and old tier names — full sweep, not a patch), with
categories targeting the new failure modes:

1. **Routing** — picks the right domain from the ambient menu without flailing.
2. **Coverage honesty** — school with no packets: says so and pivots to web; never
   fakes from the profile.
3. **Edition/caveat phrasing** — stale CDS, partial packet, `not_in_template_version`:
   judged on wording (against the catalog kinds).
4. **Composition discipline** — mixed-channel comparison: every cell backed, tiers
   visible, no uncited numbers in prose.
5. **Denominator honesty** — "which schools have the best aid?" states the
   covered-of-total caveat.

Failure triage rule: routing failure → prompt tree; phrasing failure → skill or caveat
catalog; a number without a marker → **code bug, not prompt bug**. Run → fix the layer
that failed → re-run. **The `compare_schools` revival trigger (§5.6) is measured here**
— token/latency stats on comparison questions.

---

## 13. Lego design — single-edit-point matrix, tunables registry, enumeration collapse

This section is the owner's design bar made checkable. It is part of the spec's
acceptance criteria, not commentary.

### 13.1 The single-edit-point matrix

Every plausible future change, and the **complete** set of places it touches. Any
implementation that makes one of these fan out further violates the spec.

| Change | Touches (exhaustively) |
|---|---|
| Pipeline publishes a new manifest (domain added/renamed/removed; metrics changed) | **Nothing.** Ambient block, `get_domain` validation, and refs all derive live. |
| Pipeline bumps the extractor (packet interior changes) | `counselle_db/packets.py` + the supported-versions Settings entry. |
| Reword / add a caveat | `config/assets/caveats.yaml` (+ one attach-condition in reading rules if a new kind). |
| Reword the ambient data picture | `config/assets/prompts/data_picture.md`. |
| Reword routing doctrine / counselor voice | `config/assets/prompts/counselor.md`. |
| Change any cap/TTL/limit | its one Settings entry (§13.2). |
| Add a DB tool | `service.py` function + `server.py` wrapper + `step_labels.yaml` row (+ receipt builder). Nothing else — `_GATED_BY` only if source-gated, which DB tools aren't. |
| Add a viz type (e.g. community card) | payload model in `domain/specs.py` + resolver branch + one client component (+ optional `viz_labels` row). Open-set dispatch; tabular grammar untouched (§7.8). |
| Add a citation source kind | `SourceName` in `domain/envelope.py` + dedupe branch in `app/sources.py` + the documented frontend pair (`types.ts` mirror + `citations.ts` icon branch) + fixture regen. Four named places, listed here so it's a checklist, not a hunt. |
| Add a first-party data class (e.g. Scorecard surface) | new read path in `counselle_db/` + one data-picture line + one routing rung. Doctrine phrasing already accommodates (§6). |
| Swap the DB again | `counselle_db/` internals + `domain/` vocabularies. MCP shell, envelope pattern, registry, viz, protocol, frontend unchanged — that's the four-layer dividend, now proven twice. |

### 13.2 The tunables registry (everything a dev might change, one place each)

Rule (house): *would someone change this without changing the logic?* Yes → named once
below; no → it stays inline. No literal below may appear anywhere else.

| Tunable | Home |
|---|---|
| RO/APP DSNs, pool sizes, statement timeout | Settings (existing) |
| Manifest/coverage cache refresh cadence | Settings (new) |
| Supported packet `extractor_version` set | Settings (new) |
| Viz safety ceiling (max cells) | Settings (new) |
| Evidence items per source entry cap | Settings (new) |
| Snippet/excerpt char cap | existing constant, single home (`app/sources.py`) |
| Tool-payload overflow thresholds | existing `tool_overflow` config |
| MCP read timeout | Settings (existing) |
| Caveat wording | `config/assets/caveats.yaml` |
| Ambient block wording | `config/assets/prompts/data_picture.md` |
| Counselor prompt / routing doctrine | `config/assets/prompts/counselor.md` |
| Step/timeline labels (incl. viz labels) | `config/assets/step_labels.yaml` |
| Skill bodies | `skills/*/SKILL.md` |
| Eval set + judge | `evals/questions.yaml`, `evals/judge.md` |
| Subreddit menu, season calendar, greetings | existing assets (unchanged) |

### 13.3 Enumeration collapse (audit-verified)

The audit found the source vocabulary (`ipeds|scorecard|cds`) independently declared in
**three** backend files and the tier vocabulary in a fourth; the rewire collapses all
of them:

- `domain/envelope.py` — **stays**: the one home of `SourceName`/`Tier`/`Unit` (v2
  vocabulary, §9.1).
- `domain/normalize.py` (291 lines: old R1–R12, `SOURCE_PREFERENCE` field-key dict,
  duplicate source Literal) — **deleted**; successor logic lives in
  `counselle_db/packets.py` + reading rules + caveat catalog.
- `domain/vintage.py` (duplicate source Literal, IPEDS/Scorecard vintage branches) —
  **deleted**; vintage strings come from packet/profile data + the caveat catalog.
- `domain/tiers.py` (`CoverageTier`, `_EXPLANATIONS`) — **deleted**; coverage is the
  resolve-time block (§5.1). `counselle_db/models.py` drops its tier fields.
- `counselle_db/service_find.py` (`_DERIVED_FILTERS` old-field-key dict) — **deleted**.
- `counselle_db/static_map.py` + `config/assets/static_field_map.md` +
  `config/assets/dossier_shortlist.yaml` — **deleted**.
- Frontend `types.ts` mirrors + `citations.ts` source/tier branches — **stay** (a wire
  boundary needs a typed mirror); they are the one documented cross-language pair,
  drift-guarded by the regenerated protocol fixtures.

---

## 14. Blast radius and sequencing

### 14.1 File-level manifest (audit-complete)

**Rewritten:** `counselle_db/catalog.py` (fields table → manifest + coverage cache),
`counselle_db/service.py` (4 tools + reading rules), `counselle_db/models.py`,
`counselle_db/db.py` (DSNs), `counselle_db/server.py` (tool wrappers),
`domain/envelope.py` (v2), `app/sources.py` (conditional dedupe + evidence + marker
lookup), `app/viz.py` (+ resolver), `domain/specs.py` (SchoolRef v2, CellInput, open
type), `app/prompt.py` (slots), `app/steps.py` (receipt/label/category logic keyed to
old `field_key`/`field_keys` args → metric refs + CellInput shapes),
`app/workspace/service_utils.py` (raw `FROM schools` query → `school_profiles`; picks
up city for free), `app/workspace/service_reference.py` (drops
`normalize.preferred_field` for the new test-policy read),
`config/assets/prompts/counselor.md`, `config/assets/step_labels.yaml`, skills per
§11.3, `evals/questions.yaml` + `evals/runner.py` (viz scorer keyed to flat
`schools[*].unitid`), `scripts/setup_db.sql` (old grants → the single reader-role
grant), `scripts/mcp_smoke.py`, `config/assets/abbreviations.yaml` (regenerate against
`school_profiles.aliases[]`/`search_name`), `docs/DEPLOY.md` (reconcile guidance out),
`docs/ARCHITECTURE.md` §8/§10/§11.

**New:** `counselle_db/packets.py` (§10.2), `config/assets/caveats.yaml`,
`config/assets/prompts/data_picture.md`, `docs/DATABASE_GUIDE.md` (full rewrite),
new-format protocol fixtures, `migrations/0012_drop_old_db_objects.sql` (+ rollback) —
forward migration dropping `counselle.decode_ipeds`, `counselle.value_vintage`, and
`counselle.field_index`.

**Deleted:** `counselle_db/search_fields.py`, `counselle_db/reconcile.py`,
`counselle_db/service_find.py`, `counselle_db/static_map.py`, `domain/normalize.py`,
`domain/vintage.py`, `domain/tiers.py`, `adapters/embeddings.py` (orphaned once the
reconciler dies), the reconciler lifespan block in `api/main.py`
(`ReconcilerState`/`reconcile_once`/`reconcile_forever`), the `/v1/admin/reconcile`
route + reconciler state in `/v1/health` (`api/routes/system.py`), the Settings
Discovery block (`embed_model`, `embed_dimensions`, `reconcile_interval_minutes`,
`vector_search_enabled`) + matching `.env.example` lines, `scripts/gen_static_map.py`,
`scripts/embed_smoke.py`, `config/assets/static_field_map.md`,
`config/assets/dossier_shortlist.yaml`, `skills/decode-coded-value/`, and the tests of
all of the above (`tests/counselle_db/test_reconcile.py`, `test_search_fields*.py`,
`tests/domain/test_normalize*.py`, `test_tiers.py`, `test_vintage.py`, …).

**Frontend (contained, enumerated):** `src/api/chat/types.ts` (SourceName/Tier mirrors,
`SchoolRef.unitid` nullable, Citation v2 + `evidence[]`, RenderSpec v2),
`src/features/ai-chat/citations.ts` (`DB_SOURCES` set + icon/tier branches; CDS
evidence rendering), the sources-sidebar component (evidence list + highlight), the two
card components (null-unitid keying). `tests/fixtures/protocol/*.json` regenerated —
the FE↔BE drift guard. Workspace frontend untouched (favicons derive from the
API-served `website_url` string; §15.2).

**Untouched:** `api/` routes *except* `system.py` and the `main.py` lifespan block
(all other routes audit-verified free of field/tier/viz enumeration), graph topology,
turn registry, auth, checkpointer, Tavily adapters, workspace *except* the two files
named above.

The exhaustive residue-by-residue inventory behind this manifest is §15; its
dispositions are part of this spec's acceptance criteria.

### 14.2 Sequence

1. **Decisions (§17)** + **the pipeline rename (§16)** — rename lands first so every
   new DSN/doc references the corrected name once.
2. **New `docs/DATABASE_GUIDE.md`** against the five views + packet model — the
   contract everything else implements; forces every semantic decision (what does
   `partial` mean to a student?) to be made once.
3. **`counselle_db/` rewrite** behind the unchanged MCP shell: `packets.py` first
   (typed model + version guard), then catalog/service/tools; delete list per §14.1.
4. **Citation/envelope v2** + registry extensions + caveat catalog + sidebar UI +
   fixture regen.
5. **`render_viz` rewrite** (resolver, SchoolRef v2, error protocol, compact ack, open
   type set).
6. **Prompt slots, tool docstrings, step labels, skills** (§11).
7. **Evals re-baseline** (§12) and iterate.
8. **The eradication gate (§15.5):** run the residue grep gates over the repo; every
   hit outside the historical zones must be dead. This is the merge gate for the
   rewire, not a cleanup afterthought.
9. **Fast follows:** PDF page endpoint + evidence deep links (§9.5). **Evidence-gated
   later:** `compare_schools` batch fetch (§5.6, only if evals show pain);
   `national_benchmark` (after bulk extraction); big-grid affordances (§7.4, only on
   real need).

**Honesty-critical test surface (tested hard, always):** §10 in full (packet seam,
reading rules, caveat attachment), §7.9 composition invariants, marker/registry
validation, citation construction. Everything else follows the "a test has to earn its
place" house rule.

---

## 15. Old-DB eradication — nothing survives, and it's checkable

**The guarantee:** after this rewire, Counselle works with the new DB **only**. No
code path, query, helper, setting, asset, receipt, or doc contract references the old
`ascensia` database or its concepts — not in the agent loop, not in the workspace, not
in ops scripts, not in counselle's own migrations. This section is the full-repo sweep
(third review pass) that makes the guarantee checkable rather than hoped-for.

### 15.1 Why this section exists

The old DB doesn't only live in the obvious data layer. It leaked into counselle's own
Postgres schema (SQL helper functions whose *bodies* query `raw.ipeds_*` and
`field_values`), a background reconciler task in the API lifespan, workspace school
resolution, step-timeline receipt logic, an abbreviations asset hand-tuned to IPEDS
name strings, deploy docs, and ops scripts. Each is inventoried below with a
disposition; §14.1's manifest incorporates all of them.

### 15.2 The favicon/logo chain, traced (the canonical example)

School logos everywhere in the product derive from one chain:
`counselle_db/catalog.py::_SCHOOL_WEBSITES_SQL` (a query on old-DB
`field_values WHERE field_key = 'institution.website'`) → `Catalog.school_domain()` →
consumed by (a) `render_viz` column logos, (b) workspace `website_url` on Schools
(`app/workspace/service_utils.py`), (c) step-timeline source chips
(`app/steps.py::_school_sources` → `favicon_url()`), (d) the frontend, which builds
Google-s2 favicon URLs purely from the API-served `website_url` string.

**Replacement: one edit point.** The catalog loads `official_domain` (a typed column
on `school_profiles`) instead; every consumer downstream — workspace, steps, viz,
frontend — is already string-based and needs zero changes. `domain/urls.py` keeps its
pure string functions (docstring refresh only; it currently cites `institution.website`
and a stale `frontend.backup` path). This is the lego principle working as intended:
the feature the owner worried about migrates by swapping one SQL constant.

### 15.3 The residue inventory (sweep-complete)

**Counselle's own migrations:**
- `0002_helpers.sql` — `counselle.decode_ipeds()` (queries `raw.ipeds_valuesets24`)
  and `counselle.value_vintage()` (queries `field_values` + `raw.files`): counselle-owned
  functions with old-DB bodies. **Dropped by the new forward migration 0012** (§14.1) —
  not merely left to the old rollback file.
- `0003_field_index.sql` — `counselle.field_index` pgvector table: **dropped by 0012.**
- `0009_pg_trgm.sql` — its stated purpose (field/school keyword search via
  `search_fields.py`) dies with that module; the extension itself is harmless and the
  new `resolve_school` trigram fallback runs against the *pipeline* DB anyway. **Marked
  vestigial in the migration's comment; no drop needed.**
- `0011_school_workspace.sql` — its `cycle_year` is Counselle's own *application-cycle*
  concept, unrelated to the old DB's data-vintage `cycle_year`. **Kept; the naming
  collision gets a disambiguation note in the new DATABASE_GUIDE.**
- `0007`/`0008`/`0010` and the rest — clean; `school_unitid` columns survive because
  unitid is preserved (§2.2).

**Workspace (contradicted the old "untouched" claim):**
- `app/workspace/service_utils.py` — raw `SELECT unitid, name, NULL::text AS city,
  state FROM schools …` against the old DB, issued *outside* the data layer. **Rewritten**
  to read `school_profiles` (`id`, `name`, `official_domain`,
  `location→city`, `location→state`) — and the hardcoded `NULL AS city` becomes real
  city data, a free upgrade.
- `app/workspace/service_reference.py` — calls `get_values(...,
  preferred_field("test_policy"))` from the deleted `domain/normalize.py`. **Rewritten**
  against the new read path (test policy lives in the CDS `admissions` domain /
  profile).
- Everything else in workspace funnels through `Catalog` (names/domains) and survives
  via the §15.2 swap. Workspace tables keep `school_unitid` untouched.

**API (contradicted the old "untouched" claim):**
- `api/main.py` — the reconciler lifespan (`ReconcilerState`, `reconcile_once`, the
  `reconcile_forever` background task, `app.state.reconciler`): **deleted.**
- `api/routes/system.py` — `POST /v1/admin/reconcile`: **deleted**; `/v1/health` drops
  its reconciler payload.
- All other routes: audit-verified clean.

**Settings / env / adapters / scripts:**
- `config/settings.py` Discovery block (`embed_model`, `embed_dimensions`,
  `reconcile_interval_minutes`, `vector_search_enabled`) — only consumers are deleted
  modules: **deleted**, plus the `db_app_dsn` comment ("checkpointer, embeddings") loses
  "embeddings".
- `.env.example` — matching `COUNSELLE_EMBED_*` / `COUNSELLE_RECONCILE_*` lines:
  **deleted**; DSN comments updated.
- `adapters/embeddings.py` — orphaned (only the reconciler/search used it): **deleted.**
- `scripts/setup_db.sql` — grants on `public.*`/`raw.*` tables and `public.fields`:
  **rewritten** to the single new-DB pattern (LOGIN role granted `cds_library_reader`,
  §4).
- `scripts/gen_static_map.py`, `scripts/embed_smoke.py` — generate/smoke deleted
  things: **deleted.** `scripts/mcp_smoke.py`: updated args.

**App/runtime residue:**
- `app/steps.py` — receipt/label/category logic parses old dotted `field_key`/
  `field_keys` tool args (`_db_tool_detail_kwargs`, `_label_args`, `_category_of`):
  **rewritten** for metric refs + the CellInput grammar, alongside `step_labels.yaml`.
- The MCP env allowlist in `app/toolset.py` drops the embed/reconcile variables it
  currently forwards.

**Assets:**
- `config/assets/abbreviations.yaml` — every expansion hand-tuned to old IPEDS
  `schools.name` strings ("University of California-Los Angeles"): **regenerated** —
  audited against `school_profiles.aliases[]`/`search_name`; entries the pipeline's
  aliases already cover are dropped.

**Tests + evals:**
- Deleted with their subjects: `tests/counselle_db/test_reconcile.py`,
  `test_search_fields*.py`, `tests/domain/test_normalize*.py`, `test_tiers.py`,
  `test_vintage.py`.
- Rewritten with their subjects: the `tests/counselle_db/` service/server/live suites,
  `tests/app/` fixtures carrying dotted keys / `raw.ipeds_adm2024` / `ascensia` DSNs
  (`test_sources.py`, `test_state.py`, `test_steps.py`, `test_toolset.py`,
  `test_viz*.py`, `test_checkpointer.py`, `tests/test_settings.py`),
  `tests/api/` wire suites via regenerated protocol fixtures.
- `evals/runner.py` viz scorer (keys on flat `schools[*].unitid`): **rewritten** with
  RenderSpec v2. `evals/report-*.json`: historical artifacts, left as-is.

**Docs:**
- `docs/DEPLOY.md` — first-boot field-index-embed guidance: **rewritten out.**
- `docs/ARCHITECTURE.md` §8 (counselle-db server), §10 (field discovery), §11
  (coverage tiers): **rewritten** to the new contract.
- ADRs 0007 (hybrid field discovery) + 0008 (embedding reconciliation) document a
  feature this rewire deletes outright: they get explicit **"Superseded by the db-rewire
  ADR"** banners (a new ADR records this rewire's decisions). Other old-DB ADRs
  (0002, 0004, 0005, 0006, 0012, 0014) stay as historical records per house convention.
- `docs/DATABASE_GUIDE.md`: full rewrite (already §14.2 step 2).

**Frontend:**
- Live `frontend/src`: only the already-scoped wire types + citations branches (§14.1).
  Favicon logic is string-based and clean.
- `frontend.backup-20260705-070513/` — a tracked, stale frontend generation full of
  old-DB-shaped types; permanent grep noise. **Recommend deleting the directory** when
  the rewire lands (owner call — it's a backup, not live code).
- `mvp3-frontend/`: swept, zero hits, clean.

### 15.4 Residue grep gates

After the rewire, these literals must produce **zero hits** outside the historical
zones (`specs/`, `plans/archive/`, `docs/adr/` records, `evals/report-*` artifacts):

```
ascensia            field_values          raw\.ipeds_          raw\.files
decode_ipeds        value_vintage         public\.fields       FROM schools\b
coverage_tier       cds_pdf_only          cds_extracted        CoverageTier
_DERIVED_FILTERS    SOURCE_PREFERENCE     institution\.website
reconcile_field_index                     counselle\.field_index
reconcile_interval_minutes                embed_dimensions     vector_search_enabled
field_key\b   (as a tool-arg/wire shape — replaced by metric_ref / profile_field)
"ipeds" / "scorecard"   (as source literals in code — allowed in past-tense prose)
```

The last two lines need literal-aware matching (string literals in code, not English
prose); the rest are safe as raw greps. Run as a checklist at review time — cheap, no
CI machinery built for it (house rule; CI was explicitly declined).

### 15.5 Acceptance

The rewire is done only when: (1) every §15.3 disposition is executed; (2) the §15.4
gates come back clean; (3) migration 0012 has run (old helper functions + field_index
gone from counselle's schema); (4) the routine + live test suites and the eval set run
green against the new DB with the old database **not running** — the final proof that
no hidden dependency remains.

---

## 16. The project rename: `councelle` → `counselle` (pipeline repo)

The pipeline project name was a typo from day one. Corrected everywhere:
repo dir `councelle-data-pipeline` → `counselle-data-pipeline`, Python package
`councelle_data_pipeline` → `counselle_data_pipeline`, database `councelle_data` →
`counselle_data`. Postgres roles (`cds_library_*`) are already correctly named — no
role changes. Audit-complete inventory:

**A. Repo/package identity** — repo dir (filesystem); `pyproject.toml` (`name`,
`packages`, the `config/cds` hatch force-include path, the `cds-library` entry-point's
*target module* — the command name itself stays); `src/councelle_data_pipeline/` →
`src/counselle_data_pipeline/`; reinstall the editable venv (never hand-edit
`site-packages`/`.pth`).

**B. Source code** — all imports across `src/` and the 27 `tests/*.py` files;
self-referential path literals: `cli.py` (×3, `src/councelle_data_pipeline/data/
schools.json`), `library/profiles.py` (source-map default path).

**C. ⚠️ `config.py` — functional, must move in lockstep with the DB rename:** the
`database_url` default DSN *and* the live validation that **raises unless the DSN path
is literally `/councelle_data`**. Change default + check together with C/D below or
every deploy breaks.

**D. ⚠️ Database + compose — the two high-risk items:**
- DB `councelle_data` → `counselle_data`: `ALTER DATABASE … RENAME` (or dump/restore)
  on live instances, coordinated with `docker-compose.yml` (`POSTGRES_DB`, healthcheck,
  3× DSNs), `.env.example` (2× DSNs), real operator `.env` files, and Counselle's
  `COUNSELLE_DB_RO_DSN` once wired.
- **Compose project-name trap:** the volume is `postgres_data`, but Compose prefixes
  volumes with the directory name — renaming the repo dir silently re-points Compose at
  a fresh empty volume (`counselle-data-pipeline_postgres_data`), orphaning the data.
  Pin `COMPOSE_PROJECT_NAME` (or use `docker volume` rename/copy) as an explicit rename
  step, and verify row counts after.

**E. Ops/docs** — `docs/runbooks.md` (`PGSERVICE=councelle-data-backup` — also lives in
each operator's out-of-repo `~/.pg_service.conf`; backup paths; `createdb
councelle_data_restore`); `Dockerfile` CMD module path; compose image tag
`councelle-data-pipeline:*` + its `tests/test_config.py` literal; `README.md`,
`docs/architecture.md` (13+ path refs), `docs/reference/*`. Historical `specs/`/`plans/`
docs: **leave as-is** (historical records, per house rules).

**F. Needs a human check before touching:** `tests/test_config.py`'s
`councelle.tailnet.ts.net` origin fixtures look like the *real* Tailscale node name —
confirm with infra whether the tailnet node is being renamed too; if not, the fixture
stays.

**G. Counselle repo side:** audit-verified **zero** occurrences in counselle source —
the repos are cleanly decoupled; only this spec and `specs/README.md` mention the old
name, updated when the rename ships.

---

## 17. Open decisions (settle before/at implementation start)

1. **IPEDS/Scorecard breadth.** The new DB deliberately excludes annual
   IPEDS/Scorecard metrics. Working assumption: accept the reduction (web fallback;
   bulk extraction closes the gap over time). If a first-party time-series surface is
   added later, §6/§13.1 already hold the seam (one data-picture line + one routing
   rung + one read path). Programs/earnings (`get_programs`) has no replacement without
   it.
2. **Counselle's own schema home** (`counselle.*`): a schema inside the (renamed)
   pipeline DB vs. its own database. Either works with the existing dual-DSN setup.
3. **Bulk-extraction dependency:** product breadth tracks pipeline coverage
   (`specs/queue-progress-and-bulk-extraction/`). Not a Counselle decision, but the
   assumption behind "coverage grows; the denominator caveat shrinks."
4. **Rename logistics (§16):** timing of the live-DB rename + who pins
   `COMPOSE_PROJECT_NAME`; the tailnet-hostname question (§16.F).
5. **`frontend.backup-20260705-070513/` deletion (§15.3):** recommended for removal
   when the rewire lands — permanent old-DB grep noise otherwise. Owner call.
