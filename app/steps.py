"""The step mapper + the stream emission router (MVP2 — ARCHITECTURE §27.1–27.2).

Two pieces, both pure of I/O:

- :class:`StepMapper` — tool-call info in, ``{kind, tier, label}`` out, driven
  by the ``step_labels`` asset (ADR 0018 bucket 2: the timeline's voice lives
  in data). Labels can name schools via a ``unitid → name`` resolver (the
  in-memory catalog map). Receipts (:class:`~domain.events.StepDetail`) carry
  queries, domains, counts, field keys — never DSNs, credentials, or payloads.

- :class:`EmissionRouter` — consumes pydantic-ai ``run_stream_events()``
  events and writes protocol chunks through the LangGraph custom-stream
  writer. Owns the three B0-decided mechanisms:

  1. **Step pairing on ``tool_call_id``** — parallel tool calls are real;
     result events arrive as-completed, so a "current step" cursor would
     mispair. ``ask_student`` is excluded (its ``interrupt()`` means no
     result event ever arrives — the clarify event is its UI).
  2. **Result-shape error detection** — the Tavily tools never raise (they
     return ``{"error": …}`` dicts) and a model-input problem surfaces as a
     ``RetryPromptPart``; both must show ``status:"error"`` — a failed search
     never gets a green check.
  3. **Final-answer gated routing**: model text is work narration until the
     stream proves the final answer has started. Pre-final text flushes as
     ``narration`` (the agent's loud talk, shown inline) at tool/non-text
     boundaries; final-answer prose is the only text routed to ``delta``.
     Native Gemini thought summaries (``ThinkingPart``) are a separate
     ``thinking`` feed — raw reasoning, collapsed by default, emitted per
     completed paragraph. The two feeds never mix: ``thinking`` is
     native-reasoning-only.

  :meth:`EmissionRouter.close` is the terminal closure: at clarify/error/
  budget every open step is closed synthetically so nothing shimmers forever
  — ``end`` on interrupt (the work is superseded, the resume replays it),
  ``error`` when the run died (a green check would lie).
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal, cast
from urllib.parse import urlparse

from pydantic_ai import FinalResultEvent
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    PartDeltaEvent,
    PartEndEvent,
    PartStartEvent,
    RetryPromptPart,
    TextPart,
    TextPartDelta,
    ThinkingPart,
    ThinkingPartDelta,
)
from pydantic_ai.run import AgentRunResultEvent

from app.tool_specs import ToolSpec, build_tool_specs
from domain.events import (
    StepData,
    StepDetail,
    StepKind,
    StepSource,
    StepTier,
    ToolUi,
    ev_step,
    tool_ui_from_payload,
)
from domain.urls import favicon_url, registrable_domain

logger = logging.getLogger(__name__)

#: Chars of buffered response text below which pre-tool-call text is routed to
#: ``thinking`` (B0 spike 2 — measured latency cost ≈ 0 at Gemini chunk sizes).
#: This is the ``EmissionRouter.threshold`` dataclass DEFAULT only — a test-time
#: fallback so the router is independently constructible in unit tests. The
#: PRODUCTION value is sourced from ``settings.thinking_threshold_chars`` at the
#: construction site in ``app/agent_node.py`` (CFG-07); this is NOT a duplicated
#: production read (no CFG-02-style drift).
THINKING_THRESHOLD_CHARS = 240

#: Max chars of a query/name substituted into an always-visible timeline label.
#: Full text still rides the receipt (``detail.query``) — the label is a glance.
_LABEL_QUERY_MAX_CHARS = 120

#: The tool whose call event never gets a result event (interrupt-backed).
_EXCLUDED_TOOL = "ask_student"

#: Max source chips per step (deduped by url first, then capped). Tavily returns
#: ~5 results; the cap bounds payload if a future tool returns more.
_MAX_STEP_SOURCES = 8

CloseReason = Literal["complete", "interrupt", "error", "budget"]


# ---------------------------------------------------------------------------
# The mapper
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class MappedStep:
    """What the mapper pins at call time: the step's identity on the timeline."""

    kind: StepKind
    tier: StepTier | None
    label: str


class _SafeDict(dict[str, Any]):
    """``format_map`` helper: a missing key renders as ``?`` — never ``{key}``.

    Label sanity (eval check, §34): no unfilled ``{…}`` template may reach a
    student. The mapper guarantees the standard keys; this is the last net.
    """

    def __missing__(self, key: str) -> str:
        return "?"


