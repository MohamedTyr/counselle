# Counselle

Counselle is an AI agent for the US college-admissions process — a thinking and answering partner about US universities for student applicants. It resolves any profiled school and answers from stable identity (IPEDS) plus whatever CollegeData-sourced facts are present for that school, with official-web fallback for missing facts. Honesty about values, sources, and coverage is enforced in code. There is no retrieval-augmented generation in this path — facts are read straight through typed views.

It is two pieces, both in this repo:

- **The agent** — an API-first FastAPI service behind a versioned SSE event protocol, plus a React/Vite frontend that consumes it. It is a strictly read-only consumer of the facts store's Postgres database (schema `cds_library`), connecting through a dedicated reader role over exactly six reader views, called in-process (no MCP server on this path) — see `docs/DATABASE_GUIDE.md`.
- **The CollegeData facts crawler** (`adapters/collegedata/`, `app/facts/`) — the writer that produces the data the agent reads: a free, rate-limited, `httpx`+`tenacity` daily scrape of CollegeData.com with change detection, no LLM anywhere in ingestion. It writes through its own Postgres role and DSN, isolated from the agent's read path by both code and credentials — see `docs/adr/0038-collegedata-facts-store-cds-parked.md`.

**Also in this repo, parked (not deleted):** the CDS extraction pipeline and admin tool (`domain/cds/`, `adapters/cds_*`, `app/cds/`, `api/routes/cds_admin.py`) built under ADR 0036 — in-tree, importable, unit-tested, but unmounted at runtime and not reachable from any route. See `PARKED.md` for exactly what's parked and how to revive it, and ADR 0038 for why.

## Project layout

| Path | What lives here |
|------|-----------------|
| `domain/` | The pure honesty core — value/caveat types, events, and render specs. No I/O. Also `domain/cds/`: the parked extraction pipeline's pure types (ADR 0036, PARKED.md); `domain/sat/`: SAT practice's ported pure logic — grading, question normalization, statistics, the SPR rationale-key extractor, the progress-file codec (ADR 0044). |
| `app/` | Agent orchestration — the turn lifecycle, step/thinking emission, turn registry, transcript builder, runtime wiring. Also `app/facts/`: the CollegeData crawl, crosswalk, and Explore/admin services (ADR 0038); `app/cds/`: the parked extraction/review/approval flow; `app/sat/`: the SAT question-bank fetch/build/audit/sync pipeline and its services — read by no agent tool. |
| `adapters/` | External integrations — Tavily search, email, model-provider seams. `adapters/collegedata/`: the CollegeData fetcher/parser. `adapters/facts_store.py` + `adapters/*facts_queries.py`: the `cds_library` facts write/read layer. Also `adapters/cds_*`: the parked extraction pipeline's PDF parsing and LLM call; `adapters/collegeboard/`: the SAT question-bank fetch client. |
| `counselle_db/` | In-process service layer only (no MCP server) — four read-only tools over the facts store's six `cds_library` reader views. |
| `api/` | The FastAPI service — routers, auth (fastapi-users), the SSE protocol, rate limiting, lifespan. |
| `config/` | The typed Settings surface (`settings.py`) + versioned data assets (prompts, subreddit menu, season table) in `config/assets/`. |
| `migrations/` | yoyo migrations for Counselle's own `counselle.*` schema. |
| `frontend/` | The React/Vite SPA (a vendored LibreChat clone — see `frontend/src/vendor/librechat/UPSTREAM.md`). |
| `evals/` | The eval runner and its reports. |
| `skills/` | Agent skills in the SKILL.md open standard. |
| `scripts/` | DB setup (`setup_db.sql`), smoke scripts, the chat CLI. |
| `specs/` | **Permanent, shareable PRDs + plans** for every MVP/feature (see `specs/README.md`). |
| `plans/` | **Local scratch** for work-in-progress planning only (see `plans/README.md`). |
| `docs/` | Living documentation — architecture, the database guide, ADRs, research, deployment. |
| `tests/` | The pytest suite. |

## Prerequisites

