# AGENTS.md — Counselle

## What we're building

**Counselle** is an **AI agent** for the college-admissions process — a "thinking and answering partner" about US universities for **student applicants**. It sits on top of the existing **data pipeline**.

The ultimate goal: **the perfect AI agent for thinking about, and answering anything about, any university or school** — able to think, take steps, reason about those steps, and take further actions.

This repo is the **agent**. The pipeline repo is the **data**. The agent is a **read-only consumer** of the pipeline's Postgres database.

**Counselle is an independent service.** It shares only **credentials** with the pipeline — the read-only DB connection and Vertex/GCP keys — and nothing else: no shared code, no shared config, no runtime dependency. Don't couple to the pipeline or rely on its behavior; treat the DB as the contract (per `docs/DATABASE_GUIDE.md`).

## Status

**MVP1 shipped (2026-06-11).** The agent — PRD stories 1–38 and 42–58 — is implemented and verified by tests, evals, and live E2E. Deep research (PRD stories 39–41) is **deferred**: the graph is `prepare → agent → END` (no stub node), and the follow-up plan (`specs/deep-research/plan.md`) adds the research node — the minimal topology is what makes that additive. The data pipeline is live (Postgres on `localhost:5432`).

**MVP2 shipped (2026-06-13), merged to `main`.** The full-stack app over the agent: step/thinking work-visibility events, the turn registry (detached turns, reattach, cancel), auth & identity (fastapi-users cookie-JWT + Google OAuth), chat management, feedback, rate limiting, `GET /v1/config`, and the React/Vite frontend (FE-0…FE-7) wired to the real backend. Phases **B0–B5 are complete**; the per-phase build log lives in `specs/mvp2/plan/ship-plan.md`.

**Deferred (not built):** **B6 (deploy)** — production DB hosting, the multi-stage container, SPA same-origin serving, and the prod-deploy gotchas. See `docs/DEPLOY.md` for the deploy plan and its open items. The app runs locally today (see `README.md`); it has not been deployed.

**B7 hardening shipped (2026-06-17).** The tests/docs hardening work is implemented, including the routine coverage command, regression pins, and the 2026-06-17 live eval re-baseline.

## Commands

```bash
# Routine tests (no live LLM, Tavily, or live DB, ~$0.00)
uv run pytest -m "not live_llm and not live_search and not live_db"

# Coverage visibility for the routine suite (not a merge gate)
uv run pytest -m "not live_llm and not live_search and not live_db" --cov --cov-report=term-missing

# Full test suite including live Gemini + Tavily (~$0.50)
uv run pytest

# Lint + type-check
uv run ruff check . && uv run mypy .

# Run the eval set (~$2-3, produces evals/report-<date>.json)
uv run python -m evals.runner

# Start the API server (serves /v1)
uv run uvicorn api.main:create_app --factory --port 8000

# Start the frontend (separate terminal; proxies /v1 → :8000)
cd frontend && npm install && npm run dev   # http://localhost:5173

# Frontend checks
cd frontend && npm run typecheck && npm test
```

## Documentation map

**Read these to orient. Read `docs/ARCHITECTURE.md` for how the system is built; read `docs/DATABASE_GUIDE.md` before touching the database; read `docs/adr/` before changing any architectural decision.**

| File | What it is |
|------|-----------|
| `specs/README.md` | Index + the lifecycle convention for `specs/` (the permanent home for PRDs + plans) vs `plans/` (local scratch). Read this to know where finalized plans live |
| `specs/mvp1/PRD.md` | MVP1 product requirements: the agent's purpose, primary user, scope, the feature list, what's deferred, and the decision history/rationale from the design conversation |
| `specs/mvp2/PRD.md` | MVP2 PRD (WHAT-level): the full-stack app over the MVP1 agent — auth, home screen, the chat-experience spec (activity timeline, inline cards, citation grammar, smoothness laws), chat management, settings, the backend delta (`step`/`thinking` events, resume/cancel, chat CRUD, rate limiting), locked product decisions, and MVP2 out-of-scope |
| `docs/ARCHITECTURE.md` | The full system architecture, in two parts. **Part I (§1–25, MVP1):** the chosen stack, the data-access layer (the `counselle-db` MCP server, its 3 layers and tool catalog), the citation envelope, field discovery, school coverage & the CDS tier, the agent runtime, the deep-research subsystem, source control, skills, visualizations, temporal awareness, deployment, the feature→component matrix, risks, and open questions. **Part II (§26–35, MVP2):** the full-stack app — protocol extensions (step/thinking, the turn registry, resume/cancel, the §27.7 turn-record/identity/lifecycle resolutions), auth, chat management, feedback & rate limiting, the frontend, config/deployment/testing deltas |
| `docs/DATABASE_GUIDE.md` | Exhaustive reference for the underlying database — every table, the 1,093-field catalog, value-reading rules (R1–R12, anti-misread), raw/multi-row data, enum decoding, data recency/provenance, the query surface, school identity, the CDS pipeline, gotchas, and how-to SQL recipes. Verified against the live DB (snapshot 2026-06-09) |
| `docs/DEPLOY.md` | The deployment guide and its open gotchas (env matrix, DB provisioning, the `--forwarded-allow-ips` trap). **Deploy itself is deferred** — this is the plan, not a tested runbook |
| `docs/research/agent-stack-evaluation.md` | The frontier-tech survey behind the stack choice: agent frameworks, model-provider abstraction, and the agent-skills ecosystem, with scorecards and the verdict |
| `docs/research/deep-research-bakeoff.md` | The 4-way quality-vs-cost comparison of open-source deep-research systems (Alibaba DeepResearch, STORM, dzhng/deep-research, GPT-Researcher) and the verdict |
| `docs/adr/README.md` | **Index of all 25 ADRs** (number, title, one-line summary). Start here for decisions |
| `docs/adr/` | One file per architectural decision (context → decision → rationale → alternatives → consequences). Do not silently break an ADR |
| `specs/mvp1/plan/` | The MVP1 implementation plan (archived): `00-overview.md` (phases, git/milestone protocol, orchestration + model-routing rules, credentials) + one file per phase (0–7) |
| `specs/deep-research/plan.md` | Stub plan for the deferred deep-research follow-up (PRD stories 39–41) |
| `specs/mvp2/architecture.md` | The MVP2 design spec (the HOW) — merged into `docs/ARCHITECTURE.md` Part II; kept as the planning-era artifact |
| `specs/mvp2/plan/ship-plan.md` | The MVP2 execution plan (phases B0–B7): the backend delta, the §0.1 spec-gap resolutions (G1–G5), the §0.2 wire-contract summary, FE‑7 hookup, deployment, the evals/docs close-out — plus §5, the recorded B0 spike decisions |
| `specs/mvp2/plan/wire-contract.md` | The FE↔BE wire contract, field by field (B0 spike 4 output): SSE event shapes incl. `step`/`thinking`, the transcript wire shape, `/v1/config`, source-config mapping, sources/citation rules, Last-Event-ID, the receipt format, and the resolved conflicts |
| `TODOS.md` | Deferred work with full context (the session-TTL cleanup job, sessions-list load-more, the B2 turn-lifecycle corners, the community-card viz type). CI was proposed and explicitly declined — don't re-propose it |

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
- **Service shape:** **API-first agent service** (FastAPI) behind a **versioned SSE event protocol** (`meta`/`delta`/`viz`/`clarify`/`sources`/`usage`/`done`/`error`); every frontend is a client — ADR 0016. (MVP1 used a throwaway dev harness as that client; it was retired in MVP2 once the React frontend went real.)
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

