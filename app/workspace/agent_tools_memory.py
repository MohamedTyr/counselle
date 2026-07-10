"""Per-run agent tools for curated agent memory (Part E 4-6).

``remember``/``update_memory``/``forget`` wrap ``service_memory`` directly
with ``actor="counselle"``. The Hermes-style capacity error and the
exact-duplicate rejection are pre-checked here (with a specific, named
message) before the service call, since the service only raises a generic
``WorkspaceValidationError`` — the tool layer is where the *teaching* shape
of the error (ADR 0029 ``retryable``/``recovery``) belongs, same as every
other tool family.

Deviation from the Phase 1 service contract: ``archive_memory`` originally
accepted only ``actor="student"`` (the HTTP delete route). Part E's
``forget`` is an agent tool, so ``service_memory._require_student_actor`` was
relaxed to accept ``"counselle"`` too — see that module's docstring note.
"""

from __future__ import annotations

from typing import Any

from pydantic_ai import Tool

from app.tool_middleware import process_tool_result
from app.workspace import service_memory
from app.workspace.agent_tools_shared import ToolCtx, error, resolve_ref
from app.workspace.memory_context import memory_rendered_char_count, render_memory_block
from app.workspace.models import (
    MEMORY_BATCH_MAX_ITEMS,
    MEMORY_BATCH_MIN_ITEMS,
    MEMORY_CONTENT_MAX_LENGTH,
    MEMORY_TOTAL_MAX_CHARS,
    Memory,
    MemoryCreate,
    MemoryPatch,
    WorkspaceNotFoundError,
    WorkspaceValidationError,
)

_MEMORY_ID_PREFIX_LENGTH = 8
_CAPACITY_RECOVERY = (
    "Merge related notes with update_memory or drop superseded ones with forget, then retry."
)
_STALE_MEMORY_RECOVERY = "Check the Memory section already in your context for current ids."


def _normalize(note: str) -> str:
    return " ".join(note.split())


def _usage_header(memories: list[Memory]) -> str:
    return render_memory_block(memories).splitlines()[0]


def _batch_size_error(tool_name: str, count: int) -> dict[str, Any]:
    return error(
        f"{tool_name} accepts {MEMORY_BATCH_MIN_ITEMS}-{MEMORY_BATCH_MAX_ITEMS} items per call; "
        f"got {count}.",
        retryable=True,
        recovery=f"Split the batch into calls of {MEMORY_BATCH_MAX_ITEMS} or fewer and resubmit.",
    )


def _capacity_error() -> dict[str, Any]:
    return error(
        "That would exceed the memory capacity.",
        retryable=True,
        recovery=_CAPACITY_RECOVERY,
    )


def _duplicate_error(existing: Memory) -> dict[str, Any]:
    return error(
        f'"{existing.content}" (id {str(existing.id)[:_MEMORY_ID_PREFIX_LENGTH]}) is already '
        "remembered.",
        retryable=True,
        recovery="Use update_memory to revise the existing note instead of adding a duplicate.",
    )


def _stale_memory_error(memory_ref: str) -> dict[str, Any]:
    return error(
        f'No active memory note matches "{memory_ref}". It may already be forgotten, or the '
        "ref may be stale.",
        retryable=False,
        recovery=_STALE_MEMORY_RECOVERY,
    )


# --------------------------------------------------------------------------
# E.4 remember
# --------------------------------------------------------------------------


def make_remember_tool(ctx: ToolCtx) -> Tool[Any]:
    async def remember(notes: list[str]) -> dict[str, Any]:
        """Save one or more durable facts about the student or your working
        relationship with them — never application data (that's update_profile's
        job) and never a recap of the conversation.

        One fact per note, telegraphic, at most 200 characters — an index card,
        not a journal entry ("prefers blunt feedback — 'don't sugarcoat'"). If a
        fact needs two sentences, split it into two notes. Corrections are a
        priority save: when the student corrects an assumption you made, save
        the correction. Never save something the student asked to keep off the
        record.

        The whole pile is already in your context every turn, so check it before
        calling this — a near-duplicate is rejected naming the existing note;
        update it with update_memory instead. If the batch would push memory
        over its character budget, the call is rejected — consolidate with
        update_memory or forget first, then retry.

        Args:
            notes: 1-10 short notes to save this turn.
        """
        payload = await _remember_impl(ctx, notes)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="remember")  # type: ignore[no-any-return]

    return Tool(remember, takes_ctx=False)


