"""Live, contract-derived evaluation runner for the db-rewire agent surface."""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import re
import statistics
import time
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Literal, cast
from urllib.parse import urlparse
from uuid import UUID, uuid4

import structlog
import yaml
from pydantic import BaseModel

from app.deps import Runtime, build_runtime
from app.model_selection import counselor_model_selection
from app.run_turn import run_turn
from app.sessions import create_session
from app.workspace.changes import WorkspaceEventBus
from app.workspace.models import DocumentCreate, MemoryCreate
from app.workspace.service_documents import create_document
from app.workspace.service_memory import create_memories
from config.logging import setup_logging
from config.settings import ReasoningEffort, get_settings
from domain.events import Event
from domain.response_mode import ResponseMode
from domain.specs import SourceConfig

logger = structlog.get_logger(__name__)
EVALS_DIR = Path(__file__).parent
QUESTIONS_PATH = EVALS_DIR / "questions.yaml"
JUDGE_PROMPT_PATH = EVALS_DIR / "judge.md"
#: The eval judge is a measurement instrument, not a product role: it reasons
#: at one fixed effort so every candidate run is scored by the same judge.
EVAL_JUDGE_REASONING_EFFORT: ReasoningEffort = "high"
QUESTION_TIMEOUT_S = 600
QUESTION_TYPES = (
    "routing",
    "coverage_honesty",
    "edition_caveat",
    "composition",
    "denominator_honesty",
    "honesty",
    "clarify_judgment",
    "narration_quality",
    "response_mode_behavior",
    "workspace_task",
)
#: Every tool name §5.6 of the design doc cut or replaced by this rewire — a
#: hit here on any eval turn is a code bug (a stale tool binding), never a
#: prompt-tuning issue.
OLD_DB_TOOLS = frozenset(
    {
        "find_schools",
        "find_fields",
        "get_values",
        "get_dossier",
        "compare_schools",
        "national_benchmark",
        "search_metrics",
        "get_metrics",
        "get_data_coverage",
        "get_programs",
        "get_diversity",
        "get_data_calendar",
    }
)


class CriterionVerdict(BaseModel):
    criterion: str
    verdict: Literal["yes", "no"]
    evidence: str


class JudgeOutput(BaseModel):
    verdicts: list[CriterionVerdict]


def build_judge_agent(settings: Any) -> Any:
    from pydantic_ai import Agent

    from app.llm import build_model

    model = build_model(
        settings, settings.model_cheap, reasoning_effort=EVAL_JUDGE_REASONING_EFFORT
    )
    return Agent(model, instructions=JUDGE_PROMPT_PATH.read_text(), output_type=JudgeOutput)


@dataclass(frozen=True)
class EvalSchool:
    unitid: int
    name: str


@dataclass(frozen=True)
class EvalContext:
    sections: tuple[str, ...]
    covered: int
    total: int
    stale_partial: EvalSchool
    profile_only: EvalSchool
    common_a: EvalSchool
    common_b: EvalSchool
    comparison_peer: EvalSchool
    common_metric_ref: str
    stat_metric_refs: tuple[str, ...]
    aid_metric_ref: str
    selectivity_applicants_ref: str
    selectivity_admitted_ref: str
    need_blind_ref: str | None = None
    # Whether the two v3 cases that need a live state the current DB does
    # not produce (school-data-v3 Phase 3: no
    # `not_found` page status and no facts old enough to trip
    # `facts_stale_days` exist live) can actually be exercised right now —
    # checked live at context-build time so the harness degrades to an
    # honest skip instead of silently passing a case it never ran.
    not_published_available: bool = False
    stale_facts_available: bool = False

    def substitutions(self) -> dict[str, str]:
        return {
            "covered": str(self.covered),
            "total": str(self.total),
            "stale_partial": self.stale_partial.name,
            "profile_only": self.profile_only.name,
            "common_a": self.common_a.name,
            "common_b": self.common_b.name,
            "comparison_peer": self.comparison_peer.name,
            "common_metric_ref": self.common_metric_ref,
            "stat_metric_refs": ", ".join(self.stat_metric_refs),
            "aid_metric_ref": self.aid_metric_ref,
            "selectivity_applicants_ref": self.selectivity_applicants_ref,
            "selectivity_admitted_ref": self.selectivity_admitted_ref,
            "need_blind_ref": self.need_blind_ref
            or "not defined as a fact key in the current catalog",
        }


def _school(catalog: Any, unitid: int) -> EvalSchool:
    """One live fixture school, named off the atomic ``Catalog`` snapshot."""
    record = catalog.snapshot.schools.get(unitid)
    if record is None:
        raise RuntimeError(f"eval fixture unitid {unitid} is not in the live school catalog")
    return EvalSchool(unitid=unitid, name=record.basics.name)


def _top_fact_key(fact_keys: Mapping[str, Any], prefix: str) -> str:
    """The declared, live-covered fact key under ``prefix`` with the widest
    coverage — picked from ``Catalog.snapshot.fact_keys`` (already the
    ``fact_coverage`` view, `explore.*` and zero-coverage rows excluded), so
    a fixture never names a key that has since lost every reporting school."""
    candidates = [(key, row) for key, row in fact_keys.items() if key.startswith(prefix)]
    if not candidates:
        raise RuntimeError(f"no live fact_coverage rows under {prefix!r} to build a fixture from")
    return max(candidates, key=lambda item: item[1].schools_with_value)[0]


# school-data-v3 Phase 3 -- every fixture below is picked live off
# `Catalog.snapshot`/`cds_library` state rather than pinned to today's
# specific unitids, so the harness stays correct as the crawl grows.
_STALE_PARTIAL_SQL = """SELECT school_id FROM cds_library.school_data_status s
 WHERE has_collegedata AND EXISTS (
   SELECT 1 FROM jsonb_each_text(s.tabs) t(tab, status) WHERE t.status <> 'ok'
 ) ORDER BY school_id LIMIT 1"""
_PROFILE_ONLY_SQL = """SELECT school_id FROM cds_library.school_data_status
 WHERE NOT has_collegedata ORDER BY school_id LIMIT 1"""
_COMMON_SCHOOLS_SQL = """SELECT school_id FROM cds_library.current_school_facts
 WHERE fact_key = $1 ORDER BY school_id LIMIT 3"""
_SCHOOL_FACT_KEYS_SQL = """SELECT fact_key FROM cds_library.current_school_facts
 WHERE school_id = $1 AND fact_key = ANY($2::text[]) ORDER BY fact_key"""
