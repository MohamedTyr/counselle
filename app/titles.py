"""Chat auto-titles (B4, §29): the derived default + the cheap-model retitle hook.

Two pieces:

- :func:`default_title` — the instant title set when the first message arrives
  (the question, truncated at a word boundary). Pure, deterministic.
- :func:`make_auto_titler` — builds the ``on_turn_complete`` hook: a ONE cheap-
  model call that names the chat from its first exchange. It only retitles while
  the title is still the derived default (so a landed model title is never
  clobbered, and we don't retitle every turn — no schema change needed). The hook
  NEVER raises, blocks, or retries — a failure leaves the default standing. That
  swallow is the one sanctioned deliberate one in this module.

The titling prompt is a versioned data asset
(``config/assets/prompts/title.md``), loaded via ``load_prompt("title")`` like
the other agent prompts (ADR 0018 bucket 2, CFG-09) — not an inline string.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

import structlog

from app.sessions import get_session, set_session_title
from config.settings import load_prompt

logger = structlog.get_logger(__name__)

_ELLIPSIS = "…"


def default_title(text: str, max_len: int) -> str:
    """Derive the instant default title from the first user message.

    Truncates at a word boundary with an ``…`` suffix when cut. A short message
    is returned whole (stripped). ``max_len`` bounds the result including the
    ellipsis.
    """
    cleaned = " ".join(text.split())
    if len(cleaned) <= max_len:
        return cleaned
    # When the budget can't fit the ellipsis (tiny max_len), hard-truncate
    # without it — never emit a title that's mostly/entirely the ellipsis.
    if max_len <= len(_ELLIPSIS):
        return cleaned[:max_len]
    budget = max(1, max_len - len(_ELLIPSIS))
    head = cleaned[:budget]
    cut = head.rsplit(" ", 1)[0] if " " in head else head
    return f"{cut.rstrip()}{_ELLIPSIS}"


def _first_exchange(transcript: list[dict[str, Any]]) -> tuple[str | None, str | None]:
    """The first user text and first nonblank assistant text from a transcript.

    Phase 4 (plan "Update title extraction to choose the first nonblank
    assistant text, allowing A2 to title a conversation whose A1 was
    question-only"): a v2 A1 that ends in a pure ``ask_student`` question has
    no answer prose at all (``record["parts"]`` is empty by construction —
    the question IS the turn's output), so the FIRST assistant entry alone is
    no longer a safe pick. Skip blank/whitespace-only assistant text and keep
    looking — A2's first substantive prose then titles the chat.
    """
    first_user = next((e.get("text") for e in transcript if e.get("role") == "user"), None)
    first_assistant = next(
        (
            text
            for e in transcript
            if e.get("role") == "assistant" and (text := e.get("text")) and text.strip()
        ),
        None,
    )
    return first_user, first_assistant


async def _read_transcript(runtime: Any, session_id: str) -> list[dict[str, Any]]:
    """Reuse the route's transcript machinery to read the first exchange."""
    from app.transcript import extract_transcript

    config = {"configurable": {"thread_id": session_id}}
    snapshot = await runtime.graph.aget_state(config)
    if snapshot is None:
        return []
    messages = list(snapshot.values.get("messages") or [])
    turn_records = list(snapshot.values.get("turn_records") or [])
    return extract_transcript(messages, turn_records)


def _title_model(runtime: Any, settings: Any) -> Any:
    """The cheap title model: the injected ``model_factory`` (tests) or a real
    GoogleModel built from ``settings.model_title`` (production)."""
    factory = getattr(runtime.deps, "model_factory", None)
    if factory is not None:
        return factory()
    from pydantic_ai.models.google import GoogleModel
    from pydantic_ai.providers.google_cloud import GoogleCloudProvider

    from app.agent_node import model_name_from_setting

    return GoogleModel(
        model_name_from_setting(settings.model_title),
        provider=GoogleCloudProvider(api_key=settings.vertex_api_key),
    )


async def _generate_title(runtime: Any, settings: Any, user_text: str, assistant_text: str) -> str:
    """One no-tools cheap-model call → a short title (raises on failure)."""
    from pydantic_ai import Agent

    agent: Agent[None, str] = Agent(
        _title_model(runtime, settings),
        system_prompt=load_prompt("title").strip(),
    )
    result = await agent.run(f"User: {user_text}\n\nAssistant: {assistant_text}")
    return str(result.output).strip().strip('"').strip()


def make_auto_titler(
    pool: Any, runtime: Any, settings: Any
) -> Callable[[str], Awaitable[None]]:
    """Build the async ``on_turn_complete`` hook (assigned in the lifespan).

    The hook reads the session + its first exchange, and only retitles while the
    stored title still equals the derived default (a diverged title means a model
    title already landed — skip). It NEVER raises/blocks/retries: any failure is
    logged once and swallowed so the default stands. (This is the one deliberate,
    sanctioned swallow.)
    """
    max_len = settings.title_max_len

    async def _hook(session_id: str) -> None:
        try:
            row = await get_session(pool, session_id)
            if row is None:
                return
            transcript = await _read_transcript(runtime, session_id)
            user_text, assistant_text = _first_exchange(transcript)
            if not user_text or not assistant_text:
                return
            # Skip once a model title has landed — the stored title diverged from
            # the derived default, so we don't re-run on every turn.
            if (row.get("title") or "") != default_title(user_text, max_len):
                logger.debug(
                    "title already diverged from default — skipping retitle",
                    session_id=session_id,
                )
                return
            title = await _generate_title(runtime, settings, user_text, assistant_text)
            if title:
                await set_session_title(pool, session_id, title[:max_len])
        except Exception:
            # SANCTIONED SWALLOW: titling is best-effort decoration. A failure
            # must never block the turn or surface to the student — the derived
            # default title already stands. Log once, move on.
            logger.warning(
                "auto-title failed — default title stands",
                session_id=session_id,
                exc_info=True,
            )

    return _hook
