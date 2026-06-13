# Counselle

Counselle is an AI agent for the US college-admissions process — a thinking and answering partner about US universities for student applicants. It can reason about any of the ~2,746 schools in its database (admissions, costs, outcomes, campus life, and everything in between), always honest about values, sources, and recency. It is an API-first service; the `harness/` chat page is the throwaway dev client.

## Prerequisites

- **Python 3.12+** and **[uv](https://github.com/astral-sh/uv)**
- **Postgres 16** with the **pgvector** extension running on `localhost:5432` (the data pipeline DB)
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
# Fill in COUNSELLE_DB_RO_DSN, COUNSELLE_DB_APP_DSN, COUNSELLE_VERTEX_API_KEY,
# and COUNSELLE_TAVILY_API_KEY (required when any external source is enabled).
# See .env.example for every knob and its default.
```

## Run the server

```bash
uv run uvicorn api.main:create_app --factory --port 8000
```

Dev harness chat: **http://localhost:8000/harness/**

## Tests

```bash
# Routine suite — no live LLM or Tavily calls (~$0.00):
uv run pytest -m "not live_llm and not live_search"

# Full suite including live Gemini and Tavily (~$0.50):
uv run pytest
```

## Run the eval set

50-question eval over the live DB + Gemini. Produces `evals/report-<date>.json` and a Markdown summary. Expect ~$2–3 in Gemini/Tavily spend.

```bash
uv run python -m evals.runner
```

## Container build

```bash
podman build -f Containerfile -t counselle .
# or: docker build -f Containerfile -t counselle .
```

## Where to read more

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the system is built (stack, layering, data access, event protocol)
- [`PRD.md`](PRD.md) — product requirements and decision history
- [`plans/archive/mvp1/`](plans/archive/mvp1/) — the MVP1 implementation plan (phases 0–7, archived)
- [`docs/adr/`](docs/adr/) — architectural decision records
