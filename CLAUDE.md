# CLAUDE.md — Counselle

## What we're building

**Counselle** is an **AI agent** for the college-admissions process — a "thinking and answering partner" about US universities for **student applicants**. It sits on top of the existing **data pipeline** in `~/Projects/ascensia-data-pipeline` (the pipeline was renamed Counselle conceptually; the agent is this new project at `~/Projects/counselle`).

The ultimate goal: **the perfect AI agent for thinking about, and answering anything about, any university or school** — able to think, take steps, reason about those steps, and take further actions.

This repo is the **agent**. The pipeline repo is the **data**. The agent is a **read-only consumer** of the pipeline's Postgres database.

**Counselle is an independent service.** It shares only **credentials** with the pipeline — the read-only DB connection and Vertex/GCP keys — and nothing else: no shared code, no shared config, no runtime dependency. Don't couple to the pipeline or rely on its behavior; treat the DB as the contract (per `docs/DATABASE_GUIDE.md`).

## Status

**MVP1 built (2026-06-11).** PRD stories 1–38 and 42–58 are implemented and verified by tests, evals, and live E2E. Deep research (PRD stories 39–41) is **deferred** — the graph ships a stub `research` seam; the follow-up plan lives in `plans/mvp1-deep-research.md`. The data pipeline is live (Postgres on `localhost:5432`). The MVP1 implementation plan is archived in `plans/archive/mvp1/`.

**MVP2 in build.** The frontend (FE-0…FE-6, the backend-free LibreChat clone) merged 2026-06-12; the backend/app build (phases B0–B7) is underway per `plans/mvp2/ship-plan.md`. **B0 done (2026-06-12):** docs merged (ARCHITECTURE Part II + the §0.1/§0.2 addenda), ADRs 0020–0023 accepted, the four gate-spike decisions recorded in ship-plan §5. **B1 done:** step/thinking emission (`app/steps.py`, `domain/events.py` step/thinking events) + the self-contained turn record (`app/records.py`, G1/G2). **B2 done:** the turn registry (`app/turns.py` — detached turns, Last-Event-ID reattach, cancel/G5, the G3 history rewrite). **B3 done (2026-06-13):** auth & identity — `counselle.users`/`counselle.oauth_accounts` (migration 0004; `sessions.user_id` FK CASCADE + the dev purge), fastapi-users cookie-JWT (`api/auth.py`, `api/users_db.py` — the custom asyncpg adapter), `/v1/auth/*` routers (register/login/reset/users/Google OAuth), `/v1/me` (profile + cascade deletes), per-session ownership 404s, the JSON-only CSRF posture, `adapters/email.py` (console arm), and the Auth/Email Settings groups (`COUNSELLE_JWT_SECRET` now required). The live Google-OAuth browser loop is the one open B3 gate item (needs `COUNSELLE_GOOGLE_OAUTH_CLIENT_ID`/`_SECRET` in `.env`; redirect `http://localhost:8000/v1/auth/google/callback`). **B4 done (2026-06-13):** chat management (`GET/PATCH/DELETE /v1/sessions` — keyset pagination, search, `is_generating`), source-config stickiness, auto-titles (the `on_turn_complete` cheap-model retitle), feedback (migration 0005 + the transcript read-path join), rate limiting (`api/ratelimit.py` — per-user messages, per-IP auth), `GET /v1/config` (season-keyed greeting + starters + `default_source_config`), migration 0006 (covering indexes), the transcript builder lifted to `app/transcript.py`. **B5a done (2026-06-13):** FE‑7 begins — `HttpTransport` (SSE parser, Last-Event-ID, cancel/transcript/createSession, typed errors) in `frontend/src/api/http/`, the `VITE_TRANSPORT` switch, identity adoption G1 (temp-id→meta-id reconcile), ChatContext rewired off the mock stores onto the seam, real error handling (interruption/transcript-load/cancel honesty), citation URL gating. Verified in-browser: a real Stanford dossier turn streams into the live UI (timeline, cards, citations, sources, stop). **B5b done (2026-06-13):** real auth surface — the auth client (`frontend/src/api/http/auth.ts`) + `useMe` TanStack session over `/v1/me`, the six vendored sites swapped to `/v1/auth/*` (login/register/logout/forgot/reset/Google + Account/Delete/ClearChats), AuthGate loading/error/401 states, settings sync (`users.settings.theme`, server-wins). Google OAuth creds are in `.env` (router live). Verified in-browser: signup wall, wrong-password error, register→app, theme persist (server-wins), delete-account (truly gone), live Google redirect to the consent screen (consent click is human-only). **B5c next:** source-control wiring (story 17), feedback hook, `/v1/config` consume, real sessions list — then B5d (turn orchestration, landing, harness retirement, smoothness gate), B6 (deploy), B7 (close-out).

## Commands

```bash
# Routine tests (no live LLM or Tavily, ~$0.00)
uv run pytest -m "not live_llm and not live_search"

# Full test suite including live Gemini + Tavily (~$0.50)
uv run pytest

# Lint + type-check
uv run ruff check . && uv run mypy .

# Run the eval set (~$2-3, produces evals/report-<date>.json)
uv run python -m evals.runner

# Start the server
uv run uvicorn api.main:create_app --factory --port 8000

# Dev harness chat (after server is running)
# Open: http://localhost:8000/harness/
```

