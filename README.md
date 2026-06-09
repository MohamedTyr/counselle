# Counselle

**Counselle** is an AI agent for the US college-admissions process — a thinking and
answering partner about US universities for student applicants. It can reason about
any of the ~2,746 schools in its database: admissions, costs, outcomes, campus life,
and everything in between — always honest about values, sources, and recency.

Counselle is an independent, API-first agent service. It is a **read-only consumer**
of the existing data pipeline's Postgres database (shared credentials only — no shared
code, config, or runtime dependency).

## Run the tests

```bash
uv run pytest
```

## Where to read more

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the system is built (stack, layering, data access, event protocol)
- [`PRD.md`](PRD.md) — product requirements and decision history
- [`plans/mvp1/`](plans/mvp1/) — the MVP1 implementation plan (phases 0–7)
- [`docs/adr/`](docs/adr/) — architectural decision records
