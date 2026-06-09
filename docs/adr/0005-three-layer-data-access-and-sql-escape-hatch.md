# ADR 0005 — Three-layer data access, including a guarded SQL escape hatch in MVP1

**Status:** Accepted

## Context
The PRD wants the agent to "do any search it wants / full control" over the DB, intuitively, without getting overwhelmed by 1,000+ fields — while never misreading values. Raw SQL gives full power but risks misreads; curated tools are safe but rigid. The HTTP API can't rank/filter/aggregate.

## Decision
Expose the DB through **three layers** in the `counselle-db` MCP server, and **include the guarded SQL escape hatch in MVP1**:
1. **Field discovery** — `search_fields` (ADR 0007).
2. **Safe typed tools** — `resolve_school`, `get_values`, `get_dossier`, `compare_schools`, `find_schools`, `national_benchmark`, `get_programs`, `get_diversity` — each normalized + cited (ADR 0006) and coverage-tier-aware (ADR 0002). Plus `get_data_calendar` (read-only; the per-source recency table used for temporal context) — 10 tools total with layers 1 and 3.
3. **Guarded SQL escape hatch** — `query_database(sql, params)`: read-only, parameterized, statement-timeout, row-cap (no scope gate — any in-database school; ADR 0002).

## Rationale
- Rails (layers 1–2) cover ~90% safely and cheaply; the escape hatch (layer 3) covers the long tail (arbitrary ranking/filtering/aggregation, deep research over the DB) that the API and typed tools don't.
- Including the escape hatch in MVP1 directly realizes "full control / any search," chosen explicitly over a rails-only MVP.

## Alternatives considered
- **Rails-only MVP1** (add SQL later) — safer but less flexible; rejected because "full control" is a stated requirement.
- **Raw-SQL-only** — maximal power but the LLM would have to remember every reading rule each query → misreads; rejected.

## Consequences
- The escape hatch bypasses the normalization engine, so it exposes decode/vintage SQL helpers (`decode_ipeds`, `value_vintage`) and a "reading rules still apply" tool note; its use should stay rare. Guardrails: `counselle_ro` role (ADR 0012), timeout, row cap. (No scope predicate — ADR 0002 revised; the agent may query any in-database school.)
