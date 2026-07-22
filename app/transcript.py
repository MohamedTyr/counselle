"""The transcript builder (B1b, wire-contract §2) — pure data transforms.

Lifted out of the route layer (FIX 2, ADR 0017): ``app/`` must not depend on
``api/``. These are pure transforms over checkpointer messages + turn records;
``api/routes/sessions.py`` and ``app/titles.py`` both call
:func:`extract_transcript`. Only the public ``extract_transcript`` is exported;
the per-shape helpers stay underscore-private.
"""

from __future__ import annotations

from typing import Any

import structlog

from app.legacy_citations import adapt_completed_sources
from app.records import prose_of

logger = structlog.get_logger(__name__)


def _prose_only_entries(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The pre-MVP2 fallback: serialized ModelMessages → prose-only entries.

    The pinned fallback shape (wire-contract §2): ``{role, text, ts}`` — no
    ``message_id``, no ``parts``, no ``step_record``, no ``status`` (absent,
    not null). Mapping rules:

    - ``kind == "request"`` → role ``"user"``, text from the first
      ``user-prompt`` part's ``content``.  Parts of other kinds (tool-return,
      system) are skipped; if no user-prompt part exists the message is skipped.
    - ``kind == "response"`` → role ``"assistant"``, text from the concatenated
      ``text`` parts (``part_kind == "text"``).  Tool-call parts are skipped.
      If a response has no text parts it is skipped entirely (tool-only round).
    - ``ts`` is taken from the message-level ``timestamp`` field when present.
    """
    entries: list[dict[str, Any]] = []
    for msg in messages:
        kind = msg.get("kind")
        ts = msg.get("timestamp") or None
        if kind == "request":
            for part in msg.get("parts", []):
                if part.get("part_kind") == "user-prompt":
                    content = part.get("content", "")
                    if content:
                        entries.append({"role": "user", "text": content, "ts": ts})
                    break  # only the first user-prompt part
        elif kind == "response":
            text_parts = [
                p.get("content", "") for p in msg.get("parts", []) if p.get("part_kind") == "text"
            ]
            combined = "".join(text_parts)
            if combined:
                entries.append({"role": "assistant", "text": combined, "ts": ts})
    return entries


def _user_entries_for_record(record: dict[str, Any]) -> list[dict[str, Any]]:
    """The user entries a turn record stands for (wire-contract §2.1).

    Self-contained: the question comes from ``record["user_text"]``, never
    from a ``messages`` slice. On a resumed clarify (``synthesized_answer``)
    the record's fresh ``user_message_id`` belongs to the synthesized answer
    bubble (G4) — the original question still renders, but id-less (its
    parked-era record was replaced). A record with neither yields nothing.
    """
    question = record.get("user_text")
    entries: list[dict[str, Any]] = []
    if record.get("synthesized_answer"):
        if question:
            question_entry: dict[str, Any] = {"role": "user", "text": question, "ts": None}
            if record.get("skills"):
                question_entry["skills"] = list(record["skills"])
            entries.append(question_entry)
        answer = (record.get("clarify") or {}).get("answer")
        entries.append(
            {
                "role": "user",
                "text": answer or "",
                "ts": record.get("ts"),
                "message_id": record.get("user_message_id"),
                "synthesized": True,
            }
        )
    elif question:
        entry: dict[str, Any] = {
            "role": "user",
            "text": question,
            "ts": record.get("ts"),
            "message_id": record.get("user_message_id"),
        }
        if record.get("skills"):
            entry["skills"] = list(record["skills"])
        entries.append(entry)
    return entries


def _assistant_entry_for_record(
    record: dict[str, Any], feedback_by_id: dict[str, str] | None = None
) -> dict[str, Any]:
    """One turn record → the assistant transcript entry (wire-contract §2.2).

    ``parts`` is served straight from the record (materialized at write time
    — the read never reconstructs prose from ``messages``); ``text`` derives
    from the same parts via :func:`prose_of`.

    ``feedback_by_id`` is the caller's ``{message_id: rating}`` map (B4); when
    this entry's ``message_id`` has a rating, a ``feedback: {rating}`` key is
    attached (the honesty join — thumbs survive reload). Default empty → no
    ``feedback`` key (preserving pre-MVP2 behavior).
    """
    parts = list(record.get("parts") or [])
    step_record: dict[str, Any] = {
        "steps": record.get("steps") or [],
        "thinking": record.get("thinking") or [],
        "receipt": record.get("receipt") or "",
    }
    if "narration" in record:
        step_record["narration"] = record.get("narration") or []

    entry: dict[str, Any] = {
        "role": "assistant",
        "text": prose_of(parts),
        "ts": record.get("ts"),
        "message_id": record.get("message_id"),
        "parts": parts,
        "step_record": step_record,
        "sources": adapt_completed_sources(record.get("sources") or []),
        "status": record.get("status"),
    }
    # Mode belongs to the assistant answer (wire-contract §6.2), never the user
    # entry. A genuinely legacy record (key absent) reads as Quick; a present
    # value — known or not — passes through unchanged so a future/unsupported
    # mode still renders instead of being silently relabeled Quick (§6.1).
    entry["response_mode"] = record.get("response_mode") if "response_mode" in record else "quick"
    if record.get("model") is not None:
        entry["model"] = record["model"]
    entry["segments"] = _segments_for_record(record, parts)
    if record.get("usage") is not None:
        entry["usage"] = record["usage"]
    if record.get("status") == "error" and record.get("error") is not None:
        entry["error"] = record["error"]
    if record.get("clarify") is not None:
        entry["clarify"] = record["clarify"]
    rating = (feedback_by_id or {}).get(record.get("message_id") or "")
    if rating:
        entry["feedback"] = {"rating": rating}
    return entry


def _segments_for_record(
    record: dict[str, Any], parts: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Return the ordered replay surface for a record.

    Current records persist ``segments`` directly, so this is usually a
    pass-through. Older records may only have compatibility fields. For those,
    synthesize the safest available replay: terminal steps first, then visible
    work text, then answer parts. The presence of ``narration`` means
    ``thinking`` is native model thinking; without it, historical records used
    ``thinking`` as the visible narration bucket, so keep that legacy meaning.
    """
    if "segments" in record:
        return list(record.get("segments") or [])

    segments: list[dict[str, Any]] = [
        {"kind": "step", "data": step} for step in record.get("steps") or []
    ]

    if "narration" in record:
        segments.extend(
            {"kind": "narration", "text": text} for text in record.get("narration") or [] if text
        )
        segments.extend(
            {"kind": "thinking", "text": text} for text in record.get("thinking") or [] if text
        )
    else:
        segments.extend(
            {"kind": "narration", "text": text} for text in record.get("thinking") or [] if text
        )

    for part in parts:
        if part.get("type") == "text" and part.get("text"):
            segments.append({"kind": "delta", "text": part["text"]})
        elif part.get("type") == "viz":
            segments.append({"kind": "viz", "spec": part.get("spec")})

    return segments


