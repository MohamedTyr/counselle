# ADR 0005 — Three-layer data access, including a guarded SQL escape hatch

**Status:** Accepted

> **Old-data note (ADR 0032):** the layered shape below — safe typed tools plus a
> guarded SQL escape hatch — still holds, but the specific tool roster and field
> counts describe the retired wide field store. The current surface is exactly four
> tools: `resolve_school`, `get_school_profile`, `get_domain`, and guarded
> `query_database`. There is no separate field-discovery layer (`search_fields` is
> gone — the manifest is the dynamic catalog) and no `get_dossier` /
> `national_benchmark` / `get_diversity` style tool set. See `DATABASE_GUIDE.md` for
> the current contract.

## Context
The PRD wants the agent to "do any search it wants / full control" over the DB, intuitively, without getting overwhelmed by 1,000+ fields — while never misreading values. Raw SQL gives full power but risks misreads; curated tools are safe but rigid. The HTTP API can't rank/filter/aggregate.

## Decision
Expose the DB through **three layers** in the `counselle-db` MCP server, and **include the guarded SQL escape hatch**:
1. **Field discovery** — `search_fields` (ADR 0007).
2. **Safe typed tools** — `resolve_school`, `get_values`, `get_dossier`, `compare_schools`, `find_schools`, `national_benchmark`, `get_programs`, `get_diversity` — each normalized + cited (ADR 0006) and coverage-tier-aware (ADR 0002). Plus `get_data_calendar` (read-only; the per-source recency table used for temporal context) — **11 tools total — Layer 1: `search_fields`; Layer 2: 8 typed tools + `get_data_calendar`; Layer 3: `query_database`.**
3. **Guarded SQL escape hatch** — `query_database(sql, params)`: read-only, parameterized, statement-timeout, row-cap (no scope gate — any in-database school; ADR 0002).

## Rationale
- Rails (layers 1–2) cover ~90% safely and cheaply; the escape hatch (layer 3) covers the long tail (arbitrary ranking/filtering/aggregation, deep research over the DB) that the API and typed tools don't.
- Including the escape hatch directly realizes "full control / any search," chosen explicitly over a rails-only approach.

## Alternatives considered
- **Rails-only** (add SQL later) — safer but less flexible; rejected because "full control" is a stated requirement.
- **Raw-SQL-only** — maximal power but the LLM would have to remember every reading rule each query → misreads; rejected.

## Consequences
- The escape hatch bypasses the normalization engine, so it exposes decode/vintage SQL helpers (`decode_ipeds`, `value_vintage`) and a "reading rules still apply" tool note; its use should stay rare. Guardrails: `counselle_ro` role (ADR 0012), timeout, row cap. (No scope predicate — ADR 0002 revised; the agent may query any in-database school.)
