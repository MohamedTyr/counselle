"""Tests for `app/cds/manifest.py` against the real ported `config/cds/`
manifest -- the same corpus P1's `scripts/cds_manifest_check.py` gate covers,
reused here to test the domain/call-partitioning helpers this module adds on
top of P1's `compile_manifest`.
"""

from __future__ import annotations

import pytest

from app.cds.manifest import (
    DELIBERATION_HINTS,
    calls_for_domains,
    domain_ids,
    extraction_groups,
    load_compiled_manifest,
    metric_batches_for_domain,
    source_hints_for_domains,
)


def test_load_compiled_manifest_matches_the_live_content_hash() -> None:
    manifest = load_compiled_manifest()
    assert manifest.content_sha256 == (
        "6367c0fee822f4d07725abc7274c8a589edefd64fb7301eac8372568941b04ae"
    )
    assert manifest.version == "5.1.0"


def test_domain_ids_and_extraction_groups_partition_every_domain() -> None:
    manifest = load_compiled_manifest()
    ids = domain_ids(manifest)
    groups = extraction_groups(manifest)
    assert len(ids) == 13
    covered = {domain_id for group in groups for domain_id in group}
    assert covered == set(ids)


def test_calls_for_domains_only_returns_groups_touching_requested_domains() -> None:
    manifest = load_compiled_manifest()
    calls = calls_for_domains(manifest, ("admissions",))
    assert len(calls) == 1
    assert "admissions" in calls[0]
    # The manifest's own group partition, e.g. [admissions, faculty] --
    # faculty is dragged along even though it wasn't requested. That's
    # intentional (7 fixed groups per decision 1's default granularity), but
    # a caller must not receive a domain it never asked for as an *output*
    # of calls_for_domains beyond this one call's own group membership.
    assert set(calls[0]) <= set(domain_ids(manifest))


def test_calls_for_domains_rejects_an_unknown_domain() -> None:
    manifest = load_compiled_manifest()
    with pytest.raises(ValueError, match="not covered"):
        calls_for_domains(manifest, ("not_a_real_domain",))


def test_source_hints_for_domains_includes_the_c7_checkbox_code() -> None:
    manifest = load_compiled_manifest()
    hints = source_hints_for_domains(manifest, ("admissions",))
    assert "C7" in hints
    assert "C1" in hints


def test_metric_batches_for_domain_partitions_every_metric_exactly_once() -> None:
    """routing-tuning.md §8: batches must never drop or duplicate a metric --
    accumulating findings across a domain's batches would silently lose or
    double-count claims otherwise."""
    manifest = load_compiled_manifest()
    batches = metric_batches_for_domain(manifest, "admissions")
    all_ids = [metric["id"] for batch in batches for metric in batch]
    domain = next(d for d in manifest.content["domains"] if d["id"] == "admissions")
    expected_ids = [metric["id"] for metric in domain["metrics"]]
    assert all_ids == expected_ids  # same metrics, same manifest order, no gaps/dupes


def test_metric_batches_for_domain_keeps_a_cds_section_together_when_small() -> None:
    manifest = load_compiled_manifest()
    batches = metric_batches_for_domain(manifest, "class_size", max_batch_size=25)
    # class_size has 22 metrics (well under the 25 ceiling) -- confirms the
    # section-boundary split doesn't fragment a small domain needlessly.
    assert len(batches) <= 3


def test_metric_batches_for_domain_chunks_a_section_larger_than_the_ceiling() -> None:
    manifest = load_compiled_manifest()
    batches = metric_batches_for_domain(manifest, "admissions", max_batch_size=10)
    assert all(len(batch) <= 10 for batch in batches)
    assert len(batches) > 1


def test_metric_batches_for_domain_never_mixes_deliberation_metrics_with_others() -> None:
    """One prompt carries a whole batch, and the deliberation families'
    reading rule contradicts the one their neighbours need -- measured: the
    two in one batch produced 4 new H14 hallucinations."""
    manifest = load_compiled_manifest()
    for domain_id in domain_ids(manifest):
        for batch in metric_batches_for_domain(manifest, domain_id):
            hinted = {bool(DELIBERATION_HINTS.intersection(m["source_hints"])) for m in batch}
            assert len(hinted) == 1, f"{domain_id} batch mixes {[m['id'] for m in batch]}"


def test_metric_batches_for_domain_rejects_an_unknown_domain() -> None:
    manifest = load_compiled_manifest()
    with pytest.raises(ValueError, match="unknown domain"):
        metric_batches_for_domain(manifest, "not_a_real_domain")
