"""Self-healing reconciler for ``counselle.field_index`` (ADR 0008).

The vector index is a derived cache of ``public.fields``: hash-diff the catalog
against the index, embed only the delta, drop vanished keys. Idempotent — the
usual run embeds nothing. A changed embed-model version is part of every hash,
so a model swap naturally re-embeds the whole catalog.

The diff itself is a pure function (:func:`plan_reconcile`) so it unit-tests
without a database; the DB I/O around it stays thin.
"""

import hashlib
from collections.abc import Mapping, Sequence
from typing import NamedTuple

import asyncpg
import structlog

from adapters.embeddings import BATCH_SIZE, embed_model_version, embed_texts
from config.settings import get_settings
from counselle_db.db import vector_literal

logger = structlog.get_logger(__name__)

_FIELDS_SQL = """
SELECT key, label, category, data_type, source, raw_column
FROM fields WHERE enabled
"""

_INDEX_SQL = "SELECT field_key, content_hash FROM counselle.field_index"

# The embedding travels as a pgvector text literal ('[0.1,0.2,...]') cast in SQL —
# the simplest reliable path with asyncpg (no codec registration needed).
_UPSERT_SQL = """
INSERT INTO counselle.field_index
  (field_key, content_hash, embedding, embed_model_version, updated_at)
VALUES ($1, $2, $3::vector, $4, now())
ON CONFLICT (field_key) DO UPDATE SET
  content_hash = EXCLUDED.content_hash,
  embedding = EXCLUDED.embedding,
  embed_model_version = EXCLUDED.embed_model_version,
  updated_at = now()
"""

_DELETE_SQL = "DELETE FROM counselle.field_index WHERE field_key = ANY($1)"


class FieldToEmbed(NamedTuple):
    """One catalog row the index is missing or holds stale (re-embed it)."""

    field_key: str
    content: str
    content_hash: str


class ReconcilePlan(NamedTuple):
    """The pure diff of catalog vs index — what to embed, drop, leave alone."""

    to_embed: list[FieldToEmbed]
    to_delete: list[str]
    unchanged: int


def field_content(row: Mapping[str, object]) -> str:
    """The exact content string we embed (ADR 0008 — order matters for the hash)."""
    return (
        f"{row['label']} | {row['category']} | {row['data_type']} | "
        f"{row['source']} | {row['raw_column'] or ''}"
    )


def content_hash_for(content: str, version: str) -> str:
    """sha256 over content + embed-model version (a version bump re-embeds all)."""
    return hashlib.sha256((content + version).encode()).hexdigest()


def plan_reconcile(
    field_rows: Sequence[Mapping[str, object]],
    index_hashes: Mapping[str, str],
    version: str,
) -> ReconcilePlan:
    """Diff catalog rows against the index by (field_key, content_hash) — pure."""
    to_embed: list[FieldToEmbed] = []
    unchanged = 0
    seen: set[str] = set()
    for row in field_rows:
        key = str(row["key"])
        seen.add(key)
        content = field_content(row)
        digest = content_hash_for(content, version)
        if index_hashes.get(key) == digest:
            unchanged += 1
        else:
            to_embed.append(FieldToEmbed(key, content, digest))
    to_delete = [key for key in index_hashes if key not in seen]
    return ReconcilePlan(to_embed, to_delete, unchanged)


async def reconcile_field_index(app_pool: asyncpg.Pool) -> dict[str, int]:
    """Reconcile the index against the live catalog; returns the delta counts."""
    settings = get_settings()
    async with app_pool.acquire() as conn:
        field_rows = await conn.fetch(_FIELDS_SQL)
        if not settings.vector_search_enabled:
            result = {"embedded": 0, "deleted": 0, "unchanged": len(field_rows)}
            logger.info("field_index reconcile skipped: vector search disabled", **result)
            return result
        index_rows = await conn.fetch(_INDEX_SQL)
        plan = plan_reconcile(
            field_rows,
            {row["field_key"]: row["content_hash"] for row in index_rows},
            embed_model_version(),
        )
        await _apply_plan(conn, plan)
    result = {
        "embedded": len(plan.to_embed),
        "deleted": len(plan.to_delete),
        "unchanged": plan.unchanged,
    }
    logger.info("field_index reconciled", **result)
    return result


async def _apply_plan(conn: asyncpg.Connection, plan: ReconcilePlan) -> None:
    """Embed the delta in batches of ≤64 and upsert; drop vanished keys."""
    version = embed_model_version()
    for start in range(0, len(plan.to_embed), BATCH_SIZE):
        batch = plan.to_embed[start : start + BATCH_SIZE]
        vectors = await embed_texts([item.content for item in batch])
        await conn.executemany(
            _UPSERT_SQL,
            [
                (item.field_key, item.content_hash, vector_literal(vector), version)
                for item, vector in zip(batch, vectors, strict=True)
            ],
        )
    if plan.to_delete:
        await conn.execute(_DELETE_SQL, plan.to_delete)


async def main_once() -> dict[str, int]:
    """One-shot reconcile on a fresh app pool (live verification helper)."""
    from counselle_db.db import create_pool

    pool = await create_pool(dsn=get_settings().db_app_dsn)
    try:
        return await reconcile_field_index(pool)
    finally:
        await pool.close()
