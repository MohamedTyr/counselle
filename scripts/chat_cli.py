"""Tiny REPL over ``run_turn`` — the orchestrator's live-test harness (Slice F).

Usage:
    uv run python scripts/chat_cli.py [--session SESSION_ID]

Builds the production runtime once (RO pool + catalog, app pool, Postgres
checkpointer, counselle-db MCP child, real Gemini), then loops: read a line,
stream the turn, print events. Clarify questions print their options and the
next line you type is the answer (``run_turn`` auto-detects the parked
interrupt). Piped stdin works for one-shot smokes (EOF exits cleanly).
``--session`` resumes an existing session — including one parked on a clarify
from a previous process (ADR 0019's durability promise).
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from typing import Any
from uuid import uuid4

from app.deps import Runtime, build_runtime
from app.run_turn import run_turn


def _print_event(event_type: str, data: dict[str, Any]) -> str | None:
    """Render one event; returns the done-status when terminal."""
    if event_type == "delta":
        print(data["text"], end="", flush=True)
    elif event_type == "viz":
        print(f"\n[viz: {data['type']} — {data['title']}]", flush=True)
    elif event_type == "clarify":
        print(f"\n{data['question']}")
        print(f"  ({data['header']})")
        for n, option in enumerate(data["options"], start=1):
            print(f"  {n}. {option['label']} — {option['hint']}")
        print("  (or type your own answer)")
    elif event_type == "sources":
        sources = data["sources"]
        if sources:
            print("\nsources:")
            for entry in sources:
                citation = entry["citation"]
                url = f" <{citation['url']}>" if citation.get("url") else ""
                print(f"  [{entry['index']}] {entry['label']} ({citation['tier']}){url}")
    elif event_type == "usage":
        print(
            f"usage: in={data['input_tokens']} out={data['output_tokens']} "
            f"tool_calls={data['tool_calls']}"
        )
    elif event_type == "error":
        print(f"\n[error] {data['message']} (trace {data['trace_id']})")
        return "error"
    elif event_type == "done":
        return str(data["status"])
    return None


async def _turn(runtime: Runtime, session_id: str, text: str) -> str:
    """Stream one turn to stdout; returns the terminal status."""
    status = "error"
    async for event in run_turn(session_id, text, deps=runtime.deps, graph=runtime.graph):
        result = _print_event(event.type, event.data)
        if result is not None:
            status = result
    print()
    return status


async def main() -> int:
    parser = argparse.ArgumentParser(description="Counselle chat REPL (dev harness)")
    parser.add_argument("--session", help="resume an existing session id", default=None)
    args = parser.parse_args()

    session_id = args.session or str(uuid4())
    print(f"session: {session_id}  (Ctrl-C or Ctrl-D to exit)", file=sys.stderr)

    try:
        runtime = await build_runtime()
    except Exception as exc:
        print(f"startup failed: {exc}", file=sys.stderr)
        return 1
    prompt = "you> "
    try:
        while True:
            try:
                text = await asyncio.to_thread(input, prompt)
            except (EOFError, KeyboardInterrupt):
                break
            if not text.strip():
                continue
            status = await _turn(runtime, session_id, text.strip())
            prompt = "answer> " if status == "awaiting_input" else "you> "
    finally:
        await runtime.aclose()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    except KeyboardInterrupt:
        raise SystemExit(130) from None
