"""Per-request toolset assembly (ADR 0013) + the counselle-db MCP client wiring.

Two halves:

1. ``build_mcp_toolset`` — the always-on counselle-db MCP server, mounted at
   ``Agent(...)`` construction (notes-p4-apis §2: ``MCPServerStdio`` is
   deprecated in pydantic-ai 1.107 → ``MCPToolset`` over fastmcp's
   ``StdioTransport``). Its results are routed through the source registry via
   the ``process_tool_call`` hook (``pydantic_ai/mcp.py:2138``); the registry
   rides ``ctx.deps`` per run — never a module global (notes §7: interrupt
   resume re-executes the node, so per-turn accumulation must rebuild from
   graph state).

2. ``build_tools`` — the per-request Tavily tools, gated by the request's
   :class:`~domain.specs.SourceConfig`. A disabled source's tool object is
   **never constructed** — unmounted, not hidden (ADR 0013); when every
   external source is off, the Tavily client factory is never even called.
   Per-run toolsets are additive to construction-time toolsets (notes §3), so
   these mount at ``agent.run(..., toolsets=...)`` time.

``render_viz`` / ``ask_student`` / ``load_skill`` are Slice D/E — appended via
``extra_tools`` by Slice F.
"""

from __future__ import annotations

import os
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

from fastmcp.client.transports import StdioTransport
from pydantic_ai import RunContext, Tool
from pydantic_ai.mcp import CallToolFunc, MCPToolset, ToolResult

from adapters import tavily_tools
from app.sources import SourceRegistry
from domain.specs import SourceConfig

_REPO_ROOT = Path(__file__).resolve().parent.parent


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


def make_tool_deps(settings: Any, catalog: Any) -> ToolDeps:
    """Production wiring: settings + the subreddit-menu asset (ADR 0015/0018)."""
    from config.settings import load_yaml_asset

    menu = load_yaml_asset("subreddit_menu")
    return ToolDeps(
        catalog=catalog,
        search_max_results=settings.search_max_results,
        subreddit_menu=[entry["sub"] for entry in menu],
        tavily_client_factory=lambda: tavily_tools.make_tavily_client(settings),
    )


# ---------------------------------------------------------------------------
# The counselle-db MCP toolset (always on)
# ---------------------------------------------------------------------------


async def annotate_mcp_result(
    ctx: RunContext[Any], call_tool: CallToolFunc, name: str, args: dict[str, Any]
) -> ToolResult:
    """``process_tool_call`` hook: route every counselle-db result through the registry.

    The registry comes from ``ctx.deps.registry`` — per-run deps rebuilt from
    graph state each node execution (notes §7), never captured in this
    module-level closure. Runs without a registry on deps (or with non-dict
    results) pass through untouched.
    """
    result = await call_tool(name, args)
    registry = getattr(ctx.deps, "registry", None)
    if isinstance(registry, SourceRegistry):
        return registry.annotate_envelopes(result)  # type: ignore[no-any-return]
    return result


# Bound the MCP child's long-lived stdio connection — a dead child would
# otherwise hang tool calls forever (read_timeout_seconds=None by default).
# 30 s is generous for any single DB-backed tool call; change only if a
# tool starts timing out legitimately in production.
_MCP_READ_TIMEOUT_SECONDS: float = 30.0

# Explicit allowlist of env vars forwarded to the counselle-db MCP child.
# NEVER forward the Tavily key — the MCP child is read-only DB-only code
# and should not have access to external search credentials.
_MCP_ENV_ALLOWLIST: frozenset[str] = frozenset(
    {
        # Database connection strings (required)
        "COUNSELLE_DB_RO_DSN",
        "COUNSELLE_DB_APP_DSN",
        # DB connection pool / statement-timeout tuning (optional)
        "COUNSELLE_DB_POOL_MIN",
        "COUNSELLE_DB_POOL_MAX",
        "COUNSELLE_DB_STATEMENT_TIMEOUT_MS",
        # Vertex / GCP credentials needed for embedding (reconciler)
        "COUNSELLE_VERTEX_PROJECT",
        "COUNSELLE_VERTEX_LOCATION",
        "GOOGLE_APPLICATION_CREDENTIALS",
        # Embedding / vector-search / reconciler flags
        "COUNSELLE_EMBED_MODEL",
        "COUNSELLE_RECONCILE_ON_STARTUP",
        "COUNSELLE_VECTOR_SEARCH_LIMIT",
        # Log level for the child process
        "COUNSELLE_LOG_LEVEL",
    }
)


