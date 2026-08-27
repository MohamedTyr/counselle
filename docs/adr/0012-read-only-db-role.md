# ADR 0012 — The agent uses a dedicated read-only DB role

**Status:** Accepted

> **Old-data note (ADR 0032):** the isolation decision — a dedicated read-only role,
> never the pipeline's write role, statement timeout + row cap on the escape hatch —
> still holds. The specific role name, `raw.*` table grants, and pgvector schema below
> describe the retired field store and its embedding index. The current role is
> `cds_library_reader`, granting `SELECT` on exactly the five `cds_library.*` reader
> views and nothing else; there is no `field_index` schema or embedding writer role.
> See `DATABASE_GUIDE.md` §1.
>
> **Amendment (ADR 0036):** this ADR's "read-only" decision describes the **agent's
> own** database connection, which is still true without qualification — the agent
> never writes, drops, or locks anything. Since ADR 0036, the Counselle codebase as a
> whole also contains a separate, superuser-gated admin write path
> (`app/cds/`, `adapters/cds_store.py`, `api/routes/cds_admin.py`) that writes
> `cds_library` base tables through its own Postgres role and DSN
> (`cds_library_app` / `COUNSELLE_DB_PIPELINE_DSN`), isolated from the agent's
> connections by both role and code. This ADR is not reversed; it is narrowed to the
> scope it always actually governed.

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
