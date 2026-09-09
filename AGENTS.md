# AGENTS.md — Counselle

## What we're building

**Counselle** is an **AI agent** for the college-admissions process — a "thinking and answering partner" about US universities for **student applicants**. It sits on top of the CollegeData facts store: a Postgres schema (`cds_library`, name kept for continuity — see ADR 0038) holding the IPEDS-derived school identity profile plus a daily, code-typed scrape of CollegeData.com's own structured per-school data (identity, admissions, cost, financial aid, academics, student life, outcomes). Scraped facts are Counselle's own data — no source label, no source tier, no evidence markers surfaced to the student. **There is no RAG anywhere in this path** — facts are read straight through typed views, never embedded or retrieved.

The ultimate goal: **the perfect AI agent for thinking about, and answering anything about, any university or school** — able to think, take steps, reason about those steps, and take further actions.

This repo is the **agent**. It also still contains the **CDS extraction pipeline and its admin tool** built under ADR 0036 (`domain/cds/`, `app/cds/`, `adapters/cds_*`, `api/routes/cds_admin.py`) — but as of ADR 0038 (school-data-v3), that system is **parked, not removed**: in-tree, importable, its unit tests still pass, but nothing from it is mounted or started at runtime, and its live `cds_library` tables have been dropped (DDL and data preserved — see `PARKED.md`). **The student-facing agent path is a strictly read-only consumer** of the facts store: it authenticates as `cds_library_reader` over `COUNSELLE_DB_RO_DSN` and never writes, reading six views (up from five) through four in-process tools — there is no MCP server on this path any more (ADR 0038 retires ADR 0004's MCP transport once every caller is in-process). The `cds_library_app` role and its `COUNSELLE_DB_PIPELINE_DSN` — previously the CDS admin's write path — are now repurposed to drive the CollegeData facts crawler instead; the two writers are mutually exclusive at runtime (`COUNSELLE_CDS_WORKER_ENABLED=false` while `COUNSELLE_FACTS_WORKER_ENABLED` gates the crawler) and the schema/DSN names are kept unchanged on purpose, per ADR 0038's smallest-diff rationale. Treat the DB as the contract for both generations (per `docs/DATABASE_GUIDE.md`); ADR 0036 is the decision record for the parked pipeline, ADR 0038 is the decision record for the facts store and the parking itself.

## Status

**MVP1 shipped (2026-06-11).** The agent — PRD stories 1–38 and 42–58 — is implemented and verified by tests, evals, and live E2E. Deep research (PRD stories 39–41) is **deferred**: the graph is `prepare → agent → END` (no stub node), and the follow-up plan (`specs/deep-research/plan.md`) adds the research node — the minimal topology is what makes that additive. The data pipeline is live (Postgres on `localhost:5433`).

**MVP2 shipped (2026-06-13), merged to `main`.** The full-stack app over the agent: step/thinking work-visibility events, the turn registry (detached turns, reattach, cancel), auth & identity (fastapi-users cookie-JWT + Google OAuth), chat management, feedback, rate limiting, `GET /v1/config`, and the React/Vite frontend (FE-0…FE-7) wired to the real backend. Phases **B0–B5 are complete**; the per-phase build log lives in `specs/mvp2/plan/ship-plan.md`.

**Deferred (not built):** **B6 (deploy)** — production DB hosting, the multi-stage container, SPA same-origin serving, and the prod-deploy gotchas. See `docs/DEPLOY.md` for the deploy plan and its open items. The app runs locally today (see `README.md`); it has not been deployed.

**B7 hardening shipped (2026-06-17).** The tests/docs hardening work is implemented, including the routine coverage command, regression pins, and the 2026-06-17 live eval re-baseline.

**MVP3 workspace shipped (2026-07-06).** The rebuilt frontend now has a persistent, auth-scoped workspace for Schools, Tasks, Essays, and Activities. Workspace mutations go through `app/workspace/`, write actor-attributed change rows, and publish workspace change events so HTTP calls and future Counselle-agent actions share the same path. The graduated design and plan live in `specs/mvp3/`; ADR 0027 records the service/event decision.

**CDS Library DB rewire technically cut over (2026-07-16); owner acceptance is pending.** The retired wide field store is replaced by five reader views, four DB tools, manifest `5.0.2`/packet v8, code-owned evidence and availability semantics, a live data picture, viz v2, and four focused skills. PostgreSQL 16 runs locally on `localhost:5433`; role isolation and rollback rehearsal are verified. The protected operational cleanup evidence is under `artifacts/db-rewire/20260716T205303Z-round3-cleanup/`: every deleted test row has a contemporaneous ID manifest, while two post-boundary sessions with uncertain ownership were deliberately retained. Because post-boundary writes exist, zero-loss rollback has expired. Counselle traffic remains closed until the remaining technical gates pass and the owner signs the current evidence; never switch back to the old DSN and discard those writes. ADR 0032 is the decision record.

**CDS extraction pipeline moved in-app (ADR 0036) and its ship gate is closed (2026-08-27); owner acceptance is still pending.** The extraction engine, admin review tool, and job poller that used to live in the separate `counselle-data-pipeline` repo are rebuilt inside this repo — `domain/cds/`, `adapters/cds_*`, `app/cds/`, `api/routes/cds_admin.py` — writing `cds_library` through a third DSN (`cds_library_app`, no `DELETE` grant), gated end-to-end by `current_superuser`. The reader contract, honesty rules, and agent-path isolation in `docs/DATABASE_GUIDE.md` are unchanged. The metric catalog is cut to 394 metrics across 13 domains; manifest `5.1.0` (`content_sha256 = 6367c0fee822f4d07725abc7274c8a589edefd64fb7301eac8372568941b04ae`) is published and current, superseding the immutable `5.0.2`. The 4-document corpus (Harvard ×2, Yale, UPenn — 13/13 domains each) was re-extracted and reapproved under `5.1.0` with zero `current_definition_match` mismatches, and the `active_update` correction flow (review/approve/reject against an already-active document, no candidate swap) is implemented and live-tested. The shipped configuration measures 99.01% accuracy, 96.96% coverage, 4 known hallucinations, $0.2088/document, 419.3s latency (`tuning/FINAL-REPORT.md` §12) — but that figure was measured on a corpus with zero overlap with the 4 documents actually shipped, and was accepted on that basis alongside a hand spot-check of the shipped corpus (`specs/cds-pipeline/plan/CUTOVER.md` §7). The earlier 65.6% per-metric recall figure is retired — it was measured against the pre-cut, 1,149-metric catalog and describes a system that no longer exists. The branch is rebased onto `main`. The cutover runbook — password rotation, old-repo archival, drift flags, verification checklist, and the full Phase 3/4/5/6 execution log — is `specs/cds-pipeline/plan/CUTOVER.md`; the execution record for the ship plan itself is `specs/cds-pipeline/plan/SHIP-PLAN.md`.

**Post-ship hardening batch landed (2026-08-31); owner acceptance still pending.** A round of admin-flow fixes closed honesty and correctness gaps found after the ship gate above closed: human-reviewed packets are now content-validated the same gate a model extraction runs (previously permanently `{}`), an admin's own edit is validated before any write and blocks approval on an error-severity flag it introduces unless `override_flags` is passed, a document whose detected identity isn't grounded in its own text now routes to `needs_input` instead of auto-filling to Ready, a pending edit is bound to the extraction it was authored against (migration `0016`) so a re-extraction or a crash mid-approve can no longer silently misapply it, and an encrypted upload now fails as a per-file `error` row instead of a 500. No new component, DSN, or contract — `docs/ARCHITECTURE.md` §38 and `docs/DATABASE_GUIDE.md` §1 describe the current behavior.

**CDS admin polish-2 batch landed (2026-09-02); owner acceptance still pending.** A second, full-coverage audit of the CDS admin feature (every file in `domain/cds/`, `app/cds/`, the `adapters/cds_*`/`api/routes/cds_admin.py` layer, the frontend feature, and its tests) found 37 findings; 26 are fixed here, one is a documented accepted risk, one is inherent to the two-role split, one was measured fine at current scale, and two are left as record-only comments for the next person to decide. At the behavior level: a pipeline DSN that is set but unreachable now degrades the CDS admin surface to its documented 503 instead of taking the whole app down at boot; the extraction poll loop survives a transient DB error instead of dying silently and losing all future extraction claims; a partially-successful extraction now records its true per-domain outcome instead of being stamped a total failure; the review header marks itself mixed-generation instead of naming one extraction when its domains came from different runs; approving a document that leaves some domains untouched no longer silently reverts one a concurrent re-extraction already replaced; and several admin-screen UI bugs (a stuck "Process all" state, a keyboard shortcut that could fire behind an open Reject dialog, a coverage grid that truncated at 50 rows with no notice) are fixed. `cds_library`'s schema and grant model — previously reproducible nowhere in source control — are now checked in at `deploy/seed/cds_library_schema.sql`. One thing this batch designed but deliberately did not do: apply a new partial-unique index on `cds_documents(school_year_id, pdf_sha256)` to the running database — it's verified safe against live data and lives in the seed file, but changing the live `cds_library` schema ahead of owner sign-off on the still-pending cutover acceptance above is an owner decision, so the seed file and the live database have drifted; see `TODOS.md`. Two UI fixes also still lack the real-browser confirmation the audit called for (jsdom-level tests only), and two pre-existing `live_db` test failures were found at this batch's baseline and are untriaged — both are recorded in `TODOS.md` rather than assumed closed. Full findings and disposition: `specs/cds-pipeline/plan/cds-admin-polish-2.md`.

**School-data v3 technically shipped (2026-09-08); owner acceptance is pending.** The CDS pipeline's product role is replaced end to end by a free, daily, code-typed scrape of CollegeData.com (`adapters/collegedata/`, `app/facts/`), landed across five commits (cutover + park, the facts store, the facts page/Explore rebuild, the in-process tool swap, deploy-script updates). The identity profile (`cds_library.schools`, IPEDS HD2024) is unchanged; every other structured field now comes from CollegeData, stored per-field with `observed_at` rather than packet/edition state, over a six-view reader contract (`school_profiles`, `current_school_facts`, `school_facts_sql`, `school_explore`, `school_data_status`, `fact_coverage`). The agent's DB access moved fully in-process: the `counselle-db` MCP server and its stdio transport are **deleted, not parked** (dead code once every caller is in-process, ADR 0017's no-shallow-wrapper rule) — `resolve_school`, `get_school_profile`, `get_facts` (renamed from `get_domain`), and `query_database` are now closures over `counselle_db/service.py`, verified present at `counselle_db/service.py` and `counselle_db/sql_guard.py`. **The CDS extraction system (ADR 0036) is parked, not deleted** — `domain/cds/`, `app/cds/`, `adapters/cds_*`, `api/routes/cds_admin.py` are in-tree, importable, and unit-tested, but `api/main.py` mounts neither the CDS admin router nor the CDS extraction worker, and the live `cds_library` CDS tables were dropped in the D9 nuke; exact paths, preserved data, and revival steps are `PARKED.md`. A restore-verified `pg_dump` of both pre-nuke schemas exists at `artifacts/school-data-v3/20260906T214018Z-prenuke/full.dump`, but **it has not yet been copied off this workstation** — the plan's own requirement (D9, R12) that the copy happen before anything irreversible starts is not yet satisfied, and this is an open gap, not a documented exception. Local dev now runs against a dedicated `counselle-db-v3` container (`deploy/docker-compose.dev.yml`), separate from the retired `counselle-data-pipeline` container; **Render is not provisioned** — R9 named the 2026-09-18 free-tier Postgres expiry as a Phase 4 risk and nothing has since stood up a paid instance, and Q-tier (the paid Render web-instance decision the crawler needs to ever run against production) remains an outstanding owner call, as does Q5 (ratifying acceptance of Risk R0, CollegeData's Terms-of-Use exposure — see the ADR's own "not mitigated" language). ADR 0038's status line still reads **Proposed / Draft**, not Accepted, for exactly these reasons. `specs/school-data-v3/` carries the graduated plan and its divergence record.

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

# Start the API server (serves /v1; also starts the in-process CollegeData
# facts crawl-pass worker from the FastAPI lifespan when COUNSELLE_DB_PIPELINE_DSN
# is set and COUNSELLE_FACTS_WORKER_ENABLED=true — no separate container, ADR 0038.
# The parked CDS extraction worker (COUNSELLE_CDS_WORKER_ENABLED, ADR 0036) is
# mutually exclusive with this and unmounted regardless — see PARKED.md)
uv run uvicorn api.main:create_app --factory --port 8000

# Start the frontend (separate terminal; proxies /v1 → :8000)
cd frontend && npm install && npm run dev   # http://localhost:5173

# Frontend checks
cd frontend && npm run typecheck && npm test

# Grant/revoke CDS admin access for a user (the only way to set is_superuser)
uv run python scripts/promote_admin.py --email a@b.c            # grant
uv run python scripts/promote_admin.py --email a@b.c --revoke   # revoke

# Verify the ported CDS manifest still compiles to the byte-identical hash
# (P1 hard gate — stop and escalate per plan §B2 if this ever prints a different hash)
uv run python scripts/cds_manifest_check.py
```

## Documentation map

**Read these to orient. Read `docs/ARCHITECTURE.md` for how the system is built; read `docs/DATABASE_GUIDE.md` before touching the database; read `docs/adr/` before changing any architectural decision.**

| File | What it is |
|------|-----------|
| `specs/README.md` | Index + the lifecycle convention for `specs/` (the permanent home for PRDs + plans) vs `plans/` (local scratch). Read this to know where finalized plans live |
| `specs/mvp1/PRD.md` | MVP1 product requirements: the agent's purpose, primary user, scope, the feature list, what's deferred, and the decision history/rationale from the design conversation |
| `specs/mvp2/PRD.md` | MVP2 PRD (WHAT-level): the full-stack app over the MVP1 agent — auth, home screen, the chat-experience spec (activity timeline, inline cards, citation grammar, smoothness laws), chat management, settings, the backend delta (`step`/`thinking` events, resume/cancel, chat CRUD, rate limiting), locked product decisions, and MVP2 out-of-scope |
| `docs/ARCHITECTURE.md` | The full system architecture, including the four-tool CollegeData facts-store data surface, per-field honesty boundary, live data picture, viz v2, orchestration, protocol, auth, workspace, frontend, deployment, and testing. |
| `docs/DATABASE_GUIDE.md` | Exhaustive contract for the six `cds_library` reader views: identity profile, current facts, the SQL-facing facts view, the Explore projection, data-status coverage, and fact coverage — plus availability/honesty rules, limits, and safe SQL recipes. |
| `deploy/seed/cds_library_schema.sql` | The schema-DDL and grant-model source of record for `cds_library` — every base table, index, constraint, the six reader views, and the `cds_library_app` role's exact grant (now driving the facts crawler, ADR 0038). `cds_library` is not created by this repo's yoyo migrations; this file is what makes a fresh environment provisionable. Referenced from `docs/DATABASE_GUIDE.md` §1. |
| `PARKED.md` | The register of every file, edge, and dataset parked by ADR 0038 when the CDS extraction system's runtime role was superseded — exact paths, revival steps, and the `PARKED`/`DEAD`/`LIVE` disposition rule. Read before assuming any `domain/cds`/`app/cds`/`adapters/cds_*` file is dead or safe to touch casually. |
| `specs/school-data-v3/` | The graduated school-data-v3 plan (`README.md`) plus its execution detail and divergence record (`plan/`) — the CollegeData facts store, the CDS-parking decision, and how the shipped system differs from the original plan. |
| `DESIGN.md` | **The complete frontend design system.** The four token tiers and their three laws, the five-ramp palette, surface/elevation/shape/type/spacing scales, the shell and page scaffold, component and registry rules, interaction states, motion, UX copy templates, the status-badge vocabulary, the honesty surfaces (citations, sources rail, work visibility, viz), accessibility, the numbered rule list, known debts, and the PR review checklist. **Read before writing any frontend code.** `frontend/src/styles/README.md` is its in-code companion for the token layer |
| `docs/DEPLOY.md` | The deployment guide and its open gotchas (env matrix, DB provisioning, the `--forwarded-allow-ips` trap). **Deploy itself is deferred** — this is the plan, not a tested runbook |
| `docs/research/agent-stack-evaluation.md` | The frontier-tech survey behind the stack choice: agent frameworks, model-provider abstraction, and the agent-skills ecosystem, with scorecards and the verdict |
| `docs/research/deep-research-bakeoff.md` | The 4-way quality-vs-cost comparison of open-source deep-research systems (Alibaba DeepResearch, STORM, dzhng/deep-research, GPT-Researcher) and the verdict |
| `docs/adr/README.md` | **Index of all ADRs** (number, title, one-line summary). Start here for decisions |
| `docs/adr/` | One file per architectural decision (context → decision → rationale → alternatives → consequences). Do not silently break an ADR |
| `specs/mvp1/plan/` | The MVP1 implementation plan (archived): `00-overview.md` (phases, git/milestone protocol, orchestration + model-routing rules, credentials) + one file per phase (0–7) |
| `specs/deep-research/plan.md` | Stub plan for the deferred deep-research follow-up (PRD stories 39–41) |
| `specs/mvp2/architecture.md` | The MVP2 design spec (the HOW) — merged into `docs/ARCHITECTURE.md` Part II; kept as the planning-era artifact |
| `specs/mvp2/plan/ship-plan.md` | The MVP2 execution plan (phases B0–B7): the backend delta, the §0.1 spec-gap resolutions (G1–G5), the §0.2 wire-contract summary, FE‑7 hookup, deployment, the evals/docs close-out — plus §5, the recorded B0 spike decisions |
| `specs/mvp2/plan/wire-contract.md` | The FE↔BE wire contract, field by field (B0 spike 4 output): SSE event shapes incl. `step`/`thinking`, the transcript wire shape, `/v1/config`, source-config mapping, sources/citation rules, Last-Event-ID, the receipt format, and the resolved conflicts |
| `specs/mvp3/workspace-design.md` | The MVP3 workspace design: why the workspace exists, evaluated approaches, the selected service/event architecture, open questions resolved in the plan, and the agent seam |
| `specs/mvp3/plan/workspace-implementation-plan.md` | The shipped MVP3 workspace implementation plan: backend schema/services/events, frontend wiring for Schools/Tasks/Essays/Activities, and Phase 9 close-out criteria |
| `TODOS.md` | Deferred work with full context (the session-TTL cleanup job, sessions-list load-more, the B2 turn-lifecycle corners, the community-card viz type). CI was proposed and explicitly declined — don't re-propose it |

## The three principles (inherited from the data pipeline, they apply here too)

1. **KISS — Keep It Simple, Stupid.** The smallest thing that works. No abstraction before it's needed. If a choice makes the system harder to understand, it's wrong.
2. **Never reinvent the wheel.** If a battle-tested library/tool already does it, use it. The stack (PydanticAI, LangGraph, GPT-Researcher, MCP, SKILL.md) was chosen by surveying the frontier and picking proven pieces — not hand-rolling.
3. **Startup speed over enterprise completeness.** Build for the common path; optimize only when something is actually slow. **One carve-out: the data is the product — never lie to a student.** Honesty about values, sources, and recency is non-negotiable; that's why the value-reading rules and citations live in code, not in the model's head.

## How we build: startup mode, not enterprise

We are a **startup doing rapid prototyping**. The default engineering instinct is to write robust, defensive, enterprise-grade code — **that instinct is wrong here.** Move fast.

**The one decision rule for any piece of work: value × ease.**

| | High value | Low value |
|---|---|---|
| **Easy** | ✅ do it | ✅ do it (it's cheap) |
| **Hard** | ✅ do it (it's worth it) | ❌ **don't — drop it** |

- **Reach for less code — stop at the first rung that works:** does this need to exist at all (YAGNI) → is it already in the codebase, reuse it → does the stdlib / framework / a native platform feature do it → does an already-installed dep do it → can it be a few lines. Prefer deleting code to adding it; the best change is often a smaller diff, not a bigger one. The structure rules elsewhere in this doc shape the code you *do* write — they are not license to write more of it.
- **Short means less code, never worse code.** We get there by *doing less* — reuse, deletion, the right rung — not by cutting corners. Whatever ships is still clean, modular, separated by concern, and best-practice: readable names, small focused functions and files, clear boundaries, no copy-paste, no dead ends. A short hack that rots into tech debt is *not* lazy — it's expensive, because someone pays it down later with interest. Less surface, full quality.
- **If it's low-value AND hard to do, fuck it — cut it.** Don't build machinery for problems that might happen. Build for the problem in front of you.
- **Never reinvent the wheel.** If a battle-tested library/tool does it, use it. Don't hand-roll.
- **Never write code that doesn't add much value.** No speculative abstraction, no defensive layers for edge cases that don't matter yet, no "enterprise completeness." YAGNI.
- **The honesty carve-out still holds** (principle 3): never lie to a student. That's the *one* place we spend extra effort regardless of ease — because it's the highest-value thing we have.
- **No TDD, and no reflexive tests — a test has to earn its place.** Don't write tests first, don't chase a coverage number, don't add a test for every function. Ship the feature. Write a test *only* when it genuinely pays for itself: honesty-critical packet/availability/evidence rules, a bug you want to stay fixed, or logic gnarly enough that a test is the fastest way to trust it. Skip everything else. The one hard line stays principle 3 — data-integrity code is tested hard, always.
- **Optimize for rewrite cost, not diff size.** The lazy version is right when it can be *extended* later without a rewrite. Only when the shortcut would *force* a future rewrite — global state that can't become per-user (cf. `user_id` nullable-until-platform, ADR 0019), a schema welded to one provider (ADR 0011), logic fused into a route handler — pay the *small* structural cost now. The trigger is strictly "would this force a rewrite," never "might structure help someday." Good structure is cheap future-proofing; speculative features are expensive. Do the first, skip the second.
- **Clear beats short.** "Minimal" means minimal *surface and complexity*, not fewest characters. A dense one-liner you decode at 3am is debt, not laziness. Boring and readable wins over clever and short.

When in doubt, do the simplest thing that works and ship it.

## The stack (locked — see ADRs for rationale)

- **Agent runtime:** **PydanticAI** (model-agnostic, MCP-native, typed outputs = the citation envelope) — ADR 0003.
- **Orchestration:** **LangGraph** (multi-agent deep research, `interrupt()` for visual clarifying questions, state for in-session memory) — ADR 0003.
- **Database access:** four **in-process** tools (Python, asyncpg, `cds_library_reader`) — `resolve_school`, `get_school_profile`, `get_facts`, and parameterized `query_database` — as closures over `counselle_db/service.py`, called directly by `app/`. There is no MCP server or stdio transport on this path any more: ADR 0038 retires ADR 0032/0004's MCP boundary once every remaining caller is in-process.
- **Catalog:** an atomic, immutable snapshot over the six-view facts-store reader contract (`counselle_db/catalog.py`) — school identity, per-field coverage, and fact-key/section metadata (`config/assets/facts_keys.yaml`, `facts_sections.yaml`). No manifest, packet, or edition concept on this path any more (that machinery is parked with the CDS pipeline — see `PARKED.md`). Never hardcode fact keys, section groupings, or school counts; they derive from the DB and the versioned data assets.
- **Reading rules + citations in code:** the citation envelope (every value decoded, formatted, dated; `web`/`edu`/`reddit` are source-tiered, `db` citations carry no tier — Counselle's own data) — ADR 0006.
- **External search:** **Tavily** — one search+extract backend for all 3 external searches (web / .edu / Reddit), scoped by domain (3 thin tools, no scraping); Reddit is agent-steered. Also GPT-Researcher's retriever — ADR 0015.
- **Deep research:** **GPT-Researcher**, embedded, cheap-model-routed, capped depth, DB-first; on Tavily; *not* a hosted research black box (our DB must be a first-class source) — ADR 0009. **Deferred from the MVP1 implementation plan** (stub seam in the graph; follow-up plan adds it).
- **Skills:** **SKILL.md** open standard — ADR 0010.
- **Current skill set:** public response modes `focused-answer`, `deep-research`, and `guided-counselor`; public task skills `application-rounds`, `chancing`, `costs-and-aid`, `essay-fit`, `major-and-fit`, `school-comparison`, `school-deep-dive`, `school-list`, and `testing-strategy`; internal `citation-and-recency`, `counselor-research`, and `db-recipes`. The hidden `dossier-assembly` alias exists only for parked-turn compatibility and is never advertised.
- **Model config:** model-agnostic — PydanticAI per-agent `model=` from env; **default provider Vertex AI (Google), default synthesis model Gemini 3.5 Flash** (cheap tier Gemini 2.5 Flash), any provider swappable; optional **LiteLLM** sidecar — ADR 0011.
- **Service shape:** **API-first agent service** (FastAPI) behind a **versioned SSE event protocol** (`meta`/`delta`/`viz`/`clarify`/`sources`/`usage`/`done`/`error`); every frontend is a client — ADR 0016. (MVP1 used a throwaway dev harness as that client; it was retired in MVP2 once the React frontend went real.)
- **Layering:** four layers, dependencies inward only (`domain/` pure honesty core → `app/` → `adapters/` → `api/`); use the stack's native seams, never wrap them — ADR 0017.
- **Config:** one fail-fast typed Settings surface (pydantic-settings) + versioned prompt/subreddit/season/fact-key/fact-section assets; the live data picture, fact coverage, and school-explore metadata derive from the DB — ADRs 0018, 0038.
- **Sessions:** durable from day one via LangGraph's Postgres checkpointer in `counselle.*`; `session_id` required, `user_id` nullable until the platform phase; Counselle owns its schema + migrations — ADR 0019.
- **DB:** Postgres 16. The agent path reads exactly six `cds_library` views through a reader-login role and writes only `counselle.*` through a separate DSN. The third role/DSN (`cds_library_app` / `COUNSELLE_DB_PIPELINE_DSN`) now drives the CollegeData facts crawler (ADR 0038), not the CDS admin write path — that write path (ADR 0036, superuser-gated) is parked and unmounted; the two are mutually exclusive by design and never both live.
- **Language:** Python (matches the pipeline; reuse asyncpg).
- **Models:** default **Vertex AI (Google)** — `gemini-3.5-flash` (synthesis), `gemini-2.5-flash` (cheap tier). Swappable per-agent to Anthropic (`claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5`) or others via env.

## Scope guardrails (hard, enforced in code)

- **Any profiled school in the database.** There is no tracked-school gate. Facts-store coverage is a per-field presence question (`school_data_status`, `fact_coverage`), not an edition question; absent facts fall back to official web sources with disclosure. ADR 0038.
- **Read-only.** The agent never writes to facts-store or pipeline data and reads only the six views granted to `cds_library_reader`. ADRs 0012, 0038.
- **Deferred for MVP1:** chancing, user-data personalization, agent long-term memory, essay/activity writing (PRD); plus deep research (PRD stories 39–41) — deferred from the MVP1 implementation plan to a follow-up.

## House rules

*Guiding rule: things that change together live together; things that change for different reasons stay apart. "Don't make someone edit 50 files for one change" is the test.*

- Verify before editing: do not assume file paths, imports, functions, settings, schemas, routes, or framework boilerplate exist. Search/read the current code first, then change it.
- Search before adding: before creating a new helper, service, component, endpoint, config knob, migration, or test fixture, search for an existing equivalent and extend it when that is the simpler fit.
- **Change existing code by extension, with the smallest diff.** Reuse and extend what's here; don't rewrite, restructure, or rename working code you're only passing through to make a change. Before *replacing* code, understand why it's shaped that way, then replace *deliberately* — a refactor is its own change, never smuggled into an unrelated edit. (Pairs with "search before adding": that guards against re-implementing; this guards against overwriting. Refactoring genuinely-bad code is allowed — deliberately, not incidentally.)
- **One source of truth; no magic values.** Any value a dev might reasonably tune — a limit, timeout, model id, threshold, URL, prompt, user-facing string — is named once and read from there (the ADR 0018 Settings surface or a versioned data asset), never a literal repeated across files. Values that *are* the logic and would never be "configured" stay inline. Test: *would someone change this without changing the logic?* Yes → one place; no → inline. (The frontend design-token rule below is the UI instance of this — not a second rule.)
- **DRY is about knowledge, not shape.** Centralize a rule or fact that has one reason to change. Do **not** merge two blocks that merely look alike but change for different reasons — that false-DRY couples things that should move independently. Extract on shared meaning, not coincidence.
- Use Context7 for current docs: before implementing against a library, framework, SDK, API, CLI, or cloud service, fetch the latest relevant official docs/examples through Context7. If Context7 cannot resolve it, fall back to official docs on the web.
- Files < 800 lines, functions < 50 lines; many small modules; organize by feature.
- Parameterized SQL only (never f-string SQL) — inherited from pipeline ADR 0001.
- Never log secrets. Secrets in `.env`/config only.
- Generated artifacts go in `artifacts/` only. Screenshots, Playwright captures, videos, logs, design exports, one-off HTML prototypes, temporary reports, and similar scratch output must stay in the repo-root `artifacts/` folder, which is local and gitignored. Do not drop artifacts in the repo root, `docs/`, `specs/`, `mockups/`, app source, or package folders unless they are intentionally promoted into a reviewed, permanent source/documentation asset.
- Frontend visual changes must go through the design system first — **`DESIGN.md` is the spec, read it before touching `frontend/`**. Prefer semantic tokens, shared primitives, and existing component APIs over one-off hardcoded colors, spacing, radii, or layout values in feature components. Keep UI changes clean, maintainable, DRY, and easy to evolve.
- The availability, display, compiled-context, and caveat rules in `docs/DATABASE_GUIDE.md` are the honesty spec — implement them in code and test them hard.
- Plan before non-trivial work; keep `specs/mvp1/PRD.md`, `docs/ARCHITECTURE.md`, and the ADRs current as decisions change.

## Writing the agent

- **Prompts are versioned content, not literals in control flow.** Agent prompts live as data assets (ADR 0018, `config/assets/prompts/`), so iterating on a prompt never touches the loop. Tool *descriptions* stay as the tool's docstring next to its code — that's correct and not worth externalizing; just keep them accurate, since the description is the contract the model reads.
- **Isolate the model call.** The LLM sits behind PydanticAI's per-agent `model=` seam (ADR 0011) and out of the pure `domain/` core (ADR 0017). Keep the surrounding logic deterministic and testable; don't scatter model calls through business logic.
- **Tool schemas are an API.** One tool, one clear capability; tight schema; the description is the contract the model reads. No god-tool with a mode flag. Curate the action space — enough tools to be capable, few enough to not bloat context.
- **Authz lives in the tool, never in the model.** Every workspace tool scopes to the authenticated `user_id` from turn state (`WHERE user_id = $1`), never to anything the model supplies. Authority is server-side and identity-bound.
- **Typed output at the tool boundary.** Data tools return typed, validated structures — the citation envelope (ADR 0006) is the model to follow: decode and validate at the edge, hand the rest of the system types, not raw strings.
- **Eval the agent; don't unit-test its behavior.** The eval set (`evals/`, `uv run python -m evals.runner`) is how we measure agent quality — brittle string-assert tests on model output are worse than useless. Deterministic honesty-critical tools (value-reading, citations) still get hard unit tests; everything else follows the no-TDD stance under "How we build".

## Frontend components — search registries first, never reinvent the wheel

This is principle 2 (never reinvent the wheel) made concrete for UI. **Before building any frontend component, search for an existing one — don't hand-roll what a registry already ships.**

1. **Search the shadcn MCP first, always.** Use the `shadcn` MCP (`search_items_in_registries` / `view_items_in_registries` / `get_item_examples_from_registries`) before writing any component. If it exists, use it.
2. **Default to the COSS registry for components and particles.** Search `coss` first for UI components, blocks, particles, and visual effects; use it when it fits before falling back to other registries.
3. **We're building an AI application — check `@ai-elements` after COSS.** The [AI Elements](https://elements.ai-sdk.dev/docs) registry (`@ai-elements`) ships AI-native components (conversation, message, reasoning, prompt-input, sources, …) built on shadcn. Prefer it for anything chat/agent/AI-shaped when COSS does not fit. Then fall back to `@shadcn` for plain primitives (button, tooltip, dialog, …).
4. **If the 21st.dev `magic` MCP is available, search it too, and use whichever is better.** `magic` is user/global-scoped (not committed to this repo), so it may not be present for everyone — treat it as optional: when it exists, compare its result against the shadcn/AI-Elements option and pick the better fit; when it doesn't, skip it silently.
5. **Only build custom when nothing fits.** Counselle's differentiating honesty surfaces (activity timeline, cited cards, clarify widget) are built new on the MVP3 design system — see ADR 0026. Everything commodity should come from a registry.

Registries are available from `frontend/`: `@ai-elements` is configured in `frontend/components.json`, and `@shadcn` is built into the shadcn CLI/MCP. The shadcn MCP only auto-discovers project registries when run from `frontend/`; install components from there:

```bash
cd frontend && npx shadcn@latest add @ai-elements/conversation   # or @shadcn/button
```

## Planning workflow — `plans/` vs `specs/`

Two folders, one lifecycle. Keep them straight:

- **`plans/` is local scratch.** While a feature or MVP is being actively designed and built, its plan lives here. It's ephemeral and work-in-progress — nothing in `plans/` is canonical. (Personal never-committed notes go under `plans/.local/`, which is gitignored.)
- **`specs/` is the permanent, shareable home.** When the work is **finished and verified perfect**, relocate the finalized PRD/plan to `specs/<mvp-or-feature>/` — `PRD.md` for the WHAT, `architecture.md` for the HOW (optional), `plan/` for the execution detail. This is the "we approved it, now it's implemented" record teammates rely on. See `specs/README.md`.
- **The move is the graduation.** Draft in `plans/` → ship the work → move to `specs/`. Don't let plans rot in `plans/`; if it's done, graduate it; if it's abandoned, delete it.
- **`specs/` files are historical records, not living docs.** The living system description is in `docs/` (`ARCHITECTURE.md`, `DATABASE_GUIDE.md`, `adr/`). Don't retro-edit a shipped plan's narrative — a changed decision is a new ADR or a `docs/` update.
