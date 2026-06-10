"""Live integration tests for the search_fields discovery tool (phase-3 Slice D).

Every test hits the real pipeline database + counselle schema (counselle_ro for
reads, counselle_app for the reconciler heal test). pg_trgm is installed in the
pipeline DB (verified 2026-06-10).
"""

from collections.abc import AsyncIterator

import asyncpg
import pytest
import pytest_asyncio

from config.settings import get_settings
from counselle_db.catalog import Catalog
from counselle_db.db import create_pool
from counselle_db.reconcile import reconcile_field_index
from counselle_db.search_fields import search_fields

pytestmark = pytest.mark.live_db


# ---------------------------------------------------------------------------
# App-pool fixture (needed only for the self-heal test which writes to
# counselle.field_index via the counselle_app role).
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def app_pool() -> AsyncIterator[asyncpg.Pool]:
    """A pool on the app role (counselle_app) for write-side reconcile tests."""
    settings = get_settings()
    pool = await create_pool(dsn=settings.db_app_dsn)
    try:
        yield pool
    finally:
        await pool.close()


# ---------------------------------------------------------------------------
# Earnings test
# ---------------------------------------------------------------------------


async def test_earnings_query_returns_earnings_key_in_top_5(catalog: Catalog) -> None:
    # Arrange: a natural-language earnings question.
    query = "how much do graduates earn"

    # Act
    hits = await search_fields(catalog, query, limit=8)

    # Assert: at least one earnings.* key in the top 5.
    top5_keys = [h.key for h in hits[:5]]
    earnings_hits = [k for k in top5_keys if k.startswith("earnings.")]
    assert earnings_hits, f"Expected an earnings.* key in top 5; got: {top5_keys}"


# ---------------------------------------------------------------------------
# Acceptance rate test
# ---------------------------------------------------------------------------


async def test_acceptance_rate_query_returns_admissions_acceptance_rate_in_top_3(
    catalog: Catalog,
) -> None:
    # Arrange
    query = "acceptance rate"

    # Act
    hits = await search_fields(catalog, query, limit=8)

    # Assert
    top3_keys = [h.key for h in hits[:3]]
    assert "admissions.acceptance_rate" in top3_keys, (
        f"Expected admissions.acceptance_rate in top 3; got: {top3_keys}"
    )


# ---------------------------------------------------------------------------
# Keyword-only fallback test (use_vector=False)
# ---------------------------------------------------------------------------


async def test_keyword_fallback_finds_median_debt_with_vector_disabled(
    catalog: Catalog,
) -> None:
    # Arrange: exact substring present in key and label — keyword path must find it.
    query = "median_debt"

    # Act: force keyword-only path.
    hits = await search_fields(catalog, query, use_vector=False, limit=8)

    # Assert
    keys = [h.key for h in hits]
    assert "aid.median_debt_completers" in keys, (
        f"Expected aid.median_debt_completers via keyword path; got: {keys}"
    )
    # All hits must have similarity=None when keyword-only.
    for hit in hits:
        assert hit.similarity is None, (
            f"Hit {hit.key} has similarity={hit.similarity!r} but vector was disabled"
        )


# ---------------------------------------------------------------------------
# Self-heal test: delete one index row → keyword fallback finds it →
# reconcile restores it.
# ---------------------------------------------------------------------------


async def test_self_heal_deleted_index_row_found_via_fallback_then_reconcile_restores(
    catalog: Catalog,
    app_pool: asyncpg.Pool,
) -> None:
    # Step 1: ensure the index has at least one row for admissions.acceptance_rate.
    await reconcile_field_index(app_pool)

    # Step 2: record the pre-delete state.
    async with app_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT field_key, content_hash FROM counselle.field_index"
            " WHERE field_key = 'admissions.acceptance_rate'"
        )
    assert row is not None, "admissions.acceptance_rate must be in field_index after reconcile"
    saved_hash = row["content_hash"]

    # Step 3: delete that row to simulate a stale/missing index entry.
    async with app_pool.acquire() as conn:
        await conn.execute(
            "DELETE FROM counselle.field_index WHERE field_key = 'admissions.acceptance_rate'"
        )

    try:
        # Step 4: search by exact label — the keyword fallback must still find it.
        hits = await search_fields(catalog, "Acceptance rate", limit=8)
        hit_keys = [h.key for h in hits]
        assert "admissions.acceptance_rate" in hit_keys, (
            f"Keyword fallback should find the deleted key; got: {hit_keys}"
        )
        # The hit via keyword fallback has no vector similarity.
        kw_hit = next(h for h in hits if h.key == "admissions.acceptance_rate")
        assert kw_hit.similarity is None, "keyword-fallback hit must have similarity=None"

        # Step 5: reconcile heals the index.
        result = await reconcile_field_index(app_pool)
        assert result["embedded"] >= 1, (
            f"Reconcile should have re-embedded the deleted row; got: {result}"
        )

        # Step 6: verify the row is back with the same hash.
        async with app_pool.acquire() as conn:
            restored = await conn.fetchrow(
                "SELECT content_hash FROM counselle.field_index"
                " WHERE field_key = 'admissions.acceptance_rate'"
            )
        assert restored is not None, "Row must be restored after reconcile"
        assert restored["content_hash"] == saved_hash, (
            "Restored row must have the same content hash as before deletion"
        )
    finally:
        # Ensure the index is restored even if an assertion above fails mid-test.
        await reconcile_field_index(app_pool)


# ---------------------------------------------------------------------------
# Category filter test
# ---------------------------------------------------------------------------


async def test_category_filter_returns_only_admissions_hits(
    catalog: Catalog,
) -> None:
    # Arrange
    query = "rate"

    # Act: filter to admissions category.
    hits = await search_fields(catalog, query, category="admissions", limit=8)

    # Assert: non-empty and every hit is in the admissions category.
    assert hits, "Expected at least one hit for 'rate' in category=admissions"
    for hit in hits:
        assert hit.category == "admissions", (
            f"Hit {hit.key} has category={hit.category!r}, expected 'admissions'"
        )
