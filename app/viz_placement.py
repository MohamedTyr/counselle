from __future__ import annotations

import re
from collections.abc import Sequence
from typing import Any

from app.records import Emission

_MARKER_START = "[[viz:"
_MARKER_START_RE = re.compile(r"\[\[viz:")


class StreamingVizMarkerStripper:
    def __init__(self) -> None:
        self._prefix = ""
        self._inside_marker = False
        self._saw_closing_bracket = False
        self._swallowing_closing_junk = False

    def feed(self, text: str) -> str:
        if not text:
            return ""
        out: list[str] = []
        for char in text:
            if self._swallowing_closing_junk:
                if char == "]":
                    continue
                self._swallowing_closing_junk = False

            if self._inside_marker:
                if self._saw_closing_bracket:
                    if char == "]":
                        self._inside_marker = False
                        self._saw_closing_bracket = False
                        self._swallowing_closing_junk = True
                        continue
                    if char.isspace():
                        self._inside_marker = False
                        self._saw_closing_bracket = False
                        out.append(char)
                        continue
                    self._saw_closing_bracket = False
                    if char == "]":
                        self._saw_closing_bracket = True
                    continue
                if char == "]":
                    self._saw_closing_bracket = True
                    continue
                if char.isspace():
                    self._inside_marker = False
                    out.append(char)
                    continue
                continue

            candidate = f"{self._prefix}{char}"
            if _MARKER_START.startswith(candidate):
                self._prefix = candidate
                if candidate == _MARKER_START:
                    self._prefix = ""
                    self._inside_marker = True
                    self._saw_closing_bracket = False
                continue

            if self._prefix:
                flush = f"{self._prefix}{char}"
                suffix_len = _trailing_marker_prefix_len(flush)
                if suffix_len:
                    out.append(flush[:-suffix_len])
                    self._prefix = flush[-suffix_len:]
                else:
                    out.append(flush)
                    self._prefix = ""
                continue

            if char == "[":
                self._prefix = char
                continue
            out.append(char)
        return "".join(out)

    def flush(self) -> str:
        if self._inside_marker:
            self._inside_marker = False
            self._saw_closing_bracket = False
            self._swallowing_closing_junk = False
            self._prefix = ""
            return ""
        if self._prefix.startswith("[["):
            self._prefix = ""
            return ""
        pending = self._prefix
        self._prefix = ""
        return pending


def chunks_from_viz_markers(final_text: str, staged_specs: Sequence[Any]) -> list[Emission]:
    specs = list(staged_specs)
    emitted_indexes: set[int] = set()
    placed_chunks: list[Emission] = []
    cursor = 0

    while match := _MARKER_START_RE.search(final_text, cursor):
        _append_delta(placed_chunks, final_text[cursor : match.start()])
        marker_body_start = match.end()
        marker_end = final_text.find("]]", marker_body_start)
        next_marker_start = final_text.find("[[viz:", marker_body_start)
        if marker_end == -1 or (
            next_marker_start != -1 and next_marker_start < marker_end
        ):
            cursor = _incomplete_marker_end(final_text, marker_body_start)
            continue
        marker_value = final_text[marker_body_start:marker_end]
        if marker_value.isdigit():
            index = int(marker_value) - 1
            if 0 <= index < len(specs) and index not in emitted_indexes:
                placed_chunks.append(("viz", specs[index]))
                emitted_indexes.add(index)
        cursor = _marker_junk_end(final_text, marker_end + 2)

    _append_delta(placed_chunks, final_text[cursor:])
    fallback_chunks: list[Emission] = [
        ("viz", spec) for index, spec in enumerate(specs) if index not in emitted_indexes
    ]
    return [*placed_chunks, *fallback_chunks]


def _incomplete_marker_end(text: str, marker_body_start: int) -> int:
    whitespace = re.search(r"\s", text[marker_body_start:])
    if whitespace is None:
        return len(text)
    return marker_body_start + whitespace.start()


def _append_delta(chunks: list[Emission], text: str) -> None:
    if not text:
        return
    if chunks and chunks[-1][0] == "delta":
        chunks[-1] = ("delta", f"{chunks[-1][1]}{text}")
        return
    chunks.append(("delta", text))


def _marker_junk_end(text: str, cursor: int) -> int:
    while cursor < len(text) and text[cursor] == "]":
        cursor += 1
    return cursor


def _trailing_marker_prefix_len(text: str) -> int:
    return next(
        (
            length
            for length in range(min(len(text), len(_MARKER_START) - 1), 0, -1)
            if text.endswith(_MARKER_START[:length])
        ),
        0,
    )