class StepMapper:
    """Tool-call info → step identity + receipts, driven by the labels asset."""

    def __init__(
        self,
        labels: dict[str, Any],
        resolve_school_name: Callable[[int], str | None],
        resolve_school_domain: Callable[[int], str | None] | None = None,
    ) -> None:
        self._tools: dict[str, Any] = labels.get("tools") or {}
        self._specs: dict[str, ToolSpec] = build_tool_specs(labels, _receipt_from_mapper)
        self._default: dict[str, Any] = labels.get("default") or {}
        self._errors: dict[str, str] = labels.get("errors") or {}
        self._viz_labels: dict[str, str] = labels.get("viz_labels") or {}
        self._fallbacks: dict[str, str] = labels.get("fallbacks") or {}
        self._resolve = resolve_school_name
        self._resolve_domain = resolve_school_domain or (lambda _unitid: None)

    # -- call time --------------------------------------------------------

    def _kind_for(self, tool_name: str) -> StepKind:
        """The step kind for a tool: the labels-asset kind, else the db_tool default.

        The single owner of the "unknown tool ⇒ db_tool" rule (audit L5) — the
        ``("kind", "db_tool")`` default literal lives here and nowhere else.
        """
        spec = self._specs.get(tool_name)
        if spec is not None:
            return spec.kind
        return cast("StepKind", self._default.get("kind", "db_tool"))

    def map_call(self, tool_name: str, args: dict[str, Any]) -> MappedStep:
        # The label keeps its own row lookup (the _unknown marker rides the label
        # path); the kind routes through _kind_for so the default lives once. The
        # _unknown row is {**self._default, ...}, so its .get("kind", "db_tool")
        # resolves identically to _kind_for(tool_name).
        spec = self._specs.get(tool_name)
        row = (
            {"kind": spec.kind, "tier": spec.tier, "label": spec.label}
            if spec is not None
            else {**self._default, "_unknown": True}
        )
        label_args = self._label_args(tool_name, args)
        label = str(row.get("label", "Working")).format_map(_SafeDict(label_args))
        return MappedStep(
            kind=self._kind_for(tool_name),
            tier=cast("StepTier | None", row.get("tier")),
            label=label,
        )

    def error_label(self, mapped: MappedStep, *, retry: bool) -> str:
        """The per-failure-class label for a step that ended in error."""
        if retry:
            template = self._errors.get("retry", "{label} — retrying")
        elif mapped.kind in ("web_search", "edu_search", "reddit_search"):
            template = self._errors.get("search_failed", "{label} — failed")
        else:
            template = self._errors.get("tool_failed", "{label} — failed")
        return template.format_map(_SafeDict({"label": mapped.label}))

    # -- result time ------------------------------------------------------

    @staticmethod
    def result_is_error(result_part: Any, content: Any) -> bool:
        """Detect retry/error and explicit all-or-nothing tool rejections."""
        if isinstance(result_part, RetryPromptPart):
            return True
        return isinstance(content, dict) and (
            "error" in content
            or content.get("ok") is False
            or content.get("status") in {"error", "rejected"}
        )

    def detail_for(
        self, tool_name: str, args: dict[str, Any], content: Any, duration_ms: int
    ) -> StepDetail:
        """The expandable receipt for a step's ``end``/``error`` event.

        Built as kwargs per kind and constructed once — pydantic validates on
        construction, so no field is ever set behind validation's back (house
        immutability rule).
        """
        spec = self._specs.get(tool_name)
        if spec is not None:
            return spec.receipt(tool_name, args, content, duration_ms, self)
        return _receipt_from_mapper(tool_name, args, content, duration_ms, self)

    def _detail_for_known_kind(
        self, tool_name: str, args: dict[str, Any], content: Any, duration_ms: int
    ) -> StepDetail:
        kind: StepKind = self._kind_for(tool_name)
        kwargs: dict[str, Any] = {"duration_ms": duration_ms}
        if kind in ("web_search", "edu_search", "reddit_search"):
            kwargs["query"] = _str_or_none(args.get("query"))
            receipt = _overflow_receipt(content)
            results = content.get("results") if isinstance(content, dict) else None
            if isinstance(results, list):
                kwargs["result_count"] = len(results)
                kwargs["domains"] = _domains_of(results)
            elif receipt is not None:
                result_count = receipt.get("result_count")
                if isinstance(result_count, int):
                    kwargs["result_count"] = result_count
                domains = receipt.get("domains")
                if isinstance(domains, list):
                    kwargs["domains"] = [str(domain) for domain in domains if domain]
            elif isinstance(content, dict) and "error" not in content:
                # Success-but-no-results (shape drift): show "0 results" explicitly
                # rather than omit the count — a completed search that found nothing
                # must say so (honesty). Errored searches keep status:error / no count.
                kwargs["result_count"] = 0
        elif kind == "sql":
            # query_database's receipt never carries the SQL statement or its
            # params/rows — row_count + tool only (§6.2 receipt contract).
            effective = _overflow_receipt(content) or content
            kwargs["row_count"] = (
                effective.get("row_count")
                if isinstance(effective, dict) and isinstance(effective.get("row_count"), int)
                else _row_count_of(effective)
            )
            kwargs["tool"] = tool_name
        elif kind == "viz":
            kwargs.update(self._viz_detail_kwargs(args, content))
        elif kind == "write_plan":
            kwargs.update(_plan_detail_kwargs(content))
        elif kind in ("workspace", "memory"):
            if isinstance(content, dict):
                kwargs["summary"] = _str_or_none(content.get("summary"))
        else:  # db_tool, skill, unknown
            kwargs.update(self._db_tool_detail_kwargs(tool_name, args, content))
        kwargs.update(_error_detail_kwargs(content))
        return StepDetail(**kwargs)

    def _db_tool_detail_kwargs(
        self, tool_name: str, args: dict[str, Any], content: Any
    ) -> dict[str, Any]:
        """Dispatch the db_tool/skill/unknown receipt to its exact shape (§6.2).

        The four CDS Library tools each get a dedicated, narrow receipt
        (safe structural fields only — never packets, values, excerpts,
        diagnostics, coverage blocks, or provider metadata). Anything else in
        this kind bucket (``load_skill``, a future/unknown tool) falls back to
        the generic shape.
        """
        # An overflowed result's public_receipt already carries the allowlisted
        # fields (status/schools/domain_id/value_count/row_count/ui) — treat it
        # as the effective content so a large get_domain/get_school_profile read
        # still gets a real receipt instead of an empty one.
        effective = _overflow_receipt(content) or content
        if tool_name == "resolve_school":
            return self._resolve_school_kwargs(args, effective)
        if tool_name == "get_school_profile":
            return self._get_school_profile_kwargs(effective)
        if tool_name == "get_domain":
            return self._get_domain_kwargs(args, effective)
        return self._generic_db_tool_kwargs(tool_name, args, content)

    def _generic_db_tool_kwargs(
        self, tool_name: str, args: dict[str, Any], content: Any
    ) -> dict[str, Any]:
        """The fallback shape for non-CDS db_tool-kind tools (e.g. ``load_skill``)."""
        kwargs: dict[str, Any] = {
            "tool": tool_name,
            "query": _str_or_none(args.get("query") or args.get("name")),
            "row_count": _row_count_of(content),
        }
        schools = self._school_names(args)
        if schools:
            kwargs["schools"] = schools
        return kwargs

    @staticmethod
    def _content_school_names(content: dict[str, Any]) -> list[str]:
        """One school's name from either the raw tool result (``school``) or
        an overflow receipt's already-flattened ``schools`` list."""
        school = content.get("school")
        if isinstance(school, dict):
            name = _str_or_none(school.get("name"))
            return [name] if name else []
        schools = content.get("schools")
        if isinstance(schools, list):
            return [str(item) for item in schools if item]
        return []

    @staticmethod
    def _resolve_school_kwargs(args: dict[str, Any], content: Any) -> dict[str, Any]:
        """``resolve_school``: tool, query, result_count, schools?, duration_ms.

        ``args`` never carries a unitid for this tool, so any school name here
        is derived from the tool's own result content — still safe, since it's
        the resolution the tool just returned, not raw packet data.
        """
        kwargs: dict[str, Any] = {
            "tool": "resolve_school",
            "query": _str_or_none(args.get("query")),
        }
        if not isinstance(content, dict):
            return kwargs
        if isinstance(content.get("result_count"), int):
            kwargs["result_count"] = content["result_count"]
            schools = content.get("schools")
            if isinstance(schools, list):
                clean = [str(school) for school in schools if school]
                if clean:
                    kwargs["schools"] = clean
            return kwargs
        status = content.get("status")
        if status == "match":
            kwargs["result_count"] = 1
            names = StepMapper._content_school_names(content)
            if names:
                kwargs["schools"] = names
        elif status == "candidates":
            candidates = content.get("candidates")
            if isinstance(candidates, list):
                kwargs["result_count"] = len(candidates)
                candidate_names = [
                    _str_or_none(candidate.get("name"))
                    for candidate in candidates
                    if isinstance(candidate, dict)
                ]
                clean = [name for name in candidate_names if name]
                if clean:
                    kwargs["schools"] = clean
        elif status == "not_found":
            kwargs["result_count"] = 0
        return kwargs

    @staticmethod
    def _get_school_profile_kwargs(content: Any) -> dict[str, Any]:
        """``get_school_profile``: tool, schools, value_count, duration_ms.

        No ``query`` (the tool takes a unitid, not free text) and no
        ``row_count`` — ``value_count`` is the count of profile rows the
        service actually marked ``available``, not a raw row/group count.
        """
        kwargs: dict[str, Any] = {"tool": "get_school_profile"}
        if not isinstance(content, dict):
            return kwargs
        names = StepMapper._content_school_names(content)
        if names:
            kwargs["schools"] = names
        direct_value_count = content.get("value_count")
        if isinstance(direct_value_count, int):
            kwargs["value_count"] = direct_value_count
        else:
            groups = content.get("groups")
            if isinstance(groups, list):
                kwargs["value_count"] = sum(
                    1
                    for group in groups
                    if isinstance(group, dict)
                    for row in group.get("rows", [])
                    if isinstance(row, dict) and row.get("available")
                )
        return kwargs

    @staticmethod
    def _get_domain_kwargs(args: dict[str, Any], content: Any) -> dict[str, Any]:
        """``get_domain``: tool, schools, domain_id, value_count, duration_ms.

        ``value_count`` is the service's authoritative ``availability.available``
        count — never ``len(rows)`` (rows also include unavailable and
        not-in-template-version metrics, so that would overcount).
        """
        kwargs: dict[str, Any] = {"tool": "get_domain"}
        if isinstance(args.get("domain_id"), str):
            kwargs["domain_id"] = args["domain_id"]
        if not isinstance(content, dict):
            return kwargs
        names = StepMapper._content_school_names(content)
        if names:
            kwargs["schools"] = names
        direct_value_count = content.get("value_count")
        if isinstance(direct_value_count, int):
            kwargs["value_count"] = direct_value_count
        else:
            availability = content.get("availability")
            if isinstance(availability, dict) and isinstance(
                availability.get("available"), int
            ):
                kwargs["value_count"] = availability["available"]
        return kwargs

    def _viz_detail_kwargs(self, args: dict[str, Any], content: Any) -> dict[str, Any]:
        """``render_viz``: viz_type, value_count, schools, sources.

        Sourced from ``render_viz``'s own ``public_receipt`` (the resolved
        column names and the distinct citation markers actually used) rather
        than the raw call args, since web-only columns (``unitid: None``)
        have no arg-derivable name. Falls back to the args-derived shape only
        when no ``public_receipt`` is present (e.g. a rejected call).
        """
        receipt = content.get("public_receipt") if isinstance(content, dict) else None
        if not isinstance(receipt, dict):
            return {
                "viz_type": _str_or_none(args.get("type")),
                "schools": self._school_names(args) or None,
            }
        kwargs: dict[str, Any] = {"viz_type": _str_or_none(receipt.get("viz_type"))}
        schools = receipt.get("schools")
        if isinstance(schools, list):
            clean_schools = [str(school) for school in schools if school]
            if clean_schools:
                kwargs["schools"] = clean_schools
        if isinstance(receipt.get("value_count"), int):
            kwargs["value_count"] = receipt["value_count"]
        sources = receipt.get("sources")
        if isinstance(sources, list):
            clean_sources = [str(source) for source in sources if source]
            if clean_sources:
                kwargs["sources"] = clean_sources
        return kwargs

    # -- label args -------------------------------------------------------

    def _label_args(self, tool_name: str, args: dict[str, Any]) -> dict[str, str]:
        school_fallback = self._fallbacks.get("school", "the school")
        names = self._school_names(args)
        subs = args.get("subreddits")
        viz_type = str(args.get("type", ""))
        return {
            "tool": tool_name,
            "query": _truncate(str(args.get("query", "")).strip()) or "…",
            "name": _truncate(str(args.get("name", "")).strip()) or "…",
            "school": names[0] if names else school_fallback,
            "schools": _join_names(names) if names else "schools",
            "subreddits": _join_names([f"r/{sub}" for sub in subs])
            if isinstance(subs, list) and subs
            else "Reddit",
            "category": self._category_of(args),
            "viz_label": self._viz_labels.get(viz_type, "visualization"),
            "tasks_phrase": _tasks_phrase(args),
            "schools_phrase": _schools_phrase(args),
            "essays_phrase": _essays_phrase(args),
            "activities_phrase": _activities_phrase(args),
            "honors_phrase": _honors_phrase(args),
            "memories_phrase": _memories_phrase(args),
        }

    @staticmethod
    def _school_unitids(args: dict[str, Any]) -> list[int]:
        if isinstance(args.get("unitid"), int):
            return [args["unitid"]]
        if isinstance(args.get("unitids"), list):
            return [u for u in args["unitids"] if isinstance(u, int)]
        if isinstance(args.get("columns"), list):
            return [
                column["unitid"]
                for column in args["columns"]
                if isinstance(column, dict) and isinstance(column.get("unitid"), int)
            ]
        return []

    def _school_names(self, args: dict[str, Any]) -> list[str]:
        names = [self._resolve(u) for u in self._school_unitids(args)]
        return [n for n in names if n]

    # -- source chips (§27.1) ---------------------------------------------

    def sources_for(
        self, tool_name: str, args: dict[str, Any], content: Any
    ) -> list[StepSource] | None:
        """The completed step's source chips — None when the kind has none.

        Search kinds read result URLs/titles from ``content``; db/sql/viz read
        school unitids from ``args`` (the call), resolving each to its website
        domain → favicon. ``None`` (never ``[]``) so ``ev_step`` drops the field.
        """
        kind: StepKind = self._kind_for(tool_name)
        if kind in ("web_search", "edu_search", "reddit_search"):
            return self._search_sources(kind, _search_source_content(content))
        if kind in ("db_tool", "sql", "viz"):
            return self._school_sources(args, content)
        return None

    def ui_for(self, tool_name: str, args: dict[str, Any], content: Any) -> ToolUi | None:
        """The completed step's structured UI payload, if a tool exposed one.

        ``ui`` is never read from the raw top-level tool result. The middleware
        demotes it to ``public_receipt.ui`` before the result reaches the model,
        and overflow reduction preserves that public receipt in the compact
        envelope.
        """
        del tool_name, args
        receipt = _public_receipt_content(content)
        if receipt is None:
            return None
        ui = receipt.get("ui")
        return tool_ui_from_payload(ui)

    def _search_sources(self, kind: StepKind, content: Any) -> list[StepSource] | None:
        results = content.get("results") if isinstance(content, dict) else None
        if not isinstance(results, list):
            return None
        out: list[StepSource] = []
        seen: set[str] = set()
        for result in results:
            url = _str_or_none(result.get("url")) if isinstance(result, dict) else None
            if not url or url in seen:  # dedup by url BEFORE the cap
                continue
            if not url.lower().startswith(("http://", "https://")):
                continue  # skip javascript:/data:/etc — never reaches the wire
            seen.add(url)
            host = registrable_domain(url)
            title = _str_or_none(result.get("title"))
            # Reddit chips name the post; web/edu chips name the host.
            label = _truncate(title) if (kind == "reddit_search" and title) else (host or url)
            fav = favicon_url(host) if host else None
            out.append(StepSource(label=label, favicon=fav, url=url))
            if len(out) >= _MAX_STEP_SOURCES:
                break
        return out or None

    def _school_sources(self, args: dict[str, Any], content: Any = None) -> list[StepSource] | None:
        out: list[StepSource] = []
        unitids = self._school_unitids(args)
        # ``resolve_school`` has no UNITID argument. Its matched/candidate
        # identities are safe, but still resolve the chip URL through the
        # Catalog callbacks so a tool-supplied URL/domain can never cross the
        # public receipt seam.
        if not unitids and isinstance(content, dict):
            schools: list[Any] = []
            if isinstance(content.get("school"), dict):
                schools.append(content["school"])
            if isinstance(content.get("candidates"), list):
                schools.extend(content["candidates"])
            unitids = [
                school["unitid"]
                for school in schools
                if isinstance(school, dict) and isinstance(school.get("unitid"), int)
            ]
        for unitid in dict.fromkeys(unitids):
            name = self._resolve(unitid)
            domain = self._resolve_domain(unitid)
            if not name and not domain:
                continue
            out.append(
                StepSource(
                    label=name or domain or "",
                    favicon=favicon_url(domain) if domain else None,
                    url=f"https://{domain}" if domain else None,
                )
            )
        return out or None

    def _category_of(self, args: dict[str, Any]) -> str:
        if isinstance(args.get("domain_id"), str) and args["domain_id"].strip():
            return _humanize(args["domain_id"])
        refs = [
            cell.get("metric_ref") or cell.get("profile_field")
            for row in args.get("rows", [])
            if isinstance(row, dict)
            for cell in row.get("cells", [])
            if isinstance(cell, dict)
        ]
        keys = [ref for ref in refs if isinstance(ref, str)]
        if not keys:
            return self._fallbacks.get("category", "profile")
        prefixes = {str(key).split(".", 1)[0] for key in keys}
        if len(prefixes) == 1:
            return _humanize(prefixes.pop())
        return self._fallbacks.get("category", "profile")