## Documentation map

**Read these to orient. Read `docs/ARCHITECTURE.md` for how the system is built; read `docs/DATABASE_GUIDE.md` before touching the database; read `docs/adr/` before changing any architectural decision.**

| File | What it is |
|------|-----------|
| `PRD.md` | Product requirements: the agent's purpose, primary user, MVP1 scope, the feature list, what's deferred, and the decision history/rationale from the design conversation |
| `PRD-mvp2.md` | MVP2 PRD (drafted 2026-06-11, WHAT-level): the full-stack app over the MVP1 agent — auth, home screen, the chat-experience spec (activity timeline, inline cards, citation grammar, smoothness laws), chat management, settings, the backend delta (`step`/`thinking` events, resume/cancel, chat CRUD, rate limiting), locked product decisions, and MVP2 out-of-scope |
| `docs/ARCHITECTURE.md` | The full system architecture, in two parts. **Part I (§1–25, MVP1):** the chosen stack, the data-access layer (the `counselle-db` MCP server, its 3 layers and tool catalog), the citation envelope, field discovery, school coverage & the CDS tier, the agent runtime, the deep-research subsystem, source control, skills, visualizations, temporal awareness, deployment, the feature→component matrix, risks, and open questions. **Part II (§26–35, MVP2):** the full-stack app — protocol extensions (step/thinking, the turn registry, resume/cancel, the §27.7 turn-record/identity/lifecycle resolutions), auth, chat management, feedback & rate limiting, the frontend, config/deployment/testing deltas |
| `docs/DATABASE_GUIDE.md` | Exhaustive reference for the underlying database — every table, the 1,093-field catalog, value-reading rules (R1–R12, anti-misread), raw/multi-row data, enum decoding, data recency/provenance, the query surface, school identity, the CDS pipeline, gotchas, and how-to SQL recipes. Verified against the live DB (snapshot 2026-06-09) |
| `docs/research/agent-stack-evaluation.md` | The frontier-tech survey behind the stack choice: agent frameworks, model-provider abstraction, and the agent-skills ecosystem, with scorecards and the verdict |
| `docs/research/deep-research-bakeoff.md` | The 4-way quality-vs-cost comparison of open-source deep-research systems (Alibaba DeepResearch, STORM, dzhng/deep-research, GPT-Researcher) and the verdict |
| `docs/adr/README.md` | **Index of all 23 ADRs** (number, title, one-line summary). Start here for decisions |
| `docs/adr/` | One file per architectural decision (context → decision → rationale → alternatives → consequences). Do not silently break an ADR |
| `plans/archive/mvp1/` | The MVP1 implementation plan (archived): `00-overview.md` (phases, git/milestone protocol, orchestration + model-routing rules, credentials) + one file per phase (0–7) |
| `plans/mvp1-deep-research.md` | Stub plan for the deferred deep-research follow-up (PRD stories 39–41) |
| `plans/mvp2/ship-plan.md` | The MVP2 execution plan (phases B0–B7): the backend delta, the §0.1 spec-gap resolutions (G1–G5), the §0.2 wire-contract summary, FE‑7 hookup, deployment, the evals/docs close-out — plus §5, the recorded B0 spike decisions |
| `plans/mvp2/wire-contract.md` | The FE↔BE wire contract, field by field (B0 spike 4 output): SSE event shapes incl. `step`/`thinking`, the transcript wire shape, `/v1/config`, source-config mapping, sources/citation rules, Last-Event-ID, the receipt format, and the resolved conflicts. B1b/B2/B4/B5 build from it; nothing re-opens |
| `TODOS.md` | Deferred work with full context (currently: the session-TTL cleanup job). CI was proposed and explicitly declined — don't re-propose it |

## The three principles (inherited from the data pipeline, they apply here too)

1. **KISS — Keep It Simple, Stupid.** The smallest thing that works. No abstraction before it's needed. If a choice makes the system harder to understand, it's wrong.
2. **Never reinvent the wheel.** If a battle-tested library/tool already does it, use it. The whole stack (PydanticAI, LangGraph, GPT-Researcher, MCP, SKILL.md, pgvector) was chosen by surveying the frontier and picking proven pieces — not hand-rolling.
3. **Startup speed over enterprise completeness.** Build for the common path; optimize only when something is actually slow. **One carve-out: the data is the product — never lie to a student.** Honesty about values, sources, and recency is non-negotiable; that's why the value-reading rules and citations live in code, not in the model's head.

## How we build: startup mode, not enterprise

We are a **startup doing rapid prototyping**. The default engineering instinct is to write robust, defensive, enterprise-grade code — **that instinct is wrong here.** Move fast.

**The one decision rule for any piece of work: value × ease.**