- Verify before editing: do not assume file paths, imports, functions, settings, schemas, routes, or framework boilerplate exist. Search/read the current code first, then change it.
- Search before adding: before creating a new helper, service, component, endpoint, config knob, migration, or test fixture, search for an existing equivalent and extend it when that is the simpler fit.
- Use Context7 for current docs: before implementing against a library, framework, SDK, API, CLI, or cloud service, fetch the latest relevant official docs/examples through Context7. If Context7 cannot resolve it, fall back to official docs on the web.
- Files < 800 lines, functions < 50 lines; many small modules; organize by feature.
- Parameterized SQL only (never f-string SQL) — inherited from pipeline ADR 0001.
- Never log secrets. Secrets in `.env`/config only.
- The value-reading rules (`docs/DATABASE_GUIDE.md` §6, R1–R12) are the spec for the normalization engine — implement them in code and test them hard.
- Plan before non-trivial work; keep `specs/mvp1/PRD.md`, `docs/ARCHITECTURE.md`, and the ADRs current as decisions change.

## Frontend components — search registries first, never reinvent the wheel

This is principle 2 (never reinvent the wheel) made concrete for UI. **Before building any frontend component, search for an existing one — don't hand-roll what a registry already ships.**

1. **Search the shadcn MCP first, always.** Use the `shadcn` MCP (`search_items_in_registries` / `view_items_in_registries` / `get_item_examples_from_registries`) before writing any component. If it exists, use it.
2. **We're building an AI application — check `@ai-elements` first.** The [AI Elements](https://elements.ai-sdk.dev/docs) registry (`@ai-elements`) ships AI-native components (conversation, message, reasoning, prompt-input, sources, …) built on shadcn. Prefer it for anything chat/agent/AI-shaped. Then fall back to `@shadcn` for plain primitives (button, tooltip, dialog, …).
3. **If the 21st.dev `magic` MCP is available, search it too, and use whichever is better.** `magic` is user/global-scoped (not committed to this repo), so it may not be present for everyone — treat it as optional: when it exists, compare its result against the shadcn/AI-Elements option and pick the better fit; when it doesn't, skip it silently.
4. **Only build custom when nothing fits.** Counselle's differentiating honesty surfaces (activity timeline, cited cards, clarify widget) are built new on the cloned tokens — see ADR 0020. Everything commodity should come from a registry.

Registries are configured in `frontend/components.json` (`@ai-elements`, `@shadcn`). The shadcn MCP only auto-discovers them when run from `frontend/`; install components from there:

```bash
cd frontend && npx shadcn@latest add @ai-elements/conversation   # or @shadcn/button
```

## Planning workflow — `plans/` vs `specs/`

Two folders, one lifecycle. Keep them straight:

- **`plans/` is local scratch.** While a feature or MVP is being actively designed and built, its plan lives here. It's ephemeral and work-in-progress — nothing in `plans/` is canonical. (Personal never-committed notes go under `plans/.local/`, which is gitignored.)
- **`specs/` is the permanent, shareable home.** When the work is **finished and verified perfect**, relocate the finalized PRD/plan to `specs/<mvp-or-feature>/` — `PRD.md` for the WHAT, `architecture.md` for the HOW (optional), `plan/` for the execution detail. This is the "we approved it, now it's implemented" record teammates rely on. See `specs/README.md`.
- **The move is the graduation.** Draft in `plans/` → ship the work → move to `specs/`. Don't let plans rot in `plans/`; if it's done, graduate it; if it's abandoned, delete it.
- **`specs/` files are historical records, not living docs.** The living system description is in `docs/` (`ARCHITECTURE.md`, `DATABASE_GUIDE.md`, `adr/`). Don't retro-edit a shipped plan's narrative — a changed decision is a new ADR or a `docs/` update.
