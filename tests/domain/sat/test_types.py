"""SatQuestion identity-invariant test (plan.md §3.4's DB CHECK constraint,
mirrored here so the domain model matches the SQL invariant §3.6 G3 depends
on: exactly one of ``external_id`` / ``ibn`` is set, never both, never
neither).
"""

from typing import Any
from uuid import UUID

import pytest
from pydantic import ValidationError

from domain.sat.types import SatQuestion

_EXTERNAL_ID = UUID("00000000-0000-0000-0000-000000000001")
_IBN = "abc123"


def _base_kwargs() -> dict[str, Any]:
    return {
        "question_id": "deadbeef",
        "u_id": UUID("00000000-0000-0000-0000-000000000002"),
        "source": "qbank",
        "module": "math",
        "domain_cd": "H",
        "skill_cd": "H.A.",
        "score_band": 3,
        "difficulty": "M",
        "program": "SAT",
        "item_type": "mcq",
        "in_bluebook": False,
        "cb_created_at": None,
        "cb_updated_at": None,
        "content_sha256": "x" * 64,
        "stimulus": None,
        "stem": "What is 1 + 1?",
        "answer_options": (),
        "correct_answers": ("2",),
        "rationale": "Because.",
    }


def test_both_external_id_and_ibn_set_raises() -> None:
    with pytest.raises(ValidationError):
        SatQuestion(**_base_kwargs(), external_id=_EXTERNAL_ID, ibn=_IBN)


def test_neither_external_id_nor_ibn_set_raises() -> None:
    with pytest.raises(ValidationError):
        SatQuestion(**_base_kwargs(), external_id=None, ibn=None)


def test_external_id_alone_is_valid() -> None:
    question = SatQuestion(**_base_kwargs(), external_id=_EXTERNAL_ID, ibn=None)
    assert question.external_id == _EXTERNAL_ID
    assert question.ibn is None


def test_ibn_alone_is_valid() -> None:
    question = SatQuestion(**_base_kwargs(), external_id=None, ibn=_IBN)
    assert question.external_id is None
    assert question.ibn == _IBN
