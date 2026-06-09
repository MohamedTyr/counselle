# ADR 0004 — The database access layer is an MCP server

**Status:** Accepted

## Context
The agent needs to read the pipeline's Postgres. The pipeline's HTTP API cannot rank/filter/aggregate/batch (see `DATABASE_GUIDE.md` §10), so the agent needs richer access. We also want a clean, testable, reusable boundary that plugs into the agent runtime the same way web/Reddit tools will.

## Decision
Build the data-access layer as a standalone **`counselle-db` MCP server** (Python, asyncpg), connected to the agent via MCP.

**Implementation note (eng review, 2026-06-10):** the tool logic lives in **`counselle_db/service.py`** as plain async Python functions returning domain types — that service layer is the real API; the MCP server is a thin shell of ~3-line tool wrappers over it. The MCP child is the seam for the **LLM's tool loop only**: in-process callers in `app/` (`render_viz`, the data calendar, tier checks) import the service directly and never round-trip through the MCP child process.

## Rationale
- MCP is the futureproof tool/transport standard (Linux-Foundation-governed, ~97M downloads/mo) and is native to PydanticAI (ADR 0003) and GPT-Researcher (ADR 0009).
- A standalone server gives a clean, independently testable boundary, reusable across the agent, future app, and CLI. (External search is handled differently — Tavily scoped by domain, ADR 0015 — but the DB earns its own server for the reading-rules/citation/scope logic.)
- It is the single place to enforce the value-reading rules, citations, vintage, coverage-tier awareness, and read-only access in code.

## Alternatives considered
- **In-process PydanticAI tools** (no separate server) — simpler, but couples the DB layer to the agent process and is harder to reuse/test/share. Partially adopted: the service layer *is* importable in-process for our own code (see the implementation note), but the LLM's tools stay behind MCP for the reusable, independently testable boundary.
- **Extend the pipeline's HTTP API** — rejected; keeps the agent coupled to the pipeline repo and the API can't do the ranking/aggregation the agent needs.

## Consequences
- One server exposes the 3 access layers (ADR 0005), field discovery (ADR 0007), and coverage-tier awareness (ADR 0002); the normalization engine + vintage resolver live in `domain/` (ADR 0006, 0017) and the service layer invokes them.
- Runs as a stdio child process of the agent service, supervised by the service lifespan (exponential-backoff restart; status surfaced in `/v1/health`). A tool call that hits a dead child gets a structured tool error, never a hang.
