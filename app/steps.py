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
  3. **Thinking routing** (B0 spike 2): a per-model-response text buffer with
     ``PartEndEvent.next_part_kind`` as the deterministic flush signal —
     under-threshold text ending at a tool call flushes as ``thinking``;
     crossing the threshold flushes as ``delta`` and streams live thereafter.
     Native Gemini thought summaries (``ThinkingPart``) are a second
     ``thinking`` feed, emitted per completed paragraph.

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

from domain.events import StepData, StepDetail, StepKind, StepSource, StepTier, ev_step
from domain.urls import favicon_url, registrable_domain

logger = logging.getLogger(__name__)

#: Chars of buffered response text below which pre-tool-call text is routed to
#: ``thinking`` (B0 spike 2 — measured latency cost ≈ 0 at Gemini chunk sizes).
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
        row = self._tools.get(tool_name) or self._default
        return cast("StepKind", row.get("kind", "db_tool"))

    def map_call(self, tool_name: str, args: dict[str, Any]) -> MappedStep:
        # The label keeps its own row lookup (the _unknown marker rides the label
        # path); the kind routes through _kind_for so the default lives once. The
        # _unknown row is {**self._default, ...}, so its .get("kind", "db_tool")
        # resolves identically to _kind_for(tool_name).
        row = self._tools.get(tool_name) or {**self._default, "_unknown": True}
        label_args = self._label_args(tool_name, args)
        label = str(row.get("label", "Working")).format_map(_SafeDict(label_args))
        return MappedStep(kind=self._kind_for(tool_name), tier=row.get("tier"), label=label)

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
        """Result-shape error detection: RetryPromptPart or an ``{"error": …}`` dict."""
        if isinstance(result_part, RetryPromptPart):
            return True
        return isinstance(content, dict) and "error" in content

    def detail_for(
        self, tool_name: str, args: dict[str, Any], content: Any, duration_ms: int
    ) -> StepDetail:
        """The expandable receipt for a step's ``end``/``error`` event.

        Built as kwargs per kind and constructed once — pydantic validates on
        construction, so no field is ever set behind validation's back (house
        immutability rule).
        """
        kind: StepKind = self._kind_for(tool_name)
        kwargs: dict[str, Any] = {"duration_ms": duration_ms}
        if kind in ("web_search", "edu_search", "reddit_search"):
            kwargs["query"] = _str_or_none(args.get("query"))
            results = content.get("results") if isinstance(content, dict) else None
            if isinstance(results, list):
                kwargs["result_count"] = len(results)
                kwargs["domains"] = _domains_of(results)
            elif isinstance(content, dict) and "error" not in content:
                # Success-but-no-results (shape drift): show "0 results" explicitly
                # rather than omit the count — a completed search that found nothing
                # must say so (honesty). Errored searches keep status:error / no count.
                kwargs["result_count"] = 0
        elif kind == "sql":
            kwargs["query"] = _str_or_none(args.get("sql"))
            kwargs["row_count"] = _row_count_of(content)
            kwargs["tool"] = tool_name
        elif kind == "viz":
            kwargs["viz_type"] = _str_or_none(args.get("type"))
            kwargs["schools"] = self._school_names(args)
        else:  # db_tool, skill, unknown
            kwargs.update(self._db_tool_detail_kwargs(tool_name, args, content))
        return StepDetail(**kwargs)

    def _db_tool_detail_kwargs(
        self, tool_name: str, args: dict[str, Any], content: Any
    ) -> dict[str, Any]:
        """The db_tool/skill/unknown receipt fields (split out of detail_for)."""
        kwargs: dict[str, Any] = {
            "tool": tool_name,
            "query": _str_or_none(args.get("query") or args.get("name")),
            "row_count": _row_count_of(content),
        }
        keys = args.get("field_keys")
        if isinstance(keys, list) and keys:
            kwargs["field_keys"] = [str(key) for key in keys]
        schools = self._school_names(args)
        if schools:
            kwargs["schools"] = schools
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
            "field": _humanize(str(args.get("field_key", "")).rsplit(".", 1)[-1]) or "the field",
            "school": names[0] if names else school_fallback,
            "schools": _join_names(names) if names else "schools",
            "subreddits": _join_names([f"r/{sub}" for sub in subs])
            if isinstance(subs, list) and subs
            else "Reddit",
            "category": self._category_of(args),
            "viz_label": self._viz_labels.get(viz_type, "visualization"),
        }

    @staticmethod
    def _school_unitids(args: dict[str, Any]) -> list[int]:
        if isinstance(args.get("unitid"), int):
            return [args["unitid"]]
        if isinstance(args.get("unitids"), list):
            return [u for u in args["unitids"] if isinstance(u, int)]
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
            return self._search_sources(kind, content)
        if kind in ("db_tool", "sql", "viz"):
            return self._school_sources(args)
        return None

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

    def _school_sources(self, args: dict[str, Any]) -> list[StepSource] | None:
        out: list[StepSource] = []
        for unitid in self._school_unitids(args):
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
        keys = args.get("field_keys")
        if not isinstance(keys, list) or not keys:
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


