# Counselle — System Architecture

> The complete architecture for the Counselle AI agent (MVP1), designed so the future platform (persistent chats, user accounts, profiles, chancing, writing) extends it without rework. Companion docs: `PRD.md` (what & why), `docs/DATABASE_GUIDE.md` (the data contract), `docs/adr/` (one decision each), `docs/research/` (the stack survey).
>
> Status: design. No code yet. The data pipeline + Postgres are live (`localhost:5432`).

---

## Table of contents

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

---

## 1. Guiding principles

1. **Honesty lives in code, never in the LLM's head.** The database is a minefield (`DATABASE_GUIDE` §6): fractions stored 0–1, coded ints, NULL semantics, national-benchmark traps, lagged earnings. The data layer returns values **already decoded, scaled, formatted, and stamped with source + vintage** (the citation envelope); the LLM reasons over clean cited facts and never parses a raw cell. This one decision makes citations, source tiering, and recency awareness *fall out of* the architecture instead of being bolted on. (ADR 0006.)

2. **Use the stack's native seams; never wrap them.** Every major extension point we need already exists in a chosen tool: PydanticAI's `model=` *is* the model seam, MCP *is* the tool/transport seam, LangGraph's checkpointer protocol *is* the session-persistence seam, SKILL.md *is* the workflow seam, Tavily-behind-thin-tools *is* the search seam. A hand-rolled abstraction layered over any of these would be a shallow pass-through — interface as complex as the thing it hides, deletable without losing anything. Our own code adds exactly three seams the stack doesn't provide: the **domain core** (§4), the **event protocol** (§6), and the **configuration surface** (§18).

3. **MVP1 is the agent; the platform comes later — so the agent is a service, not an app.** Everything user-facing (today's throwaway dev chat, tomorrow's ChatGPT-style platform with accounts and chat history) is a **client of one API**. Nothing in the agent service knows or cares what's rendering it. (§2, ADR 0016.)

4. **Configurable means one place.** Anything a developer might plausibly change lives in the central typed settings or in a versioned data asset — never inline in code. Hardcoding is reserved for invariants that will never change (§18, ADR 0018).

5. **KISS, always.** Layers exist where they earn their keep (the dependency rule protects the honesty core; the protocol protects the platform future); everywhere else, the smallest thing that works. No speculative microservices, no message buses, no DI frameworks.

---

## 2. The shape of the system: an API-first agent service

**MVP1 builds one deployable: the Counselle agent service.** It exposes a small versioned HTTP API (§6) that streams a conversation as typed events. The PRD's "deliberately minimal web chat" is a **dev harness client** of that API — one plain page, zero coupling, fully replaceable. (ADR 0016.)

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
| **Deep research** | **GPT-Researcher** (embedded) | Only OSS deep-research with pluggable MCP sources (our DB first-class); best controllable cost. | 0009 |
| **External search** | **Tavily** | One search+extract backend for web / .edu / Reddit, scoped by domain; also GPT-Researcher's retriever. No scraping of our own. | 0015 |
| **Skills** | **SKILL.md** open standard | Portable workflow layer, loaded on demand. | 0010 |
| **Session persistence** | **LangGraph Postgres checkpointer** in `counselle.*` | Sessions survive restarts from day one; the platform's chats are the same rows + a user FK. | 0019 |
| **Vector search** | **pgvector** (`counselle.field_index`) | Field-discovery embeddings; reuses Postgres, no new infra. | 0007, 0008 |
| **Config** | **pydantic-settings** + versioned data assets | One typed settings surface, fail-fast at startup. | 0018 |
| **Models** | Default **Vertex AI**: `gemini-2.5-pro` (synthesis), `gemini-2.5-flash` (cheap tier); any agent swappable to Anthropic/others via config; optional LiteLLM sidecar later. | 0011 |
| **Language** | Python | Matches the pipeline; asyncpg expertise carries over. | — |

---

## 4. Layering & the dependency rule

(ADR 0017.) Four layers, dependencies point **inward only**. The point is not ceremony — it's that the honesty-critical code stays pure, testable, and untangled from frameworks, and that any layer can be replaced without touching the ones beneath it.

