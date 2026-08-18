"""Composes each requested domain's `metric_batches_for_domain` chunks into
the flat list of `Batch`es `app/cds/engine.py` issues one model call per
(routing-tuning.md §8).

Split out of `engine.py` purely to keep it under the file-size budget and to
make the batch-planning shape independently testable, mirroring why
`citation_remap.py`/`starved_retry.py` already exist as their own modules --
this module holds no I/O and no model-call logic, only the pure composition
of `app/cds/manifest.py`'s per-domain split into one run's full batch plan.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.cds import manifest as manifest_mod
from domain.cds.manifest_compile import CompiledManifest


@dataclass(frozen=True)
class Batch:
    """One model call's worth of metrics, all from a single domain: one CDS
    section's metrics, or a fixed-size slice of one when the section alone
    exceeds the batch-size ceiling (`manifest.metric_batches_for_domain`)."""

    domain_id: str
    batch_index: int
    metrics: tuple[dict[str, Any], ...]
    hints: frozenset[str]

    @property
    def key(self) -> str:
        """A stable page-routing identity for this batch -- distinct per
        (domain, batch_index), so two batches (same or different domains)
        never collide in a routing/padded-ranges dict keyed by it."""
        return f"{self.domain_id}#{self.batch_index}"


def batches_for_domains(manifest: CompiledManifest, domain_ids: list[str]) -> list[Batch]:
    """Every batch across `domain_ids`, in manifest order within each
    domain and in `domain_ids`' own order across domains -- the full,
    deterministic call plan for one run."""
    batches: list[Batch] = []
    for domain_id in domain_ids:
        chunks = manifest_mod.metric_batches_for_domain(manifest, domain_id)
        for index, metrics in enumerate(chunks):
            hints = frozenset(hint for metric in metrics for hint in metric["source_hints"])
            batches.append(Batch(domain_id, index, metrics, hints))
    return batches


__all__ = ["Batch", "batches_for_domains"]
