# Counselle

Counselle is an AI agent for the US college-admissions process — a thinking and answering partner about US universities for student applicants. It resolves any profiled school and answers from stable identity plus whatever evidence-backed CDS domains its selected edition actually covers, with official-web fallback for missing or current facts. Honesty about values, sources, editions, and coverage is enforced in code.

It is two pieces:

- **The agent** (this repo) — an API-first FastAPI service behind a versioned SSE event protocol, plus a React/Vite frontend that consumes it. Read-only consumer of the pipeline's Postgres database.
- **The CDS Library pipeline** (separate repo, `counselle-data-pipeline`) — owns the database. Counselle shares credentials only; no shared code, config, or runtime dependency. Five reader views are the contract — see `docs/DATABASE_GUIDE.md`.

## Project layout

| Path | What lives here |
|------|-----------------|
| `domain/` | The pure honesty core — packet/value/evidence/caveat types, events, and render specs. No I/O. |
| `app/` | Agent orchestration — the turn lifecycle, step/thinking emission, turn registry, transcript builder, runtime wiring. |
| `adapters/` | External integrations — Tavily search, email, model-provider seams. |
| `counselle_db/` | The `counselle-db` MCP server + in-process service layer: four read-only tools over the CDS Library's five reader views. |
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
- **Postgres 16** running on `localhost:5433` by default, containing the independently deployed CDS Library and Counselle's application schema
- A LOGIN role that is a member only of pipeline-managed `cds_library_reader`, plus the `counselle_app` role and `counselle.*` schema. Run `scripts/setup_db.sql` for Counselle-owned state, then apply migrations with `yoyo`:

```bash
# setup_db.sql reads both role passwords from the environment via \getenv (see
# the script header) — never pass them as psql -v argv. Supply both, matching
# the passwords in your .env DSNs.
COUNSELLE_RO_PASSWORD="<CDS Library reader-login password>" \
COUNSELLE_APP_PASSWORD="<counselle_app password>" \
  psql "$COUNSELLE_ADMIN_DSN" -f scripts/setup_db.sql
# Append ?schema=counselle so yoyo keeps its bookkeeping tables in the
# counselle schema (owned by counselle_app), not in public.
uv run yoyo apply --batch --database "${COUNSELLE_DB_APP_DSN}?schema=counselle" migrations/
```

The local CDS Library cutover is technically complete, but Counselle traffic remains
closed pending final technical gates and explicit owner acceptance. The current protected
cleanup evidence is under `artifacts/db-rewire/20260716T205303Z-round3-cleanup/`.
Two post-boundary sessions whose ownership could not be proven were retained, so zero-loss
rollback has expired; do not switch back to the old DSN and discard new writes.

## Environment setup

```bash
cp .env.example .env
# Required to start the server:
#   COUNSELLE_DB_RO_DSN     — LOGIN member of cds_library_reader (five views only)
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

# Full suite including live Gemini and Tavily (~$0.50):
uv run pytest

# Lint + type-check:
uv run ruff check . && uv run mypy .

# Security scan (bandit) over the backend source:
uv run bandit -r app api counselle_db config adapters domain -q

# Frontend:
cd frontend && npm run typecheck && npm test
```

## Run the eval set

An eval over the live DB + Gemini (the question set in `evals/questions.yaml`). Produces `evals/report-<date>.json` and a Markdown summary. Expect ~$2–3 in Gemini/Tavily spend.

```bash
uv run python -m evals.runner
```

## Where to read more

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the system is built (stack, layering, data access, event protocol), in two parts: Part I (MVP1 agent) and Part II (MVP2 full-stack app)
- [`docs/DATABASE_GUIDE.md`](docs/DATABASE_GUIDE.md) — the five-view CDS Library contract, packet/availability/evidence rules, and safe SQL recipes
- [`docs/adr/`](docs/adr/) — the 32 architectural decision records (start at `docs/adr/README.md`)
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — the deployment guide and its open gotchas (deploy itself is deferred)
- [`specs/`](specs/) — the permanent PRDs and implementation plans for every MVP/feature ([`specs/README.md`](specs/README.md))
- [`TODOS.md`](TODOS.md) — deferred work with full context
