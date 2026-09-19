"""The ``.liprep`` v1 progress file — encode and decode (plan.md §4.6,
parity-inventory A12/A13/A13a/A13b).

Ported from liprep's own exporter/importer:
- ``encode`` ports ``exportUserData``'s payload shape (the download itself
  is a frontend concern; this only builds the pretty-printed JSON string).
- ``decode`` ports ``importUserData``'s validation and defaulting, with the
  stated deviations from plan §4.6: seconds is floored to 1 and capped by
  ``max_seconds`` (upstream applies neither on import, only on submit — see
  ``domain/sat/grading.py``'s sibling rule, Q25), score band is clamped to
  1-7 (upstream keeps an out-of-range value as-is), and an invalid
  ``dateKey`` falls back to the date of ``solvedAt`` rather than failing
  the file.
  ``tests/domain/sat/upstream/harness/.upstream/src/db.ts``
    (``exportUserData``, ``importUserData``, ``asString``, ``asNumber``,
    ``isRecord``, ``formatDateKey``)

Rounding: ``_clamp_seconds`` uses ``domain/sat/_rounding.js_round`` (JS
``Math.round``, half up) because upstream really does apply that rule to
seconds — ``recordQuestionAttempt``'s ``Math.max(1, Math.round(timeSpentSeconds))``
(``db.ts``). Upstream's own ``importUserData`` never rounds or clamps
``score_band_range_cd`` at all (it stays whatever ``asNumber`` returns, int
or fractional); the 1-7 clamp here is entirely Counselle's own deviation
(see above), so ``_clamp_band`` uses ``js_round`` only to stay consistent
with the rest of this package's rounding convention, not because a JS
``Math.round`` call is being ported. ``_to_epoch_ms`` also has no JS
``Math.round`` to port — ``exportUserData`` writes an already-integer
``Date.getTime()``/``solvedAt`` millisecond value straight through — so it
keeps the builtin ``round()``, which only absorbs Python ``datetime``'s
sub-millisecond precision and never observably diverges from ``js_round``
here.

Pure stdlib + pydantic (ADR 0017): no I/O, no clock reads — ``now`` and
``today`` are parameters, matching the rest of ``domain/sat`` (§4.4).

``ImportedAttempt``/``ImportedBookmark``/``ProgressImport`` are local to this
module rather than additions to ``domain/sat/types.py``: ``types.Attempt``
requires a ``user_id`` this module never has (decode has no caller
identity), and its ``id`` is a DB-assigned primary key, not the file-order
position assigned here. A caller attaches ``user_id`` and inserts these rows
directly (plan's "one transaction, executemany"). *(Wish: if a second
consumer ever needs these shapes, they may belong in ``types.py`` instead —
flagging for the file's owner.)*
"""

from __future__ import annotations

import json
from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict

from domain.sat._rounding import js_round
from domain.sat.types import Attempt, Bookmark

_FORMAT = "LiPrep"
_VERSION = 1

_DEFAULT_MODULE = "reading"
_DEFAULT_BAND = 3
_MIN_BAND = 1
_MAX_BAND = 7
_DEFAULT_SECONDS = 1
_MIN_SECONDS = 1


class ProgressFileError(Exception):
    """Raised for a ``.liprep`` file that cannot be parsed at all — the two
    upstream A13b messages, kept verbatim so the API surfaces the same
    sentence a liprep user would recognise."""


class ImportedAttempt(BaseModel):
    """One validated attempt row from a decoded ``.liprep`` file (A13a).
    ``id`` is the row's 1-based position in file order (plan §4.4: "import
    assigns ids in file order"), not a DB primary key."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: int
    client_attempt_id: UUID
    question_id: str
    module: str
    domain_cd: str
    skill_cd: str
    score_band: int
    user_answer: str
    is_correct: bool
    time_spent_seconds: int
    solved_at: datetime
    local_date: date


class ImportedBookmark(BaseModel):
    """One validated bookmark row from a decoded ``.liprep`` file."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    question_id: str
    bookmarked_at: datetime