def build_mcp_toolset(settings: Any) -> MCPToolset:
    """The counselle-db MCP server as a stdio child (notes §2; all 10 tools).

    The child receives only the explicit ``_MCP_ENV_ALLOWLIST`` variables — it
    must NOT receive the Tavily key or other credentials unrelated to DB access.
    DSN overrides from the .env-loaded settings are always injected.

    ``read_timeout`` is bounded to ``_MCP_READ_TIMEOUT_SECONDS`` so a dead
    child process does not hang the caller forever.
    """
    env: dict[str, str] = {
        key: value for key, value in os.environ.items() if key in _MCP_ENV_ALLOWLIST
    }
    # Settings-driven DSN overrides always win (may differ from raw env).
    env["COUNSELLE_DB_RO_DSN"] = settings.db_ro_dsn
    env["COUNSELLE_DB_APP_DSN"] = settings.db_app_dsn
    return MCPToolset(
        StdioTransport(
            command="uv",
            args=["run", "python", "-m", "counselle_db.server"],
            env=env,
            cwd=str(_REPO_ROOT),
        ),
        id="counselle-db",
        process_tool_call=annotate_mcp_result,
        read_timeout=_MCP_READ_TIMEOUT_SECONDS,
    )


# ---------------------------------------------------------------------------
# Per-request Tavily tools (source-config gated, ADR 0013)
# ---------------------------------------------------------------------------


def build_tools(
    source_config: SourceConfig,
    deps: ToolDeps,
    registry: SourceRegistry,
    today: date,
    extra_tools: Sequence[Tool[Any]] | None = None,
) -> list[Tool[Any]]:
    """Assemble the per-request function tools from the source config.

    A disabled source's tool is never constructed. ``extra_tools`` (render_viz,
    ask_student, load_skill — Slices D/E, wired by Slice F) are appended as-is.
    """
    tools: list[Tool[Any]] = []
    any_external = source_config.web or source_config.edu or source_config.reddit
    client = deps.tavily_client_factory() if any_external else None
    if source_config.web:
        # Reddit off must mean NO reddit content anywhere — including via the
        # open web search (gating in code, not prompt; ADR 0013).
        excludes = None if source_config.reddit else ["reddit.com"]
        tools.append(_make_search_web(client, registry, today, deps.search_max_results, excludes))
    if source_config.edu:
        tools.append(
            _make_search_school_site(client, deps.catalog, registry, today, deps.search_max_results)
        )
    if source_config.reddit:
        allowed = _allowed_subreddits(deps.subreddit_menu, source_config.reddit_subreddits)
        tools.append(_make_search_reddit(client, registry, today, deps.search_max_results, allowed))
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
    registry: SourceRegistry,
    today: date,
    max_results: int,
    exclude_domains: list[str] | None = None,
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
        return registry.annotate_search_results(payload)  # type: ignore[no-any-return]

    return Tool(search_web, takes_ctx=False)


def _make_search_school_site(
    client: Any, catalog: Any, registry: SourceRegistry, today: date, max_results: int
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
        return registry.annotate_search_results(payload)  # type: ignore[no-any-return]

    return Tool(search_school_site, takes_ctx=False)


def _make_search_reddit(
    client: Any, registry: SourceRegistry, today: date, max_results: int, allowed: list[str]
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
        return registry.annotate_search_results(payload)  # type: ignore[no-any-return]

    return Tool(search_reddit, takes_ctx=False)
