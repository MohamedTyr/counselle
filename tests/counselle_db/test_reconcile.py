"""Unit tests for the field_index reconciler diff + the embeddings adapter.

No live DB, no live Vertex: the diff logic is the pure :func:`plan_reconcile`,
and the adapter test stubs the genai client. (The live idempotence/heal checks
are the phase-3 Slice D live suite.)
"""

import math
from types import SimpleNamespace

import pytest

from adapters import embeddings
from counselle_db.reconcile import content_hash_for, field_content, plan_reconcile

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
