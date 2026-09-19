"""``.liprep`` v1 encode/decode tests (plan.md §4.6, parity-inventory A12,
A13, A13a, A13b).

Most of the 20-case vector suite is asserted directly against liprep's own
recorded behaviour (``tests/domain/sat/upstream/harness/generate.progress.spec.ts``).
Two cases are *stated* deviations from upstream, named in plan §4.6 and in
``domain/sat/progress_file.py``'s own module docstring — seconds floored to
1, and score band clamped to 1-7 — so those two are asserted against our
own clamped output instead of the vector's literal ``persisted`` value.

The vector's own attempt ``id`` fields are cross-case, DB auto-increment
values from a stateful upstream test harness (each case ran against the
same IndexedDB in sequence); they say nothing about a single ``decode()``
call, so ids are asserted to be file-order-from-1 within each case, never
against the vector's own numbers.
"""

import json
import re
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any, cast
from uuid import UUID, uuid4

import pytest

from domain.sat._rounding import js_round
from domain.sat.progress_file import (
    ProgressFileError,
    decode,
    encode,
)
from domain.sat.types import Attempt, Bookmark

REPO_ROOT = Path(__file__).resolve().parents[3]
VECTORS_PATH = (
    REPO_ROOT / "tests" / "domain" / "sat" / "upstream" / "vectors" / "progress_file.json"
)

_MAX_SECONDS = 86_400  # sat_attempt_max_seconds (plan §4.3/§4.6), 24h

# Labels whose upstream `persisted` value is a *stated* deviation (plan
# §4.6): our decode() clamps these, upstream's importer does not.
_SECONDS_FLOOR_DEVIATIONS = {"zero_seconds_kept_as_is_by_upstream"}
_BAND_CLAMP_DEVIATIONS = {"band_out_of_range_kept_as_is_by_upstream"}


def _load_cases() -> list[dict[str, Any]]:
    payload: dict[str, Any] = json.loads(VECTORS_PATH.read_text())
    return cast("list[dict[str, Any]]", payload["cases"])


_CASES = _load_cases()
_IMPORT_CASES = [c for c in _CASES if c["direction"] in ("import", "round_trip")]


def _ms_to_datetime(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=UTC)


@pytest.mark.parametrize("case", _IMPORT_CASES, ids=[c["label"] for c in _IMPORT_CASES])
def test_decode_vector(case: dict[str, Any]) -> None:
    raw = case["input"] if isinstance(case["input"], str) else json.dumps(case["input"])
    today = date(2026, 9, 19)
    now = datetime(2026, 9, 19, 12, 0, 0, tzinfo=UTC)

    if case["importError"] is not None:
        with pytest.raises(ProgressFileError, match=_re_escape(case["importError"])):
            decode(raw, today=today, now=now, max_seconds=_MAX_SECONDS)
        return

    result = decode(raw, today=today, now=now, max_seconds=_MAX_SECONDS)

    assert len(result.attempts) == case["importResult"]["attemptsCount"]
    assert len(result.bookmarks) == case["importResult"]["bookmarksCount"]

    for position, (attempt, expected) in enumerate(
        zip(result.attempts, case["persisted"]["attempts"], strict=True), start=1
    ):
        # File-order id, never the vector's cross-case DB id (see module
        # docstring).
        assert attempt.id == position
        assert attempt.question_id == expected["questionId"]
        assert attempt.module == expected["module"]
        assert attempt.domain_cd == expected["primary_class_cd"]
        assert attempt.skill_cd == expected["skill_cd"]
        assert attempt.user_answer == expected["userAnswer"]
        assert attempt.is_correct == expected["isCorrect"]
        assert attempt.solved_at == _ms_to_datetime(expected["solvedAt"])
        assert attempt.local_date == date.fromisoformat(expected["dateKey"])

        if case["label"] in _SECONDS_FLOOR_DEVIATIONS:
            assert attempt.time_spent_seconds == 1
        else:
            assert attempt.time_spent_seconds == expected["timeSpentSeconds"]

        if case["label"] in _BAND_CLAMP_DEVIATIONS:
            assert attempt.score_band == 7
        else:
            assert attempt.score_band == expected["score_band_range_cd"]

    for bookmark, expected_b in zip(result.bookmarks, case["persisted"]["bookmarks"], strict=True):
        assert bookmark.question_id == expected_b["questionId"]
        assert bookmark.bookmarked_at == _ms_to_datetime(expected_b["bookmarkedAt"])


