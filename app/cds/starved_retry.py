"""One more retry for a domain that shares a call with a domain-mate that DID
succeed, yet still ends up with zero stored metrics of its own.

`engine._run_call`'s own retry (`engine._retry_clusters`) only fires when the
WHOLE call came back empty or dropped a citation -- it does not catch this
narrower case, observed live: Harvard's `identity` domain, sharing a call
with `class_profile`, produced zero identity findings even though its A0-A6
pages were fully inside the window (routing-tuning.md §2/§5). Split into its
own module purely to keep `app/cds/engine.py` under the file-size budget --
this is still engine orchestration, not a `domain/cds/` rule.

Imports `app.cds.engine` lazily inside the function body (not at module
level) since `engine.py` imports this module to call `retry_starved_domains`;
a module-level import here would be circular.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from adapters import cds_gemini, cds_pdf, cds_store
from domain.cds import packet_build, validators
from domain.cds import pages as pages_mod
from domain.cds.manifest_compile import CompiledManifest

if TYPE_CHECKING:
    from app.cds.engine import _RunState


async def retry_starved_domains(
    *,
    pool: Any,
    settings: Any,
    manifest: CompiledManifest,
    state: _RunState,
    run_contract: dict[str, Any],
    doc: cds_store.DocumentForExtraction,
    extraction: cds_store.ExtractionRecord,
    original_page_count: int,
    routing_text: dict[int, str],
    padded_ranges: dict[str, tuple[int, int]],
    doc_facts: validators.DocFacts,
    lease_lost: Any,
) -> None:
    """One retry, ISOLATED to just this domain with its own window grown one
    notch, before the run accepts the loss -- removing the shared-call
    attention confound is itself sometimes the fix. Mutates `state` in
    place; an outcome is only ever REPLACED, and only when the retry
    actually produced a storable packet."""
    from app.cds import (
        engine,  # noqa: PLC0415 -- deferred to break the import cycle, see module docstring
    )

    candidates = [
        domain_id
        for domain_id, outcome in state.domain_outcomes.items()
        if outcome.status is None and domain_id in padded_ranges
    ]
    for domain_id in candidates:
        if lease_lost is not None and lease_lost.is_set():
            break
        clusters = pages_mod.grow_clusters((padded_ranges[domain_id],), original_page_count)
        # Deliberately the domain's FULL metric catalog, unbached -- this
        # retry's whole point is isolating the domain from a shared-call
        # confound (module docstring), not narrowing its metric list; the
        # main run's batching (routing-tuning.md §8) already gave it that
        # chance across every one of its own batches before landing here.
        domain_metrics = tuple(
            packet_build.domain_metric_definitions(manifest.content, domain_id).values()
        )
        try:
            attempt = await engine._run_call_once(  # noqa: SLF001 -- sibling module, see docstring
                settings=settings,
                manifest_content=manifest.content,
                pdf_content=doc.pdf_content,
                original_page_count=original_page_count,
                routing_text=routing_text,
                batch_metrics=domain_metrics,
                clusters=clusters,
                page_text=doc_facts.page_text,
            )
        except (cds_gemini.CdsGeminiError, cds_pdf.CdsPdfError) as exc:
            error_record = {"domains": [domain_id], "starved_retry": True, "error": str(exc)}
            state.call_records.append(error_record)
            continue
        state.usage_total = engine._add_usage(state.usage_total, attempt.usage)  # noqa: SLF001
        state.call_records.append(
            {
                "domains": [domain_id],
                "narrowed": attempt.narrowed,
                "pages_sent": attempt.pages_sent,
                "retried": True,
                "latency_seconds": round(attempt.latency_seconds, 1),
                "findings": len(attempt.remapped_findings),
                "usage": engine._usage_dict(attempt.usage),  # noqa: SLF001
                "error": None,
                "starved_retry": True,
            }
        )
        if not attempt.remapped_findings:
            continue
        outcome = await engine._build_and_store_domain_packet(  # noqa: SLF001
            pool=pool,
            settings=settings,
            manifest=manifest,
            domain_id=domain_id,
            findings=attempt.remapped_findings,
            run_contract=run_contract,
            doc=doc,
            extraction=extraction,
            model_id=attempt.model_id,
            original_page_count=original_page_count,
            doc_facts=doc_facts,
        )
        if outcome.status is not None:
            state.domain_outcomes[domain_id] = outcome


__all__ = ["retry_starved_domains"]