# Live gates for the two v3 cases that cannot be grounded in today's data
# (see the `EvalContext` field comment above).
_NOT_PUBLISHED_LIVE_SQL = """SELECT count(*) FROM cds_library.school_data_status s,
 jsonb_each_text(s.tabs) t(tab, status) WHERE t.status = 'not_found'"""
_STALE_FACTS_LIVE_SQL = """SELECT count(*) FROM cds_library.school_data_status
 WHERE facts_updated_at < now() - make_interval(days => $1)"""


async def build_eval_context(runtime: Runtime) -> EvalContext:
    """Build the eval fixture set from the live facts store (school-data-v3
    Phase 3): fixture schools and fact keys are picked live off
    ``Catalog.snapshot``/``cds_library`` rather than hardcoded, so the
    harness keeps working as the crawl grows or its coverage shifts.
    """
    catalog = runtime.deps.catalog
    settings = runtime.deps.settings or get_settings()
    snapshot = catalog.snapshot
    fact_keys = snapshot.fact_keys
    common_metric_ref = _top_fact_key(fact_keys, "admissions.")
    aid_metric_ref = _top_fact_key(fact_keys, "aid.")
    selectivity_applicants_ref = "admissions.applicants_total"
    selectivity_admitted_ref = "admissions.admitted_total"
    for ref in (selectivity_applicants_ref, selectivity_admitted_ref):
        if ref not in fact_keys:
            raise RuntimeError(f"eval fixture fact key {ref!r} has no live coverage")

    async with catalog.pool.acquire() as conn:
        partial_row = await conn.fetchrow(_STALE_PARTIAL_SQL)
        profile_only_row = await conn.fetchrow(_PROFILE_ONLY_SQL)
        common_rows = await conn.fetch(_COMMON_SCHOOLS_SQL, common_metric_ref)
        not_published_count = await conn.fetchval(_NOT_PUBLISHED_LIVE_SQL)
        stale_count = await conn.fetchval(_STALE_FACTS_LIVE_SQL, settings.facts_stale_days)
    if partial_row is None or profile_only_row is None or len(common_rows) < 3:
        raise RuntimeError("live DB does not have enough fixture schools for the eval harness")

    common_a, common_b, comparison_peer = (
        _school(catalog, row["school_id"]) for row in common_rows[:3]
    )
    admissions_keys = sorted(key for key in fact_keys if key.startswith("admissions."))
    async with catalog.pool.acquire() as conn:
        stat_rows = await conn.fetch(_SCHOOL_FACT_KEYS_SQL, common_a.unitid, admissions_keys)
    stat_metric_refs = tuple(str(row["fact_key"]) for row in stat_rows[:4])
    if len(stat_metric_refs) < 4:
        raise RuntimeError(f"{common_a.name} does not report 4 admissions facts for a stat block")

    return EvalContext(
        sections=tuple(sorted(snapshot.sections)),
        covered=snapshot.schools_with_facts,
        total=len(snapshot.schools),
        stale_partial=_school(catalog, partial_row["school_id"]),
        profile_only=_school(catalog, profile_only_row["school_id"]),
        common_a=common_a,
        common_b=common_b,
        comparison_peer=comparison_peer,
        common_metric_ref=common_metric_ref,
        stat_metric_refs=stat_metric_refs,
        aid_metric_ref=aid_metric_ref,
        selectivity_applicants_ref=selectivity_applicants_ref,
        selectivity_admitted_ref=selectivity_admitted_ref,
        need_blind_ref=None,
        not_published_available=bool(not_published_count),
        stale_facts_available=bool(stale_count),
    )


@dataclass
class TurnCapture:
    events: list[Event]
    prose: str
    tool_calls: list[dict[str, Any]]
    tool_returns: list[dict[str, Any]]
    sources: list[dict[str, Any]]
    vizzes: list[dict[str, Any]]
    clarifies: list[dict[str, Any]]
    done_status: str | None
    errored: bool
    errors: list[dict[str, Any]]
    usage: dict[str, Any] | None


