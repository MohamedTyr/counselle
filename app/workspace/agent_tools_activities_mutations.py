"""Mutation tools for the Activities workspace surface.

The tools intentionally call ``service_activities`` directly, so agent edits
share the student UI's ownership, change-log, and workspace-event path.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import Field
from pydantic_ai import Tool

from app.tool_middleware import process_tool_result
from app.workspace import service_activities
from app.workspace.agent_tools_activities import (
    render_activity_row,
)
from app.workspace.agent_tools_shared import (
    BATCH_MAX,
    BATCH_MIN,
    DESCRIPTION_CHAR_LIMIT,
    HOURS_MAX,
    MAX_ACTIVITIES,
    ORGANIZATION_CHAR_LIMIT,
    POSITION_CHAR_LIMIT,
    WEEKS_MAX,
    ActivityDraft,
    ActivityType,
    Grade,
    Timing,
    ToolCtx,
    batch_size_error,
    error,
    slot_cap_error,
    stale_activity_error,
    today,
    try_uuid,
)
from app.workspace.models import (
    Activity,
    ActivityCreate,
    ActivityDuplicateError,
    ActivityPatch,
    WorkspaceNotFoundError,
    WorkspaceValidationError,
)
from app.workspace_mutation_receipts import (
    attach_mutation,
    batch_item,
    batch_receipt,
    boolean_value,
    change,
    enum_value,
    integer_value,
    reorder_receipt,
    state_transition_receipt,
    subject,
    text_list_value,
    text_value,
    update_receipt,
)
from domain.mutation_receipts import MutationChange

_CLEARABLE = "clear"
_REORDER_RECOVERY = (
    "ids must be exactly the current active activities — call view_activities and resubmit "
    "the full list."
)
type _BoundedHours = Annotated[int, Field(ge=1, le=HOURS_MAX)]
type _BoundedWeeks = Annotated[int, Field(ge=1, le=WEEKS_MAX)]


def _activity_warning(activities: list[Activity]) -> str | None:
    """Report every export field over its exact Common App budget."""
    overages: list[str] = []
    for activity in activities:
        for label, value, limit in (
            ("position", activity.position, POSITION_CHAR_LIMIT),
            ("organization", activity.organization, ORGANIZATION_CHAR_LIMIT),
            ("description", activity.description, DESCRIPTION_CHAR_LIMIT),
        ):
            count = len(value)
            if count > limit:
                overages.append(
                    f'"{activity.position}" (id {activity.id}): {label} {count}/{limit}'
                )
    if not overages:
        return None
    return "Over the Common App character limit — " + "; ".join(overages) + "."


def _activity_summary(activity: Activity, patch: dict[str, Any]) -> str:
    names = {
        "activity_type": "type",
        "position": "position",
        "organization": "organization",
        "description": "description",
        "grades": "grades",
        "timing": "timing",
        "hours_per_week": "hours_per_week",
        "weeks_per_year": "weeks_per_year",
        "continue_in_college": "continue_in_college",
        "story": "story",
    }
    changes = ", ".join(
        f"{names[key]} {'cleared' if value is None else 'updated'}" for key, value in patch.items()
    )
    return f'Updated "{activity.position}" — {changes}. '


def _duplicate_activity_error(exc: ActivityDuplicateError) -> dict[str, Any]:
    index = exc.duplicate_index
    if exc.active_activity_id is not None:
        return error(
            f"activities[{index}] duplicates active activity id {exc.active_activity_id} with the "
            "same position and organization. Nothing was created.",
            retryable=False,
            recovery="Update the existing activity, or resubmit with force=true after "
            "confirming these are genuinely separate entries.",
        )
    return error(
        f"activities[{index}] duplicates another activity earlier in this batch. Nothing was "
        "created.",
        retryable=True,
        recovery="Give each activity a distinct position and organization pair, or remove the "
        "duplicate and resubmit.",
    )


# --------------------------------------------------------------------------
# create_activities
# --------------------------------------------------------------------------


def make_create_activities_tool(ctx: ToolCtx) -> Tool[Any]:
    async def create_activities(
        activities: list[ActivityDraft], force: bool = False
    ) -> dict[str, Any]:
        """Create one or more Common App activities, appending them to the importance
        order. Check view_activities first: a same-position, same-organization active
        activity rejects the whole batch unless force=true after confirming it is
        genuinely separate. The Common App allows only 10 activities.

        The character budgets are warnings, not blocks: position 50, organization
        100, and description 150 characters. Never invent facts to make an entry
        sound stronger. Use story for the student's full private raw material, then
        distill its truthful export description. Reorder after creating if the
        student's wording implies a different importance rank.

        Args:
            activities: Activities to create, 1-20 per call, subject to the 10-slot cap.
            force: Override an exact active duplicate only after confirming it is separate.
                Never lets two activities in the same call share a position and
                organization — that duplicate is always rejected.
        """
        payload = await _create_activities_impl(ctx, activities, force)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="create_activities")  # type: ignore[no-any-return]

    return Tool(create_activities, takes_ctx=False)


async def _create_activities_impl(
    ctx: ToolCtx, drafts: list[ActivityDraft], force: bool
) -> dict[str, Any]:
    if not (BATCH_MIN <= len(drafts) <= BATCH_MAX):
        return batch_size_error("create_activities", len(drafts))

    try:
        created = await service_activities.create_activities(
            ctx.app_pool,
            ctx.workspace_events,
            user_id=ctx.user_id,
            actor="counselle",
            data=[
                ActivityCreate(
                    activity_type=draft.type,
                    position=draft.position,
                    organization=draft.organization,
                    description=draft.description,
                    grades=[str(grade) for grade in draft.grades],
                    timing=[str(value) for value in draft.timing],
                    hours_per_week=draft.hours_per_week,
                    weeks_per_year=draft.weeks_per_year,
                    continue_in_college=draft.continue_in_college,
                    story=draft.story,
                )
                for draft in drafts
            ],
            reject_duplicate_pairs=not force,
        )
    except ActivityDuplicateError as exc:
        return _duplicate_activity_error(exc)
    except WorkspaceValidationError:
        active = await service_activities.list_activities(ctx.app_pool, user_id=ctx.user_id)
        return slot_cap_error("activity", MAX_ACTIVITIES, len(active))

    ordered = await service_activities.list_activities(ctx.app_pool, user_id=ctx.user_id)
    ranks = {activity.id: index for index, activity in enumerate(ordered, start=1)}
    payload: dict[str, Any] = {
        "status": "ok",
        "today": today(),
        "summary": f"Created {len(created)} activit{'y' if len(created) == 1 else 'ies'}.",
        "activities": [
            render_activity_row(activity, rank=ranks[activity.id]) for activity in created
        ],
        "footer": "New activities were appended to the current importance order. Use "
        "reorder_activities if their rank should change.",
    }
    if warning := _activity_warning(created):
        payload["warning"] = warning
    items = [
        batch_item(index, "changed", item_subject=subject(activity.position, activity.id))
        for index, activity in enumerate(created)
    ]
    payload = attach_mutation(
        payload, batch_receipt(family="activity", action="create", items=items)
    )
    return payload


# --------------------------------------------------------------------------
# update_activity
# --------------------------------------------------------------------------


def make_update_activity_tool(ctx: ToolCtx) -> Tool[Any]:
    async def update_activity_tool(
        activity_id: str,
        type: ActivityType | None = None,
        position: str | None = None,
        organization: str | None = None,
        description: str | None = None,
        grades: list[Grade] | None = None,
        timing: list[Timing] | None = None,
        hours_per_week: _BoundedHours | Literal["clear"] | None = None,
        weeks_per_year: _BoundedWeeks | Literal["clear"] | None = None,
        continue_in_college: bool | Literal["clear"] | None = None,
        story: str | Literal["clear"] | None = None,
    ) -> dict[str, Any]:
        """Change one activity. Pass only fields that should change; lists replace the
        whole current list. Pass "clear" to remove hours_per_week, weeks_per_year,
        continue_in_college, or story. Rank is not editable here: use
        reorder_activities with every active id to change Common App importance order.

        Args:
            activity_id: Exact active id from view_activities.
            type: Common App activity type.
            position: Role or leadership title; an empty string is allowed.
            organization: Organization name; an empty string is allowed.
            description: Truthful Common App description; an empty string is allowed.
            grades: Grades participating; replaces the whole list.
            timing: Participation timing; replaces the whole list.
            hours_per_week: 1-168, or "clear".
            weeks_per_year: 1-52, or "clear".
            continue_in_college: Whether it will continue in college, or "clear".
            story: Private source material, or "clear".
        """
        payload = await _update_activity_impl(
            ctx,
            activity_id,
            type=type,
            position=position,
            organization=organization,
            description=description,
            grades=grades,
            timing=timing,
            hours_per_week=hours_per_week,
            weeks_per_year=weeks_per_year,
            continue_in_college=continue_in_college,
            story=story,
        )
        return process_tool_result(payload, ctx.tool_overflow, tool_name="update_activity")  # type: ignore[no-any-return]

    return Tool(update_activity_tool, takes_ctx=False, name="update_activity")


async def _update_activity_impl(ctx: ToolCtx, activity_id: str, **fields: Any) -> dict[str, Any]:
    if all(value is None for value in fields.values()):
        return error(
            "No fields provided — nothing to update.",
            retryable=True,
            recovery="Pass at least one field to change.",
        )
    parsed_id = try_uuid(activity_id)
    if parsed_id is None:
        return stale_activity_error(activity_id)

    patch: dict[str, Any] = {}
    if fields["type"] is not None:
        patch["activity_type"] = fields["type"]
    for key in ("position", "organization", "description", "grades", "timing"):
        if fields[key] is not None:
            patch[key] = fields[key]
    for key in ("hours_per_week", "weeks_per_year", "continue_in_college", "story"):
        value = fields[key]
        if value is not None:
            patch[key] = None if value == _CLEARABLE else value

    try:
        activity, before = await service_activities.update_activity(
            ctx.app_pool,
            ctx.workspace_events,
            user_id=ctx.user_id,
            actor="counselle",
            activity_id=parsed_id,
            data=ActivityPatch(**patch),
        )
    except WorkspaceNotFoundError:
        return stale_activity_error(activity_id)

    payload: dict[str, Any] = {
        "status": "ok",
        "today": today(),
        "summary": _activity_summary(activity, patch),
        "activity": render_activity_row(activity, rank=await _activity_rank(ctx, activity.id)),
    }
    if warning := _activity_warning([activity]):
        payload["warning"] = warning
    activity_changes = _activity_changes(before, patch)
    if activity_changes:
        receipt = update_receipt(
            family="activity",
            action="update",
            update_subject=subject(activity.position, activity.id),
            changes=activity_changes,
        )
        payload = attach_mutation(payload, receipt)
    return payload


_RECEIPT_FIELD_KEY = {
    "activity_type": "type",
    "position": "position",
    "organization": "organization",
    "grades": "grades",
    "timing": "timing",
    "hours_per_week": "hours_per_week",
    "weeks_per_year": "weeks_per_year",
    "continue_in_college": "continuation",
    "description": "description",
    "story": "story",
}


def _activity_changes(before: Activity, patch: dict[str, Any]) -> list[MutationChange]:
    """Typed field changes for the exposure-matrix-allowed activity fields.

    ``description`` and ``story`` are ``changed_only`` (§8.2) — never their
    text content, only that they changed or were cleared.
    """
    changes: list[MutationChange] = []
    for key, field_key in _RECEIPT_FIELD_KEY.items():
        if key not in patch:
            continue
        value = patch[key]
        if key in ("description", "story"):
            changes.append(change(field_key, "clear" if value is None else "state_only"))
        elif key == "activity_type":
            changes.append(
                change(
                    field_key,
                    "replace",
                    before=enum_value(before.activity_type),
                    after=enum_value(value),
                )
            )
        elif key in ("position", "organization"):
            changes.append(
                change(
                    field_key,
                    "replace",
                    before=text_value(getattr(before, key)),
                    after=text_value(value),
                )
            )
        elif key in ("grades", "timing"):
            changes.append(
                change(
                    field_key,
                    "replace",
                    before=text_list_value(list(getattr(before, key))),
                    after=text_list_value(list(value)),
                )
            )
        elif key in ("hours_per_week", "weeks_per_year"):
            before_value = getattr(before, key)
            if value is None:
                changes.append(change(field_key, "clear"))
            elif before_value is None:
                changes.append(change(field_key, "set", after=integer_value(value)))
            else:
                changes.append(
                    change(
                        field_key,
                        "replace",
                        before=integer_value(before_value),
                        after=integer_value(value),
                    )
                )
        else:  # continue_in_college
            before_value = before.continue_in_college
            if value is None:
                changes.append(change(field_key, "clear"))
            elif before_value is None:
                changes.append(change(field_key, "set", after=boolean_value(value)))
            else:
                changes.append(
                    change(
                        field_key,
                        "replace",
                        before=boolean_value(before_value),
                        after=boolean_value(value),
                    )
                )
    return changes


async def _activity_rank(ctx: ToolCtx, activity_id: UUID) -> int | None:
    activities = await service_activities.list_activities(ctx.app_pool, user_id=ctx.user_id)
    return next(
        (index for index, activity in enumerate(activities, start=1) if activity.id == activity_id),
        None,
    )


# --------------------------------------------------------------------------
# archive_activities / restore_activity
# --------------------------------------------------------------------------


def make_archive_activities_tool(ctx: ToolCtx) -> Tool[Any]:
    async def archive_activities(activity_ids: list[str]) -> dict[str, Any]:
        """Remove activities from the current page. This is a soft delete:
        restore_activity can bring an archived entry back. Confirm before removing
        an activity, especially a high-ranked one. Unknown or already archived ids
        are skipped while valid ids still archive.

        Args:
            activity_ids: Exact activity ids from view_activities, 1-20 per call.
        """
        payload = await _archive_activities_impl(ctx, activity_ids)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="archive_activities")  # type: ignore[no-any-return]

    return Tool(archive_activities, takes_ctx=False)


async def _archive_activities_impl(ctx: ToolCtx, activity_ids: list[str]) -> dict[str, Any]:
    if not (BATCH_MIN <= len(activity_ids) <= BATCH_MAX):
        return batch_size_error("archive_activities", len(activity_ids))

    active_positions = {
        activity.id: activity.position
        for activity in await service_activities.list_activities(ctx.app_pool, user_id=ctx.user_id)
    }
    archived: list[str] = []
    skipped: list[dict[str, str]] = []
    items = []
    for index, raw_id in enumerate(activity_ids):
        parsed_id = try_uuid(raw_id)
        if parsed_id is None:
            skipped.append({"id": raw_id, "reason": "not a valid activity id"})
            items.append(batch_item(index, "skipped", reason="not a valid activity id"))
            continue
        try:
            await service_activities.archive_activity(
                ctx.app_pool,
                ctx.workspace_events,
                user_id=ctx.user_id,
                actor="counselle",
                activity_id=parsed_id,
            )
            archived.append(raw_id)
            items.append(
                batch_item(
                    index,
                    "changed",
                    item_subject=subject(active_positions.get(parsed_id, "Activity"), parsed_id),
                )
            )
        except WorkspaceNotFoundError:
            skipped.append({"id": raw_id, "reason": "no active activity with this id"})
            items.append(batch_item(index, "skipped", reason="no active activity with this id"))

    if not archived and len(activity_ids) == 1:
        return stale_activity_error(activity_ids[0])
    if not archived:
        return error(
            "No active activities found among the given ids. They may have been archived, or "
            "the ids may be stale.",
            retryable=False,
            recovery=stale_activity_error(activity_ids[0])["recovery"],
        )
    payload: dict[str, Any] = {
        "status": "warning" if skipped else "ok",
        "today": today(),
        "summary": f"Archived {len(archived)} activit{'y' if len(archived) == 1 else 'ies'}.",
        "archived": archived,
        "footer": "restore_activity(activity_id=...) undoes any of these.",
    }
    if skipped:
        payload["skipped"] = skipped
    payload = attach_mutation(
        payload, batch_receipt(family="activity", action="archive", items=items)
    )
    return payload


def make_restore_activity_tool(ctx: ToolCtx) -> Tool[Any]:
    async def restore_activity_tool(activity_id: str) -> dict[str, Any]:
        """Bring one archived activity back to the page. Find archived ids with
        view_activities(status="archived"). The restored item appends to the
        active importance order; the returned rank is its actual Common App rank.

        Args:
            activity_id: Archived activity id from view_activities(status="archived").
        """
        payload = await _restore_activity_impl(ctx, activity_id)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="restore_activity")  # type: ignore[no-any-return]

    return Tool(restore_activity_tool, takes_ctx=False, name="restore_activity")


async def _restore_activity_impl(ctx: ToolCtx, activity_id: str) -> dict[str, Any]:
    parsed_id = try_uuid(activity_id)
    if parsed_id is None:
        return stale_activity_error(activity_id)
    # UX-only best-effort pre-check for a fast, specific error message.
    # service_activities.restore_activity re-locks and re-validates
    # authoritatively inside its own transaction, so a stale read here just
    # falls through to that call's error handling below.
    async with ctx.app_pool.acquire() as conn:
        probe = await conn.fetchrow(
            "SELECT position_label, archived_at FROM counselle.activities "
            "WHERE id = $1 AND user_id = $2",
            parsed_id,
            ctx.user_id,
        )
    if probe is None:
        return stale_activity_error(activity_id)
    if probe["archived_at"] is None:
        return error(
            f'"{probe["position_label"]}" is not archived — it is already on the active page.',
            retryable=False,
            recovery="No action needed. view_activities confirms its current state.",
        )

    active = await service_activities.list_activities(ctx.app_pool, user_id=ctx.user_id)
    if len(active) >= MAX_ACTIVITIES:
        return slot_cap_error("activity", MAX_ACTIVITIES, len(active))
    try:
        activity = await service_activities.restore_activity(
            ctx.app_pool,
            ctx.workspace_events,
            user_id=ctx.user_id,
            actor="counselle",
            activity_id=parsed_id,
        )
    except WorkspaceNotFoundError:
        return stale_activity_error(activity_id)
    except WorkspaceValidationError:
        active = await service_activities.list_activities(ctx.app_pool, user_id=ctx.user_id)
        return slot_cap_error("activity", MAX_ACTIVITIES, len(active))

    ordered = await service_activities.list_activities(ctx.app_pool, user_id=ctx.user_id)
    rank = next(
        (index for index, item in enumerate(ordered, start=1) if item.id == activity.id), None
    )
    summary = (
        f'Restored "{activity.position}" at rank {rank}.'
        if rank is not None
        else f'Restored "{activity.position}".'
    )
    payload: dict[str, Any] = {
        "status": "ok",
        "today": today(),
        "summary": summary,
        "activity": render_activity_row(activity, rank=rank),
    }
    receipt = state_transition_receipt(
        family="activity",
        action="restore",
        state="restored",
        subjects=[subject(activity.position, activity.id)],
    )
    return attach_mutation(payload, receipt)


# --------------------------------------------------------------------------
# reorder_activities
# --------------------------------------------------------------------------


def make_reorder_activities_tool(ctx: ToolCtx) -> Tool[Any]:
    async def reorder_activities(ids: list[str]) -> dict[str, Any]:
        """Set the complete active activities list to this new importance order.
        Pass every active id from view_activities, most important first: rank 1 is
        the headline activity admissions officers see first. This is atomic.

        Args:
            ids: Every active activity id, exactly once, in its new rank order.
        """
        payload = await _reorder_activities_impl(ctx, ids)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="reorder_activities")  # type: ignore[no-any-return]

    return Tool(reorder_activities, takes_ctx=False)


async def _reorder_activities_impl(ctx: ToolCtx, ids: list[str]) -> dict[str, Any]:
    parsed_ids: list[UUID] = []
    for raw_id in ids:
        parsed_id = try_uuid(raw_id)
        if parsed_id is None:
            return error(
                _REORDER_RECOVERY,
                retryable=True,
                recovery=_REORDER_RECOVERY,
            )
        parsed_ids.append(parsed_id)
    try:
        activities, old_ranks_by_id = await service_activities.reorder_activities(
            ctx.app_pool,
            ctx.workspace_events,
            user_id=ctx.user_id,
            actor="counselle",
            ids=parsed_ids,
            with_old_ranks=True,
        )
    except (WorkspaceNotFoundError, WorkspaceValidationError):
        return error(_REORDER_RECOVERY, retryable=True, recovery=_REORDER_RECOVERY)
    payload: dict[str, Any] = {
        "status": "ok",
        "today": today(),
        "summary": f"Reordered {len(activities)} activit{'y' if len(activities) == 1 else 'ies'}.",
        "activities": [
            render_activity_row(activity, rank=index)
            for index, activity in enumerate(activities, start=1)
        ],
        "footer": "Rank is Common App importance order: 1 is the headline activity.",
    }
    # `activities` is already in the requested new order (§7.3); old_ranks and
    # the first moved position are authoritative from the same locked
    # reorder transaction — never inferred.
    new_order = [subject(activity.position, activity.id) for activity in activities]
    old_ranks = [old_ranks_by_id[activity.id] for activity in activities]
    moved_index = next(
        (i for i, old_rank in enumerate(old_ranks) if old_rank != i + 1), None
    )
    return attach_mutation(
        payload,
        reorder_receipt(
            family="activity",
            new_order=new_order,
            old_ranks=old_ranks,
            moved_index=moved_index,
            moved_from_rank=old_ranks[moved_index] if moved_index is not None else None,
        ),
    )
