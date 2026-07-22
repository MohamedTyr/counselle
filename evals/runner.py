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
from sqlglot import exp, parse
from sqlglot.errors import ParseError, TokenError

from app.agent_node import model_name_from_setting
from app.deps import Runtime, build_runtime
from app.model_selection import counselor_model_selection
from app.run_turn import run_turn
from app.sessions import create_session
from app.workspace.changes import WorkspaceEventBus
from app.workspace.models import DocumentCreate, MemoryCreate
from app.workspace.service_documents import create_document
from app.workspace.service_memory import create_memories
from config.logging import setup_logging
from config.settings import get_settings
from counselle_db.service import get_domain
from domain.events import Event
from domain.response_mode import ResponseMode
from domain.specs import SourceConfig

logger = structlog.get_logger(__name__)
EVALS_DIR = Path(__file__).parent
QUESTIONS_PATH = EVALS_DIR / "questions.yaml"
JUDGE_PROMPT_PATH = EVALS_DIR / "judge.md"
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
    from pydantic_ai.models.google import GoogleModel
    from pydantic_ai.providers.google_cloud import GoogleCloudProvider

    if not settings.vertex_api_key:
        raise RuntimeError("COUNSELLE_VERTEX_API_KEY is not set")
    model = GoogleModel(
        model_name_from_setting(settings.model_cheap),
        provider=GoogleCloudProvider(api_key=settings.vertex_api_key),
    )
    return Agent(model, instructions=JUDGE_PROMPT_PATH.read_text(), output_type=JudgeOutput)


@dataclass(frozen=True)
class EvalSchool:
    unitid: int
    name: str
    domains: tuple[str, ...]
    year: int | None
    currentness: str | None
    partials: int


@dataclass(frozen=True)
class EvalContext:
    manifest_version: str
    domains: tuple[str, ...]
    covered: int
    total: int
    stale_partial: EvalSchool
    profile_only: EvalSchool
    common_a: EvalSchool
    common_b: EvalSchool
    comparison_peer: EvalSchool
    common_domain: str
    common_metric_ref: str
    stat_metric_refs: tuple[str, ...]
    aid_metric_ref: str
    selectivity_applicants_ref: str
    selectivity_admitted_ref: str
    need_blind_ref: str | None
    not_in_template_available: bool
    not_in_template_school: str | None = None
    not_in_template_domain: str | None = None
    not_in_template_ref: str | None = None

    def substitutions(self) -> dict[str, str]:
        return {
            "manifest_version": self.manifest_version,
            "covered": str(self.covered),
            "total": str(self.total),
            "stale_partial": self.stale_partial.name,
            "profile_only": self.profile_only.name,
            "common_a": self.common_a.name,
            "common_b": self.common_b.name,
            "comparison_peer": self.comparison_peer.name,
            "common_domain": self.common_domain,
            "common_metric_ref": self.common_metric_ref,
            "stat_metric_refs": ", ".join(self.stat_metric_refs),
            "aid_metric_ref": self.aid_metric_ref,
            "selectivity_applicants_ref": self.selectivity_applicants_ref,
            "selectivity_admitted_ref": self.selectivity_admitted_ref,
            "need_blind_ref": self.need_blind_ref or "not defined in the current manifest",
            "not_in_template_school": self.not_in_template_school or "",
            "not_in_template_domain": self.not_in_template_domain or "",
            "not_in_template_ref": self.not_in_template_ref or "",
        }


def _school(snapshot: Any, unitid: int) -> EvalSchool:
    record = snapshot.schools[unitid]
    coverage = snapshot.coverage.get(unitid, {})
    return EvalSchool(
        unitid,
        record.basics.name,
        tuple(coverage.get("domains", ())),
        coverage.get("academic_year"),
        coverage.get("currentness"),
        int(coverage.get("partials", 0)),
    )


