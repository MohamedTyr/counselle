"""Single grammar and streaming stripper for internal evidence-use tokens."""

from __future__ import annotations

import re
import string
from collections.abc import Callable

_EID = r"[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*"
_TOKEN = re.compile(rf"^\[\[evidence:([1-9]\d*):({_EID})\]\]$")
_START = "[[evidence:"
_MAX_CANDIDATE_CHARS = 256
_BODY_CHARS = frozenset(string.ascii_lowercase + string.digits + "_.:")


def evidence_token(index: int, eid: str) -> str:
    token = f"[[evidence:{index}:{eid}]]"
    if _TOKEN.fullmatch(token) is None:
        raise ValueError("invalid evidence marker identity")
    return token


class EvidenceMarkerStripper:
    """Strip tokens across arbitrary chunking and promote only exact valid pairs."""

    def __init__(self, promote: Callable[[int, str], bool]) -> None:
        self._promote = promote
        self._pending = ""
        self._discarding = False
        self._discard_close = False

    @property
    def has_pending_candidate(self) -> bool:
        """Whether visible prose must wait for a split hidden token to resolve."""
        return bool(self._pending or self._discarding or self._discard_close)

    def feed(self, text: str) -> str:
        if self._discarding:
            text = self._discard_overlong(text)
        self._pending += text
        return self._drain(final=False)

    def flush(self) -> str:
        if self._discarding:
            self._discarding = False
            self._discard_close = False
        return self._drain(final=True)

    def _discard_overlong(self, text: str) -> str:
        """Discard an overlong candidate without retaining its payload."""
        if self._discard_close:
            self._discard_close = False
            if text.startswith("]"):
                self._discarding = False
                return text[1:]
            return self._discard_overlong(text)

        for index, char in enumerate(text):
            if char == "]":
                if index + 1 == len(text):
                    self._discard_close = True
                    return ""
                if text[index + 1] == "]":
                    self._discarding = False
                    return text[index + 2 :]
                return self._discard_overlong(text[index + 1 :])
            if char not in _BODY_CHARS:
                self._discarding = False
                return text[index:]
        return ""

    def _drain(self, *, final: bool) -> str:
        output: list[str] = []
        while self._pending:
            start = self._pending.find(_START)
            if start < 0:
                keep = 0 if final else _prefix_suffix_length(self._pending)
                output.append(self._pending if not keep else self._pending[:-keep])
                self._pending = "" if not keep else self._pending[-keep:]
                break
            output.append(self._pending[:start])
            self._pending = self._pending[start:]
            end = self._pending.find("]]", len(_START))
            if end < 0:
                body = self._pending[len(_START) :]
                boundary = next(
                    (
                        index
                        for index, char in enumerate(body, len(_START))
                        if char.isspace()
                    ),
                    None,
                )
                # Whitespace cannot occur in the grammar, so it safely ends an
                # invented/unterminated candidate. Drop the hidden-looking
                # prefix and payload while preserving prose from the boundary.
                if boundary is not None:
                    self._pending = self._pending[boundary:]
                    continue
                # A hostile never-ending candidate cannot make the streaming
                # buffer grow without bound.  Once capped, discard the prefix
                # and capped candidate; any later prose is processed normally.
                if len(self._pending) >= _MAX_CANDIDATE_CHARS:
                    remainder = self._pending[_MAX_CANDIDATE_CHARS:]
                    self._pending = ""
                    self._discarding = True
                    self._pending = self._discard_overlong(remainder)
                    continue
                if final:
                    self._pending = ""
                break
            raw = self._pending[: end + 2]
            match = _TOKEN.fullmatch(raw)
            if match:
                self._promote(int(match.group(1)), match.group(2))
            self._pending = self._pending[end + 2 :]
        return "".join(output)


def _prefix_suffix_length(text: str) -> int:
    return next(
        (n for n in range(min(len(text), len(_START) - 1), 0, -1) if text.endswith(_START[:n])), 0
    )


def scrub_evidence_tokens(value: object) -> object:
    """Remove hidden tokens from every string leaf without reshaping messages."""
    if isinstance(value, str):
        stripper = EvidenceMarkerStripper(lambda _index, _eid: False)
        return stripper.feed(value) + stripper.flush()
    if isinstance(value, list):
        return [scrub_evidence_tokens(item) for item in value]
    if isinstance(value, tuple):
        return tuple(scrub_evidence_tokens(item) for item in value)
    if isinstance(value, dict):
        return {key: scrub_evidence_tokens(item) for key, item in value.items()}
    return value