def _truncate(text: str, limit: int = _LABEL_QUERY_MAX_CHARS) -> str:
    """Cap always-visible label text; the full text lives in the receipt."""
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _humanize(token: str) -> str:
    return token.replace("_", " ").strip()


def _join_names(names: list[str]) -> str:
    if len(names) <= 1:
        return names[0] if names else ""
    return ", ".join(names[:-1]) + " and " + names[-1]


def _receipt_from_mapper(
    tool_name: str,
    args: dict[str, Any],
    content: Any,
    duration_ms: int,
    mapper: StepMapper,
) -> StepDetail:
    return mapper._detail_for_known_kind(tool_name, args, content, duration_ms)


def _overflow_receipt(content: Any) -> dict[str, Any] | None:
    if not isinstance(content, dict) or content.get("status") != "overflow":
        return None
    receipt = content.get("public_receipt")
    return receipt if isinstance(receipt, dict) else None


def _public_receipt_content(content: Any) -> dict[str, Any] | None:
    receipt = _overflow_receipt(content)
    if receipt is not None:
        return receipt
    if not isinstance(content, dict):
        return None
    receipt = content.get("public_receipt")
    return receipt if isinstance(receipt, dict) else None


def _search_source_content(content: Any) -> Any:
    receipt = _overflow_receipt(content)
    if receipt is None:
        return content
    source_results = receipt.get("source_results")
    if not isinstance(source_results, list):
        return content
    return {"results": source_results}


