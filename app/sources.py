"""Immutable per-answer v2 source registry and runtime-only evidence ledger."""

from __future__ import annotations

import re
from collections.abc import Hashable, Iterable, Mapping
from typing import Any, TypeGuard

from pydantic import ValidationError

from app.evidence_markers import evidence_token
from app.state import RegisteredSource
from config.settings import get_settings
from domain.envelope import Citation, EvidenceItem
from domain.events import SourceEntry

_MARKER = re.compile(r"^\[([1-9]\d*)\]$")
_MAX_TEXT_CHARS = 300


def _clean_text(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    return value.strip()[:_MAX_TEXT_CHARS]


def source_key(citation: Citation) -> Hashable:
    if citation.source == "cds":
        return ("cds", citation.document_sha256)
    if citation.source == "profile":
        return ("profile", citation.school_unitid, citation.profile_sha256)
    return (citation.source, citation.url, citation.vintage)


def _is_citation_shaped(value: Any) -> TypeGuard[dict[str, Any]]:
    return isinstance(value, dict) and {"source", "tier", "vintage"} <= value.keys()


class SourceRegistry:
    def __init__(self, entries: Iterable[Mapping[str, Any]] | None = None) -> None:
        self._entries = tuple(RegisteredSource.model_validate(entry) for entry in (entries or ()))
        self._pending: dict[tuple[int, str], EvidenceItem] = {}

    def __len__(self) -> int:
        return len(self._entries)

    @property
    def entries(self) -> tuple[RegisteredSource, ...]:
        return self._entries

    def register_source(self, citation: Citation, label: str, snippet: str | None = None) -> str:
        existing = self.marker_for(citation)
        if existing:
            return existing
        index = self._entries[-1].index + 1 if self._entries else 1
        self._entries = (
            *self._entries,
            RegisteredSource(
                index=index, citation=citation, label=label, snippet=_clean_text(snippet)
            ),
        )
        return f"[{index}]"

    def register(self, citation: Citation, label: str, snippet: str | None = None) -> int:
        return int(self.register_source(citation, label, snippet)[1:-1])

    def lookup_marker(self, marker: str) -> RegisteredSource | None:
        match = _MARKER.fullmatch(marker)
        if not match:
            return None
        index = int(match.group(1))
        return next((entry for entry in self._entries if entry.index == index), None)

    def marker_for(self, citation: Citation) -> str | None:
        key = source_key(citation)
        entry = next((item for item in self._entries if source_key(item.citation) == key), None)
        return f"[{entry.index}]" if entry else None

    def register_pending_evidence(self, marker: str, evidence: EvidenceItem) -> None:
        entry = self.lookup_marker(marker)
        if entry and entry.citation.source == "cds":
            self._pending[(entry.index, evidence.eid)] = evidence.model_copy(
                update={"excerpt": evidence.excerpt[:_MAX_TEXT_CHARS]}
            )

    def promote_pending_evidence(self, index: int, eid: str) -> bool:
        evidence = self._pending.get((index, eid))
        if evidence is None:
            return False
        self.register_used_evidence(index, evidence)
        return True

    def restore_pending_evidence_tokens(self, payload: Any) -> Any:
        """Reattach runtime-only tokens to a scrubbed overflow read-back copy."""
        if isinstance(payload, dict):
            restored = {
                key: self.restore_pending_evidence_tokens(value) for key, value in payload.items()
            }
            marker = restored.get("marker")
            eid = restored.get("field") or restored.get("ref")
            match = _MARKER.fullmatch(marker) if isinstance(marker, str) else None
            if match and isinstance(eid, str):
                index = int(match.group(1))
                if (index, eid) in self._pending:
                    restored["marker"] = f"{marker}{evidence_token(index, eid)}"
            return restored
        if isinstance(payload, list):
            return [self.restore_pending_evidence_tokens(item) for item in payload]
        if isinstance(payload, tuple):
            return tuple(self.restore_pending_evidence_tokens(item) for item in payload)
        return payload

    def register_used_evidence(self, index: int, evidence: EvidenceItem) -> None:
        cap = get_settings().source_evidence_max_items
        updated: list[RegisteredSource] = []
        for entry in self._entries:
            if entry.index != index or evidence.eid in entry.evidence_seen_eids:
                updated.append(entry)
                continue
            seen = (*entry.evidence_seen_eids, evidence.eid)
            stored = entry.evidence
            if len(stored) < cap:
                stored = (
                    *stored,
                    evidence.model_copy(update={"excerpt": evidence.excerpt[:_MAX_TEXT_CHARS]}),
                )
            updated.append(
                entry.model_copy(update={"evidence": stored, "evidence_seen_eids": seen})
            )
        self._entries = tuple(updated)

    def fork(self) -> SourceRegistry:
        candidate = SourceRegistry(self.dump_state())
        candidate._pending = dict(self._pending)
        return candidate

    def commit_from(self, candidate: SourceRegistry) -> None:
        self._entries = tuple(candidate._entries)
        self._pending = dict(candidate._pending)

    def dump_state(self) -> list[dict[str, Any]]:
        return [entry.model_dump(mode="json") for entry in self._entries]

    def entries_for_wire(self) -> list[SourceEntry]:
        return [
            SourceEntry(
                index=entry.index,
                citation=entry.citation,
                label=entry.label,
                snippet=entry.snippet,
                evidence=tuple(sorted(entry.evidence, key=lambda item: (item.page, item.eid))),
                evidence_omitted_count=len(entry.evidence_seen_eids) - len(entry.evidence),
            )
            for entry in self._entries
        ]

    def wire_dump(self) -> list[dict[str, Any]]:
        """Public, evidence-capped entries; never checkpoint-only seen-EID state."""
        return [entry.model_dump(mode="json") for entry in self.entries_for_wire()]

    def annotate_envelopes(self, payload: Any) -> Any:
        if isinstance(payload, dict):
            annotated = {key: self.annotate_envelopes(value) for key, value in payload.items()}
            if _is_citation_shaped(payload.get("citation")):
                marker = self._register_dict(payload["citation"], payload.get("source_label"))
                if marker:
                    annotated["marker"] = marker
                    evidence_raw = payload.get("evidence")
                    if evidence_raw:
                        try:
                            evidence = EvidenceItem.model_validate(evidence_raw)
                        except ValidationError:
                            pass
                        else:
                            self.register_pending_evidence(marker, evidence)
                            annotated["marker"] = (
                                f"{marker}{evidence_token(int(marker[1:-1]), evidence.eid)}"
                            )
                    annotated.pop("evidence", None)
            return annotated
        if isinstance(payload, list):
            return [self.annotate_envelopes(item) for item in payload]
        return payload

    def annotate_search_results(self, payload: Any) -> Any:
        if not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
            return payload
        results = []
        for original in payload["results"]:
            item = original
            if isinstance(item, dict) and _is_citation_shaped(item.get("citation")):
                marker = self._register_dict(
                    item["citation"],
                    item.get("title") or item.get("url"),
                    _clean_text(item.get("snippet")),
                )
                if marker:
                    item = {**item, "marker": marker}
            results.append(item)
        return {**payload, "results": results}

    def _register_dict(
        self, raw: dict[str, Any], label: str | None, snippet: str | None = None
    ) -> str | None:
        try:
            citation = Citation.model_validate(raw)
        except ValidationError:
            return None
        return self.register_source(citation, label or citation.vintage, snippet)