| Layer | Package | Contains | May import |
|---|---|---|---|
| **Domain core** | `domain/` | Citation-envelope types; the **normalization engine** (reading rules R1–R12); vintage interpretation; coverage-tier logic; `admission_season(today)`; render-spec / clarify-spec / source-config / protocol-event **types**. Pure functions and Pydantic models. **No I/O, no LLM calls, no LangGraph/FastAPI imports.** | stdlib, pydantic |
| **Application** | `app/` | The LangGraph graph; PydanticAI agent definitions (counselor, researcher, verifier); the research subagent wiring; source-config tool mounting; skills loading; the data calendar assembly. | `domain/`, the stack |
| **Adapters** | `adapters/` (+ the separate `counselle-db` server) | asyncpg access, Tavily tools, GPT-Researcher embedding, checkpointer setup, embedding client. Each adapter implements a seam consumed by `app/` — mostly the stack's own seams (MCP tools, retrievers, checkpointer). | `domain/`, vendor SDKs |
| **API edge** | `api/` | FastAPI routes, SSE encoding, request context (trace ID + optional principal), translation of graph output → protocol events. | `app/`, `domain/` |

Rules of thumb (the seam discipline):

- **The domain core is the deletion-test survivor.** Deleting it would scatter the reading rules across every tool and prompt — it concentrates the product's entire honesty guarantee in one deep module with a tiny interface (`normalize(field, raw) → envelope`, `season(today) → phase`, …). It is the most-tested code in the repo (§21).
- **One adapter = hypothetical seam; two = real.** We do not write interfaces for things with one implementation and no honesty stake. The model seam is real (Vertex/Anthropic — via PydanticAI, not ours). The search seam is the three thin tools (Tavily today; the tool signatures are the seam). The session seam is LangGraph's checkpointer protocol (theirs, not ours).
- **No pass-through wrappers.** If a module's interface is as complex as what it hides, delete it.

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
├── harness/                      # the throwaway dev chat page (one static page; not "the product")
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
| `delta` | text tokens (with inline citation markers) | The prose. |
| `viz` | a **render spec** (§17) — cells are citation envelopes | Out-of-band: numbers never ride in `delta` tokens. |
| `clarify` | a **clarify spec** (§12.1) | Stream ends `awaiting_input`; client answers via a new message. |
| `sources` | the deduplicated citation list for the turn (official/community, vintages) | Feeds the expandable-marker UX (PRD). |
| `usage` | tokens + estimated cost for the turn (§19) | |
| `done` / `error` | terminal | `error` carries a user-safe message + trace_id. |

**Versioning:** `v` on every event, `/v1` on every route, and a version field inside the render/clarify specs. Additive changes don't bump; breaking changes do. Clients ignore unknown event types (forward compatibility).

**Auth posture:** MVP1 runs with no auth (local/dev). The request context already carries an **optional principal** populated by middleware, so the platform adds an auth middleware + a `user_id` — no route or orchestration changes. We do not build auth now.

---

## 7. Sessions, state & the platform-ready identity model

(ADR 0019.) The classic retrofit pain in chat products is bolting persistent identity onto an in-memory prototype. We avoid it by making the *shape* platform-ready on day one while building none of the platform:

- **Every conversation is a session with a durable `session_id` from day one.** In-session working memory (PRD) *is* the LangGraph state for that session — one mechanism, not two.
- **State persists in Postgres via LangGraph's own Postgres checkpointer**, in Counselle's `counselle.*` schema. Sessions survive restarts; a parked `interrupt()` (clarify question) survives too. No bespoke session store — the checkpointer protocol is the seam, and swapping it (memory in unit tests, Postgres in prod) is configuration.
- **A thin `counselle.sessions` row** (session_id, created_at, **nullable `user_id`**, title, default source-config) fronts the checkpoint data. The platform phase adds a `users` table and starts filling `user_id` — chat history, profiles, and per-user memory attach to rows that already exist. No migration of meaning, only addition.
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

(ADR 0003.) PydanticAI defines each agent (counselor, researcher, verifier) with `model=` from config, native MCP connections, and typed `result_type`s. LangGraph orchestrates: parallel research subgraphs scaled to question complexity, state passing, session persistence via the checkpointer (§7), and `interrupt()` for clarifying questions.

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

Embedded as a research subagent inside the LangGraph orchestrator — not adopted wholesale, and **not** a hosted research black box (our DB must be a first-class source; our model routing and source tiering must apply). (ADR 0009; bake-off in `docs/research/deep-research-bakeoff.md`.)