async def _remember_impl(ctx: ToolCtx, notes: list[str]) -> dict[str, Any]:
    if not (MEMORY_BATCH_MIN_ITEMS <= len(notes) <= MEMORY_BATCH_MAX_ITEMS):
        return _batch_size_error("remember", len(notes))

    for index, note in enumerate(notes):
        if len(note.strip()) == 0:
            return error(
                f"notes[{index}] is empty.",
                retryable=True,
                recovery="Remove empty notes and resubmit.",
            )
        if len(note) > MEMORY_CONTENT_MAX_LENGTH:
            return error(
                f"notes[{index}] is {len(note)} chars; the cap is {MEMORY_CONTENT_MAX_LENGTH} "
                "per note.",
                retryable=True,
                recovery="Shorten to one telegraphic fact per note and resubmit.",
            )

    normalized = [_normalize(note) for note in notes]
    active = await service_memory.list_memories(ctx.app_pool, user_id=ctx.user_id)
    existing_by_content = {memory.content: memory for memory in active}
    for note in normalized:
        if note in existing_by_content:
            return _duplicate_error(existing_by_content[note])

    active_contents = [memory.content for memory in active]
    if memory_rendered_char_count([*active_contents, *normalized]) > MEMORY_TOTAL_MAX_CHARS:
        return _capacity_error()

    try:
        created = await service_memory.create_memories(
            ctx.app_pool,
            ctx.workspace_events,
            user_id=ctx.user_id,
            actor="counselle",
            data=[MemoryCreate(content=note) for note in notes],
        )
    except WorkspaceValidationError as exc:
        message = str(exc)
        if "capacity" in message:
            return _capacity_error()
        return error(message, retryable=True, recovery=_CAPACITY_RECOVERY)

    rows = [
        {
            "id": str(memory.id)[:_MEMORY_ID_PREFIX_LENGTH],
            "content": memory.content,
            "created": memory.created_at.date().isoformat(),
        }
        for memory in created
    ]
    usage = _usage_header(await service_memory.list_memories(ctx.app_pool, user_id=ctx.user_id))
    return {
        "status": "ok",
        "summary": f"Remembered {len(rows)} note{'' if len(rows) == 1 else 's'}.",
        "notes": rows,
        "usage": usage,
    }


# --------------------------------------------------------------------------
# E.5 update_memory
# --------------------------------------------------------------------------


def make_update_memory_tool(ctx: ToolCtx) -> Tool[Any]:
    async def update_memory(memory_ref: str, content: str) -> dict[str, Any]:
        """Rewrite or consolidate one existing memory note in place.

        Use this instead of remember when a fact changes, gets corrected, or
        several notes should merge into one denser note. Never re-add a fact
        that's already remembered — update the existing note.

        Args:
            memory_ref: The note's id, as the 8-char prefix shown in your
                student context or the full id.
            content: The note's new full text (replaces the old text
                entirely), at most 200 characters.
        """
        payload = await _update_memory_impl(ctx, memory_ref, content)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="update_memory")  # type: ignore[no-any-return]

    return Tool(update_memory, takes_ctx=False)


