# MVP1 Implementation Plan — Master Overview

> **Scope:** everything in `PRD.md` **except deep research** (the GPT-Researcher subsystem and its verification pass — PRD user stories 39–41 and the research-cost parts of 54 are deferred to a follow-up plan). Everything else ships. `docs/ARCHITECTURE.md` is the bible; `docs/DATABASE_GUIDE.md` is the data contract. Where this plan states a value, signature, or SQL shape, it was taken from those documents — implementing agents do not re-derive them.
>
> **How to use this plan:** the orchestrator (the main Claude session) reads this overview; each implementing agent receives exactly one phase file (plus the file lists named in it) and builds what it says. Nothing in a phase file is optional. Anything ambiguous is a plan bug — the orchestrator fixes the plan first, then re-dispatches.

---

## 1. The phases

| # | Phase | Branch | Deliverable | Plan file |
|---|---|---|---|---|
| 0 | Repo bootstrap | `feat/p0-bootstrap` | git repo, package skeleton, Settings, assets, tooling, Containerfile | `phase-0-bootstrap.md` |
| 1 | Domain core | `feat/p1-domain-core` | the pure honesty core: envelope, normalization R1–R12, vintage, tiers, season, all spec types — fully TDD'd | `phase-1-domain-core.md` |
| 2 | counselle-db MCP server | `feat/p2-counselle-db` | roles + grants, counselle schema migrations, the 10 DB tools (incl. the data calendar), live-DB integration tests | `phase-2-counselle-db.md` |
| 3 | Field discovery | `feat/p3-field-discovery` | pgvector field_index, reconciler, hybrid `search_fields`, static category map | `phase-3-field-discovery.md` |
| 4 | Agent runtime | `feat/p4-agent-runtime` | LangGraph graph, counselor agent, clarify interrupt, sessions, Tavily tools + source control, `render_viz`, skills — live Gemini tests | `phase-4-agent-runtime.md` |
| 5 | API edge | `feat/p5-api` | FastAPI, the v1 event protocol over SSE, session endpoints, usage accounting, health — E2E protocol tests | `phase-5-api.md` |
| 6 | Dev harness | `feat/p6-harness` | the throwaway chat page: stream, citations UX, 3 viz components, clarify widget, source dropdown | `phase-6-harness.md` |
| 7 | Evals + final hardening | `feat/p7-evals-hardening` | the ~50-question eval set + runner, full review gauntlet, E2E test campaign, docs sync | `phase-7-evals-hardening.md` |

Dependency chain is strictly 0→1→2→3→4→5→6→7. No phase starts before the previous phase's gate passes and its milestone commit is approved.

## 2. Git & milestone protocol

The repo is **not yet a git repository**. Phase 0 step 1 is `git init`.

- `main` holds the docs, this plan, and merged phase milestones.
- Each phase happens on its branch. **Work stays uncommitted (or in WIP commits that get squashed) until the phase gate passes.**
- **The user gate:** when a phase gate passes, the orchestrator STOPS, tells the user "phase N ready — here's how to test it yourself" (each phase file has a *Try it yourself* section), and waits. Only after explicit user approval: one milestone commit (message specified per phase, conventional format), push, merge to `main`. **No agent ever runs `git commit`/`push`/`merge` — only the orchestrator, only after user approval.**
- Remote: created at Phase 0 only if the user provides one; otherwise commits stay local and "push" steps are skipped until a remote exists.

## 3. The orchestration protocol (how the orchestrator works every phase)

