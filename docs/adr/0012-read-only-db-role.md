# ADR 0012 — The agent uses a dedicated read-only DB role

**Status:** Accepted

## Context
The agent reads the pipeline's Postgres and has a SQL escape hatch (ADR 0005). It must never mutate pipeline data and must be safe against runaway queries.

## Decision
Counselle is its **own Python service** connecting to the pipeline's Postgres through a dedicated **read-only role `counselle_ro`**:
- `GRANT SELECT` on `public.*` and these `raw.*` tables: `raw.scorecard_fos`, `raw.ipeds_ef2024a` (multi-row data), `raw.ipeds_valuesets24`, `raw.ipeds_vartable24` (decoding dicts), `raw.files`, `raw.ipeds_hd2024`, `raw.ipeds_flags2024` (provenance/identity).
- `default_transaction_read_only = on`; a **statement timeout** (default 8 s); a **row cap** (default 500) on the escape hatch — both configurable via Settings (ADR 0018).
- Never the pipeline's write role.

## Rationale
- Hard isolation: the agent cannot write, drop, or lock pipeline tables; a runaway query is bounded by the timeout/row cap.
- Parameterized SQL only (inherited pipeline ADR 0001) is enforced in the agent's DB layer.

## Alternatives considered
- Reuse the pipeline's `ascensia` role — rejected (write access, no isolation).
- A read replica — deferred; a later optimization if agent load competes with the pipeline.

## Consequences
- pgvector for field search lives in a Counselle-owned schema (`counselle.field_index`) in the same Postgres; `counselle_ro` can read it (and a separate role writes embeddings during reconciliation).
