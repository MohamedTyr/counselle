# Counselle

Counselle is an AI agent for the US college-admissions process — a thinking and answering partner about US universities for student applicants. It reasons about any of the ~2,746 schools in its database (admissions, costs, outcomes, campus life, and everything in between), and is **always honest about values, sources, and recency** — that honesty is enforced in code, not left to the model.

It is two pieces:

- **The agent** (this repo) — an API-first FastAPI service behind a versioned SSE event protocol, plus a React/Vite frontend that consumes it. Read-only consumer of the pipeline's Postgres database.
- **The data pipeline** (separate repo, `ascensia-data-pipeline`) — owns the database. Counselle shares only credentials with it (the read-only DB DSN and Vertex/GCP keys); no shared code, no runtime dependency. The database is the contract — see `docs/DATABASE_GUIDE.md`.

## Project layout

| Path | What lives here |
|------|-----------------|
| `domain/` | The pure honesty core — citation envelope, value-reading rules, events, render specs. No I/O. |
| `app/` | Agent orchestration — the turn lifecycle, step/thinking emission, turn registry, transcript builder, runtime wiring. |
| `adapters/` | External integrations — Tavily search, email, model-provider seams. |
| `counselle_db/` | The `counselle-db` MCP server + its in-process service layer (read-only DB access, field discovery, the guarded SQL escape hatch). |
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
- **Node 20+** and **npm** (for the frontend)
- **Postgres 16** with the **pgvector** extension running on `localhost:5432` (the data-pipeline DB)
- The `counselle_ro` and `counselle_app` roles and the `counselle.*` schema provisioned — run `scripts/setup_db.sql` once, then apply migrations with `yoyo`:

```bash
psql postgres < scripts/setup_db.sql
# Append ?schema=counselle so yoyo keeps its bookkeeping tables in the
# counselle schema (owned by counselle_app), not in public.
uv run yoyo apply --batch --database "${COUNSELLE_DB_APP_DSN}?schema=counselle" migrations/
```

## Environment setup

```bash
cp .env.example .env
# Required to start the server:
#   COUNSELLE_DB_RO_DSN     — read-only DSN to the pipeline Postgres (counselle_ro)
#   COUNSELLE_DB_APP_DSN    — read-write DSN for Counselle's own counselle.* schema
#   COUNSELLE_VERTEX_API_KEY — Vertex express-mode API key (or GOOGLE_APPLICATION_CREDENTIALS)
#   COUNSELLE_JWT_SECRET    — JWT cookie signing secret, ≥32 bytes
#                             generate: python -c "import secrets; print(secrets.token_urlsafe(48))"
# Required only when an external source is enabled:
#   COUNSELLE_TAVILY_API_KEY
# Optional (Google login mounts only when both are set):
#   COUNSELLE_GOOGLE_OAUTH_CLIENT_ID / _SECRET
#     redirect URI to register: http://localhost:8000/v1/auth/google/callback
# See .env.example for every knob and its default.
```

The frontend has its own env file:

```bash
cp frontend/.env.example frontend/.env   # VITE_TRANSPORT=http (the real backend)
```

## Run it (local dev)

The backend serves the `/v1` API; the frontend runs on Vite and proxies `/v1` to it. Run both in separate terminals:

```bash
# Terminal 1 — the API
uv run uvicorn api.main:create_app --factory --port 8000

# Terminal 2 — the frontend
cd frontend
npm install        # first time only
npm run dev        # http://localhost:5173 (proxies /v1 → :8000)
```

Then open **http://localhost:5173**.

> Note: serving the built SPA same-origin from the backend (one deployable, ADR 0023) is **planned but not yet built** — that is part of the deferred deploy phase. In local dev the two run side by side as above.

## Tests

```bash
# Routine suite — no live LLM or Tavily calls (~$0.00):
uv run pytest -m "not live_llm and not live_search"

# Full suite including live Gemini and Tavily (~$0.50):
uv run pytest

# Lint + type-check:
uv run ruff check . && uv run mypy .

# Frontend:
cd frontend && npm run typecheck && npm test
```

## Run the eval set

A 50-question eval over the live DB + Gemini. Produces `evals/report-<date>.json` and a Markdown summary. Expect ~$2–3 in Gemini/Tavily spend.

```bash
uv run python -m evals.runner
```

## Where to read more

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the system is built (stack, layering, data access, event protocol), in two parts: Part I (MVP1 agent) and Part II (MVP2 full-stack app)
- [`docs/DATABASE_GUIDE.md`](docs/DATABASE_GUIDE.md) — the data contract: every table, the field catalog, value-reading rules, gotchas
- [`docs/adr/`](docs/adr/) — the 23 architectural decision records (start at `docs/adr/README.md`)
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — the deployment guide and its open gotchas (deploy itself is deferred)
- [`specs/`](specs/) — the permanent PRDs and implementation plans for every MVP/feature ([`specs/README.md`](specs/README.md))
- [`TODOS.md`](TODOS.md) — deferred work with full context
