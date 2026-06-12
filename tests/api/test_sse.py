"""Tests for api/sse.py — ServerSentEvent framing and SSE_HEADERS.

Protocol contract (Slice C, Phase 5 test 8):
- Each encoded event contains ``event: <type>`` and ``data: <json>`` lines.
- The JSON payload is parseable and carries ``v``, ``type``, ``data`` keys.
- The ``id:`` field equals the stringified sequence number.
- ``SSE_HEADERS`` includes the two required headers.
"""

from __future__ import annotations

import json

import pytest
from sse_starlette import ServerSentEvent

from api.sse import SSE_HEADERS, encode_sse
from domain.events import UsageData, ev_delta, ev_done, ev_error, ev_meta, ev_usage

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _sse_data(sse: ServerSentEvent) -> str:
    """Return sse.data as str; raises AssertionError if None (encode_sse always sets it)."""
    assert sse.data is not None
    return str(sse.data)


def _parse_sse_bytes(raw: bytes) -> dict[str, str]:
    """Parse the fields of a single SSE frame from its wire bytes.

    Returns a dict with keys ``"id"``, ``"event"``, ``"data"`` (only those
    present).  CRLF and LF line endings are both accepted.
    """
    text = raw.decode()
    fields: dict[str, str] = {}
    for line in text.splitlines():
        if line.startswith("id: "):
            fields["id"] = line[4:]
        elif line.startswith("event: "):
            fields["event"] = line[7:]
        elif line.startswith("data: "):
            fields["data"] = line[6:]
    return fields


# ---------------------------------------------------------------------------
# SSE_HEADERS
# ---------------------------------------------------------------------------


class TestSSEHeaders:
    def test_cache_control_no_store(self) -> None:
        assert SSE_HEADERS["Cache-Control"] == "no-store"

    def test_x_accel_buffering_no(self) -> None:
        assert SSE_HEADERS["X-Accel-Buffering"] == "no"


# ---------------------------------------------------------------------------
# encode_sse — ServerSentEvent attributes
# ---------------------------------------------------------------------------


class TestEncodeSSEAttributes:
    def test_returns_server_sent_event(self) -> None:
        sse = encode_sse(ev_delta("hello"), seq=0)
        assert isinstance(sse, ServerSentEvent)

    def test_event_field_matches_type(self) -> None:
        sse = encode_sse(ev_delta("hi"), seq=1)
        assert sse.event == "delta"

    def test_id_field_is_stringified_seq(self) -> None:
        sse = encode_sse(ev_done("complete"), seq=42)
        assert sse.id == "42"

    def test_data_is_compact_json(self) -> None:
        event = ev_delta("test text")
        sse = encode_sse(event, seq=5)
        parsed = json.loads(_sse_data(sse))
        assert parsed["v"] == 1
        assert parsed["type"] == "delta"
        assert parsed["data"]["text"] == "test text"

    def test_meta_event_type(self) -> None:
        event = ev_meta("trace-1", "session-1", "gemini-2.5-pro", "m-1", "um-1")
        sse = encode_sse(event, seq=0)
        assert sse.event == "meta"
        parsed = json.loads(_sse_data(sse))
        assert parsed["data"]["trace_id"] == "trace-1"

    def test_done_event_status(self) -> None:
        event = ev_done("complete")
        sse = encode_sse(event, seq=99)
        parsed = json.loads(_sse_data(sse))
        assert parsed["data"]["status"] == "complete"

    def test_usage_event_preserves_fields(self) -> None:
        usage = UsageData(input_tokens=100, output_tokens=50, tool_calls=2, est_cost_usd=0.005)
        event = ev_usage(usage)
        sse = encode_sse(event, seq=7)
        parsed = json.loads(_sse_data(sse))
        assert parsed["type"] == "usage"
        assert parsed["data"]["input_tokens"] == 100
        assert parsed["data"]["output_tokens"] == 50
        assert parsed["data"]["est_cost_usd"] == pytest.approx(0.005)

    def test_error_event_fields(self) -> None:
        event = ev_error("Something went wrong", "trace-err")
        sse = encode_sse(event, seq=3)
        assert sse.event == "error"
        parsed = json.loads(_sse_data(sse))
        assert parsed["data"]["trace_id"] == "trace-err"


# ---------------------------------------------------------------------------
# encode_sse — wire bytes (naive line-parser contract, Slice C test 8)
# ---------------------------------------------------------------------------


class TestEncodeSSEWireBytes:
    """Verify the SSE wire format parseable by a naive line-splitting harness."""

    def test_wire_bytes_contain_event_line(self) -> None:
        sse = encode_sse(ev_delta("world"), seq=2)
        raw = sse.encode()
        assert b"event: delta" in raw

    def test_wire_bytes_contain_data_line(self) -> None:
        sse = encode_sse(ev_delta("world"), seq=2)
        raw = sse.encode()
        assert b"data: " in raw

    def test_wire_bytes_contain_id_line(self) -> None:
        sse = encode_sse(ev_done("complete"), seq=10)
        raw = sse.encode()
        assert b"id: 10" in raw

    def test_data_json_parseable_from_wire_bytes(self) -> None:
        event = ev_delta("hello world")
        sse = encode_sse(event, seq=1)
        fields = _parse_sse_bytes(sse.encode())
        assert "data" in fields
        parsed = json.loads(fields["data"])
        assert parsed["type"] == "delta"
        assert parsed["data"]["text"] == "hello world"

    def test_event_type_parseable_from_wire_bytes(self) -> None:
        event = ev_done("awaiting_input")
        sse = encode_sse(event, seq=5)
        fields = _parse_sse_bytes(sse.encode())
        assert fields["event"] == "done"
        parsed = json.loads(fields["data"])
        assert parsed["data"]["status"] == "awaiting_input"

    def test_id_parseable_from_wire_bytes(self) -> None:
        event = ev_meta("t1", "s1", "gemini-2.5-flash", "m-1", "um-1")
        sse = encode_sse(event, seq=0)
        fields = _parse_sse_bytes(sse.encode())
        assert fields["id"] == "0"

    def test_data_payload_has_protocol_version(self) -> None:
        event = ev_delta("x")
        sse = encode_sse(event, seq=0)
        fields = _parse_sse_bytes(sse.encode())
        parsed = json.loads(fields["data"])
        assert parsed["v"] == 1

    def test_compact_json_no_spaces_after_separators(self) -> None:
        event = ev_delta("compact")
        sse = encode_sse(event, seq=0)
        fields = _parse_sse_bytes(sse.encode())
        # Compact = separators=(",", ":") → no space after colon or comma at top level
        assert '": ' not in fields["data"]
