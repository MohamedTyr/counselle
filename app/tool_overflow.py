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
from urllib.parse import urlparse
from uuid import uuid4

from pydantic_core import to_json

from app.evidence_markers import scrub_evidence_tokens
from domain.events import tool_ui_from_payload

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
    # Evidence-use tokens are model/runtime telemetry, never durable payload.
    # Keep them in the compact result returned to the active model so its final
    # prose can promote pending evidence, but spill only the scrubbed value into
    # checkpointed ToolResultStore state.
    handle = store.put(scrub_evidence_tokens(value))
    preview_chars = max(200, min(max_chars // 2, 2_000))
    overflowed: dict[str, Any] = {
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
        "public_receipt": _public_receipt(value, chars=chars, handle=handle),
    }
    # The mutation-contract marker (agent mutation receipts plan §6.7/§7.4)
    # rides the top level, alongside — not inside — public_receipt; preserve
    # it through overflow so a corrupted/oversized mutation still resolves to
    # a safe synthesized "unknown" row instead of falling back to legacy.
    if isinstance(value, Mapping) and value.get("mutation_contract") == 1:
        overflowed["mutation_contract"] = 1
        overflowed = _shrink_to_compact_budget(overflowed)
    return overflowed


#: Separate budget for the *entire* compact overflow envelope of a mutation
#: tool (§6.6) — independent of ``max_chars`` (the spill trigger), and larger
#: than the raw mutation-receipt cap since it also carries the agent-facing
#: preview/sketch.
WORKSPACE_COMPACT_RESULT_MAX_BYTES = 10_240


def _shrink_to_compact_budget(overflowed: dict[str, Any]) -> dict[str, Any]:
    """Shrink preview/sketch/receipt-detail until the envelope fits the budget.

    The mutation receipt itself is preserved first and never touched here —
    it is already bounded by its own builder. Reduction order: shrink the
    agent-facing preview, then drop the sketch, before anything under
    ``public_receipt`` is touched.
    """
    if len(to_bytes(overflowed)) <= WORKSPACE_COMPACT_RESULT_MAX_BYTES:
        return overflowed

    result_for_agent = dict(overflowed.get("result_for_agent") or {})
    preview = result_for_agent.get("preview")
    if isinstance(preview, str) and preview:
        for shrunk_chars in (400, 100, 0):
            result_for_agent["preview"] = (
                truncate_text(preview, shrunk_chars, TruncationStrategy.head)
                if shrunk_chars
                else "[preview omitted: compact result over budget]"
            )
            candidate = {**overflowed, "result_for_agent": result_for_agent}
            if len(to_bytes(candidate)) <= WORKSPACE_COMPACT_RESULT_MAX_BYTES:
                return candidate
        overflowed = candidate

    result_for_agent = dict(overflowed.get("result_for_agent") or {})
    if result_for_agent.get("sketch"):
        result_for_agent["sketch"] = ""
        overflowed = {**overflowed, "result_for_agent": result_for_agent}
    return overflowed


#: The only fields of an oversized tool's own result an overflow receipt may
#: carry forward (§6.2 receipt contract) — everything else (packets, values,
#: excerpts, diagnostics, provider metadata, ...) stays spilled in the store.
_ALLOWED_TOP_LEVEL_STR_KEYS = ("status", "domain_id")


def _public_receipt(value: Any, *, chars: int, handle: str) -> dict[str, Any]:
    """Return only the student-safe structural receipt allowlist.

    ``chars`` and ``handle`` remain in ``result_for_agent`` for read-back; they
    are deliberately absent here because this mapping crosses the public step
    seam. The named parameters stay explicit to keep this helper's call site
    self-documenting.
    """
    del chars, handle
    receipt: dict[str, Any] = {}
    if isinstance(value, Mapping):
        for key in _ALLOWED_TOP_LEVEL_STR_KEYS:
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate:
                receipt[key] = candidate
        existing_receipt = value.get("public_receipt")
        if isinstance(existing_receipt, Mapping):
            ui = tool_ui_from_payload(existing_receipt.get("ui"))
            if ui is not None:
                receipt["ui"] = ui.model_dump()
            for key in ("value_count", "schools", "domain_id", "status"):
                candidate = existing_receipt.get(key)
                if candidate not in (None, [], ""):
                    receipt[key] = candidate
            for key in ("summary", "result_count", "workspace_items"):
                candidate = existing_receipt.get(key)
                if candidate not in (None, [], ""):
                    receipt[key] = candidate
            # The mutation receipt is already bounded to <=6,144 bytes by its
            # own builder (app.workspace_mutation_receipts.attach_mutation);
            # preserve it whole rather than reducing it a second time here.
            mutation = existing_receipt.get("mutation")
            if isinstance(mutation, Mapping):
                receipt["mutation"] = dict(mutation)
        # A single school's name (e.g. resolve_school/get_school_profile/
        # get_domain results) — flattened to the same "schools" list shape
        # the step receipt expects, never the raw school object.
        school = value.get("school")
        if "schools" not in receipt and isinstance(school, Mapping):
            name = school.get("name")
            if isinstance(name, str) and name:
                receipt["schools"] = [name]
        availability = value.get("availability")
        if "value_count" not in receipt and isinstance(availability, Mapping):
            available = availability.get("available")
            if isinstance(available, int):
                receipt["value_count"] = available
        results = value.get("results")
        if isinstance(results, list):
            receipt["result_count"] = len(results)
            source_results = _source_results(results)
            if source_results:
                receipt["source_results"] = source_results
        candidates = value.get("candidates")
        if isinstance(candidates, list):
            receipt["result_count"] = len(candidates)
            schools = [
                row.get("name")
                for row in candidates
                if isinstance(row, Mapping) and isinstance(row.get("name"), str)
            ]
            if schools:
                receipt["schools"] = schools
        rows = value.get("rows")
        if isinstance(rows, list):
            receipt["row_count"] = len(rows)
    elif isinstance(value, list):
        receipt["row_count"] = len(value)
    return {key: val for key, val in receipt.items() if val not in (None, [])}


def _domains_of(results: list[Any]) -> list[str]:
    domains: list[str] = []
    for result in results:
        if not isinstance(result, Mapping):
            continue
        url = result.get("url")
        if not url:
            continue
        host = urlparse(str(url)).netloc.removeprefix("www.")
        if host and host not in domains:
            domains.append(host)
    return domains


def _source_results(results: list[Any]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for result in results:
        if not isinstance(result, Mapping):
            continue
        url = result.get("url")
        if not isinstance(url, str) or not url.startswith(("http://", "https://")):
            continue
        if url in seen:
            continue
        seen.add(url)
        item = {"url": url}
        title = result.get("title")
        if isinstance(title, str) and title.strip():
            item["title"] = title.strip()
        out.append(item)
    return out


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