def _parts(messages: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    return [
        part
        for message in messages
        for part in (message.get("parts") or [])
        if part.get("part_kind") == kind
    ]


def _call_args(raw: Any) -> dict[str, Any]:
    """A serialized tool call's args as a dict: OpenAI-compatible providers
    store them as JSON text, others as an object."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return {}
    return raw if isinstance(raw, dict) else {}


def capture_turn(events: list[Event], messages: list[dict[str, Any]]) -> TurnCapture:
    calls = [
        {"tool_name": p.get("tool_name"), "args": _call_args(p.get("args"))}
        for p in _parts(messages, "tool-call")
    ]
    returns = [
        {"tool_name": p.get("tool_name"), "content": p.get("content")}
        for p in _parts(messages, "tool-return")
    ]
    sources = [e for e in events if e.type == "sources"]
    done = [e for e in events if e.type == "done"]
    usage = [e for e in events if e.type == "usage"]
    return TurnCapture(
        events,
        "".join(e.data["text"] for e in events if e.type == "delta"),
        calls,
        returns,
        list(sources[-1].data["sources"]) if sources else [],
        [e.data for e in events if e.type == "viz"],
        [e.data for e in events if e.type == "clarify"],
        str(done[-1].data["status"]) if done else None,
        any(e.type == "error" for e in events),
        [dict(e.data) for e in events if e.type == "error"],
        dict(usage[-1].data) if usage else None,
    )


def _check(passed: bool, detail: str) -> dict[str, Any]:
    return {"passed": passed, "detail": detail}


def _calls(capture: TurnCapture, name: str) -> list[dict[str, Any]]:
    return [c for c in capture.tool_calls if c["tool_name"] == name]


def _return_payloads(capture: TurnCapture, name: str) -> list[dict[str, Any]]:
    return [
        r["content"]
        for r in capture.tool_returns
        if r["tool_name"] == name and isinstance(r["content"], dict)
    ]


def _paired_results(
    capture: TurnCapture, name: str
) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    """Pair same-name calls/returns in their provider-preserved order."""
    calls = iter(_calls(capture, name))
    paired: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for result in capture.tool_returns:
        if result["tool_name"] != name:
            continue
        call = next(calls, None)
        if call is None:
            break
        payload = result.get("content")
        if isinstance(payload, dict):
            paired.append((call, payload))
    return paired


def _payload_succeeded(payload: Mapping[str, Any]) -> bool:
    return (
        payload.get("status") not in {"tool_error", "error"}
        and not payload.get("error")
        and payload.get("ok", True) is not False
    )


def _result_handle(payload: Mapping[str, Any]) -> str | None:
    direct = payload.get("result_handle")
    if isinstance(direct, str):
        return direct
    agent = payload.get("result_for_agent")
    handle = agent.get("handle") if isinstance(agent, dict) else None
    return handle if isinstance(handle, str) else None


def _read_results(capture: TurnCapture) -> dict[str, dict[str, Any]]:
    reads: dict[str, dict[str, Any]] = {}
    for call, payload in _paired_results(capture, "read_tool_result"):
        handle = call["args"].get("handle")
        if isinstance(handle, str) and _payload_succeeded(payload):
            reads[handle] = payload
    return reads


def _successful_tool_results(
    capture: TurnCapture, name: str
) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    """Return successful direct payloads or successfully read overflow payloads."""
    reads = _read_results(capture)
    successful: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for call, payload in _paired_results(capture, name):
        if not _payload_succeeded(payload):
            continue
        handle = _result_handle(payload)
        if handle is not None:
            expanded = reads.get(handle)
            if expanded is not None:
                successful.append((call, expanded))
            continue
        if payload.get("status") != "overflow":
            successful.append((call, payload))
    return successful


def _caveat_kinds(capture: TurnCapture) -> set[str]:
    found: set[str] = set()
    for result in capture.tool_returns:
        text = json.dumps(result["content"], default=str)
        found.update(re.findall(r'"kind"\s*:\s*"([a-z0-9_]+)"', text))
    return found


def _markers(text: str) -> list[str]:
    return re.findall(r"\[[1-9]\d*\]", text)


def _normalized_period(value: str) -> str:
    return re.sub(r"[–—/]", "-", value).replace(" ", "")


def _query_database_citation_guard(capture: TurnCapture) -> tuple[bool, str]:
    """v3-denominator-cross-school (plan §6a): ``query_database`` mints no
    citation (``app/tool_middleware.py``'s ``_DB_CITATION_MINTERS`` omits it
    on purpose — a cross-school result has no single school to attach a
    ``db`` citation to). So a value the model only ever saw through
    ``query_database`` must never surface as a cited claim in the final
    prose unless a later successful ``get_facts`` call actually re-fetched
    it through the typed, cited path. Passes when either no citation marker
    is present at all (the model declined to state an unverified value) or
    a successful ``get_facts`` call happened after the last successful
    ``query_database`` call; fails when a marker is present with no such
    re-fetch."""
    queries = _successful_tool_results(capture, "query_database")
    if not queries:
        return True, "no successful query_database call to guard against"
    successful_query_calls = {id(call) for call, _payload in queries}
    query_index = max(
        index
        for index, call in enumerate(capture.tool_calls)
        if id(call) in successful_query_calls
    )
    successful_get_facts_calls = {
        id(call) for call, _payload in _successful_tool_results(capture, "get_facts")
    }
    refetched = any(
        index > query_index and id(call) in successful_get_facts_calls
        for index, call in enumerate(capture.tool_calls)
    )
    if refetched:
        return True, "a successful get_facts call followed query_database"
    markers = _markers(capture.prose)
    return (
        not markers,
        f"markers={markers}; no successful get_facts re-fetch followed query_database",
    )


def _denominator_pair_from_payload(payload: Mapping[str, Any]) -> tuple[int, int] | None:
    columns = [str(column).casefold() for column in payload.get("columns") or []]
    covered_column = next((column for column in columns if column == "covered"), None) or next(
        (column for column in columns if "covered" in column), None
    )
    total_column = next((column for column in columns if column == "total"), None) or next(
        (
            column
            for column in columns
            if "total" in column
            and any(hint in column for hint in ("school", "profile", "denominator"))
        ),
        None,
    )
    if covered_column is None:
        covered_column = next(
            (
                column
                for column in columns
                if "total" not in column
                and (column.endswith("count") or any(
                    hint in column for hint in ("eligible", "qualifying")
                ))
            ),
            None,
        )
    presence_column = (
        "metric_ref_present" if "metric_ref_present" in columns else None
    )
    for row in payload.get("rows") or []:
        if not isinstance(row, list | tuple) or len(row) != len(columns):
            continue
        try:
            if total_column is None:
                continue
            total = int(row[columns.index(total_column)])
            if covered_column is not None:
                return int(row[columns.index(covered_column)]), total
            if presence_column is not None and row[columns.index(presence_column)] is False:
                return 0, total
        except (TypeError, ValueError):
            continue
    return None


def _viz_markers(capture: TurnCapture) -> list[str]:
    return [
        str(cell["marker"])
        for viz in capture.vizzes
        for row in viz.get("rows", [])
        for cell in row.get("cells", [])
        if re.fullmatch(r"\[[1-9]\d*\]", str(cell.get("marker") or ""))
    ]


def _safe_event_summary(capture: TurnCapture) -> str:
    lines = [f"done={capture.done_status}; errored={capture.errored}"]
    returns = {
        name: list(payloads)
        for name in {r["tool_name"] for r in capture.tool_returns}
        if (payloads := _return_payloads(capture, name))
    }
    for index, call in enumerate(capture.tool_calls, 1):
        name, args = str(call["tool_name"]), _call_args(call["args"])
        safe_keys = ("query", "unitid", "school", "groups", "domain_id")
        safe_args = {k: args[k] for k in safe_keys if k in args}
        payload = (returns.get(name) or [{}]).pop(0)
        status = payload.get("status") or payload.get("error")
        if not status:
            status = "ok" if payload.get("ok", True) else "error"
        detail = payload.get("root_cause") if status == "tool_error" else None
        suffix = f" detail={detail}" if isinstance(detail, str) else ""
        lines.append(f"tool {index}: {name} args={safe_args} status={status}{suffix}")
    lines.append(f"caveat kinds: {sorted(_caveat_kinds(capture))}")
    lines.append(f"answer markers: {len(_markers(capture.prose))}")
    for viz in capture.vizzes:
        columns = [{k: c.get(k) for k in ("unitid", "name")} for c in viz.get("columns", [])]
        cells = [
            {
                "available": c.get("available"),
                "source": (c.get("citation") or {}).get("source"),
                "tier": (c.get("citation") or {}).get("tier"),
            }
            for row in viz.get("rows", [])
            for c in row.get("cells", [])
        ]
        lines.append(
            f"viz: type={viz.get('type')} columns={columns} cells={cells} ack={viz.get('ack')}"
        )
    for source in capture.sources:
        citation = source.get("citation") or {}
        lines.append(
            f"source [{source.get('index')}]: "
            f"source={citation.get('source')} tier={citation.get('tier')}"
        )
    denominator = re.findall(r"\b\d[\d,]*\s+(?:of|out of)\s+\d[\d,]*\b", capture.prose, re.I)
    as_of = re.findall(r"\bas of\b[^.;\n]*", capture.prose, re.I)
    lines.append(f"aggregate statements: denominator={denominator}; as_of={as_of}")
    return "\n".join(lines)


def _safe_tool_outcomes(capture: TurnCapture) -> list[dict[str, Any]]:
    """Keep status and sanitized failure guidance without logging result values."""
    outcomes: list[dict[str, Any]] = []
    for item in capture.tool_returns:
        payload = item.get("content")
        if not isinstance(payload, dict):
            continue
        status = payload.get("status") or payload.get("error")
        if not status:
            status = "ok" if payload.get("ok", True) else "error"
        outcome = {"tool_name": item.get("tool_name"), "status": status}
        if status == "tool_error":
            for key in ("root_cause", "safe_retry", "stop_condition"):
                if isinstance(payload.get(key), str):
                    outcome[key] = payload[key]
        outcomes.append(outcome)
    return outcomes


def _routing_calls(capture: TurnCapture) -> list[str]:
    """The tool sequence as routing sees it. `get_facts` called with a school
    name resolves that school itself, exactly as `resolve_school` would, so it
    counts as a resolve followed by the read."""
    called: list[str] = []
    for call in capture.tool_calls:
        name = str(call["tool_name"])
        if name == "get_facts" and _call_args(call.get("args")).get("school"):
            called.append("resolve_school")
        called.append(name)
    return called


def score_routing(expects: dict[str, Any], capture: TurnCapture) -> dict[str, dict[str, Any]]:
    called = _routing_calls(capture)
    expected = list(expects.get("tools") or [])
    checks = {
        "tools_called": _check(
            all(t in called for t in expected), f"expected {expected}; called {called}"
        )
    }
    if expects.get("order"):
        positions = [called.index(t) for t in expects["order"] if t in called]
        checks["tool_order"] = _check(
            len(positions) == len(expects["order"]) and positions == sorted(positions),
            f"order={called}",
        )
    return checks


def score_composition(expects: dict[str, Any], capture: TurnCapture) -> dict[str, dict[str, Any]]:
    checks: dict[str, dict[str, Any]] = {}
    if expects.get("viz_type"):
        matching = [v for v in capture.vizzes if v.get("type") == expects["viz_type"]]
        checks["viz_rendered"] = _check(
            bool(matching), f"viz types={[v.get('type') for v in capture.vizzes]}"
        )
    if expects.get("require_null_unitid"):
        columns = [c for v in capture.vizzes for c in v.get("columns", [])]
        checks["null_unitid_web_column"] = _check(
            any(c.get("unitid") is None for c in columns), f"columns={columns}"
        )
    if expects.get("require_unavailable"):
        cells = [
            c for v in capture.vizzes for row in v.get("rows", []) for c in row.get("cells", [])
        ]
        checks["unavailable_hole"] = _check(
            any(c.get("available") is False and c.get("citation") is None for c in cells),
            "unavailable cell must be inert",
        )
    if capture.vizzes:
        # A `db` citation carries no tier by design (D3: Counselle's own data
        # is never source-attributed, `domain/envelope.py`'s `Citation`
        # validator enforces `tier is None` for `source="db"`) — only a
        # non-`db` cell (web/edu/reddit, which the `Citation` model requires
        # a tier for) is a real provenance gap when its tier is missing.
        available_cells = [
            c
            for v in capture.vizzes
            for row in v.get("rows", [])
            for c in row.get("cells", [])
            if c.get("available")
        ]
        missing_tier = [
            c
            for c in available_cells
            if (c.get("citation") or {}).get("source") != "db"
            and not (c.get("citation") or {}).get("tier")
        ]
        checks["cell_provenance_tier"] = _check(
            not missing_tier,
            f"available non-db cells missing a visible tier: {missing_tier}",
        )
    checks["source_presence"] = _check(
        bool(capture.sources) or bool(expects.get("allow_no_sources")),
        f"sources={len(capture.sources)}",
    )
    return checks


def score_deterministic(expects: dict[str, Any], capture: TurnCapture) -> dict[str, dict[str, Any]]:
    checks: dict[str, dict[str, Any]] = {}
    if current_web := expects.get("current_web_claim"):
        wanted_value = str(current_web["value"])
        wanted_periods = {
            _normalized_period(str(period)) for period in current_web.get("periods") or []
        }
        wanted_domain = str(current_web.get("domain") or "").casefold()
        qualifying: list[Mapping[str, Any]] = []
        for _call, payload in _successful_tool_results(capture, "search_school_site"):
            for result in payload.get("results") or []:
                if not isinstance(result, Mapping):
                    continue
                citation = result.get("citation")
                if not isinstance(citation, Mapping):
                    continue
                period = str(citation.get("source_period") or "")
                evidence = str(citation.get("source_period_evidence") or "")
                host = (urlparse(str(citation.get("url") or "")).hostname or "").casefold()
                if (
                    citation.get("tier") == "official"
                    and citation.get("source") in {"edu", "web"}
                    and citation.get("source_currentness") == "current"
                    and citation.get("source_period_basis") in {"page_content", "metadata"}
                    and wanted_value in evidence
                    and (not wanted_periods or _normalized_period(period) in wanted_periods)
                    and (
                        not wanted_domain
                        or host == wanted_domain
                        or host.endswith(f".{wanted_domain}")
                    )
                ):
                    qualifying.append(citation)
        prose_period = any(
            _normalized_period(str(period)) in _normalized_period(capture.prose)
            for period in current_web.get("periods") or []
        )
        forbidden = [
            str(value)
            for value in current_web.get("forbidden_values") or []
            if str(value) in capture.prose
        ]
        checks["current_web_source_period"] = _check(
            bool(qualifying) and wanted_value in capture.prose and prose_period and not forbidden,
            (
                f"qualifying={len(qualifying)}; value_in_prose={wanted_value in capture.prose}; "
                f"period_in_prose={prose_period}; forbidden={forbidden}"
            ),
        )
    if forbidden_phrases := expects.get("forbidden_prose"):
        hits = [
            str(phrase)
            for phrase in forbidden_phrases
            if str(phrase).casefold() in capture.prose.casefold()
        ]
        checks["forbidden_prose"] = _check(not hits, f"hits={hits}")
    if expects.get("load_skill_before_sql"):
        called = [str(call["tool_name"]) for call in capture.tool_calls]
        load_index = called.index("load_skill") if "load_skill" in called else None
        sql_index = called.index("query_database") if "query_database" in called else None
        checks["load_skill_before_sql"] = _check(
            load_index is not None and sql_index is not None and load_index < sql_index,
            f"order={called}",
        )
    if expects.get("query_database_citation_guard"):
        guarded, detail = _query_database_citation_guard(capture)
        checks["query_database_citation_guard"] = _check(guarded, detail)
    if expects.get("caveat_kinds"):
        kinds = _caveat_kinds(capture)
        wanted = set(expects["caveat_kinds"])
        checks["caveat_kinds"] = _check(
            wanted <= kinds, f"wanted={sorted(wanted)} got={sorted(kinds)}"
        )
    if expects.get("denominator"):
        expected_pair: tuple[int, int] | None = None
        required_pair = (
            (int(expects["denominator_covered"]), int(expects["denominator_total"]))
            if expects.get("denominator_covered") is not None
            else None
        )
        # Models may correct an earlier broad/invalid denominator with a later
        # focused query. Score only the latest successful result evidence.
        query_payloads = [
            payload
            for _call, payload in _successful_tool_results(capture, "query_database")
        ]
        for payload in reversed(query_payloads):
            pair = _denominator_pair_from_payload(payload)
            expected_total = int(expects["denominator_total"])
            if (
                pair is not None
                and pair[1] == expected_total
                and (required_pair is None or pair == required_pair)
            ):
                expected_pair = pair
                break
        if (
            expected_pair is None
            and query_payloads
            and required_pair is not None
            and required_pair[0] == 0
            and not any(_denominator_pair_from_payload(payload) for payload in query_payloads)
        ):
            # A fact key no school reports has no `fact_coverage` row, so the
            # query that checked it returns none to carry the pair; the declared
            # 0-covered pair is the honest statement the prose must still make.
            expected_pair = required_pair
        normalized_prose = re.sub(r"[*_`~]+", "", capture.prose).replace(",", "")
        number_words = {
            "zero": "0",
            "one": "1",
            "two": "2",
            "three": "3",
            "four": "4",
            "five": "5",
            "six": "6",
            "seven": "7",
            "eight": "8",
            "nine": "9",
            "ten": "10",
        }
        for word, digit in number_words.items():
            normalized_prose = re.sub(rf"\b{word}\b", digit, normalized_prose, flags=re.I)
        # A natural qualifier phrase can sit between "of"/"out of" and the
        # total (e.g. "out of a total of 2,746", "out of all 2,746").
        # Tolerate a small, named set of such phrases, capped at one
        # occurrence, so the gap stays a few words wide rather than an
        # unbounded `.*` that could fuzzy-match a different number anywhere
        # later in the answer.
        denominator_qualifier = (
            r"(?:the|a\s+total\s+of|approximately|roughly|about|around|all)"
        )
        # The direct-order filler list is a named, bounded set of words a
        # real answer uses between the numerator and "of"/"out of" — not an
        # open wildcard, so it can't skip past mismatched numbers. It also
        # tolerates one parenthetical aside (e.g. a backtick-quoted metric
        # id like "(financial_aid.h2_i_...)") as a single filler unit, since
        # that's a citation, not prose that should gate the match. The count
        # is raised from 24 to 40 to cover verbose real phrasing (e.g. a
        # metric description plus its qualifiers) while staying an explicit,
        # named bound rather than unlimited.
        direct = (
            rf"\b{expected_pair[0]}\b"
            rf"(?:\s+(?:covered|verified|reported|eligible|profiled|schools?|institutions?"
            rf"|candidates?|values?|with|usable|exact|metric|data|that|can|be|evaluated"
            rf"|have|has|are|numeric|a|an|the|for|this|ranking|only|count|of|total|database"
            rf"|contains|reflects|our|current|reported|all|average|percentage|financial"
            rf"|need|met|undergraduates|full-time|\([^()]*\))){{0,40}}\s+"
            rf"(?:of|out of)\s+"
            rf"(?:{denominator_qualifier}\s+){{0,1}}{expected_pair[1]}\b"
            if expected_pair
            else r"(?!)"
        )
        reverse = (
            rf"\b(?:of|out of)\s+(?:{denominator_qualifier}\s+){{0,1}}{expected_pair[1]}\b"
            rf"(?:\s+(?:covered|verified|reported|eligible|profiled|schools?|institutions?"
            rf"|candidates?|values?|with|usable|exact|metric|data|that|can|be|evaluated"
            rf"|have|has|are|numeric|a|an|the|for|this|ranking|only|count|of|total|database"
            rf"|contains|reflects|our|current|reported|only|among|there|are|is|,))*"
            rf"\s+{expected_pair[0]}\b"
            rf"(?=(?:\s+(?:covered|verified|reported|eligible|profiled|numeric|usable|exact)){{0,8}}"
            rf"\s+(?:schools?|institutions?|candidates?|values?|have|has|is|are|can)\b)"
            if expected_pair
            else r"(?!)"
        )
        has_denominator = bool(re.search(f"(?:{direct})|(?:{reverse})", normalized_prose, re.I))
        checks["denominator"] = _check(
            has_denominator,
            f"expected covered/total statement; pair={expected_pair}",
        )
    if expects.get("markers"):
        visible_markers = [*_markers(capture.prose), *_viz_markers(capture)]
        checks["marker_presence"] = _check(
            bool(visible_markers), f"markers={visible_markers}"
        )
    return checks


def score_clarify(expects: dict[str, Any], capture: TurnCapture) -> dict[str, dict[str, Any]]:
    must = bool(expects.get("must_clarify"))
    asks_in_prose = bool(
        re.search(
            r"\b(which|do you mean|could you clarify|campus|are you asking|are you thinking|"
            r"another school)\b[^?]*\?",
            capture.prose,
            re.I,
        )
    )
    clarify_versions = [
        event.get("v") for event in capture.clarifies if isinstance(event, dict)
    ]
    has_v2_clarify = any(version == 2 for version in clarify_versions)
    if must:
        passed = has_v2_clarify and capture.done_status == "awaiting_input"
    else:
        passed = not capture.clarifies and not asks_in_prose
    return {
        "clarify_judgment": _check(
            passed,
            "clarify_events="
            f"{len(capture.clarifies)}; clarify_versions={clarify_versions}; "
            f"done={capture.done_status}; prose_clarification={asks_in_prose}",
        )
    }


def score_narration(expects: dict[str, Any], capture: TurnCapture) -> dict[str, dict[str, Any]]:
    beats = [str(e.data.get("text") or "") for e in capture.events if e.type == "narration"]
    visible_work_events = [
        e
        for e in capture.events
        if e.type == "narration" or (e.type == "step" and e.data.get("status") == "start")
    ]
    first_visible = visible_work_events[0].type if visible_work_events else None
    first_step_index = next(
        (
            index
            for index, event in enumerate(visible_work_events)
            if event.type == "step" and event.data.get("status") == "start"
        ),
        None,
    )
    late_narration = any(
        event.type == "narration"
        for event in (
            visible_work_events[first_step_index + 1 :] if first_step_index is not None else []
        )
    )
    write_plan_started = any(
        event.type == "step"
        and event.data.get("status") == "start"
        and event.data.get("kind") == "write_plan"
        for event in visible_work_events
    )
    boilerplate = re.search(
        r"\b("
        r"ready for next instructions|waiting for next user prompt|execution finished|"
        r"finished executing the plan|system bookkeeping|finalizing plan|"
        r"all steps are now completed|end of response|end of turn"
        r")\b",
        capture.prose,
        re.I,
    )
    return {
        "narration_present": _check(bool(beats), f"beats={len(beats)}"),
        "narration_before_work": _check(
            bool(beats) and first_visible == "narration" and not late_narration,
            (
                f"first_visible={first_visible}; "
                f"late_narration={late_narration}"
            ),
        ),
        "no_write_plan_for_narration": _check(
            not write_plan_started,
            f"write_plan_started={write_plan_started}",
        ),
        "concise": _check(
            all(len(re.findall(r"[.!?]+(?:\s|$)", b)) <= 2 for b in beats), f"beats={beats}"
        ),
        "no_markers": _check(not any(_markers(b) for b in beats), "narration must not cite"),
        "no_final_boilerplate": _check(
            boilerplate is None,
            f"matched={boilerplate.group(0) if boilerplate else None}",
        ),
    }


def score_workspace(expects: dict[str, Any], capture: TurnCapture) -> dict[str, dict[str, Any]]:
    tool = str(expects.get("tool", "create_tasks"))
    result_key = {"create_tasks": "created", "remember": "notes"}.get(tool, "created")
    created = [
        row
        for _call, payload in _successful_tool_results(capture, tool)
        for row in (payload.get(result_key) or [])
        if isinstance(row, dict)
    ]
    return {
        "workspace_tool_called": _check(bool(_calls(capture, tool)), f"tool={tool}"),
        "items_created": _check(
            len(created) >= int(expects.get("min_items", 1)),
            f"successful persisted rows={len(created)}",
        ),
    }


def build_judge_case(question: str, criteria: list[str], capture: TurnCapture) -> str:
    return "\n".join(
        [
            "## Student question",
            question,
            "",
            "## Criteria",
            *[f"{i}. {c}" for i, c in enumerate(criteria, 1)],
            "",
            "## Counselor's final prose answer",
            capture.prose or "(no prose)",
            "",
            "## Safe event summary",
            _safe_event_summary(capture),
        ]
    )


async def score_judge(
    question: str, criteria: list[str], capture: TurnCapture, judge: Any
) -> dict[str, dict[str, Any]]:
    if not criteria:
        return {}

    def normalized(value: str) -> str:
        return " ".join(re.findall(r"[a-z0-9]+", value.casefold()))

    def validate(output: list[CriterionVerdict]) -> None:
        if len(output) != len(criteria):
            raise ValueError(f"judge returned {len(output)} verdicts for {len(criteria)} criteria")
        for index, (criterion, verdict) in enumerate(zip(criteria, output, strict=True), 1):
            expected = normalized(criterion)
            returned = normalized(verdict.criterion)
            expected_tokens = set(expected.split())
            returned_tokens = set(returned.split())
            overlap = len(expected_tokens & returned_tokens) / max(len(expected_tokens), 1)
            if SequenceMatcher(None, expected, returned).ratio() < 0.6 and overlap < 0.6:
                raise ValueError(f"judge verdict {index} criterion mismatch")

    case = build_judge_case(question, criteria, capture)
    last_error: ValueError | None = None
    output: list[CriterionVerdict] = []
    for attempt in range(2):
        output = (await judge.run(case)).output.verdicts
        try:
            validate(output)
            break
        except ValueError as exc:
            last_error = exc
            if attempt:
                raise
            case += (
                "\n\n## Correction required\n"
                f"Your previous structured output was invalid: {exc}. Return exactly "
                f"{len(criteria)} verdicts, one for each numbered criterion in the same order. "
                "Copy each criterion verbatim."
            )
    else:  # pragma: no cover - loop always breaks or raises
        assert last_error is not None
        raise last_error
    return {
        f"criterion_{i}": _check(v.verdict == "yes", f"{c} -> {v.evidence}")
        for i, (c, v) in enumerate(zip(criteria, output, strict=True), 1)
    }


async def score_question(
    question: dict[str, Any], capture: TurnCapture, judge: Any
) -> dict[str, dict[str, Any]]:
    expects = question["expects"]
    kind = question["type"]
    if kind == "routing":
        checks = score_routing(expects, capture)
    elif kind == "composition":
        checks = score_composition(expects, capture)
    elif kind == "clarify_judgment":
        checks = score_clarify(expects, capture)
    elif kind == "narration_quality":
        checks = score_narration(expects, capture)
    elif kind == "workspace_task":
        checks = score_workspace(expects, capture)
    elif expects.get("tools"):
        # A non-`routing` case (coverage_honesty/edition_caveat/honesty/
        # denominator_honesty/response_mode_behavior) can still name
        # required tools in `expects["tools"]` -- school-data-v3 Phase 3's
        # new v3 cases do this -- so score it the same way
        # `routing` does rather than letting that list go silently unchecked.
        checks = score_routing(expects, capture)
    else:
        checks = {}
    checks.update(score_deterministic(expects, capture))
    if expects.get("criteria"):
        checks.update(
            await score_judge(
                question["question"], list(expects.get("criteria") or []), capture, judge
            )
        )
    called = {str(c["tool_name"]) for c in capture.tool_calls}
    checks["no_old_tools"] = _check(
        not called & OLD_DB_TOOLS, f"old tools={sorted(called & OLD_DB_TOOLS)}"
    )
    checks["no_error_event"] = _check(not capture.errored, f"errored={capture.errored}")
    return checks


async def _thread_messages(runtime: Runtime, session_id: str) -> list[dict[str, Any]]:
    snapshot = await runtime.graph.aget_state({"configurable": {"thread_id": session_id}})
    return list(snapshot.values.get("messages") or []) if snapshot else []


async def _seed_eval_user(pool: Any, question_id: str) -> UUID:
    user_id = uuid4()
    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO counselle.users
          (id,email,hashed_password,is_active,is_superuser,is_verified)
          VALUES ($1,$2,$3,true,false,false)""",
            user_id,
            f"eval-{question_id}-{user_id}@workspace.test",
            "not-a-real-password-hash",
        )
    return user_id


