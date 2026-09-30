# Counselle — System Architecture

> The complete architecture for Counselle, in two parts. **Part I (§1–25)** is the **agent service** — the honesty-first agent behind a versioned API. **Part II (§26–41)** is the **full-stack app** built on top of it — auth, chat management, the work-visibility protocol extensions, the React frontend, the student profile/document/memory stores, first-run onboarding, the facts store and crawl, and the Explore admit-rate estimate. Companion docs: `specs/` (PRDs & plans), `docs/DATABASE_GUIDE.md` (the data contract), `docs/adr/` (one decision each), `docs/research/` (the stack survey).
>
> **This document describes the target architecture — how Counselle is designed and built, not what has shipped to date.** A few subsystems below are designed but not yet wired (e.g. the deep-research subagent, §13). For the current build status — what's implemented vs. pending, and the deployment state — see `CLAUDE.md`; it is the single source of progress truth.

---

## Table of contents

**Part I — The agent service**

1. [Guiding principles](#1-guiding-principles)
2. [The shape of the system: an API-first agent service](#2-the-shape-of-the-system-an-api-first-agent-service)
3. [The stack](#3-the-stack)
4. [Layering & the dependency rule](#4-layering--the-dependency-rule)
5. [Repository layout](#5-repository-layout)
6. [The agent API & event protocol](#6-the-agent-api--event-protocol)
7. [Sessions, state & the platform-ready identity model](#7-sessions-state--the-platform-ready-identity-model)
8. [The data-access layer: in-process facts-store tools](#8-the-data-access-layer-in-process-facts-store-tools)
9. [Fact states, provenance, and citation truth boundary](#9-fact-states-provenance-and-citation-truth-boundary)
10. [Dynamic catalog and fact keys](#10-dynamic-catalog-and-fact-keys)
11. [School coverage](#11-school-coverage-no-scope-gate)
12. [The agent runtime (PydanticAI + LangGraph)](#12-the-agent-runtime-pydanticai--langgraph)
13. [The deep-research subsystem (GPT-Researcher)](#13-the-deep-research-subsystem-gpt-researcher)
14. [External search & source control](#14-external-search--source-control)
15. [Skills (SKILL.md)](#15-skills-skillmd)
16. [Citations, recency & temporal context, end to end](#16-citations-recency--temporal-context-end-to-end)
17. [Visualizations](#17-visualizations)
18. [Configuration architecture](#18-configuration-architecture)
19. [Observability & cost accounting](#19-observability--cost-accounting)
20. [Deployment & day-one deployability](#20-deployment--day-one-deployability)
21. [Testing strategy](#21-testing-strategy)
22. [Feature → component traceability](#22-feature--component-traceability)
23. [The platform evolution path](#23-the-platform-evolution-path)
24. [Risks & mitigations](#24-risks--mitigations)
25. [Open questions](#25-open-questions)

**Part II — The full-stack app**

26. [The shape of the full-stack app](#26-the-shape-of-the-full-stack-app)
27. [Protocol extensions: work visibility, resume & cancel](#27-protocol-extensions-work-visibility-resume--cancel)
28. [Identity & auth](#28-identity--auth)
29. [Chat management](#29-chat-management)
30. [Feedback & per-user rate limiting](#30-feedback--per-user-rate-limiting)
31. [The frontend](#31-the-frontend)
32. [Configuration delta](#32-configuration-delta)
33. [Deployment of the full-stack app](#33-deployment-of-the-full-stack-app)
34. [Frontend testing strategy](#34-frontend-testing-strategy)
35. [Risks & open questions](#35-risks--open-questions)
36. [Student profile, documents & agent memory](#36-student-profile-documents--agent-memory)
37. [Onboarding](#37-onboarding)
38. [The CDS extraction pipeline & admin surface (parked)](#38-the-cds-extraction-pipeline--admin-surface-parked)
39. [The essay surface & the suggestion lifecycle](#39-the-essay-surface--the-suggestion-lifecycle)
40. [The CollegeData facts crawl pipeline & admin surface](#40-the-collegedata-facts-crawl-pipeline--admin-surface)
41. [The Explore admit-rate estimate](#41-the-explore-admit-rate-estimate)

---

# Part I — The agent service

## 1. Guiding principles

1. **Honesty lives in code, never in the LLM's head.** The fact-state boundary (§9) resolves every requested key to exactly one of five states, and the citation envelope enforces that Counselle's own data carries no fake source tier. The LLM composes already-safe, pre-formatted facts and copies their `display`/`vintage` verbatim; it never reformats a value or invents an absence phrase the code didn't hand it. (ADRs 0006, 0032, 0038.)

2. **Use the stack's native seams; never wrap them.** Every major extension point we need already exists in a chosen tool: PydanticAI's `model=` *is* the model seam, MCP *is* the tool/transport seam, LangGraph's checkpointer protocol *is* the session-persistence seam, SKILL.md *is* the workflow seam, Tavily-behind-thin-tools *is* the search seam. A hand-rolled abstraction layered over any of these would be a shallow pass-through — interface as complex as the thing it hides, deletable without losing anything. Our own code adds exactly three seams the stack doesn't provide: the **domain core** (§4), the **event protocol** (§6), and the **configuration surface** (§18).

3. **The agent is a service, not an app.** Everything user-facing (the React SPA; a future mobile/API client) is a **client of one API**. Nothing in the agent service knows or cares what's rendering it. (§2, ADR 0016.)

4. **Configurable means one place.** Anything a developer might plausibly change lives in the central typed settings or in a versioned data asset — never inline in code. Hardcoding is reserved for invariants that will never change (§18, ADR 0018).

5. **KISS, always.** Layers exist where they earn their keep (the dependency rule protects the honesty core; the protocol protects the platform future); everywhere else, the smallest thing that works. No speculative microservices, no message buses, no DI frameworks.

---

## 2. The shape of the system: an API-first agent service

**Counselle's core is one deployable: the agent service.** It exposes a small versioned HTTP API (§6) that streams a conversation as typed events. Any client can consume the same protocol — by design, the service doesn't know or care what renders it. (ADR 0016.)

```
                       Counselle                                  Future clients
            ┌───────────────────────┐                  ┌──────────────────────────────┐
  clients   │  React SPA (frontend/)│                  │  web app / mobile / API users │
            │                       │                  │  auth, profiles, chat history │
            └──────────┬────────────┘                  └──────────────┬───────────────┘
                       │      the same versioned event protocol (§6)  │
            ┌──────────▼──────────────────────────────────────────────▼───────────────┐
            │                     Counselle agent service (Python)                     │
            │  api/    — FastAPI edge: routes, SSE streaming, request context          │
            │  app/    — LangGraph orchestration, PydanticAI agents, research, skills  │
            │  domain/ — fact/value/state types, caveats, season, event specs         │
            └──────┬──────────────────────┬───────────────────────────┬────────────────┘
                   │ in-process           │ MCP / retriever           │ SQL (counselle-owned)
        ┌──────────▼─────────┐  ┌─────────▼──────────┐   ┌────────────▼─────────────────┐
        │ counselle_db/       │  │ Tavily (search_web │   │ Postgres `counselle.*` schema│
        │ app.facts          │  │ /_school_site      │   │  sessions/checkpoints,       │
        │ (read-only)        │  │ /_reddit)          │   │  users/workspace/checkpoints │
        └──────────┬─────────┘  └────────────────────┘   └──────────────────────────────┘
                   │ asyncpg (cds_library_reader, READ ONLY)
        ┌──────────▼───────────────────────┐
        │ Facts-store Postgres 16          │
        │ exactly six reader views         │
        └──────────────────────────────────┘
```

**Request flow (the dossier wedge, canonical):**

1. A message arrives on a session: question + **source-config** (§14). The API edge attaches a trace ID and request context, and hands it to the orchestrator.
2. The orchestrator calls `resolve_school` before school-specific reads. **Not in the database → short-circuit**; otherwise the result supplies identity plus a live-data summary (fact count, last-checked vintage, whether a CollegeData crawl exists at all, per-tab fetch status). Material underspecification can produce a structured clarifying-question bundle (§12.1).
3. `get_school_profile` serves stable identity groups; `get_facts` serves this school's stored CollegeData facts, narrowed by section or exact key, each resolved to one of five states (§9). Both return code-owned displays and per-field provenance. `query_database` is reserved for parameterized cross-school candidate/aggregate work.
4. Gaps the DB can't fill (this year's deadline, campus vibe, or a fact whose state is `not_reported`/`not_fetched`/`not_published`/`not_collected`) → the agent calls the three **Tavily search tools** (`search_web` / `search_school_site` / `search_reddit`) for the *enabled* sources, steering which to use (§14). *(The dedicated deep-research subagent + verification pass — §13 — is designed but not yet wired; the inline Tavily tools fill this gap in the meantime.)*
5. The answer streams out as protocol events: text deltas with inline citation markers, **viz events** (§17), `step`/`thinking` work-visibility events (§27), then a final `done` event with sources + usage.

---

## 3. The stack

Chosen by surveying the frontier and picking proven pieces (never reinvent the wheel). Full evaluation in `docs/research/`.

| Layer | Choice | Why (for us specifically) | ADR |
|---|---|---|---|
| **Agent runtime** | **PydanticAI** | Model-agnostic (`model=` from config — the model seam); native MCP client capability, unused today now that the DB path is in-process (ADR 0038) — the seam remains available for GPT-Researcher's pluggable sources when §13 activates; typed outputs (the citation envelope *is* a `result_type`). | 0003 |
| **Orchestration** | **LangGraph** | Multi-agent research subgraphs; checkpointer = session persistence (and the platform's chat history later). Clarifying questions are a PydanticAI typed-output lifecycle (§12.1). | 0003, 0035 |
| **API edge** | **FastAPI** (+ SSE) | Matches the Python stack; typed request/response; streaming-native. | 0016 |
| **Database access** | **In-process facts-store tools** (Python, asyncpg, `cds_library_reader`) closures over `counselle_db/service.py` | Four tools over six reader views; per-field fact-state honesty boundary and guarded SQL. No MCP transport on this path — ADR 0038 retires the standalone `counselle-db` MCP server once every caller is in-process. | 0005, 0012, 0032, 0038 |
| **Deep research** | **GPT-Researcher** (embedded) | Only OSS deep-research with pluggable MCP sources (our DB first-class); best controllable cost. Designed but not yet wired — see §13. | 0009 |
| **External search** | **Tavily** | One search+extract backend for web / .edu / Reddit, scoped by domain; also GPT-Researcher's retriever. No scraping of our own. | 0015 |
| **Skills** | **SKILL.md** open standard | Portable workflow layer, loaded on demand. | 0010 |
| **Session persistence** | **LangGraph Postgres checkpointer** in `counselle.*` | Sessions survive restarts from day one; the platform's chats are the same rows + a user FK. | 0019 |
| **Config** | **pydantic-settings** + versioned data assets | One typed settings surface, fail-fast at startup. | 0018 |
| **Models** | **DeepSeek V4.1 Flash on Fireworks** (`fireworks:accounts/fireworks/models/deepseek-v4p1-flash`) for every live role — counselor **Quick** and **Think**, the goal agent, judge and criteria writer, auto-titles, document summaries, the eval judge. Roles differ only by reasoning effort (Quick `low`, Think `high`, the goal criteria writer and judge `high`, titles and summaries `none`), set on the model by the one construction seam `app/llm.py::build_model`. Each role is still its own Settings value; a provider other than Fireworks is one branch in `build_model` plus an ADR. The parked CDS extraction system keeps its own Gemini client. (A LiteLLM sidecar remains an option in ADR 0011 but has no Settings knob — added only if/when needed.) | 0011, 0034, 0043 |
| **Language** | Python | Matches the pipeline; asyncpg expertise carries over. | — |

---

## 4. Layering & the dependency rule

(ADR 0017.) Four layers, dependencies point **inward only**. The point is not ceremony — it's that the honesty-critical code stays pure, testable, and untangled from frameworks, and that any layer can be replaced without touching the ones beneath it.

| Layer | Package | Contains | May import |
|---|---|---|---|
| **Domain core** | `domain/` | Typed fact/value/state models (`domain/facts/`), citation/caveat models, render/clarify/source/event specs, and `admission_season(today)`. Pure functions and Pydantic models. **No I/O, no LLM calls, no LangGraph/FastAPI imports.** The parked `domain/cds/` (manifest compile, packet build, claims, page math — §38) stays whitelisted in the same purity gate. | stdlib, pydantic |
| **Application** | `app/` | LangGraph/PydanticAI orchestration, source-config tool mounting, skills, live data-picture injection, evidence/source registry, verified viz assembly, and the facts-store read/crawl services (`app/facts/`, §40). | `domain/`, the stack |
| **Adapters** | `adapters/` | Tavily search, email, checkpointer/provider integrations, the CollegeData fetcher/parser (`adapters/collegedata/`, §40), and asyncpg access to the six reader views (`counselle_db/`). No standalone MCP server on this path — every DB call is in-process. | `domain/`, vendor SDKs |
| **API edge** | `api/` | FastAPI routes, SSE encoding, request context (trace ID + optional principal), translation of graph output → protocol events. | `app/`, `domain/` |

Rules of thumb (the seam discipline):

- **The domain core is the deletion-test survivor.** Deleting it would scatter fact-state, citation, display, and caveat rules across tools and prompts. It is the most-tested code in the repo (§21).
- **One adapter = hypothetical seam; two = real.** We do not write interfaces for things with one implementation and no honesty stake. The model seam is PydanticAI's per-agent `model=` (theirs, not ours); `app/llm.py::build_model` is the one place a live model is constructed from Settings. The search seam is the three thin tools (Tavily today; the tool signatures are the seam). The session seam is LangGraph's checkpointer protocol (theirs, not ours).
- **No pass-through wrappers.** If a module's interface is as complex as what it hides, delete it. This is exactly why the standalone `counselle-db` MCP server was deleted (not parked) in ADR 0038: once every remaining caller of `counselle_db/service.py` was in-process anyway, the stdio child, its supervisor, and its restart backoff were a whole subsystem serving one caller — a shallow wrapper by this same rule.
- **Accepted deviation (ADR 0017, now the norm rather than an exception since ADR 0038):** `app/` and the LLM tool loop both import `counselle_db/service.py` directly in-process; there is no separate MCP transport and no field reconciler for the facts-store read path.
- **The CDS admin write path (ADR 0036, §38, now parked) followed the same four layers as a self-contained subsystem** — `domain/cds/`, `adapters/cds_*.py`, `app/cds/`, `api/routes/cds_admin.py` — additive to this table, not an exception to it. Its code stays in-tree and importable (PARKED.md) but is unmounted; it is called out separately only because, while live, it was the one place in the repo that wrote `cds_library` at all. **The CollegeData facts crawler (§40) is its live successor as the same kind of write path** — `adapters/collegedata/`, `app/facts/`, `api/routes/admin_facts.py` — over the same third DSN/role, repurposed rather than reprovisioned.

---

## 5. Repository layout

Many small modules, organized by feature (house rules: files <800 lines, functions <50).

```
counselle/
├── pyproject.toml
├── .env.example                  # every env var documented; no secrets committed
├── config/
│   ├── settings.py               # THE typed settings surface (§18)
│   └── assets/                   # versioned data assets (§18)
│       ├── prompts/              # one file per agent prompt, loaded by name
│       ├── subreddit_menu.yaml   # the labeled Reddit menu the agent picks from
│       ├── season_calendar.yaml  # the generic US admission-season table
│       ├── greeting_templates.yaml / starter_prompts.yaml  # home-screen config (§32, GET /v1/config)
│       ├── step_labels.yaml      # tool-call → work-visibility step labels (§27.1)
│       ├── abbreviations.yaml    # school-name abbreviation expansion (used by resolve_school)
│       ├── data_picture.md       # live facts-coverage prompt template
│       └── facts_sections.yaml / facts_keys.yaml  # the facts catalog layout (§10)
├── domain/                       # the pure honesty core (§4)
│   ├── facts/                    # fact-state, normalized-value, and tab/page-status types (§9, §40)
│   └── cds/                      # PARKED (ADR 0038, PARKED.md) — manifest compile, packet build, claims, page math (§38)
├── app/                          # orchestration: graph, agent node, steps/turns/records/transcript, skills
│   ├── facts/                    # facts-page reads, Explore/Majors, the crawl pass, the crosswalk, the crawl-worker poller (§40)
│   └── cds/                      # PARKED (ADR 0038, PARKED.md) — extraction engine, job poller, ingest/review services (§38)
├── adapters/                     # tavily tools, email adapter, embedding client (§4)
│   ├── collegedata/               # the CollegeData fetcher (httpx+tenacity, robots-checked) + page parser (§40)
│   ├── facts_store.py / facts_jobs_store.py / admin_facts_queries.py   # the only writer of the facts-store base tables (§40)
│   ├── cds_gemini.py             # PARKED (§38) — Vertex extraction calls
│   ├── cds_pdf.py                # PARKED (§38) — PyMuPDF page ops
│   └── cds_store.py / cds_admin_queries.py   # PARKED (§38) — the CDS write path's own writer
├── api/                          # FastAPI edge: routes, SSE, auth, request context
│   ├── routes/schools_facts.py   # facts page, Explore, Majors (§40)
│   ├── routes/admin_facts.py     # /v1/admin/facts/*, current_superuser-gated (§40)
│   └── routes/cds_admin.py       # PARKED (§38) — in-tree, unmounted; not routed by api/main.py
├── counselle_db/                 # in-process facts-store service (no MCP transport) — read path only; imports domain/ for normalization
├── config/cds/                   # PARKED (§38) — the ported, versioned CDS manifest/prompt/domain YAMLs, kept importable
├── skills/                       # SKILL.md files (§15)
├── migrations/                   # Counselle-owned yoyo migrations for the counselle.* schema ONLY
├── evals/                        # the eval question set + runner (§21)
├── frontend/                     # the React SPA (§31) — the sole protocol client
├── scripts/                      # one-off utilities (setup_db.sql, chat_cli.py, smoke scripts, the parked cds_* scripts)
├── specs/                        # PRDs + execution plans (mvp1/, mvp2/, deep-research/, school-data-v3/)
└── tests/
```

`counselle_db/` runs fully in-process — there is no separate MCP server process any more (ADR 0038 deletes the standalone `counselle-db` MCP server and its stdio transport, since every remaining caller of `counselle_db/service.py` was already in-process). `PARKED.md` is the authoritative list of every parked file, its import edges, and its revival steps.

---

## 6. The agent API & event protocol

(ADR 0016.) The service's entire contract with the outside world. Small, versioned, and frontend-agnostic — this is what makes the client-agnostic design and future platform extensions safe.

**Endpoints (v1):**

| Endpoint | Purpose |
|---|---|
| `POST /v1/sessions` | Create a session → `{session_id}`. Accepts an optional default source-config. |
| `POST /v1/sessions/{id}/messages` | Send a user message (text + per-request source-config override) → **SSE stream** of events. A clarify answer is sent the same way with `in_reply_to`; widget answers also send a structured `clarify_response`, while composer replies send text and are validated server-side against the pending A1 record. |
| `GET /v1/sessions/{id}` | Session metadata + transcript (the platform's chat-history read, working from day one). |
| `GET /v1/health` | Liveness + DB reachability. |

*The four rows above are the agent service's core surface. The full-stack app adds the complete chat-management, auth, config, and identity surface (`GET/PATCH/DELETE /v1/sessions`, `GET /v1/sessions/{id}/stream` reattach, `POST .../cancel`, `POST .../steer`, `POST .../feedback`, `/v1/me`, `/v1/config`, `/v1/auth/*`) — see §27.6 / §28–§32 for the complete v1 contract.*

**The event stream.** Every event is `{v: 1, type, data}` — one envelope, every consumer. Types:

| Event | Payload | Notes |
|---|---|---|
| `meta` | trace_id, session_id, model, `message_id`, `user_message_id`, response mode, optional continuation metadata | First event of every stream. The two ids anchor feedback and edit/regenerate (§27, §30); A2 continuations point back to A1 with `continuation_of`. |
| `narration` | agent-visible prose / status text | What the assistant says out loud while it works; shown in the timeline and transcript replay. Separate from native model thoughts (§27.2). |
| `delta` | text tokens (with inline citation markers) | Final-answer prose only. Only the answer rides `delta`; narration and native thoughts use their own events (§27.2). |
| `viz` | a **render spec** (§17) — cells are citation envelopes | The backend stages and dedupes viz specs during work, then emits the batch once at final-answer start. Numbers never ride in `delta` tokens. |
| `clarify` | a v2 **clarify spec** (§12.1) | Stream ends `awaiting_input`; client answers via a new message naming A1 with `in_reply_to`. |
| `clarify_response` | A1 id, A2 id, structured widget/reply response | Acknowledges acceptance before A2 `meta`, so clients freeze A1 while the separate A2 streams. |
| `sources` | the deduplicated citation list for the turn (official/community, vintages) | Feeds the expandable-marker UX (PRD). |
| `usage` | tokens + estimated cost for the turn (§19) | |
| `user_message` | text, `user_message_id`, `injected` | Mid-run steering text rendered inside the active assistant run; `injected:false` means queued but not yet accepted. |
| `done` / `error` | terminal | `error` carries a user-safe message + trace_id. |

*The `narration`, `step`, `thinking`, and `user_message` event types (and the extensions to `done`/`meta`) are additive within v1 — see §27.*

**Versioning:** `v` on every event, `/v1` on every route, and a version field inside the render/clarify specs. Additive changes don't bump; breaking changes do. Clients ignore unknown event types (forward compatibility).

**Auth posture:** The request context carries an **optional principal** so identity integrates without route or orchestration changes. Cookie-JWT auth (fastapi-users) + Google OAuth is implemented (§28): every `/v1/sessions` and `/v1/me` route requires a logged-in user (foreign sessions 404), with per-IP auth rate limiting. `/v1/health` stays open.

---

## 7. Sessions, state & the platform-ready identity model

(ADR 0019.) The classic retrofit pain in chat products is bolting persistent identity onto an in-memory prototype. We avoid it by making the *shape* platform-ready on day one while building none of the platform:

- **Every conversation is a session with a durable `session_id` from day one.** In-session working memory (PRD) *is* the LangGraph state for that session — one mechanism, not two.
- **State persists in Postgres via LangGraph's own Postgres checkpointer**, in Counselle's `counselle.*` schema. Sessions survive restarts; pending clarification records and continuation intent survive too. No bespoke session store — the checkpointer protocol is the seam, and swapping it (memory in unit tests, Postgres in prod) is configuration.
- **A thin `counselle.sessions` row** (session_id, created_at, `user_id`, title, default source-config, and a nullable `essay_id`) fronts the checkpoint data. `user_id` is populated and FK-enforced for new rows (migration 0004 added `counselle.users` + the FK; §28) — chat history, profiles, and per-user memory attach to rows that already exist. No migration of meaning, only addition.
- **Counselle owns its schema and migration chain** (`migrations/`, over `counselle.*` only — never `public.*`/`raw.*`, which belong to the pipeline and are read-only to us; ADR 0012).
- **A session may belong to a workspace object.** `sessions.essay_id` (nullable, with a partial unique index — `docs/DATABASE_GUIDE.md` §10) gives each essay exactly one durable panel thread. Such a session is an ordinary session that knows which essay it fronts: same checkpointer, same turn registry, same transcript read. It is excluded from the chat list, which filters `essay_id IS NULL`, and it is the authority for which essay an essay-surface turn may be about (§39).
- **Long-term memory & personalization are deferred** (PRD) — but they will live behind the same session/user rows, which is why those rows exist now.
- **Retention:** sessions are cheap rows; a configurable TTL/cleanup job knob (§18) defaults to "keep everything" until there's a reason not to. A TTL sweep must reckon with object-owned threads: an essay's panel conversation is durable state a student expects to find again, not a disposable chat.

---

## 8. The data-access layer: in-process facts-store tools

*This section describes the agent's read path only. A separate, superuser-gated
write path (§40) produces the rows this section reads — on its own DSN and
Postgres role, never touched by the agent runtime. A second, parked write
path (§38) shares the same database but is unmounted.*

The agent's DB access is fully in-process (ADR 0038): `counselle_db/service.py`
and `counselle_db/catalog.py` are called directly by the tool closures in
`app/toolset.py`, over one asyncpg pool authenticated as `cds_library_reader`.
That role can select exactly six views: `school_profiles`, `current_school_facts`,
`school_facts_sql`, `school_explore`, `school_data_status`, and `fact_coverage`.
The agent path never imports any writer code or reads a base table directly —
it only ever connects through `COUNSELLE_DB_RO_DSN`. **There is no MCP server,
no stdio child process, and no supervisor on this path any more** — ADR 0038
deletes the standalone `counselle-db` MCP server outright once every remaining
caller went in-process, on the same "no pass-through wrapper" ground ADR 0017
already argued (§4). The LLM sees exactly four tools:

| Tool | Purpose |
|---|---|
| `resolve_school(query)` | Resolve name/alias/abbreviation/unitid and return safe identity plus a live-data summary (fact count, last-checked vintage, whether a CollegeData crawl exists, per-tab fetch status), or ambiguity/not-found. |
| `get_school_profile(unitid, groups?)` | Read dynamic stable profile groups (identity, contact, classification) with provenance and a snapshot caveat. |
| `get_facts(unitid, sections?, keys?)` | Read this school's stored CollegeData facts, narrowed by section or exact key; narrowed calls resolve one of five states (§9) for every requested key, present or not. The model sees each present fact as a compact row (`fact_key`, `label`, `display`, `vintage`, `marker`, and any caveats); the school's shared citation rides once at top level. |
| `query_database(sql, params)` | One guarded parameterized `SELECT`/`WITH` over the five views for candidate selection or aggregates. |

The first three are the normal path. SQL results are not cited student truth: state
the as-of and covered/total denominator, then re-fetch named final values through a
typed read (`get_facts`/`get_school_profile`). The query guard (`counselle_db/sql_guard.py`)
enforces schema allowlisting, positional parameters, and statement/row/serialized-byte
limits.

At startup the catalog (`counselle_db/catalog.py`) builds one atomic, immutable
snapshot: the section/group/fact layout from `config/assets/facts_sections.yaml`
and `facts_keys.yaml`, plus live-derived counts and vintages read straight from
the database. Fact keys, section ids, and school counts are always derived,
never hardcoded — there is no manifest or extraction-contract version to pin
on this path (that concept belongs to the parked CDS system, §38).

---

## 9. Fact states, provenance, and citation truth boundary

**Every fact request resolves to exactly one of five states** (`domain/facts/state.py`'s
`fact_state`, the single function every consumer — the facts HTTP endpoint,
the agent's `get_facts`, the caveat emitter, and Explore's exclusion
accounting — calls, so none re-derives a state from raw statuses on its own):

| State | Meaning |
|---|---|
| `value` | A reported value is on file. |
| `not_reported` | The page carrying this fact was read successfully and the fact was blank there — a real, present observation of absence, not a gap. |
| `not_fetched` | The page could not be read on the last check, or has never been checked — the value's presence is genuinely unknown. |
| `not_published` | The school's CollegeData profile does not have this page at all. |
| `not_collected` | No CollegeData crawl exists for this school at all (`resolve_school`'s `has_collegedata: false`). |

These five make different claims about *why* a number is missing, and the
model must never collapse them into one "not available" phrase — `not_reported`
is not `not_fetched`, and neither is "not in our database" for a school that
resolved at all. A legitimate `0` or `False` value is a real, present
`NormalizedValue` and always renders at full weight; it is never treated as
absent. Each fact carries its own `observed_at` (when Counselle last checked
the page it lives on) and, where CollegeData states one, a `reported_period` —
there is no shared edition or manifest vintage across facts the way the
parked CDS packet model had; every value's vintage is its own.

**Scraped facts are Counselle's own data, deliberately.** A `db`-sourced
citation carries `source: "db"` and `tier: null` — no source label, no
attribution, no evidence marker is ever surfaced to the student (the citation
envelope enforces this: a `db` citation with a non-null tier fails validation).
Lineage from the raw CollegeData snapshot to the stored fact is kept
internally (`page_snapshots.body`, retained only for "why did this change"
debugging) and never rendered verbatim or exposed through any API. External
sources (`web` / `edu` / `reddit`) keep their own tier and provenance, unchanged.

**No admission probability or composite score is synthesized.** Distributions
(GPA/SAT/ACT bands, selection factors, class sizes, ethnicity) are stored
structured for future analysis. The Explore admit-rate card (§41) is the
explicit bounded exception: it reads the school's own admit rate into a
Reach/Target/Safety/Unknown planning band, never a probability, ranking number,
or composite score.

**There is no RAG anywhere in this path.** Facts are read straight through
the six typed views above — never embedded, chunked, or retrieved by
similarity; the same is true of the parked CDS pipeline's own read model.

---

## 10. Dynamic catalog and fact keys

The catalog snapshot (`counselle_db/catalog.py`'s `CatalogSnapshot`) is the
one source of section/group/fact layout, compiled once at boot from
`config/assets/facts_sections.yaml` and `facts_keys.yaml`. A fact is
addressed by its exact `<domain>.<name>` key (e.g. `identity.address`); an
unknown section or key fails with the valid list for that school, retried
rather than silently shown unavailable. Section ids, fact-key counts, and
per-school coverage are always derived from the live database at startup —
never a hardcoded inventory or a versioned manifest, unlike the parked CDS
system's manifest/packet contract (§38).

The runtime injects a compact **data picture** (`app/prompt.py`'s
`render_data_picture`) derived from the catalog snapshot: profile-snapshot
date range, the facts-updated range across schools, how many schools have
any CollegeData facts, the fact-key count, the section menu, and a
stale-facts count. It guides routing without putting raw facts or a full key
inventory into ambient context. Current-cycle deadlines and anything beyond
what CollegeData reports route to official web search even when a school has
facts on file.

---

## 11. School coverage (no scope gate)

Any row in `school_profiles` is in scope; an absent school receives the
explicit not-in-database response — there is no tracked-school gate (ADR 0002).
Coverage for a resolved school is a **fact-count, not an edition, question**:

- `resolve_school` and `school_data_status` report whether a CollegeData crawl
  has ever run for this school (`has_collegedata`), how many facts it holds,
  when they were last checked, and each tab's own fetch status.
- A school with `has_collegedata: false` has no facts at all — say "not
  collected," not "reports nothing," and route to web/.edu search.
- A school with facts still has per-key gaps, each resolved to one of the
  five states in §9 rather than a blanket "partial" edition state — there is
  no accepted/partial-packet or stale-edition concept on this path (that
  belongs to the parked CDS system, §38).

Missing or current-cycle values fall back to the school's official site or
web search with disclosure; cross-school comparisons (`query_database`,
`fact_coverage`) disclose the covered/total denominator for whatever fact key
was bound as a parameter, never a raw unqualified count.

---

## 12. The agent runtime (PydanticAI + LangGraph)

(ADR 0003, amended by ADR 0035, ADR 0038.) PydanticAI defines each agent with `model=` from config, function tools (§8, §14), and typed outputs — no MCP connection is wired today (ADR 0038 retired the last one, the DB path). LangGraph orchestrates: state passing and session persistence via the checkpointer (§7). Clarifying questions are now a structured PydanticAI output path, not the product's live `interrupt()` lifecycle.

The **counselor** agent is the primary agent. The **researcher** and **verifier** agents are designed (§13) but not yet wired — they are part of the deep-research follow-up (`specs/deep-research/plan.md`). Parallel research subgraphs attach when that subsystem is activated.

**One node, more than one persona.** A turn carries a **surface** (`domain/surface.py`: `chat` | `essay`, ADR 0037) that selects the system-prompt asset, the tool profile, and the essay write mode at the single point where the PydanticAI `Agent` is constructed (`app/agent_node.py`). It is not a second agent and not a second graph: the emission router, marker strippers, clarify lifecycle, tool-overflow middleware, usage accounting, turn record, steering, and replay safety are all surface-agnostic and are shared verbatim. The value rides `turn_ids` — the same checkpointed bag as `response_mode` and `model` — is written only for a non-chat surface, and reads back as `chat` when absent or unrecognized, so every older checkpoint and every direct-graph call keeps its exact behavior. Clarify continuations (§27.7 G4) inherit it from A1's own `turn_ids`, so a resumed turn cannot silently widen back to the counselor's prompt and tool set. §39 describes the essay surface.

### 12.1 Clarifying questions

(ADR 0035.) A clarifying question is the interactive sibling of a visualization:
the agent emits a **typed clarify spec**, the API edge streams it as a `clarify`
event (§6), and the frontend renders a dumb widget that waits for an answer.
The model authors only the questions and option copy; the product owns layout,
progress, buttons, validation presentation, and the free-text "Something else"
affordance.

```jsonc
{
  "v": 2,
  "questions": [
    {
      "id": "q1",
      "question": "Which lens should I use?",
      "selection": "single",
      "options": [
        { "id": "q1_o1", "label": "Cost & affordability", "hint": "net price for your situation" },
        { "id": "q1_o2", "label": "Campus life", "hint": "what it is like there" }
      ]
    }
  ]
}
```

**The judgment rule (the part that matters most).** Three behaviors, agent picks:
1. **Clarify** — only when underspecification *materially changes the answer* and there's no sensible default.
2. **Assume + state** — when one reading is clearly likeliest: answer it and say the assumption.
3. **Default** — when a reasonable default exists, just answer.

One focused round, one to three questions, two to five options per question,
never an intake form. Options are shortcuts, not a modal: a typed reply is
always treated as the answer. A clarifier that resolves a comparison axis feeds
straight into the comparison-table field selection (§17).

The lifecycle is split into two assistant records. A1 is the durable question:
the backend commits the pending turn record and provider history before
streaming `clarify` + `done(awaiting_input)`. The answer is accepted through
`POST /v1/sessions/{id}/messages` with `in_reply_to=A1`. Widget answers carry a
structured `clarify_response`; composer replies carry text and become a typed
reply response server-side. The continuation is A2, a new assistant record with
`continuation_of=A1`, inherited source/skill/response-mode settings, and no
`ask_student` output available.

---

## 13. The deep-research subsystem (GPT-Researcher)

> **Designed but not yet wired.** The current graph is `prepare → agent → END` (§12); the follow-up plan (`specs/deep-research/plan.md`) adds the research node when GPT-Researcher is activated. The deliberately minimal topology makes that insertion additive — no restructuring. The design below is the approved spec. See ADR 0009 for the GPT-Researcher choice and `docs/research/deep-research-bakeoff.md` for the bake-off.

Embedded as a research subagent inside the LangGraph orchestrator — not adopted wholesale, and **not** a hosted research black box (our DB must be a first-class source; our model routing and source tiering must apply). (ADR 0009; bake-off in `docs/research/deep-research-bakeoff.md`.)

**Cost-optimized configuration (added with the deep-research follow-up):** three model tiers — `FAST_LLM`/`STRATEGIC_LLM` → Gemini 2.5 Flash, `SMART_LLM` → Gemini 2.5 Pro, escalatable per question; hard depth/breadth/concurrency caps. **DB-first does the heavy lifting:** web research fills gaps the facts store cannot support — a key whose state is `not_reported`/`not_fetched`/`not_published`/`not_collected` (§9), or a current-cycle fact CollegeData does not carry at all.

**What we add (already PRD features):** source-type tagging (each source tags `official`/`community`, carried into citations), the **verification pass** (a cheap post-pass cross-checking the top 2–3 cited sources before stating a fact), and the eval set (§21).

**Search backend = Tavily** (§14) — the same backend as the fast inline tools, so there is exactly one external-search dependency.

---

## 14. External search & source control

(ADR 0015.) All three external searches are **one backend — Tavily — scoped by domain**, as three thin tools. Nothing is scraped by us on this path — the facts crawler's own scraping (§40) is a separate, offline, LLM-free ingestion process, not a search tool the agent calls. The DB is the fourth, always-on source; search fires when a requested fact resolves to an unavailable state (§9) or when deadlines/current-cycle facts exceed what the facts store carries.

| Tool | Scope | Tier |
|---|---|---|
| `search_web(query)` | no domain filter | varies |
| `search_school_site(school, query)` | `include_domains = [the school's stored URL]` — injected by the tool from the DB; the agent only names the school | **official** |
| `search_reddit(query, subreddits)` | `include_domains = [the subreddits the agent picked]` | **community** (never cited as fact) |

**Reddit is agent-steered:** the agent picks subreddit(s) per question from the **labeled menu** (a versioned data asset, §18 — r/ApplyingToCollege for process, r/chanceme, r/financialaid, r/[SchoolName] for campus life, program subs), several in parallel when useful. School subs are best-effort (a wrong guess returns nothing, harmlessly) — no mapping table to maintain.

**Source control (per-request, enforced in code — ADR 0013):** a **source-config object** travels with each request (web on/off; Reddit on/off + per-subreddit allowlist; .edu on/off; DB always on). The orchestrator **builds the toolset from the config**: a disabled source's tool isn't mounted. When the deep-research subagent is activated (§13), its retriever list is gated by the same config. A disabled source can't be reached and never appears in citations. Three named tools (not one generic) so the dropdown maps 1:1 and the citation tier is unambiguous per tool.

Unmounted-not-hidden holds without exception: the essay surface (§39) is just another instance of it. `build_db_tools(..., surface=...)` never constructs `get_facts` or `query_database` — the two facts-store reads that return school facts and run guarded SQL over the reader views — when the surface is `Surface.ESSAY`; the essay panel keeps school identity (`resolve_school`, `get_school_profile`) but not school facts. Every DB tool is its own in-process `Tool` object, so withholding two of the four costs nothing beyond the `if` in `build_db_tools` — the same construction-time gate that governs the source-config tools above. ADRs 0013 and 0037 carry the trade.

---

## 15. Skills (SKILL.md)

Skills are SKILL.md files (open standard: YAML frontmatter + Markdown body), living in `skills/`. Current skills include public response-mode workflows (`focused-answer`, `deep-research`, `guided-counselor`), public task workflows (`application-rounds`, `chancing`, `costs-and-aid`, `essay-brainstorm`, `essay-drafting`, `essay-fit`, `essay-revision`, `major-and-fit`, `school-comparison`, `school-deep-dive`, `school-list`, `testing-strategy`), and internal support workflows (`citation-and-recency`, `counselor-research`, `db-recipes`, `essay-advanced`, `essay-craft`, `essay-depth`, `essay-exercises`, `essay-honesty`, `essay-structure`, `essay-types`, `essay-values`). Metadata loads at startup and bodies load through progressive disclosure. The non-advertised `dossier-assembly` alias canonicalizes to `school-deep-dive` only for parked-turn compatibility; it is not a public skill.

Students can explicitly invoke only skills that opt into the public SKILL.md metadata (`user_invokable`, with student-facing display copy). The API exposes ordinary task skills through config and validates submitted canonical names, visibility, uniqueness, count, group conflicts, and trusted body-size/path bounds before a turn is claimed. Valid selections are preloaded as a server-owned, one-turn instruction block; they cannot override authz, read-only constraints, mounted-tool availability, or honesty rules. The selected canonical names persist in the turn record and original user transcript entry, so reload, retry, and regeneration preserve the exact invocation without adding control syntax to the student's text. Internal skills remain available to the agent's normal progressive-disclosure tool path but are never exposed as student actions.

The primary composer mode is also skills-backed. `/v1/config` exposes a separate `skill_modes` catalog derived from public skills in the trusted `response-mode` group. The frontend presents exactly three student-facing choices — Focused Answer, Deep Research, and Guided Counselor — while still sending the selected mode through the existing `skills: string[]` request field. Mode names are snapshotted into the same persisted selected-skill list as task skills, but the transcript filters mode chips out of the visible "Invoked skills" row so ordinary specialized skills remain visible without repeating the conversation posture on every message.

Every chat turn runs in exactly one response mode: a chat turn that arrives with none (an API client, the eval runner) gets Focused Answer, the same default the UI shows, while the persisted selection stays what the student sent. The modes own research depth, not the base prompt: `counselor.md` keeps the mode-neutral rules (honesty, citations, composition, workspace, visualization, voice) and one pointer that non-Focused turns load `counselor-research` plus the matching playbook for substantive school advice; the multi-source default, routing matrix and depth rules live in `deep-research`. Focused Answer is short by contract (answer first, about 120 words, no Reddit sweeps, at most two searches) and bounded in code: `app/tool_budget.py::ToolRoundBudget` lets it call tools in its first `focused_answer_max_tool_rounds` model requests, then withdraws every function tool and the `ask_student` output tool and adds one instruction to answer from what was gathered, so the turn always ends in an answer rather than a budget apology or a question. It also caps searches (web, a school's site, Reddit) at `focused_answer_max_searches` per turn: once spent the search tools are hidden, and an extra search fired in the same parallel round returns a search-limit error without running. `get_facts` accepts a school name and resolves it exactly as `resolve_school` would (several campuses or none come back as that result), so a named school's facts take one round, not two. A goal turn runs in goal mode, so response-mode skills are dropped from it, and the essay panel keeps its own prompt and has no budget.

---

## 16. Citations, recency & temporal context, end to end

- **Every named DB fact carries registered evidence** (§9); external sources retain official/community tier provenance.
- **Citation UX:** lightweight **inline expandable markers** — each claim gets a marker with an official/community chip; expanding reveals source, vintage, caveat. The `sources` event (§6) carries the turn's full deduplicated list.
- **Recency is per-value** (the vintage resolver) plus three always-available temporal facts, none guessed by the model:
  - **Today's date** — injected by the runtime each request.
  - **The live data picture** (§10) — profile snapshot range, facts-updated range, school/fact-key counts, and section menu. The agent routes DB-vs-web without a hardcoded calendar.
  - **The admission season** — `admission_season(today)` (pure, in `domain/`; the phase table is a data asset) → cycle phase + active entering class. Jun–Jul = list-building/essay prep; Nov = early deadlines; Mar–Apr = decisions; etc.
- **Boundary (KISS):** season awareness is *context*, not a deadline tracker (process management is deferred, PRD). School-specific dates are **data** — facts-store fields or live web, fetched and cited like any value, never inferred from the generic calendar.

---

## 17. Visualizations

(ADRs 0014, 0024, 0032, 0038.) Viz protocol v2 has an open type seam. Known `stat_block` and `comparison_table` cards render natively; unknown opaque types degrade safely. A cell must be a qualified fact key (`<domain>.<name>`), a profile ref, a registered external value, or explicit unavailable.

**The provenance boundary:** the model proposes shape and references; code fetches DB/profile refs and verifies registered external values. Rejected refs must be corrected, never converted into unavailable. No comparison may imply a shared vintage the data does not have — each fact's own `observed_at` is carried through.

**Mechanism:** `render_viz` resolves fact-key cells through `get_facts` (one call per school, batched across every cell that school needs), profile refs through `get_school_profile`, external refs through the source registry, and unavailable cells without lookup. Columns are schools and rows are facts; a column sent without a `unitid` whose name is exactly one school's official name resolves to that school (never an alias or partial name, and never a school another column already names). The backend stages/deduplicates successful specs and returns only a compact acknowledgment to the model. Clients render canonical displays and provenance; unknown card types use the generic fallback.

**Accuracy guarantee:** no visible numeric/text value is accepted from an unregistered model literal. All-or-nothing validation prevents a partly truthful card.

---

## 18. Configuration architecture

(ADR 0018.) "Configurable" means **one place per kind of thing**. Three buckets, one policy. The full-stack app's configuration delta (additional Settings groups + data assets) is §32.

**1. Typed settings (`config/settings.py`, pydantic-settings).** One `Settings` object, loaded once at startup, **validated fail-fast** (a missing key or malformed value kills boot with a clear error — never a silent default in production paths). Layered: code defaults → `.env` / environment → explicit overrides. Everything deploy- or cost-relevant lives here:

| Group | Knobs |
|---|---|
| Models | per-agent `model=` — `model_counselor` (Quick), `model_counselor_think` (Think), `model_cheap`, `model_title` (the cheap-tier auto-title model), all `fireworks:` strings (any other prefix on a live model field fails boot, ADR 0043); `reasoning_effort_quick`/`_think`/`_cheap`/`_goal` (`none`/`low`/`medium`/`high`, sent on every call); counselor display/preview labels for `/v1/config`; `response_mode_think_enabled` (honest-disable switch: omit Think, never remap it); `thinking_stream` (bool — whether the model's reasoning text is streamed as `thinking` events, §27.2; **default off**, because DeepSeek's reasoning is raw chain of thought); `agent_max_model_requests`; `focused_answer_max_tool_rounds` and `focused_answer_max_searches` (Focused Answer's tool-round and search budgets, §15); `agent_tool_result_max_chars` (inline tool-result ceiling before a result spills to a read-back handle); `agent_model_retry_attempts` (total attempts per call); `model_read_timeout_s` (a chat turn's streamed request waiting this long for its next byte, the first included, times out and is retried; non-streamed calls and goal turns keep the SDK default); `fireworks_api_key` (masked; required outside development); per-model prices. Researcher/verifier knobs, GPT-Researcher's `FAST/STRATEGIC/SMART` tiers, and a LiteLLM sidecar endpoint are added with the deep-research follow-up (§13). |
| Database | facts-store reader-login DSN, facts-crawler/pipeline DSN, application DSN, statement/row/byte limits, pool sizes |
| Counselle schema | `counselle.*` DSN, checkpointer on/off (memory for tests), session TTL/cleanup |
| Sources | default source-config (web/Reddit/.edu on/off), Tavily key, per-tool result limits |
| API | host/port, CORS origins, SSE keepalive, protocol version |
| Observability | log level, cost-accounting on/off |

*(The Auth, Chat, Streaming, and Rate-limit groups are in §32. There is no "Research" group yet — it lands with §13.)*

The settings surface also owns the hardening knobs added after MVP2: the
live-derived school count is read from `Catalog.school_count` (not a Settings
literal); password length is `password_min_length`; the thinking splitter uses
`thinking_threshold_chars`; production CORS defaults to an empty `cors_origins` list.

**2. Versioned data assets (`config/assets/`).** Editorial prompts (including the live data-picture template), the facts catalog layout (`facts_sections.yaml`, `facts_keys.yaml`), subreddit menu, and season calendar. Reviewable in diffs, no magic strings in control flow.

**3. Live-derived from the DB (never configured, never hardcoded).** The fact-key/section catalog snapshot, profile groups/snapshot, per-school fact counts and vintages, coverage, and school URLs.

**What may be hardcoded:** only invariants — fact-state resolution, citation validation, versioned protocol schemas, and SQL safety.

---

## 19. Observability & cost accounting

Cheap on day one, brutal to retrofit:

- **Structured logging (structlog)** — JSON logs; a **trace ID** minted per request at the API edge rides through the graph, tools, and research subagent, and is returned in the `meta`/`error` events. Never log secrets (house rule); never log full student messages at INFO.
- **Per-request usage accounting** — every model call's tokens (PydanticAI exposes usage) and Tavily/research calls roll up into the turn's `usage` event and a log line: per-session and per-turn cost visibility from the first day, which is also how the research cost caps get verified in practice.
- **Health** — `GET /v1/health` checks process/database reachability and the checkpointer. There is no MCP child supervisor to report on any more — the DB path is fully in-process (ADR 0038). Turn-registry and limiter counters remain best-effort process state.
- Metrics/dashboards are a platform-phase concern; the structured logs are designed so that adding them is aggregation, not re-instrumentation.

The Explore admit-rate path (§41) has no telemetry seam of its own: it is
one column read through the shared `explore` executor and a pure function over
it.

---

## 20. Deployment & day-one deployability

**Nothing may block containerized deployment** — deployability is a property, not a phase. The full-stack app deployment delta (same-origin SPA serving, the amended statelessness clause, entrypoint migrations) is §33. The points below describe the as-designed deployability.

- **12-factor:** all config comes from the environment; durable state lives in Postgres (`counselle.*`), so the service can restart or move safely.
- **One container** (a `Containerfile` from day one) running the API service. There is no second process to supervise any more: the facts-store read path is fully in-process, and the CollegeData facts crawl-pass worker (§40) runs as an `asyncio` task inside the same FastAPI lifespan (ADR 0023's one-deployable constraint) — the parked CDS extraction worker's own lifespan start/stop call was removed when it was parked (§38), so it does not run alongside it.
- **Migrations** (`migrations/`, a yoyo chain over `counselle.*` only). Migration-on-boot via the container entrypoint is planned per §33; until then, `uv run yoyo apply` is run manually before first launch. The `cds_library` schema (identity profile + facts store, plus the parked CDS tables' preserved DDL) is provisioned separately from `deploy/seed/`, not through this migration chain.
- **Secrets** in `.env`/secret manager only; shared with the facts-store database **credentials only** (the read-only DSN; Vertex/GCP keys only for the parked CDS extraction system) — no shared code, config, or runtime dependency. The DB is the contract.
- **Read-only boundary** — the reader LOGIN can select exactly the six `cds_library` views; the separate application DSN owns only `counselle.*`. (ADRs 0012, 0032, 0038.)

---

## 21. Testing strategy

(Per the PRD: test where lying to a student is possible; skip ceremony elsewhere. Behavior, not implementation.)

- **The honesty core is the test surface.** Fact-state resolution (`fact_state`/`section_state`), value normalization, displays, caveats, citation validation (no tier on a `db` source), and fact-key rejection receive deterministic tests. The parked CDS honesty core (packet identity/compatibility, extraction/availability states, evidence, editions) keeps its own deterministic tests passing too — PARKED.md's requirement, not dead weight.
- **The eval set (`evals/`)** scores routing, coverage/state/denominator honesty, citations, clarify/narration quality, and workspace behavior; live roles derive from the data picture.
- **Runtime schema validation and shared protocol fixtures enforce the contract** — typed specs (envelope, render, clarify, events) validate at runtime via Pydantic, while the small checked-in backend/frontend fixtures catch Python↔TypeScript drift without a separate contract-test service.
- **Three pytest marker tiers** (`pyproject.toml`): `live_db`, `live_search`, and `live_llm`. Routine runs exclude all three.
- **Response-mode verification:** routine tests pin server-side mode routing,
  sticky-vs-execution semantics, usage/cost attribution, and frontend
  normalization. Live close-out runs the same school prompts in Quick and Think
  and compares citation honesty, tool behavior, latency, and cost before Think
  is enabled broadly.
- **Frontend tests** are covered in §34.
- The layering (§4) is what keeps this strategy cheap: the honesty core needs no LLM, no DB, no network to test.

---

## 22. Feature → component traceability

| PRD feature | Component(s) |
|---|---|
| DB access | four in-process facts-store tools over six reader views (§8, §10) |
| Web / Reddit / .edu search | Tavily, 3 domain-scoped tools; Reddit agent-steered (§14) |
| Source-control dropdown | per-request source-config gating the toolset (§14) |
| Deep research + verification | GPT-Researcher subagent + verification pass (§13) — designed; activates with the follow-up plan |
| Citations (official vs community) | citation envelope `tier` (§9); `sources` event (§6) |
| Citation UX (inline expandable markers) | `delta` markers + `sources` event; client renders (§6, §16) |
| Recency & temporal awareness | per-fact `observed_at`/`reported_period` + live data picture + injected date + `admission_season` (§9, §16) |
| Clarifying questions | PydanticAI `ask_student` typed output → durable A1 `clarify` event → A2 continuation (§12.1) |
| In-session working memory | LangGraph state via Postgres checkpointer (§7) |
| Skills | SKILL.md in `skills/` (§15) |
| Visualizations | `render_viz` → render spec → `viz` event → dumb components (§17) |
| Model configurability | per-agent `model=` from Settings (§18) |
| School coverage | per-school fact count/vintage, has-CollegeData-crawl boundary (§11) |
| Honesty / no-misread | five-state fact boundary + no-fake-tier citation rule (§9, §21) |
| Product client | `frontend/` React SPA — the sole protocol client (§31) |
| Work visibility (steps / thinking) | `step` + `thinking` events; `app/steps.py` (`StepMapper`/`EmissionRouter`), `domain/events.py` (§27.1–27.2) |
| Resume & cancel | the turn registry `app/turns.py` (Last-Event-ID reattach, `POST .../cancel`); the self-contained turn record `app/records.py` (§27.3, §27.7) |
| Auth & identity | fastapi-users cookie-JWT + Google OAuth — `api/auth.py`, `api/users_db.py`, `api/routes/me.py`, migration 0004 (§28) |
| Chat management | `api/routes/sessions.py` (list/search/rename/delete, keyset pagination); auto-titles `app/titles.py` (§29) |
| Feedback & rate limiting | `app/feedback.py` + migration 0005; `api/ratelimit.py` (per-user turns, per-IP auth) (§30) |
| Future platform (mobile, profiles) | API-first protocol (§6) + platform-ready sessions (§7) + evolution path (§23) |

---

## 23. The platform evolution path

What the platform phase adds, and why it's additive rather than rework:

| Platform feature | Foundation already in place | What gets added |
|---|---|---|
| User accounts & auth | optional principal in the request context (§6) | auth middleware, `counselle.users`, fill `sessions.user_id` — implemented in §28 |
| Persistent chat history | durable sessions + transcript read (§6, §7) | list/search/rename UI; pagination — implemented in §29 |
| User profiles & personalization | sessions keyed for a user FK | profile store; profile context injection |
| Long-term memory | the checkpointer layer is the same seam | a memory store + retrieval policy |
| Chancing | the chancing *knowledge* already cited (PRD) | the personal math on top of the same envelopes |
| Web/mobile frontend | the versioned event protocol (§6) | pure client apps — web implemented in §31 |
| Scale-out | stateless service; state in Postgres (§20) | replicas behind a load balancer; read replica if needed |
| Future perf | designed-for: materialized dossier table, research caching per (school, question-type, DB-snapshot), embeddings at scale | build when measured-slow, not before |

The discipline: **every platform feature lands as new adapters/rows/clients against existing seams.** If one ever requires changing the domain core or breaking the protocol's v1 semantics, that's the signal to stop and re-architect deliberately (and write the ADR).

---

## 24. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **PydanticAI API churn** | APIs verified against the pinned version — `agent.iter()`, `AgentRun.next_node`/`next`, `AgentRun.all_messages()`, `AgentRun.ctx.state.message_history`, `FunctionToolCallEvent`/`FunctionToolResultEvent`, `AgentRunResultEvent`, `UsageLimits` all confirmed and in use (`app/agent_node.py`, `app/steps.py`). Re-verify on any version bump. |
| Protocol churn breaking clients | `v` on every event/route; additive-only within v1; clients ignore unknown events. |
| Agent treats SQL rows as cited truth | SQL is candidate/aggregate-only; denominator/as-of required and named finalists are re-fetched through typed reads. |
| `COUNSELLE_JWT_SECRET` missing or too short | Fail-fast validated at boot (≥32 bytes); the service refuses to start. Set it before first launch — the most likely first-boot failure (§32). |
| Deep-research cost blowup *(future — §13)* | When activated: DB-first + depth/breadth caps + cheap-model tiers + per-question cost ceiling + usage accounting making spend visible per turn (§19). |
| GPT-Researcher has no published citation-accuracy benchmark *(applies when §13 activates)* | The eval set, measured before launch. |
| Facts-store sparsity → missing sections/keys | Five distinct fact states plus official-site fallback with disclosure (§9, §11). |
| Checkpoint/session data growth | Configurable TTL/cleanup (§7, §18); rows are cheap until they aren't — knob exists from day one. |
| Daily crawl changes a school's fact-key set | The catalog snapshot is rebuilt from the live database at boot; an unknown key at request time fails with the current valid list rather than serving a stale key inventory (§10). |
| CollegeData Terms-of-Use exposure (contractual, not technical — ADR 0038 Risk R0) | Robots-respecting, rate-limited, honestly-identified fetcher; no evasion, no bulk export, no raw-snapshot exposure. Accepted knowingly pending final owner ratification — not eliminated by any mitigation. |
| Config sprawl / drift | One `Settings` surface, fail-fast validation, `.env.example` as the documented inventory (§18). |

---

## 25. Open questions

*Design-time open questions — all resolved (kept as the decision trail):*

- ~~**PydanticAI / LangGraph / checkpointer APIs & versions**~~ — *resolved:* pinned in `pyproject.toml`; APIs confirmed in use.
- ~~**Migration tool for `counselle.*`**~~ — *resolved:* **yoyo-migrations**; chain 0001–0006 over `counselle.*` only.
- ~~**Tavily Reddit scoping**~~ — *resolved:* `reddit.com/r/<sub>` domain scoping confirmed; `search_reddit` shipped; `config/assets/subreddit_menu.yaml` finalized.
- ~~**Eval harness design**~~ — *resolved:* dynamic routing, coverage, edition, composition, denominator, clarify, narration, and workspace cases.
- ~~**SSE vs WebSocket**~~ — *resolved:* SSE kept; resume via `Last-Event-ID` over the turn registry (§27.3); cancel is a plain HTTP POST.

---

# Part II — The full-stack app

## 26. The shape of the full-stack app

The agent service was built API-first precisely so the full-stack app layer would be additive (Part I, §23): the optional principal in the request context, the nullable `user_id` on sessions, the additive-within-v1 event protocol, and the client-agnostic API were all reserved seams. The full-stack app lands on them. **Nothing in the full-stack app touches `domain/`** — the honesty core ships as-is. The one sanctioned `domain/` delta is the additive event types — `StepData`/`ThinkingData`, the `cancelled` status on `done`, and the message ids on `meta` (`domain/events.py`, §27.7). The honesty core's logic is untouched; anything beyond this carve-out stops for an ADR.

```
              ┌──────────────────────────────────┐   ┌──────────────────────┐
   browser    │  Counselle web app  (frontend/)  │   │  marketing landing   │
              │  React SPA — MVP3 workspace      │   │  page (one static    │
              │  shell + protocol client         │   │  file, served at /)  │
              └────────────────┬─────────────────┘   └──────────┬───────────┘
                               │  same origin: /v1/* (REST + SSE), cookie auth
              ┌────────────────▼────────────────────────────────▼───────────┐
              │           Counselle service (the SAME FastAPI app)          │
              │  api/    + auth, chat CRUD, feedback, rate limit, SPA serve │
              │  app/    + step/thinking emission, cancel, auto-title       │
              │  domain/   UNCHANGED — the honesty core ships as-is         │
              └────────────────┬─────────────────────────────────────────────┘
                               │  everything below identical to Part I, §2
              (in-process facts-store tools · Tavily · Postgres counselle.* · facts-store read-only)
```

**Principles of the full-stack app layer (deltas to Part I, §1):**

1. **Still one backend deployable.** No second service, no BFF, no gateway, no Redis, no message bus. Auth is `api/`-layer middleware and routes; chat CRUD is routes over rows that already exist (ADR 0019); rate limiting is middleware. The dependency rule (ADR 0017) absorbs all of it.
2. **Every addition lands on a reserved seam.** Auth fills the optional principal (Part I, §6). Chat history reads rows the checkpointer already writes (Part I, §7). New event types ride the additive-within-v1 rule (Part I, §6). If any addition ever requires changing `domain/` or breaking v1 semantics — stop and write the ADR (the Part I, §23 discipline).
3. **The frontend is a pure client.** It speaks only the versioned protocol. The service still doesn't know or care what renders it.
4. **MVP3 frontend reset.** The active frontend is rebuilt from the MVP3 design system and workspace shell; ADR 0020's LibreChat clone is historical and superseded by ADR 0026. The backend protocol client remains the same `/v1` same-origin client.
5. **Same origin, one container.** The SPA and the landing page are served by the FastAPI service (§33, ADR 0023) — no CORS, trivial cookie auth, one TLS cert, one deploy.

**Seam inventory:** several foundations already existed in the agent service and required no new work for the full-stack app — the SSE `id:` field on every event (`api/sse.py`), `sessions.updated_at` + the per-turn touch (`migrations/0001_sessions.sql`, `app/sessions.py`), the in-process single-flight guard (`api/routes/sessions.py`), the unvalidated-principal seam (`api/context.py`), the `Containerfile`, `.env.example`, and the yoyo migration chain. The genuinely new machinery added in Part II: the **turn registry** (§27.3), step/thinking emission (§27.1–27.2), auth, the chat-management routes, and the frontend.

---

## 27. Protocol extensions: work visibility, resume & cancel

(ADR 0022.) All changes are **additive within v1** — `v` stays 1; unknown event types are ignored by design (Part I, §6), so any client ignores unknown event types and additive changes never break existing clients. This section is the single biggest enabler of the PRD's chat experience: the base protocol has no granular work visibility.

### 27.1 New event: `step`

Start/end pair per unit of agent work. The activity timeline renders these directly.

```jsonc
// status: "start"
{ "v": 1, "type": "step", "data": {
    "step_id": "s3",                  // unique within the turn; pairs start/end
    "status": "start",                // start | end | error
    "kind": "web_search",             // db_tool | sql | web_search | edu_search |
                                      // reddit_search | viz | skill | research
    "tool": "search_web",             // stable optional presentation identity
    "label": "Searching the web: nyu cs acceptance rate 2026",  // human label, pre-built server-side
    "tier": "official",               // official | community | null — drives the icon/color grammar
    "detail": null
}}

// status: "end" — same step_id, carries the receipts (PRD story 15)
{ "v": 1, "type": "step", "data": {
    "step_id": "s3", "status": "end", "kind": "web_search", "tool": "search_web",
    "label": "Searching the web: nyu cs acceptance rate 2026", "tier": "official",
    "detail": {                       // kind-specific; the expandable receipt
      "query": "nyu cs acceptance rate 2026",
      "domains": ["niche.com", "usnews.com"],
      "result_count": 5,
      "duration_ms": 1840
      // DB kinds carry safe structure only: tool plus query/result_count/schools,
      // domain_id/value_count, or row_count as applicable
      // viz carries: viz_type, value_count, schools, sources
    }
}}
```

- **Emission seam (a named build-time gate):** the preferred path is PydanticAI's native `agent.iter()` loop, with `ModelRequestNode.stream(run.ctx)` and `CallToolsNode.stream(run.ctx)` surfaced through the graph's custom stream — the stack's own seam (Part I, §1 principle 2). The node advances with `next_node` / `await run.next(node)`; that is the runtime seam the code now owns. Either way, **no hand-wrapping of tools** (ADR 0017).
- **The step mapper is a named module, not route code:** a pure function — tool-call info in, `{kind, tier, label}` out — using the label templates. The route generator stays a dumb encode-and-yield loop; the mapper (`app/steps.py`) is table-driven-testable with zero mocks (§34).
- **Labels are editorial:** templates in `config/assets/step_labels.yaml` cover the exact four DB tools plus search/workspace/viz kinds. Changing product voice never touches code.
- **Steps persist (PRD stories 15–16, decision 5):** at turn end, the turn's **step record** — steps with their receipts, the thinking lines (§27.2), and the derived one-line receipt — is written into the graph state alongside the messages. No new storage: the checkpointer already holds that state. The transcript read returns it per assistant message (§27.5). Without this, "expandable forever" and the collapsed receipt on old chats would be a lie — the timeline would exist only as ephemeral stream events.
- **Source-control enforcement is visible for free** (PRD story 17): a disabled source's tool isn't mounted (ADR 0013), so its `kind` *cannot* appear in the timeline. No new enforcement needed — the existing mechanism becomes user-visible.
- **`research` kind is reserved** — the deep-research follow-up emits its phases through the same event (PRD story 52's "UI room reserved").
- **Receipts never leak payloads:** resolve may show query/result count/safe school names; profile/domain show school/domain/value counts; SQL shows row count only; viz shows type/value count/schools/source count. No SQL, params, rows, packets, values, excerpts, diagnostics, provider metadata, DSNs, or credentials.

### 27.2 New events: `narration` and `thinking`

```jsonc
{ "v": 1, "type": "narration", "data": { "text": "Checking the official site for the deadline." } }
```

```jsonc
{ "v": 1, "type": "thinking", "data": { "text": "The deadline is probably on the admissions page." } }
```

`narration` is the assistant's agent-visible prose and status trail: the visible run narration, the inline status updates, and the replayable copy/export surface. `thinking` is the native model thought stream when the model emits one. They are separate on purpose, so the transcript can show what the assistant said without collapsing that into the model's private thought stream. `delta` remains final-answer prose only. The visible run can have narration before the answer, and native thinking can appear independently when enabled by the model/provider.

The live gate is final-answer mode: `delta` starts once the answer phase begins. Native thought output is controlled by `thinking_stream` (default off, ADR 0043): the model reasons either way, and with the gate off the emission router consumes its reasoning text without streaming or recording it. The timeline keeps the visible narration lines in the turn's step record (§27.1), so revisited chats preserve the run surface under the expanded receipt. See `config/settings.py`.

With counselor response modes (ADR 0034, 0043), `thinking_stream` is deliberately
not the mode selector. Quick runs the Quick model at `reasoning_effort_quick`
(`low`); Think runs the Think model at `reasoning_effort_think` (`high`). A goal
turn keeps the effort of the mode it was started in. `thinking_stream` only
decides whether the reasoning text is emitted as `thinking` events. Earlier
turns' reasoning is stripped from the history sent to the model, so a chat
started on another provider never replays its thoughts as text.

### 27.3 The turn registry (one module owns the turn lifecycle)

**The load-bearing structural change in the backend delta.** Today the turn *is* the request-handler coroutine: `api/routes/sessions.py` runs `run_turn()` inside the SSE response generator, and the single-flight guard is a bare `set` on `app.state`. In that shape, a client disconnect (an F5!) cancels the coroutine and **kills the turn** — refresh-proof streams (PRD story 39) are impossible — and cancel/reattach would be different routes with no shared object to act on.

**One deep module — the turn registry** (`app/turns.py`) — owns the live lifecycle,
with terminal persistence factored into `app/turn_persistence.py` (ADR 0025):

- **Turns run as detached asyncio tasks** that outlive any HTTP request. Per session the registry holds: the running task, the **ring buffer** of emitted events (size in Settings), the **single-flight lock**, and the **cancel handle**. A disconnected client costs the turn nothing.
- **Interface (the endpoints become thin callers):** `start(session_id, message, …)`, `attach(session_id, last_event_id) → event iterator`, `cancel(session_id)`, `steer(session_id, text)`, `is_generating(session_id)`.
- `app/run_handle.py` keeps the process-local `RunHandleStore`: the registry registers one handle per active session, the node reads it by `session_id`, and queued steering / replayable snapshot metadata never enters graph state.
- `POST .../messages` = start + attach. **`GET /v1/sessions/{id}/stream`** = attach from `Last-Event-ID` — replay the buffer tail, then live to `done`. (Every event carries the SSE `id:` field — `api/sse.py`; the buffer and reattach are the new parts.) No active turn in this process → `204 No Content` → the client falls back to the **transcript read** (§27.5).
- `POST .../steer` queues ordinary live user text into the active run. The backend emits `user_message` immediately; `injected:false` is the immediate ack and may later be upgraded/replayed as `true` with the same id if the active run accepts the text. If the run ends first, the leftover `false` stays client-owned for the next normal turn; the settled turn record does not persist that false segment.
- **Single-writer rule** (PRD story 40): a second `POST .../messages` while a turn is active → `409 {error: "stream_active"}` (the existing guard moves into the registry). Ordinary live re-asks go through `POST .../steer`; `cancel` is reserved for explicit stop/edit semantics, not routine live sends. The sessions list (§29) reads `is_generating` from the registry for the cross-tab indicator.
- **Selected skills are turn-scoped execution state.** A normal start validates and records the submitted selected skills; the counseling response mode is just the first selected skill when a mode is available. Live steering never replaces the active turn's selected skills — mode-only steering is sent as text and inherits the running turn, while attempts to add task skills during an active run keep the existing safe rejection. Retry reuses the captured selected-skill list; regenerate uses the parent question's historical selected skills and therefore rewinds the visible mode with the rewritten branch.
- **Backpressure caps** (both Settings knobs): a reattach beyond `max_consumers_per_turn` → `429`; a start beyond `max_concurrent_turns` process-wide → `503`. Both degrade gracefully — the client falls back to the transcript read.
- **The buffer is best-effort UX; persisted state is the correctness guarantee** — prose in the checkpointer, the step record in the graph state (§27.1). `app/turn_persistence.py` is the single owner of terminal update payloads and the empty-partial prose rule, so transcript writes do not drift across the node, runner, and registry. A deploy mid-turn loses the buffer, not the chat. No Redis, no event store.
- **Every piece of single-instance state lives inside this one module** — §33's scale-out story becomes "re-back the turn registry", not a hunt across route handlers. Deletion test: removing the registry would smear task ownership, buffering, locking, and cancellation across four route handlers — it concentrates complexity, so it earns its keep.

### 27.4 Cancel

- **`POST /v1/sessions/{id}/steer`** — queues a user message into the active run. The route emits `user_message` immediately; `injected:false` is the immediate ack and may later be upgraded/replayed as `true` with the same id when the active run accepts it. If the active run ends first, the leftover `false` stays client-owned for the next normal turn; the settled turn record does not persist that false segment.
- **New endpoint: `POST /v1/sessions/{id}/cancel`** — the registry cancels the detached task via asyncio cancellation at the graph boundary. The run is suspended, not forgotten: the partial provider history snapshot and partial turn record persist, then the stream terminates with `done`; partial prose persists (the student keeps what streamed).
- **`done.data.status` gains `cancelled`** — extending the *existing* enum (`complete | awaiting_input` today, `domain/events.py`) rather than introducing a parallel `stop_reason` field. Additive within v1. The composer's send⇄stop swap (PRD story 38) is cancel + this field.
- *Full cancel semantics (idle / pending A1 / racing completion / watchdog) are recorded in §27.7 (G5).*

### 27.5 The transcript contract

The transcript read (`GET /v1/sessions/{id}`) returns user/assistant text pairs reconstructed from graph state, extended per assistant message with the persisted **step record** (§27.1): steps with receipts, thinking lines, and the one-line receipt. This is the typed contract the frontend's turn reducer consumes (§31.4); it's what lets old chats render the collapsed receipt by default (PRD decision 5), keeps receipts "expandable forever" (story 16), and gives the resume fallback full fidelity. Turns with no step record simply render prose.

*The step record described here grew into the full **turn record** — §27.7 (G2) — which carries everything a full-fidelity transcript needs, not just steps.*

### 27.6 New/changed endpoints summary

| Endpoint | Purpose |
|---|---|
| `GET /v1/sessions` | List + title search (owner's sessions) — §29 |
| `PATCH /v1/sessions/{id}` | Rename — §29 |
| `DELETE /v1/sessions/{id}` | Delete chat (+ its checkpoints) — §29 |
| `GET /v1/sessions/{id}/stream` | Reattach to an in-flight turn (Last-Event-ID) — §27.3 |
| `POST /v1/sessions/{id}/steer` | Queue text into the active run and emit `user_message` — §27.3 / §27.7 |
| `POST /v1/sessions/{id}/cancel` | Stop the active turn — §27.4 |
| `POST /v1/sessions/{id}/messages/{message_id}/feedback` | Thumbs up/down — §30 |
| `POST /v1/auth/*` | fastapi-users routers (register, login, logout, forgot/reset, Google OAuth) — §28 |
| `GET/PATCH/DELETE /v1/me` | Account read/update/delete; `DELETE /v1/me/chats` for delete-all — §28 |
| `GET /v1/config` | Runtime client config: starter chips, greeting, default source-config, response-mode capability list — §32 |
| `POST /v1/essays/{id}/session` | Get-or-create the essay's own durable panel thread — §39 |
| `POST /v1/essays/{id}/suggestions/{suggestion_id}/accept` \| `/reject` | Resolve one pending suggestion — §39 |
| `POST /v1/essays/{id}/suggestions/accept-all` \| `/reject-all` | Resolve the whole queue — §39 |

All existing v1 endpoints keep their exact semantics; `POST /v1/sessions` and `POST .../messages` now require auth and stamp `user_id`. `POST .../messages` additionally accepts an optional `surface` and, for the essay surface, a nested `essay_context` (§39) — additive within v1, defaulting to the chat surface when omitted.

### 27.7 Turn identity, the turn record & lifecycle semantics

Five design questions resolved here as architecture (ADR 0022 carries the decision trail). The field-level FE↔BE contract that realizes these on the wire is **the wire contract** (`specs/mvp2/plan/wire-contract.md`, archived with the ship plan).

- **Message identity (G1).** Every turn mints two UUIDs at start — `user_message_id` and `message_id` (the assistant message). Both ride `meta.data` (additive within v1 — the live stream can address the in-flight message for feedback/edit) and persist in the turn record. Feedback keys on the globally-unique assistant `message_id`. For new clarifications, A1 and A2 are separate assistant records connected by `continuation_of`; historical interrupt-backed records keep their original identity semantics through compatibility replay.
- **The turn record (G2 — supersedes §27.5's step record).** The run is the message: per assistant turn, persisted in graph state (`app/records.py`): the G1 ids; the immutable `response_mode` and exact resolved `model`; ordered `parts[]` — **materialized** segments in stream order (`{"type":"text","text":…}` and `{"type":"viz","spec":…}`; adjacent deltas merged, verbatim text, **never offsets into `messages`**) so the record is self-contained and the transcript read never slices prose out of the message history; `segments[]` — the whole-run replay surface used by transcript replay and copy/export (`narration`, `thinking`, `delta`, `viz`, `step`, `user` beats in stream order); steps + receipts; thinking lines; the one-line receipt; the sources payload; usage; terminal status (plus the error payload when status is `error`); the clarify record (spec + answer/unanswered); timestamps; and a separate `messages_offset` field — the index of this turn's user `ModelRequest` in `messages`, the graph-state slice point for history rewrite (server-internal, never on the wire). One prose invariant holds everywhere: when a snapshot exists, transcript reads are snapshot-first partial history; the prose invariant applies only to the uncommitted tail and record surface, so every terminal path (complete, cancelled, error, tool-budget) leaves the record's `parts[]` and the live `messages` tail aligned with the streamed prose. The transcript read returns the consumer-contract wire shape; turns predating the full-stack app have no record and render prose-only.
- **Whole-run copy/export.** Clipboard/share actions should use the ordered run record, not final prose alone. The run is the message, so the assistant-side copy target is the whole run.
- **Edit & regenerate = history rewrite (G3).** `POST /v1/sessions/{id}/messages` gains optional `replace_message_id` (a prior `user_message_id`): with the single-flight lock held and no active turn, one `aupdate_state` rewrite — messages sliced at the target turn's `messages_offset`, turn records truncated, the source registry restored from the last surviving record's cumulative snapshot, and any pending clarification/continuation state cleared (per G4) — then the new text runs as a normal turn. **Regenerate = edit of the last user message with the same text** — one mechanism. Turns without a `user_message_id` **cannot be edit targets** (`422`; the FE hides Edit on id-less entries) — the rewrite never slices into record-less history; synthesized clarify-answer entries are likewise refused (`422`, by an explicit synthesized flag, not id-absence).
- **The clarify lifecycle (G4, superseded for new records by ADR 0035).** New clarifications do not use LangGraph `interrupt()` as the product mechanism. The agent emits `ask_student` as a typed PydanticAI output; early output semantics stop sibling tool execution, and the backend atomically persists A1 (the pending question record plus provider history) before streaming `clarify` and `done(awaiting_input)`. The answering POST names A1 with `in_reply_to` and either carries a widget `clarify_response` or composer text. Acceptance validates against the persisted A1 spec, emits `clarify_response`, then starts A2 as a separate assistant record with `continuation_of=A1`, inherited skills/source config/response mode, and no `ask_student` output tool. Widget-origin answers create no user bubble; composer-origin replies project exactly one user bubble. A durable `continuation_intent` covers accept-then-continue restarts: `accepted` can resume the same A2 id, while `running` never auto-replays A2 tools and instead exposes recovery. Historical v1 interrupt-backed records remain readable through compatibility replay, but ADR 0022's resume-replay consequence is no longer the new-record behavior.
- **Cancel semantics (G5).** Active turn → `202` + a single-shot `done(cancelled)`; idle → `204` no-op; pending A1 → `204` and the question freezes unanswered; A2 cancellation preserves the accepted A1 and any partial A2. Cancel racing completion = the idle no-op. **A watchdog timeout terminates with `error`, not `done(cancelled)`** — the student didn't press stop.

---

### 27.8 Mutation receipts

(Agent mutation receipts plan.) The 29 workspace/memory write tools (tasks, schools, essays, essay content, activities, honors, profile, memory) each attach a typed, versioned receipt to their step's `detail` — replacing generic rows like `Essay updated` with compact, trustworthy accounting of what changed, what was affected, and what the resulting state is.

- **One envelope, typed bodies.** `StepDetail.mutation: WorkspaceMutationReceipt | None` (`domain/mutation_receipts.py`) is `{v, family, action, outcome, body, notices, omissions}`. `family` (`task | school | essay | essay_content | activity | honor | profile | memory`) × `action` (`create | update | archive | restore | duplicate | reorder | edit | write | remember | update_memory | forget`) validates against an allowlisted body-kind map — not every pair is legal, and construction rejects an illegal one. `body` is a discriminated union: `batch` (per-input-position disposition), `update` (typed field changes), `state_transition` (create/archive/restore), `duplicate` (source/copy roles), `reorder` (authoritative order), `essay_edit`/`essay_write` (structural word-count facts, never prose), `profile` (section-grouped changes), `memory` (active-note facts), and `unresolved` (no domain identity — used only for `failed`/`unknown` outcomes).
- **Business truth is separate from transport status.** `step.status` stays the existing `start | end | error` lifecycle; `mutation.outcome` (`success | no_change | partial | failed | unknown`) is the honest business result. A `RetryPromptPart`/schema rejection — proven never to have run — synthesizes `outcome="failed"`; a write that may have entered a commit-capable region with no terminal proof (cancellation, timeout, budget, unexpected error) synthesizes `outcome="unknown"`. Both synthesis paths live in `EmissionRouter` (`app/steps.py`) — the single owner of terminal step-closure — using the exact 29-tool registry in `app/workspace_mutation_receipts.py:WRITE_TOOL_FAMILY_ACTION`, never untrusted call arguments. No settled turn ever shows a spinner or a present-tense write claim.
- **Builders, not middleware, construct receipts.** `app/workspace_mutation_receipts.py` (beside the existing `app/workspace_step_receipts.py`, which builds *read* previews) owns pure builders, size bounds, and grapheme-safe text truncation (via `regex`, since ADR 0017 keeps `domain/` to stdlib + pydantic only — the real Unicode segmentation lives in the app-layer builder, not the model). Each mutation tool calls the relevant builder while it still holds validated request context and authoritative committed results; `app/tool_middleware.process_tool_result` never builds a receipt itself, since it has neither.
- **Bounds and overflow.** A receipt is capped at 6,144 bytes; builders reduce deterministically (tail changes/items first) rather than reject. The overflow path (`app/tool_overflow.py`) preserves `mutation` and the independent `mutation_contract: 1` marker through spill reduction, and enforces a separate 10,240-byte compact-result budget for the agent-facing overflow envelope.
- **The `mutation_contract` marker is the corruption/history boundary.** Present + valid mutation → the typed receipt renders. Present + missing/invalid/oversized mutation → a safe synthesized "unknown" row (a *current* corrupted receipt, never treated as legacy). Absent → pre-feature historical step, rendered by the legacy generic write widget. The frontend's `parseMutationReceipt` (`frontend/src/features/ai-chat/components/mutation-receipts/`) is the one tolerant parser used by both live SSE and stored-transcript replay, so live and replayed receipts stay structurally equivalent.
- **Privacy is default-deny.** Essay prompts/body text, task/school notes, activity descriptions/stories, and profile free text never cross the receipt seam — exposure is `exact` or `changed_only` per an explicit per-family field allowlist (profile's is a schema-completeness-checked pair of path sets in `app/profile_exposure.py`; an unclassified profile field fails loudly rather than silently defaulting to visible). The one deliberate exception: `remember`/`update_memory`'s new active note content (capped at 200 characters, shown only on expansion) — the memory object's only meaningful identity. Later `forget`/`update_memory` never redacts an earlier chat receipt's content, and `forget` itself never repeats the forgotten text.
- **Frontend dispatch.** `ToolWidgets.tsx` routes a write's terminal step to `MutationReceiptRenderer` when `mutation_contract === 1`; otherwise it falls back to the legacy `WriteToolWidget`. `MutationReceiptShell` owns lifecycle/disclosure (collapsed by default, controlled open state that survives live updates without reopening or stealing focus) and dispatches the expanded body to each family's bespoke anatomy widget (`TaskMutationWidget`, `SchoolMutationWidget`, `EssayMutationWidget`, `EssayContentMutationWidget`, `ActivityMutationWidget`, `HonorMutationWidget`, `ProfileMutationWidget`, `MemoryMutationWidget` — `frontend/src/features/ai-chat/components/mutation-receipts/`), all sharing common formatters (`MutationReceiptBody`'s `formatValue`/`ChangeList`, `formatWordBudget`) rather than duplicating field-rendering logic. `mutationGlanceText` is the one glance formatter shared by the collapsed row and `runMarkdownOf()` copy/export, so visible and copied text never disagree. An automated `jest-axe` pass checks every family's collapsed and expanded state for ARIA/labeling defects; it cannot verify real color contrast or exercise a live screen reader, so a manual AT pass is still open.

## 28. Identity & auth

(ADR 0021.) ADR 0016's "optional principal" and ADR 0019's "nullable `user_id`" become concrete here. Scope is exactly the PRD's decision 6: email + password, Google OAuth, password reset — no email-verification ceremony, no 2FA, no profile wizard.

- **Library: `fastapi-users`** (+ `httpx-oauth` for Google). Battle-tested registration/login/logout/forgot-password/reset-password routers, password hashing, and OAuth association — never hand-roll auth (house principle 2). Mounted under `/v1/auth/*`.
- **Token transport: JWT in an httpOnly, `Secure`, `SameSite=Lax` cookie.** The deciding constraint is SSE: `EventSource` cannot set an `Authorization` header, but cookies ride along free on same-origin requests — and the SPA *is* same-origin (§33). One transport for REST and streams, zero token-juggling in the client.
- **CSRF posture:** `SameSite=Lax` + the API is JSON-only (no form-encoded state changes, content-type enforced). That combination is the standard mitigation; no CSRF-token machinery. Revisit only if the app is ever embedded cross-origin.
- **Google OAuth:** fastapi-users' OAuth router with `GoogleOAuth2`; accounts link by email (a Google sign-in with an existing email attaches to that user). Signup collects name + email only (PRD story 4).
- **Reset emails:** a thin `adapters/email.py` seam. The **`console`** provider is implemented — it prints the reset link to the logs (`email_provider` is `Literal["console"]` in Settings today). `smtp`/`resend` arms are stubbed for a later phase.
- **Schema delta** (own migration chain, `counselle.*` only — ADR 0019): `counselle.users` (fastapi-users base columns: `id uuid`, `email` unique, `hashed_password` nullable for OAuth-only accounts, `is_active`; plus `name`, `created_at`, `settings jsonb` for theme + default source-config preset) and `counselle.oauth_accounts`. `sessions.user_id` gets its FK and a NOT NULL constraint *for new rows* (enforced in code; old dev rows are deleted, not migrated — they're disposable).
- **The principal:** the auth dependency populates the existing request-context principal (`api/context.py` already parses-but-ignores it — the seam is sitting there) — exactly as Part I, §6 promised, **no route-shape or orchestration changes**.
- **Ownership is one dependency, not per-route code:** a single FastAPI dependency — `owned_session(session_id, principal)` — resolves principal → session row → ownership and raises uniformly; a foreign or unknown session returns **404, not 403** (don't leak existence). Every `/v1/sessions/*` route takes it as a parameter, so the authz rule has one home and one test suite — a route can't half-forget it, and a route-inventory test (§34) catches forgetting it entirely.
- **Data controls (PRD story 49):** `DELETE /v1/me/chats` (all sessions + checkpoints) and `DELETE /v1/me` (account + cascade). Confirm-gated in the client.
- **Settings storage:** the thin user settings (theme, default source-config preset) live in `users.settings jsonb` — no separate table for three fields (KISS). Name/email/password/Google live on the user row and the fastapi-users flows.

---

## 29. Chat management

(PRD stories 46–48.) Rows already exist (ADR 0019) — this is routes + one background task.

- **No schema delta here:** `counselle.sessions` already has `updated_at` (`migrations/0001_sessions.sql`) and `app/sessions.py` already touches it on every completed turn. Recency grouping (Today / Yesterday / Previous 7 days / older) is computed client-side from it.
- **List + search:** `GET /v1/sessions?q=&cursor=&limit=` — the owner's sessions, `updated_at` desc, cursor-paginated. `q` is a title `ILIKE` match in Postgres — title search is enough (PRD story 46); no search engine, no embedding index.
- **Rename / delete:** `PATCH` with `{title}`; `DELETE` removes the session row and the checkpointer rows for that thread (the LangGraph thread-deletion API; verified at build time).
- **Auto-titles (PRD story 47):** after the first turn's `done`, a fire-and-forget background task sends the first exchange to the cheap-tier model (model knob in Settings; prompt is a data asset) and updates `title`. On any failure the title stays as the default (the question, truncated) — titling never blocks or breaks a turn, never retries.
- **List rows carry `is_generating`** (§27.4) for the sidebar's cross-tab indicator.

---

## 30. Feedback & per-user rate limiting

**Feedback (PRD story 22):** `POST /v1/sessions/{id}/messages/{message_id}/feedback` with `{rating: "up" | "down" | null}` → `up`/`down` upsert into `counselle.feedback` (`id, user_id, session_id, message_id, rating, created_at`), keyed on `(user_id, message_id)`; `null` clears the rating (DELETE, 204). Re-submitting a different rating overwrites it. Feedback is an engineering instrument: the eval workflow reads this table (an export script in `evals/`, not a pipeline) to source regression questions from real thumbs-downs. Reason chips are a future addition (PRD).

**Rate limiting (PRD story 50):** the public-facing app means strangers can spend the model/Tavily budget.

- **Per-user, in-process sliding-window counters**, keyed by `user_id`, applied to the message-send route only — the only expensive route; reads are not limited.
- Knobs in Settings: `turns_per_hour`, `turns_per_day`. Exceeded → `429` with `Retry-After`; the client shows a plain generic message (richer limit UX is a future addition per the PRD).
- In-memory is *correct* at one instance (§33). The knobs living in Settings is what makes a shared backend (Redis/Postgres) a swap, not a rework — when scale-out happens, not before. ~30 lines of code; no limiter framework needed.
- **Per-user spend visibility for free:** the `turn_complete` log line (`api/routes/sessions.py`) carries session, trace, tokens, duration, estimated cost, and `user_id`. Per-user cost accounting is then log aggregation (Part I, §19's design intent), not new machinery.

---

## 31. The frontend

**Current direction (ADR 0026):** the active frontend is being rebuilt from the
MVP3 design system and workspace shell. ADR 0020's LibreChat clone is now the
historical MVP2 implementation record, not the rule for new frontend work. The
old backed-up frontend remains useful only as a reference for the `/v1` backend
client contract: auth, same-origin cookies, SSE transport, transcript projection,
and turn reduction.

The first rebuilt module is the workspace shell: app bootstrap, provider stack,
router, frame, sidebar primitive, and product sidebar composition. Feature pages
and the backend client seam are imported after that shell is verified.

The active chat composer has one shared response-mode selector beside Sources
(ADR 0034). The selected mode is a next-turn preference; when a turn starts, the
execution mode is snapshotted and then treated as immutable for that run.
Clarify answers, retry, regenerate, steer, reload, and session switching preserve
that distinction: UI stickiness can change for the next turn, but it never
rewrites the historical `response_mode`/`model` attached to an assistant entry.
The browser renders only `/v1/config.response_modes`, so a disabled Think mode
cannot be selected without a fresh server advertisement.

### Workspace module

The workspace is the persistent student planning surface over the agent service.
It contains four connected pages: Schools, Tasks, Essays, and Activities. The
frontend reads and mutates the workspace through `/v1` routes, while the backend
keeps the actual business rules in `app/workspace/` service functions. Routes
are thin adapters: they authenticate the user, pass explicit pools, `user_id`,
`actor`, and `event_bus`, and translate service errors into API envelopes.

Counselle owns the workspace data in the `counselle.*` schema. The pipeline
database remains read-only and is used only as the school catalog contract:
school search and application displays resolve identity from the catalog, but
student-owned workspace objects live in Counselle tables. Add-school is one
workspace mutation: it creates the application and seeds editable starter tasks
and essay slots from versioned workspace assets. Deadlines are user-entered
unless a value is explicitly owned by the workspace; sparse pipeline deadline
coverage is not treated as a source of truth.

Every workspace mutation records an actor-attributed row in
`counselle.workspace_changes` and publishes a thin post-commit event through
`Runtime.deps.workspace_events`. The event is an invalidation hint, not a state
payload; clients refetch the affected query keys. The same service call shape is
used by HTTP today and by future Counselle-agent tools, so agent-authored changes
produce the same audit rows and live UI updates as student-authored changes.
SSE reconnect uses `Last-Event-ID` replay from the table, and the scale-out path
is Postgres-backed fan-out rather than a second workspace vocabulary.

Activities and honors enforce the Common App-shaped workspace limits in both the
API model and UI. Public Common App resources confirm the activities count and
activity field caps; the UI wording stays generic where live first-year form
access is required to verify exact active-cycle wording.

A task carries two independent dates rather than one: **when** the student plans
to work on it, and **deadline**, the external date something is actually due (an
application deadline the task inherits, an essay's submission date). The two are
never conflated — a task can have either, both, or neither, and a deadline it
inherits from its application is surfaced as distinct from a deadline set on the
task itself, so an inherited date is never reported as the task's own. A task's
lifecycle collapses to open/done rather than a multi-value status. Every task also
records, in two columns, whether Counselle or the student created it and which of
the two last touched it — the same "did the agent touch this" question the actor
columns answer on tasks, workspace-wide, applies without a join against
`counselle.workspace_changes`. The agent's task tools speak the same vocabulary as
the API and UI: the same two date fields, the same open/done state, and the same
flag concept a student can set on a task to mark it out for themselves.

An essay is the one workspace object a student works *inside*, so it has two
hosts rather than one, and both are the same component. `EssayDocumentSurface`
(`frontend/src/features/essays/`) is the shared paper — the Tiptap editor, its
inset scale, and the tracked-change decorations — rendered by the full editor
route and by a right-hand document panel in the main chat. Beside the editor
sits `EssayChatPanel`, which is the existing `AiChatPage` in a narrow variant
(same composer, same streaming, same activity timeline) rather than a second
chat implementation, sending every turn with the essay's id and the student's
current selection. In the main chat, a settled essay mutation receipt's glance
line is a door: `EssayDocumentPanel` opens the same surface beside the
conversation, and the right rail is one discriminated union (`sources` |
`document`) so "both open" is not a reachable state. §39 covers the suggestion
lifecycle both hosts render.

### 31.0 Historical MVP2 frontend

The notes below describe the shipped MVP2 LibreChat clone and remain here as
historical context until the MVP3 frontend sections fully replace them.

### 31.1 The stack (locked by the clone decision)

Cloning LibreChat's components pixel-exactly requires running their rendering stack. Verified against the repo (MIT license; pinned commit recorded at clone time):

| Layer | Choice | Note |
|---|---|---|
| Framework | **React 18 + TypeScript** | Theirs exactly |
| Build | **Vite** | Theirs; dev server proxies `/v1` → the API (§33) |
| Styling | **Tailwind CSS 3.4** + their CSS-variable theme | Copied wholesale (§31.2). **Stay on their major version while cloning** — no v4 migration |
| Primitives | **Radix UI** + **lucide-react** icons | Theirs exactly |
| Server state | **TanStack Query** | Theirs; ours wraps *our* protocol client |
| Client state | **Jotai** | Their newer atoms are already Jotai; **we do not adopt Recoil** (their legacy store) |
| Routing | **react-router** | `/login /signup /reset /  /c/:sessionId` |
| Markdown | **react-markdown + remark-gfm** | Theirs; plus our citation-marker renderer |
| Composer | **react-textarea-autosize** | Theirs |
| Motion | **framer-motion** | Theirs; constrained by the PRD motion rules |
| Virtualization | Their message-list approach | Decide exact lib when cloning that surface (§35) |
| Fonts | **Inter / Roboto Mono** | Theirs exactly |

Deliberately **not** taken from their dependency pile (YAGNI): Recoil, `librechat-data-provider`, i18next, Mermaid/KaTeX/Monaco, file upload/DnD, speech, avatars, Meilisearch-backed search, `SiblingSwitch` (message branching — PRD decision 4 locked it out).

### 31.2 The clone strategy (the lego rule)

1. **Tokens first, wholesale.** Copy `client/tailwind.config.cjs` and `client/src/style.css` (the CSS-variable theme: `--surface-primary`, `--text-primary`, `--border-light`… defined per `:root`/`.dark`) plus the font setup, essentially verbatim. This single step guarantees that *anything* written in their class vocabulary — cloned or new — renders pixel-identically: colors, spacing, radii, both themes. Prune unused CSS later, never before.
2. **Vendor the cloned components.** `frontend/src/vendor/librechat/` holds components copied from their tree — **JSX structure and Tailwind classes preserved exactly**; their Recoil hooks and data-provider calls stripped and replaced with props wired to our state/API. The quarantine makes "this is a clone — don't restyle it" physical, and makes deliberate re-syncs against upstream possible. `UPSTREAM.md` in that directory records the pinned commit; the MIT license notice ships alongside (legal requirement).
   - **Cloned surfaces:** sidebar/nav + conversation list (incl. search, rename, delete, grouping), the composer (`ChatForm`, send/stop buttons, textarea autosize), the message shell + markdown content renderers + hover action row, the settings dialog (Radix tabs — their General/Account/Data structure maps ~1:1 onto our thin settings), the new-chat landing + conversation-starter chips, and the auth pages.
   - Expect each cloned surface to pull 3–10 support files (shared hooks, small ui/ atoms) — the vendor directory absorbs them.
3. **Build the Counselle-native components in their visual language.** These don't exist in LibreChat, so we write them — using *only* the cloned tokens, their Radix primitives, their spacing/radius scale, their motion timings: the **activity timeline** (steps, thinking lines, shimmer, collapse-to-receipt), the **dossier stat block**, the **comparison table**, **citation chips + anchored popovers**, the **sources footer**, the **clarify widget** (chips + freeze-to-record), the **"not in our database" card**, and the designed **"not available"** muted state. This is where the PRD's design laws get implemented (stable contained card layout, tabular numerals, 68ch measure, no winner-highlighting).
4. **Two new semantic token pairs** extend the cloned CSS-var system: `--official-*` (cool) and `--community-*` (warm) — defined once per theme, used identically by chips, timeline steps, cards, and the sources footer. Per the PRD's visual direction, this axis is the **only** place color carries meaning, and it's the only color addition we make to their system.

### 31.3 Repository layout

```
frontend/
├── package.json / vite.config.ts / tsconfig.json
├── tailwind.config.cjs           # cloned from LibreChat, pinned
├── index.html
└── src/
    ├── styles/                   # style.css (cloned tokens) + counselle.css (official/community tokens)
    ├── vendor/librechat/         # cloned components — quarantined; UPSTREAM.md + MIT notice
    ├── components/               # Counselle-native: timeline/ cards/ citations/ clarify/
    ├── vendor/librechat-data-provider/  # thin in-repo type shim (avoids their npm package)
    ├── api/                      # THE protocol client: fetch wrapper, SSE parser, event types, hooks
    ├── app/                      # AppShell, ChatView, ChatContext, routes.tsx, Jotai atoms (state.ts), auth hooks
    └── types/                    # shared TypeScript types
```

`frontend/` is the sole protocol client in the monorepo — a pure client like everything else (Part I principle 3). House rules apply (files <800 lines, organize by feature). *(Routing lives in `app/routes.tsx`; Jotai atoms in `app/state.ts`; hooks alongside their consumers, e.g. `api/hooks.ts` — there is no top-level `state/`, `routes/`, or `hooks/` directory.)*

### 31.4 State & data rules

- **TanStack Query owns server state** (me, sessions list, transcript, runtime config). **Jotai owns the small client state** (composer drafts, per-chat source-config, open popover, theme). **The URL owns which chat** (`/c/:sessionId`). Server state is never duplicated into client stores.
- **Counseling mode state is separate from `@` task skills in React state.** The composer keeps a sticky `selectedModeSkill` and per-turn `selectedTaskSkills`, then merges them only at the normal-turn send boundary. This preserves typed `@` deletion semantics for specialized skills without letting the mention parser delete the visible mode. Missing or malformed `skill_modes` hides the mode menu and falls back to the old visible `@` trigger rather than pretending a different mode is selected.
- **`src/api/` is the only module that knows the protocol.** A typed event union mirroring the `domain/` spec types; a fetch-streaming SSE parser (`POST` streams can't use `EventSource`; the same parser serves the reattach `GET`); cookie auth means zero token handling. Two forward-compatibility rules live here and nowhere else: **unknown event type → ignored; unknown render-spec type → titled, contained “requires a newer client” fallback without exposing arbitrary payload fields** (the degrade rule, PRD story 35).
- **The turn reducer is a named pure module** (`src/api/turn-reducer.ts`): protocol events in → turn view-state out (the append-only block list, the accumulated steps/thinking, and the derived receipt) — **no React imports**. Components are dumb draws over its output. Most of §31.5's smoothness laws *are* reducer logic; scattered through components they'd be untestable, and this is exactly where lying-to-a-student rendering bugs would live. It also reduces the persisted turn record from the transcript contract (§27.5/§27.7), so live streams and revisited chats render through one code path. Tested against the backend's exported protocol fixtures (§34).
- **Composer drafts persist to localStorage per session** (PRD story 41); a failed send keeps the text in the composer with inline retry.

### 31.5 The turn pipeline (how the smoothness laws are implemented)

| PRD law / story | Mechanism |
|---|---|
| 0ms echo, question pins to top (11) | Optimistic append in the send mutation; one programmatic scroll; answer fills downward — no bottom-chasing autoscroll |
| Activity <300ms, never silent (12, 36) | `step`/`thinking` events render the live timeline; SSE keepalives bound dead air |
| Streaming prose, no flicker (18) | Append-only markdown **block list** — completed blocks are memoized and never re-render; only the open block re-parses; soft caret at the stream edge |
| Citation chips materialize inline (19) | Marker syntax in `delta` → chip component via the markdown renderer, resolved against the `sources` event |
| Cards inline, stable contained layout (20, 43) | A viz event appends a contained card; wide tables scroll inside the card. The protocol provides no pre-viz dimensions, so no skeleton or zero-layout-shift guarantee is claimed |
| Collapse to receipt (16) | The turn reducer derives the receipt from accumulated `steps[]` at `done`; old chats render it from the persisted turn record (§27.5/§27.7, PRD decision 5) |
| Scroll always wins (37) | User scroll detaches the view; "↓ Latest" pill; completion never yanks the viewport |
| Stop / re-ask (38) | Send⇄stop button on `is_generating`/`done.status`; ordinary live re-asks steer via `POST /steer`, while cancel is reserved for explicit stop/edit semantics (§27.3-§27.4) |
| F5-proof (39) | Reattach via `GET .../stream` + Last-Event-ID against the turn registry; 204 → transcript fetch (§27.3, §27.5) |
| Long chats at 60fps (42) | Virtualized message list; lazily mounted cards; per-chat scroll restoration |
| Reduced motion (44) | `prefers-reduced-motion` kills shimmer/transitions globally |

### 31.6 The landing page

One static HTML file (no framework, no build step) served at `/` for logged-out visitors — what Counselle is, one dossier screenshot, a signup CTA (PRD decision 2). Logged-in users are redirected into the app. Copy lives in the file; it's one page, not a CMS.

---

## 32. Configuration delta

(Extends Part I, §18 — same three buckets, same test.)

**Settings groups added:**

| Group | Knobs |
|---|---|
| Auth | `jwt_secret` (required, ≥32 bytes) + `jwt_lifetime_seconds`, `cookie_name`/`cookie_secure`, `google_oauth_client_id`/`_secret`, `oauth_state_secret` (falls back to the JWT secret), `oauth_redirect_url`, `password_min_length`. *(Reset-token TTL is a fastapi-users class default, not a Settings knob.)* |
| Email | `email_provider` (`Literal["console"]` today; `smtp`/`resend` stubbed), `email_from` |
| Rate limit | `turns_per_hour`, `turns_per_day` (per-user); `auth_attempts_per_window`, `auth_window_seconds` (per-IP, on login + forgot-password) |
| Chat | `model_title` (cheap-tier title model, distinct from `model_cheap`), `title_max_len`, response-mode display/capability knobs, `thinking_stream` (default off, ADR 0043), `thinking_threshold_chars` |
| Streaming | `agent_stream_buffer_size` (resume ring buffer), `stream_buffer_bytes` (process-wide buffer byte budget), `persist_partial_timeout_s`, `reattach_enabled`, `agent_turn_timeout_s` (watchdog), `max_concurrent_turns`, `max_consumers_per_turn` |
| Frontend | static bundle dir, serve on/off — planned per §33; in dev `frontend/` runs on the Vite dev server proxying `/v1` to the API |

**Data assets added (`config/assets/`):** `starter_prompts.yaml` (the home-screen chips, one per signature capability), `greeting_templates.yaml` (keyed by `admission_season` phase — the season-aware greeting reuses Part I, §16's machinery), `step_labels.yaml` (§27.1), the title prompt, email templates.

**`GET /v1/config`** serves the client-relevant assets at runtime (starter chips, greeting for today's season, default source-config) — editorial changes ship without a frontend rebuild, and the greeting derives from the same season function the agent uses (one mechanism, never two).

It also serves the response-mode capability list: `default_response_mode`
(`quick`) and `response_modes[]` with presentation-safe ids/model display
names. The frontend renders only this list. If `response_mode_think_enabled` is
false, Think is omitted and stale client-side Think choices normalize to Quick
before the next send.

---

## 33. Deployment of the full-stack app

(ADR 0023; extends Part I, §20 — deployability remains a property, not a phase.) The operational runbook and env matrix live in `docs/DEPLOY.md`.

- **Still one container.** The single-stage `Containerfile` becomes multi-stage: stage 1 (node) builds the Vite bundle; stage 2 is the existing Python image with the bundle mounted via FastAPI `StaticFiles` and the static landing page at `/`. `/v1/*` is the API; everything else falls through to the SPA (client-side routing).
- **Same origin is the load-bearing choice:** no CORS configuration, cookie auth trivially secure (no third-party-cookie pain), SSE auth just works, one TLS cert, one deploy target (any VPS / Fly / Railway, day one). Splitting the SPA to a CDN later is a config change, not an architecture change.
- **Dev parity:** Vite dev server proxies `/v1` → `localhost:8000`, so the same-origin posture (and cookie behavior) holds in development with HMR.
- **The statelessness clause, amended honestly:** the service remains stateless **except for two named owners of in-process, best-effort state** — the **turn registry** (§27.3, including the process-local `RunHandleStore`: detached tasks, ring buffers, stream locks, cancel handles) and the **rate-limit counters** (§30). Each degrades gracefully on restart (transcript catch-up / lock vanishes with its turn / counters reset). **One instance is the documented posture.** Scale-out beyond one instance means re-backing exactly these two — a contained, known job, deliberately not done before it's needed.
- **SSE through proxies:** streaming responses set `X-Accel-Buffering: no` and rely on the protocol's keepalives (both already implemented — `api/sse.py`); verify behavior on the chosen host at deploy time.
- **Migrations on deploy:** the container entrypoint runs `yoyo apply` against `counselle.*` before exec'ing uvicorn. New migrations: users, oauth_accounts, feedback.

---

## 34. Frontend testing strategy

(The Part I, §21 philosophy carries: **test where lying to a student is possible**; behavior, not implementation.)

- **The turn registry is the new deep-module test surface** — unit-tested with a fake event source, no HTTP: client disconnect leaves the detached turn running; reattach replays exactly from `Last-Event-ID`; cancel persists partial prose and emits `done.status = cancelled`; double-send → 409; buffer overflow degrades to transcript fallback. Clarification durability and A2 continuation regressions cover restart/reconnect around pending A1 and accepted continuations.
- **The step mapper is table-driven:** tool-call fixture in → `{kind, tier, label}` out, one row per tool — zero mocks, the labels asset exercised directly.
- **Backend delta — routine pytest, no live LLM:** auth flows + the `owned_session` dependency (foreign session → 404; plus a route-inventory test asserting every `/v1/sessions/*` route declares it), rate-limit behavior (429 + Retry-After + window reset), step persistence (the step record survives into the transcript read), **disabled source ⇒ its step kind cannot appear** (story 17's test), feedback idempotency, auto-title failure never blocks a turn.
- **Shared protocol fixtures are the contract test:** the backend's protocol tests export their emitted event payloads (including a full turn with steps, viz, clarify, and the transcript with step records) as JSON fixture files; the frontend's turn-reducer tests consume the same files. Python↔TypeScript drift is caught by a failing fixture without a separate cross-service contract-test harness.
- **Frontend — the honesty surfaces are the test surface** (Vitest + Testing Library; the turn reducer tested headlessly against the shared fixtures, components against fixture render specs): "not available" renders the designed muted state, never an empty cell; tier chips always match envelope tier; comparison table never winner-highlights; unknown card type → titled, contained “requires a newer client” fallback; the clarify widget freezes to a record after answering; citation popover content matches the envelope.
- **One Playwright smoke** (the only E2E): signup → ask → stream completes with timeline → refresh mid-answer lands on a sane state → transcript intact. Nothing more — no visual-regression infra, no cross-browser matrix.
- **The eval set re-baseline:** the `thinking`-rerouting prompt delta (§27.2) shifted the eval baseline by design, so the close-out must re-run the routine subset once and compare like-with-like, per-criterion — not headline accuracy. Response-mode rollout adds a two-mode eval run over identical cases: compare quality, citation honesty, latency, tool behavior, and cost before enabling Think beyond verified environments. Thumbs feedback feeds the regression-question workflow (§30).

---

## 35. Risks & open questions

| Risk | Mitigation |
|---|---|
| LibreChat upstream churn / clone drift | Pinned commit in `UPSTREAM.md`; `vendor/` quarantine; re-syncing is a deliberate task, never automatic |
| Version skew (their Tailwind 3.4 vs ecosystem v4) | Stay on their versions while cloning; upgrade only if/when re-syncing with them |
| Cloned components drag hidden coupling (Recoil stores, their contexts) | Strip-and-rewire at vendor time; each surface budgets its support files; shared protocol-fixture tests prove the wire stays clean |
| In-process resume buffer lost on restart/deploy | Transcript catch-up is the correctness guarantee; the buffer is UX sugar (§27.3) |
| ~~pydantic-ai doesn't emit tool-call stream events~~ | *Resolved:* the pinned pydantic-ai exposes `FunctionToolCallEvent`/`FunctionToolResultEvent` through the `agent.iter()` / node-stream loop; `app/steps.py` consumes them directly. The MCP-hook fallback was not needed. |
| Step records bloat graph state on long chats | Receipts are bounded to safe structural counts/names/domain ids with no payloads; checkpoint growth already has the TTL knob. |
| Cookie auth CSRF | `SameSite=Lax` + JSON-only state changes (§28); revisit if ever embedded cross-origin |
| Single-instance assumptions (the turn registry + rate counters) | Explicitly documented as the one-instance posture (§33); two named owners, closed list; re-back them when scale demands |
| SSE buffered/broken by proxies | `X-Accel-Buffering: no` + keepalives; verify on the chosen host |
| `step`/`thinking` leak internals or fabricate | Labels are asset-driven; receipts expose only safe structural counts/names/domain ids; thinking narrates intent, never facts-first. |
| fastapi-users maintenance risk | Surface used is small (routers + dependency); standard FastAPI underneath; replaceable at the router layer |
| `users.settings jsonb` grows into a junk drawer | It holds exactly theme + source preset; anything more triggers a real column/table decision |
| Think preview/quota/cost changes underneath us | `response_mode_think_enabled` removes Think from advertised capabilities; explicit Think requests fail before claim/model call; pricing/lifecycle docs are rechecked before rollout. |

**Open questions — resolved (kept as the decision trail):**

- ~~The §27.1 emission gate~~ — *resolved:* the pinned pydantic-ai emits the tool-call events; `app/steps.py` (`EmissionRouter`) consumes them.
- ~~Exact `fastapi-users` / `httpx-oauth` versions~~ — *resolved:* fastapi-users 15.0.5, httpx-oauth 0.17.0, pwdlib 0.3.0, pyjwt 2.13.0 (pinned).
- ~~The LibreChat pin commit~~ — *resolved:* recorded in `frontend/src/vendor/librechat/UPSTREAM.md`.
- ~~LangGraph thread-deletion API for chat delete~~ — *resolved:* `AsyncPostgresSaver.adelete_thread(thread_id)` — used in `api/routes/me.py` and `api/routes/sessions.py`.

**Still open:**

- `thinking` density — the model's own "Narrate As You Work" one-liner per round is the dead-air mitigation that ships (`thinking_stream` is off by default, ADR 0043). If dogfooding still shows sparse narration, add the cheap-model per-step summarizer (decide on evidence).
- Think rollout — live smokes and two-mode eval comparison require Fireworks/Tavily
  credentials plus owner approval of quality/cost. Until then Quick remains the
  default and Think can be disabled honestly with `response_mode_think_enabled`.
- Virtualization library — clone theirs vs a lighter modern one; decide when the long-chat surface needs it.

---

## 36. Student profile, documents & agent memory

(ADR 0031.) Alongside the workspace (§31), Counselle keeps three more
per-student stores: the student's own application facts, their uploaded
documents, and the agent's curated understanding of them. All three follow
the same `app/workspace/` service pattern (ADR 0027/0029) — explicit
`user_id`/`actor`, `record_change` rows, `WorkspaceEventBus` publish, thin
HTTP routes, agent tools calling services in-process — so this section
covers what's new rather than re-explaining the pattern.

**Schema (`migrations/0010_profile_memory.sql`):**

| Table | Shape |
|---|---|
| `counselle.profiles` | One row per user; `data jsonb`, validated at the service boundary by a typed `Profile` model (`app/workspace/models.py`) with ten section submodels (`basics`, `academics`, `testing`, `background`, `circumstances`, `aid`, `interests`, `preferences`, `narrative`, `people`). Lazily created on first read. |
| `counselle.documents` | One row per upload: `content bytea` (≤15 MiB, `DOCUMENT_MAX_BYTES`), `extracted_text`, `text_status` (`extracted \| unsupported \| failed`), `summary` (nullable, ≤5,000 chars), soft-archived via `archived_at`. |
| `counselle.memories` | One row per note: `content` (1–200 chars, `MEMORY_CONTENT_MAX_LENGTH`), soft-archived; a unique index on `(user_id, content)` for active rows backstops exact-duplicate rejection. |

**Services:** `service_profile.py` (lazy `get_profile`, section-merge
`update_profile` — a present field merges, an explicit `null` clears it),
`service_documents.py` (`list_documents`, `create_document`/
`upload_document` which extracts and summarizes before persisting,
`get_document`, `read_document`, `archive_document`/`restore_document`),
`service_memory.py` (`list_memories`, `create_memories` batched under a
per-user Postgres advisory lock so capacity/duplicate checks cannot race,
`update_memory`, `archive_memory`/`restore_memory`). Extraction
(`app/workspace/extraction.py`) runs pdf via `pypdf`, docx via
`python-docx`, txt/md as-is, off the event loop with a timeout bound
against decompression-bomb-style inputs; images are accepted and stored but
marked `unsupported` (no OCR). Upload succeeds even when the cheap-model
summary call fails — filename and type remain the fallback signal.

**`app/student_context.py` — the render-per-turn mechanism.** `prepare`
(`app/graph.py`) calls `build_student_context` alongside
`build_temporal_context`, on the same seam, for every authenticated turn;
unauthenticated turns get a single neutral line
(`STUDENT_CONTEXT_UNAUTHENTICATED`). The result fills the `{student_context}`
slot in `counselor.md` (`app/prompt.py`). This module is honesty-critical,
the same tier as the DB value-reading rules, and enforces:

- **Verbatim scalar rendering.** Profile fields render in each Pydantic
  model's declared field order — never resorted, never rounded, never
  reinterpreted (`render_profile_block`). Empty sections and fields are
  omitted rather than invented; a fully empty profile renders an explicit
  "Profile is empty" line instead of nothing.
- **Document honesty.** Every document line carries its `text_status`
  next to it; `unsupported`/`failed` documents render a fixed "can't read
  this yet" note instead of a fabricated detail, and only a summary line —
  never full extracted text — rides the prompt.
- **Prompt-injection defense.** `_collapse_newlines` strips embedded line
  breaks from every piece of untrusted, student-authored text (profile free
  text, document filenames, memory content) before interpolation — Markdown
  only recognizes `#` headings at the start of a line, so a string like
  `"...\n## SYSTEM OVERRIDE\n..."` degrades to harmless inline text once its
  newlines are gone. Document filenames are additionally neutralized
  (`_neutralize_filename`) so a crafted name can't forge extra delimited
  fields in the hand-built document line. `counselor.md` reinforces this in
  the prompt itself: everything in the block is an observation about the
  student, never an instruction to follow.
- **Memory's capacity meter.** `app/workspace/memory_context.py` renders
  the active pile with a live usage header (`### Memory (9 notes ·
  1,474/5,000 chars — 29%)`) that appends an "approaching capacity" notice
  past 80% of `MEMORY_TOTAL_MAX_CHARS` (5,000). The same rendering function
  computes the exact prompt cost of a prospective write
  (`memory_rendered_char_count`), so `service_memory` can reject an
  over-budget batch before it's persisted, never truncate silently.
  Memory and document ids render as an 8-char UUID prefix (context economy);
  tools resolve a prefix or full id against the student's active rows and
  return a teaching error on ambiguity or a stale ref. This prefix
  convention is scoped to these two every-turn surfaces — workspace
  task/school/essay tools keep their full-UUID convention.

**Agent tools (six, `app/tool_specs.py` all gated `"auth"`, mount-gated on
`user_id` in `build_workspace_tools` — ADR 0029's unmounted-not-hidden
pattern):**

| Tool | File | Does |
|---|---|---|
| `update_profile` | `agent_tools_profile.py` | One tool over all ten sections; a present field merges/overwrites, an explicit `null` clears a field, the sentinel string `"clear"` empties a whole section. Returns the full rendered profile so the agent confirms from state, not from what it sent. |
| `view_documents` | `agent_tools_profile.py` | Lists id/title/type/filename/`text_status`/size/date/summary — a re-check after a mid-conversation upload; the student context already carries the list. |
| `read_document` | `agent_tools_profile.py` | Full extracted text, framed as "student-provided document"; `unsupported`/`failed` refs return a teaching error steering toward pasting content or re-uploading. |
| `remember` | `agent_tools_memory.py` | Batch save 1–10 notes (≤200 chars each); rejects exact duplicates by name and over-budget batches with a `retryable` capacity error pointing at `update_memory`/`forget`. |
| `update_memory` | `agent_tools_memory.py` | Rewrite/consolidate one note in place by ref. |
| `forget` | `agent_tools_memory.py` | Batch soft-archive by ref; per-ref results (`forgotten`/`skipped`), no restore tool — a wanted note is a re-`remember` away. |

Uploads and deletes stay student-only at the service layer
(`_require_student_actor`) — the agent reads documents, it never uploads or
destroys them; `remember`/`update_memory`/`forget` are `"counselle"`-only,
mirroring the same authorship split (except delete, which either the
student or the agent may perform — a student saying "forget that" in chat
carries the same authority as clicking delete on the Profile page). Tool
calls for all six use a dedicated `StepKind: "memory"` for 4–6 ("Remembering…",
"Updating a memory", "Forgetting {n} notes") and `kind: workspace` for 1–3,
distinct from `db_tool`'s citation-chip semantics, following ADR 0029's
precedent. The registry in `config/assets/step_labels.yaml` now carries 46
tool specs (up from 40 before this feature), continuing the standing
tool-count risk ADR 0029/0030 already flagged — mitigated the same way:
tight descriptions, schema-borne vocabulary, watching eval routing.

**Routes:** `GET/PATCH /v1/profile`, `GET/POST /v1/documents`,
`GET /v1/documents/{id}/file` (forced `attachment` download, header-injection-
safe filename quoting), `DELETE /v1/documents/{id}`, `GET /v1/memories`,
`DELETE /v1/memories/{id}` (`api/routes/profile.py`, `documents.py`,
`memories.py`) — thin wrappers over the services, same shape as every other
workspace route.

**Frontend:** a Profile page (`frontend/src/features/profile/`, routed
beside the four workspace pages) rendering section cards from a declarative
`PROFILE_SECTIONS` config, inline-edit with autosave-on-blur via the PATCH
route, a documents area, and a "What Counselle remembers" list with
per-note delete — built from existing design-system primitives, no new
component patterns.

**School-detail composition:** `SchoolDetailRoute` owns the single
`GET /v1/schools/{unitid}/facts` read and supplies its typed response to the
About and Compare tabs inside one `PageContainer(width="panel")`. The Compare
tab is not mounted on an initial About visit; its `TabsPanel` mounts lazily when
the student selects Compare, and only then does `SchoolChancesPanel` start the
established `useProfile()` query. Returning to Compare keeps the mounted panel
and its cached Profile read. This ordering avoids a Profile request merely from
opening About while keeping the route's school facts response shared by both
views.

Compare is a read-only comparison surface: metric selection and the local Explore
scenario controls issue no Profile PATCH, application mutation, estimator call,
or feature-owned persistence. The Profile GET retains the existing workspace
contract and may lazily initialize an empty Profile row; that implementation
detail is stated rather than hidden behind a false claim that every HTTP read is
physically write-free. Missing or incompatible Profile/fact values remain
explicitly unavailable in the UI.

---

## 37. Onboarding

(ADR 0033.) A five-step, all-optional first-run flow that gives Counselle
the small subset of the Profile (§36) it uses most often, without putting a
new student through the full ten-section form on day one. Full product/UX
spec and phase-by-phase execution record: `specs/user-onboarding/plan/`.

**Progress is flow state, not Profile data.** `app/onboarding.py` owns a
typed, versioned state machine (`OnboardingStatus`: `not_started \|
in_progress \| deferred \| completed`, plus a `current_step` over the fixed
`basics → academics → direction → context → fit` order) stored at
`users.settings.onboarding` — no new table or column. The transition
function (`apply_onboarding_command`) is pure and idempotent (a repeated
`advance`/`complete` returns the already-reached state instead of erroring);
persistence (`update_onboarding_progress`) applies it under a row lock and
writes back with a key-scoped `jsonb_set`, never a whole-column replace.
`PATCH /v1/onboarding` (`api/routes/onboarding.py`) is the only writer — a
thin, authenticated, rate-limited route scoped to the caller's own id, no
workspace change row or SSE event (this is UI navigation state, not student
data the agent or other clients need to observe). New users, password or
Google OAuth, are seeded into `not_started` at creation
(`merge_initial_onboarding_settings`, called from `AsyncpgUserDatabase.create`);
an account created before this feature has no `onboarding` key at all and is
treated as grandfathered, never force-routed into the flow.

**`OnboardingGate`** (`frontend/src/app/auth/OnboardingGate.tsx`) sits
between `RequireAuth` and both the workspace routes and `/onboarding`
itself, reading `useMe()`'s `settings.onboarding` on every navigation.
`not_started`/`in_progress` redirect any `/app/*` visit to `/onboarding`,
preserving the original destination as one-time React Router history state
(never the URL or `settings`) so deferral can return the student there.
`deferred` and grandfathered accounts pass through to the workspace
untouched and pick up `/onboarding` again only via the `Guided setup`
affordance on Profile. `completed` redirects any direct `/onboarding` visit
back to `/app/profile`, except for the one render immediately after the
completion mutation (an ephemeral `onboardingCompletion` history-state flag,
independently checked against the Navigation Timing API so a hard reload of
that same screen still redirects). A malformed `settings.onboarding` value
never traps the user out of the app — it degrades to a recoverable retry
screen only when `/onboarding` is opened directly, and to pass-through
everywhere else. Onboarding's own answers write through the existing
`PATCH /v1/profile` service path (§36), never a parallel schema.

**The `/v1/me` settings-merge lock (ADR 0033).** Because `settings jsonb`
now has two independent writers — the generic `PATCH /v1/me` (theme,
source-config preset) and `PATCH /v1/onboarding` — `api/routes/me.py`
treats `settings` as an RFC 7396-style top-level patch (omitted key =
unchanged, explicit `null` = delete that key, `settings: null` = 422, never
a full replace) and rejects any attempt to write the reserved `onboarding`
key directly (422, pointing at `PATCH /v1/onboarding`). Both routes read
their merge source from a `SELECT ... FOR UPDATE`'d row inside the same
transaction as their write, rather than the `current_active_user` snapshot
taken at request start, so whichever of the two commits second merges
against the other's already-applied change instead of clobbering it.

---

## 38. The CDS extraction pipeline & admin surface (parked)

(ADR 0036, parked by ADR 0038.) Counselle still contains a second subsystem
beside the agent: a superuser-gated write path that used to produce the
`cds_library` rows the agent's read path once consumed via a packet/evidence
model. **It is parked, not deleted** — its code stays in-tree, importable,
and unit-tested; nothing from it is mounted or started at runtime; its live
tables were dropped, with both DDL and data preserved. `PARKED.md` is the
authoritative register: exact file list, the nine import edges into it that
must stay stable, and the bounded revival procedure. This section describes
the architecture as built, for a reader deciding whether reviving it is
worth the cost — not a live system.

It followed the same four-layer discipline as the rest of the app (§4),
isolated from the agent by both code and, more strongly, by Postgres role and
DSN — a bug in this subsystem could not let the agent's own connections
write, because the agent's pool was never given the write role's
credentials. **That role isolation is why parking it was safe**: dropping
its tables and unmounting its router touches no code path the agent or the
facts crawler (§40) depends on.

**Three DSNs, three roles, one database — while this subsystem was live.**
The agent path (§8) connects as `cds_library_reader` over `COUNSELLE_DB_RO_DSN`
— `SELECT` on exactly the six reader views, nothing else. Counselle's own
application state connects as `counselle_app` over `COUNSELLE_DB_APP_DSN` —
read-write, but only inside `counselle.*`, never `cds_library`. This
subsystem added a third: `cds_library_app` over `COUNSELLE_DB_PIPELINE_DSN` —
`INSERT, SELECT, UPDATE` (never `DELETE`) on the seven CDS-specific
`cds_library` base tables. **That third role and DSN are not idle** — ADR
0038 repurposes them, unchanged in shape, to drive the CollegeData facts
crawler instead (§40); the two writers are mutually exclusive at runtime
(`COUNSELLE_CDS_WORKER_ENABLED=false` while `COUNSELLE_FACTS_WORKER_ENABLED`
gates the crawler), never both live against the same DSN at once. Every
route in this (now-unmounted) subsystem sat behind the pre-existing
`current_superuser` dependency (ADR 0021); there was no path from an
ordinary authenticated session into it.

**Layout, mirroring the read side's layering (all parked, importable, unmounted):**

```
domain/cds/            manifest compile, packet build, page math, claims —
                        the write-side honesty core, the counterpart to
                        counselle_db/packets.py on the read side
adapters/
  cds_gemini.py         Vertex extraction calls (one-shot, schema-constrained,
                        deliberately not routed through PydanticAI's Agent
                        seam — see ADR 0036's alternatives)
  cds_pdf.py             PyMuPDF page rendering/detection
  cds_store.py            the only writer of cds_library base tables
  cds_admin_queries.py    admin-surface reads (coverage grid, job/document detail)
app/cds/
  engine.py / calling.py / routing.py / usage.py
                        the extraction engine, split by concern: run
                        orchestration, the model-call loop, domain/page
                        routing, and cost/token accounting
  batching.py / batch_run.py / starved_retry.py
                        batched multi-domain extraction with backoff
  jobs.py                 the in-process asyncio poller (below)
  service_ingest.py       upload, duplicate detection, job creation
  service_review.py       review (get_review), metric edits (save_metric_edits)
  service_review_approve.py
                           approve, reject, rerun, and the human-review
                           packet builders they depend on
  manifest.py              manifest publish + the pre-flight drift guard
config/cds/              the ported, versioned manifest/prompt/domain YAMLs
api/routes/cds_admin.py  /v1/admin/cds/*, current_superuser-gated
frontend/src/features/cds-admin/
                        the coverage grid, upload, and review screens,
                        nested inside the existing workspace shell
```

**The extraction engine (as built; not running).** A candidate document (an
uploaded CDS PDF) was routed to the domains/pages an extraction job
requested, then extracted through one-shot, schema-constrained Vertex calls —
inline PDF, `response_schema` strict JSON, temperature 0 — using a model id
read from Settings, never a literal. Large documents were page-routed rather
than sent whole; a lease with background renewal, not a hard per-call page
cap, was the load-bearing mitigation for pathological page counts.

**The job poller.** `app/cds/jobs.py`'s `Poller` is importable and unit-tested
but is never started — `api/main.py` no longer imports it or calls its
lifespan start/stop (that was the mechanism of "unmounted": seven lines
removed, named in `PARKED.md`'s revival steps). While live it claimed and ran
extraction jobs using lease/claim columns on `cds_extractions` — no Celery,
no Redis, no second container (ADR 0023, one deployable) — and swept any
extraction a prior process abandoned mid-run to a terminal
`failed`/`worker_lost` state. `COUNSELLE_CDS_WORKER_ENABLED` now defaults to
`false`, and even if flipped true it would not start anything by itself,
since the lifespan call that started it is gone; see `PARKED.md` for what a
revival re-adds.

**The write was never trusted by convention.** Every packet this engine
built — a model extraction or a human correction — was round-tripped through
the reader's own `parse_packet_row()` (`counselle_db/packets.py`, still
importable — it is import edge #2 in `PARKED.md`) inside the same
transaction, before COMMIT: if the read path would reject it, the write
aborted. That was the same anti-corruption boundary the agent's read path
relied on, exercised against the writer at write time rather than trusted
separately. Packets carried one of two extractor identities on the
allow-list alongside the legacy `gemini-*` identities: `counselle-cds-v1` for
model extractions, `human-review-v1` for admin corrections that were new
rows, not mutations — `cds_domain_packets` had a BEFORE UPDATE immutability
trigger that made new-row-per-correction the only possible shape.

**Manifest publish and drift (as built).** The manifest snapshot table was
immutable by trigger (row-level `INSERT`-then-flip, never `UPDATE` of a
published row's content); publishing a new version was a dedicated script
(`scripts/publish_cds_manifest.py`, still importable — parked in
`PARKED.md`'s script list), not an admin-UI action — an advisory lock, a
refusal if the target version already existed with different content, a
refusal if any extraction was mid-flight, a dry-run diff by default, and an
explicit flag to commit. A pre-flight drift guard
(`app/cds/manifest.py`'s `verify_manifest_current()`) ran before any model
spend on every extraction: if the compiled `config/cds/` no longer matched
the published, current manifest, the job failed immediately with a distinct
`manifest_drift` error and zero model calls were made. `uv run python
scripts/cds_manifest_check.py` still reproduces the same byte-identical hash
from `config/cds/` on disk today, since that config directory is parked
verbatim, not deleted.

**Review and correction (as built).** A newly uploaded document went through
upload → detect (duplicate/mismatch checks) → extract → review → approve or
reject, gated by `is_candidate`. Detection never filled a gap with a guess:
the document's stated school name and year are nullable, and a document
whose identity isn't actually grounded in its own text — a blank/illegible
A0 section, or one that fails the independent "does page 1 even claim to be
a Common Data Set" check — routes to `needs_input` instead of auto-confirming
a match, so a human always confirms identity before a document can reach
`matched`/Ready. Correcting an already-*active* document (one that is
currently serving students, not a fresh upload) is a distinct flow —
`active_update` — that reviews, edits, approves, or rejects an extraction
against the still-active document, per domain, without ever performing a
document-level candidate/active swap: the document keeps serving its current
packets until each corrected domain's packet is individually activated at
approval, so there is no offline window. A resolution marker on the
extraction row closes this loop once reviewed, so a correction that has
already been approved or rejected does not keep re-surfacing as pending. A
pending edit is stamped, server-side, with the extraction whose packet the
admin was actually reading; one a later re-extraction has moved past is
neither shown as pending nor applied, so a rerun can never be silently
overwritten by a stale correction. Saving a metric edit that a concurrent
rerun has already superseded returns a conflict naming the affected refs
rather than a 200 whose returned review silently omits the edit. Approving a document validates the
human-reviewed packets it would write with the same content-level validator
gate the model path runs (`docs/DATABASE_GUIDE.md` §1) before anything is
committed, so an admin's own edit cannot introduce a blocking error and
still reach students unnoticed. The review screen's header names a single
extraction only when every domain's latest packet actually came from it; if
a targeted rerun leaves domains attributed to different extractions, the
header marks itself mixed-generation rather than naming one run as the
source of all of them. Approving a document that leaves some of its domains
untouched re-reads each one's current extraction at write time before
reactivating it, so a domain a concurrent re-extraction already finished is
never silently reverted back to the stale snapshot the approve request
started with.

**The admin surface (in-tree, unmounted).** Fourteen endpoints were defined
under `/v1/admin/cds/*` (`api/routes/cds_admin.py`), all `current_superuser`-
gated: coverage (a grid of school × domain currentness), school listing,
upload, job status, document detail and page images, metric edits,
approve/reject, and rerun. The file and its route definitions still exist,
but `api/main.py` no longer imports or mounts this router — hitting any of
these paths 404s. Three screens in `frontend/src/features/cds-admin/`
(coverage, upload, review) still exist too, nested inside the authenticated
workspace shell (§31), but their `router.tsx` entries are removed, so they
are unreachable from the UI; the sidebar entry that used to link to them
now points at the facts admin screen instead (§40).

**What this subsystem is not, and was not.** It was never a second agent, a
second model seam, or reachable from any student-facing request path. Its
own read contract — the five reader views it fed, and the packet/evidence
truth boundary — is retired; `docs/DATABASE_GUIDE.md` now documents the
facts-store contract this subsystem's runtime role was replaced by (§8, §9),
not this one. Full operational history while this subsystem was live
(cutover, manifest republish, database-pollution disposal, the live
ship-gate proof) lives in `specs/cds-pipeline/plan/CUTOVER.md`, not here —
this section describes the architecture as built, not a point-in-time
record, and `PARKED.md` is the authority on its current disposition.

---

## 39. The essay surface & the suggestion lifecycle

(ADR 0037, amending ADR 0030.) The essay editor hosts an AI panel that works on
one essay. Architecturally it is not a second agent, a second graph, or a second
chat client — it is the same turn, run under a different **surface** (§12), with
its edits routed to a review queue instead of straight into the document.

### 39.1 What the surface selects

A turn from the panel carries `surface: "essay"` plus a nested
`essay_context: {essay_id, selection}` on `POST /v1/sessions/{id}/messages`.
The route validates the pair — `essay_context` is required for `essay` and
refused for `chat`, and the **session row's own `essay_id` is authoritative**:
an essay turn naming a different essay than its thread is rejected, so a stale
client-held session id can never queue one essay's suggestions onto another.
Below the route the value flattens to plain scalars on `turn_ids` (§12).

Inside the node, the surface selects exactly four things:

| Selection | `chat` | `essay` |
|---|---|---|
| System prompt asset | `counselor.md` | `essay_partner.md`, with a code-built `{essay_context}` block |
| Workspace tools | all of them | an explicit allowlist: the essay tools minus create/duplicate/archive/restore (`view_essays`, `read_essay`, `edit_essay`, `write_essay`, `update_essay`), every workspace **read** (activities, documents, schools, tasks — the student's real material, which is the anti-fabrication supply), and the two memory-note writes (`remember`, `update_memory`). Every other workspace mutation is dropped from the list before the `Agent` is built, so it is never handed to the model |
| `render_viz` | constructed | never constructed (a data-visualization card is a chat-surface answer format) |
| Essay write mode | `direct` | `suggest` |

The two metric-heavy DB tools (`get_facts`, `query_database`) are unmounted for
this surface like everything else in the toolset — `build_db_tools` simply
never constructs them when `surface is Surface.ESSAY` (§14). External search is
deliberately **not** narrowed: research grounds "why this school" material,
and the request's source config still governs it.

**The essay block is built in code, not by the model.** `render_essay_context`
(`app/prompt.py`) reads the essay once at turn start through the same
`user_id`-scoped service read the tools use, and renders title, prompt, school,
status, word count/limit, the markdown body, and the student's current
selection. It is bounded by `essay_context_max_chars` and, when it truncates,
*says so* and points the model at `read_essay` — the model must never mistake an
excerpt for the whole draft. An essay that cannot be loaded (deleted mid-session,
or an unauthenticated harness run) renders an explicit unavailable block rather
than nothing, so the turn degrades to an honest answer instead of a silent guess.
The write-guard version token is deliberately absent from this block:
`read_essay` is its single source, because a token inside a prose block the model
is told to echo is how one reached a student's answer.

### 39.2 The suggestion lifecycle, end to end

**1 — An agent edit becomes a proposal, not a write.** `edit_essay` and
`write_essay` keep their exact model-facing vocabulary; only the sink changes,
per the turn's `write_mode` fixed at tool-construction time. In `suggest` mode
`app/workspace/agent_tools_essays_suggestions.py` validates each
`{old_text, new_text}` edit **independently against the original document** —
because the student will accept them one at a time, in any order — and refuses
the whole batch if one edit only matches after a sibling lands. `write_essay`
becomes one suggestion spanning the whole current draft. There are two carve-outs
for an essay with nothing in it, and they are separate mechanisms: an essay
**empty when the turn starts** puts the whole turn in `direct` mode (`_write_mode`,
`app/agent_node.py`), because a first draft has no prior text to review against;
and `_suggest_full_redraft` re-checks emptiness at *call* time, committing a
redraft of a still-blank essay rather than proposing it, because a suggestion
whose `old_text` is empty has no anchor at all. Both say which happened in the
tool's own reply — the second one has to, because a turn that began in `suggest`
mode has already told the model to expect a proposal.

**2 — Persistence.** `service_essays.append_suggestions` appends to
`counselle.essays.suggestions` under the essay's row lock, leaving `content`
untouched, and writes the same actor-attributed change row and publishes the
same post-commit workspace event every other workspace mutation does (§31, ADR
0027) — a proposal is an ordinary workspace change, not a parallel write path
with its own audit story. The element shape, and the four rules that govern the
array, are specified in `docs/DATABASE_GUIDE.md` §10.

**3 — Rendering as a tracked change.** The client paints suggestions as
ProseMirror decorations inside the live document — insertions underlined,
deletions struck through, each fragment of one change highlighting with its
siblings on hover. Four properties are load-bearing:

- **Anchoring searches the document; it never trusts a stored position.** The
  document round-trips through the server as Tiptap JSON, so an absolute offset
  would drift. The search runs against `old_text_plain` in ProseMirror's own
  `textContent` string space, because the live editor carries formatting as
  marks and a markdown anchor would never match.
- **Hover state lives in plugin state, rendered through the decoration
  pipeline** — never as a DOM attribute written onto the rendered spans.
  Mutating attributes inside ProseMirror's managed DOM is treated as external
  interference and triggers an unbounded redraw loop.
- **A transaction that replaces the whole document re-anchors; it never maps.**
  Both the accept flow and the editor's content resync hand the editor a fresh
  copy of the server's document, and every position inside a replaced range maps
  onto that range's boundary — mapping would collapse each anchor to a zero-width
  span that paints nothing and reads as outdated, while the server still holds a
  row that anchors perfectly. Both therefore carry the suggestions meta on the
  same transaction, which is what tells the plugin to recompute. Mapping is for
  an ordinary edit, which carries no meta.
- **The resync's "this is already the document on screen" guard compares
  canonically.** The content it compares against round-trips through a `jsonb`
  column, which normalises object key order, so a byte-exact comparison never
  matches a document containing text — the guard would skip nothing and every
  settled autosave would replace the document with a copy of itself, taking the
  caret with it.

`useSuggestionReview` is the one place that answers "where is this suggestion"
and "can it still be applied" for every review surface, reading both from the
plugin rather than recomputing them.

**4 — Accept and reject.** Four routes (§27.6) resolve one suggestion or the
whole queue. Accept applies the suggestion's markdown edit to `content` and
drops it from the array; reject only drops it; both recompute `word_count`,
write a change row, and publish an event. Both take the essay's row lock for the
whole read-then-write, so two simultaneous resolves serialize and a double
accept is a `404` rather than a second application — **a resolved suggestion is
removed, never tombstoned**. Accept-all differs from an `edit_essay` batch on
purpose: these are independently authored proposals, so an item that no longer
applies is left pending and reported in `skipped` instead of sinking the rest.

On the client, resolution is **serialized panel-wide** and **never optimistic**.
Applying the accepted text locally would fire the editor's update handler, queue
an autosave of the markdown-stripped plain text, and let that save land on top of
the server's correctly formatted result. The server's returned content is the
only content the editor is ever set from, and content and the remaining
suggestion list land in one transaction.

A resolve is also **not the only writer of the essay's cache entry** — an agent
turn settling in the docked panel invalidates the same key, and so does every
workspace change event the client receives. A read those issued *before* the resolve committed
carries a document that still contains the change, and landing after the
resolve's own cache write it would overwrite it: the resolved change back on
screen as pending, counted by the readout, with the server right the whole time.
The resolve therefore re-invalidates that key **synchronously with its own write,
never separated from it by an await**. React Query's refetch cancels the in-flight
read before its response can reach the cache and re-issues it rather than dropping
it, so an essay the agent rewrote from the main chat still reaches the editor, and
the replacement read is answered after the commit and can only carry that state or
newer.

**5 — Going stale.** A suggestion is stale when its anchor no longer matches the
essay uniquely — zero matches, or more than one. There is no stored context to
disambiguate with, and guessing between two identical sentences is exactly the
quiet mistake that would apply an edit to the wrong words. The server discovers
it at accept time (the essay is left untouched; the caller gets `422`); the
client discovers it while anchoring and paints the change **visibly inert and
still on the page**, so a student sees what was proposed instead of watching it
disappear.

### 39.3 Where the honesty guarantees live

The failure mode on this surface is a wrong *claim*, not a wrong number: the
agent can say it proposed an edit on a turn where it made no tool call. Three
things stand against it, and all three are outside the model's prose:

- **The tool is the only thing that can create a suggestion.** Nothing else
  writes the array; a description of an edit is not an edit.
- **Prompt hardening pins the order** — call the tool, read what came back,
  report only that, never the count you meant to propose — in both
  `essay_partner.md` and `counselor.md`, with an explicit script for the
  not-yet-edited case so "want me to draft that as a suggestion?" is a complete
  turn rather than something to paper over.
- **Provenance display contradicts a false claim on screen.**
  `PendingChangesReadout` is a code-owned band mounted on both surfaces that host
  an essay conversation, sourced from the server's essay record rather than the
  message stream, and **honest at zero as loudly as at N** — "None" is the
  reading that refutes the claim, and the zero state is precisely the one the
  pending-changes bar has no surface for. `countPendingChanges` is the single
  source of truth for the waiting/outdated split, so the band and the bar can
  never print two different numbers for one fact.

**There is no output validator, and adding one is out of bounds.** Nothing here
scans, classifies, blocks, rewrites, or retries the model's text; the
programmatic answer-validation layers this system removed on purpose stay
removed. Honesty on this surface is code-owned display of what is true, stated
next to whatever was said — not inspection of what was said. ADR 0037 records
the constraint.

### 39.4 Per-essay conversations

Each essay has exactly one durable chat thread: a `counselle.sessions` row with
`essay_id` set, created get-or-create by `POST /v1/essays/{id}/session` and made
unique by a partial index rather than by client-side storage, so the conversation
follows the essay across browsers and devices (§7,
`docs/DATABASE_GUIDE.md` §10). It is an ordinary session in every other respect —
same checkpointer, same turn registry, same transcript read — and is excluded
from the main chat list, which filters `essay_id IS NULL`.

---

## 40. The CollegeData facts crawl pipeline & admin surface

(ADR 0038.) The live successor to §38's write path: a free, LLM-free, daily
scrape of CollegeData.com's own structured per-school data, over the same
third DSN/role §38 used (`cds_library_app` / `COUNSELLE_DB_PIPELINE_DSN`),
repurposed rather than reprovisioned. It follows the same four-layer
discipline as the rest of the app (§4) and the same role/DSN isolation from
the agent's own connections that made §38 safe to park.

**The fetcher (`adapters/collegedata/fetch.py`).** No LLM anywhere in
ingestion. `httpx` + `tenacity`, not a browser and not a scraping framework
(ADR 0038's rationale rejects Crawlee, Scrapy, Playwright, and any
evasion-postured client on both correctness and posture grounds — CollegeData
serves this data to a bare `curl`, and evading detection would contradict
the crawler's own good-faith posture). `robots.txt` is fetched fresh every
pass and checked before every outbound URL — not a stale transcription.
Identification is truthful: a `User-Agent` self-identifying with a contact
URL, boot-validated to contain one. A single shared token bucket caps the
whole crawl at 1 request/second, with adaptive backoff on rate-limit
responses down to a five-minute floor. Sitemap and robots XML parse through
`defusedxml`, not stdlib `xml.etree`, against untrusted input.

**The mapper (`app/facts/mapper.py` + `mapper_handlers.py` /
`mapper_table_handlers.py`).** Pure per-page computation: parses one fetched
CollegeData page (`adapters/collegedata/parse.py`) into typed `FactRow`s
(`domain/facts/models.py`) with no knowledge of a school id, a snapshot, or
SCD2 history — those are attached at persistence time by the caller, keeping
the mapper itself trivially testable against fixture pages.

**One crawl pass, one transaction per school.** `app/facts/crawl.py`'s
`run_crawl_pass` — called both by the in-process poller below and by
`python -m app.facts --once` — does discovery → a six-tab fetch per school →
mapper → one transaction per school → `adapters/facts_store.py`. Two crawl
passes running at once is structurally impossible: a non-blocking
`pg_try_advisory_lock` is held for the pass's whole duration, and a worker
that cannot take it stamps its own job claim `error`/`pass_already_running`
and returns without touching the pass owner's row. Storage is **SCD2,
close-then-insert**: a changed fact's old row gets `valid_to = now()` in the
same transaction that inserts its replacement, so a fact's full history is
queryable, not just its current value. `python -m app.facts remap` re-runs
only the mapper+SCD2 half over already-fetched `school_pages` snapshots — no
network, no re-fetch — for when a mapping bug needs correcting without
re-crawling.

**The job poller (`app/facts/jobs.py`).** Copies §38's `app/cds/jobs.py`
poller shape (boot sweep, transient-DB-error survival, background
lease-renewal) with two deliberate differences: no concurrency semaphore (a
partial unique index already guarantees at most one live pass) and a swept
abandoned lease re-queues rather than fails forward, so the next claim
resumes the same `crawl_runs` row instead of restarting the pass. Started
from the FastAPI lifespan (`api/main.py`'s `start_facts_worker` call) — the
only DB-writer poller the lifespan starts today, since the CDS poller's own
lifespan call was removed when it was parked (§38). `start_facts_worker` is a
no-op, not a startup failure, when the pipeline DSN is unset or
`COUNSELLE_FACTS_WORKER_ENABLED` (default off) is false.

**The admin surface.** Three endpoints under `/v1/admin/facts/*`
(`api/routes/admin_facts.py`), all `current_superuser`-gated: `GET /status` (a
bird's-eye view of the last runs and unmapped-label pressure), `GET
/unmapped` (a paginated view of CollegeData labels the mapper doesn't yet
recognize, so a coverage gap surfaces before it silently drops facts), and
`POST /passes` (the "run a pass now" button, 409s if one is already
queued/running). This is deliberately a much smaller surface than §38's
fourteen endpoints — there is no per-document review/approve workflow here,
because there is no per-document artifact to review: a crawl pass either
updates a fact or leaves it as it was. The one screen this mounts replaces
the CDS admin nav entry §38's `AdminGate`-protected routes used to occupy.

**The crosswalk (`app/facts/crosswalk.py`).** The one-time, reviewed mapping
from a CollegeData school slug to an IPEDS `unitid` is a committed CSV
produced by a one-off, hand-reviewed adjudication script — never resolved by
an LLM, at build time or at runtime —
matching a slug to a `unitid` at crawl time would reintroduce exactly the
per-request LLM cost this design avoids.

**What this subsystem is not.** It is not a second agent and not reachable
from any student-facing request path. It never publishes a workspace
`ChangeEvent` (ADR 0027) — a crawl pass is not a per-user actor's mutation.
It writes no composite score, no ranking, and no derived "chance" number from
the distributions it stores (§9). Its Terms-of-Use exposure (CollegeData's
browsewrap prohibition on commercial reuse) is a real, accepted, ongoing
legal risk the mitigations above evidence good-faith operation against but
do not eliminate (ADR 0038, Risk R0) — not a resolved question.

---

## 41. The Explore admit-rate estimate

Explore cards carry one server-owned category derived from one column. The
whole rule is `domain/admissions_fit.py`: `school_explore.admit_rate` `<20%` is
Reach, `<50%` is Target, `≥50%` is Safety; a rate that is absent, non-numeric,
or outside `[0,100]` is Unknown, and an Unknown card shows no band at all.
Nothing about the student is an input — not the saved Profile, not the URL's
score assumptions, not the facts store's entering-class comparables — so the
category is a base-rate statement about the school and never a prediction
about the reader (ADR 0040, superseding ADR 0039's personalized heuristic).

The route reads only the `cds_library_reader` pool: the Explore page statement
and its ancillary counts/options go through the one `counselle_db.service.explore`
executor. There is no saved-Profile read, no per-page facts batch, and no
telemetry seam on this path.

The wire result is `{category, admit_rate}`. `admit_rate` is the validated rate
the category came from, so the card cannot print a figure that disagrees with
the badge beside it. Because no part of the response depends on who is asking,
it is cached per query rather than per reader, and a Profile write does not
invalidate it. The card renders the rate, the band, and nothing arguing for
either — with the adjustment gone there is no reasoning left to disclose. The
category never writes, infers, or replaces the student's separate
`Application.list_type` organization field.

## 42. Goal mode: an independent-judge iteration loop

**Status: engineering-complete, product-unvalidated.** Phases 0–5 of
`plans/goal-mode-plan.md` are implemented and covered by focused/eval-level tests; the
plan's own Phase 7 real-student dogfood gate has not run, no real browser has exercised
the frontend surfaces, and four of the plan's Part 9 owner decisions were shipped at
stated defaults rather than decided. ADR 0041 is the decision record and its
Consequences section is the honest ledger of what is and is not settled — this section
describes the shipped mechanism, not a verdict on whether it should exist.

### 42.1 What `/goal` does

A student types `/goal` and states an outcome. One model call turns that statement into
the run's termination condition — 1–6 frozen, binary criteria describing the *result*
the student asked for, never the steps to get there. The agent then works exactly as it
does on any other turn; goal mode is a wrapper that keeps it going. At each stopping
point an independent judge — a separate model call that sees tool receipts and the
final answer, never the agent's plan or its claims — decides whether the condition is
met. How the agent works is the agent's business: its plan is prompted for, never
enforced, and is not an input to any stop decision. A run counts as stalled only when
`goal_stall_iterations` checks in a row meet nothing new. The criteria writer, the agent
and the judge all read one code-computed calendar block (`domain.goal.calendar_context`),
so "this week" is the same date range to all three. Unmet criteria come back to
the agent by name in the next round's prompt. The run ends in one of seven
`domain/goal.py::GoalStatus` values: six honest terminal judgments — `achieved`,
`partial`, `stopped_budget`, `stopped_no_progress`, `stopped_user`,
`stopped_check_failed` — plus `awaiting_input`, which is not a judgment at all but the
agent's own pause for the student's answer (§42.2); `decide_terminal_status` never
returns it. The whole run is one assistant message in the existing chat (ADR 0028's
"the run is the message" contract, unchanged).

### 42.2 Where the loop lives

The loop is an outer iteration inside `run_agent_node`, not a new LangGraph node, not an
outer orchestrator, and not a model-callable tool (ADR 0041 D1). `app/graph.py` stays
`prepare → agent → END`, zero diff. Concretely:

- `app/goal_judge.py::derive_criteria` makes one typed-output call (at `reasoning_effort_goal`) turning
  the goal statement into frozen `GoalCriterion`s plus a mandatory `not_checked_note`
  (never nullable — see §42.4).
- The statement and criteria are rendered into the agent's `instructions` string,
  computed once at `Agent(...)` construction (D12) — not protected by message position,
  because `TurnState["messages"]` is the whole session's history and a `/goal` sent
  mid-conversation is not at index 0. `instructions` is re-sent every request and no
  compaction strategy touches it.
- A goal turn mounts `ask_student` like an ordinary turn (D13, reversed 2026-09-18).
  An `ask_student` output ends the loop at once with status `awaiting_input` — no
  check, no nudge, no wrap-up — and the turn parks as any clarification does; the turn
  record's `goal` field carries the statement, frozen criteria, not-checked note and the
  receipts of every run before it. `accept_clarification` reads that into
  `PreparedContinuation.inherited_goal`, and the continuation is then itself a goal
  turn (`turn_ids["goal_mode"]`/`turn_ids["goal"]`): same criteria, never re-derived,
  the student's answer as its first prompt, the inherited receipts prepended to the
  judge's evidence (step ids prefixed with the paused turn's message id, since ids are
  per-turn counters), the goal watchdog and concurrency ceiling. The ledger carries
  forward across the pause: iteration count, cost, active elapsed time, consecutive
  tool errors, and the stall tracking (previously-met criterion ids, the flat-check
  count) are seeded from the paused record via `app/goal_loop.py`'s
  `GoalLoopController.from_carry`/`carry_state`, so a resumed run is judged against the whole goal's
  budget rather than a fresh one per segment; time spent waiting for the student's
  answer is excluded from `max_wall_clock_s`, since the resumed segment's own clock
  starts fresh and the prior elapsed time is added on top. Only the per-run pydantic-ai
  `UsageLimits` (max requests, max tokens) are scoped per segment. A resumed run may
  pause again.
- `app/agent_node.py::_run_once` owns one iteration's lifecycle:
  `router.begin_iteration()` and `final_writer.begin_iteration()` reset the emitters'
  one-shot latches (`EmissionRouter`'s `_closed`/`final_answer_started`, the writer's
  `_final_started`/`_flushed` and its two mid-parse nested parsers) while carrying
  forward everything that numbers or dedupes across the whole assistant message —
  `step_id` counters, citation indexes, viz signature/emitted-index sets, the plan
  state, the tool-overflow store. This carried-vs-reset split was found to matter in
  four separate places during the plan's own review (the "C7" corrections) and is why
  Phase 3 is a real ~150–250-line extraction rather than a cosmetic one.
- `app/goal_loop.py::_run_goal_loop` (called from `run_agent_node` when `goal_mode` is
  set) repeats `_run_once` + `judge_goal` until `GoalLoopController.decide` says stop,
  then — unless the run achieved — runs a wrap-up on a **second, genuinely tool-less**
  `Agent`, so the student gets a real report of what was and was not done even on a
  budget cutoff. (`Agent.iter`'s `toolsets=` parameter is additive, not a disable switch
  — a second tool-less agent is what actually guarantees no tool call happens.)

### 42.3 The judge (D4/D5)

`app/goal_judge.py::judge_goal` is a separate, blind, typed-output call — it never sees
the agent's narration as a claim of success, only:

1. The goal statement and frozen criteria, verbatim.
2. Bounded tool receipts (`select_evidence`, capped at `goal_judge_evidence_max_chars`,
   selected newest-first plus every receipt a prior verdict cited, so evidence already
   relied on never ages out of the bundle as it grows).
3. The iteration's final assistant text.

It is explicitly **not** an output validator (D5) — `AGENTS.md`'s "No output validator
was added and none may be" line is load-bearing here. Its only effects are the loop's
stop/continue decision and the rendered verdict card; it never rewrites, blocks, or
regenerates anything the agent streamed.

**The honesty corrections are applied in code, not trusted from the model:**

- `domain/goal.py::compute_checked` derives `(checked, met)` purely from which
  `evidence_step_ids` are actually in the bundle sent — citing nothing valid means
  `checked=False` and therefore `met=False` (C9's "not done" vs "never checked"
  distinction is derived, never declared), and citing only receipts whose
  `WorkspaceMutationReceipt.outcome == "unknown"` forces `met=False` regardless of what
  the judge claimed (§27.8's honesty vocabulary honored in code).
- `GoalVerdict.met` is a derived `@property`, never a field the judge sets directly, so
  `met=True` beside a failing or unchecked criterion is structurally impossible.
- The judge's `Agent` is pinned to `temperature=0.0` — the eval gate (§42.6) measured
  the *same* 32 cases scoring TPR 0.882, then 0.824, across two unpinned runs with no
  code change between them, which would make any prompt fix unattributable.

### 42.4 The C11 scope rule

Counselle cannot see the Common App or UC portal, transcripts, test-score sends, or
recommendation letters. A criterion like "my applications are ready to submit" is
unjudgeable and is rejected at derivation — the criteria prompt requires every criterion
to be checkable from workspace state or a produced artifact. Because the student's
stated goal is *usually* broader than what the criteria can cover, `not_checked_note` is
a **required** field on the criteria call's typed output (never nullable): an omission
is a pydantic validation error the library retries, and if it is still blank after
retries, `app/goal_judge.py::DEFAULT_NOT_CHECKED_NOTE` is substituted — a code-owned
sentence naming what was not checked. There is no branch on the closing card that skips
this line. "Achieved" means the stated criteria are met, in the student's sight — never
that the broader goal is accomplished.

### 42.5 Compaction, on every turn (D3/D11)

`pydantic-ai-harness==0.4.0` is a pinned dependency — the same MIT harness
`app/plan_tool.py` and `app/tool_overflow.py` already port from at a named commit — not
a hand-rolled mechanism. `ClearToolResults` (zero-LLM, in-place blanking of old tool
results below a token floor) is mounted in the `capabilities=[...]` list `app/agent_node.py`
already builds for **every** turn, goal or not, closing `plans/agent-loop-hardening.md`
§1 (rated HIGH independently of this feature) as a side effect.

Goal turns additionally get `TieredCompaction`, which escalates when the history exceeds
`goal_compaction_target_tokens` (100,000 — deliberately held below the 200,000-token
threshold where `model_counselor_think`'s price doubles, per `config/settings.py`'s
`long_context_threshold_tokens`). It runs the cheap pass again first and pays for a
`SummarizingCompaction` only if that was not enough; the cheap tier is therefore
constructed twice on a goal turn, on purpose, because the standalone one fires on a
message count while the escalation fires on a token budget, and a history of few but
enormous messages is over budget without ever reaching the count. `goal_compaction_target_tokens`
is the single headroom knob: a second "reserve" subtracted from it would only ever be
equivalent to setting it lower.

The summarizing tier takes `model=None` and so **inherits the running agent's model**,
which on a goal turn is already the cheap tier (`goal_agent_model_setting`) — no second
model knob, and no second path to a model: resolving a setting string here would bypass
`app/llm.py`'s key, retries and reasoning effort (ADR 0011/0043, one seam). Because the
effort is the model's own default setting, the summary reasons at the turn's effort too. Its usage folds into the turn's
shared `RunUsage`, so summary tokens are priced inside the agent's own slice at the
agent's own rate and its request counts against `goal_max_model_requests` like any other
— a summary is a real request, and the ledger says so. `keep_tokens` preserves an 8,000-token
raw tail, `preserve_first_user_message=True` and `incremental=True` hold C2 and prevent
summary decay.

Both tiers **disclose themselves** (C4): each is subclassed in `app/agent_node.py`
purely to detect that it really acted (0.4.0 exposes no compact-fired hook, so a real
edit is a new list object) and to emit one settled `kind:"compaction"` step. The two
carry different labels — blanking old tool results and rewriting earlier turns into a
model-written summary are not the same event, and the student reads the label verbatim.
A summarization that **fails** (timeout, rate limit, provider error) is logged and the
un-summarized history is handed back rather than aborting the run: a goal run is the long
unattended case, the cheap tier has already run, and the target is a cost guard rather
than a context-window limit. No beat is emitted on that path — a compaction that did not
happen is never claimed. No wrapper module: the capabilities are constructed directly
from Settings values per ADR 0017, and `compaction_capabilities()` is the one function
that decides which turn gets which tier.

### 42.6 How the judge was measured

`evals/goal_judge/` is a 32-case, hand-labeled, **synthetic** dataset (34 scored
criteria; the loop didn't exist yet when it was built, so no real goal-run traces were
available to label) scored on TPR/TNR/FPR separately, never raw accuracy — an
always-"met" judge would score ~95% while catching nothing. The gate initially failed
(TPR 0.882, then 0.824 across two unpinned runs), traced to the judge discounting typed
`outcome`/`field_key`/`value` fields on mutation receipts in favor of wanting free-text
summaries to restate the criterion, plus run-to-run sampling variance. The fix —
rewriting `_receipt_text` to state each receipt's typed fact in plain language, plus
pinning `temperature=0.0` — produced **TPR 1.000, TNR 1.000, FPR 0.000** on the same 32
cases, with 6/6 correct on the adversarial (MT-Bench-style padding-attack) subset. This
is one clean post-fix run; a confirmation re-run under the same pinned settings was
launched and did not finish before the measuring session's time budget ran out (see
`evals/goal_judge/REPORT-20260916T160355Z.md`). Treat TPR=1.000 as a strong single
measurement, not demonstrated long-run stability.

### 42.7 What is not done

- **Phase 7 (10 real students' goal statements) has not run.** This is the plan's own
  kill-gate: if most real statements decompose into vacuous or out-of-scope criteria,
  the documented right answer is a cheap read-only "what's incomplete across my
  workspace" pass instead — not more judge tuning.
- **No real browser has exercised any part of this feature.** The frontend goal-status
  surfaces (`GoalHeader`, `GoalVerdictCard`, `GoalBeat`, the dev tool-call gallery's nine
  goal-status fixtures) are verified at the jsdom/unit level only.
- **Four of the plan's Part 9 owner decisions were shipped at stated defaults, not
  decided:** the approval gate ships unattended; the judge runs on the cheap tier
  (contrary to the MT-Bench literature the plan cites, though our own measured
  adversarial result did not reproduce that failure); there is no per-student monthly
  cost ceiling; the agent runs on the cheap tier rather than the counselor tier.
- **The §2.10 budget table is a projection, not a measurement** — the loop did not exist
  when the cost spike that produced those numbers ran.
- **`app/agent_node.py` is well past its 800-line cap** (~1,847 lines; the plan's own C6
  correction predicted ~150–250 net new lines and actual growth was roughly +485).
  Tracked in `TODOS.md` with a proposed four-module split for its own branch.

See ADR 0041 for the full decision record and `plans/goal-mode-plan.md` for the complete
design and its adversarial-review history.

---

*Companions: `specs/mvp1/PRD.md` (agent service product spec), `specs/mvp2/PRD.md` (full-stack app product spec), `specs/user-onboarding/plan/` (onboarding plan and phase record), `specs/school-data-v3/` (the graduated facts-store plan and its divergence record), `specs/essay-ai-panel/` (the essay AI panel's graduated plan and divergence record), `docs/DATABASE_GUIDE.md` (the facts-store data contract — the six reader views, fact states, and honesty rules), `PARKED.md` (the parked CDS system's file list, import edges, and revival steps), `docs/DEPLOY.md` (the deploy runbook), `docs/adr/` (decisions — Part I added ADRs 0016–0019; Part II added ADRs 0020–0031; hardening added ADR 0025; workspace/service and run/message parity added ADRs 0026–0030; profile/document/memory added ADR 0031; db-rewire to the CDS Library added ADR 0032; onboarding's reserved-settings-namespace and locked merge added ADR 0033; counselor response modes added ADR 0034; the in-app CDS extraction pipeline and admin write path added ADR 0036; the per-turn agent surface and the essay suggestion layer added ADR 0037, amending ADRs 0013 and 0030; the CollegeData facts store, in-process DB tools, and CDS-parking decision added ADR 0038; the admissions-fit Explore estimate added ADR 0039, superseded by ADR 0040, which cut the estimate back to the admit rate alone; goal mode's independent-judge iteration loop added ADR 0041, still Proposed pending the plan's real-student dogfood gate), `docs/research/` (stack survey). Keep this current as decisions change.*