_SECRETISH_TEXT = (
    "postgresql://",
    "mysql://",
    "password",
    "api_key",
    "secret",
    "token",
    "dsn",
)


def _safe_receipt_text(value: Any, limit: int = 180) -> str | None:
    text = _str_or_none(value)
    if text is None:
        return None
    lowered = text.lower()
    if any(needle in lowered for needle in _SECRETISH_TEXT):
        return None
    return _truncate(text, limit)


def _error_detail_kwargs(content: Any) -> dict[str, Any]:
    if not isinstance(content, dict) or "error" not in content:
        return {}
    root = _safe_receipt_text(content.get("root_cause") or content.get("error"))
    kwargs: dict[str, Any] = {"error": root or "Tool returned an error."}
    actions = [
        action
        for action in (
            _safe_receipt_text(content.get("safe_retry")),
            _safe_receipt_text(content.get("stop_condition")),
        )
        if action
    ]
    if actions:
        kwargs["next_actions"] = actions
    return kwargs


def _str_or_none(value: Any) -> str | None:
    text = str(value).strip() if value is not None else ""
    return text or None


def _tasks_phrase(args: dict[str, Any]) -> str:
    """ "a task" for a single-item batch, else "N tasks" (create_tasks/archive_tasks)."""
    items = args.get("tasks") or args.get("task_ids") or []
    count = len(items) if isinstance(items, list) else 0
    return "a task" if count == 1 else f"{count} tasks"