def _pre_mvp2_boundary(messages: list[dict[str, Any]], records: list[dict[str, Any]]) -> int:
    """Where the prose-only fallback ends: the FIRST record's offset.

    Records are in insertion order (the overwrite channel appends), so
    ``records[0]`` is the oldest — its offset is the boundary. A missing /
    non-int / out-of-range offset clamps to ``len(messages)`` with a warning:
    the read must degrade, never crash.
    """
    if not records:
        return len(messages)
    first = records[0].get("messages_offset")
    if not isinstance(first, int) or not 0 <= first <= len(messages):
        logger.warning(
            "first turn record has invalid messages_offset — clamping the "
            "pre-MVP2 fallback boundary to len(messages)",
            messages_offset=first,
        )
        return len(messages)
    return first


def extract_transcript(
    messages: list[dict[str, Any]],
    turn_records: list[dict[str, Any]] | None = None,
    feedback_by_id: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """The full-fidelity transcript (B1b, wire-contract §2).

    Turn records (G2) drive the MVP2 entries and are SELF-CONTAINED — the
    user text and the materialized parts live on the record; no ``messages``
    slicing. Messages not covered by any record (pre-MVP2 turns) fall back to
    the prose-only shape, in order, BEFORE the record-backed entries.

    ``feedback_by_id`` (B4) attaches the caller's rating to matching assistant
    entries; default empty → no ``feedback`` keys (pre-MVP2 behavior preserved).
    """
    records = turn_records or []
    entries = _prose_only_entries(messages[: _pre_mvp2_boundary(messages, records)])
    for record in records:
        entries.extend(_user_entries_for_record(record))
        entries.append(_assistant_entry_for_record(record, feedback_by_id))
    return entries
