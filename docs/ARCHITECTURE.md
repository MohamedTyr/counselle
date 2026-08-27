# Counselle — System Architecture

> The complete architecture for Counselle, in two parts. **Part I (§1–25)** is the **agent service** — the honesty-first agent behind a versioned API. **Part II (§26–37)** is the **full-stack app** built on top of it — auth, chat management, the work-visibility protocol extensions, the React frontend, the student profile/document/memory stores, and first-run onboarding. Companion docs: `specs/` (PRDs & plans), `docs/DATABASE_GUIDE.md` (the data contract), `docs/adr/` (one decision each), `docs/research/` (the stack survey).
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
8. [The data-access layer: the `counselle-db` MCP server](#8-the-data-access-layer-the-counselle-db-mcp-server)
9. [Packet, evidence, and citation truth boundary](#9-packet-evidence-and-citation-truth-boundary)
10. [Dynamic catalog and qualified references](#10-dynamic-catalog-and-qualified-references)
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
38. [The CDS extraction pipeline & admin surface](#38-the-cds-extraction-pipeline--admin-surface)

---

# Part I — The agent service

## 1. Guiding principles

1. **Honesty lives in code, never in the LLM's head.** The packet boundary validates edition/domain identity, availability, typed values, compiled context, physical-PDF evidence, and canonical displays/caveats. The LLM composes already-safe facts and copies evidence markers; it never interprets packet JSON or repairs a rejected value. (ADRs 0006, 0032.)

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
            │  domain/ — packet/evidence/value types, caveats, season, event specs     │
            └──────┬──────────────────────┬───────────────────────────┬────────────────┘
                   │ MCP                  │ MCP / retriever           │ SQL (counselle-owned)
        ┌──────────▼─────────┐  ┌─────────▼──────────┐   ┌────────────▼─────────────────┐
        │ counselle-db       │  │ Tavily (search_web │   │ Postgres `counselle.*` schema│
        │ MCP server         │  │ /_school_site      │   │  sessions/checkpoints,       │
        │ (read-only)        │  │ /_reddit)          │   │  users/workspace/checkpoints │
        └──────────┬─────────┘  └────────────────────┘   └──────────────────────────────┘
                   │ asyncpg (cds_library_reader, READ ONLY)
        ┌──────────▼───────────────────────┐
        │ CDS Library Postgres 16          │
        │ exactly five reader views        │
        └──────────────────────────────────┘
```

**Request flow (the dossier wedge, canonical):**

1. A message arrives on a session: question + **source-config** (§14). The API edge attaches a trace ID and request context, and hands it to the orchestrator.
2. The orchestrator calls `resolve_school` before school-specific reads. **Not in the database → short-circuit**; otherwise the result supplies profile identity and selected-edition domain coverage. Material underspecification can produce a structured clarifying-question bundle (§12.1).
3. `get_school_profile` serves stable identity groups; `get_domain` serves a usable current-manifest domain. Both return code-owned displays, availability, caveats, and registered evidence markers. `query_database` is reserved for parameterized cross-school candidate/aggregate work.
4. Gaps the DB can't fill (this year's deadline, campus vibe) → the agent calls the three **Tavily search tools** (`search_web` / `search_school_site` / `search_reddit`) for the *enabled* sources, steering which to use (§14). *(The dedicated deep-research subagent + verification pass — §13 — is designed but not yet wired; the inline Tavily tools fill this gap in the meantime.)*
5. The answer streams out as protocol events: text deltas with inline citation markers, **viz events** (§17), `step`/`thinking` work-visibility events (§27), then a final `done` event with sources + usage.

---

## 3. The stack

Chosen by surveying the frontier and picking proven pieces (never reinvent the wheel). Full evaluation in `docs/research/`.

| Layer | Choice | Why (for us specifically) | ADR |
|---|---|---|---|
| **Agent runtime** | **PydanticAI** | Model-agnostic (`model=` from config — the model seam); native MCP client; typed outputs (the citation envelope *is* a `result_type`). | 0003 |
| **Orchestration** | **LangGraph** | Multi-agent research subgraphs; checkpointer = session persistence (and the platform's chat history later). Clarifying questions are a PydanticAI typed-output lifecycle (§12.1). | 0003, 0035 |
| **API edge** | **FastAPI** (+ SSE) | Matches the Python stack; typed request/response; streaming-native. | 0016 |
| **Database access** | **`counselle-db` MCP server** (Python, asyncpg, `cds_library_reader`) | Four tools over five reader views; typed packet/evidence boundary and guarded SQL. | 0004, 0005, 0012, 0032 |
| **Deep research** | **GPT-Researcher** (embedded) | Only OSS deep-research with pluggable MCP sources (our DB first-class); best controllable cost. Designed but not yet wired — see §13. | 0009 |
| **External search** | **Tavily** | One search+extract backend for web / .edu / Reddit, scoped by domain; also GPT-Researcher's retriever. No scraping of our own. | 0015 |
| **Skills** | **SKILL.md** open standard | Portable workflow layer, loaded on demand. | 0010 |
| **Session persistence** | **LangGraph Postgres checkpointer** in `counselle.*` | Sessions survive restarts from day one; the platform's chats are the same rows + a user FK. | 0019 |
| **Config** | **pydantic-settings** + versioned data assets | One typed settings surface, fail-fast at startup. | 0018 |
| **Models** | Default **Vertex AI**: counselor **Quick** uses `gemini-3.5-flash`; counselor **Think** uses `gemini-3.1-pro-preview` behind the advertised response-mode capability list; `gemini-2.5-flash` remains the cheap tier for clarifier and auto-title work. Other agents remain swappable through PydanticAI's per-agent `model=` config. (A LiteLLM sidecar remains an option in ADR 0011 but has no Settings knob — added only if/when needed.) | 0011, 0034 |
| **Language** | Python | Matches the pipeline; asyncpg expertise carries over. | — |

---

## 4. Layering & the dependency rule

(ADR 0017.) Four layers, dependencies point **inward only**. The point is not ceremony — it's that the honesty-critical code stays pure, testable, and untangled from frameworks, and that any layer can be replaced without touching the ones beneath it.

| Layer | Package | Contains | May import |
|---|---|---|---|
| **Domain core** | `domain/` | Typed packet values, availability/evidence/citation/caveat models, render/clarify/source/event specs, and `admission_season(today)`. Pure functions and Pydantic models. **No I/O, no LLM calls, no LangGraph/FastAPI imports.** | stdlib, pydantic |
| **Application** | `app/` | LangGraph/PydanticAI orchestration, source-config tool mounting, skills, live data-picture injection, evidence/source registry, and verified viz assembly. | `domain/`, the stack |
| **Adapters** | `adapters/` (+ the separate `counselle-db` server) | Tavily search, email, checkpointer/provider integrations, and asyncpg access to the five reader views. | `domain/`, vendor SDKs |
| **API edge** | `api/` | FastAPI routes, SSE encoding, request context (trace ID + optional principal), translation of graph output → protocol events. | `app/`, `domain/` |

Rules of thumb (the seam discipline):

- **The domain core is the deletion-test survivor.** Deleting it would scatter packet identity, availability, evidence, display, and caveat rules across tools and prompts. It is the most-tested code in the repo (§21).
- **One adapter = hypothetical seam; two = real.** We do not write interfaces for things with one implementation and no honesty stake. The model seam is real (Vertex/Anthropic — via PydanticAI, not ours). The search seam is the three thin tools (Tavily today; the tool signatures are the seam). The session seam is LangGraph's checkpointer protocol (theirs, not ours).
- **No pass-through wrappers.** If a module's interface is as complex as what it hides, delete it.
- **Accepted deviation (ADR 0017 as amended by ADR 0032):** `app/` imports `counselle_db/service.py` directly in-process for verified rendering and workspace reference checks. MCP remains the LLM tool-loop seam; there is no field reconciler.
- **The CDS admin write path (ADR 0036, §38) follows the same four layers as a self-contained subsystem** — `domain/cds/`, `adapters/cds_*.py`, `app/cds/`, `api/routes/cds_admin.py` — and is additive to this table, not an exception to it. It is called out separately here only because it is the one place in the repo that writes `cds_library` at all; everywhere else in this table, "adapters" reading the five views is the entire pipeline-database story.

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
│       └── data_picture.md       # live manifest/coverage prompt template
├── domain/                       # the pure honesty core (§4)
│   └── cds/                      # manifest compile, packet build, claims, page math — the CDS write-side honesty core (§38)
├── app/                          # orchestration: graph, agent node, steps/turns/records/transcript, skills
│   └── cds/                      # extraction engine, job poller, ingest/review services (§38)
├── adapters/                     # tavily tools, email adapter, embedding client (§4)
│   ├── cds_gemini.py             # Vertex gemini-3.1-flash-lite extraction calls (§38)
│   ├── cds_pdf.py                # PyMuPDF page ops (§38)
│   └── cds_store.py / cds_admin_queries.py   # the only writer of cds_library base tables (§38)
├── api/                          # FastAPI edge: routes, SSE, auth, request context
│   └── routes/cds_admin.py       # /v1/admin/cds/*, current_superuser-gated (§38)
├── counselle_db/                 # the counselle-db MCP server (own process; imports domain/) — read path only
├── config/cds/                   # ported, versioned CDS manifest/prompt/domain YAMLs (§38)
├── skills/                       # SKILL.md files (§15)
├── migrations/                   # Counselle-owned migrations for the counselle.* schema ONLY (0001–0015)
├── evals/                        # the eval question set + runner (§21)
├── frontend/                     # the React SPA (§31) — the sole protocol client
├── scripts/                      # one-off utilities (setup_db.sql, chat_cli.py, smoke scripts)
├── specs/                        # PRDs + execution plans (mvp1/, mvp2/, deep-research/)
└── tests/
```

The `counselle-db` MCP server ships in the same repo (it imports the domain core for normalization) but runs as its own process — already the right shape to split out later if ever needed.

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
- **A thin `counselle.sessions` row** (session_id, created_at, `user_id`, title, default source-config) fronts the checkpoint data. `user_id` is populated and FK-enforced for new rows (migration 0004 added `counselle.users` + the FK; §28) — chat history, profiles, and per-user memory attach to rows that already exist. No migration of meaning, only addition.
- **Counselle owns its schema and migration chain** (`migrations/`, over `counselle.*` only — never `public.*`/`raw.*`, which belong to the pipeline and are read-only to us; ADR 0012).
- **Long-term memory & personalization are deferred** (PRD) — but they will live behind the same session/user rows, which is why those rows exist now.
- **Retention:** sessions are cheap rows; a configurable TTL/cleanup job knob (§18) defaults to "keep everything" until there's a reason not to.

---

## 8. The data-access layer: the `counselle-db` MCP server

*This section describes the agent's read path only. Since ADR 0036, Counselle
also contains a separate, superuser-gated write path (§38) that produces the
rows this section reads — on its own DSN and Postgres role, never touched by
the agent runtime or the MCP server below.*

The standalone MCP server and its in-process service share one asyncpg catalog over
the `cds_library_reader` contract. That role can select exactly five views:
`school_profiles`, `active_cds_documents`, `active_cds_domain_packets`,
`cds_document_sources`, and `cds_manifest_snapshots`. The agent path never imports
pipeline-writer code or reads pipeline base tables — it only ever connects through
`COUNSELLE_DB_RO_DSN`. The LLM sees exactly four tools:

| Tool | Purpose |
|---|---|
| `resolve_school(query)` | Resolve name/unitid and return safe identity plus selected-edition coverage, or ambiguity/not-found. |
| `get_school_profile(unitid, groups?)` | Read dynamic stable profile groups with provenance and snapshot caveat. |
| `get_domain(unitid, domain_id)` | Read one usable current-manifest domain for the selected document, with typed values/evidence/availability. |
| `query_database(sql, params)` | One guarded parameterized `SELECT`/`WITH` over the five views for candidate selection or aggregates. |

The first three are the normal path. SQL results are not cited student truth: state
the as-of and covered/total denominator, then re-fetch named final values through a
typed read. The query guard enforces schema allowlisting, positional parameters,
statement/row/serialized-byte limits, and rejects packet/PDF/provider payloads.

At startup the catalog validates exactly one current manifest. Manifest `5.1.0`
(extraction contract 8) is the current immutable patch successor; domains,
metric definitions, profile groups, labels, and counts are derived rather than copied
into prompts or code.

---

## 9. Packet, evidence, and citation truth boundary

The active packet view explicitly includes every current-manifest domain, including a
null packet. For a school, code selects the greatest `(academic_year, document_id)`
document and pins every domain read to it—never merging an older edition to fill a
hole. Typed parsing validates document/year/domain/manifest/hash identity, compatible
extractor identifiers, physical page evidence, and value states while dropping
provider contracts and diagnostics.

Only `extraction_status=verified` plus `availability_status=reported` produces a
student value. Verified `not_reported`, `not_applicable`, `suppressed`, and
`not_in_template_version` states remain explicit unavailable claims with evidence;
`not_extracted`, `conflict`, and `invalid` never carry a value. Displays and canonical
caveat text are copied from code. Compiled context binders supply value-specific term,
cohort, or snapshot vintage; prose instructions are never parsed to infer it.

Every typed value exposes compact visible and internal evidence markers. The model
copies both verbatim beside supported prose; the runtime registers the immutable PDF
source and removes internal tokens before the student sees the answer. Live computed
aggregates receive no fake source marker. Source chips use official school domains
only for resolved DB schools; external official/community sources retain their own
tier and provenance.

---

## 10. Dynamic catalog and qualified references

The current manifest is the catalog. Metric IDs are only unambiguous as
`<domain_id>.<metric_id>`; the typed packet boundary is the sole minting point for
these refs. The same ref flows through domain results, evidence IDs, viz cells, and
eval fixtures. Unknown refs are rejected rather than silently shown unavailable.

The runtime injects a compact **data picture** derived from the current manifest,
profile snapshot, selected-document editions, usable-domain coverage, and safe
aggregate counts. It guides routing without putting packets, metric inventories, or
values into ambient context. Current-cycle deadlines and facts beyond the CDS edition
route to official web search even when a packet exists.

---

## 11. School coverage (no scope gate)

Any row in `school_profiles` is in scope; an absent school receives the explicit
not-in-database response. Coverage is selected-edition and current-manifest based:

- **covered:** at least one domain row for the selected document has an accepted packet;
- **fully:** accepted packets equal the current domain count and none is partial;
- **partial:** covered but not fully.

Usable domains are those the typed coverage result permits. No document, no accepted
packet, partial packet, stale edition, and current-definition mismatch remain distinct
states with code-owned caveats. Missing/current values fall back to the school's
official site/search with disclosure; cross-school comparisons disclose edition
mismatch and aggregate denominators.

---

## 12. The agent runtime (PydanticAI + LangGraph)

(ADR 0003, amended by ADR 0035.) PydanticAI defines each agent with `model=` from config, native MCP connections, and typed outputs. LangGraph orchestrates: state passing and session persistence via the checkpointer (§7). Clarifying questions are now a structured PydanticAI output path, not the product's live `interrupt()` lifecycle.

The **counselor** agent is the primary agent. The **researcher** and **verifier** agents are designed (§13) but not yet wired — they are part of the deep-research follow-up (`specs/deep-research/plan.md`). Parallel research subgraphs attach when that subsystem is activated.

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

**Cost-optimized configuration (added with the deep-research follow-up):** three model tiers — `FAST_LLM`/`STRATEGIC_LLM` → Gemini 2.5 Flash, `SMART_LLM` → Gemini 2.5 Pro, escalatable per question; hard depth/breadth/concurrency caps. **DB-first does the heavy lifting:** web research fills gaps or current-cycle facts the selected profile/domain contract cannot support.

**What we add (already PRD features):** source-type tagging (each source tags `official`/`community`, carried into citations), the **verification pass** (a cheap post-pass cross-checking the top 2–3 cited sources before stating a fact), and the eval set (§21).

**Search backend = Tavily** (§14) — the same backend as the fast inline tools, so there is exactly one external-search dependency.

---

## 14. External search & source control

(ADR 0015.) All three external searches are **one backend — Tavily — scoped by domain**, as three thin tools. Nothing is scraped by us. The DB is the fourth, always-on source; search fires when selected profile/domain data is unavailable or when deadlines/current-cycle facts exceed the CDS edition.

| Tool | Scope | Tier |
|---|---|---|
| `search_web(query)` | no domain filter | varies |
| `search_school_site(school, query)` | `include_domains = [the school's stored URL]` — injected by the tool from the DB; the agent only names the school | **official** |
| `search_reddit(query, subreddits)` | `include_domains = [the subreddits the agent picked]` | **community** (never cited as fact) |

**Reddit is agent-steered:** the agent picks subreddit(s) per question from the **labeled menu** (a versioned data asset, §18 — r/ApplyingToCollege for process, r/chanceme, r/financialaid, r/[SchoolName] for campus life, program subs), several in parallel when useful. School subs are best-effort (a wrong guess returns nothing, harmlessly) — no mapping table to maintain.

**Source control (per-request, enforced in code — ADR 0013):** a **source-config object** travels with each request (web on/off; Reddit on/off + per-subreddit allowlist; .edu on/off; DB always on). The orchestrator **builds the toolset from the config**: a disabled source's tool isn't mounted. When the deep-research subagent is activated (§13), its retriever list is gated by the same config. A disabled source can't be reached and never appears in citations. Three named tools (not one generic) so the dropdown maps 1:1 and the citation tier is unambiguous per tool.

---

## 15. Skills (SKILL.md)

Skills are SKILL.md files (open standard: YAML frontmatter + Markdown body), living in `skills/`. Current skills include public response-mode workflows (`focused-answer`, `deep-research`, `guided-counselor`), public task workflows (`application-rounds`, `chancing`, `costs-and-aid`, `essay-fit`, `major-and-fit`, `school-comparison`, `school-deep-dive`, `school-list`, `testing-strategy`), and internal support workflows (`citation-and-recency`, `counselor-research`, `db-recipes`). Metadata loads at startup and bodies load through progressive disclosure. The non-advertised `dossier-assembly` alias canonicalizes to `school-deep-dive` only for parked-turn compatibility; it is not a public skill.

Students can explicitly invoke only skills that opt into the public SKILL.md metadata (`user_invokable`, with student-facing display copy). The API exposes ordinary task skills through config and validates submitted canonical names, visibility, uniqueness, count, group conflicts, and trusted body-size/path bounds before a turn is claimed. Valid selections are preloaded as a server-owned, one-turn instruction block; they cannot override authz, read-only constraints, mounted-tool availability, or honesty rules. The selected canonical names persist in the turn record and original user transcript entry, so reload, retry, and regeneration preserve the exact invocation without adding control syntax to the student's text. Internal skills remain available to the agent's normal progressive-disclosure tool path but are never exposed as student actions.

The primary composer mode is also skills-backed. `/v1/config` exposes a separate `skill_modes` catalog derived from public skills in the trusted `response-mode` group. The frontend presents exactly three student-facing choices — Focused Answer, Deep Research, and Guided Counselor — while still sending the selected mode through the existing `skills: string[]` request field. Mode names are snapshotted into the same persisted selected-skill list as task skills, but the transcript filters mode chips out of the visible "Invoked skills" row so ordinary specialized skills remain visible without repeating the conversation posture on every message.

---

## 16. Citations, recency & temporal context, end to end

- **Every named DB fact carries registered evidence** (§9); external sources retain official/community tier provenance.
- **Citation UX:** lightweight **inline expandable markers** — each claim gets a marker with an official/community chip; expanding reveals source, vintage, caveat. The `sources` event (§6) carries the turn's full deduplicated list.
- **Recency is per-value** (the vintage resolver) plus three always-available temporal facts, none guessed by the model:
  - **Today's date** — injected by the runtime each request.
  - **The live data picture** (§10) — manifest/profile snapshot, selected-edition and coverage context. The agent routes DB-vs-web without a hardcoded calendar.
  - **The admission season** — `admission_season(today)` (pure, in `domain/`; the phase table is a data asset) → cycle phase + active entering class. Jun–Jul = list-building/essay prep; Nov = early deadlines; Mar–Apr = decisions; etc.
- **Boundary (KISS):** season awareness is *context*, not a deadline tracker (process management is deferred, PRD). School-specific dates are **data** — CDS fields or live web, fetched and cited like any value, never inferred from the generic calendar.

---

## 17. Visualizations

(ADRs 0014, 0024, 0032.) Viz protocol v2 has an open type seam. Known `stat_block` and `comparison_table` cards render natively; unknown opaque types degrade safely. A cell must be a qualified metric ref, a profile ref, a registered external value, or explicit unavailable.

**The provenance boundary:** the model proposes shape and references; code fetches DB/profile refs and verifies registered external values. Rejected refs must be corrected, never converted into unavailable. No trend chart may imply editions the data does not contain.

**Mechanism:** `render_viz` resolves metric refs through `get_domain`, profile refs through `get_school_profile`, external refs through the source registry, and unavailable cells without lookup. The backend stages/deduplicates successful specs and returns only a compact acknowledgment to the model. Clients render canonical displays and provenance; unknown card types use the generic fallback.

**Accuracy guarantee:** no visible numeric/text value is accepted from an unregistered model literal. All-or-nothing validation prevents a partly truthful card.

---

## 18. Configuration architecture

(ADR 0018.) "Configurable" means **one place per kind of thing**. Three buckets, one policy. The full-stack app's configuration delta (additional Settings groups + data assets) is §32.

**1. Typed settings (`config/settings.py`, pydantic-settings).** One `Settings` object, loaded once at startup, **validated fail-fast** (a missing key or malformed value kills boot with a clear error — never a silent default in production paths). Layered: code defaults → `.env` / environment → explicit overrides. Everything deploy- or cost-relevant lives here:

| Group | Knobs |
|---|---|
| Models | per-agent `model=` — `model_counselor` (Quick), `model_counselor_think` (Think), `model_cheap`, `model_clarifier`, `model_title` (the cheap-tier auto-title model); counselor display/preview labels for `/v1/config`; `response_mode_think_enabled` (honest-disable switch: omit Think, never remap it); `thinking_stream` (bool — gates native Gemini thought-summary requests/display for Think, §27.2; **default on**; `thinking_summaries` remains a compatibility alias only; see `config/settings.py`); `agent_max_model_requests`; provider credentials; per-model prices including Pro's >200K tier. Researcher/verifier knobs, GPT-Researcher's `FAST/STRATEGIC/SMART` tiers, and a LiteLLM sidecar endpoint are added with the deep-research follow-up (§13). |
| Database | CDS Library reader-login DSN, application DSN, statement/row/byte limits, pool sizes |
| Counselle schema | `counselle.*` DSN, checkpointer on/off (memory for tests), session TTL/cleanup |
| Sources | default source-config (web/Reddit/.edu on/off), Tavily key, per-tool result limits |
| API | host/port, CORS origins, SSE keepalive, protocol version |
| Observability | log level, cost-accounting on/off |

*(The Auth, Chat, Streaming, and Rate-limit groups are in §32. There is no "Research" group yet — it lands with §13.)*

The settings surface also owns the hardening knobs added after MVP2: the
live-derived school count is read from `Catalog.school_count` (not a Settings
literal); password length is `password_min_length`; the thinking splitter uses
`thinking_threshold_chars`; production CORS defaults to an empty `cors_origins` list.

**2. Versioned data assets (`config/assets/`).** Editorial prompts (including the live data-picture template), subreddit menu, and season calendar. Reviewable in diffs, no magic strings in control flow.

**3. Live-derived from the DB (never configured, never hardcoded).** Current manifest/domains, profile groups/snapshot, selected editions, coverage, evidence, and school URLs.

**What may be hardcoded:** only invariants — packet/availability/evidence validation, versioned protocol schemas, and SQL safety.

---

## 19. Observability & cost accounting

Cheap on day one, brutal to retrofit:

- **Structured logging (structlog)** — JSON logs; a **trace ID** minted per request at the API edge rides through the graph, tools, and research subagent, and is returned in the `meta`/`error` events. Never log secrets (house rule); never log full student messages at INFO.
- **Per-request usage accounting** — every model call's tokens (PydanticAI exposes usage) and Tavily/research calls roll up into the turn's `usage` event and a log line: per-session and per-turn cost visibility from the first day, which is also how the research cost caps get verified in practice.
- **Health** — `GET /v1/health` checks process/database reachability, checkpointer, and the MCP child supervisor. Turn-registry and limiter counters remain best-effort process state.
- Metrics/dashboards are a platform-phase concern; the structured logs are designed so that adding them is aggregation, not re-instrumentation.

---

## 20. Deployment & day-one deployability

**Nothing may block containerized deployment** — deployability is a property, not a phase. The full-stack app deployment delta (same-origin SPA serving, the amended statelessness clause, entrypoint migrations) is §33. The points below describe the as-designed deployability.

- **12-factor:** all config comes from the environment; durable state lives in Postgres (`counselle.*`), so the service can restart or move safely.
- **One container** (a `Containerfile` from day one) running the API service; the `counselle-db` MCP server runs as a child process inside it, supervised by `api/supervision.py` (`McpSupervisor`: exponential-backoff restart, status on `/v1/health`).
- **Migrations** (`migrations/`, chain 0001–0006 over `counselle.*` only). Migration-on-boot via the container entrypoint is planned per §33; until then, `uv run yoyo apply` is run manually before first launch.
- **Secrets** in `.env`/secret manager only; shared with the pipeline **credentials only** (the read-only DSN + Vertex/GCP keys) — no shared code, config, or runtime dependency. The DB is the contract.
- **Read-only boundary** — the reader LOGIN can select exactly the five `cds_library` views; the separate application DSN owns only `counselle.*`. (ADRs 0012, 0032.)

---

## 21. Testing strategy

(Per the PRD: test where lying to a student is possible; skip ceremony elsewhere. Behavior, not implementation.)

- **The honesty core is the test surface.** Packet identity/compatibility, extraction and availability states, displays, compiled contexts, evidence, caveats, editions, and ref rejection receive deterministic tests.
- **The eval set (`evals/`)** scores routing, coverage/edition/composition/denominator honesty, citations, clarify/narration quality, and workspace behavior; live roles derive from the data picture.
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
| DB access | four `counselle-db` tools over five reader views (§8, §10) |
| Web / Reddit / .edu search | Tavily, 3 domain-scoped tools; Reddit agent-steered (§14) |
| Source-control dropdown | per-request source-config gating the toolset (§14) |
| Deep research + verification | GPT-Researcher subagent + verification pass (§13) — designed; activates with the follow-up plan |
| Citations (official vs community) | citation envelope `tier` (§9); `sources` event (§6) |
| Citation UX (inline expandable markers) | `delta` markers + `sources` event; client renders (§6, §16) |
| Recency & temporal awareness | compiled contexts + selected edition + live data picture + injected date + `admission_season` (§9, §16) |
| Clarifying questions | PydanticAI `ask_student` typed output → durable A1 `clarify` event → A2 continuation (§12.1) |
| In-session working memory | LangGraph state via Postgres checkpointer (§7) |
| Skills | SKILL.md in `skills/` (§15) |
| Visualizations | `render_viz` → render spec → `viz` event → dumb components (§17) |
| Model configurability | per-agent `model=` from Settings (§18) |
| School coverage | selected-edition, current-manifest coverage; in-DB-or-not boundary (§11) |
| Honesty / no-misread | packet/evidence anti-corruption boundary (§9, §21) |
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
| CDS sparsity → missing domains/values | Distinct availability states plus official-site fallback with disclosure (§11). |
| Checkpoint/session data growth | Configurable TTL/cleanup (§7, §18); rows are cheap until they aren't — knob exists from day one. |
| Pipeline publication changes domains/coverage | Catalog and coverage derive from immutable current manifest/views; contract checks reject an invalid pointer. |
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
                  (counselle-db MCP · Tavily · Postgres counselle.* · pipeline DB read-only)
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

The live gate is final-answer mode: `delta` starts once the answer phase begins. Native thought output is controlled by `thinking_stream` (default on); `thinking_summaries` remains a compatibility alias only. The timeline keeps the visible narration lines in the turn's step record (§27.1), so revisited chats preserve the run surface under the expanded receipt. See `config/settings.py`.

With counselor response modes (ADR 0034), `thinking_stream` is deliberately not
the mode selector. Quick always uses the Quick model with minimal Gemini
thinking and no requested provider-thought summaries. Think uses the Think
model with high Gemini thinking; `thinking_stream` only decides whether native
provider thought summaries are requested and emitted as `thinking` events.

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

All existing v1 endpoints keep their exact semantics; `POST /v1/sessions` and `POST .../messages` now require auth and stamp `user_id`.

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

**Rate limiting (PRD story 50):** the public-facing app means strangers can spend the Gemini/Tavily budget.

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
| Chat | `model_title` (cheap-tier title model, distinct from `model_cheap`), `title_max_len`, response-mode display/capability knobs, `thinking_stream` (default on; `thinking_summaries` compatibility alias), `thinking_threshold_chars` |
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

- `thinking` density — the model's own "Narrate As You Work" one-liner per round is the dead-air mitigation that ships (`thinking_stream` is on by default; `thinking_summaries` is compatibility-only). If dogfooding still shows sparse narration, add the cheap-model per-step summarizer (decide on evidence).
- Think rollout — live smokes and two-mode eval comparison require Vertex/Tavily
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

## 38. The CDS extraction pipeline & admin surface

(ADR 0036.) Counselle contains a second subsystem beside the agent: a
superuser-gated write path that produces the `cds_library` rows the agent's
read path (§8, §9) consumes. It follows the same four-layer discipline as the
rest of the app (§4), isolated from the agent by both code and, more
strongly, by Postgres role and DSN — a bug in this subsystem cannot let the
agent's own connections write, because the agent's pool is never given the
write role's credentials.

**Three DSNs, three roles, one database.** The agent path (§8) connects as
`cds_library_reader` over `COUNSELLE_DB_RO_DSN` — `SELECT` on exactly the five
reader views, nothing else. Counselle's own application state connects as
`counselle_app` over `COUNSELLE_DB_APP_DSN` — read-write, but only inside
`counselle.*`, never `cds_library`. This subsystem adds a third: `cds_library_app`
over `COUNSELLE_DB_PIPELINE_DSN` — `INSERT, SELECT, UPDATE` (never `DELETE`) on
the eight `cds_library` base tables the five reader views are built from.
Every route in this subsystem sits behind the pre-existing `current_superuser`
dependency (ADR 0021); there is no path from an ordinary authenticated
session into it.

**Layout, mirroring the read side's layering:**

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
  service_review.py       review, edit, approve, reject, rerun
  manifest.py              manifest publish + the pre-flight drift guard
config/cds/              the ported, versioned manifest/prompt/domain YAMLs
api/routes/cds_admin.py  /v1/admin/cds/*, current_superuser-gated
frontend/src/features/cds-admin/
                        the coverage grid, upload, and review screens,
                        nested inside the existing workspace shell
```

**The extraction engine.** A candidate document (an uploaded CDS PDF) is
routed to the domains/pages an extraction job requests, then extracted
through one-shot, schema-constrained Vertex calls — inline PDF,
`response_schema` strict JSON, temperature 0 — using a model id read from
Settings, never a literal. Large documents are page-routed rather than sent
whole; a lease with background renewal, not a hard per-call page cap, is the
load-bearing mitigation for pathological page counts.

**The job poller.** `app/cds/jobs.py`'s `Poller`, started from the FastAPI
lifespan and stopped before the pools it depends on close, claims and runs
extraction jobs using
lease/claim columns on `cds_extractions` — no Celery, no Redis, no second
container (ADR 0023, one deployable). It is a no-op, not a startup failure,
when `COUNSELLE_DB_PIPELINE_DSN` is unset or the `cds_worker_enabled` kill
switch (default on) is off. On boot it sweeps any extraction a prior process
abandoned mid-run to a terminal `failed`/`worker_lost` state so it is
re-runnable rather than stuck.

**The write is never trusted by convention.** Every packet this engine
builds — a model extraction or a human correction — is round-tripped through
the reader's own `parse_packet_row()` (§9) inside the same transaction,
before COMMIT. If the read path would reject it, the write aborts. This is
the same anti-corruption boundary the agent's read path relies on, exercised
against the writer at write time rather than trusted separately. Packets are
tagged with one of two extractor identities added to the allow-list
alongside the legacy `gemini-*` identities: `counselle-cds-v1` for model
extractions, `human-review-v1` for admin corrections that are new rows, not
mutations — `cds_domain_packets` has a BEFORE UPDATE immutability trigger
that makes new-row-per-correction the only possible shape.

**Manifest publish and drift.** The manifest snapshot table is immutable by
trigger (row-level `INSERT`-then-flip, never `UPDATE` of a published row's
content); publishing a new version is a dedicated script
(`scripts/publish_cds_manifest.py`), not an admin-UI action — an advisory
lock, a refusal if the target version already exists with different content,
a refusal if any extraction is mid-flight, a dry-run diff by default, and an
explicit flag to commit. A pre-flight drift guard
(`app/cds/manifest.py`'s `verify_manifest_current()`) runs before any model
spend on every extraction: if the compiled `config/cds/` no longer matches
the published, current manifest, the job fails immediately with a distinct
`manifest_drift` error and zero model calls are made.

**Review and correction.** A newly uploaded document goes through
upload → detect (duplicate/mismatch checks) → extract → review → approve or
reject, gated by `is_candidate`. Correcting an already-*active* document
(one that is currently serving students, not a fresh upload) is a distinct
flow — `active_update` — that reviews, edits, approves, or rejects an
extraction against the still-active document, per domain, without ever
performing a document-level candidate/active swap: the document keeps
serving its current packets until each corrected domain's packet is
individually activated at approval, so there is no offline window. A
resolution marker on the extraction row closes this loop once reviewed, so a
correction that has already been approved or rejected does not keep
re-surfacing as pending.

**The admin surface.** Fourteen endpoints under `/v1/admin/cds/*`
(`api/routes/cds_admin.py`), all `current_superuser`-gated: coverage (a grid
of school × domain currentness), school listing, upload, job status, document
detail and page images, metric edits, approve/reject, and rerun. Three
screens in `frontend/src/features/cds-admin/` (coverage, upload, review) are
nested inside the existing authenticated workspace shell (§31) and visible
only to superusers — `AdminGate` redirects any other user away before the
route renders.

**What this subsystem is not.** It is not a second agent, not a second model
seam, and not reachable from any student-facing request path. The read
contract in `docs/DATABASE_GUIDE.md` — the five views, the packet/evidence
truth boundary, every honesty rule — describes the same data this subsystem
writes, unchanged by its existence. Full operational history (cutover,
manifest republish, database-pollution disposal, the live ship-gate proof)
lives in `specs/cds-pipeline/plan/CUTOVER.md`, not here — this section describes
the architecture, not a point-in-time build record.

---

*Companions: `specs/mvp1/PRD.md` (agent service product spec), `specs/mvp2/PRD.md` (full-stack app product spec), `specs/user-onboarding/plan/` (onboarding plan and phase record), `docs/DATABASE_GUIDE.md` (the data contract), `docs/DEPLOY.md` (the deploy runbook), `docs/adr/` (decisions — Part I added ADRs 0016–0019; Part II added ADRs 0020–0031; hardening added ADR 0025; workspace/service and run/message parity added ADRs 0026–0030; profile/document/memory added ADR 0031; db-rewire to the CDS Library added ADR 0032; onboarding's reserved-settings-namespace and locked merge added ADR 0033; counselor response modes added ADR 0034; the in-app CDS extraction pipeline and admin write path added ADR 0036), `docs/research/` (stack survey). Keep this current as decisions change.*
