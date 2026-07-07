"""Minimal tool-result overflow helpers for Agent V1.

Payload helpers are adapted from pydantic-ai-harness
``experimental/overflow/_payload.py`` at
``b5b93704c3d997bf1910528d964306118589738c`` (MIT), trimmed to the
character-based behavior Counselle needs on PydanticAI 1.x.
"""

from __future__ import annotations

import re
from base64 import b64decode, b64encode
from collections.abc import Mapping, Sequence
from enum import StrEnum
from typing import Any, TypeGuard
from uuid import uuid4

from pydantic_core import to_json

_ANSI_ESCAPE_RE = re.compile(r"\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?\x07|\x1b[^[\]()]")


class TruncationStrategy(StrEnum):
    """Which end(s) of oversized text to keep when truncating."""

    head = "head"
    tail = "tail"
    head_tail = "head_tail"


class ToolResultStore:
    """Full-payload store for oversized tool results.

    The graph state is msgpack-plain, so ``dump()`` encodes raw binary payloads
    into plain dict wrappers before the store crosses a turn boundary.
    """

    def __init__(self, initial: Mapping[str, Any] | None = None) -> None:
        self._payloads: dict[str, Any] = {
            handle: _decode_stored_payload(payload)
            for handle, payload in (initial or {}).items()
        }

    def put(self, payload: Any) -> str:
        handle = f"tool-result-{uuid4().hex}"
        while handle in self._payloads:
            handle = f"tool-result-{uuid4().hex}"
        self._payloads[handle] = payload
        return handle

    def read(self, handle: str) -> Any:
        try:
            return self._payloads[handle]
        except KeyError:
            return {
                "error": "No spilled tool result exists for that handle.",
                "safe_retry": "Use a handle from a previous oversized tool-result summary.",
                "stop_condition": "The handle may be mistyped or may belong to another session.",
            }

    def dump(self) -> dict[str, Any]:
        """Return a msgpack-plain representation suitable for ``TurnState``."""
        return {
            handle: _encode_stored_payload(payload)
            for handle, payload in self._payloads.items()
        }


_BINARY_PAYLOAD_KIND = "counselle-tool-result-bytes-v1"


def _encode_stored_payload(payload: Any) -> Any:
    if is_binary(payload):
        return {
            "kind": _BINARY_PAYLOAD_KIND,
            "data": b64encode(bytes(payload)).decode("ascii"),
        }
    return payload


def _decode_stored_payload(payload: Any) -> Any:
    if (
        isinstance(payload, Mapping)
        and payload.get("kind") == _BINARY_PAYLOAD_KIND
        and isinstance(payload.get("data"), str)
    ):
        return b64decode(payload["data"].encode("ascii"))
    return payload


def strip_ansi(text: str) -> str:
    """Remove ANSI escape sequences from text."""
    return _ANSI_ESCAPE_RE.sub("", text)


def is_binary(value: object) -> bool:
    """Return True for raw byte payloads, which should not be text-truncated."""
    return isinstance(value, (bytes, bytearray, memoryview))


def to_bytes(value: object) -> bytes:
    """Serialize any tool return value to bytes suitable for a spill store."""
    if isinstance(value, str):
        return value.encode("utf-8")
    if isinstance(value, memoryview):
        return value.tobytes()
    if isinstance(value, (bytes, bytearray)):
        return bytes(value)
    return to_json(value)


def to_text(value: object) -> str:
    """Render a non-binary tool return value as text for measuring/truncating."""
    if isinstance(value, str):
        return value
    return to_json(value).decode("utf-8", errors="replace")


def measure(text: str) -> int:
    """Measure overflow size in characters."""
    return len(text)


def json_sketch(value: object) -> str:
    """Build a one-line shape hint for a structured value."""
    if _is_mapping(value):
        return _sketch_mapping(value)
    if _is_text_sequence(value):
        return _sketch_sequence(value)
    return ""


def truncate_text(
    text: str, max_chars: int, strategy: TruncationStrategy = TruncationStrategy.head_tail
) -> str:
    """Cut text to roughly max_chars, annotating what was removed."""
    total = len(text)
    if total <= max_chars:
        return text
    if strategy is TruncationStrategy.head:
        return f"{text[:max_chars]}\n\n[truncated: showing first {max_chars:,} of {total:,} chars]"
    if strategy is TruncationStrategy.tail:
        return f"[truncated: showing last {max_chars:,} of {total:,} chars]\n\n{text[-max_chars:]}"
    head_chars = max_chars * 2 // 5
    tail_chars = max_chars - head_chars
    omitted = total - head_chars - tail_chars
    return (
        f"{text[:head_chars]}\n\n"
        f"[truncated: {omitted:,} chars omitted from the middle; "
        f"showing first {head_chars:,} + last {tail_chars:,} of {total:,} chars]\n\n"
        f"{text[-tail_chars:]}"
    )


def reduce_tool_result(value: Any, store: ToolResultStore, *, max_chars: int) -> Any:
    """Replace oversized tool results with a compact read-back reference."""
    if max_chars <= 0:
        return value
    binary = is_binary(value)
    text = "<binary payload>" if binary else strip_ansi(to_text(value))
    chars = len(to_bytes(value)) if binary else measure(text)
    if chars <= max_chars:
        return value
    handle = store.put(value)
    preview_chars = max(200, min(max_chars // 2, 2_000))
    return {
        "status": "overflow",
        "summary": (
            f"Tool result was {chars:,} characters, so the full payload was spilled. "
            f"Call read_tool_result(handle='{handle}') if you need the complete result."
        ),
        "result_for_agent": {
            "handle": handle,
            "chars": chars,
            "preview": truncate_text(text, preview_chars),
            "sketch": json_sketch(value),
        },
        "public_receipt": {
            "label": "oversized tool result",
            "chars": chars,
            "handle": handle,
        },
    }


def _is_mapping(value: object) -> TypeGuard[Mapping[object, object]]:
    return isinstance(value, Mapping)


def _is_text_sequence(value: object) -> TypeGuard[Sequence[object]]:
    return isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray))


def _sketch_mapping(mapping: Mapping[object, object]) -> str:
    keys = list(mapping)
    shown = ", ".join(f"{key!r}: {type(mapping[key]).__name__}" for key in keys[:10])
    more = "" if len(keys) <= 10 else f", ... ({len(keys)} keys)"
    return f"{{{shown}{more}}}"


def _sketch_sequence(items: Sequence[object]) -> str:
    elem = type(items[0]).__name__ if items else "empty"
    return f"[{len(items)} items of {elem}]"