1. **Dispatch builders.** Split the phase file's work breakdown into its named slices. One agent per slice. **Model routing: Fable/Opus for most tasks; Sonnet only for easy ones** (mechanical/low-judgment work — e.g. boilerplate scaffolding, asset files copied verbatim from a named doc section, simple config). Anything involving design judgment, library APIs, SQL, async, or the honesty core gets Fable/Opus. Each agent's prompt = the phase file section + the exact file list it may touch + the relevant doc excerpts named in the phase file. Independent slices run in parallel; dependent ones sequentially as marked.
2. **Run the phase's tests yourself** (the orchestrator runs the commands; never trust an agent's claim that tests pass). Every phase file ends with exact commands.
3. **Review loop.** Dispatch in parallel: `code-reviewer`, `python-reviewer`, plus `security-reviewer` when the phase touches SQL/network/user input (phases 2, 4, 5, 6) and `silent-failure-hunter` when it adds error paths (phases 2, 4, 5). Reviewers run on Fable/Opus (review is judgment work); fixers follow the same routing rule as builders (Fable/Opus by default, Sonnet only for trivial fixes). Collect findings → dispatch fixer agents for every CRITICAL/HIGH (and cheap MEDIUMs) → re-run tests → re-review **changed files only**. Repeat until a clean pass (zero CRITICAL, zero HIGH). Max 4 loop cycles; if still failing, stop and escalate to the user with the stuck findings.
4. **Live feedback loop.** Each phase file defines *live verification* — real commands against the real DB / real Vertex Gemini / real Tavily. The orchestrator (or a dispatched tester agent) runs them and checks outputs against the stated expectations. A live check failure is treated like a test failure: fix loop, not a shrug.
5. **Gate.** Walk the phase's *Gate checklist* literally. Every box ticks or the phase isn't done.
6. **User milestone.** Stop, report, wait for approval, then commit/push/merge as §2.

**Agent hygiene rules:** agents get file lists, not "explore the repo"; agents never install global software; agents never touch `.env` (the orchestrator manages secrets); agents never run destructive SQL (the role setup script is run by the orchestrator after showing the user); an agent that wants to deviate from the phase file reports back instead of improvising — the orchestrator updates the plan file first (and notes the deviation for the milestone report).

## 4. Credentials & external dependencies inventory

