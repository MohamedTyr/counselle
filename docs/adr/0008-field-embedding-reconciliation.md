# ADR 0008 — Field embeddings are a self-healing derived cache (reconciliation)

**Status:** Accepted

## Context
Fields will be added (and edited) over time. We must guarantee a new field is always discoverable — ideally always in the vector index — without anyone remembering to re-embed.

## Decision
Treat the vector index as a **derived, self-healing cache of the `fields` table**, with a keyword fallback as a hard guarantee.

- A `counselle.field_index` table (pgvector): `field_key`, `content_hash`, `embedding`, `embed_model_version`. The hash covers the content string `label | category | data_type | source | raw_column` plus the embed-model version (so a model swap triggers a full safe re-embed).
- `reconcile_field_index()` diffs `fields` vs `field_index` by hash: embeds **missing or changed** rows, drops removed ones. Idempotent; embeds only the delta (usually zero → near-free); catches edited labels; an embed-model swap triggers a safe full re-embed.
- Runs on **service startup**, an **in-process interval task** (~20 min, configurable), and a **manual endpoint** (`POST /v1/admin/reconcile`).
- **Embedding adapter constraint (verified against `gemini-embedding-001`):** the model outputs 3072 dimensions by default and does **not** normalize outputs at non-default dimensionalities. The adapter MUST (a) pass `output_dimensionality` (Settings, default 768) on **every** embed call — catalog documents *and* search queries — and (b) **L2-normalize** the returned vectors before storage and before cosine-distance queries. Failing either silently degrades search quality. Unit-tested: output length = configured dims, L2 norm ≈ 1.0.
- **Fail-safe:** `search_fields` always has a **keyword/trigram fallback over the full `fields` catalog** (complete the instant a field is inserted) + the static map. A new field is discoverable *immediately* by keyword even before the next reconcile — embeddings are a precision booster, not the only path.

## Rationale
The `fields` table is the source of truth; the vector index must never drift or hide a field. Reconciliation keeps it current; the keyword fallback guarantees discoverability in the gap.

## Consequences
- New fields are never invisible.
- Reconciliation cost is trivial (tiny catalog, delta-only).