async def _update_memory_impl(ctx: ToolCtx, memory_ref: str, content: str) -> dict[str, Any]:
    if len(content.strip()) == 0:
        return error("content is empty.", retryable=True, recovery="Provide the note's new text.")
    if len(content) > MEMORY_CONTENT_MAX_LENGTH:
        return error(
            f"content is {len(content)} chars; the cap is {MEMORY_CONTENT_MAX_LENGTH}.",
            retryable=True,
            recovery="Shorten to one telegraphic fact and resubmit.",
        )

    active = await service_memory.list_memories(ctx.app_pool, user_id=ctx.user_id)
    matched, ambiguous = resolve_ref(memory_ref, [memory.id for memory in active])
    if ambiguous:
        return error(
            f'"{memory_ref}" matches more than one memory note.',
            retryable=True,
            recovery="Use the full id from your student context instead of a short prefix.",
        )
    if matched is None:
        return _stale_memory_error(memory_ref)

    normalized = _normalize(content)
    duplicate = next(
        (memory for memory in active if memory.id != matched and memory.content == normalized),
        None,
    )
    if duplicate is not None:
        return _duplicate_error(duplicate)

    try:
        memory = await service_memory.update_memory(
            ctx.app_pool,
            ctx.workspace_events,
            user_id=ctx.user_id,
            actor="counselle",
            memory_id=matched,
            data=MemoryPatch(content=content),
        )
    except WorkspaceNotFoundError:
        return _stale_memory_error(memory_ref)
    except WorkspaceValidationError as exc:
        message = str(exc)
        if "capacity" in message:
            return _capacity_error()
        return error(message, retryable=True, recovery=_CAPACITY_RECOVERY)

    return {
        "status": "ok",
        "summary": f'Updated note {str(memory.id)[:_MEMORY_ID_PREFIX_LENGTH]}.',
        "note": {
            "id": str(memory.id)[:_MEMORY_ID_PREFIX_LENGTH],
            "content": memory.content,
        },
    }


# --------------------------------------------------------------------------
# E.6 forget
# --------------------------------------------------------------------------


def make_forget_tool(ctx: ToolCtx) -> Tool[Any]:
    async def forget(memory_refs: list[str]) -> dict[str, Any]:
        """Archive one or more memory notes that are no longer true or useful.

        Soft delete — there is no restore tool; a forgotten note you still want
        is a re-remember away. Unknown or already-forgotten refs are skipped
        and reported; the rest still archive.

        Args:
            memory_refs: 1-10 note ids (8-char prefix or full id) to forget.
        """
        payload = await _forget_impl(ctx, memory_refs)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="forget")  # type: ignore[no-any-return]

    return Tool(forget, takes_ctx=False)


async def _forget_impl(ctx: ToolCtx, memory_refs: list[str]) -> dict[str, Any]:
    if not (MEMORY_BATCH_MIN_ITEMS <= len(memory_refs) <= MEMORY_BATCH_MAX_ITEMS):
        return _batch_size_error("forget", len(memory_refs))

    active = await service_memory.list_memories(ctx.app_pool, user_id=ctx.user_id)
    active_by_id = {memory.id: memory for memory in active}

    forgotten: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    for ref in memory_refs:
        matched, ambiguous = resolve_ref(ref, list(active_by_id))
        if ambiguous:
            skipped.append({"id": ref, "reason": "matches more than one note id"})
            continue
        if matched is None:
            skipped.append({"id": ref, "reason": "not found or already forgotten"})
            continue
        try:
            await service_memory.archive_memory(
                ctx.app_pool,
                ctx.workspace_events,
                user_id=ctx.user_id,
                actor="counselle",
                memory_id=matched,
            )
        except WorkspaceNotFoundError:
            skipped.append({"id": ref, "reason": "not found or already forgotten"})
            continue
        forgotten.append(
            {
                "id": str(matched)[:_MEMORY_ID_PREFIX_LENGTH],
                "content": active_by_id[matched].content,
            }
        )

    if not forgotten:
        if len(memory_refs) == 1:
            return _stale_memory_error(memory_refs[0])
        return error(
            "No active memory notes matched the given refs.",
            retryable=False,
            recovery=_STALE_MEMORY_RECOVERY,
        )

    payload: dict[str, Any] = {
        "status": "warning" if skipped else "ok",
        "summary": f"Forgot {len(forgotten)} note{'' if len(forgotten) == 1 else 's'}.",
        "forgotten": forgotten,
    }
    if skipped:
        payload["skipped"] = skipped
    return payload
