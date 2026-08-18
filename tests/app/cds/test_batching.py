"""Tests for `app/cds/batching.py` -- the composition of
`manifest.metric_batches_for_domain` across a run's requested domains."""

from __future__ import annotations

from app.cds.batching import batches_for_domains
from app.cds.manifest import load_compiled_manifest


def test_batches_for_domains_covers_every_requested_domain_in_order() -> None:
    manifest = load_compiled_manifest()
    batches = batches_for_domains(manifest, ["class_size", "faculty"])
    domains_seen = [batch.domain_id for batch in batches]
    assert "class_size" in domains_seen
    assert "faculty" in domains_seen
    # class_size's batches all precede faculty's -- domain order preserved,
    # not interleaved.
    assert domains_seen.index("faculty") > domains_seen.index("class_size")
    assert max(i for i, d in enumerate(domains_seen) if d == "class_size") < domains_seen.index(
        "faculty"
    )


def test_batch_key_is_unique_per_domain_and_index() -> None:
    manifest = load_compiled_manifest()
    batches = batches_for_domains(manifest, ["class_size"])
    keys = [batch.key for batch in batches]
    assert len(keys) == len(set(keys))  # no collisions
    assert all(key.startswith("class_size#") for key in keys)


def test_batches_for_domains_computes_hints_as_metric_source_hints_union() -> None:
    manifest = load_compiled_manifest()
    batches = batches_for_domains(manifest, ["enrollment"])
    for batch in batches:
        expected = frozenset(
            hint for metric in batch.metrics for hint in metric["source_hints"]
        )
        assert batch.hints == expected