async def _delete_eval_user(pool: Any, user_id: UUID) -> None:
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM counselle.users WHERE id=$1", user_id)


async def _seed_workspace(runtime: Runtime, user_id: UUID, question: dict[str, Any]) -> None:
    if question.get("seed_memories"):
        await create_memories(
            runtime.app_pool,
            WorkspaceEventBus(),
            user_id=user_id,
            actor="counselle",
            data=[MemoryCreate(content=x) for x in question["seed_memories"]],
        )
    for doc in question.get("seed_documents") or []:
        text = doc.get("extracted_text")
        await create_document(
            runtime.app_pool,
            WorkspaceEventBus(),
            user_id=user_id,
            actor="student",
            data=DocumentCreate(
                title=doc["title"],
                doc_type=doc.get("doc_type", "other"),
                filename=doc.get("filename", doc["title"]),
                mime=doc.get("mime", "text/plain"),
                content=(text or doc["title"]).encode(),
                text_status=doc.get("text_status", "extracted"),
                extracted_text=text,
                summary=doc.get("summary"),
            ),
        )


async def run_question(
    runtime: Runtime,
    judge: Any,
    question: dict[str, Any],
    response_mode: ResponseMode,
) -> dict[str, Any]:
    if question.get("skip_reason"):
        return {
            "id": question["id"],
            "type": question["type"],
            "question": question["question"],
            "comparison": bool(question.get("comparison")),
            "skipped": True,
            "skip_reason": question["skip_reason"],
            "response_mode": response_mode.value,
            "passed": True,
            "checks": {},
            "duration_s": None,
            "usage": None,
            "tool_calls": [],
        }
    web = bool(question.get("web"))
    workspace = bool(question.get("workspace"))
    config = SourceConfig(web=web, reddit=False, edu=web)
    session_id = await create_session(
        runtime.app_pool,
        config.model_dump(mode="json"),
        title=f"eval:{response_mode.value}:{question['id']}",
        response_mode=response_mode,
    )
    user_id = await _seed_eval_user(runtime.app_pool, question["id"]) if workspace else None
    if user_id:
        await _seed_workspace(runtime, user_id, question)
    started = time.monotonic()
    events: list[Event] = []
    try:
        async with asyncio.timeout(QUESTION_TIMEOUT_S):
            async for event in run_turn(
                session_id,
                question["question"],
                config,
                deps=runtime.deps,
                graph=runtime.graph,
                user_id=str(user_id) if user_id else None,
                response_mode=response_mode,
                selected_skills=tuple(question.get("skills") or ()),
            ):
                events.append(event)
        # The student's wait ends with the turn; scoring (an LLM judge call on
        # criteria cases) is not part of it.
        turn_duration_s = round(time.monotonic() - started, 3)
        capture = capture_turn(events, await _thread_messages(runtime, session_id))
        checks = await score_question(question, capture, judge)
        return {
            "id": question["id"],
            "type": question["type"],
            "question": question["question"],
            "comparison": bool(question.get("comparison")),
            "skipped": False,
            "session_id": session_id,
            "response_mode": response_mode.value,
            "passed": all(c["passed"] for c in checks.values()),
            "checks": checks,
            "prose": capture.prose,
            "tool_calls": capture.tool_calls,
            "sources": capture.sources,
            "vizzes": capture.vizzes,
            "usage": capture.usage,
            "done_status": capture.done_status,
            "duration_s": turn_duration_s,
            "event_summary": _safe_event_summary(capture),
            "tool_outcomes": _safe_tool_outcomes(capture),
            "errors": capture.errors,
        }
    finally:
        if user_id:
            await _delete_eval_user(runtime.app_pool, user_id)