def _re_escape(text: str) -> str:
    return re.escape(text)


def test_decode_vector_suite_is_nonempty() -> None:
    assert len(_CASES) >= 15


# --- A13a: defaults, junk rows, and our own stated clamps ------------------


def test_decode_seconds_floored_to_one_and_capped(*, today: date = date(2026, 1, 1)) -> None:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    payload = json.dumps(
        {
            "data": {
                "attempts": [
                    {"questionId": "q1", "isCorrect": True, "timeSpentSeconds": 0},
                    {"questionId": "q2", "isCorrect": True, "timeSpentSeconds": 999_999},
                ],
                "bookmarks": [],
            }
        }
    )
    result = decode(payload, today=today, now=now, max_seconds=_MAX_SECONDS)
    assert result.attempts[0].time_spent_seconds == 1
    assert result.attempts[1].time_spent_seconds == _MAX_SECONDS


def test_decode_band_clamped_to_1_through_7() -> None:
    today = date(2026, 1, 1)
    now = datetime(2026, 1, 1, tzinfo=UTC)
    payload = json.dumps(
        {
            "data": {
                "attempts": [
                    {"questionId": "q1", "isCorrect": True, "score_band_range_cd": 0},
                    {"questionId": "q2", "isCorrect": True, "score_band_range_cd": 99},
                ],
                "bookmarks": [],
            }
        }
    )
    result = decode(payload, today=today, now=now, max_seconds=_MAX_SECONDS)
    assert result.attempts[0].score_band == 1
    assert result.attempts[1].score_band == 7


def test_decode_seconds_rounds_half_up_like_js_math_round() -> None:
    """JS ``Math.round`` rounds half up; Python's builtin ``round`` rounds
    half to even. 2.5 is the case that tells them apart (js_round -> 3,
    builtin round -> 2)."""
    today = date(2026, 1, 1)
    now = datetime(2026, 1, 1, tzinfo=UTC)
    payload = json.dumps(
        {
            "data": {
                "attempts": [
                    {"questionId": "q1", "isCorrect": True, "timeSpentSeconds": 2.5},
                    {"questionId": "q2", "isCorrect": True, "timeSpentSeconds": 0.4},
                    {"questionId": "q3", "isCorrect": True, "timeSpentSeconds": 3.5},
                ],
                "bookmarks": [],
            }
        }
    )
    result = decode(payload, today=today, now=now, max_seconds=_MAX_SECONDS)
    assert result.attempts[0].time_spent_seconds == 3
    assert result.attempts[1].time_spent_seconds == 1  # floors to 0, then clamped up to 1
    assert result.attempts[2].time_spent_seconds == 4


def test_decode_band_rounds_half_up_like_js_math_round() -> None:
    today = date(2026, 1, 1)
    now = datetime(2026, 1, 1, tzinfo=UTC)
    payload = json.dumps(
        {
            "data": {
                "attempts": [
                    {"questionId": "q1", "isCorrect": True, "score_band_range_cd": 2.5},
                ],
                "bookmarks": [],
            }
        }
    )
    result = decode(payload, today=today, now=now, max_seconds=_MAX_SECONDS)
    assert result.attempts[0].score_band == 3


def test_js_round_matches_math_round_for_negative_values() -> None:
    """``js_round`` is ``floor(x + 0.5)``, which matches JS ``Math.round``
    for negatives too, unlike Python's builtin ``round`` (half to even)."""
    assert js_round(-2.5) == -2


def test_decode_invalid_date_key_falls_back_to_solved_at_date() -> None:
    today = date(2026, 1, 1)
    now = datetime(2026, 1, 1, tzinfo=UTC)
    solved_at_ms = int(datetime(2025, 12, 25, tzinfo=UTC).timestamp() * 1000)
    payload = json.dumps(
        {
            "data": {
                "attempts": [
                    {
                        "questionId": "q1",
                        "isCorrect": True,
                        "dateKey": "not-a-date",
                        "solvedAt": solved_at_ms,
                    }
                ],
                "bookmarks": [],
            }
        }
    )
    result = decode(payload, today=today, now=now, max_seconds=_MAX_SECONDS)
    assert result.attempts[0].local_date == date(2025, 12, 25)