def _require_metric_ref(
    metrics: Mapping[str, Any], domain_id: str, metric_id: str
) -> str:
    """Resolve one semantic eval role without substituting an unrelated metric."""
    ref = f"{domain_id}.{metric_id}"
    if ref not in metrics:
        raise RuntimeError(
            f"live manifest lacks required {domain_id!r} eval metric {metric_id!r}"
        )
    return ref


async def build_eval_context(runtime: Runtime) -> EvalContext:
    """Choose fixture roles from the current immutable catalog snapshot."""
    snapshot = runtime.deps.catalog.snapshot
    covered_ids = [uid for uid, row in snapshot.coverage.items() if row.get("domains")]
    profile_only_ids = [
        uid for uid in snapshot.schools if not snapshot.coverage.get(uid, {}).get("domains")
    ]
    stale_partial_ids = [
        uid
        for uid in covered_ids
        if snapshot.coverage[uid].get("currentness") == "stale"
        and snapshot.coverage[uid].get("partials", 0) > 0
    ]
    if not profile_only_ids or not covered_ids:
        raise RuntimeError("live catalog lacks required covered/profile-only eval roles")
    if not stale_partial_ids:
        raise RuntimeError(
            "live catalog lacks a school whose selected edition is stale and partial"
        )
    stale_id = stale_partial_ids[0]

    # Verify the common metric through the real typed reader, not packet internals.
    common: tuple[int, int, str, str, tuple[str, ...]] | None = None
    by_domain: dict[str, list[int]] = {}
    for uid in covered_ids:
        for domain in snapshot.coverage[uid]["domains"]:
            by_domain.setdefault(domain, []).append(uid)
    for domain in (item.id for item in snapshot.domains):
        candidates = by_domain.get(domain, [])[:12]
        if len(candidates) < 2:
            continue
        verified: dict[str, list[int]] = {}
        numeric_refs: dict[int, list[str]] = {}
        for uid in candidates:
            result = await get_domain(runtime.deps.catalog, uid, domain)
            for value in result.rows:
                if value.available:
                    verified.setdefault(value.ref, []).append(uid)
                    if isinstance(value.value, int | float) and not isinstance(value.value, bool):
                        numeric_refs.setdefault(uid, []).append(value.ref)
        pair = next(((ref, ids) for ref, ids in verified.items() if len(ids) >= 2), None)
        if pair:
            stat_refs = tuple(numeric_refs.get(pair[1][0], ()))[:4]
            if len(stat_refs) < 4:
                continue
            common = (pair[1][0], pair[1][1], domain, pair[0], stat_refs)
            break
    if common is None:
        raise RuntimeError("live catalog has no two schools with a common verified metric")

    aid_metric_ref = _require_metric_ref(
        snapshot.metrics,
        "financial_aid",
        "h2_i_average_percent_need_met_all_full_time",
    )
    applicants_ref = _require_metric_ref(
        snapshot.metrics, "admissions", "applicants_total"
    )
    admitted_ref = _require_metric_ref(
        snapshot.metrics, "admissions", "admitted_total"
    )
    need_blind_ref = next(
        (
            ref
            for ref, metric in snapshot.metrics.items()
            if "need-blind" in f"{ref} {metric.description}".casefold()
            or "need blind" in f"{ref} {metric.description}".casefold()
        ),
        None,
    )

    # The deterministic packet-v8 fixture owns the permanent template-absence gate.
    # A live role exists only when the latest selected document's typed reader
    # exposes the absence; older raw packets can disagree with selected truth.
    async with runtime.ro_pool.acquire() as conn:
        template_candidates = await conn.fetch(
            """WITH selected AS (
                 SELECT DISTINCT ON (school_id) school_id, document_id
                 FROM cds_library.active_cds_documents
                 ORDER BY school_id, academic_year DESC, document_id DESC
               )
               SELECT p.id, p.name, d.domain_id, metric.key AS metric_id
               FROM cds_library.active_cds_domain_packets d
               JOIN selected s ON s.school_id=d.school_id AND s.document_id=d.document_id
               JOIN cds_library.school_profiles p ON p.id = d.school_id
               CROSS JOIN LATERAL jsonb_each(d.packet -> 'metrics') AS metric(key, value)
               WHERE metric.value ->> 'availability_status' = $1
               ORDER BY p.id, d.domain_id, metric.key
               LIMIT 50""",
            "not_in_template_version",
        )
    template_row = None
    for candidate in template_candidates:
        typed = await get_domain(
            runtime.deps.catalog, int(candidate["id"]), str(candidate["domain_id"])
        )
        candidate_ref = str(candidate["metric_id"])
        if any(
            row.ref == candidate_ref
            and row.availability_status == "not_in_template_version"
            for row in typed.rows
        ):
            template_row = candidate
            break
    return EvalContext(
        snapshot.current_version,
        tuple(d.id for d in snapshot.domains),
        len(covered_ids),
        len(snapshot.schools),
        _school(snapshot, stale_id),
        _school(snapshot, profile_only_ids[0]),
        _school(snapshot, common[0]),
        _school(snapshot, common[1]),
        _school(snapshot, common[1] if common[0] == stale_id else common[0]),
        common[2],
        common[3],
        common[4],
        aid_metric_ref,
        applicants_ref,
        admitted_ref,
        need_blind_ref,
        template_row is not None,
        str(template_row["name"]) if template_row else None,
        str(template_row["domain_id"]) if template_row else None,
        str(template_row["metric_id"]) if template_row else None,
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


def capture_turn(events: list[Event], messages: list[dict[str, Any]]) -> TurnCapture:
    calls = [
        {"tool_name": p.get("tool_name"), "args": p.get("args") or {}}
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


def _successful_calls(capture: TurnCapture, name: str) -> list[dict[str, Any]]:
    return [call for call, _payload in _successful_tool_results(capture, name)]


def _caveat_kinds(capture: TurnCapture) -> set[str]:
    found: set[str] = set()
    for result in capture.tool_returns:
        text = json.dumps(result["content"], default=str)
        found.update(re.findall(r'"kind"\s*:\s*"([a-z0-9_]+)"', text))
    return found


def _markers(text: str) -> list[str]:
    return re.findall(r"\[[1-9]\d*\]", text)


def _walk_mappings(value: Any) -> list[Mapping[str, Any]]:
    found: list[Mapping[str, Any]] = []
    if isinstance(value, Mapping):
        found.append(value)
        for child in value.values():
            found.extend(_walk_mappings(child))
    elif isinstance(value, list | tuple):
        for child in value:
            found.extend(_walk_mappings(child))
    return found


def _normalized_period(value: str) -> str:
    return re.sub(r"[–—/]", "-", value).replace(" ", "")


def _normalized_claim_value(value: str) -> str:
    """Match display formatting without weakening the expected numeric value."""
    return re.sub(r"[^0-9.]", "", value).removesuffix(".00")


def _table_is(table: exp.Table, schema: str, name: str) -> bool:
    return table.db.casefold() == schema and table.name.casefold() == name


def _ordered_column(item: exp.Expression) -> tuple[str, bool] | None:
    if not isinstance(item, exp.Ordered) or not isinstance(item.this, exp.Column):
        return None
    return item.this.name.casefold(), item.args.get("desc") is True


def _selected_document_cte(tree: exp.Query) -> tuple[str, exp.Select] | None:
    for cte in tree.find_all(exp.CTE):
        select = cte.this
        if not isinstance(select, exp.Select):
            continue
        from_clause = select.args.get("from_")
        source = from_clause.this if isinstance(from_clause, exp.From) else None
        if not isinstance(source, exp.Table) or not _table_is(
            source, "cds_library", "active_cds_documents"
        ):
            continue
        distinct = select.args.get("distinct")
        on = distinct.args.get("on") if isinstance(distinct, exp.Distinct) else None
        distinct_expressions = list(on.expressions) if isinstance(on, exp.Tuple) else []
        order = select.args.get("order")
        ordered = (
            [_ordered_column(item) for item in order.expressions]
            if isinstance(order, exp.Order)
            else []
        )
        projected = {
            projection.name.casefold()
            for projection in select.expressions
            if isinstance(projection, exp.Column)
        }
        unfiltered = (
            not any(
                select.args.get(key) is not None
                for key in ("where", "limit", "group", "having", "qualify")
            )
            and not select.args.get("joins")
            and not any(nested is not select for nested in select.find_all(exp.Select))
        )
        if (
            len(distinct_expressions) == 1
            and isinstance(distinct_expressions[0], exp.Column)
            and distinct_expressions[0].name.casefold() == "school_id"
            and {"school_id", "document_id"} <= projected
            and unfiltered
            and ordered[:3]
            == [
                ("school_id", False),
                ("academic_year", True),
                ("document_id", True),
            ]
        ):
            return cte.alias.casefold(), select
    return None


def _join_has_exact_document_keys(
    join: exp.Join, selected_alias: str, packet_alias: str
) -> bool:
    on = join.args.get("on")
    if not isinstance(on, exp.Expression) or on.find(exp.Or) is not None:
        return False
    matched: set[str] = set()
    for equality in on.find_all(exp.EQ):
        left, right = equality.this, equality.expression
        if not isinstance(left, exp.Column) or not isinstance(right, exp.Column):
            continue
        columns = (left, right)
        names = {column.name.casefold() for column in columns}
        tables = {column.table.casefold() for column in columns}
        if len(names) == 1 and tables == {selected_alias, packet_alias}:
            matched.update(names)
    return {"school_id", "document_id"} <= matched


def _has_selected_document_candidate_sql(sql: str) -> bool:
    try:
        statements = parse(sql, read="postgres")
    except (ParseError, TokenError):
        return False
    if len(statements) != 1 or not isinstance(statements[0], exp.Query):
        return False
    tree = statements[0]
    selected = _selected_document_cte(tree)
    if selected is None:
        return False
    selected_alias, _selected_query = selected
    for select in tree.find_all(exp.Select):
        from_clause = select.args.get("from_")
        packet_table = from_clause.this if isinstance(from_clause, exp.From) else None
        if not isinstance(packet_table, exp.Table) or not _table_is(
            packet_table, "cds_library", "active_cds_domain_packets"
        ):
            continue
        packet_alias = packet_table.alias_or_name.casefold()
        for join in select.args.get("joins") or []:
            relation = join.this
            if (
                isinstance(relation, exp.Table)
                and relation.name.casefold() == selected_alias
                and not join.args.get("side")
                and join.args.get("kind") in {None, "INNER"}
                and _join_has_exact_document_keys(
                    join, relation.alias_or_name.casefold(), packet_alias
                )
            ):
                return True
    return False


def _candidate_school_ids(payload: Mapping[str, Any]) -> set[int]:
    columns = [str(column).casefold() for column in payload.get("columns") or []]
    id_column = next(
        (name for name in ("school_id", "unitid", "id") if name in columns), None
    )
    if id_column is None:
        return set()
    index = columns.index(id_column)
    candidates: set[int] = set()
    for row in payload.get("rows") or []:
        if isinstance(row, list | tuple) and len(row) > index:
            try:
                candidates.add(int(row[index]))
            except (TypeError, ValueError):
                continue
    return candidates


def _typed_refetch_complete(
    capture: TurnCapture, domain_id: str, required_refs: set[str]
) -> tuple[bool, str]:
    if not domain_id or not required_refs:
        return False, "typed refetch domain/ref requirements are missing"
    queries = _successful_tool_results(capture, "query_database")
    if not queries:
        return False, "no successful candidate query"
    query_call, query_payload = queries[-1]
    candidates = _candidate_school_ids(query_payload)
    query_index = next(
        (index for index, call in enumerate(capture.tool_calls) if call is query_call), -1
    )
    fetched: dict[int, set[str]] = {}
    for call, payload in _successful_tool_results(capture, "get_domain"):
        call_index = next(
            (index for index, item in enumerate(capture.tool_calls) if item is call), -1
        )
        if call_index <= query_index or call["args"].get("domain_id") != domain_id:
            continue
        call_unitid = call["args"].get("unitid")
        school = payload.get("school")
        returned_unitid_value = school.get("unitid") if isinstance(school, Mapping) else None
        if not isinstance(call_unitid, int | str) or not isinstance(
            returned_unitid_value, int | str
        ):
            continue
        try:
            unitid = int(call_unitid)
            returned_unitid = int(returned_unitid_value)
        except (TypeError, ValueError):
            continue
        if returned_unitid != unitid or payload.get("domain_id") != domain_id:
            continue
        available_refs = {
            str(row.get("field") or row.get("ref"))
            for row in payload.get("rows") or []
            if isinstance(row, Mapping)
            and row.get("available") is True
            and isinstance(row.get("display"), str)
            and bool(row["display"].strip())
        }
        if required_refs <= available_refs:
            fetched[unitid] = available_refs
    return bool(candidates) and candidates <= fetched.keys(), (
        f"candidates={sorted(candidates)}; domain={domain_id}; refs={sorted(required_refs)}; "
        f"successfully refetched={sorted(fetched)}"
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
        name, args = str(call["tool_name"]), call["args"]
        safe_args = {k: args[k] for k in ("query", "unitid", "groups", "domain_id") if k in args}
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


def score_routing(expects: dict[str, Any], capture: TurnCapture) -> dict[str, dict[str, Any]]:
    called = [str(c["tool_name"]) for c in capture.tool_calls]
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
    if expects.get("domain_id"):
        selected = [c["args"].get("domain_id") for c in _calls(capture, "get_domain")]
        checks["domain_selected"] = _check(expects["domain_id"] in selected, f"domains={selected}")
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
        available_cells = [
            c
            for v in capture.vizzes
            for row in v.get("rows", [])
            for c in row.get("cells", [])
            if c.get("available")
        ]
        missing_tier = [c for c in available_cells if not (c.get("citation") or {}).get("tier")]
        checks["cell_provenance_tier"] = _check(
            not missing_tier, f"available cells missing a visible tier: {missing_tier}"
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
    if vintage_claims := expects.get("vintage_claims"):
        wanted_values = [str(value) for value in vintage_claims.get("values") or []]
        claims: dict[str, str] = {}
        for _call, payload in _successful_tool_results(capture, "get_domain"):
            for row in _walk_mappings(payload):
                display = str(row.get("display") or "")
                citation = row.get("citation")
                vintage = str(row.get("vintage") or "")
                if not vintage and isinstance(citation, Mapping):
                    vintage = str(citation.get("vintage") or "")
                matched_value = next(
                    (
                        value
                        for value in wanted_values
                        if _normalized_claim_value(display) == _normalized_claim_value(value)
                    ),
                    None,
                )
                if matched_value is not None and vintage:
                    claims[matched_value] = vintage
        prose_has_bindings = all(
            value in capture.prose and vintage in capture.prose
            for value, vintage in claims.items()
        )
        checks["metric_vintage_bindings"] = _check(
            set(claims) == set(wanted_values)
            and len(set(claims.values())) == len(wanted_values)
            and prose_has_bindings,
            f"claims={claims}; prose_has_bindings={prose_has_bindings}",
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
    if expects.get("selected_document_sql"):
        sql_calls = _calls(capture, "query_database")
        successful = _successful_calls(capture, "query_database")
        latest_sql = str(successful[-1]["args"].get("sql") or "") if successful else ""
        checks["selected_document_sql"] = _check(
            _has_selected_document_candidate_sql(latest_sql),
            f"query_database calls={len(sql_calls)}; successful={len(successful)}",
        )
    if expects.get("typed_refetch"):
        complete, detail = _typed_refetch_complete(
            capture,
            str(expects.get("typed_refetch_domain_id") or ""),
            {str(ref) for ref in expects.get("typed_refetch_refs") or ()},
        )
        checks["typed_refetch"] = _check(complete, detail)
    if expects.get("no_profile_metric"):
        profile_calls = _calls(capture, "get_school_profile")
        domain_calls = _calls(capture, "get_domain")
        checks["no_profile_as_metric"] = _check(
            bool(domain_calls) or not expects.get("metric_required", True),
            f"profile calls={len(profile_calls)}; domain calls={len(domain_calls)}",
        )
    if expects.get("template_absence_live"):
        template_domain = expects.get("domain_id")
        template_ref = expects.get("metric_ref")
        domain_calls = _calls(capture, "get_domain")
        payloads = _return_payloads(capture, "get_domain")
        has_call = any(
            call["args"].get("domain_id") == template_domain for call in domain_calls
        )
        has_row = any(
            row.get("ref") == template_ref
            and row.get("availability_status") == "not_in_template_version"
            for payload in payloads
            for row in payload.get("rows", [])
            if isinstance(row, dict)
        )
        checks["template_absence_live_evidence"] = _check(
            has_call and has_row,
            f"domain={template_domain}; ref={template_ref}; called={has_call}; evidenced={has_row}",
        )
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
        direct = (
            rf"\b{expected_pair[0]}\b"
            rf"(?:\s+(?:covered|verified|reported|eligible|profiled|schools?|institutions?"
            rf"|candidates?|values?|with|usable|exact|metric|data|that|can|be|evaluated"
            rf"|have|has|a|an|the|for|this|ranking|only|count|of|total|database"
            rf"|contains|reflects|our|current|reported)){{0,24}}\s+"
            rf"(?:of|out of)\s+"
            rf"(?:the\s+)?{expected_pair[1]}\b"
            if expected_pair
            else r"(?!)"
        )
        reverse = (
            rf"\b(?:of|out of)\s+(?:the\s+)?{expected_pair[1]}\b"
            rf"(?:\s+(?:covered|verified|reported|eligible|profiled|schools?|institutions?"
            rf"|candidates?|values?|with|usable|exact|metric|data|that|can|be|evaluated"
            rf"|have|has|a|an|the|for|this|ranking|only|count|of|total|database"
            rf"|contains|reflects|our|current|reported|only|among|there|are|is|,))*"
            rf"\s+{expected_pair[0]}\b"
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
    return {
        "narration_present": _check(bool(beats), f"beats={len(beats)}"),
        "concise": _check(
            all(len(re.findall(r"[.!?]+(?:\s|$)", b)) <= 2 for b in beats), f"beats={beats}"
        ),
        "no_markers": _check(not any(_markers(b) for b in beats), "narration must not cite"),
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
            ):
                events.append(event)
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
            "duration_s": round(time.monotonic() - started, 3),
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

    rendered = substitute(questions)
    for question in rendered:
        expects = question["expects"]
        if expects.get("domain_role") == "common":
            expects["domain_id"] = context.common_domain
        if expects.get("denominator"):
            expects["denominator_total"] = context.total
        if question.get("live_not_in_template") and not context.not_in_template_available:
            question["skip_reason"] = (
                "current live DB contains no not_in_template_version availability"
            )
        elif question.get("live_not_in_template"):
            expects["domain_id"] = context.not_in_template_domain
            expects["metric_ref"] = context.not_in_template_ref
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
        "eval_context": {
            "manifest_version": context.manifest_version,
            "domains": list(context.domains),
            "covered": context.covered,
            "total": context.total,
            "roles": {
                k: getattr(context, k).__dict__
                for k in ("stale_partial", "profile_only", "common_a", "common_b")
            },
            "common_domain": context.common_domain,
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
    return f"report-{stamp}{suffix}"


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
                build_report(results, response_mode, selection.model_setting, context),
                suffix_mode=args.compare_response_modes or response_mode is ResponseMode.THINK,
            )
    finally:
        await runtime.aclose()
    return 0


def main() -> None:
    raise SystemExit(asyncio.run(amain(parse_args())))


if __name__ == "__main__":
    main()
