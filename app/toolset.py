"""Per-request toolset assembly (ADR 0013).

Two parts:

1. ``build_db_tools`` — the four always-on CDS Library reader tools
   (``resolve_school``, ``get_school_profile``, ``get_facts``,
   ``query_database``), in-process over the read-only ``Catalog``/pool
   (plan §5.4/§6a/appendix F-i). Each tool body mints its own ``db``
   citation via ``app/tool_middleware.py``'s ``_normalize_db_payload`` —
   minting happens in the result pipeline, the same seam every other tool
   already uses.

2. ``build_tools`` — the per-request Tavily tools, gated by the request's
   :class:`~domain.specs.SourceConfig`. A disabled source's tool object is
   **never constructed** — unmounted, not hidden (ADR 0013); when every
   external source is off, the Tavily client factory is never even called.
   Per-run toolsets are additive to construction-time toolsets (notes §3), so
   these mount at ``agent.run(..., toolsets=...)`` time.

``write_plan`` / ``render_viz`` / ``load_skill`` / the four ``build_db_tools``
tools are appended via ``extra_tools`` by the agent node.

The counselle-db MCP child (stdio transport, ``McpSupervisor``) was retired
in school-data-v3 Phase 3 — the in-process ``build_db_tools`` below is
what the agent has actually called since the CDS Library DB rewire.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Any, cast

from pydantic_ai import Tool

from adapters import tavily_tools
from app.facts.service import absence_display
from app.sources import SourceRegistry
from app.tool_middleware import ToolMiddlewareContext, process_tool_result
from app.tool_specs import build_tool_specs, gateable_tool_names
from config.settings import load_yaml_asset
from counselle_db import service as db_service
from counselle_db.models import ResolvedSchool
from domain.events import StepDetail
from domain.facts.models import PageStatus
from domain.facts.state import fact_state
from domain.specs import SourceConfig
from domain.surface import Surface

# ---------------------------------------------------------------------------
# Deps
# ---------------------------------------------------------------------------


@dataclass
class ToolDeps:
    """What the Tavily tools need beyond the request: wired once per app.

    ``tavily_client_factory`` is called **at most once per build**, and only
    when at least one external source is enabled — so a fully-DB-only request
    never touches Tavily, not even client construction.
    """

    catalog: Any  # counselle_db.catalog.Catalog (Any: unit tests stub it)
    search_max_results: int
    subreddit_menu: list[str]  # menu subs incl. the "{school}" template slot
    tavily_client_factory: Callable[[], Any]
    # Reddit's own cap: higher than web/.edu so a discovery sweep can
    # triangulate a pattern rather than read five posts. Defaulted so existing
    # constructions (tests, direct wiring) keep working without the field.
    reddit_max_results: int = 12


def make_tool_deps(settings: Any, catalog: Any) -> ToolDeps:
    """Production wiring: settings + the subreddit-menu asset (ADR 0015/0018)."""
    from config.settings import load_yaml_asset

    menu = load_yaml_asset("subreddit_menu")
    return ToolDeps(
        catalog=catalog,
        search_max_results=settings.search_max_results,
        subreddit_menu=[entry["sub"] for entry in menu],
        tavily_client_factory=lambda: tavily_tools.make_tavily_client(settings),
        reddit_max_results=settings.reddit_max_results,
    )


# ---------------------------------------------------------------------------
# In-process CDS Library reader tools (always on, school-data-v3 §5.4/§6a)
# ---------------------------------------------------------------------------

# get_facts's row cap (plan §6a: "capped at get_facts_max_rows (60) in the
# service, before the middleware"). A module constant rather than a Settings
# field: nothing about this number is meant to be tuned per-deployment, and
# the house rule for "one place, not a literal repeated across files" is
# already satisfied — this is the only reader of it.
_GET_FACTS_MAX_ROWS = 60

#: The two metric-heavy DB tools the essay surface does not get (ADR 0037
#: Part 0 C7): the essay panel keeps school identity (``resolve_school``,
#: ``get_school_profile``) but not Common Data Set metrics. Unlike the old
#: counselle-db MCP child -- one object covering all four server-side tools,
#: which needed a ``process_tool_call`` hook to refuse two of them at
#: runtime -- these are in-process ``Tool`` objects (school-data-v3), so the
#: denial is a proper ADR 0013 unmount: the tools are simply never
#: constructed for ``Surface.ESSAY``, never a runtime error envelope.
ESSAY_SURFACE_DENIED_DB_TOOLS: frozenset[str] = frozenset({"get_facts", "query_database"})


def _make_resolve_school_tool(
    catalog: Any, middleware: ToolMiddlewareContext | None
) -> Tool[Any]:
    @db_service.tool_errors
    async def _resolve(query: str) -> dict[str, Any]:
        return (await db_service.resolve_school(catalog, query)).model_dump(mode="json")

    async def resolve_school(query: str) -> dict[str, Any]:
        """Resolve a school name, abbreviation, alias, or UNITID to one school.

        Input: ``query`` — free text or a UNITID string.

        Success returns exactly one of three ``status`` values:
        - ``match`` — one school, plus its live data block: when Counselle last confirmed
          this school's facts (``data.facts_updated_at``), how many facts it holds
          (``data.fact_count``), whether a facts page was ever collected for it
          (``data.has_collegedata``), and per-page fetch status (``data.tabs``). A school
          with ``has_collegedata: false`` has **no** facts — say "not collected" and use
          web/.edu search; never read it as "the school reports nothing". A tab whose
          status is not ``ok`` is **not fetched**, which is also not "not reported".
        - ``candidates`` — more than one campus matched; ask which campus the student
          means, then resolve again with a more specific query.
        - ``not_found`` — no school in the database matches; say so honestly and route to
          web/.edu search instead of inventing a school.

        Error returns ``error: tool_error`` with safe retry/stop guidance.

        Args:
            query: Free text school name/abbreviation/alias, or a UNITID string.
        """
        result = await _resolve(query)
        return process_tool_result(result, middleware, tool_name="resolve_school")  # type: ignore[no-any-return]

    return Tool(resolve_school, takes_ctx=False)


def _make_get_school_profile_tool(
    catalog: Any, middleware: ToolMiddlewareContext | None
) -> Tool[Any]:
    @db_service.tool_errors
    async def _profile(unitid: int, groups: list[str] | None = None) -> dict[str, Any]:
        return (await db_service.get_school_profile(catalog, unitid, groups)).model_dump(
            mode="json"
        )

    async def get_school_profile(unitid: int, groups: list[str] | None = None) -> dict[str, Any]:
        """Read a school's stable identity profile: contact, classification, and
        official links — never a current metric.

        Input: ``unitid`` (from ``resolve_school``) and optional ``groups`` — a subset of
        the group names the profile itself defines; omit to read every group. Group names
        are data-derived, never a fixed enum — an unknown group fails with the actual
        valid group list for this school; retry with one of those.

        Success returns the school and requested groups (there is no synthetic success
        status). Each row carries its ``profile_field``, ``label``, ``display`` and the
        ``marker`` to cite it with; the profile's one ``citation`` (its vintage is the
        identity snapshot date) and its ``profile_snapshot`` caveat are stated once at
        top level. It is identity data, not a current metric, and always needs that
        caveat when you state it. Error returns
        ``error: tool_error``; correct the UNITID/group from ``resolve_school`` or stop
        and say the profile field is unavailable.

        Args:
            unitid: The school's IPEDS unitid, from resolve_school.
            groups: Profile group names to read; omit for every group.
        """
        result = await _profile(unitid, groups)
        return process_tool_result(result, middleware, tool_name="get_school_profile")  # type: ignore[no-any-return]

    return Tool(get_school_profile, takes_ctx=False)


def _declared_fact_specs(catalog: Any, sections: list[str] | None) -> dict[str, Any]:
    """Every declared ``SectionFact`` keyed by its ``fact_key``, for the given
    sections (every section when ``sections`` is falsy) -- the only source
    for a key's ``tab`` when there is no DB row to read it from directly
    (school-data-v3 Phase 3's ``get_facts`` state gap)."""
    known = catalog.snapshot.sections
    section_ids = sections if sections else list(known)
    return {
        fact.key: fact
        for section_id in section_ids
        for group in known[section_id].groups
        for fact in group.facts
    }


def _make_get_facts_tool(catalog: Any, middleware: ToolMiddlewareContext | None) -> Tool[Any]:
    @db_service.tool_errors
    async def _facts(
        unitid: int | None,
        school: str | None,
        sections: list[str] | None = None,
        keys: list[str] | None = None,
    ) -> dict[str, Any]:
        if unitid is not None and school:
            raise db_service.ServiceError("Pass the school's unitid or its name, not both.")
        if unitid is None:
            # A school name resolves here exactly as `resolve_school` would, so a
            # first read costs one round instead of two. Anything but one match
            # (several campuses, not found) comes back as that resolve result.
            if not school:
                raise db_service.ServiceError("Pass the school's unitid or its name.")
            resolved = await db_service.resolve_school(catalog, school)
            if not isinstance(resolved, ResolvedSchool):
                return resolved.model_dump(mode="json")
            unitid = resolved.school.unitid
        payload = (
            await db_service.get_facts(catalog, unitid, sections=sections, keys=keys)
        ).model_dump(mode="json")
        present_rows = [dict(row, state="value") for row in payload["rows"]]
        present_keys = {row["fact_key"] for row in present_rows}
        status = payload["status"]
        has_collegedata = status["has_collegedata"]
        tabs: dict[str, str] = status["tabs"]

        # Narrowed calls (sections or keys) can resolve a state for every
        # *requested* key, present or not -- reusing `domain.facts.state`'s
        # `fact_state` (the presenter's own honesty-critical rule, plan
        # §5.1) plus `app.facts.service.absence_display` for the matching
        # word, so the four unavailable states never grow a second
        # vocabulary. An unnarrowed call keeps the old value-only shape
        # (declaring absence for the whole catalog would dwarf the cap).
        unavailable: list[dict[str, Any]] = []
        if sections:
            specs = _declared_fact_specs(catalog, sections)
            requested_keys = list(specs)
        elif keys:
            specs = _declared_fact_specs(catalog, None)
            requested_keys = keys
        else:
            specs = {}
            requested_keys = None
        if requested_keys is not None:
            for key in requested_keys:
                if key in present_keys:
                    continue
                spec = specs.get(key)
                tab = spec.tab if spec is not None else None
                # An undeclared key (reachable only via `keys=`; a handful of
                # facts sit outside facts_sections.yaml, e.g. identity.address)
                # has no tab to check -- treat its page as checked-and-ok, the
                # least presumptive default, rather than guessing a fetch failure.
                page_status = cast(PageStatus, tabs.get(tab, "ok") if tab else "ok")
                state = fact_state(False, None, page_status, has_collegedata)
                unavailable.append(
                    {
                        "fact_key": key,
                        "label": spec.label if spec is not None else key,
                        "tab": tab,
                        "state": state,
                        "display": absence_display(state, page_status),
                    }
                )

        combined_total = len(present_rows) + len(unavailable)
        truncated = combined_total > _GET_FACTS_MAX_ROWS
        if truncated:
            # Value rows first -- they carry real data, so they fill the
            # budget before absence entries do.
            rows = present_rows[:_GET_FACTS_MAX_ROWS]
            unavailable = unavailable[: _GET_FACTS_MAX_ROWS - len(rows)]
        else:
            rows = present_rows
        payload["rows"] = rows
        payload["unavailable"] = unavailable
        payload["truncated"] = truncated
        if truncated:
            payload["sections"] = sorted(catalog.snapshot.sections)
        return payload

    async def get_facts(
        unitid: int | None = None,
        school: str | None = None,
        sections: list[str] | None = None,
        keys: list[str] | None = None,
    ) -> dict[str, Any]:
        """Read Counselle's stored facts for one school — the only fact read path.

        Input: the school, as ``unitid`` (from ``resolve_school``) or as its
        ``school`` name — a name is resolved here exactly as ``resolve_school``
        would, so you can read a named school's facts in the first round without
        resolving it separately. A name matching several campuses or none
        returns that ``resolve_school``-style result (``status: candidates`` or
        ``not_found``) instead of facts; a match returns the facts, with the
        resolved school in ``school`` — state the campus if the name could mean
        another. Then **at most one** narrowing
        argument. ``sections`` — one or more of this school's six sections
        (``getting-in``, ``money``, ``academics``, ``campus-life``, ``outcomes``,
        ``applying``); each section already includes its own ``other`` group of
        facts that don't fit its named groups, so narrowing by section returns
        those too. ``keys`` — exact ``<domain>.<name>`` fact keys (this is also
        the only way to reach the handful of facts declared outside those six
        sections, e.g. ``identity.address``). Omit both to read every fact this
        school has a reported value for.

        Narrowing by ``sections`` or ``keys`` resolves a **state** for every
        requested key, not just the ones with a value: ``rows`` holds facts this
        school has a reported value for; ``unavailable`` holds every other
        requested key with the reason it has no value —
        ``not_reported`` (the page was checked and this key was blank),
        ``not_fetched`` (we could not read this key's page on the last check,
        or have never checked it), ``not_published`` (this school's site does
        not have this page at all), or ``not_collected`` (no CollegeData crawl
        exists for this school at all — check ``resolve_school``'s
        ``data.has_collegedata`` first). **Never say "not in our database" for
        a school that resolved** — say which of these four it is. An unnarrowed
        call returns only ``rows``; a key that's missing from it is not
        necessarily absent by the school's own choice — narrow by ``sections``
        or ``keys`` to get its real state instead of guessing.

        ``rows`` and ``unavailable`` share one budget, capped at 60 total
        (``truncated: true`` means narrow further and call again); ``rows``
        fills the budget first since it carries real data.

        Each ``rows`` entry carries its ``fact_key``, ``label``, a preformatted
        ``display``, a code-owned ``vintage`` naming the reporting period it
        covers (or that the period is unstated) and when it was checked, and
        the ``marker`` to cite it with. **Copy ``display`` and ``vintage``
        verbatim** — never reformat a number and
        never merge two facts' vintages into one shared period. Each
        ``unavailable`` entry carries its own ``display`` (the exact absence
        word for its ``state``) — copy it verbatim too, never invent a
        different absence phrase.

        An unknown section or key fails with the valid list for this school; retry
        with one of those. A school with no facts returns zero rows and a null
        ``status.facts_updated_at`` — say the data is not collected and fall back to
        official web/.edu search.

        Error returns ``error: tool_error``; correct the unitid/section/key or stop
        rather than inventing a value.

        Args:
            unitid: The school's IPEDS unitid, from resolve_school.
            school: The school's name, when you have no unitid yet.
            sections: Section ids to read; omit with keys for every fact.
            keys: Exact fact keys to read; omit with sections for every fact.
        """
        result = await _facts(unitid, school, sections, keys)
        return process_tool_result(result, middleware, tool_name="get_facts")  # type: ignore[no-any-return]

    return Tool(get_facts, takes_ctx=False)


def _make_query_database_tool(
    catalog: Any, middleware: ToolMiddlewareContext | None
) -> Tool[Any]:
    @db_service.tool_errors
    async def _query(sql: str, params: list[Any] | None = None) -> dict[str, Any]:
        return (await db_service.query_database(catalog, sql, params)).model_dump(mode="json")

    async def query_database(sql: str, params: list[Any] | None = None) -> dict[str, Any]:
        """Run one guarded, read-only SQL read over the five reader views, for a
        shape no typed tool covers: cross-school candidate selection, aggregates, or
        coverage detail.

        Input: ``sql`` — a single parameterized ``SELECT``/``WITH`` using ``$1..$n``
        placeholders only — and optional ``params``. Bind every fact key as a
        parameter, never inline it: bound keys are how the result gets its coverage
        denominators.

        Success returns ``columns``, ``rows``, ``row_count``, ``truncated``,
        ``as_of``, and ``coverage`` — for each fact key the query named, how many
        schools have a value for it out of how many profiles. Rows are raw and
        bypass the typed reading rules and citations entirely: **never present a raw
        row as a cited student-facing value.** Re-fetch any named final value through
        ``get_facts``/``get_school_profile`` before stating it, and state the
        covered/total denominator on any aggregate or ranking. If ``coverage`` is
        empty on an aggregate, you do not have a denominator — name the fact key as a
        bound parameter and re-run, or state the number without a population claim.

        Error returns ``error: tool_error``; rewrite the query rather than retry it
        verbatim.

        Args:
            sql: A single parameterized SELECT/WITH statement using $1..$n.
            params: Bound parameter values, in placeholder order.
        """
        result = await _query(sql, params)
        return process_tool_result(result, middleware, tool_name="query_database")  # type: ignore[no-any-return]

    return Tool(query_database, takes_ctx=False)


def build_db_tools(
    catalog: Any,
    middleware: ToolMiddlewareContext | None = None,
    *,
    surface: Surface = Surface.CHAT,
) -> list[Tool[Any]]:
    """The always-on CDS Library reader tools, in-process over ``catalog``.

    Unconditional on the chat surface — the DB is never optional (ADR 0032);
    unlike ``build_tools``' source-gated tools, these mount on every request.

    On :attr:`~domain.surface.Surface.ESSAY` the tools named in
    ``ESSAY_SURFACE_DENIED_DB_TOOLS`` are not constructed at all (ADR 0013:
    unmounted, not hidden) — the essay panel keeps school identity but not
    Common Data Set metrics (ADR 0037 Part 0 C7).
    """
    tools = [
        _make_resolve_school_tool(catalog, middleware),
        _make_get_school_profile_tool(catalog, middleware),
    ]
    if surface is not Surface.ESSAY:
        tools.append(_make_get_facts_tool(catalog, middleware))
        tools.append(_make_query_database_tool(catalog, middleware))
    return tools


# ---------------------------------------------------------------------------
# Per-request Tavily tools (source-config gated, ADR 0013)
# ---------------------------------------------------------------------------


#: The source-gated tool names (ADR 0013). A disabled source's tool is never
#: mounted — and a hallucinated call to it must never paint a timeline step
#: (story 17): the emission router suppresses calls to gateable-but-unmounted
#: tools, because no search happened.
def _empty_receipt(
    _tool_name: str, _args: dict[str, Any], _content: Any, _duration_ms: int, _context: Any
) -> StepDetail:
    return StepDetail()


GATEABLE_TOOLS: frozenset[str] = gateable_tool_names(
    build_tool_specs(load_yaml_asset("step_labels"), _empty_receipt)
)


def build_tools(
    source_config: SourceConfig,
    deps: ToolDeps,
    registry: SourceRegistry,
    today: date,
    extra_tools: Sequence[Tool[Any]] | None = None,
    tool_overflow: ToolMiddlewareContext | None = None,
) -> list[Tool[Any]]:
    """Assemble the per-request function tools from the source config.

    A disabled source's tool is never constructed. ``extra_tools``
    (write_plan, render_viz, load_skill — wired by the agent node) are
    appended as-is.
    """
    middleware = tool_overflow or ToolMiddlewareContext(registry=registry)
    tools: list[Tool[Any]] = []
    any_external = source_config.web or source_config.edu or source_config.reddit
    client = deps.tavily_client_factory() if any_external else None
    if source_config.web:
        # Reddit off must mean NO reddit content anywhere — including via the
        # open web search (gating in code, not prompt; ADR 0013).
        excludes = None if source_config.reddit else list(tavily_tools.REDDIT_DOMAINS)
        tools.append(_make_search_web(client, today, deps.search_max_results, excludes, middleware))
    if source_config.edu and getattr(deps.catalog, "school_count", 0) > 0:
        tools.append(
            _make_search_school_site(
                client, deps.catalog, today, deps.search_max_results, middleware
            )
        )
    if source_config.reddit:
        allowed = _allowed_subreddits(deps.subreddit_menu, source_config.reddit_subreddits)
        tools.append(
            _make_search_reddit(client, today, deps.reddit_max_results, allowed, middleware)
        )
    tools.extend(extra_tools or [])
    return tools


def _allowed_subreddits(menu: list[str], requested: list[str] | None) -> list[str]:
    """The effective allowlist: the menu, filtered to the request's enabled subs.

    ``None`` = the full menu (incl. the ``{school}`` slot). When the request
    names specific subs, everything else — including the ``{school}`` slot —
    is off the menu: the allowlist is enforced in code, not prompt (ADR 0013).
    """
    if requested is None:
        return list(menu)
    wanted = {sub.lower() for sub in requested}
    return [sub for sub in menu if sub.lower() in wanted]


def _make_search_web(
    client: Any,
    today: date,
    max_results: int,
    exclude_domains: list[str] | None = None,
    middleware: ToolMiddlewareContext | None = None,
) -> Tool[Any]:
    async def search_web(query: str) -> dict[str, Any]:
        """Search the live web (no domain filter) for current information.

        Use for live-cycle questions or anything past the database's data
        calendar cutoff. Results carry citation markers like "[3]" — cite by
        writing those exact markers next to the facts they support.

        Args:
            query: The web search query.
        """
        payload = await tavily_tools.search_web(
            client, query, today=today, max_results=max_results, exclude_domains=exclude_domains
        )
        return process_tool_result(payload, middleware, tool_name="search_web")  # type: ignore[no-any-return]

    return Tool(search_web, takes_ctx=False)


def _make_search_school_site(
    client: Any,
    catalog: Any,
    today: date,
    max_results: int,
    middleware: ToolMiddlewareContext | None = None,
) -> Tool[Any]:
    async def search_school_site(unitid: int, query: str) -> dict[str, Any]:
        """Search a school's own official website (its .edu domain).

        The school's domain is resolved from the database automatically — pass
        the school's unitid. Results are official-tier and carry citation
        markers like "[3]"; cite by repeating the markers you were given.

        Args:
            unitid: The school's IPEDS unitid (from resolve_school).
            query: What to look for on the school's site.
        """
        payload = await tavily_tools.search_school_site(
            client, catalog, unitid, query, today=today, max_results=max_results
        )
        return process_tool_result(payload, middleware, tool_name="search_school_site")  # type: ignore[no-any-return]

    return Tool(search_school_site, takes_ctx=False)


def _make_search_reddit(
    client: Any,
    today: date,
    max_results: int,
    allowed: list[str],
    middleware: ToolMiddlewareContext | None = None,
) -> Tool[Any]:
    async def search_reddit(query: str, subreddits: list[str]) -> dict[str, Any]:
        """Search Reddit for community sentiment — lived experience, never verified fact.

        Pick subreddits from the menu you were given; out-of-menu subs are
        rejected. Results are community-tier with citation markers like "[3]";
        always present them as student opinion, not data.

        Args:
            query: The Reddit search query.
            subreddits: Subreddit names (no "r/" prefix) from the allowed menu.
        """
        payload = await tavily_tools.search_reddit(
            client, query, subreddits, allowed=allowed, today=today, max_results=max_results
        )
        return process_tool_result(payload, middleware, tool_name="search_reddit")  # type: ignore[no-any-return]

    return Tool(search_reddit, takes_ctx=False)
