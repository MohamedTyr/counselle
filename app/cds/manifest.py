"""Loads + caches the compiled CDS manifest at process start, and exposes the
domain/metric catalog and extraction-group partition to the engine and (later)
the review service (plan §B1 `app/cds/manifest.py`).

Never hardcode domain ids or metric inventories here (ADR 0032) -- every
function in this module derives its answer from the compiled manifest, which
in turn comes from `config/cds/` (P1's `domain/cds/manifest_compile.py`). The
only two constants below are the *identity* of the port (its filesystem
location and, informationally, the expected content hash asserted by
`scripts/cds_manifest_check.py`), not a domain or metric name.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import asyncpg

from domain.cds.manifest_compile import CompiledManifest, compile_manifest

CDS_CONFIG_DIR = Path(__file__).resolve().parents[2] / "config" / "cds"

# routing-tuning.md §8: a single call asking for a whole domain's metric
# catalog at once (up to 152 metrics on `admissions`) measured ~1-2% recall
# live; spike-part-a.md measured 99.3% field accuracy on a ~25-metric
# schema. This is the batch-size ceiling `metric_batches_for_domain` chunks
# to when a single CDS section alone still exceeds it -- not a manifest
# value (ADR 0032: never hardcode the metric catalog itself), purely an
# engine-side call-shaping knob.
DEFAULT_METRIC_BATCH_SIZE = 25

# CDS section codes whose metrics turn on telling "this control is drawn but
# unticked" apart from "there is no control here at all" -- a discrimination
# the model only gets right when it is given room to deliberate, and whose
# reading rule ("a drawn but unticked control is not_reported, NEVER false")
# is the exact inverse of the rule a sibling family needs ("a row with no
# control drawn is not_reported"). Because one prompt carries every metric in
# a batch, the two rules collide when they share one: adding the H10 rule
# while H14 sat in the same batch measurably produced 4 new H14
# hallucinations, and no rewording removed them. `metric_batches_for_domain`
# therefore isolates these metrics into batches of their own; `app/cds/
# engine.py` separately bills those batches the deliberation thinking budget.
# Fixed CDS-template section codes, not a metric catalog (ADR 0032).
DELIBERATION_HINTS = frozenset({"H14"})


class ManifestDriftError(RuntimeError):
    """`config/cds/` no longer compiles to the manifest version's published
    `content_sha256` in `cds_library.cds_manifests` (plan §B2, Risk 1). This
    must stop a run rather than silently extract against a manifest the
    read path does not actually have on file -- a mismatched
    `domain_schema_hash` would make every packet self-reject in
    `parse_packet_row()` anyway, but catching it here gives an operator an
    actionable error instead of 51 silent per-domain failures.
    """


@lru_cache(maxsize=1)
def load_compiled_manifest(config_dir: Path | None = None) -> CompiledManifest:
    """Compile `config/cds/` once per process and cache it. `config_dir` is a
    seam for tests; production call sites always use the default."""
    return compile_manifest(config_dir or CDS_CONFIG_DIR)


def domain_ids(manifest: CompiledManifest) -> tuple[str, ...]:
    """Every domain id the current manifest defines, in manifest order."""
    return tuple(domain["id"] for domain in manifest.content["domains"])


def extraction_groups(manifest: CompiledManifest) -> tuple[tuple[str, ...], ...]:
    """The manifest's configured call granularity (plan §B4 `CallPlan` seam --
    spike settled on keeping the inherited 7 groups; no per-domain or
    routing-call splitting)."""
    return tuple(tuple(group) for group in manifest.content["root"]["extraction_groups"])


def calls_for_domains(
    manifest: CompiledManifest, requested_domains: tuple[str, ...]
) -> list[tuple[str, ...]]:
    """Partition `requested_domains` into one model call per configured
    extraction group that has >=1 requested domain, preserving manifest
    order and never re-grouping across a configured group boundary.

    Raises `ValueError` if a requested domain is not covered by any group --
    an authoring bug in the manifest (`extraction_groups` must exactly
    partition every domain, enforced at compile time), or a caller passing an
    unknown domain id.
    """
    wanted = set(requested_domains)
    calls = [
        selected
        for group in extraction_groups(manifest)
        if (selected := tuple(domain_id for domain_id in group if domain_id in wanted))
    ]
    covered = {domain_id for call in calls for domain_id in call}
    missing = wanted - covered
    if missing:
        raise ValueError(
            f"requested domains not covered by any extraction group: {sorted(missing)}"
        )
    return calls


def metric_batches_for_domain(
    manifest: CompiledManifest, domain_id: str, *, max_batch_size: int = DEFAULT_METRIC_BATCH_SIZE
) -> tuple[tuple[dict[str, Any], ...], ...]:
    """One domain's compiled metrics, split into ordered, disjoint batches --
    the unit `app/cds/engine.py` now issues one model call per (routing-tuning.md
    §8), instead of a whole domain's catalog in one call.

    The natural boundary is the CDS question/section itself: metrics sharing
    a first `source_hints` entry (e.g. every `C1` metric) form one
    contiguous run (manifest metric order already groups by section --
    verified empirically, never interleaved). Consecutive small sections
    PACK into the same batch up to `max_batch_size` (most CDS sections are
    far smaller than the ceiling -- e.g. `admissions`'s `C3`/`C4` are each a
    single metric -- so batching strictly one-section-per-call would turn a
    13-domain run into 100+ tiny calls for no accuracy benefit). A section
    that alone exceeds `max_batch_size` is chunked further at that fixed
    size -- the fallback only, not the default, since a section split
    mid-question would separate metrics that share the same page context
    for no benefit. A batch never straddles a section boundary AND spills
    into fixed-size chunking at once: either a section fits whole into a
    (possibly shared) batch, or it alone is split.

    A `DELIBERATION_HINTS` section never packs with a section outside that
    set (in either direction): those metrics' reading rule contradicts the
    one its neighbours need, and one prompt carries a whole batch.

    Every metric appears in exactly one batch -- batches partition the
    domain's metrics, never duplicate or drop one -- so accumulating
    findings across every batch's call is safe from double-counting.
    """
    domain = next((d for d in manifest.content["domains"] if d["id"] == domain_id), None)
    if domain is None:
        raise ValueError(f"unknown domain in manifest: {domain_id!r}")
    batches: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    for section in _contiguous_sections(domain["metrics"]):
        if len(section) > max_batch_size:
            if current:
                batches.append(current)
                current = []
            batches.extend(
                section[start : start + max_batch_size]
                for start in range(0, len(section), max_batch_size)
            )
            continue
        if current and (
            len(current) + len(section) > max_batch_size
            or _is_deliberation_metric(current[0]) != _is_deliberation_metric(section[0])
        ):
            batches.append(current)
            current = []
        current.extend(section)
    if current:
        batches.append(current)
    return tuple(tuple(batch) for batch in batches)


def _is_deliberation_metric(metric: dict[str, Any]) -> bool:
    return bool(DELIBERATION_HINTS.intersection(metric["source_hints"]))


def _contiguous_sections(metrics: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """Group `metrics` (already in manifest order) into contiguous runs
    sharing the same first `source_hints` entry -- the CDS-section boundary
    `metric_batches_for_domain` packs batches around. `source_hints` is
    validated non-empty at manifest-compile time (manifest_types.py), so
    every metric has a real first hint to group by.

    Deliberation-hinted metrics also break a run, so that a section is never
    partly deliberation-hinted -- a metric can reach `DELIBERATION_HINTS`
    through a secondary hint while its first hint sections it elsewhere, and
    the packing rule above decides per section.
    """
    sections: list[list[dict[str, Any]]] = []
    open_key: tuple[str, bool] | None = None
    for metric in metrics:
        key = (metric["source_hints"][0], _is_deliberation_metric(metric))
        if not sections or key != open_key:
            sections.append([])
            open_key = key
        sections[-1].append(metric)
    return sections


def source_hints_for_domains(
    manifest: CompiledManifest, requested_domains: tuple[str, ...]
) -> tuple[str, ...]:
    """The union of every requested domain's metric `source_hints` (CDS
    section codes like "C1", "I-2") -- the page-routing seam's regex targets
    (plan §B4 `PageSelector`)."""
    wanted = set(requested_domains)
    hints: set[str] = set()
    for domain in manifest.content["domains"]:
        if domain["id"] in wanted:
            for metric in domain["metrics"]:
                hints.update(metric["source_hints"])
    return tuple(sorted(hints))


async def verify_manifest_current(pool: asyncpg.Pool, manifest: CompiledManifest) -> None:
    """Confirm the compiled `config/cds/` still matches the DB's published
    manifest row for `manifest.version` before it is trusted for a run.

    This is a drift *detector*, not a publisher -- P4 never writes
    `cds_manifests` (that stays a rare, manual `scripts/`-run action per plan
    §I2). Raises `ManifestDriftError` on any mismatch or missing row.
    """
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT content_sha256 FROM cds_library.cds_manifests WHERE version = $1",
            manifest.version,
        )
    if row is None:
        raise ManifestDriftError(
            f"manifest version {manifest.version!r} (compiled from config/cds/) has no row in "
            "cds_library.cds_manifests -- publish it before running the engine against it"
        )
    db_hash = row["content_sha256"]
    db_hash_hex = bytes(db_hash).hex()
    if db_hash_hex != manifest.content_sha256:
        raise ManifestDriftError(
            f"config/cds/ compiles to content_sha256={manifest.content_sha256} but "
            f"cds_library.cds_manifests version {manifest.version!r} has {db_hash_hex} -- "
            "config/cds/ has drifted from the published manifest; do not run the engine "
            "until this is resolved (plan §B2)"
        )


@dataclass(frozen=True)
class DomainHashDiff:
    """Which domain ids differ between a *published* manifest row's
    `domain_hashes` and a *compiled* candidate's -- the cheap half of
    hash-scoped incremental re-extraction (SHIP-PLAN §6.8). Feed
    `.changed_domains` straight into `service_review_approve.rerun_extraction`'s
    `domains` argument so a targeted rerun costs one domain instead of all
    thirteen.

    A domain id present on only one side is `added` or `removed`, never
    silently folded into `changed` -- an authoring bug that drops or renames
    a domain id should read as exactly that, not as an indistinguishable
    "hash changed". `unchanged` and `has_changes` exist so a caller never has
    to infer "nothing changed" from an empty-looking result -- see
    `has_changes`.
    """

    changed: tuple[str, ...]
    added: tuple[str, ...]
    removed: tuple[str, ...]
    unchanged: tuple[str, ...]

    @property
    def changed_domains(self) -> tuple[str, ...]:
        """Domain ids worth spending on a rerun for: changed or newly added.
        A `removed` domain has nothing left in `config/cds/` to extract."""
        return tuple(sorted({*self.changed, *self.added}))

    @property
    def has_changes(self) -> bool:
        """False means the diff is unambiguously "nothing to rerun" -- every
        domain matched -- rather than an empty result a caller might mistake
        for "the comparison found nothing" (e.g. a bad version)."""
        return bool(self.changed or self.added or self.removed)


def diff_domain_hashes(
    published_domain_hashes: dict[str, Any] | None, compiled: CompiledManifest
) -> DomainHashDiff:
    """Pure comparison of a published row's `domain_hashes` (`None` if no
    matching row exists) against `compiled`'s. Does no I/O, so it's directly
    unit-testable against constructed dicts -- `changed_domains_since_publish`
    below is the only caller that touches the database."""
    published = published_domain_hashes or {}
    compiled_ids = set(compiled.domain_hashes)
    published_ids = set(published)
    common = compiled_ids & published_ids
    changed = {
        domain_id
        for domain_id in common
        if compiled.domain_hashes[domain_id] != published[domain_id]
    }
    return DomainHashDiff(
        changed=tuple(sorted(changed)),
        added=tuple(sorted(compiled_ids - published_ids)),
        removed=tuple(sorted(published_ids - compiled_ids)),
        unchanged=tuple(sorted(common - changed)),
    )


async def changed_domains_since_publish(
    pool: asyncpg.Pool, compiled: CompiledManifest, *, version: str
) -> DomainHashDiff:
    """Fetch `version`'s published `domain_hashes` row (the same read
    `verify_manifest_current` performs, against `domain_hashes` instead of
    `content_sha256`, and against a caller-supplied version rather than
    always `compiled.version` -- so an operator can diff against a
    superseded row, e.g. the manifest version last actually extracted
    against) and diff it against `compiled`. Raises `ManifestDriftError` if
    `version` has no row at all -- there is nothing to diff against."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT domain_hashes FROM cds_library.cds_manifests WHERE version = $1",
            version,
        )
    if row is None:
        raise ManifestDriftError(
            f"manifest version {version!r} has no row in cds_library.cds_manifests -- "
            "nothing to diff against"
        )
    return diff_domain_hashes(row["domain_hashes"], compiled)


__all__ = [
    "CDS_CONFIG_DIR",
    "DEFAULT_METRIC_BATCH_SIZE",
    "DELIBERATION_HINTS",
    "DomainHashDiff",
    "ManifestDriftError",
    "calls_for_domains",
    "changed_domains_since_publish",
    "diff_domain_hashes",
    "domain_ids",
    "extraction_groups",
    "load_compiled_manifest",
    "metric_batches_for_domain",
    "source_hints_for_domains",
    "verify_manifest_current",
]
