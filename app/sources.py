"""The citation source registry (Phase 4 Slice B; ARCHITECTURE §9, ADR 0006/0013).

Every tool result that carries citations is intercepted before the model sees
it: each distinct citation is registered under the next marker index ``[n]``
and the payload is rewritten so every cited item carries ``"marker": "[n]"``.
The model is told to cite by repeating the bracketed numbers it was given —
it never constructs citation metadata; the ``sources`` event (Phase 5) renders
the registry verbatim.

State rule (notes-p4-apis §7): on an ``interrupt()`` resume the agent node
**re-executes from the top**, so the registry must never live in a module
global. It is constructed FROM ``state.source_registry`` dicts at the start of
each node execution and dumped BACK to plain dicts in the node's returned state
update — replay then rebuilds it cleanly with no duplicate accumulation.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any, TypeGuard

from pydantic import ValidationError

from app.state import RegisteredSource
from domain.envelope import Citation

#: Citation identity for dedupe: same source + url + vintage + raw_table = same marker.
_DedupeKey = tuple[str, str | None, str, str | None]

#: Cap stored snippets so a verbose search result never bloats the checkpointed
#: state — the UI only shows a couple of lines anyway.
_MAX_SNIPPET_CHARS = 300


def _clean_snippet(value: Any) -> str | None:
    """A trimmed, length-capped snippet, or ``None`` when there's nothing usable."""
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    if not trimmed:
        return None
    return trimmed[:_MAX_SNIPPET_CHARS]


def _dedupe_key(citation: Citation) -> _DedupeKey:
    return (citation.source, citation.url, citation.vintage, citation.raw_table)


def _is_citation_shaped(value: Any) -> TypeGuard[dict[str, Any]]:
    """True when ``value`` looks like a dumped :class:`Citation` dict."""
    return isinstance(value, dict) and {"source", "tier", "vintage"} <= value.keys()


class SourceRegistry:
    """The per-turn marker registry: index → citation + label.

    Wraps the state-owned ``list[RegisteredSource]`` (as plain dicts, ADR 0019
    serde rule). All ``annotate_*`` methods are pure with respect to their
    input payloads — they return new annotated copies, never mutate.
    """

    def __init__(self, entries: Iterable[Mapping[str, Any]] | None = None) -> None:
        self._entries: list[RegisteredSource] = [
            RegisteredSource.model_validate(entry) for entry in (entries or [])
        ]
        self._index_by_key: dict[_DedupeKey, int] = {
            _dedupe_key(entry.citation): entry.index for entry in self._entries
        }

    def __len__(self) -> int:
        return len(self._entries)

    @property
    def entries(self) -> list[RegisteredSource]:
        """The registered sources, in marker order (read-only view by convention)."""
        return list(self._entries)

    def register(self, citation: Citation, label: str, snippet: str | None = None) -> int:
        """Register a citation, returning its marker index (stable, 1-based).

        Dedupe is by ``(source, url, vintage, raw_table)`` — re-registering an
        already-seen citation returns the existing index; the first label (and
        snippet) wins.
        """
        key = _dedupe_key(citation)
        existing = self._index_by_key.get(key)
        if existing is not None:
            return existing
        index = self._entries[-1].index + 1 if self._entries else 1
        self._entries.append(
            RegisteredSource(index=index, citation=citation, label=label, snippet=snippet)
        )
        self._index_by_key[key] = index
        return index

    def dump(self) -> list[dict[str, Any]]:
        """Plain msgpack-safe dicts for ``state.source_registry`` (ADR 0019 serde rule)."""
        return [entry.model_dump(mode="json") for entry in self._entries]

    # ------------------------------------------------------------------
    # Payload annotation
    # ------------------------------------------------------------------

    def annotate_envelopes(self, payload: Any) -> Any:
        """Walk a tool result and add ``"marker": "[n]"`` next to every citation.

        Handles every envelope-carrying shape — a single envelope dict, lists
        of them (``get_values``), and nested containers (dossier sections,
        ``compare_schools`` rows). Anything without a citation passes through
        untouched. Returns a new structure; the input is never mutated.
        """
        if isinstance(payload, dict):
            annotated = {key: self.annotate_envelopes(value) for key, value in payload.items()}
            citation_dict = payload.get("citation")
            if _is_citation_shaped(citation_dict):
                marker = self._register_dict(citation_dict, label=None)
                if marker is not None:
                    annotated["marker"] = marker
            return annotated
        if isinstance(payload, list):
            return [self.annotate_envelopes(item) for item in payload]
        return payload

    def annotate_search_results(self, payload: Any) -> Any:
        """Annotate the Tavily ``{"results": [...]}`` shape (label = page title).

        Error payloads (``{"error": ...}``) and anything not results-shaped
        pass through unchanged. Returns a new structure; never mutates.
        """
        if not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
            return payload
        results: list[Any] = []
        for item in payload["results"]:
            if isinstance(item, dict) and _is_citation_shaped(item.get("citation")):
                label = item.get("title") or item.get("url") or None
                # Search items carry the page excerpt under "snippet"
                # (adapters.tavily_tools maps Tavily's `content` → `snippet`).
                snippet = _clean_snippet(item.get("snippet"))
                marker = self._register_dict(item["citation"], label=label, snippet=snippet)
                if marker is not None:
                    item = {**item, "marker": marker}
            results.append(item)
        return {**payload, "results": results}

    def _register_dict(
        self, citation_dict: dict[str, Any], label: str | None, snippet: str | None = None
    ) -> str | None:
        """Validate + register a dumped citation; ``None`` if it isn't a valid Citation.

        A malformed citation gets no marker (and never enters the registry) —
        the value still reaches the model with its raw citation attached, so
        nothing is hidden; we just refuse to mint a marker we can't stand by.
        """
        try:
            citation = Citation.model_validate(citation_dict)
        except ValidationError:
            return None
        # Default label for DB envelopes: the vintage is already the human
        # source string (e.g. "IPEDS 2024-25 (provisional)").
        index = self.register(citation, label or citation.vintage, snippet=snippet)
        return f"[{index}]"