async def run_question_safely(
    runtime: Runtime,
    judge: Any,
    question: dict[str, Any],
    response_mode: ResponseMode,
) -> dict[str, Any]:
    try:
        return await run_question(runtime, judge, question, response_mode)
    except Exception as exc:
        logger.exception("eval question crashed", id=question["id"])
        return {
            "id": question["id"],
            "type": question["type"],
            "question": question["question"],
            "comparison": bool(question.get("comparison")),
            "skipped": False,
            "response_mode": response_mode.value,
            "passed": False,
            "checks": {"runner": _check(False, f"{type(exc).__name__}: {exc}")},
            "error": {"type": type(exc).__name__, "message": str(exc)},
            "duration_s": None,
            "usage": None,
            "tool_calls": [],
        }


def load_questions() -> list[dict[str, Any]]:
    questions = yaml.safe_load(QUESTIONS_PATH.read_text())
    if not isinstance(questions, list):
        raise ValueError("questions.yaml must be a list")
    ids: list[str] = []
    for q in questions:
        for key in ("id", "question", "type", "expects"):
            if key not in q:
                raise ValueError(f"question {q.get('id')!r} missing {key}")
        if q["type"] not in QUESTION_TYPES:
            raise ValueError(f"unknown type {q['type']}")
        ids.append(q["id"])
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate question ids")
    return questions


