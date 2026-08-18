"""Unit tests for the pure/deterministic pieces of `app/cds/engine.py`.

Citation remapping itself (`app/cds/citation_remap.py`, plan §B4 decision 2)
has its own test module, `test_citation_remap.py` -- this file covers the
routing/prompt/retry-window/status machinery around it.
"""

from __future__ import annotations

from app.cds.batching import Batch
from app.cds.engine import (
    DomainOutcome,
    _build_prompt,
    _hit_pages_for_hints,
    _overall_status,
    _page_note,
    _retry_clusters,
    _route_batches,
    _route_domains,
)


def test_retry_clusters_targets_dropped_pages_when_present() -> None:
    assert _retry_clusters(((5, 14),), [24], original_page_count=30) == ((5, 14), (18, 30))


def test_retry_clusters_grows_existing_clusters_when_nothing_was_dropped() -> None:
    assert _retry_clusters(((10, 12),), [], original_page_count=30) == ((4, 18),)


def test_hit_pages_for_hints_tolerates_a_missing_or_unicode_dash() -> None:
    """Michigan's 2024-2025 CDS prints "I1"/"I2"/"I3" with no separator at
    all where the manifest's hint is "I-1" -- the exact gap that dropped
    `class_size`/`faculty` routing entirely on the corpus's 4.8MB file
    (the one whole-document fallback cannot survive, spike-part-b.md)."""
    routing_text = {
        1: "I1. Instructional Faculty by Category",
        2: "I‐2. Student to Faculty Ratio",  # U+2010 HYPHEN, not ASCII '-'
        3: "I-3. Undergraduate Class Size",
        4: "I10 unrelated section",
    }
    hits = _hit_pages_for_hints(routing_text, frozenset({"I-1", "I-2", "I-3"}))
    assert hits == [1, 2, 3]


def test_hit_pages_for_hints_anchors_on_whole_code_not_prefix() -> None:
    """"C1" must not match "C10"/"C13" — the exact false-positive spike part A's
    routing script was built to avoid (recon-cds-corpus.md §3)."""
    routing_text = {
        1: "C1\nTotal applicants",
        2: "C10 Waitlist policy",
        3: "  C1. Something indented",
    }
    hits = _hit_pages_for_hints(routing_text, frozenset({"C1"}))
    assert hits == [1, 3]


def test_route_domains_spans_first_to_last_hit_per_domain() -> None:
    manifest_content = {
        "domains": [
            {
                "id": "admissions",
                "metrics": [{"source_hints": ["C1"]}, {"source_hints": ["C7"]}],
            },
            {"id": "faculty", "metrics": [{"source_hints": ["I-2"]}]},
        ]
    }
    routing_text = {3: "C1 heading", 8: "C7 heading", 20: "unrelated"}

    routing = _route_domains(manifest_content, routing_text)

    assert routing == {"admissions": (3, 8)}
    assert "faculty" not in routing  # zero hits -> absent, caller falls back to whole document


def test_route_batches_spans_first_to_last_hit_per_batch_not_per_domain() -> None:
    """Decision 7 (routing-tuning.md §8): each batch routes off only its own
    metrics' `source_hints` -- a batch covering just C7 must not inherit the
    C1 batch's pages the way whole-domain `_route_domains` would."""
    batches = [
        Batch("admissions", 0, ({"source_hints": ["C1"]},), frozenset({"C1"})),
        Batch("admissions", 1, ({"source_hints": ["C7"]},), frozenset({"C7"})),
        Batch("faculty", 0, ({"source_hints": ["I-2"]},), frozenset({"I-2"})),
    ]
    routing_text = {3: "C1 heading", 8: "C7 heading", 20: "unrelated"}

    routing = _route_batches(routing_text, batches)

    assert routing == {"admissions#0": (3, 3), "admissions#1": (8, 8)}
    assert "faculty#0" not in routing  # zero hits -> absent, caller falls back to whole document


def test_page_note_identity_case_cites_physical_pages() -> None:
    note = _page_note(page_map=None, original_page_count=12)
    assert "physical pages 1-12" in note


def test_page_note_narrowed_case_states_the_position_mapping() -> None:
    note = _page_note(page_map={1: 5, 2: 6}, original_page_count=30)
    assert "position 1 = original page 5" in note
    assert "position 2 = original page 6" in note
    assert "NARROWED SUBSET" in note


def test_build_prompt_uses_exactly_the_metrics_its_caller_passed() -> None:
    """Decision 7 (routing-tuning.md §8): `_build_prompt` no longer filters a
    whole run's `metric_definitions` by domain group -- it dumps exactly the
    `metrics` tuple it was handed (a batch's slice, or a starved-retry
    domain's full catalog), so restriction to "only this call's own metrics"
    is now the caller's job, not this function's."""
    manifest_content = {"prompt": "shared prompt text"}
    metrics = ({"id": "admissions.c1_total"},)

    prompt = _build_prompt(
        manifest_content=manifest_content,
        metrics=metrics,
        page_map=None,
        original_page_count=10,
    )

    assert "admissions.c1_total" in prompt
    assert "faculty.ratio" not in prompt
    assert "shared prompt text" in prompt
    assert "Extract ONLY these 1 metrics" in prompt


def test_overall_status_succeeded_when_every_domain_stored_a_packet() -> None:
    outcomes = {
        "admissions": DomainOutcome("admissions", "validated", {}, 0, None),
        "faculty": DomainOutcome("faculty", "partial", {}, 1, None),
    }
    assert _overall_status(outcomes) == "succeeded"


def test_overall_status_partial_when_some_domains_produced_no_packet() -> None:
    outcomes = {
        "admissions": DomainOutcome("admissions", "validated", {}, 0, None),
        "faculty": DomainOutcome("faculty", None, None, 0, "call failed"),
    }
    assert _overall_status(outcomes) == "partial"


def test_overall_status_failed_when_no_domain_produced_a_packet() -> None:
    outcomes = {"admissions": DomainOutcome("admissions", None, None, 0, "call failed")}
    assert _overall_status(outcomes) == "failed"
