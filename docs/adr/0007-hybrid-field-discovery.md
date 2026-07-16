# ADR 0007 — Hybrid field discovery: static category map + pgvector search

> **Superseded by [ADR 0032](0032-db-rewire-cds-library.md).** Historical body retained unchanged.

**Status:** Accepted

## Context
There are 1,093 fields — too many to hold in context, but the agent needs "full knowledge" of them without getting overwhelmed.

## Decision
Hybrid discovery:
- A compact **static category map** (the 17 categories + the ~90 dossier fields from `DATABASE_GUIDE.md` §7) always in context — a stable mental model for the common path.
- A **`search_fields` tool** backed by **pgvector** semantic search over the long-tail ~1,000 fields (catalog is 1,093; ~90 live in the static map), returning field key + how-to-read metadata.
- An **always-on keyword/trigram fallback** (ILIKE + `pg_trgm` over the full `fields` catalog) unioned into every `search_fields` result — embeddings are a precision booster, never the only path. A newly inserted field is discoverable immediately, even before the next reconcile run (ADR 0008), and `search_fields` keeps working if pgvector is unavailable.

## Rationale
- Gives both a curated backbone (consistent, fast dossiers) and semantic precision for the long tail (e.g. "aid for low-income students" matches "Pell"-type fields that keyword search would miss).
- pgvector reuses the existing Postgres — no new infra (KISS).

## Alternatives considered
- **Semantic search only** — agent rediscovers structure every turn; uneven dossiers.
- **Static map + keyword/trigram only** — adopted as the always-on fail-safe layer, but insufficient alone for the long tail (misses semantic matches); the hybrid adds pgvector on top.
- **Dump the full catalog** — overwhelms context.

## Consequences
- Requires embedding the field catalog (small, static-ish) and keeping it current — see ADR 0008 (which also records the embedding model's dimensionality/normalization constraint).
- The embedding model + version are pinned; changing them re-embeds (ADR 0008).