def materialize_questions(
    questions: list[dict[str, Any]], context: EvalContext
) -> list[dict[str, Any]]:
    values = context.substitutions()

    def substitute(value: Any) -> Any:
        if isinstance(value, str):
            return value.format_map(values)
        if isinstance(value, list):
            return [substitute(item) for item in value]
        if isinstance(value, dict):
            return {key: substitute(item) for key, item in value.items()}
        return value

    # A question's `live_gate` names a state the current live DB may not
    # produce (school-data-v3 Phase 3: no
    # `not_found` page and no stale-enough facts exist today) -- gated
    # questions are skipped with an honest reason rather than silently
    # scored against a state that never actually occurred, per
    # `EvalContext.not_published_available`/`.stale_facts_available`.
    live_gates: dict[str, bool] = {
        "not_published": context.not_published_available,
        "stale_facts": context.stale_facts_available,
    }
    rendered = substitute(questions)
    for question in rendered:
        expects = question["expects"]
        if expects.get("denominator"):
            expects["denominator_total"] = context.total
        gate = question.get("live_gate")
        if gate and not live_gates.get(gate, True):
            question["skip_reason"] = (
                f"current live DB contains no exercisable {gate!r} state for this case"
            )
    return cast(list[dict[str, Any]], rendered)


def select_questions(
    questions: list[dict[str, Any]], only: list[str] | None, kind: str | None
) -> list[dict[str, Any]]:
    if only:
        wanted = {x.strip() for item in only for x in item.split(",") if x.strip()}
        missing = wanted - {q["id"] for q in questions}
        if missing:
            raise SystemExit(f"unknown question ids: {sorted(missing)}")
        questions = [q for q in questions if q["id"] in wanted]
    return [q for q in questions if not kind or q["type"] == kind]


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    rank = math.ceil(percentile * len(ordered)) - 1
    return round(ordered[max(rank, 0)], 3)