def _schools_phrase(args: dict[str, Any]) -> str:
    """ "a school" for a single-item batch, else "N schools" (add_schools/archive_schools)."""
    items = args.get("schools") or args.get("application_ids") or []
    count = len(items) if isinstance(items, list) else 0
    return "a school" if count == 1 else f"{count} schools"


def _essays_phrase(args: dict[str, Any]) -> str:
    """ "an essay" for a single-item batch, else "N essays" (create_essays/archive_essays)."""
    items = args.get("essays") or args.get("essay_ids") or []
    count = len(items) if isinstance(items, list) else 0
    return "an essay" if count == 1 else f"{count} essays"


def _activities_phrase(args: dict[str, Any]) -> str:
    """ "an activity" for a single-item batch, else "N activities" (create_activities/
    archive_activities)."""
    items = args.get("activities") or args.get("activity_ids") or []
    count = len(items) if isinstance(items, list) else 0
    return "an activity" if count == 1 else f"{count} activities"


def _honors_phrase(args: dict[str, Any]) -> str:
    """ "an honor" for a single-item batch, else "N honors" (create_honors/archive_honors)."""
    items = args.get("honors") or args.get("honor_ids") or []
    count = len(items) if isinstance(items, list) else 0
    return "an honor" if count == 1 else f"{count} honors"


