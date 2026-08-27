# CDS Manager — Counselle backend recon

Repo: `/home/saifuddin/Projects/counselle/.worktrees/cds-pipeline` (worktree of `counselle`).
Read `AGENTS.md` first — house rules govern everything below (KISS, no TDD except
honesty-critical code, files <800 lines / functions <50, parameterized SQL only,
extend-don't-rewrite).

**Headline finding (read this before anything else):** `COUNSELLE_DB_APP_DSN`
(`counselle_app` role, which owns `counselle.*`) has **no write access to
`cds_library.*`** base tables (`schools`, `cds_documents`, `cds_domain_packets`,
`cds_extractions`, `cds_manifests`). `docs/DATABASE_GUIDE.md` §1 states this as a hard
rule: "`COUNSELLE_DB_APP_DSN` ... is not the pipeline writer role and must not grant
access to CDS Library base tables." `scripts/setup_db.sql` only grants `counselle_ro`
(via the `cds_library_reader` NOLOGIN group) `SELECT` on five *views* — nothing writes
to `cds_library` today from Counselle. Building the new CDS manager **inside** Counselle
therefore requires a new DB credential/role with INSERT/UPDATE on the `cds_library`
base tables (or a deliberate decision to house the new pipeline's write schema
elsewhere and repoint the five reader views). This is the first architectural decision
to make, before any routes/migrations are written.

---

## 1. API layer

`api/main.py` is the FastAPI app factory (`create_app()`). Read it end to end —
it's short (263 lines) and is the map of every existing surface.

**Router registration pattern** (copy exactly for a new router):
```python
# api/main.py imports
from api.routes import (
    activities, applications, documents, essay_prompt_drafts, essays, me,
    memories, onboarding, profile, sessions, system, tasks, workspace_events,
)
from api.routes import config as config_routes
...
def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Counselle", version="0.1.0", lifespan=_lifespan)
    install_middleware(app, settings)
    _install_auth_routers(app, settings)
    app.include_router(sessions.router, prefix="/v1")
    ...
    app.include_router(documents.router, prefix="/v1")   # <- closest precedent
    ...
    _install_spa_routes(app, settings)
    return app
```
A new `api/routes/cds_admin.py` (or similar) would define `router = APIRouter(tags=["admin"])`
and get one `app.include_router(cds_admin.router, prefix="/v1")` line added in
`create_app()`, in the same block as the other workspace routers (before
`_install_spa_routes`, which is the catch-all SPA fallback and must stay last).

**Route file convention** (`api/routes/documents.py`, `api/routes/tasks.py` are the
best templates — file <160 lines, one `APIRouter()`, thin translation layer only):
- `router = APIRouter(tags=["workspace"])` (or a new tag, e.g. `["admin"]`).
- Route functions take `request: Request`, a `Depends(current_active_user)` (or a new
  admin dependency — see §2), and return `object` (FastAPI infers the response shape
  from the returned Pydantic model / list — no `response_model=` boilerplate observed
  anywhere in `api/routes/`).
- Business logic never lives in the route — every route body is 3–10 lines that pulls
  runtime pieces via `runtime_parts(request)` (`api/routes/workspace_common.py:15`),
  calls one `app/workspace/service_*.py` function, and wraps it in
  `map_workspace_errors(...)` (`api/routes/workspace_common.py:28`) to translate
  `WorkspaceNotFoundError`/`WorkspaceValidationError` into the HTTP envelope.
- State-changing POST/DELETE/PATCH routes declare
  `dependencies=[Depends(require_json), Depends(workspace_write_rate_limit)]` (see
  `api/routes/tasks.py:47-50`) or, for multipart uploads,
  `dependencies=[Depends(workspace_write_rate_limit), Depends(auth_origin_protect)]`
  (`api/routes/documents.py:53-55` — multipart can't go through `require_json`, so
  `documents.py` is the exact precedent for a file-upload route).

**Dependency-injection pattern.** `request.app.state.runtime` is the one DI root — it's
an `app.deps.Runtime` (see §7) set up once in the FastAPI lifespan and read from every
request. `api/routes/workspace_common.py:15` (`runtime_parts`) is the standard accessor:
```python
def runtime_parts(request: Request) -> tuple[Any, Any, WorkspaceEventBus]:
    runtime = request.app.state.runtime
    event_bus = runtime.deps.workspace_events
    ...
    return (runtime.app_pool, runtime.deps.catalog, event_bus)
```
A CDS-admin route needing the RO pool too would add `runtime.ro_pool` to a similar
tuple/dataclass, or just read `request.app.state.runtime.ro_pool` directly (both
patterns exist in the codebase).

**Error envelope convention** (`api/deps.py` + `api/context.py`):
- All user-safe errors are raised as `api.deps.EnvelopeError(status_code, message,
  headers=None)` and rendered by `envelope_error_handler` into
  `{"error": {"message": ..., "trace_id": ...}}` (`api/deps.py:27-51`).
- Any *unhandled* exception is caught globally by `unhandled_exception_handler`
  (`api/context.py:75-87`) → 500 + the same envelope shape, full traceback logged with
  the trace id, never leaked to the client.
- Service-layer domain errors (`WorkspaceNotFoundError`, `WorkspaceValidationError`)
  are translated at the route boundary via `map_workspace_errors`
  (`api/routes/workspace_common.py:28-37`) — 404 for not-found, 422/409 for validation
  (409 when the message contains "already active"). A new CDS-admin service layer
  should define its own narrow exception types and its own translator function
  following this exact shape, rather than reusing `WorkspaceNotFoundError` (those are
  workspace-domain-specific).

**SSE pattern** (`api/sse.py`, 60 lines) — only relevant if the extraction job needs a
live progress stream. `encode_sse(event: domain.events.Event, seq: int) ->
ServerSentEvent` wraps a typed `domain.events.Event` into an SSE frame; routes return
`EventSourceResponse(generator(), headers=SSE_HEADERS, ping=settings.sse_keepalive_s)`.
This is wired into the existing turn-streaming routes (`api/routes/sessions.py`) — not
already used for anything document/admin-shaped. If admin extraction jobs want live
progress, this is the seam to reuse, but a simpler polling `GET
/v1/admin/cds/jobs/{id}` (matching the rest of the workspace CRUD style) is more in
line with "KISS, no infra you don't need yet."

**Request/response model conventions**: request bodies are plain Pydantic models
imported from the relevant `app/*/models.py` (e.g. `app.workspace.models.TaskCreate`)
or a route-local `BaseModel` for multi-field bulk bodies (`api/routes/tasks.py:29-34`,
`BulkStatusBody`/`BulkArchiveBody`). No `response_model=` is declared; routes return the
Pydantic model instance or `list[...]` directly and let FastAPI serialize it.

---

## 2. Auth & admin

**Auth mechanism** (`api/auth.py`, `api/users_db.py`): fastapi-users with a cookie-JWT
backend, wired in `api/main.py:_install_auth_routers`. Google OAuth is optional
(`google_oauth_client()` returns `None` when creds aren't configured).
`current_active_user = fastapi_users.current_user(active=True)` (`api/auth.py:269`) is
the standard `Depends(...)` used on every authenticated route today.

**Admin/superuser DOES already exist as a schema column and a fastapi-users
dependency, but is completely unused elsewhere in the codebase:**
- `migrations/0004_users.sql:11`: `is_superuser boolean NOT NULL DEFAULT false` on
  `counselle.users`.
- `api/users_db.py`: `UserDB` dataclass carries `is_superuser: bool`
  (`api/users_db.py:69`), read/written in the asyncpg adapter's row mapping
  (`:82`) and INSERT (`:169-179`).
- `api/auth.py:270`: `current_superuser = fastapi_users.current_user(active=True,
  superuser=True)` — **already defined, exported, but grepping the whole
  codebase (`grep -rn current_superuser`) shows this is the only reference; it is
  wired nowhere.** No route uses it. No UI sets `is_superuser=true` on any user (no
  admin-promotion route, no CLI script, no seed).

**Cheapest correct way to gate a CDS-admin route:**
1. Reuse `current_superuser` directly as the route's `Depends(...)` principal — it
   already asserts `is_active=True AND is_superuser=True`, and a 401/403 on a
   non-superuser is fastapi-users' stock behavior. Zero new auth code needed.
2. To actually grant a user superuser status today there is no route — flip the column
   by hand: `UPDATE counselle.users SET is_superuser = true WHERE email = '...'`. If the
   plan wants a friendlier path, that's a small one-off addition (e.g. a `scripts/`
   utility or a one-line migration bootstrapping one admin email from an env var) —
   still "cheapest correct," not a new subsystem.
3. `dependencies=[Depends(current_superuser)]` at the router or per-route level is the
   idiomatic FastAPI shape already used elsewhere in this codebase for gating
   (`dependencies=[Depends(workspace_write_rate_limit), Depends(auth_origin_protect)]`
   pattern, `api/routes/documents.py:53-55`).

No separate "role" table/enum exists — `is_superuser` is a flat boolean, which is fully
sufficient for a single admin surface (no need to build an RBAC system — YAGNI per
AGENTS.md).

---

## 3. DB access (`counselle_db/`)

| File | Role |
|---|---|
| `counselle_db/db.py` | `create_pool()` — asyncpg pool factory; jsonb/json codec registration (`_init_connection`); `fetch()` helper. Used by both the app (RO pool) and the credential-isolated MCP child. |
| `counselle_db/catalog.py` | `Catalog` — atomic immutable in-memory snapshot of the manifest + school profiles + coverage, refreshed on a TTL (`data_catalog_refresh_seconds`). Loaded once via `Catalog.load(pool, settings=...)`. |
| `counselle_db/service.py` | The four-tool CDS Library service API: `resolve_school`, `get_school_profile`, `get_domain`, `query_database` (+ `search_school_names`). Plain async functions over asyncpg, imported directly by `app/` (ADR 0017 deviation 1) *and* thinly wrapped by the MCP server for the LLM tool loop. |
| `counselle_db/packets.py` | Packet/manifest parsing (`parse_packet_row`, `compile_manifest`, `ManifestSnapshot`/`ManifestDomain`/`ManifestMetric` types, hashing). |
| `counselle_db/formatting.py` | Value formatting helpers (`format_cds_edition`, `format_decimal`) used when rendering packet values. |
| `counselle_db/models.py` | Pydantic result types: `ResolvedSchool`, `ProfileGroupResult`, `DomainResult`, `QueryResult`, `SchoolCoverage`, `ServiceError`, etc. |
| `counselle_db/server.py` | The MCP shell (`FastMCP("counselle-db", ...)`) — thin wrapper exposing exactly four tools to the LLM; its own subprocess, own lifespan, own `AppState(catalog=...)`. |

**Two DSNs, strict separation** (`config/settings.py:207-208`, `docs/DATABASE_GUIDE.md`
§1):
- `db_ro_dsn` (`COUNSELLE_DB_RO_DSN`) — `counselle_ro` role, member of NOLOGIN
  `cds_library_reader`, `SELECT`-only on exactly five `cds_library.*` views
  (`school_profiles`, `active_cds_documents`, `active_cds_domain_packets`,
  `cds_document_sources`, `cds_manifest_snapshots`). Used for `ro_pool` in
  `app.deps.build_runtime`.
- `db_app_dsn` (`COUNSELLE_DB_APP_DSN`) — `counselle_app` role, owns `counselle.*`
  schema (users, sessions, workspace, checkpointer). Used for `app_pool`. **Cannot
  write `cds_library.*`** — see the headline finding above.

**Parameterized queries**: every query in `counselle_db/service.py` and
`app/workspace/service_*.py` is `asyncpg`-parameterized (`$1`, `$2`, …), never
f-string-interpolated, with `# nosec B608` comments on the rare cases where a SQL
fragment (never a value) is conditionally included, e.g.
`app/workspace/service_documents.py:44-51`:
```python
archived_clause = "" if include_archived else "AND archived_at IS NULL"
...
rows = await conn.fetch(
    f"""SELECT {_METADATA_COLUMNS} FROM counselle.documents
        WHERE user_id = $1 {archived_clause} ORDER BY created_at DESC""",
    user_id,
)
```
This is the exact pattern to copy for a new admin write path: `app_pool.acquire()` →
`conn.transaction()` → parameterized `INSERT ... RETURNING ...` → build a typed
Pydantic model from the row (`Model.model_validate(dict(row))`).

**The seam where a new WRITE path lives.** There is no existing writer for
`cds_library.*` in this codebase — Counselle has never had one (by design, ADR 0012).
Options, in order of how much they preserve the current architecture:
1. **New role + new DSN** (e.g. `COUNSELLE_DB_PIPELINE_DSN` / `counselle_pipeline_app`
   role) granted INSERT/UPDATE on the `cds_library` base tables, added to
   `config/settings.py` `Settings` next to `db_ro_dsn`/`db_app_dsn`, a new pool in
   `app.deps.build_runtime`, and a new `counselle_db/` (or sibling) module,
   `counselle_db/pipeline_writer.py` or similar, mirroring `service.py`'s shape but for
   writes. This is the option that respects ADR 0012's "reader role has zero write
   authority" boundary while still allowing writes from a *different*, explicitly
   privileged role — cleanest match to the existing security model.
2. Extend `counselle_app`'s grants to also cover `cds_library` base tables — rejected
   by `docs/DATABASE_GUIDE.md`'s explicit prohibition; would need an ADR override.
3. House new extraction output in a **new `counselle.*` (or new schema) table set**
   that the reader views get repointed to (bigger structural change touching the
   pipeline's view definitions — likely out of scope for "inside Counselle" unless the
   goal is literally to retire the separate `cds_library` schema entirely).

Whichever option, `app/deps.py`'s `AppDeps`/`build_runtime` is exactly where a new pool
and service object would be threaded through (it already threads `ro_pool` vs
`app_pool` vs `catalog` vs `mcp_toolset` the same way — see §7).

---

## 4. Migrations (`migrations/`)

- **Tooling**: `yoyo-migrations[postgres]` (pinned in `pyproject.toml`), applied with
  `yoyo apply --batch --database "<dsn>?schema=counselle" migrations/`. Real invocation
  sites: `scripts/entrypoint.sh:24` (prod container boot, runs before `exec uvicorn`)
  and `scripts/dev.py:360` (dev launcher). `README.md:46` documents the manual command.
  **No `yoyo.ini` file exists** — schema/config passed via the `?schema=counselle`
  query param on the DSN each invocation, so yoyo's own bookkeeping table lives inside
  `counselle` schema, not `public`.
- **Naming**: `NNNN_description.sql` + a paired `NNNN_description.rollback.sql`
  (14 pairs currently, `0001`…`0014`). Each `.sql` file starts with a one-line comment
  describing intent and a `-- depends: <prior-migration-stem>` directive (e.g.
  `migrations/0014_response_mode.sql:1-2`).
- **Scope**: `migrations/` is documented (`docs/ARCHITECTURE.md` repo-layout section)
  as "Counselle-owned migrations for the `counselle.*` schema ONLY" — never
  `cds_library.*`. If option 1 in §3 is chosen (new writer role), the DDL for any new
  `cds_library` tables/columns is **out of scope for this migrations folder** — it
  would need to be either (a) applied by a separate migration path scoped to whatever
  schema the pipeline data lives in, or (b) a new `migrations/` directory the new
  writer DSN targets with its own `?schema=` value, mirroring the existing yoyo
  convention exactly. A purely additive `counselle.*` migration (e.g. new
  `counselle.cds_admin_jobs` table to track extraction runs/approval state) is the
  in-scope case and follows the exact `NNNN_name.sql` / `NNNN_name.rollback.sql`
  pattern above with `-- depends: 0014_response_mode`.
- **Rollback convention**: every migration has a paired rollback file; `yoyo`'s rollback
  command is not itself demonstrated anywhere in scripts (only `apply --batch` is
  wired), but the rollback files exist for manual/CI use.

---

## 5. Settings/config (`config/settings.py`, 502 lines)

- One `Settings(BaseSettings)` class (`config/settings.py:149`), `env_prefix =
  "COUNSELLE_"`, loaded once via `@lru_cache get_settings()` (`:462-474`), which
  aggregates all `pydantic.ValidationError`s into one readable boot-time failure
  message — "fail fast" is enforced here, not scattered `if not X: raise` checks.
- Secrets are named in `_SECRET_FIELDS` (`:46-56`) and masked in `__repr__`/`__str__`
  (`:120-127`, `:426-437`) — never log a raw `Settings()` object; anything printed goes
  through the masking.
- **Model ids live directly as `Settings` string fields**, provider-prefixed
  (`config/settings.py:163-178`):
  ```python
  model_counselor: str = "google-vertex:gemini-3.5-flash"
  model_counselor_think: str = "google-vertex:gemini-3.1-pro-preview"
  model_cheap: str = "google-vertex:gemini-2.5-flash"       # <- the cheap tier
  model_clarifier: str = "google-vertex:gemini-2.5-flash"
  model_title: str = "google-vertex:gemini-2.5-flash"
  ```
  A new CDS-extraction model setting would follow this exact convention, e.g.
  `model_cds_extraction: str = "google-vertex:gemini-3.5-flash"` (or reuse
  `model_cheap`/`model_counselor` if the extraction quality bar doesn't need a
  dedicated knob — check the value×ease call before adding a new field).
- **Vertex/GCP credentials**: `vertex_api_key: str | None` (`:257`) is the Vertex
  Express Mode API key (mirrored from the pipeline repo per `AGENTS.md`); optionally
  `GOOGLE_APPLICATION_CREDENTIALS` (standard unprefixed env var, deliberately **not** a
  `Settings` field — see the module docstring, `:9-11`) for service-account auth.
  `google_cloud_project` / `google_cloud_location` (`:258-259`) are also present but the
  actual model construction path (§6) uses the API-key `GoogleCloudProvider`, not
  project/location — this pair looks currently unused by the real code path (verify
  before relying on it).
- **Model pricing** lives in `model_prices: dict[str, ModelPriceTier]`
  (`:403-416`) — a new extraction model would need an entry here if
  `usage_accounting` should cover it (`app/usage.py` is the consumer, not inspected in
  this recon pass).
- **Editorial/versioned assets** (prompts, yaml menus) load through `load_prompt(name)`
  / `load_yaml_asset(name)` (`:482-493`), reading from `config/assets/`. A new
  extraction system prompt would be a new file under `config/assets/prompts/`, loaded
  the same way `document_summary.py` loads `load_prompt("document_summary")`
  (`app/workspace/document_summary.py:67`).
- **`DbChildSettings`** (`:59-95`) is a *separate*, minimal settings surface for the
  credential-isolated MCP child process — note it already carries
  `supported_packet_extractor_versions` (`:69-76`, mirrored in the main `Settings` at
  `:214-221`) listing the **old** pipeline's extractor version tags
  (`gemini-native-pdf-v2/v5`, `gemini-routed-extraction-v7/v8`). This is metadata about
  packets already in the DB, read-only from Counselle's side — it is not itself a
  seam for driving a new extraction run, just evidence of what extractor-version
  strings currently exist in the data.

---

## 6. LLM calling (Vertex AI today)

**Provider/library**: PydanticAI (`pydantic-ai>=1.107.0` in `pyproject.toml`), model
seam is PydanticAI's own `model=` constructor argument per ADR 0017 (never
hand-wrapped). Two real construction sites, both using the *same* explicit-auth
pattern (a bare `"google-vertex:"` prefix does NOT work — it resolves to an
ambient-credentials provider this app can't authenticate with):

1. **`app/agent_node.py:254-273`** (`default_model_factory`) — the main counselor
   agent's model:
   ```python
   from pydantic_ai.models.google import GoogleModel
   from pydantic_ai.providers.google_cloud import GoogleCloudProvider

   def default_model_factory(settings: Any, model_setting: str) -> Model:
       if not settings.vertex_api_key:
           raise RuntimeError("COUNSELLE_VERTEX_API_KEY is not set ...")
       return GoogleModel(
           model_name_from_setting(model_setting),          # strips "google-vertex:" prefix
           provider=GoogleCloudProvider(api_key=settings.vertex_api_key),
       )
   ```
   `model_name_from_setting` (`:247-251`) is a one-liner: `model_setting.split(":",
   1)[-1]`.

2. **`app/workspace/document_summary.py:113-139`** (`_summary_model`) — the cheap-model
   document-summary agent, **exact same pattern**, duplicated (not shared as a helper —
   worth noting for a new extraction caller: either copy this pattern a third time, or
   this is a good moment to extract a shared `build_google_model(settings,
   model_setting)` helper, since three near-identical copies would cross the DRY
   threshold AGENTS.md calls out).

**Structured output**: yes, used extensively via PydanticAI's typed `Agent` +
`ToolOutput` (`app/clarification.py`'s `ClarifyDraftV2` structured output tool is the
deepest example — `app/agent_node.py:47` docstring references
`ToolOutput(ClarifyDraftV2, name="ask_student")`). The simplest precedent for "call a
model, get back a normalized string" is `document_summary.py:52-84`
(`summarize_document`) — plain `Agent(model, system_prompt=...)`, `agent.run(prompt)`,
`asyncio.wait_for(..., timeout=...)`, then a hand-written validator
(`normalize_document_summary`, `:142-167`) that rejects any output not matching an
exact expected shape (never trusts free-form model prose). **A new PDF-extraction
agent producing a typed packet would use PydanticAI's `output_type=SomePydanticModel`
on the `Agent(...)` constructor** (not demonstrated directly in this codebase yet, but
it's the standard PydanticAI structured-output mechanism used by the pipeline's own
extraction and by `ask_student` here) rather than the manual post-hoc parsing
`document_summary.py` uses for its narrower string contract.

**PDF/vision/file input**: **does not exist anywhere in this codebase.** Grepped for
`BinaryContent`, `DocumentUrl`, `ImageUrl`, `from_bytes`, `media_type=` across
`app/`, `adapters/`, `counselle_db/` — zero matches outside tests. All PDF handling
today (`app/workspace/extraction.py`) is **text extraction only** via `pypdf`
(`PdfReader(...).extract_text()`), never sending PDF bytes to a model. A new CDS PDF
extraction engine that wants Gemini to read the PDF directly (native PDF/vision input,
which the old pipeline's `gemini-native-pdf-v2/v5` extractor tags imply it already does)
would be the **first use of PydanticAI's multimodal input** (`BinaryContent(data=...,
media_type="application/pdf")` passed in the user prompt list) in this repo — net-new
capability, not an existing pattern to copy.

**Cheap-tier model id**: `model_cheap: str = "google-vertex:gemini-2.5-flash"`
(`config/settings.py:174`). (Synthesis-tier default is `gemini-3.5-flash`;
`gemini-3.1-pro-preview` is the "Think" mode's heavier model.)

---

## 7. Background/async work

**No job queue, no worker process, no persistent task table exists.** What's actually
here:

- **`asyncio.create_task`**, fire-and-forget, in three places:
  - `app/turns.py:463,561` — the `TurnRegistry`'s in-process turn driver: each chat
    turn runs as a detached `asyncio.Task` so the HTTP/SSE layer can disconnect and
    reattach (`app/turns.py`, referenced from `api/main.py:100`,
    `registry = TurnRegistry(deps=runtime.deps, graph=runtime.graph, settings=settings)`).
    This is genuinely the closest existing precedent for "kick off long-running async
    work, track its state, let a client poll/stream it" — it's in-process, in-memory
    (a ring buffer per turn, `agent_stream_buffer_size`/`stream_buffer_bytes` settings),
    with a registry object living on `app.state.turn_registry`.
  - `app/turns.py:966` — `on_turn_complete` hook (auto-titling), same fire-and-forget
    `asyncio.create_task` shape.
  - `api/supervision.py:95` — the MCP child-process supervisor's watchdog loop.
- **No FastAPI `BackgroundTasks`** usage anywhere (`grep -rn "BackgroundTasks"` →
  zero hits).
- **Document upload/extraction/summarization today is synchronous, in-request**, not
  backgrounded: `POST /v1/documents` (`api/routes/documents.py:56-90`) awaits
  `prepare_document_upload` (pypdf/docx parsing, `asyncio.to_thread`-wrapped with an
  8s timeout, `app/workspace/extraction.py:66-106`) and the summary-model call
  (`document_summary.py`, also timeout-wrapped) inline, before returning 201. This
  works because those calls are bounded to single-digit seconds.

**What this means for the new CDS extraction jobs**: if per-PDF extraction (Gemini
native-PDF structured extraction) stays in the same single-digit-seconds-to-tens-of-
seconds range as the existing summary call, the **simplest correct thing is to copy the
`document_summary.py` shape** — an async function, `asyncio.wait_for(agent.run(...),
timeout=...)`, called synchronously from the admin upload/extract route, no queue at
all (KISS, matches "startup mode" in AGENTS.md). If extraction jobs are expected to run
much longer (minutes, batch re-extraction of many schools/years), the closest existing
building block to extend is `app/turns.py`'s `TurnRegistry` pattern — an in-process
registry of `asyncio.Task`s keyed by job id, with a status the admin UI polls — **not**
a new external queue (Celery/RQ/etc. would be over-engineering relative to what exists
here and what AGENTS.md's value×ease framing calls for). There is no Redis, no Celery,
no RQ dependency anywhere in `pyproject.toml` — introducing one would be a new
infrastructure dependency, which the "never reinvent/never over-build" principle in
`AGENTS.md` weighs against unless job duration genuinely demands it.

---

## 8. Layering rules (`domain/ → app/ → adapters/ → api/`)

ADR 0017 (`docs/adr/0017-layered-core-stack-native-seams.md`) + `docs/ARCHITECTURE.md`
§4 are the canonical statements. Rule: **dependencies point inward only** —
`domain/` has zero I/O/LLM/framework imports (pure Pydantic + stdlib); `app/` imports
`domain/` + the stack (LangGraph/PydanticAI); `adapters/` imports `domain/` + vendor
SDKs (asyncpg, Tavily, email); `api/` imports `app/` + `domain/` for FastAPI routing/SSE
translation. Two **explicitly accepted deviations** are documented in the ADR, and
nothing else — this list is exhaustive as of today (the second deviation, an `api/` →
`counselle_db.reconcile` import, was **retired** — the reconciler no longer exists;
`api/routes/system.py` today is health-check-only, no reconcile route):

1. `app/` imports `counselle_db/service.py` directly, in-process (bypassing the MCP
   protocol), for `render_viz`, the data calendar, and tier checks — because those are
   Counselle's own code calling its own DB layer, not the LLM's tool loop.

**Concrete end-to-end trace — the document-upload feature** (closest existing analog to
the new CDS-manager surface, worth re-reading in full before designing the new one):

```
api/routes/documents.py :: create_document_route(...)          [API edge]
  → reads multipart file+form fields, size-caps, builds DocumentUpload
  → app.workspace.service_documents.upload_document(...)        [app/ service]
      → app.workspace.extraction.prepare_document_upload(...)   [app/ — validation +
        pypdf/docx text extraction, off-loop via asyncio.to_thread]
      → app.workspace.document_summary.summarize_document(...)  [app/ — PydanticAI
        Agent construction incl. the explicit GoogleModel/GoogleCloudProvider
        adapter-shaped code inline in app/, not adapters/ — see note below]
      → app.workspace.service_documents.create_document(...)
          → asyncpg INSERT into counselle.documents via app_pool  [DB write,
            parameterized, inside conn.transaction()]
          → app.workspace.changes.record_change(...) + make_change_event(...)
          → app.workspace.service_utils.publish_events(event_bus, ...)
              → WorkspaceEventBus (in-process pub/sub, no adapters/ involvement —
                it's app-internal state, not an external system)
  ← Document (pydantic model) returned up through the call chain
  ← route returns it; FastAPI serializes to 201 JSON
```

Note the one wrinkle worth flagging for the new pipeline design: the Google model
construction in `document_summary.py` (`_summary_model`, imports
`pydantic_ai.models.google.GoogleModel` / `pydantic_ai.providers.google_cloud
.GoogleCloudProvider` directly) lives in `app/`, not `adapters/`, even though it's
vendor-SDK construction — this matches ADR 0017's "PydanticAI `model=` is the model
seam, no hand-rolled wrapper" rule (there's no `adapters/vertex.py`; the vendor call is
inline where it's used, once per call site). A new extraction agent's model
construction should follow the same placement (inline in the `app/` module that builds
the extraction `Agent`, not a new `adapters/` file) — unless it's finally worth
factoring the now-three-times-duplicated `GoogleModel`/`GoogleCloudProvider`
construction into one shared helper (see §6 DRY note).

For a **new CDS-admin write path**, the layering shape should mirror this trace:
`api/routes/cds_admin.py` (thin, multipart/JSON translation only) → a new
`app/cds/service_*.py` (or similar) module doing validation + orchestration → a new
extraction module (PydanticAI `Agent` construction, inline per ADR 0017) → a new
writer in `counselle_db/` (or a parallel package) for the actual `INSERT`s into
whatever schema is chosen per §3.

---

## Open questions for the plan (not answered by recon — decisions, not facts)

1. **Where does new CDS pipeline data live?** New role writing `cds_library.*` base
   tables directly, vs. a net-new schema Counselle owns and the reader views get
   repointed to. This is the load-bearing decision — see the headline finding.
2. **Extraction call shape**: synchronous single-PDF PydanticAI call (mirrors
   `document_summary.py`) vs. a `TurnRegistry`-style in-process job registry, depends on
   real per-PDF extraction latency (unmeasured here — the old pipeline's own
   extraction code, in the separate `counselle-data-pipeline` repo, was out of scope
   for this recon pass and wasn't inspected).
3. Whether the "school × year coverage grid" reads through the existing
   `counselle_db.service`/`Catalog` read path (likely yes — it already computes
   `SchoolCoverage`, `counselle_db/catalog.py` has a `_COVERAGE_SQL` query) or needs a
   new read query against the new pipeline's own tables.