def _comparison_stats(results: list[dict[str, Any]]) -> dict[str, Any]:
    scoped = [r for r in results if r.get("comparison") and not r.get("skipped")]

    def stats(values: list[float]) -> dict[str, Any]:
        return {
            "median": round(statistics.median(values), 3) if values else None,
            "p95": _percentile(values, 0.95),
            "max": round(max(values), 3) if values else None,
        }

    durations = [float(r["duration_s"]) for r in scoped if r.get("duration_s") is not None]
    inputs = [float((r.get("usage") or {}).get("input_tokens", 0)) for r in scoped]
    outputs = [float((r.get("usage") or {}).get("output_tokens", 0)) for r in scoped]
    calls = [float(len(r.get("tool_calls") or [])) for r in scoped]
    return {
        "count": len(scoped),
        "duration_s": stats(durations),
        "input_tokens": stats(inputs),
        "output_tokens": stats(outputs),
        "tool_calls": stats(calls),
    }


def build_report(
    results: list[dict[str, Any]],
    response_mode: ResponseMode,
    model: str,
    context: EvalContext,
    *,
    reasoning_effort: str,
) -> dict[str, Any]:
    per_category = {}
    for kind in QUESTION_TYPES:
        scoped = [r for r in results if r["type"] == kind]
        if scoped:
            attempted = [r for r in scoped if not r.get("skipped")]
            per_category[kind] = {
                "passed": sum(r["passed"] for r in attempted),
                "total": len(attempted),
                "skipped": len(scoped) - len(attempted),
            }
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "response_mode": response_mode.value,
        "model": model,
        "reasoning_effort": reasoning_effort,
        "eval_context": {
            "sections": list(context.sections),
            "covered": context.covered,
            "total": context.total,
            "roles": {
                k: getattr(context, k).__dict__
                for k in ("stale_partial", "profile_only", "common_a", "common_b")
            },
            "common_metric_ref": context.common_metric_ref,
        },
        "total": len(results),
        "passed": sum(r["passed"] for r in results if not r.get("skipped")),
        "skipped": sum(bool(r.get("skipped")) for r in results),
        "per_category": per_category,
        "comparison_stats": _comparison_stats(results),
        "results": results,
    }