| Credential | Used from phase | Source | Env var |
|---|---|---|---|
| Pipeline Postgres (admin, for one-time role setup) | 2 | `postgresql://ascensia:ascensia@localhost:5432/ascensia` (DATABASE_GUIDE §2) | not stored; used once interactively |
| `counselle_ro` DSN (agent's read path) | 2 | created by the Phase 2 setup script | `COUNSELLE_DB_RO_DSN` |
| `counselle_app` DSN (counselle schema owner: sessions, field_index) | 2 | created by the Phase 2 setup script | `COUNSELLE_DB_APP_DSN` |
| Vertex AI / GCP (Gemini + embeddings) | 3 | **reuse the data pipeline's credentials** — at Phase 3 start, the orchestrator reads `~/Projects/ascensia-data-pipeline/.env` to find the GCP project/credentials path and mirrors them into Counselle's `.env` | `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` |
| Tavily API key | 4 | **provided by the user — ask for it at the start of Phase 4** | `TAVILY_API_KEY` |

Known infrastructure risk, checked early: **pgvector may not be installed in the pipeline's Postgres image.** Phase 2's setup script runs `SELECT count(*) FROM pg_available_extensions WHERE name='vector'`. If 0: Phase 3 ships with the trigram/keyword fallback only (already the designed fail-safe, ADR 0008), `search_fields` works, and the orchestrator presents the user a one-line decision: swap the pipeline's Postgres image for `pgvector/pgvector:pg16` (5-minute change in the pipeline repo) or stay keyword-only for MVP1.

## 5. Locked build decisions (so no agent ever has to choose)

| Decision | Choice |
|---|---|
| Python / package manager | Python 3.12, **uv** (`uv init --package`, `uv add`, `uv run`) |
| Lint / types / tests | **ruff** (lint+format), **mypy** (strict on `domain/`, normal elsewhere), **pytest + pytest-asyncio + anyio** |
| Migrations | **yoyo-migrations** (plain SQL, same tool family as the pipeline), chain in `migrations/`, applied with `uv run yoyo apply` against `COUNSELLE_DB_APP_DSN`, scoped to the `counselle` schema only |
| MCP server | official **`mcp` Python SDK (FastMCP)**, stdio transport, launched as a child process by the agent service |
| Agent framework | **pydantic-ai** (model strings like `google-vertex:gemini-2.5-pro`), **langgraph**, **langgraph-checkpoint-postgres** (`AsyncPostgresSaver`) |
| API | **FastAPI + uvicorn**, SSE via **sse-starlette** |
| HTTP client / search | **httpx**, **tavily-python** |
| Logging | **structlog**, JSON renderer, `trace_id` bound per request |
| Embeddings | Vertex embedding model, name in Settings (`COUNSELLE_EMBED_MODEL`, default `gemini-embedding-001`; confirm exact available model at Phase 3 with a live call) |
| Harness | one static `harness/index.html`, vanilla JS, zero build step, served by FastAPI `StaticFiles` |
| Version pinning | every dependency pinned (`uv lock` committed). At each phase start, the builder agent for a new library runs a docs lookup (Context7/official docs) to confirm the pinned version's exact API **before writing code** — the single biggest anti-hallucination rule in this plan |

## 6. PRD coverage matrix (every story lands in a phase)

| PRD user stories | Phase |
|---|---|
| 1–5 (dossier wedge), 22–26 (programs/money/outcomes), 27–28 (scores/CDS depth) | 2 (data), 4 (agent), 6 (display) |
| 6–12 (honest answering, misread traps) | 1 (normalization), 2 (tools) |
| 13–17 (clarifying questions) | 4 (interrupt), 5 (protocol), 6 (widget) |
| 18–21 (compare / find / benchmark) | 2 (tools), 4 (agent), 17→6 (table) |
| 29–31 (season & temporal) | 1 (season fn), 2 (data calendar), 4 (context injection) |
| 32–34 (Reddit community voice) | 4 (search_reddit, menu) |
| 35–38 (citations & trust) | 1 (envelope), 4 (markers), 5 (`sources` event), 6 (expandable UX) |
| 39–41 (deep research) | **DEFERRED — explicitly out of this plan** |
| 42–44 (source control) | 4 (tool mounting), 5 (config in protocol), 6 (dropdown) |
| 45–50 (visualizations) | 4 (`render_viz`), 5 (`viz` event), 6 (components) |
| 51–52 (session memory, visible steps) | 4 (checkpointer/state), 5 (transcript) |
| 53 (model config), 55 (read-only), 56 (skills), 57 (field discovery) | 0 (Settings), 2 (role), 4 (skills), 3 (reconciler) |
| 54 (cost levers) | partial: per-turn usage accounting + caps in Settings (5); research caps deferred with deep research |
| 58 (eval set) | 7 |

## 7. Definition of done (MVP1, this plan)

- All 8 phase gates passed; all milestone commits merged to `main`.
- `uv run pytest` green; `ruff check` + `ruff format --check` + `mypy` clean; `uv lock` committed.
- The live E2E campaign in Phase 7 passes: real conversations against real Gemini + real DB + real Tavily produce correct event streams, honest envelopes, working clarify round-trips, three rendering visualizations, and source-toggles that verifiably gate tools.
- The eval runner produces a scored report (no numeric gate — PRD).
- `README.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md` updated to as-built reality; this plan moved to `plans/archive/`.

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | (outside voice offered, declined) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 8 issues, 0 critical gaps — all resolved into the phase files |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

Resolved 2026-06-10: D2 in-process service layer (+thin MCP shell) · D3 checkpointer search_path + fail-fast schema assertion · D4 MCP child supervision + health surface · D5 find_schools whitelist recipe + adversarial tests · D6 automated restart-resume durability test · D7 hypothesis property tests on the normalization engine · trivial batch (embedding output_dimensionality=768 + L2-normalize, percent precision, max_tool_rounds, COA sibling fallback, single-flight note).
**UNRESOLVED:** 0. **User-declined:** CI pipeline (D9). **TODO:** session-TTL cleanup job (TODOS.md).
**VERDICT:** ENG CLEARED — ready to implement.
