"""Unit tests for the field_index reconciler diff + the embeddings adapter.

No live DB, no live Vertex: the diff logic is the pure :func:`plan_reconcile`,
and the adapter test stubs the genai client. (The live idempotence/heal checks
are the phase-3 Slice D live suite.)
"""

import asyncio
import math
from types import SimpleNamespace

import pytest

from adapters import embeddings
from counselle_db import reconcile
from counselle_db.reconcile import (
    content_hash_for,
    field_content,
    plan_reconcile,
    reconcile_forever,
    reconcile_once,
)

_FIELDS: list[dict[str, object]] = [
    {
        "key": "admissions.acceptance_rate",
        "label": "Acceptance rate",
        "category": "admissions",
        "data_type": "float",
        "source": "ipeds",
        "raw_column": "DVADM01",
    },
    {
        "key": "aid.median_debt_completers",
        "label": "Median debt (completers)",
        "category": "aid",
        "data_type": "float",
        "source": "scorecard",
        "raw_column": None,
    },
]

_VERSION = "gemini-embedding-001@768"


def _index_for(fields: list[dict[str, object]], version: str) -> dict[str, str]:
    """The field_index hashes a prior reconcile at `version` would have stored."""
    return {str(row["key"]): content_hash_for(field_content(row), version) for row in fields}


def test_first_run_embeds_everything_second_run_embeds_nothing() -> None:
    first = plan_reconcile(_FIELDS, {}, _VERSION)
    assert [item.field_key for item in first.to_embed] == [str(r["key"]) for r in _FIELDS]
    assert first.to_delete == []
    assert first.unchanged == 0

    second = plan_reconcile(_FIELDS, _index_for(_FIELDS, _VERSION), _VERSION)
    assert second.to_embed == []
    assert second.to_delete == []
    assert second.unchanged == len(_FIELDS)


def test_vanished_field_is_deleted_and_changed_label_re_embedded() -> None:
    index = _index_for(_FIELDS, _VERSION)
    edited = [dict(_FIELDS[0], label="Admit rate")]  # second field vanished
    plan = plan_reconcile(edited, index, _VERSION)
    assert [item.field_key for item in plan.to_embed] == ["admissions.acceptance_rate"]
    assert plan.to_delete == ["aid.median_debt_completers"]
    assert plan.unchanged == 0


def test_model_version_bump_re_embeds_all() -> None:
    index = _index_for(_FIELDS, _VERSION)
    plan = plan_reconcile(_FIELDS, index, "gemini-embedding-002@768")
    assert len(plan.to_embed) == len(_FIELDS)
    assert plan.to_delete == []
    assert plan.unchanged == 0


def test_content_string_uses_empty_string_for_null_raw_column() -> None:
    assert field_content(_FIELDS[1]).endswith("| scorecard | ")


async def test_reconcile_once_invokes_on_result_on_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """reconcile_once feeds the delta dict to on_result and never touches on_error."""
    delta = {"embedded": 2, "deleted": 0, "unchanged": 5}

    async def fake_reconcile(_pool: object) -> dict[str, int]:
        return delta

    monkeypatch.setattr(reconcile, "reconcile_field_index", fake_reconcile)
    results: list[dict[str, int]] = []
    errors: list[Exception] = []

    await reconcile_once(object(), results.append, errors.append)

    assert results == [delta]
    assert errors == []


async def test_reconcile_once_invokes_on_error_and_never_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A failing reconcile routes the exception to on_error and does NOT propagate."""
    boom = RuntimeError("DB blip")

    async def fake_reconcile(_pool: object) -> dict[str, int]:
        raise boom

    monkeypatch.setattr(reconcile, "reconcile_field_index", fake_reconcile)
    results: list[dict[str, int]] = []
    errors: list[Exception] = []

    # Must NOT raise.
    await reconcile_once(object(), results.append, errors.append)

    assert results == []
    assert errors == [boom]


async def test_reconcile_once_without_callbacks_swallows_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With no on_error callback a failure is swallowed (logged), never raised."""

    async def fake_reconcile(_pool: object) -> dict[str, int]:
        raise RuntimeError("DB blip")

    monkeypatch.setattr(reconcile, "reconcile_field_index", fake_reconcile)

    await reconcile_once(object())  # no callbacks, must not raise


async def test_reconcile_forever_sleeps_then_reconciles(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """One loop iteration: sleep is awaited, then a pass runs; cancel after the first."""
    slept: list[float] = []
    delta = {"embedded": 0, "deleted": 0, "unchanged": 1}

    async def fake_reconcile(_pool: object) -> dict[str, int]:
        return delta

    async def fake_sleep(seconds: float) -> None:
        slept.append(seconds)
        # Let the first pass run, then stop the infinite loop.
        if len(slept) >= 1:
            raise asyncio.CancelledError

    monkeypatch.setattr(reconcile, "reconcile_field_index", fake_reconcile)
    monkeypatch.setattr("counselle_db.reconcile.asyncio.sleep", fake_sleep)
    results: list[dict[str, int]] = []

    with pytest.raises(asyncio.CancelledError):
        await reconcile_forever(object(), 60, results.append)

    assert slept == [60 * 60]  # interval_minutes * 60 seconds
    # The cancel fires inside fake_sleep on the FIRST iteration, before the first
    # reconcile pass — proves the loop sleeps first (ADR 0008 periodic cadence).
    assert results == []


async def test_reconcile_forever_runs_a_pass_after_a_full_sleep(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """After a completed sleep, the loop runs a reconcile pass before the next sleep."""
    calls: list[str] = []
    delta = {"embedded": 0, "deleted": 0, "unchanged": 1}

    async def fake_reconcile(_pool: object) -> dict[str, int]:
        calls.append("reconcile")
        return delta

    async def fake_sleep(_seconds: float) -> None:
        calls.append("sleep")
        # Cancel only on the SECOND sleep so one full sleep→reconcile pass runs.
        if calls.count("sleep") >= 2:
            raise asyncio.CancelledError

    monkeypatch.setattr(reconcile, "reconcile_field_index", fake_reconcile)
    monkeypatch.setattr("counselle_db.reconcile.asyncio.sleep", fake_sleep)

    with pytest.raises(asyncio.CancelledError):
        await reconcile_forever(object(), 1)

    assert calls == ["sleep", "reconcile", "sleep"]


def test_mcp_server_no_longer_owns_a_reconciler() -> None:
    """The MCP child reads the index, it does not maintain it (audit H4)."""
    from counselle_db import server

    assert not hasattr(server, "_reconcile_forever")
    assert not hasattr(server, "reconcile_field_index")


async def test_embed_texts_returns_normalized_vectors_of_768(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dims = 768

    def fake_embed_content(*, model: str, contents: list[str], config: object) -> SimpleNamespace:
        # Un-normalized vectors, like gemini-embedding-001 at non-3072 dims.
        return SimpleNamespace(embeddings=[SimpleNamespace(values=[0.5] * dims) for _ in contents])

    fake_client = SimpleNamespace(models=SimpleNamespace(embed_content=fake_embed_content))
    monkeypatch.setattr(embeddings, "_client", lambda: fake_client)

    vectors = await embeddings.embed_texts(["acceptance rate", "median debt"])

    assert len(vectors) == 2
    for vector in vectors:
        assert len(vector) == dims
        assert math.sqrt(sum(v * v for v in vector)) == pytest.approx(1.0)