| | High value | Low value |
|---|---|---|
| **Easy** | ✅ do it | ✅ do it (it's cheap) |
| **Hard** | ✅ do it (it's worth it) | ❌ **don't — drop it** |

- **If it's low-value AND hard to do, fuck it — cut it.** Don't build machinery for problems that might happen. Build for the problem in front of you.
- **Never reinvent the wheel.** If a battle-tested library/tool does it, use it. Don't hand-roll.
- **Never write code that doesn't add much value.** No speculative abstraction, no defensive layers for edge cases that don't matter yet, no "enterprise completeness." YAGNI.
- **The honesty carve-out still holds** (principle 3): never lie to a student. That's the *one* place we spend extra effort regardless of ease — because it's the highest-value thing we have.

When in doubt, do the simplest thing that works and ship it.

## The stack (locked — see ADRs for rationale)

- **Agent runtime:** **PydanticAI** (model-agnostic, MCP-native, typed outputs = the citation envelope) — ADR 0003.
- **Orchestration:** **LangGraph** (multi-agent deep research, `interrupt()` for visual clarifying questions, state for in-session memory) — ADR 0003.
- **Database access:** a **`counselle-db` MCP server** (Python, asyncpg, read-only role) exposing 3 layers: field discovery, safe typed tools, a guarded SQL escape hatch. Tool logic lives in an in-process service layer (`counselle_db/service.py`) that the MCP server thinly wraps; `app/` imports the service directly — only the LLM's tool loop goes through MCP — ADRs 0004, 0005, 0012.
- **Field discovery / vector search:** hybrid static category map + pgvector, with a self-healing embedding reconciler (new fields are never invisible) — ADRs 0007, 0008.
- **Reading rules + citations in code:** the citation envelope (every value decoded, formatted, dated, source-tiered) — ADR 0006.
- **External search:** **Tavily** — one search+extract backend for all 3 external searches (web / .edu / Reddit), scoped by domain (3 thin tools, no scraping); Reddit is agent-steered. Also GPT-Researcher's retriever — ADR 0015.
- **Deep research:** **GPT-Researcher**, embedded, cheap-model-routed, capped depth, DB-first; on Tavily; *not* a hosted research black box (our DB must be a first-class source) — ADR 0009. **Deferred from the MVP1 implementation plan** (stub seam in the graph; follow-up plan adds it).
- **Skills:** **SKILL.md** open standard — ADR 0010.
- **Model config:** model-agnostic — PydanticAI per-agent `model=` from env; **default provider Vertex AI (Google), default model Gemini 2.5 Pro** (cheap tier Gemini 2.5 Flash), any provider swappable; optional **LiteLLM** sidecar — ADR 0011.
- **Service shape:** **API-first agent service** (FastAPI) behind a **versioned SSE event protocol** (`meta`/`delta`/`viz`/`clarify`/`sources`/`usage`/`done`/`error`); every frontend — including MVP1's throwaway dev-harness chat — is a client — ADR 0016.
- **Layering:** four layers, dependencies inward only (`domain/` pure honesty core → `app/` → `adapters/` → `api/`); use the stack's native seams, never wrap them — ADR 0017.
- **Config:** one fail-fast typed Settings surface (pydantic-settings) + versioned data assets (prompts, subreddit menu, dossier shortlist, season table); facts derive live from the DB; hardcoding only for true invariants — ADR 0018.
- **Sessions:** durable from day one via LangGraph's Postgres checkpointer in `counselle.*`; `session_id` required, `user_id` nullable until the platform phase; Counselle owns its schema + migrations — ADR 0019.
- **DB:** the pipeline's **Postgres 16** (read-only), plus **pgvector** in Counselle's own schema for field-search embeddings.
- **Language:** Python (matches the pipeline; reuse asyncpg).
- **Models:** default **Vertex AI (Google)** — `gemini-2.5-pro` (synthesis), `gemini-2.5-flash` (cheap tier). Swappable per-agent to Anthropic (`claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5`) or others via env.

## Scope guardrails (hard, enforced in code)

- **Any school in the database.** The agent works on any of the ~2,746 in-database schools — there is **no `is_tracked` scope gate** (reversed 2026-06-09). `is_tracked` is repurposed as a **CDS-depth signal** (extracted / PDF-only / base); the agent is tier-aware and falls back to IPEDS/Scorecard for non-CDS schools. The only hard boundary is "in our database or not." ADR 0002.
- **Read-only.** The agent never writes to the pipeline DB; it uses a dedicated `counselle_ro` role. ADR 0012.
- **Deferred for MVP1:** chancing, user-data personalization, agent long-term memory, essay/activity writing (PRD); plus deep research (PRD stories 39–41) — deferred from the MVP1 implementation plan to a follow-up.

## House rules

- Files < 800 lines, functions < 50 lines; many small modules; organize by feature.
- Parameterized SQL only (never f-string SQL) — inherited from pipeline ADR 0001.
- Never log secrets. Secrets in `.env`/config only.
- The value-reading rules (`docs/DATABASE_GUIDE.md` §6, R1–R12) are the spec for the normalization engine — implement them in code and test them hard.
- Plan before non-trivial work; keep `PRD.md`, `docs/ARCHITECTURE.md`, and the ADRs current as decisions change.