- **Python 3.12+** and **[uv](https://github.com/astral-sh/uv)**
- **Node 22.12+** and **npm** (for the frontend)
- **Postgres 16** — a local dev instance is provided by `deploy/docker-compose.dev.yml` (container `counselle-db-v3`, port `5433` by default via `COUNSELLE_DB_PORT`, and note that port is only a default — pick a free one if something else on your machine already holds it), containing the facts-store `cds_library` schema and Counselle's application schema. `./scripts/dev.py` (below) manages this container for you; the manual steps below are for a from-scratch bootstrap.
- A LOGIN role that is a member only of `cds_library_reader`, plus the `counselle_app` role and `counselle.*` schema. On a genuinely fresh database, first create the `cds_library` schema itself — this repo's own yoyo migrations never touch it (see `docs/DATABASE_GUIDE.md` §1) — then run `scripts/setup_db.sql` for role/grant bootstrap, then apply migrations with `yoyo`:

```bash
# Fresh database only: cds_library's own schema/tables/views/function
# (source of record — see docs/DATABASE_GUIDE.md §1). Skip this step
# against a database that already has cds_library populated.
psql "$COUNSELLE_DB_ADMIN_DSN" -f deploy/seed/cds_library_schema.sql

# setup_db.sql reads role passwords from the environment via \getenv (see
# the script header) — never pass them as psql -v argv. Supply the two
# required passwords, matching the passwords in your .env DSNs.
# COUNSELLE_PIPELINE_PASSWORD is optional — set it to also give `cds_library_app`
# LOGIN (ADR 0038: it now drives the CollegeData facts crawler, not the parked
# CDS admin write path); omit it and that role is created NOLOGIN (present but inert).
#
# WARNING: roles and passwords are cluster-global, not database-local — this
# script rewrites counselle_ro/counselle_app/cds_library_app cluster-wide.
# Point it only at a scratch/local Postgres instance you own, never at a
# shared cluster (see the script's own header comment).
COUNSELLE_RO_PASSWORD="<facts-store reader-login password>" \
COUNSELLE_APP_PASSWORD="<counselle_app password>" \
COUNSELLE_PIPELINE_PASSWORD="<cds_library_app password, optional>" \
  psql "$COUNSELLE_DB_ADMIN_DSN" -f scripts/setup_db.sql
# Append ?schema=counselle so yoyo keeps its bookkeeping tables in the
# counselle schema (owned by counselle_app), not in public.
uv run yoyo apply --batch --database "${COUNSELLE_DB_APP_DSN}?schema=counselle" migrations/
```

The manual recipe above is superseded for local dev by `./scripts/dev.py reset-db`, which drives
`scripts/setup_db.sql` and `deploy/seed/cds_library_schema.sql` against `COUNSELLE_DB_ADMIN_DSN`
for you (see "Run it" below). The earlier CDS Library DB-rewire cutover (ADR 0032, the
`artifacts/db-rewire/20260716T205303Z-round3-cleanup/` evidence, its "traffic remains closed"
status) is superseded: school-data-v3 (ADR 0038) nuked and rebuilt both `cds_library` and
`counselle.*` from a fresh seed, so that earlier evidence describes a database generation that no
longer exists. School-data-v3 itself is **technically shipped but owner acceptance is still
pending** — see the AGENTS.md/CLAUDE.md Status section for what remains open.

## Environment setup

```bash
cp .env.example .env
# Required to start the server:
#   COUNSELLE_DB_RO_DSN     — LOGIN member of cds_library_reader (six views only)
#   COUNSELLE_DB_APP_DSN    — read-write DSN for Counselle's own counselle.* schema
#   COUNSELLE_FIREWORKS_API_KEY — every live model call goes to Fireworks
#                             (required outside development; in development
#                             the first model call fails without it)
#   COUNSELLE_JWT_SECRET    — JWT cookie signing secret, ≥32 bytes
#                             generate: python -c "import secrets; print(secrets.token_urlsafe(48))"
# Required only when an external source is enabled:
#   COUNSELLE_TAVILY_API_KEY
# Optional (Google login mounts only when both are set):
#   COUNSELLE_GOOGLE_OAUTH_CLIENT_ID / _SECRET
#     redirect URI to register: http://localhost:8000/v1/auth/google/callback
# See .env.example for every knob and its default.
```

The frontend needs no separate env file for the standard local setup. Its Vite
server uses the real backend through the local `/v1` proxy by default.

## Run it (local dev)

Start the complete development stack with one command:

```bash
./scripts/dev.py
```

The launcher syncs locked Python and frontend dependencies, validates the toolchain,
configuration, wakes the existing local database container when needed, applies
pending Counselle-schema migrations, selects safe ports,
starts both hot-reloading servers, waits for real health, opens the app, prefixes
their live logs, and shuts down the entire stack on `Ctrl+C`.
Run `./scripts/dev.py --help` for port overrides, check-only mode, and other options.
Automatic migrations are limited to local databases unless explicitly authorized
with `--allow-remote-migrations`.
If Google OAuth is enabled and the launcher selects a non-default API port, register
the callback URL using the displayed API port instead of `8000`.

The backend serves the `/v1` API; the frontend runs on Vite and proxies `/v1` to it.
To run them separately instead:

```bash
# Terminal 1 — the API
uv run uvicorn api.main:create_app --factory --port 8000

# Terminal 2 — the frontend
cd frontend
npm install        # first time only
npm run dev        # http://localhost:5173 (proxies /v1 → :8000)
```

Then open **http://localhost:5173**.

The local Vite origin is accepted for auth POSTs by default while
`COUNSELLE_COOKIE_SECURE=false`. If you bypass the Vite proxy and call the API
cross-origin from the browser, keep `COUNSELLE_CORS_ORIGINS=["http://localhost:5173"]`.
For production same-origin serving, set `COUNSELLE_COOKIE_SECURE=true` and leave
`COUNSELLE_CORS_ORIGINS` empty unless you intentionally split the frontend origin.

> Note: serving the built SPA same-origin from the backend (one deployable, ADR 0023) is **planned but not yet built** — that is part of the deferred deploy phase. In local dev the two run side by side as above.

## Tests

```bash
# Routine suite — no live LLM, Tavily, or live DB calls (~$0.00):
uv run pytest -m "not live_llm and not live_search and not live_db"

# Coverage visibility for the routine suite (not a merge gate):
uv run pytest -m "not live_llm and not live_search and not live_db" --cov --cov-report=term-missing

# Full suite including the live model and Tavily (~$0.50):
uv run pytest

# Lint + type-check:
uv run ruff check . && uv run mypy .

# Security scan (bandit) over the backend source:
uv run bandit -r app api counselle_db config adapters domain -q

# Frontend:
cd frontend && npm run typecheck && npm test
```

## Run the eval set

An eval over the live DB + the live model (the question set in `evals/questions.yaml`). Produces `evals/report-<date>[-<mode>]-<reasoning effort>.json` and a Markdown summary. It costs a few dollars in model and Tavily spend.

```bash
uv run python -m evals.runner
```

## Where to read more

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the system is built (stack, layering, data access, event protocol), in two parts: Part I (MVP1 agent) and Part II (MVP2 full-stack app)
- [`docs/DATABASE_GUIDE.md`](docs/DATABASE_GUIDE.md) — the six-view `cds_library` facts-store contract, availability rules, and safe SQL recipes
- [`docs/adr/`](docs/adr/) — the 38 architectural decision records (start at `docs/adr/README.md`)
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — the deployment guide and its open gotchas (deploy itself is deferred)
- [`PARKED.md`](PARKED.md) — the register of everything parked when the CDS extraction system's runtime role was superseded (ADR 0038), with exact paths and revival steps
- [`specs/`](specs/) — the permanent PRDs and implementation plans for every MVP/feature ([`specs/README.md`](specs/README.md)), including [`specs/school-data-v3/`](specs/school-data-v3/) for this generation
- [`TODOS.md`](TODOS.md) — deferred work with full context
