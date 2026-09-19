"""`python -m app.sat fetch` — downloads College Board's public SAT Suite
Question Bank into `artifacts/sat-practice/raw/<run>/` (plan
plans/sat-practice/plan.md §3.2).

All network access goes through `adapters/collegeboard/client.py` — the
only module that talks to College Board. This module's job is orchestration
only: lay out the run directory, call the client in the plan-mandated
order, and write every response verbatim to disk before anything parses it.

**Fetch order (plan §3.2):** E4 (lookup) -> E1 for assessment 99's two
tests (the source of truth for content ids) -> E1 for 100 and 102 (fetched
only to re-assert the content-id superset claim in §3.1 -- never used to
build the detail-fetch worklist below) -> E2 (qbank detail) or E3
(disclosed legacy item) for every unique content id (`external_id`, else
`ibn`) named by a 99 stub.

**E1 must be called once per domain code, not once per test (measured
2026-09-19, undocumented by the plan's own §3.1 request shape).** A
`domain: null` or `domain: "All"` body returns a `500 VALIDATION_ERROR` or
a silent `[]`; the plan's own §3.1 "Counts" paragraph already names the
real values -- test 1 (R&W)'s four `primaryClassCd`s `INI`/`CAS`/`EOI`/
`SEC`, test 2 (Math)'s `H`/`P`/`Q`/`S` -- so this module fetches each of a
test's four domains, each response written verbatim to its own
`list/asmt<assessment>_test<test>_<DOMAIN>.json` before anything parses it.
The `list/asmt<assessment>_test<test>.json` the plan's layout names is a
**derived artifact**: it is rebuilt every run (cheap -- no network once the
per-domain files are cached) by concatenating those four files in fixed
domain order, de-duplicating only by `questionId` (see `_dedupe_stubs` --
it must **not** dedupe by content id: assessment 99 test 2's `H` and `P`
domain files each carry a stub with a different `questionId` than one in
the other domain file for the same content id, three such pairs measured
on the 20260919T182959Z run -- both `questionId`s of every pair are real
stubs the build step needs, plan §3.3/G3), and stamping `test`/`module`
onto every stub (the `domain/sat/normalize.py::_module_from_stub` contract
-- real E1 stubs carry neither key). Nothing downstream needs to know the
merge happened, but the per-domain files are what "each response written
verbatim to disk before anything parses it" and per-domain resumability
actually mean here.

**Resumable and idempotent.** Every response is written to its own file
before parsing; a rerun over the same `run_dir` skips any file that already
exists and parses as JSON, so an interrupted run costs only the requests it
had not yet completed. A stub whose detail still fails (after the client's
own 429/5xx/timeout retries) is recorded in `failures.json` and the run
exits non-zero -- it does not abort the rest of the fetch, since one bad
id should not cost the ~3,800 requests around it.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

from adapters.collegeboard.client import (
    CollegeBoardClient,
    CollegeBoardConfig,
    CollegeBoardError,
    build_client,
)
from config.settings import Settings

logger = logging.getLogger(__name__)

__all__ = ["FetchSummary", "run_fetch"]

# (assessmentEventId, test) pairs for E1, in the plan-mandated order.
# Assessment 99 = SAT, the source of truth for content ids; 100 (PSAT/NMSQT
# & PSAT 10) and 102 (PSAT 8/9) are fetched only to re-assert the superset
# claim (plan §3.1) and never read to build the detail worklist below.
_PRIMARY_LIST_CALLS: tuple[tuple[int, int], ...] = ((99, 1), (99, 2))
_SUPERSET_CHECK_LIST_CALLS: tuple[tuple[int, int], ...] = (
    (100, 1),
    (100, 2),
    (102, 1),
    (102, 2),
)

# `primaryClassCd`s per `test` (plan §3.1's "Counts" paragraph), the only
# `domain` values E1 accepts (measured -- see module docstring).
_RW_DOMAIN_CODES: tuple[str, ...] = ("INI", "CAS", "EOI", "SEC")
_MATH_DOMAIN_CODES: tuple[str, ...] = ("H", "P", "Q", "S")


def _domain_codes(test: int) -> tuple[str, ...]:
    return _RW_DOMAIN_CODES if test == 1 else _MATH_DOMAIN_CODES


# The bucket already paces every request to `sat_fetch_requests_per_second`;
# this only bounds how many detail fetches are in flight (and therefore how
# many open connections/pending tasks) at once.
_DETAIL_CONCURRENCY = 4

# Progress-log cadence over the ~3,800-item detail fetch (plan: "log
# progress every N items").
_PROGRESS_LOG_EVERY = 200


@dataclass(frozen=True)
class _ContentId:
    """One unique content id to fetch a detail for -- `external_id` (qbank,
    E2) if present, else `ibn` (legacy disclosed, E3). Never both, never
    neither: every assessment-99 stub carries exactly one (plan §3.1)."""

    external_id: str | None
    ibn: str | None

    @property
    def key(self) -> str:
        if self.external_id is None and self.ibn is None:
            raise ValueError(f"stub carries neither external_id nor ibn: {self!r}")
        return self.external_id or self.ibn  # type: ignore[return-value]


@dataclass
class _DetailCounters:
    fetched: int = 0
    skipped: int = 0
    failed: int = 0

    @property
    def done(self) -> int:
        return self.fetched + self.skipped + self.failed


@dataclass
class FetchSummary:
    """Written to `run_dir/run.json`; `ok` (no failures) is what
    `python -m app.sat fetch`'s exit code reflects."""

    started_at: str
    finished_at: str
    stub_count: int
    unique_content_ids: int
    details_fetched: int
    details_skipped: int
    details_failed: int
    failures: list[dict[str, str]] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.failures

    def run_json(self) -> dict[str, Any]:
        """`run.json`'s contents -- counts only; failures live in the
        separate `failures.json` (plan: "presence = failed run")."""
        return {
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "counts": {
                "stubs": self.stub_count,
                "unique_content_ids": self.unique_content_ids,
                "details_fetched": self.details_fetched,
                "details_skipped": self.details_skipped,
                "details_failed": self.details_failed,
            },
        }


