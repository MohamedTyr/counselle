"""Tests for `app/cds/manifest.py` against the real ported `config/cds/`
manifest -- the same corpus P1's `scripts/cds_manifest_check.py` gate covers,
reused here to test the domain/call-partitioning helpers this module adds on
top of P1's `compile_manifest`.
"""

from __future__ import annotations

from dataclasses import replace

import pytest

from app.cds.manifest import (
    DELIBERATION_HINTS,
    calls_for_domains,
    diff_domain_hashes,
    domain_ids,
    extraction_groups,
    load_compiled_manifest,
    metric_batches_for_domain,
    source_hints_for_domains,
)
from domain.cds.manifest_compile import CompiledManifest


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


def _with_domain_hashes(domain_hashes: dict[str, str]) -> CompiledManifest:
    """A real `CompiledManifest` with only `.domain_hashes` swapped out --
    `diff_domain_hashes` only ever reads that field, so this varies just the
    input under test instead of re-compiling `config/cds/` per case
    (SHIP-PLAN §6.8)."""
    return replace(load_compiled_manifest(), domain_hashes=domain_hashes)


def test_diff_domain_hashes_reports_no_changes_when_everything_matches() -> None:
    compiled = _with_domain_hashes({"admissions": "h1", "faculty": "h2"})
    diff = diff_domain_hashes({"admissions": "h1", "faculty": "h2"}, compiled)
    assert diff.changed == ()
    assert diff.added == ()
    assert diff.removed == ()
    assert diff.unchanged == ("admissions", "faculty")
    assert diff.has_changes is False
    assert diff.changed_domains == ()


def test_diff_domain_hashes_detects_a_changed_hash() -> None:
    compiled = _with_domain_hashes({"admissions": "h1-new", "faculty": "h2"})
    diff = diff_domain_hashes({"admissions": "h1-old", "faculty": "h2"}, compiled)
    assert diff.changed == ("admissions",)
    assert diff.added == ()
    assert diff.removed == ()
    assert diff.unchanged == ("faculty",)
    assert diff.has_changes is True
    assert diff.changed_domains == ("admissions",)


def test_diff_domain_hashes_detects_an_added_domain() -> None:
    """A domain in the compiled candidate but absent from the published row
    -- e.g. a brand-new domain file -- must show up as `added`, not silently
    merged into `changed` (it has no prior hash to differ from)."""
    compiled = _with_domain_hashes({"admissions": "h1", "new_domain": "h3"})
    diff = diff_domain_hashes({"admissions": "h1"}, compiled)
    assert diff.changed == ()
    assert diff.added == ("new_domain",)
    assert diff.removed == ()
    assert diff.unchanged == ("admissions",)
    assert diff.has_changes is True
    assert diff.changed_domains == ("new_domain",)


def test_diff_domain_hashes_detects_a_removed_domain() -> None:
    """A domain published but no longer in the compiled candidate -- e.g. a
    deleted domain file -- must show up as `removed`, distinct from
    `changed`, since there is nothing left to rerun for it."""
    compiled = _with_domain_hashes({"admissions": "h1"})
    diff = diff_domain_hashes({"admissions": "h1", "old_domain": "h9"}, compiled)
    assert diff.changed == ()
    assert diff.added == ()
    assert diff.removed == ("old_domain",)
    assert diff.unchanged == ("admissions",)
    assert diff.has_changes is True
    assert diff.changed_domains == ()  # nothing left to spend a rerun on


def test_diff_domain_hashes_treats_no_published_row_as_everything_added() -> None:
    compiled = _with_domain_hashes({"admissions": "h1", "faculty": "h2"})
    diff = diff_domain_hashes(None, compiled)
    assert diff.added == ("admissions", "faculty")
    assert diff.changed == ()
    assert diff.removed == ()
    assert diff.has_changes is True