def render_markdown(report: dict[str, Any]) -> str:
    attempted = report["total"] - report["skipped"]
    lines = [
        f"# Eval report — {report['generated_at'][:10]}",
        "",
        f"Mode: `{report['response_mode']}` · Model: `{report['model']}` · "
        f"Reasoning effort: `{report['reasoning_effort']}` · "
        f"attempted: {attempted} · "
        f"passed: {report['passed']} · skipped: {report['skipped']}",
        "",
        "| Category | Passed | Total | Skipped |",
        "|---|---:|---:|---:|",
    ]
    for kind, s in report["per_category"].items():
        lines.append(f"| {kind} | {s['passed']} | {s['total']} | {s['skipped']} |")
    lines += [
        "",
        "## Comparison evidence",
        "",
        f"```json\n{json.dumps(report['comparison_stats'], indent=2)}\n```",
        "",
        "| ID | Category | Result | Failed checks |",
        "|---|---|---|---|",
    ]
    for r in report["results"]:
        failed = [k for k, v in r["checks"].items() if not v["passed"]]
        result = "SKIP" if r.get("skipped") else ("PASS" if r["passed"] else "FAIL")
        lines.append(f"| {r['id']} | {r['type']} | {result} | {', '.join(failed) or '—'} |")
    return "\n".join(lines) + "\n"


def _report_stem(report: dict[str, Any], *, suffix_mode: bool = False) -> str:
    stamp = report["generated_at"][:10]
    mode = str(report.get("response_mode") or "").strip()
    suffix = f"-{mode}" if suffix_mode and mode else ""
    return f"report-{stamp}{suffix}-{report['reasoning_effort']}"


def write_reports(report: dict[str, Any], *, suffix_mode: bool = False) -> None:
    stem = _report_stem(report, suffix_mode=suffix_mode)
    (EVALS_DIR / f"{stem}.json").write_text(json.dumps(report, indent=2, default=str))
    markdown = render_markdown(report)
    (EVALS_DIR / f"{stem}.md").write_text(markdown)
    print(markdown)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="evals.runner")
    parser.add_argument("--only", action="append")
    parser.add_argument("--type", dest="question_type", choices=QUESTION_TYPES)
    parser.add_argument(
        "--response-mode",
        choices=[mode.value for mode in ResponseMode],
        default=ResponseMode.QUICK.value,
        help="Counselor response mode for this eval run (default: quick).",
    )
    parser.add_argument(
        "--compare-response-modes",
        action="store_true",
        help="Run the selected eval set once in Quick and once in Think.",
    )
    return parser.parse_args(argv)


async def amain(args: argparse.Namespace) -> int:
    settings = get_settings()
    setup_logging(settings.log_level)
    runtime = await build_runtime(settings)
    try:
        context = await build_eval_context(runtime)
        questions = materialize_questions(load_questions(), context)
        selected = select_questions(questions, args.only, args.question_type)
        if not selected:
            raise SystemExit("no questions selected")
        judge = (
            build_judge_agent(settings)
            if any(q["expects"].get("criteria") for q in selected)
            else None
        )
        modes = (
            (ResponseMode.QUICK, ResponseMode.THINK)
            if args.compare_response_modes
            else (ResponseMode(args.response_mode),)
        )
        for response_mode in modes:
            selection = counselor_model_selection(response_mode, settings)
            results = [
                await run_question_safely(runtime, judge, q, response_mode)
                for q in selected
            ]
            write_reports(
                build_report(
                    results,
                    response_mode,
                    selection.model_setting,
                    context,
                    reasoning_effort=selection.reasoning_effort,
                ),
                suffix_mode=args.compare_response_modes or response_mode is ResponseMode.THINK,
            )
    finally:
        await runtime.aclose()
    return 0


def main() -> None:
    raise SystemExit(asyncio.run(amain(parse_args())))


if __name__ == "__main__":
    main()