def test_decode_missing_date_key_defaults_to_today_not_now() -> None:
    today = date(2026, 3, 3)
    now = datetime(2099, 1, 1, tzinfo=UTC)  # deliberately not "today"
    payload = json.dumps(
        {"data": {"attempts": [{"questionId": "q1", "isCorrect": True}], "bookmarks": []}}
    )
    result = decode(payload, today=today, now=now, max_seconds=_MAX_SECONDS)
    assert result.attempts[0].local_date == today


def test_decode_client_attempt_ids_are_distinct_per_row() -> None:
    today = date(2026, 1, 1)
    now = datetime(2026, 1, 1, tzinfo=UTC)
    payload = json.dumps(
        {
            "data": {
                "attempts": [
                    {"questionId": "q1", "isCorrect": True},
                    {"questionId": "q2", "isCorrect": False},
                ],
                "bookmarks": [],
            }
        }
    )
    result = decode(payload, today=today, now=now, max_seconds=_MAX_SECONDS)
    ids = {a.client_attempt_id for a in result.attempts}
    assert len(ids) == 2


@pytest.mark.parametrize(
    "raw",
    [
        "not json at all",
        "{",
    ],
)
def test_decode_invalid_json_raises(raw: str) -> None:
    now = datetime.now(tz=UTC)
    with pytest.raises(ProgressFileError, match="Could not parse JSON content"):
        decode(raw, today=date(2026, 1, 1), now=now, max_seconds=_MAX_SECONDS)


@pytest.mark.parametrize(
    "raw",
    [
        json.dumps({"foo": "bar"}),
        json.dumps([1, 2, 3]),
        json.dumps("a plain string"),
    ],
)
def test_decode_wrong_shape_raises(raw: str) -> None:
    now = datetime.now(tz=UTC)
    with pytest.raises(ProgressFileError, match="Invalid .liprep backup format"):
        decode(raw, today=date(2026, 1, 1), now=now, max_seconds=_MAX_SECONDS)


# --- encode (A12) -----------------------------------------------------


def test_encode_matches_upstream_export_shape() -> None:
    export_case = next(c for c in _CASES if c["label"] == "export_known_state")
    user_id = UUID("00000000-0000-0000-0000-000000000001")
    attempts = [
        Attempt(
            id=None,
            user_id=user_id,
            client_attempt_id=uuid4(),
            question_id="q1",
            module="math",
            domain_cd="H",
            skill_cd="H.A.",
            score_band=5,
            user_answer="3",
            is_correct=True,
            time_spent_seconds=42,
            solved_at=_ms_to_datetime(1789815600000),
            local_date=date(2026, 9, 19),
        ),
        Attempt(
            id=None,
            user_id=user_id,
            client_attempt_id=uuid4(),
            question_id="q2",
            module="math",
            domain_cd="P",
            skill_cd="P.A.",
            score_band=5,
            user_answer="3",
            is_correct=False,
            time_spent_seconds=42,
            solved_at=_ms_to_datetime(1789815600000),
            local_date=date(2026, 9, 19),
        ),
    ]
    bookmarks = [
        Bookmark(
            user_id=user_id,
            question_id="q1",
            bookmarked_at=_ms_to_datetime(1789819200000),
        )
    ]
    now = _ms_to_datetime(1789819200000)

    result = encode(attempts, bookmarks, now)
    assert result == export_case["exportedJson"]


def test_round_trip_encode_then_decode_preserves_rows() -> None:
    now = datetime(2026, 9, 19, tzinfo=UTC)
    today = now.date()
    user_id = UUID("00000000-0000-0000-0000-000000000009")
    attempts = [
        Attempt(
            id=None,
            user_id=user_id,
            client_attempt_id=uuid4(),
            question_id="q1",
            module="math",
            domain_cd="H",
            skill_cd="H.A.",
            score_band=5,
            user_answer="3",
            is_correct=True,
            time_spent_seconds=42,
            solved_at=now,
            local_date=today,
        )
    ]
    bookmarks = [Bookmark(user_id=user_id, question_id="q1", bookmarked_at=now)]

    encoded = encode(attempts, bookmarks, now)
    decoded = decode(encoded, today=today, now=now, max_seconds=_MAX_SECONDS)

    assert len(decoded.attempts) == 1
    assert decoded.attempts[0].question_id == "q1"
    assert decoded.attempts[0].time_spent_seconds == 42
    assert decoded.attempts[0].local_date == today
    assert len(decoded.bookmarks) == 1
    assert decoded.bookmarks[0].question_id == "q1"
