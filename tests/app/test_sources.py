"""Unit tests for app/sources.py — the citation source registry. No I/O."""

from __future__ import annotations

import copy
from typing import Any

from app.sources import SourceRegistry
from domain.envelope import Citation, CitationEnvelope

# ---------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------


def _citation(**overrides: Any) -> Citation:
    base: dict[str, Any] = {
        "source": "ipeds",
        "tier": "official",
        "vintage": "IPEDS 2024-25 (provisional)",
        "raw_table": "adm2024",
        "url": None,
    }
    base.update(overrides)
    return Citation(**base)


def _envelope(field: str, citation: Citation) -> dict[str, Any]:
    return CitationEnvelope(
        field=field,
        label=field.split(".")[-1].replace("_", " "),
        display="42%",
        raw=0.42,
        available=True,
        unit="percent",
        citation=citation,
    ).model_dump(mode="json")


def _search_item(title: str, url: str, citation: Citation) -> dict[str, Any]:
    return {"title": title, "url": url, "snippet": "snip", "citation": citation.model_dump()}


# ---------------------------------------------------------------------------
# register: dedupe + stable indices
# ---------------------------------------------------------------------------


class TestRegister:
    def test_indices_are_sequential_starting_at_one(self) -> None:
        registry = SourceRegistry()
        assert registry.register(_citation(), "IPEDS") == 1
        assert registry.register(_citation(vintage="CDS 2025-26"), "CDS") == 2
        assert registry.register(_citation(url="https://duke.edu"), "Duke") == 3

    def test_dedupes_by_source_url_vintage_raw_table(self) -> None:
        registry = SourceRegistry()
        first = registry.register(_citation(), "IPEDS")
        again = registry.register(_citation(caveat="different caveat ignored"), "IPEDS bis")
        assert first == again == 1
        assert len(registry) == 1
        # First label wins on dedupe
        assert registry.entries[0].label == "IPEDS"

    def test_any_identity_field_change_makes_a_new_entry(self) -> None:
        registry = SourceRegistry()
        registry.register(_citation(), "a")
        assert registry.register(_citation(source="cds", tier="official"), "b") == 2
        assert registry.register(_citation(vintage="IPEDS 2023-24"), "c") == 3
        assert registry.register(_citation(raw_table="ic2024"), "d") == 4
        assert registry.register(_citation(url="https://x.edu"), "e") == 5

    def test_rebuild_from_dumped_state_preserves_indices(self) -> None:
        # Interrupt-resume re-executes the node: the registry must rebuild
        # from state.source_registry dicts and keep indices stable.
        first = SourceRegistry()
        first.register(_citation(), "IPEDS")
        first.register(_citation(vintage="CDS 2025-26"), "CDS")

        rebuilt = SourceRegistry(first.dump())
        assert len(rebuilt) == 2
        assert rebuilt.register(_citation(), "IPEDS") == 1  # dedupe survives the round-trip
        assert rebuilt.register(_citation(url="https://y.edu"), "new") == 3

    def test_dump_is_msgpack_plain(self) -> None:
        registry = SourceRegistry()
        registry.register(_citation(), "IPEDS")
        dumped = registry.dump()
        assert dumped == [
            {
                "index": 1,
                "label": "IPEDS",
                "citation": {
                    "source": "ipeds",
                    "tier": "official",
                    "vintage": "IPEDS 2024-25 (provisional)",
                    "caveat": None,
                    "raw_table": "adm2024",
                    "url": None,
                },
            }
        ]


# ---------------------------------------------------------------------------
# annotate_envelopes
# ---------------------------------------------------------------------------