def _load_existing_json(path: Path) -> Any | None:
    """Resumability primitive: a file that exists and parses as JSON is
    treated as already fetched. A file that exists but fails to parse (a
    truncated write from a killed process) is treated as missing -- it will
    be overwritten by the retry, never left corrupt."""
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except (json.JSONDecodeError, UnicodeDecodeError):
        logger.warning("sat.fetch: existing file failed to parse, refetching: %s", path)
        return None


def _write_atomic(path: Path, body: bytes) -> None:
    """Write-then-rename so a killed process never leaves a half-written
    file that `_load_existing_json` would wrongly treat as valid-but-empty."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_bytes(body)
    tmp_path.replace(path)


async def _fetch_and_cache(path: Path, fetch: Callable[[], Awaitable[bytes]]) -> Any:
    """For the lookup/list calls: skip if already cached, otherwise fetch,
    write the raw bytes verbatim, and return the parsed JSON. Exceptions
    propagate -- without a stub list there is nothing to build a detail
    worklist from, so the whole run aborts rather than limping on."""
    existing = _load_existing_json(path)
    if existing is not None:
        return existing
    body = await fetch()
    _write_atomic(path, body)
    return json.loads(body)


def _content_id_of(stub: dict[str, Any]) -> _ContentId:
    """A stub's `external_id`/`ibn` arrive as `null` *or* `""` for the
    absent one (plan §3.1); both normalise to `None` here."""
    external_id = stub.get("external_id") or None
    ibn = stub.get("ibn") or None
    return _ContentId(external_id=external_id, ibn=ibn)


def _unique_content_ids(stub_lists: list[list[dict[str, Any]]]) -> dict[str, _ContentId]:
    """Content id -> `_ContentId`, deduped across every assessment-99 stub
    list (plan §3.1: three content ids are filed twice under 99 -> 3,767
    unique questions from 3,770 stubs). A plain dict keyed by content id
    collapses those duplicates for free."""
    unique: dict[str, _ContentId] = {}
    for stubs in stub_lists:
        for stub in stubs:
            content_id = _content_id_of(stub)
            unique.setdefault(content_id.key, content_id)
    return unique


async def _fetch_one_detail(
    client: CollegeBoardClient,
    run_dir: Path,
    content_id: _ContentId,
    semaphore: asyncio.Semaphore,
    counters: _DetailCounters,
    failures: list[dict[str, str]],
    total: int,
) -> None:
    if content_id.external_id is not None:
        kind = "detail"
        path = run_dir / "detail" / f"{content_id.external_id}.json"
    else:
        assert content_id.ibn is not None
        kind = "disclosed"
        path = run_dir / "disclosed" / f"{content_id.ibn}.json"

    async with semaphore:
        if _load_existing_json(path) is not None:
            counters.skipped += 1
        else:
            try:
                if content_id.external_id is not None:
                    body = await client.fetch_question_detail(content_id.external_id)
                else:
                    body = await client.fetch_disclosed_item(content_id.ibn)  # type: ignore[arg-type]
            except CollegeBoardError as exc:
                counters.failed += 1
                failures.append({"content_id": content_id.key, "kind": kind, "error": str(exc)})
                logger.warning("sat.fetch: %s fetch failed for %s: %s", kind, content_id.key, exc)
            else:
                _write_atomic(path, body)
                counters.fetched += 1

    if counters.done % _PROGRESS_LOG_EVERY == 0 or counters.done == total:
        logger.info(
            "sat.fetch: %d/%d details done (fetched=%d skipped=%d failed=%d)",
            counters.done,
            total,
            counters.fetched,
            counters.skipped,
            counters.failed,
        )


def _domain_list_fetcher(
    client: CollegeBoardClient, assessment: int, test: int, domain: str
) -> Callable[[], Awaitable[bytes]]:
    """Binds `assessment`/`test`/`domain` at call time -- one E1 call, one
    verbatim file, per the module docstring."""

    async def _fetch() -> bytes:
        return await client.fetch_questions(assessment, test, domain)

    return _fetch


def _module_name(test: int) -> str:
    return "reading" if test == 1 else "math"


def _dedupe_stubs(stubs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """De-dupes by `questionId` only, keeping the first occurrence -- two
    stubs can be byte-identical copies of the same `questionId` (this has
    not been observed on real data; measured on the 20260919T182959Z run,
    every `questionId` across every domain file is unique). This must
    **not** dedupe by content id (`external_id`/`ibn`): the measured
    duplication is a single domain file (assessment 99 test 2's `H` and
    `P` files) carrying two different `questionId`s for the same content
    id (three pairs) -- both `questionId`s are real stubs the build step
    needs to write `sat_question_aliases` rows for (plan §3.3, gate G3),
    so content-id dedup here would silently drop one of each pair."""
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for stub in stubs:
        question_id = stub["questionId"]
        if question_id in seen:
            continue
        seen.add(question_id)
        deduped.append(stub)
    return deduped


async def _fetch_merged_list(
    client: CollegeBoardClient, run_dir: Path, assessment: int, test: int
) -> list[dict[str, Any]]:
    """Fetches each of `test`'s four domains verbatim into its own file
    (module docstring), then derives the merged
    `list/asmt<assessment>_test<test>.json` the plan's layout names: fixed
    domain order, de-duplicated only by `questionId` (see `_dedupe_stubs`
    -- every `questionId` naming a distinct content id is kept, even when
    it shares that content id with another `questionId`), every stub
    stamped with `test`/`module` for the
    `domain/sat/normalize.py::_module_from_stub` contract. The merge is
    cheap (no network) and is always recomputed and rewritten, so a rerun
    over an already-fetched run_dir still refreshes the merged file's
    stamps."""
    domain_stub_lists: list[list[dict[str, Any]]] = []
    for domain in _domain_codes(test):
        stubs = await _fetch_and_cache(
            run_dir / "list" / f"asmt{assessment}_test{test}_{domain}.json",
            _domain_list_fetcher(client, assessment, test, domain),
        )
        domain_stub_lists.append(cast(list[dict[str, Any]], stubs))

    module = _module_name(test)
    merged = _dedupe_stubs([stub for stubs in domain_stub_lists for stub in stubs])
    stamped = [{**stub, "test": test, "module": module} for stub in merged]
    _write_atomic(
        run_dir / "list" / f"asmt{assessment}_test{test}.json",
        json.dumps(stamped).encode(),
    )
    return stamped


async def _fetch_lists(client: CollegeBoardClient, run_dir: Path) -> list[list[dict[str, Any]]]:
    """E4 then E1 in plan order (module docstring); returns only the
    assessment-99 stub lists (E1's 100/102 calls are fetched and cached but
    their bodies are otherwise unused here -- they exist purely to
    re-assert the superset claim, checked separately by `audit`)."""
    await _fetch_and_cache(run_dir / "lookup.json", client.fetch_lookup)

    primary_stub_lists: list[list[dict[str, Any]]] = []
    for assessment, test in _PRIMARY_LIST_CALLS:
        stubs = await _fetch_merged_list(client, run_dir, assessment, test)
        primary_stub_lists.append(stubs)

    for assessment, test in _SUPERSET_CHECK_LIST_CALLS:
        await _fetch_merged_list(client, run_dir, assessment, test)

    return primary_stub_lists


async def _fetch_all_details(
    client: CollegeBoardClient, run_dir: Path, content_ids: dict[str, _ContentId]
) -> tuple[_DetailCounters, list[dict[str, str]]]:
    counters = _DetailCounters()
    failures: list[dict[str, str]] = []
    semaphore = asyncio.Semaphore(_DETAIL_CONCURRENCY)
    total = len(content_ids)
    await asyncio.gather(
        *(
            _fetch_one_detail(client, run_dir, content_id, semaphore, counters, failures, total)
            for content_id in content_ids.values()
        )
    )
    return counters, failures


def _write_robots_outcomes(run_dir: Path, client: CollegeBoardClient) -> None:
    body = json.dumps(
        [outcome.model_dump() for outcome in client.robots_outcomes], indent=2
    ).encode()
    _write_atomic(run_dir / "robots.json", body)


def _write_summary(run_dir: Path, summary: FetchSummary) -> None:
    _write_atomic(run_dir / "run.json", json.dumps(summary.run_json(), indent=2).encode())
    failures_path = run_dir / "failures.json"
    if summary.failures:
        _write_atomic(failures_path, json.dumps(summary.failures, indent=2).encode())
    elif failures_path.exists():
        # A prior failed run's failures.json must not linger and be
        # mistaken for this run's result once every failure is resolved.
        failures_path.unlink()


async def run_fetch(settings: Settings, run_dir: Path) -> FetchSummary:
    started_at = datetime.now(UTC).isoformat()
    run_dir.mkdir(parents=True, exist_ok=True)

    config = CollegeBoardConfig(
        rps=settings.sat_fetch_requests_per_second,
        user_agent=settings.sat_fetch_user_agent,
    )
    async with build_client(config) as http_client:
        client = CollegeBoardClient(config, http_client)

        primary_stub_lists = await _fetch_lists(client, run_dir)
        unique_content_ids = _unique_content_ids(primary_stub_lists)
        counters, failures = await _fetch_all_details(client, run_dir, unique_content_ids)
        _write_robots_outcomes(run_dir, client)

    summary = FetchSummary(
        started_at=started_at,
        finished_at=datetime.now(UTC).isoformat(),
        stub_count=sum(len(stubs) for stubs in primary_stub_lists),
        unique_content_ids=len(unique_content_ids),
        details_fetched=counters.fetched,
        details_skipped=counters.skipped,
        details_failed=counters.failed,
        failures=failures,
    )
    _write_summary(run_dir, summary)
    return summary