def _str_or_none(value: Any) -> str | None:
    text = str(value).strip() if value is not None else ""
    return text or None


def _row_count_of(content: Any) -> int | None:
    if isinstance(content, list):
        return len(content)
    if isinstance(content, dict) and isinstance(content.get("rows"), list):
        return len(content["rows"])
    return None


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
    """pydantic-ai stream events → ``delta``/``thinking``/``step`` writer chunks.

    After the run, ``step_records`` holds every step's final state and
    ``thinking_lines`` every thinking line — B1b persists them in the turn
    record; B1a only streams.
    """

    writer: Callable[[dict[str, Any]], None]
    mapper: StepMapper
    threshold: int = THINKING_THRESHOLD_CHARS
    #: Source-gated tool names NOT mounted this turn (story 17): a hallucinated
    #: call to one must paint no step — no search happened; the model's
    #: tool-not-found retry is internal noise, not student-visible work.
    unmounted: frozenset[str] = frozenset()

    step_records: list[dict[str, Any]] = field(default_factory=list)
    thinking_lines: list[str] = field(default_factory=list)

    _open: dict[str, _OpenStep] = field(default_factory=dict)
    _counter: int = 0
    _text_buf: str = ""
    _live: bool = False
    _thinking_buf: str = ""
    _closed: bool = False

    # -- the one entry point ------------------------------------------------

    def handle(self, event: Any) -> None:
        if self._closed:
            return  # late events must never write to a closed stream
        if isinstance(event, PartStartEvent):
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
            if getattr(event, "next_part_kind", None) is None:
                # Model response over: the thinking threshold is per response,
                # so the next response's text must be re-buffered, not streamed
                # live just because the prior one crossed the threshold.
                self._live = False
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
            # End of the run: whatever is buffered is final-answer prose.
            self.writer({"type": "delta", "text": self._text_buf})
            self._text_buf = ""
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

    def _feed_text(self, text: str) -> None:
        if not text:
            return
        if self._live:
            self.writer({"type": "delta", "text": text})
            return
        self._text_buf += text
        if len(self._text_buf) >= self.threshold:
            self.writer({"type": "delta", "text": self._text_buf})
            self._text_buf = ""
            self._live = True

    def _end_text_part(self, next_part_kind: Any) -> None:
        if self._live or not self._text_buf:
            return
        if next_part_kind == "text":
            return  # a continuation text part follows — keep buffering
        if next_part_kind is None:
            # Response over: the held text is (the start of) the answer.
            self.writer({"type": "delta", "text": self._text_buf})
        else:
            # 'tool-call', 'thinking', 'builtin-tool-call', 'file', any future
            # kind: the model moved on to non-text work before answering, so
            # under-threshold text here is narration — same semantics as a
            # tool call. Defaulting unknown kinds to thinking beats defaulting
            # to delta: a wrongly-streamed half-thought would lie to a student.
            self._emit_thinking(self._text_buf)
        self._text_buf = ""

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

    # -- steps ----------------------------------------------------------------

    def _start_step(self, event: FunctionToolCallEvent) -> None:
        # A new tool batch means the prior model response is over.
        self._live = False
        if self._text_buf:
            # Safety net: pending under-threshold text before a step is narration.
            self._emit_thinking(self._text_buf)
            self._text_buf = ""
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
        self._emit_step(
            open_step.step_id,
            "error" if errored else "end",
            open_step.mapped,
            label=self.mapper.error_label(open_step.mapped, retry=retry)
            if errored
            else open_step.mapped.label,
            detail=detail,
            sources=sources,
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
    ) -> None:
        step = StepData(
            step_id=step_id,
            status=status,
            kind=mapped.kind,
            label=label,
            tier=mapped.tier,
            detail=detail,
            sources=sources,
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