**Cost-optimized configuration (all knobs in §18):** three model tiers — `FAST_LLM`/`STRATEGIC_LLM` → Gemini 2.5 Flash, `SMART_LLM` → Gemini 2.5 Pro, escalatable per question; hard `DEPTH`/`BREADTH`/concurrency caps; documented cost ~$0.08–0.10/task cheap mode, ~$0.50–1.00 deep mode. **DB-first does the heavy lifting:** web research only fills gaps the DB can't answer — a base-tier dossier comes almost entirely from IPEDS/Scorecard with zero web spend.

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

(ADR 0014.) **MVP1 ships three:** the **dossier stat block**, the **comparison table** (per-cell citations), and the **score-range band** (SAT/ACT middle-50%). Net-price-by-income bars and the factor-weight grid are designed but deferred.

**The provenance boundary (the core rule):** the **LLM decides the shape** (schools, fields, chart type); a **tool fetches the numbers** straight from citation envelopes. **Numbers never round-trip through the LLM's tokens.** Community/qualitative content renders as an explicitly community-tier qualitative card, never a quantified chart. **No trend charts** — the DB holds one vintage per source; a trend line would be fabricated.

**Mechanism:** one tool — `render_viz(type, selection)`, `type ∈ {stat_block, comparison_table, score_band}` — wraps the existing `counselle-db` tools, wraps the envelopes with `type`, and returns a **render spec** that streams to the client as a `viz` event (§6); the LLM receives only an acknowledgment. Dumb client components draw `display` + the tier chip and render `available:false` as "not available"; tables/stat blocks degrade to Markdown where no renderer exists. Placement = tool-call order.

**Field ownership:** stat block & comparison → the LLM picks fields contextually (what matters for *this* chat); score band → fields fixed by the chart definition, the LLM picks only test + schools.

**Accuracy guarantee:** values are always tool-fetched, so the LLM cannot misstate a number. Residual risk = wrong field for the concept, bounded by: only real catalog keys are selectable (`search_fields`/static map), the tool rejects unknown keys, R9 source preference lives in normalization, `available:false` degrades honestly, and the eval set scores field-selection accuracy. No concept→field resolver (low-value-and-hard).

**The score-band honesty trap:** IPEDS SAT percentiles are per *section* and must never be summed into a 1600 composite — render two section bands (or the `sat_average` midpoint), never a fabricated composite. ACT composite percentiles exist directly. The band is the **enrolled cohort's middle-50%, not a cutoff** — the agent teaches that.

---

## 18. Configuration architecture

(ADR 0018.) "Configurable" means **one place per kind of thing**. Three buckets, one policy:

**1. Typed settings (`config/settings.py`, pydantic-settings).** One `Settings` object, loaded once at startup, **validated fail-fast** (a missing key or malformed value kills boot with a clear error — never a silent default in production paths). Layered: code defaults → `.env` / environment → explicit overrides. Everything deploy- or cost-relevant lives here:

| Group | Knobs |
|---|---|
| Models | per-agent `model=` (counselor / researcher / verifier / clarifier), GPT-Researcher's `FAST/STRATEGIC/SMART` tiers, provider credentials, optional LiteLLM endpoint |
| Research | depth, breadth, concurrency, per-tier token caps, per-question cost ceiling |
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

MVP1 runs locally, but **nothing may block containerized deployment** — deployability is a property, not a phase:

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
| User accounts & auth | optional principal in the request context (§6) | auth middleware, `counselle.users`, fill `sessions.user_id` |
| Persistent chat history | durable sessions + transcript read (§6, §7) | list/search/rename UI; pagination |
| User profiles & personalization | sessions keyed for a user FK; deferred by PRD | profile store; profile context injection |
| Long-term memory | the checkpointer layer is the same seam | a memory store + retrieval policy |
| Chancing | the chancing *knowledge* already cited (PRD) | the personal math on top of the same envelopes |
| Real frontend (web/mobile) | the versioned event protocol (§6) | the apps — pure clients |
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
- **SSE vs WebSocket** — SSE is the default (HTTP-native, simpler); revisit only if the platform needs bidirectional streaming (the protocol's event shapes are transport-agnostic either way).

---

*Companions: `PRD.md` (product), `docs/DATABASE_GUIDE.md` (the data contract), `docs/adr/` (decisions — see ADRs 0016–0019 for the service/platform decisions added with this revision), `docs/research/` (stack survey). Keep this current as decisions change.*
