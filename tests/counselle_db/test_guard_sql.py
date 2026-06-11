"""Unit tests for counselle_db.service._guard_sql (FIX 7 + existing guards).

No DB required — _guard_sql is a pure synchronous function.
"""

from __future__ import annotations

import pytest

from counselle_db.models import ServiceError
from counselle_db.service import _guard_sql

# ---------------------------------------------------------------------------
# Existing guards (baseline)
# ---------------------------------------------------------------------------


def test_select_passes() -> None:
    assert _guard_sql("SELECT 1") == "SELECT 1"


def test_with_cte_passes() -> None:
    sql = "WITH cte AS (SELECT 1) SELECT * FROM cte"
    assert _guard_sql(sql) == sql


def test_trailing_semicolon_stripped() -> None:
    result = _guard_sql("SELECT 1;")
    assert result == "SELECT 1"


def test_multiple_statements_rejected() -> None:
    with pytest.raises(ServiceError, match="multiple SQL statements"):
        _guard_sql("SELECT 1; SELECT 2")


def test_delete_rejected() -> None:
    with pytest.raises(ServiceError, match="read-only"):
        _guard_sql("DELETE FROM schools")


def test_must_start_with_select_or_with() -> None:
    with pytest.raises(ServiceError, match="read-only"):
        _guard_sql("INSERT INTO foo VALUES (1)")


# ---------------------------------------------------------------------------
# FIX 7: function denylist — set_config, pg_advisory_lock variants, pg_sleep variants
# ---------------------------------------------------------------------------


def test_set_config_call_rejected() -> None:
    with pytest.raises(ServiceError, match="set_config"):
        _guard_sql("SELECT set_config('search_path', 'public', false)")


def test_pg_sleep_call_rejected() -> None:
    with pytest.raises(ServiceError, match="pg_sleep"):
        _guard_sql("SELECT pg_sleep(10)")


def test_pg_sleep_for_call_rejected() -> None:
    with pytest.raises(ServiceError, match="pg_sleep"):
        _guard_sql("SELECT pg_sleep_for('5 seconds')")


def test_pg_sleep_until_call_rejected() -> None:
    with pytest.raises(ServiceError, match="pg_sleep"):
        _guard_sql("SELECT pg_sleep_until('2026-01-01 00:00:00')")


def test_pg_advisory_lock_call_rejected() -> None:
    with pytest.raises(ServiceError, match="pg_advisory"):
        _guard_sql("SELECT pg_advisory_lock(42)")


def test_pg_advisory_xact_lock_call_rejected() -> None:
    with pytest.raises(ServiceError, match="pg_advisory"):
        _guard_sql("SELECT pg_advisory_xact_lock(42)")


def test_pg_advisory_lock_shared_call_rejected() -> None:
    with pytest.raises(ServiceError, match="pg_advisory"):
        _guard_sql("SELECT pg_advisory_lock_shared(42)")


def test_denylist_match_is_case_insensitive() -> None:
    with pytest.raises(ServiceError, match="set_config"):
        _guard_sql("SELECT SET_CONFIG('x', 'y', false)")


# ---------------------------------------------------------------------------
# FIX 7: negative tests — denylist words as strings or column refs do NOT reject
# ---------------------------------------------------------------------------


def test_column_named_set_config_is_not_rejected() -> None:
    # A column (or alias) named "set_config" without a following "(" is fine.
    result = _guard_sql("SELECT 'set_config is a function' AS note")
    assert "set_config is a function" in result


def test_string_literal_with_pg_sleep_not_rejected() -> None:
    result = _guard_sql("SELECT 'pg_sleep is dangerous' AS warning")
    assert "pg_sleep is dangerous" in result


def test_string_literal_with_pg_advisory_not_rejected() -> None:
    result = _guard_sql("SELECT 'pg_advisory_lock docs' AS doc")
    assert "pg_advisory_lock docs" in result
