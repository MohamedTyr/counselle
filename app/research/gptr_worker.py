"""Subprocess entrypoint for the bounded GPT-Researcher helper."""

from __future__ import annotations

import asyncio
import contextlib
import json
import sys
from datetime import date
from types import SimpleNamespace
from typing import Any

from app.research.gptr_adapter import _gather_via_gptr_direct
from domain.specs import SourceConfig


async def _run(payload: dict[str, Any]) -> dict[str, Any]:
    settings = SimpleNamespace(**payload["settings"])
    return await _gather_via_gptr_direct(
        str(payload["query"]),
        SourceConfig.model_validate(payload["source_config"]),
        settings,
        domains=[str(domain) for domain in payload.get("domains") or []],
        today=date.fromisoformat(str(payload["today"])),
    )


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read())
        with contextlib.redirect_stdout(sys.stderr):
            result = asyncio.run(_run(payload))
    except Exception as exc:
        result = {"results": [], "cost_usd": None, "unavailable": type(exc).__name__}
    print(json.dumps(result))


if __name__ == "__main__":
    main()