class TestAnnotateEnvelopes:
    def test_get_values_shape_gains_markers_and_registry_grows(self) -> None:
        registry = SourceRegistry()
        ipeds = _citation()
        cds = _citation(source="cds", vintage="CDS 2025-26", raw_table=None)
        payload = [
            _envelope("admissions.acceptance_rate", ipeds),
            _envelope("admissions.yield_rate", ipeds),  # same citation → same marker
            _envelope("admissions.sat_math_75", cds),
        ]

        annotated = registry.annotate_envelopes(payload)

        assert [item["marker"] for item in annotated] == ["[1]", "[1]", "[2]"]
        assert len(registry) == 2
        # Envelope label defaults to the citation's vintage (already human)
        assert registry.entries[0].label == "IPEDS 2024-25 (provisional)"

    def test_nested_compare_shape_is_annotated(self) -> None:
        registry = SourceRegistry()
        payload = {
            "schools": [{"unitid": 198419, "name": "Duke University"}],
            "rows": [
                {
                    "label": "Acceptance rate",
                    "cells": [
                        _envelope("admissions.acceptance_rate", _citation()),
                        _envelope(
                            "admissions.acceptance_rate",
                            _citation(vintage="CDS 2025-26"),
                        ),
                    ],
                }
            ],
        }

        annotated = registry.annotate_envelopes(payload)

        cells = annotated["rows"][0]["cells"]
        assert [cell["marker"] for cell in cells] == ["[1]", "[2]"]
        assert len(registry) == 2

    def test_input_payload_is_not_mutated(self) -> None:
        registry = SourceRegistry()
        payload = [_envelope("admissions.acceptance_rate", _citation())]
        snapshot = copy.deepcopy(payload)

        registry.annotate_envelopes(payload)

        assert payload == snapshot  # no in-place "marker" key

    def test_non_envelope_payloads_pass_through(self) -> None:
        registry = SourceRegistry()
        assert registry.annotate_envelopes("plain text") == "plain text"
        assert registry.annotate_envelopes({"ok": True, "count": 3}) == {"ok": True, "count": 3}
        assert len(registry) == 0

    def test_malformed_citation_gets_no_marker(self) -> None:
        registry = SourceRegistry()
        payload = {"citation": {"source": "not-a-source", "tier": "official", "vintage": "x"}}

        annotated = registry.annotate_envelopes(payload)

        assert "marker" not in annotated
        assert len(registry) == 0


# ---------------------------------------------------------------------------
# annotate_search_results
# ---------------------------------------------------------------------------


class TestAnnotateSearchResults:
    def test_results_gain_markers_with_title_labels(self) -> None:
        registry = SourceRegistry()
        web = _citation(source="web", tier="community", raw_table=None)
        payload = {
            "results": [
                _search_item(
                    "Duke dorms guide",
                    "https://a.com/x",
                    web.model_copy(update={"url": "https://a.com/x"}),
                ),
                _search_item(
                    "Duke fees",
                    "https://b.com/y",
                    web.model_copy(update={"url": "https://b.com/y"}),
                ),
            ]
        }

        annotated = registry.annotate_search_results(payload)

        assert [item["marker"] for item in annotated["results"]] == ["[1]", "[2]"]
        assert [entry.label for entry in registry.entries] == ["Duke dorms guide", "Duke fees"]

    def test_error_payload_passes_through(self) -> None:
        registry = SourceRegistry()
        payload = {"error": "tavily down", "retryable": True}
        assert registry.annotate_search_results(payload) == payload
        assert len(registry) == 0

    def test_duplicate_urls_share_a_marker(self) -> None:
        registry = SourceRegistry()
        web = _citation(source="web", tier="community", raw_table=None, url="https://a.com/x")
        payload = {
            "results": [
                _search_item("One", "https://a.com/x", web),
                _search_item("Two", "https://a.com/x", web),
            ]
        }

        annotated = registry.annotate_search_results(payload)

        assert [item["marker"] for item in annotated["results"]] == ["[1]", "[1]"]
        assert len(registry) == 1

    def test_input_not_mutated(self) -> None:
        registry = SourceRegistry()
        web = _citation(source="web", tier="community", raw_table=None, url="https://a.com")
        payload = {"results": [_search_item("One", "https://a.com", web)]}
        snapshot = copy.deepcopy(payload)

        registry.annotate_search_results(payload)

        assert payload == snapshot