class ProgressImport(BaseModel):
    """``decode``'s result: replacement attempts and bookmarks (A13:
    import always replaces both, even when the file carries no bookmarks
    at all)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    attempts: tuple[ImportedAttempt, ...] = ()
    bookmarks: tuple[ImportedBookmark, ...] = ()


# --- encode (A12) ----------------------------------------------------------


def encode(attempts: list[Attempt], bookmarks: list[Bookmark], now: datetime) -> str:
    """The ``.liprep`` v1 JSON payload, pretty-printed with the same keys
    and 2-space indent as upstream's ``JSON.stringify(payload, null, 2)``.
    Attempt rows omit their numeric id (A12)."""

    payload = {
        "format": _FORMAT,
        "version": _VERSION,
        "exportedAt": _to_epoch_ms(now),
        "exportDateStr": now.date().isoformat(),
        "data": {
            "attempts": [_encode_attempt(a) for a in attempts],
            "bookmarks": [_encode_bookmark(b) for b in bookmarks],
        },
    }
    return json.dumps(payload, indent=2)


def _to_epoch_ms(value: datetime) -> int:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return round(value.timestamp() * 1000)


def _encode_attempt(a: Attempt) -> dict[str, Any]:
    return {
        "questionId": a.question_id,
        "module": a.module,
        "primary_class_cd": a.domain_cd,
        "skill_cd": a.skill_cd,
        "score_band_range_cd": a.score_band,
        "userAnswer": a.user_answer,
        "isCorrect": a.is_correct,
        "timeSpentSeconds": a.time_spent_seconds,
        "solvedAt": _to_epoch_ms(a.solved_at),
        "dateKey": a.local_date.isoformat(),
    }


def _encode_bookmark(b: Bookmark) -> dict[str, Any]:
    return {
        "questionId": b.question_id,
        "bookmarkedAt": _to_epoch_ms(b.bookmarked_at),
    }


# --- decode (A13, A13a, A13b) ----------------------------------------------


def decode(
    data: bytes | str,
    today: date,
    now: datetime,
    max_seconds: int,
) -> ProgressImport:
    """Validate and default a ``.liprep`` file's rows (A13a). Raises
    ``ProgressFileError`` only for the two shapes upstream itself refuses
    outright (bad JSON, or a body that is neither ``{"format": "LiPrep"}``
    nor otherwise carrying a truthy ``data``); every row-level defect is
    silently dropped, matching upstream row-by-row validation."""

    parsed = _parse_json(data)
    if not isinstance(parsed, dict) or (
        parsed.get("format") != _FORMAT and not _is_js_truthy(parsed.get("data"))
    ):
        raise ProgressFileError("Invalid .liprep backup format.")

    raw_data = parsed["data"] if isinstance(parsed.get("data"), dict) else parsed
    raw_attempts = raw_data.get("attempts")
    raw_bookmarks = raw_data.get("bookmarks")

    attempts = _decode_attempts(
        raw_attempts if isinstance(raw_attempts, list) else [],
        today=today,
        now=now,
        max_seconds=max_seconds,
    )
    bookmarks = _decode_bookmarks(raw_bookmarks if isinstance(raw_bookmarks, list) else [], now=now)
    return ProgressImport(attempts=tuple(attempts), bookmarks=tuple(bookmarks))


def _parse_json(data: bytes | str) -> Any:
    try:
        return json.loads(data)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ProgressFileError("Invalid .liprep file. Could not parse JSON content.") from exc


def _is_js_truthy(value: Any) -> bool:
    """JS truthiness for the one ``!json.data`` check upstream makes: an
    empty object or empty array is still truthy in JS (unlike Python)."""
    if value is None or isinstance(value, bool):
        return bool(value)
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value != ""
    return True  # dict, list: always truthy, JS-object semantics


def _decode_attempts(
    rows: list[Any], *, today: date, now: datetime, max_seconds: int
) -> list[ImportedAttempt]:
    attempts: list[ImportedAttempt] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        question_id = row.get("questionId")
        is_correct = row.get("isCorrect")
        if not isinstance(question_id, str) or not isinstance(is_correct, bool):
            continue
        attempts.append(
            _build_attempt(
                row,
                position=len(attempts) + 1,
                question_id=question_id,
                is_correct=is_correct,
                today=today,
                now=now,
                max_seconds=max_seconds,
            )
        )
    return attempts


def _build_attempt(
    row: dict[str, Any],
    *,
    position: int,
    question_id: str,
    is_correct: bool,
    today: date,
    now: datetime,
    max_seconds: int,
) -> ImportedAttempt:
    module = _as_string(row.get("module")) or _DEFAULT_MODULE
    seconds = _clamp_seconds(_as_number(row.get("timeSpentSeconds"), _DEFAULT_SECONDS), max_seconds)
    band = _clamp_band(_as_number(row.get("score_band_range_cd"), _DEFAULT_BAND))
    solved_at = _decode_solved_at(row.get("solvedAt"), now)
    local_date = _decode_local_date(row.get("dateKey"), solved_at, today)

    return ImportedAttempt(
        id=position,
        client_attempt_id=uuid4(),
        question_id=_as_string(question_id),
        module=module,
        domain_cd=_as_string(row.get("primary_class_cd")),
        skill_cd=_as_string(row.get("skill_cd")),
        score_band=band,
        user_answer=_as_string(row.get("userAnswer")),
        is_correct=is_correct,
        time_spent_seconds=seconds,
        solved_at=solved_at,
        local_date=local_date,
    )


def _decode_bookmarks(rows: list[Any], *, now: datetime) -> list[ImportedBookmark]:
    bookmarks: list[ImportedBookmark] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        question_id = row.get("questionId")
        if not isinstance(question_id, str):
            continue
        ms = _as_number_or_none(row.get("bookmarkedAt"))
        bookmarked_at = now if ms is None else _ms_to_datetime(ms)
        bookmarks.append(
            ImportedBookmark(question_id=_as_string(question_id), bookmarked_at=bookmarked_at)
        )
    return bookmarks


def _clamp_seconds(raw: float, max_seconds: int) -> int:
    rounded = js_round(raw)
    return min(max_seconds, max(_MIN_SECONDS, rounded))


def _clamp_band(raw: float) -> int:
    return min(_MAX_BAND, max(_MIN_BAND, js_round(raw)))


def _decode_solved_at(raw: Any, now: datetime) -> datetime:
    ms = _as_number_or_none(raw)
    if ms is None:
        return now
    return _ms_to_datetime(ms)


def _ms_to_datetime(ms: float) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=UTC)


def _decode_local_date(raw: Any, solved_at: datetime, today: date) -> date:
    raw_str = _as_string(raw)
    if not raw_str:
        return today
    try:
        return date.fromisoformat(raw_str)
    except ValueError:
        return solved_at.date()


def _as_string(value: Any) -> str:
    """Port of upstream's ``asString``: strings are trimmed; numbers and
    booleans are stringified (JS ``String()``, lower-case booleans);
    anything else (missing, object, array) is ``""``."""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return str(int(value)) if value.is_integer() else repr(value)
    return ""


def _as_number(value: Any, fallback: float) -> float:
    """Port of upstream's ``asNumber``: a finite number passes through; a
    numeric string is parsed; anything else (including booleans, which are
    not ``typeof === "number"`` in JS) falls back."""
    result = _as_number_or_none(value)
    return fallback if result is None else result


def _as_number_or_none(value: Any) -> float | None:
    """``_as_number`` with no fallback value to substitute — used where the
    caller's fallback is itself dynamic (``now``), not a constant."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if _is_finite(value) else None
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return 0.0
        try:
            parsed = float(stripped)
        except ValueError:
            return None
        return parsed if _is_finite(parsed) else None
    return None


def _is_finite(value: float) -> bool:
    return value == value and value not in (float("inf"), float("-inf"))
