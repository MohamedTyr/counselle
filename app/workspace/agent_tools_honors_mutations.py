"""Mutation tools for the Honors workspace surface.

Structural mirror of ``agent_tools_activities_mutations.py`` for the honors
half of the Activities page. Honors have no hours/weeks/continue/story
fields and no batched, lock-hardened create path (see the module-level note
on ``create_honors`` below) — the plan scopes that Phase 3 transaction
hardening to activities only, and 5 honor rows plus a pre-validated,
all-or-nothing tool-layer check is enough here.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic_ai import Tool

from app.tool_middleware import process_tool_result
from app.workspace import service_activities
from app.workspace.agent_tools_activities import render_honor_row
from app.workspace.agent_tools_shared import (
    BATCH_MAX,
    BATCH_MIN,
    HONOR_TITLE_CHAR_LIMIT,
    MAX_HONORS,
    Grade,
    HonorDraft,
    RecognitionLevel,
    ToolCtx,
    batch_size_error,
    error,
    slot_cap_error,
    stale_honor_error,
    today,
    try_uuid,
)
from app.workspace.models import (
    Honor,
    HonorCreate,
    HonorPatch,
    WorkspaceNotFoundError,
    WorkspaceValidationError,
)

_REORDER_RECOVERY = (
    "ids must be exactly the current active honors — call view_activities and resubmit the "
    "full list."
)


def _honor_pair(title: str) -> str:
    return title.strip().casefold()


def _honor_warning(honors: list[Honor]) -> str | None:
    """Report every honor title over its exact Common App budget."""
    overages: list[str] = []
    for honor in honors:
        count = len(honor.title)
        if count > HONOR_TITLE_CHAR_LIMIT:
            overages.append(
                f'"{honor.title}" (id {honor.id}): title {count}/{HONOR_TITLE_CHAR_LIMIT}'
            )
    if not overages:
        return None
    return "Over the Common App character limit — " + "; ".join(overages) + "."


def _honor_summary(honor: Honor, patch: dict[str, Any]) -> str:
    names = {"title": "title", "grades": "grades", "levels": "levels"}
    changes = ", ".join(f"{names[key]} updated" for key in patch)
    return f'Updated "{honor.title}" — {changes}. '


def _duplicate_honor_error(
    index: int, *, active_honor_id: UUID | None = None, earlier_batch_index: int | None = None
) -> dict[str, Any]:
    if active_honor_id is not None:
        return error(
            f"honors[{index}] duplicates active honor id {active_honor_id} with the same "
            "title. Nothing was created.",
            retryable=False,
            recovery="Update the existing honor, or resubmit with force=true after confirming "
            "these are genuinely separate entries.",
        )
    return error(
        f"honors[{index}] duplicates another honor earlier in this batch ({earlier_batch_index}). "
        "Nothing was created.",
        retryable=True,
        recovery="Give each honor a distinct title, or remove the duplicate and resubmit.",
    )


async def _rank_honors(ctx: ToolCtx, honor_id: UUID) -> int:
    honors = await service_activities.list_honors(ctx.app_pool, user_id=ctx.user_id)
    return next(index for index, honor in enumerate(honors, start=1) if honor.id == honor_id)


# --------------------------------------------------------------------------
# create_honors
# --------------------------------------------------------------------------


def make_create_honors_tool(ctx: ToolCtx) -> Tool[Any]:
    async def create_honors(honors: list[HonorDraft], force: bool = False) -> dict[str, Any]:
        """Create one or more Common App honors, appending them to the importance
        order. Check view_activities first: a same-title active honor rejects the
        whole batch unless force=true after confirming it is genuinely separate.
        The Common App allows only 5 honors.

        The title character budget is a warning, not a block: 100 characters.
        Never invent facts to make an honor sound stronger.

        Args:
            honors: Honors to create, 1-20 per call, subject to the 5-slot cap.
            force: Override an exact active duplicate only after confirming it is
                separate. Never lets two honors in the same call share a title —
                that duplicate is always rejected.
        """
        payload = await _create_honors_impl(ctx, honors, force)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="create_honors")  # type: ignore[no-any-return]

    return Tool(create_honors, takes_ctx=False)


async def _create_honors_impl(
    ctx: ToolCtx, drafts: list[HonorDraft], force: bool
) -> dict[str, Any]:
    if not (BATCH_MIN <= len(drafts) <= BATCH_MAX):
        return batch_size_error("create_honors", len(drafts))

    active = await service_activities.list_honors(ctx.app_pool, user_id=ctx.user_id)

    # Pre-validate the whole batch before any write: there is no per-user
    # advisory lock on honors (unlike activities), so this tool-layer check is
    # the only guard against a partial, silently-inconsistent batch under
    # normal single-request conditions. A concurrent request racing this same
    # check is an accepted gap — Phase 3 scoped its transactional hardening to
    # activities only, and 5-row honor lists make that race rare and low-cost
    # (the service's own capacity check still rejects an over-cap insert).
    active_pairs = {_honor_pair(honor.title): honor.id for honor in active}
    batch_pairs: dict[str, int] = {}
    for index, draft in enumerate(drafts):
        pair = _honor_pair(draft.title)
        if not force and (active_honor_id := active_pairs.get(pair)):
            return _duplicate_honor_error(index, active_honor_id=active_honor_id)
        earlier_index = batch_pairs.get(pair)
        if earlier_index is not None:
            return _duplicate_honor_error(index, earlier_batch_index=earlier_index)
        batch_pairs[pair] = index

    if len(active) + len(drafts) > MAX_HONORS:
        return slot_cap_error("honor", MAX_HONORS, len(active))

    created: list[Honor] = []
    for draft in drafts:
        try:
            honor = await service_activities.create_honor(
                ctx.app_pool,
                ctx.workspace_events,
                user_id=ctx.user_id,
                actor="counselle",
                data=HonorCreate(
                    title=draft.title,
                    grades=[str(grade) for grade in draft.grades],
                    levels=[str(level) for level in draft.levels],
                ),
            )
        except WorkspaceValidationError:
            active_now = await service_activities.list_honors(ctx.app_pool, user_id=ctx.user_id)
            cap_error = slot_cap_error("honor", MAX_HONORS, len(active_now))
            if created:
                # A concurrent request filled the remaining cap between our
                # pre-check and this loop (the accepted gap described above):
                # some honors from this same batch already exist. Say so
                # explicitly rather than implying the whole call was a no-op.
                ranks = {honor.id: index for index, honor in enumerate(active_now, start=1)}
                cap_error["error"] = (
                    f"{cap_error['error']} {len(created)} honor"
                    f"{'s' if len(created) != 1 else ''} from this same call "
                    f"{'were' if len(created) != 1 else 'was'} already created before the cap "
                    "was reached."
                )
                cap_error["created"] = [
                    render_honor_row(honor, rank=ranks[honor.id]) for honor in created
                ]
            return cap_error
        created.append(honor)

    ordered = await service_activities.list_honors(ctx.app_pool, user_id=ctx.user_id)
    ranks = {honor.id: index for index, honor in enumerate(ordered, start=1)}
    payload: dict[str, Any] = {
        "status": "ok",
        "today": today(),
        "summary": f"Created {len(created)} honor{'s' if len(created) != 1 else ''}.",
        "honors": [render_honor_row(honor, rank=ranks[honor.id]) for honor in created],
        "footer": "New honors were appended to the current importance order. Use "
        "reorder_honors if their rank should change.",
    }
    if warning := _honor_warning(created):
        payload["warning"] = warning
    return payload


# --------------------------------------------------------------------------
# update_honor
# --------------------------------------------------------------------------


def make_update_honor_tool(ctx: ToolCtx) -> Tool[Any]:
    async def update_honor_tool(
        honor_id: str,
        title: str | None = None,
        grades: list[Grade] | None = None,
        levels: list[RecognitionLevel] | None = None,
    ) -> dict[str, Any]:
        """Change one honor. Pass only fields that should change; lists replace the
        whole current list. Rank is not editable here: use reorder_honors with every
        active id to change Common App importance order.

        Args:
            honor_id: Exact active id from view_activities.
            title: Honor title; budget 100 characters.
            grades: Grades earned; replaces the whole list.
            levels: Recognition levels; replaces the whole list.
        """
        payload = await _update_honor_impl(
            ctx, honor_id, title=title, grades=grades, levels=levels
        )
        return process_tool_result(payload, ctx.tool_overflow, tool_name="update_honor")  # type: ignore[no-any-return]

    return Tool(update_honor_tool, takes_ctx=False, name="update_honor")


async def _update_honor_impl(ctx: ToolCtx, honor_id: str, **fields: Any) -> dict[str, Any]:
    if all(value is None for value in fields.values()):
        return error(
            "No fields provided — nothing to update.",
            retryable=True,
            recovery="Pass at least one field to change.",
        )
    parsed_id = try_uuid(honor_id)
    if parsed_id is None:
        return stale_honor_error(honor_id)

    patch: dict[str, Any] = {key: value for key, value in fields.items() if value is not None}

    try:
        honor = await service_activities.update_honor(
            ctx.app_pool,
            ctx.workspace_events,
            user_id=ctx.user_id,
            actor="counselle",
            honor_id=parsed_id,
            data=HonorPatch(**patch),
        )
    except WorkspaceNotFoundError:
        return stale_honor_error(honor_id)

    payload: dict[str, Any] = {
        "status": "ok",
        "today": today(),
        "summary": _honor_summary(honor, patch),
        "honor": render_honor_row(honor, rank=await _rank_honors(ctx, honor.id)),
    }
    if warning := _honor_warning([honor]):
        payload["warning"] = warning
    return payload


# --------------------------------------------------------------------------
# archive_honors / restore_honor
# --------------------------------------------------------------------------


def make_archive_honors_tool(ctx: ToolCtx) -> Tool[Any]:
    async def archive_honors(honor_ids: list[str]) -> dict[str, Any]:
        """Remove honors from the current page. This is a soft delete: restore_honor
        can bring an archived entry back. Confirm before removing an honor. Unknown
        or already archived ids are skipped while valid ids still archive.

        Args:
            honor_ids: Exact honor ids from view_activities, 1-20 per call.
        """
        payload = await _archive_honors_impl(ctx, honor_ids)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="archive_honors")  # type: ignore[no-any-return]

    return Tool(archive_honors, takes_ctx=False)


async def _archive_honors_impl(ctx: ToolCtx, honor_ids: list[str]) -> dict[str, Any]:
    if not (BATCH_MIN <= len(honor_ids) <= BATCH_MAX):
        return batch_size_error("archive_honors", len(honor_ids))

    archived: list[str] = []
    skipped: list[dict[str, str]] = []
    for raw_id in honor_ids:
        parsed_id = try_uuid(raw_id)
        if parsed_id is None:
            skipped.append({"id": raw_id, "reason": "not a valid honor id"})
            continue
        try:
            await service_activities.archive_honor(
                ctx.app_pool,
                ctx.workspace_events,
                user_id=ctx.user_id,
                actor="counselle",
                honor_id=parsed_id,
            )
            archived.append(raw_id)
        except WorkspaceNotFoundError:
            skipped.append({"id": raw_id, "reason": "no active honor with this id"})

    if not archived and len(honor_ids) == 1:
        return stale_honor_error(honor_ids[0])
    if not archived:
        return error(
            "No active honors found among the given ids. They may have been archived, or the "
            "ids may be stale.",
            retryable=False,
            recovery=stale_honor_error(honor_ids[0])["recovery"],
        )
    payload: dict[str, Any] = {
        "status": "warning" if skipped else "ok",
        "today": today(),
        "summary": f"Archived {len(archived)} honor{'s' if len(archived) != 1 else ''}.",
        "archived": archived,
        "footer": "restore_honor(honor_id=...) undoes any of these.",
    }
    if skipped:
        payload["skipped"] = skipped
    return payload


def make_restore_honor_tool(ctx: ToolCtx) -> Tool[Any]:
    async def restore_honor_tool(honor_id: str) -> dict[str, Any]:
        """Bring one archived honor back to the page. Find archived ids with
        view_activities(status="archived"). The restored item appends to the
        active importance order; the returned rank is its actual Common App rank.

        Args:
            honor_id: Archived honor id from view_activities(status="archived").
        """
        payload = await _restore_honor_impl(ctx, honor_id)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="restore_honor")  # type: ignore[no-any-return]

    return Tool(restore_honor_tool, takes_ctx=False, name="restore_honor")


async def _restore_honor_impl(ctx: ToolCtx, honor_id: str) -> dict[str, Any]:
    parsed_id = try_uuid(honor_id)
    if parsed_id is None:
        return stale_honor_error(honor_id)
    # UX-only best-effort pre-check for a fast, specific error message.
    # service_activities.restore_honor re-validates authoritatively inside its
    # own transaction, so a stale read here just falls through to that call's
    # error handling below.
    async with ctx.app_pool.acquire() as conn:
        probe = await conn.fetchrow(
            "SELECT title, archived_at FROM counselle.honors WHERE id = $1 AND user_id = $2",
            parsed_id,
            ctx.user_id,
        )
    if probe is None:
        return stale_honor_error(honor_id)
    if probe["archived_at"] is None:
        return error(
            f'"{probe["title"]}" is not archived — it is already on the active page.',
            retryable=False,
            recovery="No action needed. view_activities confirms its current state.",
        )

    active = await service_activities.list_honors(ctx.app_pool, user_id=ctx.user_id)
    if len(active) >= MAX_HONORS:
        return slot_cap_error("honor", MAX_HONORS, len(active))
    try:
        honor = await service_activities.restore_honor(
            ctx.app_pool,
            ctx.workspace_events,
            user_id=ctx.user_id,
            actor="counselle",
            honor_id=parsed_id,
        )
    except WorkspaceNotFoundError:
        return stale_honor_error(honor_id)
    except WorkspaceValidationError:
        active = await service_activities.list_honors(ctx.app_pool, user_id=ctx.user_id)
        return slot_cap_error("honor", MAX_HONORS, len(active))

    ordered = await service_activities.list_honors(ctx.app_pool, user_id=ctx.user_id)
    rank = next(index for index, item in enumerate(ordered, start=1) if item.id == honor.id)
    return {
        "status": "ok",
        "today": today(),
        "summary": f'Restored "{honor.title}" at rank {rank}.',
        "honor": render_honor_row(honor, rank=rank),
    }


# --------------------------------------------------------------------------
# reorder_honors
# --------------------------------------------------------------------------


def make_reorder_honors_tool(ctx: ToolCtx) -> Tool[Any]:
    async def reorder_honors(ids: list[str]) -> dict[str, Any]:
        """Set the complete active honors list to this new importance order. Pass
        every active id from view_activities, most important first: rank 1 is the
        top honor. This is atomic.

        Args:
            ids: Every active honor id, exactly once, in its new rank order.
        """
        payload = await _reorder_honors_impl(ctx, ids)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="reorder_honors")  # type: ignore[no-any-return]

    return Tool(reorder_honors, takes_ctx=False)


async def _reorder_honors_impl(ctx: ToolCtx, ids: list[str]) -> dict[str, Any]:
    parsed_ids: list[UUID] = []
    for raw_id in ids:
        parsed_id = try_uuid(raw_id)
        if parsed_id is None:
            return error(_REORDER_RECOVERY, retryable=True, recovery=_REORDER_RECOVERY)
        parsed_ids.append(parsed_id)
    try:
        honors = await service_activities.reorder_honors(
            ctx.app_pool,
            ctx.workspace_events,
            user_id=ctx.user_id,
            actor="counselle",
            ids=parsed_ids,
        )
    except (WorkspaceNotFoundError, WorkspaceValidationError):
        return error(_REORDER_RECOVERY, retryable=True, recovery=_REORDER_RECOVERY)
    return {
        "status": "ok",
        "today": today(),
        "summary": f"Reordered {len(honors)} honor{'s' if len(honors) != 1 else ''}.",
        "honors": [
            render_honor_row(honor, rank=index) for index, honor in enumerate(honors, start=1)
        ],
        "footer": "Rank is Common App importance order: 1 is the top honor.",
    }