def _memories_phrase(args: dict[str, Any]) -> str:
    """ "1 note" / "N notes" (forget) — the plan's literal "Forgetting {n} notes" wording."""
    items = args.get("memory_refs") or []
    count = len(items) if isinstance(items, list) else 0
    return f"{count} note" if count == 1 else f"{count} notes"


def _row_count_of(content: Any) -> int | None:
    if isinstance(content, list):
        return len(content)
    if isinstance(content, dict) and isinstance(content.get("rows"), list):
        return len(content["rows"])
    return None


def _plan_detail_kwargs(content: Any) -> dict[str, Any]:
    if not isinstance(content, dict):
        return {}
    receipt = content.get("public_receipt")
    if not isinstance(receipt, dict):
        return {}
    kwargs: dict[str, Any] = {}
    completed = receipt.get("completed")
    total = receipt.get("total")
    if isinstance(completed, int):
        kwargs["completed"] = completed
    if isinstance(total, int):
        kwargs["total"] = total
    items = receipt.get("items")
    if isinstance(items, list):
        clean_items: list[dict[str, str]] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            content_text = _str_or_none(item.get("content"))
            status = _str_or_none(item.get("status"))
            if content_text and status:
                clean_items.append({"content": content_text, "status": status})
        if clean_items:
            kwargs["items"] = clean_items
    return kwargs


def _domains_of(results: list[Any]) -> list[str] | None:
    domains: list[str] = []
    for result in results:
        url = result.get("url") if isinstance(result, dict) else None
        if not url:
            continue
        host = urlparse(str(url)).netloc.removeprefix("www.")
        if host and host not in domains:
            domains.append(host)
    return domains or None


# ---------------------------------------------------------------------------
# The emission router
# ---------------------------------------------------------------------------


@dataclass
class _OpenStep:
    step_id: str
    tool_name: str
    args: dict[str, Any]
    mapped: MappedStep
    started: float


