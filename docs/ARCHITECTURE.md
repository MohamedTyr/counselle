# Counselle — System Architecture

> The complete architecture for Counselle, in two parts. **Part I (§1–25)** is the MVP1 agent service, designed so the future platform (persistent chats, user accounts, profiles, chancing, writing) extends it without rework. **Part II (§26–35)** is the MVP2 full-stack app built on top of it — auth, chat management, the work-visibility protocol extensions, and the React frontend. Companion docs: `specs/mvp1/PRD.md` / `specs/mvp2/PRD.md` (what & why), `docs/DATABASE_GUIDE.md` (the data contract), `docs/adr/` (one decision each), `docs/research/` (the stack survey).
>
> Status: **MVP1 built (2026-06-11)**. PRD stories 1–38 and 42–58 implemented and verified. Deep research (PRD stories 39–41) designed but not yet built — see §13 and `specs/deep-research/plan.md`.
>
> **MVP2 in build (2026-06-12)** — Part II is the spec; frontend FE-0…FE-6 merged, backend phases B0–B7 underway per `specs/mvp2/plan/ship-plan.md`.

---

## Table of contents

**Part I — MVP1: the agent service**

1. [Guiding principles](#1-guiding-principles)
2. [The shape of the system: an API-first agent service](#2-the-shape-of-the-system-an-api-first-agent-service)
3. [The stack](#3-the-stack)
4. [Layering & the dependency rule](#4-layering--the-dependency-rule)
5. [Repository layout](#5-repository-layout)
6. [The agent API & event protocol](#6-the-agent-api--event-protocol)
7. [Sessions, state & the platform-ready identity model](#7-sessions-state--the-platform-ready-identity-model)
8. [The data-access layer: the `counselle-db` MCP server](#8-the-data-access-layer-the-counselle-db-mcp-server)
9. [The citation envelope](#9-the-citation-envelope)
10. [Field discovery (1,093 fields without overwhelm)](#10-field-discovery-1093-fields-without-overwhelm)
11. [School coverage & the CDS tier](#11-school-coverage--the-cds-tier-no-scope-gate)
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

**Part II — MVP2: the full-stack app**

26. [MVP2: the shape of the full-stack app](#26-mvp2-the-shape-of-the-full-stack-app)
27. [Protocol extensions: work visibility, resume & cancel](#27-protocol-extensions-work-visibility-resume--cancel)
28. [Identity & auth](#28-identity--auth)
29. [Chat management](#29-chat-management)
30. [Feedback & per-user rate limiting](#30-feedback--per-user-rate-limiting)
31. [The frontend](#31-the-frontend)
32. [MVP2 configuration delta](#32-mvp2-configuration-delta)
33. [MVP2 deployment](#33-mvp2-deployment)
34. [MVP2 testing strategy](#34-mvp2-testing-strategy)
35. [MVP2 risks & open questions](#35-mvp2-risks--open-questions)

---

# Part I — MVP1: the agent service

## 1. Guiding principles

1. **Honesty lives in code, never in the LLM's head.** The database is a minefield (`DATABASE_GUIDE` §6): fractions stored 0–1, coded ints, NULL semantics, national-benchmark traps, lagged earnings. The data layer returns values **already decoded, scaled, formatted, and stamped with source + vintage** (the citation envelope); the LLM reasons over clean cited facts and never parses a raw cell. This one decision makes citations, source tiering, and recency awareness *fall out of* the architecture instead of being bolted on. (ADR 0006.)

2. **Use the stack's native seams; never wrap them.** Every major extension point we need already exists in a chosen tool: PydanticAI's `model=` *is* the model seam, MCP *is* the tool/transport seam, LangGraph's checkpointer protocol *is* the session-persistence seam, SKILL.md *is* the workflow seam, Tavily-behind-thin-tools *is* the search seam. A hand-rolled abstraction layered over any of these would be a shallow pass-through — interface as complex as the thing it hides, deletable without losing anything. Our own code adds exactly three seams the stack doesn't provide: the **domain core** (§4), the **event protocol** (§6), and the **configuration surface** (§18).

3. **MVP1 is the agent; the platform comes later — so the agent is a service, not an app.** Everything user-facing (today's throwaway dev chat, tomorrow's ChatGPT-style platform with accounts and chat history) is a **client of one API**. Nothing in the agent service knows or cares what's rendering it. (§2, ADR 0016.)

4. **Configurable means one place.** Anything a developer might plausibly change lives in the central typed settings or in a versioned data asset — never inline in code. Hardcoding is reserved for invariants that will never change (§18, ADR 0018).

5. **KISS, always.** Layers exist where they earn their keep (the dependency rule protects the honesty core; the protocol protects the platform future); everywhere else, the smallest thing that works. No speculative microservices, no message buses, no DI frameworks.

---

## 2. The shape of the system: an API-first agent service

**MVP1 builds one deployable: the Counselle agent service.** It exposes a small versioned HTTP API (§6) that streams a conversation as typed events. The PRD's "deliberately minimal web chat" is a **dev harness client** of that API — one plain page, zero coupling, fully replaceable. (ADR 0016.) *MVP2: the dev harness is superseded by `frontend/` (§31) — still a pure client of the same protocol.*

```
                       MVP1                                      Platform (future)
            ┌───────────────────────┐                  ┌──────────────────────────────┐
  clients   │  dev harness chat     │                  │  web app / mobile / API users │
            │  (throwaway, dumb)    │                  │  auth, profiles, chat history │
            └──────────┬────────────┘                  └──────────────┬───────────────┘
                       │      the same versioned event protocol (§6)  │
            ┌──────────▼──────────────────────────────────────────────▼───────────────┐
            │                     Counselle agent service (Python)                     │
            │  api/    — FastAPI edge: routes, SSE streaming, request context          │
            │  app/    — LangGraph orchestration, PydanticAI agents, research, skills  │
            │  domain/ — pure honesty core: envelopes, reading rules, season, tiers    │
            └──────┬──────────────────────┬───────────────────────────┬────────────────┘
                   │ MCP                  │ MCP / retriever           │ SQL (counselle-owned)
        ┌──────────▼─────────┐  ┌─────────▼──────────┐   ┌────────────▼─────────────────┐
        │ counselle-db       │  │ Tavily (search_web │   │ Postgres `counselle.*` schema│
        │ MCP server         │  │ /_school_site      │   │  sessions/checkpoints,       │
        │ (read-only)        │  │ /_reddit)          │   │  field_index (pgvector)      │
        └──────────┬─────────┘  └────────────────────┘   └──────────────────────────────┘
                   │ asyncpg (counselle_ro, READ ONLY)
        ┌──────────▼───────────────────────┐
        │ Pipeline Postgres 16 (localhost) │
        │  public.* + raw.*  (READ ONLY)   │
        └──────────────────────────────────┘
```

**Request flow (the dossier wedge, canonical):**

1. A message arrives on a session: question + **source-config** (§14). The API edge attaches a trace ID and request context, and hands it to the orchestrator.
2. The orchestrator resolves the school via `resolve_school` → unitid. **Not in the database → short-circuit** with the graceful "not in our database" answer (§11); otherwise note the school's coverage tier. Underspecified question → `interrupt()` emits a **clarify event** (§12.1) and the graph parks until the client resumes.
3. Structured facts come from the `counselle-db` tools — every value a **citation envelope** (§9), already normalized + dated.
4. Gaps the DB can't fill (this year's deadline, campus vibe) → the **deep-research subagent** over the *enabled* sources, DB-first (§13).
5. **Verification pass** cross-checks claims across sources.
6. The answer streams out as protocol events: text deltas with inline citation markers, **viz events** (§17), then a final `done` event with sources + usage.

---

## 3. The stack

Chosen by surveying the 2026 frontier and picking proven pieces (never reinvent the wheel). Full evaluation in `docs/research/`.

| Layer | Choice | Why (for us specifically) | ADR |
|---|---|---|---|
| **Agent runtime** | **PydanticAI** | Model-agnostic (`model=` from config — the model seam); native MCP client; typed outputs (the citation envelope *is* a `result_type`). | 0003 |
| **Orchestration** | **LangGraph** | Multi-agent research subgraphs; `interrupt()` for clarifying questions; checkpointer = session persistence (and the platform's chat history later). | 0003 |
| **API edge** | **FastAPI** (+ SSE) | Matches the Python stack; typed request/response; streaming-native. | 0016 |
| **Database access** | **`counselle-db` MCP server** (Python, asyncpg, read-only role) | 3 layers (discovery → safe tools → guarded SQL); reading rules + citations + read-only enforced in code. | 0004, 0005, 0012 |
| **Deep research** | **GPT-Researcher** (embedded) | Only OSS deep-research with pluggable MCP sources (our DB first-class); best controllable cost. **Not yet built — deferred from MVP1; see §13.** | 0009 |
| **External search** | **Tavily** | One search+extract backend for web / .edu / Reddit, scoped by domain; also GPT-Researcher's retriever. No scraping of our own. | 0015 |
| **Skills** | **SKILL.md** open standard | Portable workflow layer, loaded on demand. | 0010 |
| **Session persistence** | **LangGraph Postgres checkpointer** in `counselle.*` | Sessions survive restarts from day one; the platform's chats are the same rows + a user FK. | 0019 |
| **Vector search** | **pgvector** (`counselle.field_index`) | Field-discovery embeddings; reuses Postgres, no new infra. | 0007, 0008 |
| **Config** | **pydantic-settings** + versioned data assets | One typed settings surface, fail-fast at startup. | 0018 |
| **Models** | Default **Vertex AI**: `gemini-2.5-pro` (synthesis), `gemini-2.5-flash` (cheap tier); any agent swappable to Anthropic/others via config; optional LiteLLM sidecar (configured in Settings, not deployed in MVP1). | 0011 |
| **Language** | Python | Matches the pipeline; asyncpg expertise carries over. | — |

---

## 4. Layering & the dependency rule

(ADR 0017.) Four layers, dependencies point **inward only**. The point is not ceremony — it's that the honesty-critical code stays pure, testable, and untangled from frameworks, and that any layer can be replaced without touching the ones beneath it.

| Layer | Package | Contains | May import |
|---|---|---|---|
| **Domain core** | `domain/` | Citation-envelope types; the **normalization engine** (reading rules R1–R12); vintage interpretation; coverage-tier logic; `admission_season(today)`; render-spec / clarify-spec / source-config / protocol-event **types**. Pure functions and Pydantic models. **No I/O, no LLM calls, no LangGraph/FastAPI imports.** | stdlib, pydantic |
| **Application** | `app/` | The LangGraph graph; PydanticAI agent definitions (counselor in MVP1; researcher + verifier deferred — §12, §13); source-config tool mounting; skills loading; the data calendar assembly. | `domain/`, the stack |
| **Adapters** | `adapters/` (+ the separate `counselle-db` server) | asyncpg access, Tavily tools, GPT-Researcher embedding, checkpointer setup, embedding client. Each adapter implements a seam consumed by `app/` — mostly the stack's own seams (MCP tools, retrievers, checkpointer). | `domain/`, vendor SDKs |
| **API edge** | `api/` | FastAPI routes, SSE encoding, request context (trace ID + optional principal), translation of graph output → protocol events. | `app/`, `domain/` |

Rules of thumb (the seam discipline):

- **The domain core is the deletion-test survivor.** Deleting it would scatter the reading rules across every tool and prompt — it concentrates the product's entire honesty guarantee in one deep module with a tiny interface (`normalize(field, raw) → envelope`, `season(today) → phase`, …). It is the most-tested code in the repo (§21).
- **One adapter = hypothetical seam; two = real.** We do not write interfaces for things with one implementation and no honesty stake. The model seam is real (Vertex/Anthropic — via PydanticAI, not ours). The search seam is the three thin tools (Tavily today; the tool signatures are the seam). The session seam is LangGraph's checkpointer protocol (theirs, not ours).
- **No pass-through wrappers.** If a module's interface is as complex as what it hides, delete it.
- **Accepted deviations (ADR 0017):** (1) `app/` imports `counselle_db/service.py` directly in-process for `render_viz`, the data calendar, and tier checks — MCP is the tool seam for the LLM's tool loop only. (2) `api/main.py` and `api/routes/system.py` import `counselle_db.reconcile` directly, bypassing `app/` — the reconciler is infrastructure maintenance wired at the process boundary; an `app/` wrapper would be a pass-through with no behaviour and would fail the deletion test. Both deviations are documented in ADR 0017.

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
│       ├── dossier_shortlist.yaml# the ~90 curated dossier field keys (from DATABASE_GUIDE §7)
│       └── season_calendar.yaml  # the generic US admission-season table
├── domain/                       # the pure honesty core (§4)
├── app/                          # orchestration: graph, agents, research, skills
├── adapters/                     # tavily, gpt-researcher, checkpointer, embeddings
├── api/                          # FastAPI edge: routes, SSE, request context
├── counselle_db/                 # the counselle-db MCP server (own process; imports domain/)
├── skills/                       # SKILL.md files (§15)
├── migrations/                   # Counselle-owned migrations for the counselle.* schema ONLY
├── evals/                        # the ~50-question eval set + runner (§21)
├── frontend/                     # the MVP2 React SPA (§31) — a pure protocol client
├── harness/                      # the throwaway dev chat page (retired in MVP2 — deleted at parity)
└── tests/
```

The `counselle-db` MCP server ships in the same repo (it imports the domain core for normalization) but runs as its own process — already the right shape to split out later if ever needed. The dev harness lives in `harness/` to make its throwaway status physical.

---

## 6. The agent API & event protocol

(ADR 0016.) The service's entire contract with the outside world. Small, versioned, and frontend-agnostic — this is what makes "no frontend in MVP1, full platform later" safe.

**Endpoints (v1):**

| Endpoint | Purpose |
|---|---|
| `POST /v1/sessions` | Create a session → `{session_id}`. Accepts an optional default source-config. |
| `POST /v1/sessions/{id}/messages` | Send a user message (text + per-request source-config override) → **SSE stream** of events. Also how a clarify answer is sent (`in_reply_to` the clarify event) — it resumes the parked graph. |
| `GET /v1/sessions/{id}` | Session metadata + transcript (the platform's chat-history read, working from day one). |
| `GET /v1/health` | Liveness + DB reachability. |

**The event stream.** Every event is `{v: 1, type, data}` — one envelope, every consumer. Types:

| Event | Payload | Notes |
|---|---|---|
| `meta` | trace_id, session_id, model in use | First event of every stream. |
| `delta` | text tokens (with inline citation markers) | The prose. **Visible reasoning steps** (PRD story 52) are realized as prose narration woven into the delta stream (e.g. "Let me check the acceptance rate…") — not a separate step event type. |
| `viz` | a **render spec** (§17) — cells are citation envelopes | Out-of-band: numbers never ride in `delta` tokens. |
| `clarify` | a **clarify spec** (§12.1) | Stream ends `awaiting_input`; client answers via a new message. |
| `sources` | the deduplicated citation list for the turn (official/community, vintages) | Feeds the expandable-marker UX (PRD). |
| `usage` | tokens + estimated cost for the turn (§19) | |
| `done` / `error` | terminal | `error` carries a user-safe message + trace_id. |

*MVP2 adds the additive `step` and `thinking` event types (and extends `done`/`meta`) — see §27.*

**Versioning:** `v` on every event, `/v1` on every route, and a version field inside the render/clarify specs. Additive changes don't bump; breaking changes do. Clients ignore unknown event types (forward compatibility).

**Auth posture:** MVP1 runs with no auth (local/dev). The request context already carries an **optional principal** populated by middleware, so the platform adds an auth middleware + a `user_id` — no route or orchestration changes. We do not build auth now. *Fulfilled in MVP2 (§28).*

---

## 7. Sessions, state & the platform-ready identity model

(ADR 0019.) The classic retrofit pain in chat products is bolting persistent identity onto an in-memory prototype. We avoid it by making the *shape* platform-ready on day one while building none of the platform:

- **Every conversation is a session with a durable `session_id` from day one.** In-session working memory (PRD) *is* the LangGraph state for that session — one mechanism, not two.
- **State persists in Postgres via LangGraph's own Postgres checkpointer**, in Counselle's `counselle.*` schema. Sessions survive restarts; a parked `interrupt()` (clarify question) survives too. No bespoke session store — the checkpointer protocol is the seam, and swapping it (memory in unit tests, Postgres in prod) is configuration.
- **A thin `counselle.sessions` row** (session_id, created_at, **nullable `user_id`** — *populated from MVP2 (§28)*, title, default source-config) fronts the checkpoint data. The platform phase adds a `users` table and starts filling `user_id` — chat history, profiles, and per-user memory attach to rows that already exist. No migration of meaning, only addition.
- **Counselle owns its schema and migration chain** (`migrations/`, over `counselle.*` only — never `public.*`/`raw.*`, which belong to the pipeline and are read-only to us; ADR 0012).
- **Long-term memory & personalization stay out of MVP1** (PRD) — but they will live behind the same session/user rows, which is why those rows exist now.
- **Retention:** sessions are cheap rows; MVP1 sets a configurable TTL/cleanup job knob (§18) and defaults it to "keep everything" until there's a reason not to.

---

## 8. The data-access layer: the `counselle-db` MCP server

A standalone MCP server (Python, asyncpg, read-only `counselle_ro` role). PydanticAI connects natively. Three layers. (ADRs 0004, 0005.)

### Layer 1 — Field discovery
`search_fields(query, filters?)` → relevant fields from the 1,093-field catalog with how-to-read metadata. Static category map + pgvector (§10).

### Layer 2 — Safe typed tools (the 90% path)
Each applies the **normalization engine** + **vintage resolver** (both from `domain/`) and returns **citation envelopes**. They operate on any in-database school; every result carries the school's **coverage tier** (§11).

| Tool | Purpose |
|---|---|
| `resolve_school(name_or_unitid)` | Fuzzy/abbreviation/multi-campus resolution over all 2,746 schools → unitid + basics + coverage tier, or the "not in our database" signal |
| `get_values(unitid, field_keys[])` | Specific fields, normalized + cited |
| `get_dossier(unitid, sections?)` | The wedge: the curated shortlist + programs + diversity in one cited bundle |
| `compare_schools(unitids[], field_keys[])` | N×M matrix of envelopes, per-cell citations |
| `find_schools(criteria)` | Filter/rank across the database |
| `national_benchmark(field_key)` | National distribution for a field (`{median, mean, p25, p75, n}`, normalized for display) — the honest backbone for "is X high?" questions (`DATABASE_GUIDE` §14.4) |
| `get_programs(unitid, cip?)` | Earnings/debt by major (`raw.scorecard_fos`) |
| `get_diversity(unitid)` | Race/sex enrollment (`raw.ipeds_ef2024a`) |

### Layer 3 — Guarded SQL escape hatch (the long tail)
`query_database(sql, params)` — read-only parameterized SQL for arbitrary ranking/filtering/aggregation the typed tools don't cover. Guardrails: the `counselle_ro` role (`GRANT SELECT` only, `default_transaction_read_only`), statement timeout, row cap (all configurable, §18). Raw rows bypass normalization, so the tool exposes helper SQL (`decode_ipeds(...)`, `value_vintage(...)`) and its description states that the reading rules still apply.

### Shared internals (all in `domain/`, used by every tool)

- **Normalization engine** — the reading rules **R1–R12** (`DATABASE_GUIDE` §6 is the spec): decode coded ints via valuesets, ×100 percents, currency with valid negatives, strip int trailing zeros, native bools, title-case CDS enums, fix scheme-less URLs, source preference per concept, NULL/missing → "not available", BBRR range-token detection, FTE ≠ headcount. `(field_key, raw jsonb)` → `(display, raw_numeric, available, unit, decoded_label?)`. **The honesty-critical core — built once, TDD'd hard.**
- **Vintage resolver** — the `DATABASE_GUIDE` §9 provenance query → `{source, vintage_string, caveat}` (e.g. "College Scorecard published Mar 2026; earnings reflect ~2016 entrants").
- **Data calendar** — a small always-available summary derived **live** from `raw.files` + the Scorecard filename + `settings.current_cycle_year`: per source, its vintage and knowledge cutoff. Injected into agent context so the agent knows each source's cutoff *before* it fetches, and routes beyond-cutoff questions to the web. Live-derived → a pipeline re-ingest updates it automatically; never hardcoded. Also exposed as the `get_data_calendar` tool — the server's 10th tool across layers 1–3.

---

## 9. The citation envelope

Every value from every tool comes back in one shape — the single structure that realizes citations + official/community tiering + recency + the visualization data feed. (ADR 0006.)

```jsonc
{
  "field": "admissions.acceptance_rate",
  "label": "Acceptance Rate",
  "display": "3.6%",          // already correct per the reading rules — the agent can't misread it
  "raw": 0.0361,              // numeric, for visualizations
  "available": true,          // false when NULL/missing → "not available", never invented
  "unit": "percent",
  "citation": {
    "source": "scorecard",    // ipeds | scorecard | cds | web | edu | reddit
    "tier": "official",       // official (DB, .edu) | community (Reddit)
    "vintage": "College Scorecard, published Mar 2026",
    "caveat": null,           // e.g. "earnings reflect students who entered ~2016"
    "raw_table": "raw.scorecard_institution"
  }
}
```

- `display` feeds the agent's prose; the agent never re-formats it. `raw` feeds visualizations directly.
- The web/Reddit research layer emits the **same envelope** with the appropriate `tier`, so "cite everything" is "render the envelope you already have."
- The envelope type lives in `domain/` and is versioned with the protocol (§6).

---

## 10. Field discovery (1,093 fields without overwhelm)

Hybrid: compact always-loaded map for the common path + semantic search for the long tail. (ADR 0007.)

- **Static category map** — a few-hundred-token tree of the 17 categories + the curated dossier shortlist (a versioned data asset, §18), always in context.
- **`search_fields`** — pgvector semantic search over the long tail; returns field key + how-to-read metadata.

**Self-healing embeddings (ADR 0008):** `counselle.field_index` (field_key, content_hash, embedding, embed_model_version) is a derived cache of the pipeline's `fields` table. `reconcile_field_index()` hash-diffs and embeds only the delta; runs at startup, on a short cron, and via a manual endpoint. **Fail-safe:** `search_fields` always has a keyword/trigram fallback over the full catalog, so a brand-new field is discoverable the instant it's inserted — embeddings are a precision booster, never the only path. A new field is **never invisible**.

---

## 11. School coverage & the CDS tier (no scope gate)

The agent works on **any school in the `schools` table (2,746)**. (ADR 0002, revised.) What varies is depth, and the agent is **tier-aware** so it sets honest expectations:

- **Base** — IPEDS + Scorecard (≈ all schools; ~98% Scorecard fill). Answers most admissions/cost/aid/outcomes questions.
- **CDS-tracked** — a CDS PDF exists: **extracted** (structured CDS fields — 8 schools today, the deepest tier) or **PDF-only** (downloaded, not yet extracted — e.g. Stanford).

Tier is computed from **actual data presence** (extracted values → extracted; PDF without values → PDF-only; the Stanford trap: `extract_status='done'` ≠ values exist), read **live**, never hardcoded. A school absent from `schools` gets the graceful **"not in our database"** response — the only hard boundary. Honesty by awareness, not exclusion: asked for CDS-only detail on a base-tier school, the agent says it isn't available and falls back to IPEDS/Scorecard.

---

## 12. The agent runtime (PydanticAI + LangGraph)

(ADR 0003.) PydanticAI defines each agent with `model=` from config, native MCP connections, and typed `result_type`s. LangGraph orchestrates: state passing, session persistence via the checkpointer (§7), and `interrupt()` for clarifying questions.

**MVP1 as-built:** only the **counselor** agent is implemented. The **researcher** and **verifier** agents are designed (§13) but not yet built — they are part of the deferred deep-research follow-up (`specs/deep-research/plan.md`). Parallel research subgraphs are also deferred.

### 12.1 Clarifying questions

A clarifying question is the interactive sibling of a visualization: the agent emits a **typed clarify spec**, the API edge streams it as a `clarify` event (§6), a dumb widget renders it — this one just *waits for an answer*. Mechanism: **LangGraph `interrupt()`** — the graph parks (durably, §7) and resumes when the answer arrives as the next message.

```jsonc
{
  "question": "Good for what? A few things shape the answer:",
  "header": "What matters",
  "multiSelect": false,
  "options": [
    { "label": "My intended major",        "hint": "programs, rigor, outcomes in your field" },
    { "label": "Cost & affordability",     "hint": "net price for your situation" },
    { "label": "Campus life & vibe",       "hint": "what it's actually like there" },
    { "label": "My chances of getting in", "hint": "selectivity vs your profile" }
  ]
  // "Other" free-text is ALWAYS rendered by the widget — not the agent's job to add
}
```

**The judgment rule (the part that matters most).** Three behaviors, agent picks:
1. **Clarify** — only when underspecification *materially changes the answer* and there's no sensible default.
2. **Assume + state** — when one reading is clearly likeliest: answer it and say the assumption.
3. **Default** — when a reasonable default exists, just answer.

One focused round, 2–4 options, never an intake form. The chips are a shortcut, not a modal: a typed reply is always treated as the answer. A clarifier that resolves a comparison axis feeds straight into the comparison-table field selection (§17).

---

## 13. The deep-research subsystem (GPT-Researcher)

> **Not yet built — designed, deferred from MVP1.** The graph ships a stub `research` seam. The follow-up plan is `specs/deep-research/plan.md`. The design below is the approved spec for that plan. See ADR 0009 for the GPT-Researcher choice and `docs/research/deep-research-bakeoff.md` for the bake-off.

Embedded as a research subagent inside the LangGraph orchestrator — not adopted wholesale, and **not** a hosted research black box (our DB must be a first-class source; our model routing and source tiering must apply). (ADR 0009; bake-off in `docs/research/deep-research-bakeoff.md`.)

**Cost-optimized configuration (all knobs in §18 — deep-research-only; not yet active in MVP1):** three model tiers — `FAST_LLM`/`STRATEGIC_LLM` → Gemini 2.5 Flash, `SMART_LLM` → Gemini 2.5 Pro, escalatable per question; hard `DEPTH`/`BREADTH`/concurrency caps; documented cost ~$0.08–0.10/task cheap mode, ~$0.50–1.00 deep mode. **DB-first does the heavy lifting:** web research only fills gaps the DB can't answer — a base-tier dossier comes almost entirely from IPEDS/Scorecard with zero web spend.

**What we add (already PRD features):** source-type tagging (each source tags `official`/`community`, carried into citations), the **verification pass** (a cheap post-pass cross-checking the top 2–3 cited sources before stating a fact), and the eval set (§21).

**Search backend = Tavily** (§14) — the same backend as the fast inline tools, so there is exactly one external-search dependency.

---

## 14. External search & source control

(ADR 0015.) All three external searches are **one backend — Tavily — scoped by domain**, as three thin tools. Nothing is scraped by us. The DB is the fourth, always-on source; **DB-first** — search fires only when the DB can't answer or is stale per the data calendar.

| Tool | Scope | Tier |
|---|---|---|
| `search_web(query)` | no domain filter | varies |
| `search_school_site(school, query)` | `include_domains = [the school's stored URL]` — injected by the tool from the DB; the agent only names the school | **official** |
| `search_reddit(query, subreddits)` | `include_domains = [the subreddits the agent picked]` | **community** (never cited as fact) |

**Reddit is agent-steered:** the agent picks subreddit(s) per question from the **labeled menu** (a versioned data asset, §18 — r/ApplyingToCollege for process, r/chanceme, r/financialaid, r/[SchoolName] for campus life, program subs), several in parallel when useful. School subs are best-effort (a wrong guess returns nothing, harmlessly) — no mapping table to maintain.

**Source control (per-request, enforced in code — ADR 0013):** a **source-config object** travels with each request (web on/off; Reddit on/off + per-subreddit allowlist; .edu on/off; DB always on). The orchestrator **builds the toolset from the config**: a disabled source's tool isn't mounted, and GPT-Researcher's retriever list is set from the same config. A disabled source can't be reached and never appears in citations. Three named tools (not one generic) so the dropdown maps 1:1 and the citation tier is unambiguous per tool.

---

## 15. Skills (SKILL.md)

Skills are SKILL.md files (open standard: YAML frontmatter + Markdown body, optional scripts), living in `skills/`. (ADR 0010.) Metadata loads at startup; full instructions load only when triggered (progressive disclosure). Skills are the **workflow** layer; MCP is the **transport** layer — kept separate. Candidate MVP1 skills: dossier assembly, school comparison, deep-research-with-citations, decode-a-coded-value, vintage/citation formatting. Skills are data, not code — editing one never requires a deploy decision beyond shipping the file.

---

## 16. Citations, recency & temporal context, end to end

- **Every fact carries an envelope** (§9); the `tier` field drives the official-vs-community display the PRD requires.
- **Citation UX (resolved in the PRD, 2026-06-10):** lightweight **inline expandable markers** — each claim gets a marker with an official/community chip; expanding reveals source, vintage, caveat. The `sources` event (§6) carries the turn's full deduplicated list.
- **Recency is per-value** (the vintage resolver) plus three always-available temporal facts, none guessed by the model:
  - **Today's date** — injected by the runtime each request.
  - **The data calendar** (§8) — each source's vintage + cutoff, derived live. The agent measures the gap and routes DB-vs-web.
  - **The admission season** — `admission_season(today)` (pure, in `domain/`; the phase table is a data asset) → cycle phase + active entering class. Jun–Jul = list-building/essay prep; Nov = early deadlines; Mar–Apr = decisions; etc.
- **Boundary (KISS):** season awareness is *context*, not a deadline tracker (process management is deferred, PRD). School-specific dates are **data** — CDS fields or live web, fetched and cited like any value, never inferred from the generic calendar.

---

## 17. Visualizations

(ADR 0014.) **MVP1 ships three:** the **dossier stat block**, the **comparison table** (per-cell citations), and the **score-range band** (SAT/ACT middle-50%). Net-price-by-income bars and the factor-weight grid are designed but deferred. The **community card** viz type (for qualitative/Reddit content) is also designed but **not implemented in MVP1** — `RenderSpec.type` accepts only `stat_block | comparison_table | score_band`; community-card support is deferred to the follow-up.

**The provenance boundary (the core rule):** the **LLM decides the shape** (schools, fields, chart type); a **tool fetches the numbers** straight from citation envelopes. **Numbers never round-trip through the LLM's tokens.** Community/qualitative content renders as an explicitly community-tier qualitative card, never a quantified chart. **No trend charts** — the DB holds one vintage per source; a trend line would be fabricated.

**Mechanism:** one tool — `render_viz(type, selection)`, `type ∈ {stat_block, comparison_table, score_band}` — wraps the existing `counselle-db` tools, wraps the envelopes with `type`, and returns a **render spec** that streams to the client as a `viz` event (§6); the LLM receives only an acknowledgment. Dumb client components draw `display` + the tier chip and render `available:false` as "not available"; tables/stat blocks degrade to Markdown where no renderer exists. Placement = tool-call order.

**Field ownership:** stat block & comparison → the LLM picks fields contextually (what matters for *this* chat); score band → fields fixed by the chart definition, the LLM picks only test + schools.

**Accuracy guarantee:** values are always tool-fetched, so the LLM cannot misstate a number. Residual risk = wrong field for the concept, bounded by: only real catalog keys are selectable (`search_fields`/static map), the tool rejects unknown keys, R9 source preference lives in normalization, `available:false` degrades honestly, and the eval set scores field-selection accuracy. No concept→field resolver (low-value-and-hard).

**The score-band honesty trap:** IPEDS SAT percentiles are per *section* and must never be summed into a 1600 composite — render two section bands (or the `sat_average` midpoint), never a fabricated composite. ACT composite percentiles exist directly. The band is the **enrolled cohort's middle-50%, not a cutoff** — the agent teaches that.

---

## 18. Configuration architecture

(ADR 0018.) "Configurable" means **one place per kind of thing**. Three buckets, one policy. *MVP2's configuration delta (new Settings groups + data assets) is §32.*

**1. Typed settings (`config/settings.py`, pydantic-settings).** One `Settings` object, loaded once at startup, **validated fail-fast** (a missing key or malformed value kills boot with a clear error — never a silent default in production paths). Layered: code defaults → `.env` / environment → explicit overrides. Everything deploy- or cost-relevant lives here:

| Group | Knobs |
|---|---|
| Models | per-agent `model=` (counselor / clarifier), provider credentials. *Note: researcher / verifier model knobs and GPT-Researcher's `FAST/STRATEGIC/SMART` tiers are in the Settings surface but not yet active — deep-research only, deferred (§13). LiteLLM sidecar endpoint is in Settings as optional but not deployed in MVP1.* |
| Research | depth, breadth, concurrency, per-tier token caps, per-question cost ceiling. *Deep-research-only — not yet active in MVP1 (§13).* |
| Database | pipeline DSN (`counselle_ro`), statement timeout, row cap, pool sizes |
| Counselle schema | `counselle.*` DSN, checkpointer on/off (memory for tests), session TTL/cleanup |
| Discovery | embedding model + version, reconcile interval |
| Sources | default source-config (web/Reddit/.edu on/off), Tavily key, per-tool result limits |
| API | host/port, CORS origins, SSE keepalive, protocol version |
| Observability | log level, cost-accounting on/off |

**2. Versioned data assets (`config/assets/`).** Things a developer tunes *editorially*, hot-changeable without touching code: **agent prompts** (one file per agent, loaded by name), the **subreddit menu**, the **dossier field shortlist**, the **season calendar table**. Reviewable in diffs, no magic strings in code.

**3. Live-derived from the DB (never configured, never hardcoded).** The data calendar, coverage tiers, the field catalog, `current_cycle_year`, school URLs. These are *facts*, and facts come from the database at runtime.

**What may be hardcoded:** only invariants — the reading rules' logic itself (R1–R12 are the spec, not a preference), the envelope/protocol schemas (versioned, but code), SQL safety (parameterization isn't a setting). The test: *"would a developer ever plausibly want to change this without an architecture discussion?"* If yes → bucket 1 or 2.

---

## 19. Observability & cost accounting

Cheap on day one, brutal to retrofit:

- **Structured logging (structlog)** — JSON logs; a **trace ID** minted per request at the API edge rides through the graph, tools, and research subagent, and is returned in the `meta`/`error` events. Never log secrets (house rule); never log full student messages at INFO.
- **Per-request usage accounting** — every model call's tokens (PydanticAI exposes usage) and Tavily/research calls roll up into the turn's `usage` event and a log line: per-session and per-turn cost visibility from the first day, which is also how the research cost caps get verified in practice.
- **Health** — `GET /v1/health` checks the process + DB reachability; the reconciler and checkpointer report status there.
- Metrics/dashboards are a platform-phase concern; the structured logs are designed so that adding them is aggregation, not re-instrumentation.

---

## 20. Deployment & day-one deployability

MVP1 runs locally, but **nothing may block containerized deployment** — deployability is a property, not a phase. *MVP2's deployment delta (same-origin SPA serving, the amended statelessness clause, entrypoint migrations) is §33.*

- **12-factor:** all config from the environment (§18); the service is **stateless** — every bit of state lives in Postgres (checkpoints, sessions, field_index) — so it can restart, scale, or move at any time.
- **One container** (a `Containerfile` from day one) running the API service; the `counselle-db` MCP server runs as a child process inside it (its own container later if ever needed — the MCP transport already permits it).
- **Migrations** (`migrations/`) run on deploy against `counselle.*` only.
- **Secrets** in `.env`/secret manager only; shared with the pipeline **credentials only** (the read-only DSN + Vertex/GCP keys) — no shared code, config, or runtime dependency. The DB is the contract.
- **Read-only role `counselle_ro`** — `GRANT SELECT` on `public.*` + the needed `raw.*` tables; `default_transaction_read_only`; statement timeout. Never the pipeline's write role. (ADR 0012.) A read replica is a later optimization.

---

## 21. Testing strategy

(Per the PRD: test where lying to a student is possible; skip ceremony elsewhere. Behavior, not implementation.)

- **The domain core is the test surface.** The normalization engine gets the full TDD treatment with `DATABASE_GUIDE` §6 as its spec — every reading rule R1–R12 has behavioral tests (fraction→percent, coded-int decode vs passthrough, NULL/missing → "not available", negative currency, range tokens never arithmetic'd, FTE≠headcount, URL fixing, benchmark fields never school values, vintage attached). Pure functions → trivial to test, no mocks.
- **The eval set (`evals/`)** — ~50 university questions with known answers, scoring citation accuracy, field-selection accuracy, and clarify-vs-assume judgment. An engineering tool, no numeric launch gate (PRD).
- **Runtime schema validation is the contract enforcement** — the typed specs (envelope, render, clarify, events) validate at runtime via Pydantic; no separate golden/contract-test machinery in MVP1 (deliberately dropped as enterprise-ish).
- **No UI tests** — the harness is not the product.
- The layering (§4) is what keeps this strategy cheap: the honesty core needs no LLM, no DB, no network to test.

---

## 22. Feature → component traceability

| PRD feature | Component(s) |
|---|---|
| DB access (full power, 1,093 fields, no overwhelm) | `counselle-db` 3 layers + field discovery (§8, §10) |
| Web / Reddit / .edu search | Tavily, 3 domain-scoped tools; Reddit agent-steered (§14) |
| Source-control dropdown | per-request source-config gating the toolset (§14) |
| Deep research + verification | GPT-Researcher subagent + verification pass (§13) |
| Citations (official vs community) | citation envelope `tier` (§9); `sources` event (§6) |
| Citation UX (inline expandable markers) | `delta` markers + `sources` event; client renders (§6, §16) |
| Recency & temporal awareness | vintage resolver + data calendar + injected date + `admission_season` (§8, §16) |
| Clarifying questions | `interrupt()` + clarify spec → `clarify` event (§12.1) |
| In-session working memory | LangGraph state via Postgres checkpointer (§7) |
| Skills | SKILL.md in `skills/` (§15) |
| Visualizations | `render_viz` → render spec → `viz` event → dumb components (§17) |
| Model configurability | per-agent `model=` from Settings (§18) |
| School coverage / CDS tier | tier-aware data layer; in-DB-or-not boundary (§11) |
| Honesty / no-misread | normalization engine in `domain/` (§8, §21) |
| Minimal MVP1 surface | `harness/` dev chat consuming the same protocol (§2, §6) |
| Future platform (chats, users, profiles) | API-first protocol (§6) + platform-ready sessions (§7) + evolution path (§23) |

---

## 23. The platform evolution path

What the platform phase adds, and why it's additive rather than rework:

| Platform feature | What MVP1 already provides | What gets added |
|---|---|---|
| User accounts & auth | optional principal in the request context (§6) | auth middleware, `counselle.users`, fill `sessions.user_id` — **landed in MVP2 (§28)** |
| Persistent chat history | durable sessions + transcript read (§6, §7) | list/search/rename UI; pagination — **landed in MVP2 (§29)** |
| User profiles & personalization | sessions keyed for a user FK; deferred by PRD | profile store; profile context injection |
| Long-term memory | the checkpointer layer is the same seam | a memory store + retrieval policy |
| Chancing | the chancing *knowledge* already cited (PRD) | the personal math on top of the same envelopes |
| Real frontend (web/mobile) | the versioned event protocol (§6) | the apps — pure clients — **landed in MVP2 (§31, web)** |
| Scale-out | stateless service; state in Postgres (§20) | replicas behind a load balancer; read replica if needed |
| Phase-2 perf | designed-for: materialized dossier table, research caching per (school, question-type, DB-snapshot), embeddings at scale | build when measured-slow, not before |

The discipline: **every platform feature lands as new adapters/rows/clients against existing seams.** If one ever requires changing the domain core or breaking the protocol's v1 semantics, that's the signal to stop and re-architect deliberately (and write the ADR).

---

## 24. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **PydanticAI pre/early-v2 API churn** (biggest stack risk) | Pin versions; agent definitions are already thin (config-driven `model=`, typed outputs) so migration is localized to `app/`; verify exact APIs at build time. |
| Protocol churn breaking clients | `v` on every event/route; additive-only within v1; clients ignore unknown events. |
| Agent misreads raw values via the SQL escape hatch | Normalization is the default path; escape hatch exposes decode/vintage helpers + "rules still apply" note; eval set watches. |
| Deep-research cost blowup (unbounded school count) | DB-first + depth/breadth caps + cheap-model tiers + per-question cost ceiling (§18) + usage accounting making spend visible per turn (§19). |
| GPT-Researcher has no published citation-accuracy benchmark | The ~50-question eval set, measured before launch. |
| CDS sparsity → thin dossiers for most schools | Tier awareness + IPEDS/Scorecard fallback; the agent says what isn't available (§11). |
| Checkpoint/session data growth | Configurable TTL/cleanup (§7, §18); rows are cheap until they aren't — knob exists from day one. |
| Pipeline re-ingest changes counts/vintages | Everything derived live (calendar, tiers, catalog, embeddings reconcile); `DATABASE_GUIDE` is snapshot-dated — re-verify on re-ingest. |
| Config sprawl / drift | One `Settings` surface, fail-fast validation, `.env.example` as the documented inventory (§18). |

---

## 25. Open questions

- **Exact PydanticAI / LangGraph / GPT-Researcher / checkpointer package APIs & versions** — confirm at build time (pin everything).
- **Migration tool for `counselle.*`** (alembic vs yoyo like the pipeline) — pick at build time; the decision is contained to `migrations/`.
- **Tavily Reddit scoping** — confirm `reddit.com/r/<sub>` domain scoping quality (vs needing the Reddit API), and finalize the default subreddit menu asset.
- **Eval harness design** — the ~50-question set (citation accuracy, field-selection accuracy, clarify judgment); how scores are tracked over time.
- **SSE vs WebSocket** — *resolved in MVP2: SSE kept; resume via `Last-Event-ID` over the turn registry (§27.3); cancel is a plain HTTP POST.*

---

# Part II — MVP2: the full-stack app

## 26. MVP2: the shape of the full-stack app

MVP1 was built API-first precisely so this step would be additive (Part I, §23): the optional principal in the request context, the nullable `user_id` on sessions, the additive-within-v1 event protocol, and the client-agnostic API were all reserved seams. MVP2 lands on them. **Nothing in MVP2 touches `domain/`** — the honesty core ships as-is. *Amended at B0 (2026-06-12): the one sanctioned `domain/` delta is the additive event types — `StepData`/`ThinkingData`, the `cancelled` status on `done`, and the message ids on `meta` (`domain/events.py`, §27.7). The honesty core's logic is untouched; anything beyond this carve-out still stops for an ADR.*

```
              ┌──────────────────────────────────┐   ┌──────────────────────┐
   browser    │  Counselle web app  (frontend/)  │   │  marketing landing   │
              │  React SPA — LibreChat-cloned    │   │  page (one static    │
              │  parts + Counselle components    │   │  file, served at /)  │
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

**The MVP2 principles (deltas to Part I, §1):**

1. **Still one backend deployable.** No second service, no BFF, no gateway, no Redis, no message bus. Auth is `api/`-layer middleware and routes; chat CRUD is routes over rows that already exist (ADR 0019); rate limiting is middleware. The dependency rule (ADR 0017) absorbs all of it.
2. **Every addition lands on a reserved seam.** Auth fills the optional principal (Part I, §6). Chat history reads rows the checkpointer already writes (Part I, §7). New event types ride the additive-within-v1 rule (Part I, §6). If an MVP2 feature ever requires changing `domain/` or breaking v1 semantics — stop and write the ADR (the Part I, §23 discipline).
3. **The frontend is a pure client.** It speaks only the versioned protocol. The service still doesn't know or care what renders it; the dev harness keeps working unmodified until deleted.
4. **Clone, don't design.** The UI's design system and core chat components are cloned from LibreChat (MIT) — tokens wholesale, components vendored (§31, ADR 0020). We design only what LibreChat doesn't have: the honesty surfaces (timeline, cards, citations, clarify).
5. **Same origin, one container.** The SPA and the landing page are served by the FastAPI service (§33, ADR 0023) — no CORS, trivial cookie auth, one TLS cert, one deploy.

**Retirement:** `harness/` is deleted once `frontend/` reaches feature parity (it was built to die — Part I, §5). Until then it stays as the protocol's second client and a useful regression check that v1 stayed additive.

**Seam reality check (verified against the code, 2026-06-11):** several things this plan needs already exist in MVP1 and must not be re-specified as new work — the SSE `id:` field on every event (`api/sse.py`), `sessions.updated_at` + the per-turn touch (`migrations/0001_sessions.sql`, `app/sessions.py`), the in-process single-flight guard (`api/routes/sessions.py`), the unvalidated-principal seam (`api/context.py`), the `Containerfile` (single-stage today), `.env.example`, and the yoyo migration chain. The genuinely new machinery is: the **turn registry** (§27.3), step/thinking emission (§27.1–27.2), auth, the chat-management routes, and the frontend.

---

## 27. Protocol extensions: work visibility, resume & cancel

(ADR 0022.) All changes are **additive within v1** — `v` stays 1, existing clients (the harness) ignore unknown event types by design (Part I, §6). This section is the single biggest enabler of the PRD's chat experience: today's protocol has no granular work visibility.

### 27.1 New event: `step`

Start/end pair per unit of agent work. The activity timeline renders these directly.

```jsonc
// status: "start"
{ "v": 1, "type": "step", "data": {
    "step_id": "s3",                  // unique within the turn; pairs start/end
    "status": "start",                // start | end | error
    "kind": "web_search",             // db_tool | sql | web_search | edu_search |
                                      // reddit_search | viz | skill | research
    "label": "Searching the web: nyu cs acceptance rate 2026",  // human label, pre-built server-side
    "tier": "official",               // official | community | null — drives the icon/color grammar
    "detail": null
}}

// status: "end" — same step_id, carries the receipts (PRD story 15)
{ "v": 1, "type": "step", "data": {
    "step_id": "s3", "status": "end", "kind": "web_search",
    "label": "Searching the web: nyu cs acceptance rate 2026", "tier": "official",
    "detail": {                       // kind-specific; the expandable receipt
      "query": "nyu cs acceptance rate 2026",
      "domains": ["niche.com", "usnews.com"],
      "result_count": 5,
      "duration_ms": 1840
      // db_tool/sql kinds instead carry: tool, field_keys[], row_count
      // viz kind carries: viz_type, schools[]
    }
}}
```

- **Emission seam (a named build-time gate):** the preferred path is PydanticAI's native streamed-run tool events surfaced through the graph's custom stream — the stack's own seam (Part I, §1 principle 2). **Verify at build time** that the pinned pydantic-ai emits tool-call start/result events from `run_stream_events()`: today `app/agent_node.py` consumes only `PartStart`/`PartDelta`/`AgentRunResult` events, so this is assumed, not proven. **Decided fallback order if it doesn't:** seams we already own — the MCP `process_tool_call` hook (where `annotate_mcp_result` already sits) sees every `counselle-db` call, and the Tavily / `render_viz` / skill tools are our own functions. Either way, **no hand-wrapping of tools** (ADR 0017).
- **The step mapper is a named module, not route code:** a pure function — tool-call info in, `{kind, tier, label}` out — using the label templates. Today the graph→event translation sits inline in the route's stream generator (`api/routes/sessions.py`); MVP2 must not pile step mapping, thinking routing, and templating into that closure. The route generator stays a dumb encode-and-yield loop; the mapper is table-driven-testable with zero mocks (§34).
- **Labels are editorial:** built from templates in a new data asset `config/assets/step_labels.yaml` (per `kind`, with arg interpolation — "Querying the database: {category} fields", "Checking r/{subreddit}"). Changing the product voice never touches code (ADR 0018 bucket 2).
- **Steps persist (PRD stories 15–16, decision 5):** at turn end, the turn's **step record** — steps with their receipts, the thinking lines (§27.2), and the derived one-line receipt — is written into the graph state alongside the messages. No new storage: the checkpointer already holds that state. The transcript read returns it per assistant message (§27.5). Without this, "expandable forever" and the collapsed receipt on old chats would be a lie — the timeline would exist only as ephemeral stream events.
- **Source-control enforcement is visible for free** (PRD story 17): a disabled source's tool isn't mounted (ADR 0013), so its `kind` *cannot* appear in the timeline. No new enforcement needed — the existing mechanism becomes user-visible.
- **`research` kind is reserved, unused in MVP2** — the deep-research follow-up emits its phases through the same event (PRD story 52's "UI room reserved").
- **Receipts never leak secrets:** `detail` carries queries, domains, counts, field keys — never DSNs, raw SQL parameters beyond the statement, or credentials (house rule).

### 27.2 New event: `thinking`

```jsonc
{ "v": 1, "type": "thinking", "data": { "text": "The database covers admissions, but this year's deadline needs the live site." } }
```

Short reasoning summaries interleaved in the timeline (PRD story 14). **Realization (KISS):** MVP1 realized "visible reasoning" as prose narration woven into `delta` (Part I, §6). MVP2 reroutes the model's *interstitial* text — the text PydanticAI emits between tool calls — into `thinking` events; only final-answer text rides `delta`. No second model call, no summarizer. One honesty rule, prompt-enforced and eval-watched: facts and numbers never appear *first* in `thinking` — it narrates intent, not findings. Thinking lines persist in the turn's step record (§27.1), so revisited chats keep them under the expanded receipt. If dogfooding shows interstitial narration is too sparse, the fallback is a cheap-tier summarizer per step (decide then, not now — §35).

**Routing decided (B0 spike 2, 2026-06-12):** the delta/thinking splitter is a per-model-response **threshold buffer** with `PartEndEvent.next_part_kind` as the deterministic flush signal — a `TextPart` ending with `next_part_kind='tool-call'` while under the threshold (~240 chars) flushes as `thinking`; crossing the threshold mid-part flushes as `delta` and streams live thereafter; response end flushes as `delta`; the buffer resets per response (measured latency cost ≈ 0). Alongside the rerouted pre-tool text, **native Gemini thought summaries are adopted**: `include_thoughts` surfaces `ThinkingPart`/`ThinkingPartDelta`, mapped to `thinking` events as a second feed — real reasoning that cuts visible dead air from ~28s to ~16s on tool-using questions. Settings-gated (`thinking_summaries`, default on); the facts-first risk is carried by the eval set's mechanical digit check (§34).

### 27.3 The turn registry (one module owns the turn lifecycle)

**The load-bearing structural change in the backend delta.** Today the turn *is* the request-handler coroutine: `api/routes/sessions.py` runs `run_turn()` inside the SSE response generator, and the single-flight guard is a bare `set` on `app.state`. In that shape, a client disconnect (an F5!) cancels the coroutine and **kills the turn** — refresh-proof streams (PRD story 39) are impossible — and cancel/reattach would be different routes with no shared object to act on.

MVP2 introduces **one deep module — the turn registry** (`app/turns.py`) — that owns the whole lifecycle:

- **Turns run as detached asyncio tasks** that outlive any HTTP request. Per session the registry holds: the running task, the **ring buffer** of emitted events (size in Settings), the **single-flight lock**, and the **cancel handle**. A disconnected client costs the turn nothing.
- **Interface (the endpoints become thin callers):** `start(session_id, message, …)`, `attach(session_id, last_event_id) → event iterator`, `cancel(session_id)`, `is_generating(session_id)`.
- `POST .../messages` = start + attach. **New endpoint `GET /v1/sessions/{id}/stream`** = attach from `Last-Event-ID` — replay the buffer tail, then live to `done`. (Every event already carries the SSE `id:` field — implemented in MVP1, `api/sse.py`; the buffer and reattach are the new parts.) No active turn in this process → `204 No Content` → the client falls back to the **transcript read** (§27.5).
- **Single-writer rule** (PRD story 40): a second `POST .../messages` while a turn is active → `409 {error: "stream_active"}` (the existing guard moves into the registry). "Send mid-stream re-asks" is client-orchestrated: cancel → await `done` → send. The sessions list (§29) reads `is_generating` from the registry for the cross-tab indicator.
- **The buffer is best-effort UX; persisted state is the correctness guarantee** — prose in the checkpointer, the step record in the graph state (§27.1). A deploy mid-turn loses the buffer, not the chat. No Redis, no event store.
- **Every piece of single-instance state lives inside this one module** — §33's scale-out story becomes "re-back the turn registry", not a hunt across route handlers. Deletion test: removing the registry would smear task ownership, buffering, locking, and cancellation across four route handlers — it concentrates complexity, so it earns its keep.

### 27.4 Cancel

- **New endpoint: `POST /v1/sessions/{id}/cancel`** — the registry cancels the detached task via asyncio cancellation at the graph boundary. The stream terminates with `done`; partial prose persists (the student keeps what streamed).
- **`done.data.status` gains `cancelled`** — extending the *existing* enum (`complete | awaiting_input` today, `domain/events.py`) rather than introducing a parallel `stop_reason` field. Additive within v1. The composer's send⇄stop swap (PRD story 38) is cancel + this field.
- *Full cancel semantics (idle / parked / racing completion / watchdog) are recorded in §27.7 (G5).*

### 27.5 The transcript contract

The transcript read (`GET /v1/sessions/{id}`) today returns user/assistant text pairs reconstructed from graph state. MVP2 extends it — per assistant message — with the persisted **step record** (§27.1): steps with receipts, thinking lines, and the one-line receipt. This is the typed contract the frontend's turn reducer consumes (§31.4); it's what lets old chats render the collapsed receipt by default (PRD decision 5), keeps receipts "expandable forever" (story 16), and gives the resume fallback full fidelity. Turns from before MVP2 simply have no step record — the renderer shows prose only.

*Superseded at B0: the step record grows into the full **turn record** — §27.7 (G2) — which carries everything a full-fidelity transcript needs, not just steps.*

### 27.6 New/changed endpoints summary

| Endpoint | Purpose |
|---|---|
| `GET /v1/sessions` | List + title search (owner's sessions) — §29 |
| `PATCH /v1/sessions/{id}` | Rename — §29 |
| `DELETE /v1/sessions/{id}` | Delete chat (+ its checkpoints) — §29 |
| `GET /v1/sessions/{id}/stream` | Reattach to an in-flight turn (Last-Event-ID) — §27.3 |
| `POST /v1/sessions/{id}/cancel` | Stop the active turn — §27.4 |
| `POST /v1/sessions/{id}/messages/{message_id}/feedback` | Thumbs up/down — §30 |
| `POST /v1/auth/*` | fastapi-users routers (register, login, logout, forgot/reset, Google OAuth) — §28 |
| `GET/PATCH/DELETE /v1/me` | Account read/update/delete; `DELETE /v1/me/chats` for delete-all — §28 |
| `GET /v1/config` | Runtime client config: starter chips, greeting, default source-config — §32 |

All existing v1 endpoints keep their exact semantics; `POST /v1/sessions` and `POST .../messages` now require auth and stamp `user_id`.

### 27.7 Turn identity, the turn record & lifecycle semantics (resolved at B0, 2026-06-12)

Five spec gaps surfaced in the ship-plan review are resolved here as architecture (ADR 0022 carries the decision trail). The field-level FE↔BE contract that realizes these on the wire is **the wire contract** (B0 spike 4, `specs/mvp2/plan/wire-contract.md`, archived with the MVP2 plan).

- **Message identity (G1).** Every turn mints two UUIDs at start — `user_message_id` and `message_id` (the assistant message). Both ride `meta.data` (additive within v1 — the live stream can address the in-flight message for feedback/edit) and persist in the turn record. Feedback keys on the globally-unique assistant `message_id`. A clarify resume **reuses the parked turn's `message_id`** — one assistant message, one id, however many park/resume cycles produced it.
- **The turn record (G2 — supersedes §27.5's step record).** Per assistant turn, persisted in graph state: the G1 ids; ordered `parts[]` — text and viz at emission offsets (offsets into the streamed prose, never duplicated text); steps + receipts; thinking lines; the one-line receipt; the sources payload; usage; terminal status (plus the error payload when status is `error`); the clarify record (spec + answer/unanswered); timestamps; and `messages_offset` — the graph-state slice point for history rewrite (server-internal, never on the wire). Because `parts[]` is offsets, one prose invariant holds everywhere: **every terminal path (complete, cancelled, error, tool-budget) leaves `messages` carrying exactly the prose that streamed.** The transcript read returns the consumer-contract wire shape; pre-MVP2 turns have no record and render prose-only.
- **Edit & regenerate = history rewrite (G3).** `POST /v1/sessions/{id}/messages` gains optional `replace_message_id` (a prior `user_message_id`): with the single-flight lock held and no active turn, one `aupdate_state` rewrite — messages sliced at the target turn's `messages_offset`, turn records truncated, the source registry restored from the last surviving record's cumulative snapshot, any pending interrupt cleared (per G4) — then the new text runs as a normal turn. **Regenerate = edit of the last user message with the same text** — one mechanism. Pre-MVP2 turns have no `user_message_id` and **cannot be edit targets** (`422`; the FE hides Edit on id-less entries) — the rewrite never slices into record-less history; synthesized clarify-answer entries are likewise refused (`422`, by an explicit synthesized flag, not id-absence).
- **The clarify-park lifecycle (G4).** `interrupt()` ends the turn — `done(awaiting_input)`, the task completes, the lock releases; **no parked task exists**, so the answering POST is never 409'd and cancel-on-parked is a no-op + **unpark** (clear the interrupt; freeze the clarify as *unanswered*). A plain next message remains the answer. The answered case persists: the answer rides `Command(resume=text)` and never enters `messages`, so the resumed turn's record stores it alongside the spec, and the transcript read synthesizes the student's answer bubble from it — a first-class, feedback-anchorable entry carrying the resume's `user_message_id` (but not an edit target, per G3). **Mechanics, amended by B0 spike 1:** writing the parked turn record via `aupdate_state` while the interrupt is pending works, and `Command(resume)` survives it — but the write clears `tasks[*].interrupts`, so **parked-detection reads the turn record itself** (last record `status == "awaiting_input"`), never the interrupts; **unpark = `aupdate_state(..., as_node="agent")`** (clears the interrupt and `next`; the next plain message runs a complete fresh turn). Resume-replay: LangGraph re-executes the node — pre-clarify tools re-run and re-stream as fresh steps in the answering turn; shown as-is (the work *is* re-done), and the resumed run's record **replaces** the parked record, same `message_id` (ADR 0022's consequences).
- **Cancel semantics (G5).** Active turn → `202` + a single-shot `done(cancelled)`; idle → `204` no-op; parked → `204` + unpark. Cancel racing completion = the idle no-op. **A watchdog timeout terminates with `error`, not `done(cancelled)`** — the student didn't press stop.

---

## 28. Identity & auth

(ADR 0021.) The moment ADR 0016's "optional principal" and ADR 0019's "nullable `user_id`" stop being optional and nullable in practice. Scope is exactly the PRD's decision 6: email + password, Google OAuth, password reset — no email-verification ceremony, no 2FA, no profile wizard.

- **Library: `fastapi-users`** (+ `httpx-oauth` for Google). Battle-tested registration/login/logout/forgot-password/reset-password routers, password hashing, and OAuth association — never hand-roll auth (house principle 2). Mounted under `/v1/auth/*`.
- **Token transport: JWT in an httpOnly, `Secure`, `SameSite=Lax` cookie.** The deciding constraint is SSE: `EventSource` cannot set an `Authorization` header, but cookies ride along free on same-origin requests — and the SPA *is* same-origin (§33). One transport for REST and streams, zero token-juggling in the client.
- **CSRF posture:** `SameSite=Lax` + the API is JSON-only (no form-encoded state changes, content-type enforced). That combination is the standard mitigation; no CSRF-token machinery in MVP2. Revisit only if the app is ever embedded cross-origin.
- **Google OAuth:** fastapi-users' OAuth router with `GoogleOAuth2`; accounts link by email (a Google sign-in with an existing email attaches to that user). Signup collects name + email only (PRD story 4).
- **Reset emails:** a thin `adapters/email.py` seam — provider (`smtp | resend | console`) + credentials in Settings; templates are data assets. `console` is the dev default (prints the reset link to logs).
- **Schema delta** (own migration chain, `counselle.*` only — ADR 0019): `counselle.users` (fastapi-users base columns: `id uuid`, `email` unique, `hashed_password` nullable for OAuth-only accounts, `is_active`; plus `name`, `created_at`, `settings jsonb` for theme + default source-config preset) and `counselle.oauth_accounts`. `sessions.user_id` gets its FK and a NOT NULL constraint *for new rows* (enforced in code; old dev rows are deleted, not migrated — they're disposable).
- **The principal:** the auth dependency populates the existing request-context principal (`api/context.py` already parses-but-ignores it — the seam is sitting there) — exactly as Part I, §6 promised, **no route-shape or orchestration changes**.
- **Ownership is one dependency, not per-route code:** a single FastAPI dependency — `owned_session(session_id, principal)` — resolves principal → session row → ownership and raises uniformly; a foreign or unknown session returns **404, not 403** (don't leak existence). Every `/v1/sessions/*` route takes it as a parameter, so the authz rule has one home and one test suite — a route can't half-forget it, and a route-inventory test (§34) catches forgetting it entirely.
- **Data controls (PRD story 49):** `DELETE /v1/me/chats` (all sessions + checkpoints) and `DELETE /v1/me` (account + cascade). Confirm-gated in the client.
- **Settings storage:** the thin MVP2 settings (theme, default source-config preset) live in `users.settings jsonb` — no separate table for three fields (KISS). Name/email/password/Google live on the user row and the fastapi-users flows.

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

**Feedback (PRD story 22):** `POST /v1/sessions/{id}/messages/{message_id}/feedback` with `{rating: "up" | "down"}` → upsert into `counselle.feedback` (`id, user_id, session_id, message_id, rating, created_at`) — idempotent per (user, message), re-tapping toggles. Feedback is an engineering instrument: the eval workflow reads this table (an export script in `evals/`, not a pipeline) to source regression questions from real thumbs-downs. Reason chips are MVP3 (PRD).

**Rate limiting (PRD story 50):** MVP2 is the first time strangers can spend the Gemini/Tavily budget.

- **Per-user, in-process sliding-window counters**, keyed by `user_id`, applied to the message-send route only — the only expensive route; reads are not limited.
- Knobs in Settings: `turns_per_hour`, `turns_per_day`. Exceeded → `429` with `Retry-After`; the client shows a plain generic message (the designed limit UX is MVP3, per the PRD gap pass).
- In-memory is *correct* at one instance (§33). The knobs living in Settings is what makes a shared backend (Redis/Postgres) a swap, not a rework — when scale-out happens, not before. ~30 lines of code; no limiter framework needed.
- **Per-user spend visibility for free:** the existing `turn_complete` log line (`api/routes/sessions.py`) already carries session, trace, tokens, duration, and estimated cost — MVP2 adds `user_id` to it. Per-user cost accounting from day one is then log aggregation (Part I, §19's design intent), not new machinery.

---

## 31. The frontend

(ADR 0020.) The PRD's centerpiece. The strategy in one line: **LibreChat is the castle; we build a house from its bricks** — clone the design system and the chat-commodity components exactly, leave their product's parts, and build the Counselle-only components in the same visual language.

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
3. **Build the Counselle-native components in their visual language.** These don't exist in LibreChat, so we write them — using *only* the cloned tokens, their Radix primitives, their spacing/radius scale, their motion timings: the **activity timeline** (steps, thinking lines, shimmer, collapse-to-receipt), the **dossier stat block**, the **comparison table**, the **score band**, **citation chips + anchored popovers**, the **sources footer**, the **clarify widget** (chips + freeze-to-record), the **"not in our database" card**, and the designed **"not available"** muted state. This is where the PRD's design laws get implemented (CLS ≈ 0 via pre-sized skeletons, tabular numerals, 68ch measure, no winner-highlighting).
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
    ├── api/                      # THE protocol client: fetch wrapper, SSE parser, event types
    ├── state/                    # jotai atoms: drafts, per-chat source-config, ui bits
    ├── routes/                   # login / signup / reset / app shell / c/:sessionId
    └── hooks/
```

`frontend/` joins the monorepo as a sibling of `harness/` — it's a pure client like everything else (Part I principle 3). House rules apply (files <800 lines, organize by feature).

### 31.4 State & data rules

- **TanStack Query owns server state** (me, sessions list, transcript, runtime config). **Jotai owns the small client state** (composer drafts, per-chat source-config, open popover, theme). **The URL owns which chat** (`/c/:sessionId`). Server state is never duplicated into client stores.
- **`src/api/` is the only module that knows the protocol.** A typed event union mirroring the `domain/` spec types; a fetch-streaming SSE parser (`POST` streams can't use `EventSource`; the same parser serves the reattach `GET`); cookie auth means zero token handling. Two forward-compatibility rules live here and nowhere else: **unknown event type → ignored; unknown render-spec type → markdown fallback** (the degrade rule, PRD story 35).
- **The turn reducer is a named pure module** (`src/api/turn-reducer.ts`): protocol events in → turn view-state out (the append-only block list, the accumulated steps/thinking, skeleton placeholders, the derived receipt) — **no React imports**. Components are dumb draws over its output. Most of §31.5's smoothness laws *are* reducer logic; scattered through components they'd be untestable, and this is exactly where lying-to-a-student rendering bugs would live. It also reduces the persisted step record from the transcript contract (§27.5), so live streams and revisited chats render through one code path. Tested against the backend's exported protocol fixtures (§34).
- **Composer drafts persist to localStorage per session** (PRD story 41); a failed send keeps the text in the composer with inline retry.

### 31.5 The turn pipeline (how the smoothness laws are implemented)

| PRD law / story | Mechanism |
|---|---|
| 0ms echo, question pins to top (11) | Optimistic append in the send mutation; one programmatic scroll; answer fills downward — no bottom-chasing autoscroll |
| Activity <300ms, never silent (12, 36) | `step`/`thinking` events render the live timeline; SSE keepalives bound dead air |
| Streaming prose, no flicker (18) | Append-only markdown **block list** — completed blocks are memoized and never re-render; only the open block re-parses; soft caret at the stream edge |
| Citation chips materialize inline (19) | Marker syntax in `delta` → chip component via the markdown renderer, resolved against the `sources` event |
| Cards inline, CLS ≈ 0 (20, 43) | The announcing `step` triggers a skeleton **sized from the render-spec shape** (type + row/column counts) before data; fill with ~200ms fade; text above never reflows |
| Collapse to receipt (16) | The turn reducer derives the receipt from accumulated `steps[]` at `done`; old chats render it from the persisted step record (§27.5, PRD decision 5) |
| Scroll always wins (37) | User scroll detaches the view; "↓ Latest" pill; completion never yanks the viewport |
| Stop / re-ask (38) | Send⇄stop button on `is_generating`/`done.status`; cancel-then-send orchestration (§27.4) |
| F5-proof (39) | Reattach via `GET .../stream` + Last-Event-ID against the turn registry; 204 → transcript fetch (§27.3, §27.5) |
| Long chats at 60fps (42) | Virtualized message list; lazily mounted cards; per-chat scroll restoration |
| Reduced motion (44) | `prefers-reduced-motion` kills shimmer/transitions globally |

### 31.6 The landing page

One static HTML file (no framework, no build step) served at `/` for logged-out visitors — what Counselle is, one dossier screenshot, a signup CTA (PRD decision 2). Logged-in users are redirected into the app. Copy lives in the file; it's one page, not a CMS.

---

## 32. MVP2 configuration delta

(Extends Part I, §18 — same three buckets, same test.)

**Settings groups added:**

| Group | Knobs |
|---|---|
| Auth | JWT secret + TTL, cookie name/flags, Google client id/secret, reset-token TTL |
| Email | provider (`smtp \| resend \| console`), credentials, from-address |
| Rate limit | `turns_per_hour`, `turns_per_day` |
| Chat | title model (cheap tier), title max length |
| Streaming | resume ring-buffer size, reattach on/off |
| Frontend | static bundle dir, serve on/off (off in dev — Vite proxies `/v1`) |

**Data assets added (`config/assets/`):** `starter_prompts.yaml` (the home-screen chips, one per signature capability), `greeting_templates.yaml` (keyed by `admission_season` phase — the season-aware greeting reuses Part I, §16's machinery), `step_labels.yaml` (§27.1), the title prompt, email templates.

**`GET /v1/config`** serves the client-relevant assets at runtime (starter chips, greeting for today's season, default source-config) — editorial changes ship without a frontend rebuild, and the greeting derives from the same season function the agent uses (one mechanism, never two).

---

## 33. MVP2 deployment

(ADR 0023; extends Part I, §20 — deployability remains a property, not a phase.)

- **Still one container.** The existing single-stage `Containerfile` becomes multi-stage: stage 1 (node) builds the Vite bundle; stage 2 is the existing Python image with the bundle mounted via FastAPI `StaticFiles` and the static landing page at `/`. `/v1/*` is the API; everything else falls through to the SPA (client-side routing).
- **Same origin is the load-bearing choice:** no CORS configuration, cookie auth trivially secure (no third-party-cookie pain), SSE auth just works, one TLS cert, one deploy target (any VPS / Fly / Railway, day one). Splitting the SPA to a CDN later is a config change, not an architecture change.
- **Dev parity:** Vite dev server proxies `/v1` → `localhost:8000`, so the same-origin posture (and cookie behavior) holds in development with HMR.
- **The statelessness clause, amended honestly:** the service remains stateless **except for two named owners of in-process, best-effort state** — the **turn registry** (§27.3: detached tasks, ring buffers, stream locks, cancel handles) and the **rate-limit counters** (§30). Each degrades gracefully on restart (transcript catch-up / lock vanishes with its turn / counters reset). **One instance is the documented MVP2 posture.** Scale-out beyond one instance means re-backing exactly these two — a contained, known job, deliberately not done now.
- **SSE through proxies:** streaming responses set `X-Accel-Buffering: no` and rely on the protocol's keepalives (both already implemented — `api/sse.py`); verify behavior on the chosen host at deploy time.
- **Migrations on deploy get a real mechanism:** the container entrypoint runs `yoyo apply` against `counselle.*` before exec'ing uvicorn. (Today the yoyo chain exists but nothing runs it automatically — boot assumes the schema is current.) New migrations: users, oauth_accounts, feedback.

---

## 34. MVP2 testing strategy

(The Part I, §21 philosophy carries: **test where lying to a student is possible**; behavior, not implementation. The PRD deferred UI-testing scope to this pass — here it is.)

- **The turn registry is the new deep-module test surface** — unit-tested with a fake event source, no HTTP: client disconnect leaves the detached turn running; reattach replays exactly from `Last-Event-ID`; cancel persists partial prose and emits `done.status = cancelled`; double-send → 409; buffer overflow degrades to transcript fallback. The existing parked-interrupt durability regression extends to mid-stream reconnect.
- **The step mapper is table-driven:** tool-call fixture in → `{kind, tier, label}` out, one row per tool — zero mocks, the labels asset exercised directly.
- **Backend delta — routine pytest, no live LLM:** auth flows + the `owned_session` dependency (foreign session → 404; plus a route-inventory test asserting every `/v1/sessions/*` route declares it), rate-limit behavior (429 + Retry-After + window reset), step persistence (the step record survives into the transcript read), **disabled source ⇒ its step kind cannot appear** (story 17's test), feedback idempotency, auto-title failure never blocks a turn.
- **Shared protocol fixtures are the contract test:** the backend's protocol tests export their emitted event payloads (including a full turn with steps, viz, clarify, and the transcript with step records) as JSON fixture files; the frontend's turn-reducer tests consume the same files. Python↔TypeScript drift is caught by a failing fixture, with no contract-test machinery built.
- **Frontend — the honesty surfaces are the test surface** (Vitest + Testing Library; the turn reducer tested headlessly against the shared fixtures, components against fixture render specs): "not available" renders the designed muted state, never an empty cell; tier chips always match envelope tier; the score band **never composes a 1600** and always shows the teaching caption; comparison table never winner-highlights; unknown card type → markdown fallback; the clarify widget freezes to a record after answering; citation popover content matches the envelope.
- **One Playwright smoke** (the only E2E): signup → ask → stream completes with timeline → refresh mid-answer lands on a sane state → transcript intact. Nothing more — no visual-regression infra, no cross-browser matrix in MVP2.
- **The eval set is unchanged** — it tests the agent, which didn't change. Thumbs feedback begins feeding it (§30). *Amended at B0 (2026-06-12): the "agent didn't change" premise is sanctioned-false — B1a's prompt delta (the narration instruction) and the delta-only prose recomposition (§27.2) shift the eval baseline by design. The eval set re-baselines once after B1, and the close-out compares like-with-like, per-criterion — not headline accuracy.*

---

## 35. MVP2 risks & open questions

| Risk | Mitigation |
|---|---|
| LibreChat upstream churn / clone drift | Pinned commit in `UPSTREAM.md`; `vendor/` quarantine; re-syncing is a deliberate task, never automatic |
| Version skew (their Tailwind 3.4 vs ecosystem v4) | Stay on their versions while cloning; upgrade only if/when re-syncing with them |
| Cloned components drag hidden coupling (Recoil stores, their contexts) | Strip-and-rewire at vendor time; each surface budgets its support files; the harness proves the protocol needs nothing from their plumbing |
| In-process resume buffer lost on restart/deploy | Transcript catch-up is the correctness guarantee; the buffer is UX sugar (§27.3) |
| pydantic-ai doesn't emit tool-call stream events (the §27.1 gate fails) | Decided fallback already on owned seams: the MCP `process_tool_call` hook + our own Tavily/`render_viz`/skill functions — no tool wrapping either way |
| Step records bloat graph state on long chats | Receipts are bounded (queries/domains/counts/keys, no payloads); checkpoint growth already has the TTL knob (Part I, §7); watch, don't pre-build |
| Cookie auth CSRF | `SameSite=Lax` + JSON-only state changes (§28); revisit if ever embedded cross-origin |
| Single-instance assumptions (the turn registry + rate counters) | Explicitly documented as the MVP2 posture (§33); two named owners, closed list; re-back them when scale demands |
| SSE buffered/broken by proxies | `X-Accel-Buffering: no` + keepalives; verify on the chosen host |
| `step`/`thinking` leak internals or fabricate | Labels templated from assets; receipts limited to queries/domains/counts/field keys; thinking narrates intent, never facts-first (prompt + eval) |
| fastapi-users maintenance risk | Surface used is small (routers + dependency); standard FastAPI underneath; replaceable at the router layer |
| `users.settings jsonb` grows into a junk drawer | It holds exactly theme + source preset in MVP2; anything more triggers a real column/table decision |

**Open questions (resolve at build time):**

- **The §27.1 emission gate:** does the pinned pydantic-ai emit tool-call start/result events from `run_stream_events()`? (Today `app/agent_node.py` consumes only Part events.) Verify first thing; the fallback order is already decided.
- Exact `fastapi-users` / `httpx-oauth` versions and cookie-transport API — pin everything (the Part I posture).
- The LibreChat pin commit — chosen when the clone is cut; recorded in `UPSTREAM.md`.
- `thinking` density — if interstitial narration proves too sparse in dogfooding, add the cheap-model per-step summarizer (decide on evidence, not now).
- Virtualization library — clone theirs vs a lighter modern one; decide when cloning the message list.
- LangGraph thread-deletion API for chat delete — confirm the exact call (contained to the checkpointer adapter).

---

*Companions: `specs/mvp1/PRD.md` (product), `docs/DATABASE_GUIDE.md` (the data contract), `docs/adr/` (decisions — see ADRs 0016–0019 for the service/platform decisions added with this revision), `docs/research/` (stack survey). Keep this current as decisions change.*
