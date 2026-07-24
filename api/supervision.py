"""MCP child supervision for the API process (eng-review D4).

The supervision model, grounded in how Phase 4 actually runs the child:

- ``build_runtime`` constructs ONE ``MCPToolset`` over fastmcp's
  ``StdioTransport`` (``app/toolset.py``); the agent node mounts that same
  object every turn and enters it for the duration of the run
  (``async with agent`` in ``app/agent_node.py``).
- fastmcp's ``StdioTransport`` defaults to ``keep_alive=True``: the child
  process persists across turns, and — the load-bearing fact — its
  ``connect()`` detects a dead session (finished connect task / closed stdio
  streams), tears it down, and **respawns the child on the next entry**.
  Auto-restart is intrinsic to the transport; we do not reimplement it.
- A dead child can never hang a turn: ``read_timeout=30s`` bounds every tool
  call (``app/toolset.py``), and a closed pipe raises promptly. The failing
  turn surfaces a clean tool/turn error; the NEXT entry (next turn or next
  probe) gets a fresh child.

What is left for the supervisor — and what this module implements — is
**health visibility + prompt recovery**: a background task periodically enters
the toolset and pings the child. Entering IS the restart mechanism (above), so
a failed probe → status ``restarting`` and re-probe with exponential backoff
(1s → 30s cap); ``failed_after`` consecutive failures → status ``failed``
(still retrying at the cap; a later success returns to ``ok``). ``kick()``
wakes the prober early — the reactive hook for a tool-call failure mid-turn.
``status()`` feeds the ``mcp:`` block of ``/v1/health`` (Slice B).
"""

from __future__ import annotations

import asyncio
import contextlib
from datetime import UTC, datetime
from typing import Any, Literal

import structlog

logger = structlog.get_logger(__name__)

McpStatus = Literal["ok", "restarting", "failed"]

#: Seconds between probes while the child is healthy.
PROBE_INTERVAL_S = 60.0
#: First-retry delay after a failed probe (doubles per failure).
BACKOFF_BASE_S = 1.0
#: Retry-delay ceiling (D4: 1s → 30s cap).
BACKOFF_CAP_S = 30.0
#: Consecutive failures before "restarting" escalates to "failed" —
#: 1+2+4+8+16 ≈ 30s of backoff (the cap) has elapsed by then.
FAILED_AFTER = 5


def backoff_delay(
    consecutive_failures: int, base_s: float = BACKOFF_BASE_S, cap_s: float = BACKOFF_CAP_S
) -> float:
    """Exponential backoff: ``base * 2**(n-1)``, capped (1, 2, 4, 8, 16, 30 ... by default)."""
    if consecutive_failures < 1:
        raise ValueError("consecutive_failures must be >= 1")
    return min(base_s * (1 << (consecutive_failures - 1)), cap_s)


class McpSupervisor:
    """Owns the counselle-db MCP child's health for the API process (D4).

    ``toolset`` is the shared ``MCPToolset`` from ``build_runtime`` — the very
    object every turn mounts, so the prober heals the same child turns use.
    Status starts at ``restarting`` ("not yet verified"); the first probe runs
    immediately on :meth:`start` and spawns the child at boot.
    """

    def __init__(
        self,
        toolset: Any,
        *,
        probe_interval_s: float = PROBE_INTERVAL_S,
        backoff_base_s: float = BACKOFF_BASE_S,
        backoff_cap_s: float = BACKOFF_CAP_S,
        failed_after: int = FAILED_AFTER,
    ) -> None:
        self._toolset = toolset
        self._probe_interval_s = probe_interval_s
        self._backoff_base_s = backoff_base_s
        self._backoff_cap_s = backoff_cap_s
        self._failed_after = failed_after
        self._status: McpStatus = "restarting"
        self._consecutive_failures = 0
        self._restarts = 0
        self._last_probe_at: datetime | None = None
        self._last_error: str | None = None
        self._wake = asyncio.Event()
        self._task: asyncio.Task[None] | None = None

    def start(self) -> None:
        """Spawn the supervisor task (probes immediately — boots the child)."""
        self._task = asyncio.create_task(self._run(), name="mcp-supervisor")

    async def aclose(self) -> None:
        """Cancel the supervisor task and close the MCP client (kills the keep-alive child)."""
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        close = getattr(getattr(self._toolset, "client", None), "close", None)
        if close is not None:
            try:
                await close()
            except Exception as exc:
                logger.debug("mcp client close error", error=str(exc))

    def kick(self) -> None:
        """Wake the prober now — call after an in-flight tool call hit a dead child."""
        self._wake.set()

    def status(self) -> dict[str, Any]:
        """The health surface for ``/v1/health`` (``mcp: ok | restarting | failed``)."""
        return {
            "status": self._status,
            "consecutive_failures": self._consecutive_failures,
            "restarts": self._restarts,
            "last_probe_at": (
                self._last_probe_at.isoformat() if self._last_probe_at is not None else None
            ),
            "last_error": self._last_error,
        }

    async def probe_once(self) -> McpStatus:
        """One probe: enter the toolset (spawns/heals the child) and ping it; record."""
        self._last_probe_at = datetime.now(UTC)
        try:
            async with self._toolset:
                await self._toolset.client.ping()
        except Exception as exc:
            self._record_failure(exc)
        else:
            self._record_success()
        return self._status

    async def _run(self) -> None:
        while True:
            self._wake.clear()
            status = await self.probe_once()
            if status == "ok":
                delay = self._probe_interval_s
            else:
                delay = backoff_delay(
                    self._consecutive_failures, self._backoff_base_s, self._backoff_cap_s
                )
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wake.wait(), timeout=delay)

    def _record_failure(self, exc: Exception) -> None:
        self._consecutive_failures += 1
        # Surface only the exception class name to the health endpoint; the full
        # message may contain internal hosts/ports — log it server-side only.
        self._last_error = type(exc).__name__
        escalated = self._consecutive_failures >= self._failed_after
        self._status = "failed" if escalated else "restarting"
        logger.warning(
            "mcp_child_probe_failed",
            status=self._status,
            consecutive_failures=self._consecutive_failures,
            error=repr(exc),
        )

    def _record_success(self) -> None:
        if self._consecutive_failures > 0:
            self._restarts += 1
            logger.info("mcp_child_recovered", restarts=self._restarts)
        self._consecutive_failures = 0
        self._last_error = None
        self._status = "ok"


class NoopMcpSupervisor:
    """Supervisor used when the temporary demo intentionally disables CDS tools."""

    def start(self) -> None:
        return None

    async def aclose(self) -> None:
        return None

    def kick(self) -> None:
        return None

    def status(self) -> dict[str, Any]:
        return {
            "status": "ok",
            "mode": "disabled",
            "consecutive_failures": 0,
            "restarts": 0,
            "last_probe_at": None,
            "last_error": None,
        }