@dataclass
class EmissionRouter:
    """pydantic-ai stream events → ``delta``/``narration``/``thinking``/``step``
    writer chunks.

    After the run, ``step_records`` holds every step's final state,
    ``narration_lines`` every narration (loud-talk) line, and
    ``thinking_lines`` every NATIVE raw-reasoning line — B1b persists them in
    the turn record; B1a only streams.
    """

    writer: Callable[[dict[str, Any]], None]
    mapper: StepMapper
    threshold: int = THINKING_THRESHOLD_CHARS
    #: Source-gated tool names NOT mounted this turn (story 17): a hallucinated
    #: call to one must paint no step — no search happened; the model's
    #: tool-not-found retry is internal noise, not student-visible work.
    unmounted: frozenset[str] = frozenset()
    on_final_start: Callable[[], None] | None = None

    step_records: list[dict[str, Any]] = field(default_factory=list)
    narration_lines: list[str] = field(default_factory=list)
    thinking_lines: list[str] = field(default_factory=list)
    final_answer_started: bool = field(default=False, init=False)

    _open: dict[str, _OpenStep] = field(default_factory=dict)
    _counter: int = 0
    _text_buf: str = ""
    _thinking_buf: str = ""
    _narration_streamed_len: int = 0
    _final_candidate: bool = False
    _closed: bool = False

    # -- the one entry point ------------------------------------------------

    def handle(self, event: Any) -> None:
        if self._closed:
            return  # late events must never write to a closed stream
        if isinstance(event, FinalResultEvent):
            self._handle_final_result()
        elif isinstance(event, AgentRunResultEvent):
            self._handle_run_result()
        elif isinstance(event, PartStartEvent):
            if isinstance(event.part, TextPart):
                self._feed_text(event.part.content or "")
            elif isinstance(event.part, ThinkingPart):
                self._feed_thinking(event.part.content or "")
        elif isinstance(event, PartDeltaEvent):
            if isinstance(event.delta, TextPartDelta):
                self._feed_text(event.delta.content_delta or "")
            elif isinstance(event.delta, ThinkingPartDelta):
                self._feed_thinking(event.delta.content_delta or "")
        elif isinstance(event, PartEndEvent):
            if isinstance(event.part, TextPart):
                self._end_text_part(getattr(event, "next_part_kind", None))
            elif isinstance(event.part, ThinkingPart):
                self._flush_thinking()
        elif isinstance(event, FunctionToolCallEvent):
            self._start_step(event)
        elif isinstance(event, FunctionToolResultEvent):
            self._finish_step(event)

    def close(self, reason: CloseReason) -> None:
        """Terminal closure: flush buffers, close every still-open step.

        Idempotent: agent_node may close on an exception path and again later;
        the second call must not re-emit or double-close anything.
        """
        if self._closed:
            return
        self._closed = True
        self._flush_thinking()
        if self._text_buf:
            if self.final_answer_started or (reason == "complete" and self._final_candidate):
                if not self.final_answer_started and self._unstreamed_text():
                    self._start_final_answer()
                self._flush_text_delta()
            else:
                self._flush_text_as_narration()
        self._final_candidate = False
        status: Literal["end", "error"] = "end" if reason in ("complete", "interrupt") else "error"
        for open_step in list(self._open.values()):
            self._emit_step(
                open_step.step_id,
                status,
                open_step.mapped,
                label=open_step.mapped.label
                if status == "end"
                else self.mapper.error_label(open_step.mapped, retry=False),
                detail=None,
            )
        self._open.clear()

    # -- text / thinking routing ---------------------------------------------

    def _handle_final_result(self) -> None:
        if self.final_answer_started:
            return
        if self._text_buf:
            if self._narration_streamed_len:
                text = self._unstreamed_text()
                self._clear_text_buffer()
                if text:
                    self._emit_narration(text)
                self._final_candidate = True
                return
            self._final_candidate = True
            return
        self._start_final_answer()

    def _handle_run_result(self) -> None:
        if self.final_answer_started or not self._text_buf:
            return
        if not self._unstreamed_text():
            self._clear_text_buffer()
            return
        self._start_final_answer()
        self._flush_text_delta()

    def _start_final_answer(self) -> None:
        if self.final_answer_started:
            return
        self.final_answer_started = True
        self._final_candidate = False
        if self.on_final_start is not None:
            self.on_final_start()

    def _feed_text(self, text: str) -> None:
        if not text:
            return
        if self.final_answer_started:
            self.writer({"type": "delta", "text": text})
            return
        self._text_buf += text
        if self._final_candidate:
            return

    def _end_text_part(self, next_part_kind: Any) -> None:
        if not self._text_buf:
            return
        if next_part_kind == "text":
            return  # a continuation text part follows — keep buffering
        if self.final_answer_started or (
            self._final_candidate and next_part_kind in (None, "thinking")
        ):
            # `thinking` here is Gemini interleaving a thought pause INSIDE the
            # final answer (include_thoughts): FinalResultEvent already marked
            # this text as the run's output, and a thought does not un-make it
            # the answer — demoting it to narration would render answer prose
            # as plain un-markdown'd text, chopped at part boundaries.
            if not self.final_answer_started and self._unstreamed_text():
                self._start_final_answer()
            self._flush_text_delta()
        else:
            # 'tool-call', 'thinking', 'builtin-tool-call', 'file', any future
            # kind: the model moved on to non-text work before answering, so
            # text here is narration. Defaulting unknown kinds to narration beats
            # defaulting to delta: a wrongly-streamed half-thought would lie to
            # a student.
            self._flush_text_as_narration()
            self._final_candidate = False

    def _flush_text_delta(self) -> None:
        if not self._text_buf:
            return
        text = self._unstreamed_text()
        self._clear_text_buffer()
        if text:
            self.writer({"type": "delta", "text": text})

    def _unstreamed_text(self) -> str:
        return self._text_buf[self._narration_streamed_len :]

    def _clear_text_buffer(self) -> None:
        self._text_buf = ""
        self._narration_streamed_len = 0
        self._final_candidate = False

    def _emit_unstreamed_text_as_narration(self) -> None:
        text = self._text_buf[self._narration_streamed_len :]
        if not text:
            return
        self._emit_narration(text)
        self._narration_streamed_len = len(self._text_buf)

    def _flush_text_as_narration(self) -> None:
        self._emit_unstreamed_text_as_narration()
        self._text_buf = ""
        self._narration_streamed_len = 0

    def _feed_thinking(self, text: str) -> None:
        if not text:
            return
        self._thinking_buf += text
        # Emit complete paragraphs as they land — visibility without broken lines.
        while "\n\n" in self._thinking_buf:
            paragraph, self._thinking_buf = self._thinking_buf.split("\n\n", 1)
            self._emit_thinking(paragraph)

    def _flush_thinking(self) -> None:
        if self._thinking_buf:
            self._emit_thinking(self._thinking_buf)
            self._thinking_buf = ""

    def _emit_thinking(self, text: str) -> None:
        line = text.strip()
        if not line:
            return
        self.writer({"type": "thinking", "text": line})
        self.thinking_lines.append(line)

    def _emit_narration(self, text: str) -> None:
        line = text.strip()
        if not line:
            return
        self.writer({"type": "narration", "text": line})
        self.narration_lines.append(line)

    # -- steps ----------------------------------------------------------------

    def _start_step(self, event: FunctionToolCallEvent) -> None:
        # A new tool batch means the prior model response is over.
        if self._text_buf:
            # Safety net: pending under-threshold text before a step is narration.
            self._flush_text_as_narration()
        self._final_candidate = False
        part = event.part
        if part.tool_name == _EXCLUDED_TOOL:
            return  # interrupt-backed: the clarify event is its UI
        if part.tool_name in self.unmounted:
            return  # disabled source ⇒ kind impossible (story 17)
        args = _args_dict(part)
        mapped = self.mapper.map_call(part.tool_name, args)
        self._counter += 1
        open_step = _OpenStep(
            step_id=f"s{self._counter}",
            tool_name=part.tool_name,
            args=args,
            mapped=mapped,
            started=time.monotonic(),
        )
        self._open[part.tool_call_id] = open_step
        self._emit_step(open_step.step_id, "start", mapped, label=mapped.label, detail=None)

    def _finish_step(self, event: FunctionToolResultEvent) -> None:
        result_part = event.part
        open_step = self._open.pop(result_part.tool_call_id, None)
        if open_step is None:
            # ask_student, an unmounted tool, or an unmatched id — nothing to close.
            logger.debug(
                "no open step for tool_call_id %s (excluded/unmounted/unmatched)",
                result_part.tool_call_id,
            )
            return
        retry = isinstance(result_part, RetryPromptPart)
        # A retry's content is the validation-error list — receipt poison
        # (it would read as a row_count); the receipt sees no content at all.
        content = None if retry else getattr(result_part, "content", None)
        errored = self.mapper.result_is_error(result_part, content)
        duration_ms = int((time.monotonic() - open_step.started) * 1000)
        detail = self.mapper.detail_for(open_step.tool_name, open_step.args, content, duration_ms)
        # Source chips only on a clean end — a failed search has no sources to show.
        sources = (
            None
            if errored
            else self.mapper.sources_for(open_step.tool_name, open_step.args, content)
        )
        ui = None if errored else self.mapper.ui_for(open_step.tool_name, open_step.args, content)
        self._emit_step(
            open_step.step_id,
            "error" if errored else "end",
            open_step.mapped,
            label=self.mapper.error_label(open_step.mapped, retry=retry)
            if errored
            else open_step.mapped.label,
            detail=detail,
            sources=sources,
            ui=ui,
        )

    def _emit_step(
        self,
        step_id: str,
        status: Literal["start", "end", "error"],
        mapped: MappedStep,
        *,
        label: str,
        detail: StepDetail | None,
        sources: list[StepSource] | None = None,
        ui: ToolUi | None = None,
    ) -> None:
        step = StepData(
            step_id=step_id,
            status=status,
            kind=mapped.kind,
            label=label,
            tier=mapped.tier,
            detail=detail,
            sources=sources,
            ui=ui,
        )
        # ev_step (domain/events.py) is the one owner of the wire shaping
        # (detail None-dropping); building both the stream chunk AND the
        # persisted record from it keeps what B1b stores byte-identical to
        # what streamed — no drift across consumers.
        data = ev_step(step).data
        self.writer({"type": "step", "data": data})
        if status != "start":
            self.step_records.append(data)


def _args_dict(part: Any) -> dict[str, Any]:
    """The tool call's args as a dict (pydantic-ai may carry them as JSON text)."""
    try:
        args = part.args_as_dict()
    except Exception:
        # Unparseable args: the step still paints (with fallback label text);
        # losing the receipt beats losing the whole timeline entry.
        logger.warning(
            "args_as_dict failed for tool %r — empty args",
            getattr(part, "tool_name", "?"),
            exc_info=True,
        )
        return {}
    return args if isinstance(args, dict) else {}
