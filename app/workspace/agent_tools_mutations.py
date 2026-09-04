"""Mutation tools for the workspace agent: create/update/archive/restore tasks.

Split out of ``agent_tools.py`` purely to keep each module under the
file-size convention — see that module's docstring for the full picture and
``build_workspace_tools``, the single public entry point.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from pydantic_ai import Tool

from app.tool_middleware import process_tool_result
from app.workspace import service_tasks
from app.workspace.agent_tools_shared import (
    BATCH_MAX,
    BATCH_MIN,
    DATE_RECOVERY,
    LINK_RECOVERY,
    STALE_TASK_RECOVERY,
    TaskDraft,
    ToolCtx,
    active_workspace_links,
    application_name,
    batch_size_error,
    error,
    essay_name,
    find_similar_active_task,
    link_targets,
    render_task_row,
    resolve_link,
    stale_task_error,
    try_uuid,
    validate_date_only,
)
from app.workspace.models import (
    Task,
    TaskCategory,
    TaskCreate,
    TaskPatch,
    WorkspaceNotFoundError,
    WorkspaceValidationError,
)
from app.workspace_mutation_receipts import (
    attach_mutation,
    batch_item,
    batch_receipt,
    boolean_value,
    change,
    date_value,
    enum_value,
    reference_value,
    state_transition_receipt,
    subject,
    text_value,
    update_receipt,
)
from domain.mutation_receipts import MutationChange, MutationChangeOperation, MutationValue

# --------------------------------------------------------------------------
# A.3 create_tasks
# --------------------------------------------------------------------------


def make_create_tasks_tool(ctx: ToolCtx) -> Tool[Any]:
    async def create_tasks(tasks: list[TaskDraft], force: bool = False) -> dict[str, Any]:
        """Create one or more tasks on the student's board. All-or-nothing: either every
        task in the batch is created, or none are — a rejected batch creates nothing,
        so it is always safe to fix the reported item and resubmit the whole batch.

        Check view_tasks (or search_tasks) first so you don't duplicate existing
        work. If a draft's title is nearly identical to an existing active task, the
        whole batch is rejected with the matching task listed; either update that
        existing task instead, or resubmit with force=true if the student really
        wants a separate task.

        Link each task to its application and/or essay whenever one clearly applies,
        using exact ids from view_tasks link_targets — linked tasks appear on that
        application's page. Defaults per task: category "other", flagged false.
        "when" is the day the student plans to work on it; "deadline" is an
        external date — if the task is linked to an application, an unset
        deadline inherits that application's deadline for display (never write
        it here, just leave deadline unset).

        Args:
            tasks: The tasks to create, 1-20 per call.
            force: True only to re-submit a batch that was rejected as a
                near-duplicate after confirming it is genuinely separate work.
        """
        payload = await _create_tasks_impl(ctx, tasks, force)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="create_tasks")  # type: ignore[no-any-return]

    return Tool(create_tasks, takes_ctx=False)


def _draft_to_task_create(draft: TaskDraft, parsed: dict[str, Any]) -> TaskCreate:
    return TaskCreate(
        title=draft.title,
        application_id=parsed["application_id"],
        essay_id=parsed["essay_id"],
        requirement_kind=draft.requirement_kind,
        notes=draft.notes,
        category=draft.category,
        flagged=draft.flagged,
        when_on=parsed["when_on"],
        deadline_on=parsed["deadline_on"],
    )


def _parse_draft(
    index: int, draft: TaskDraft, active_app_ids: set[UUID], active_essay_ids: set[UUID]
) -> tuple[dict[str, Any] | None, tuple[int, str] | None]:
    """Validate one draft; returns (parsed_fields, None) or (None, (index, message))."""
    app_uuid, app_error = resolve_link(draft.application_id, "application_id", active_app_ids)
    if app_error:
        return None, (index, app_error)
    essay_uuid, essay_error = resolve_link(draft.essay_id, "essay_id", active_essay_ids)
    if essay_error:
        return None, (index, essay_error)
    when_on, deadline_on = None, None
    if draft.when is not None:
        when_on, date_error = validate_date_only(draft.when, "when")
        if date_error:
            return None, (index, date_error)
    if draft.deadline is not None:
        deadline_on, date_error = validate_date_only(draft.deadline, "deadline")
        if date_error:
            return None, (index, date_error)
    return {
        "application_id": app_uuid,
        "essay_id": essay_uuid,
        "when_on": when_on,
        "deadline_on": deadline_on,
    }, None


async def _create_tasks_impl(
    ctx: ToolCtx, drafts: list[TaskDraft], force: bool
) -> dict[str, Any]:
    if not (BATCH_MIN <= len(drafts) <= BATCH_MAX):
        return batch_size_error("create_tasks", len(drafts))

    apps, essays = await active_workspace_links(ctx)
    active_app_ids = {app.id for app in apps}
    active_essay_ids = {essay.id for essay in essays}
    targets = link_targets(apps, essays)

    parsed: list[dict[str, Any]] = []
    for index, draft in enumerate(drafts):
        fields, err = _parse_draft(index, draft, active_app_ids, active_essay_ids)
        if err is not None:
            err_index, message = err
            is_date_error = "is not a valid date" in message
            if is_date_error:
                return error(
                    f"tasks[{err_index}]: {message}", retryable=True, recovery=DATE_RECOVERY
                )
            return error(
                f"tasks[{err_index}]: {message} Nothing was created.",
                retryable=True,
                recovery=LINK_RECOVERY,
                link_targets=targets,
            )
        assert fields is not None  # nosec B101 - error branches above narrow this
        parsed.append(fields)

    warnings: list[str] = []
    for index, draft in enumerate(drafts):
        match = await find_similar_active_task(ctx, draft.title)
        if match is None:
            continue
        message = (
            f'tasks[{index}] "{draft.title}" is nearly identical to the existing active task '
            f'"{match["title"]}" (id {match["id"]}, status {match["status"]}).'
        )
        if not force:
            return error(
                f"{message} Nothing was created.",
                retryable=True,
                recovery=(
                    "Update the existing task instead (update_task), or if the student "
                    "genuinely wants a separate task, resubmit the same batch with force=true."
                ),
            )
        warnings.append(message)

    try:
        # One service transaction for the whole batch, mirroring
        # create_essays_batch/create_honors_batch — a validation/TOCTOU
        # failure on any draft rolls back every insert, matching the tool's
        # all-or-nothing promise.
        created_tasks: list[Task] = await service_tasks.create_tasks_batch(
            ctx.app_pool,
            ctx.workspace_events,
            user_id=ctx.user_id,
            actor="counselle",
            data=[
                _draft_to_task_create(draft, fields)
                for draft, fields in zip(drafts, parsed, strict=True)
            ],
        )
    except (WorkspaceNotFoundError, WorkspaceValidationError) as exc:
        return error(
            f"Nothing was created — {exc}",
            retryable=True,
            recovery="Call view_tasks to check the linked applications/essays are still "
            "active, then resubmit the whole batch.",
        )

    created = [{"id": str(task.id), "title": task.title} for task in created_tasks]
    items = [
        batch_item(index, "changed", item_subject=subject(task.title, task.id))
        for index, task in enumerate(created_tasks)
    ]

    payload: dict[str, Any] = {
        "status": "warning" if warnings else "ok",
        "summary": f"Created {len(created)} task{'' if len(created) == 1 else 's'}.",
        "created": created,
        "footer": "The student sees these on their board now.",
        "ui": {
            "widget": "task_added",
            "data": {
                "title": created[0]["title"] if len(created) == 1 else f"{len(created)} tasks",
                "count": len(created),
            },
        },
    }
    if warnings:
        payload["warnings"] = warnings
    payload = attach_mutation(payload, batch_receipt(family="task", action="create", items=items))
    return payload


# --------------------------------------------------------------------------
# A.4 update_task
# --------------------------------------------------------------------------


def make_update_task_tool(ctx: ToolCtx) -> Tool[Any]:
    async def update_task(
        task_id: str,
        title: str | None = None,
        notes: str | None = None,
        category: TaskCategory | None = None,
        flagged: bool | None = None,
        when: str | None = None,
        deadline: str | None = None,
        done: bool | None = None,
        application_id: str | None = None,
        essay_id: str | None = None,
    ) -> dict[str, Any]:
        """Change one existing task. Only the fields you pass change; everything else is
        untouched.

        task_id must be an exact id echoed from a view_tasks or search_tasks result
        in this conversation — never construct or guess an id. Typical moves:
        done=true when finished (completion time is recorded automatically — use
        this instead of archiving finished work), when/deadline changes, flipping
        flagged, or linking the task to an application/essay using ids from
        view_tasks link_targets.

        To CLEAR an optional field, pass the string "clear" for that field
        (clearable: notes, when, deadline, application_id, essay_id).

        Args:
            task_id: The task's id, echoed exactly from a prior result.
            title: New title.
            notes: New notes, or "clear" to remove them.
            category: New category.
            flagged: The student's own priority mark.
            when: New "when" date (the day the student plans to work on it) as
                YYYY-MM-DD, or "clear" to remove it.
            deadline: New deadline date as YYYY-MM-DD, or "clear" to remove it —
                clearing returns the task to inheriting its linked application's
                deadline for display (spec §2.4), it does not delete anything.
            done: True to mark finished (sets completion time), False to reopen.
            application_id: Link to this application (exact id from link_targets),
                or "clear" to unlink.
            essay_id: Link to this essay (exact id from link_targets), or "clear" to
                unlink.
        """
        payload = await _update_task_impl(
            ctx,
            task_id,
            title=title,
            notes=notes,
            category=category,
            flagged=flagged,
            when=when,
            deadline=deadline,
            done=done,
            application_id=application_id,
            essay_id=essay_id,
        )
        return process_tool_result(payload, ctx.tool_overflow, tool_name="update_task")  # type: ignore[no-any-return]

    return Tool(update_task, takes_ctx=False)


_SUMMARY_ROW_KEYS = {
    "title": "title",
    "application_id": "app",
    "essay_id": "essay",
    "notes": "notes",
    "category": "category",
    "flagged": "flagged",
    "when_on": "when",
    "deadline_on": "deadline",
    "done_at": "done",
}


def _change_summary(title: str, patch: dict[str, Any], row: dict[str, Any]) -> str:
    parts: list[str] = []
    for key, row_key in _SUMMARY_ROW_KEYS.items():
        if key not in patch:
            continue
        raw = patch[key]
        if key in ("flagged", "done_at"):
            value: Any = "true" if raw else "false"
        elif raw is None:
            value = "cleared"
        else:
            value = row.get(row_key, raw)
        parts.append(f"{row_key} → {value}")
    return f'Updated "{title}" — ' + ", ".join(parts) + "."


def _build_task_patch(
    fields: dict[str, Any], active_app_ids: set[UUID], active_essay_ids: set[UUID]
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    patch: dict[str, Any] = {}
    for key in ("title", "notes", "category", "flagged"):
        value = fields.get(key)
        if value is None:
            continue
        patch[key] = None if (key == "notes" and value == "clear") else value

    for patch_key, param_key in (
        ("when_on", "when"),
        ("deadline_on", "deadline"),
    ):
        value = fields.get(param_key)
        if value is None:
            continue
        if value == "clear":
            patch[patch_key] = None
            continue
        parsed, date_err = validate_date_only(value, param_key)
        if date_err:
            return {}, error(date_err, retryable=True, recovery=DATE_RECOVERY)
        patch[patch_key] = parsed

    done = fields.get("done")
    if done is not None:
        patch["done_at"] = datetime.now(UTC) if done else None

    for patch_key, ids in (
        ("application_id", active_app_ids),
        ("essay_id", active_essay_ids),
    ):
        value = fields.get(patch_key)
        if value is None:
            continue
        if value == "clear":
            patch[patch_key] = None
            continue
        resolved, link_err = resolve_link(value, patch_key, ids)
        if link_err:
            return {}, error(
                f"{link_err} Nothing was changed.",
                retryable=True,
                recovery="Pick the exact id from view_tasks link_targets and resubmit.",
            )
        patch[patch_key] = resolved

    return patch, None


def _link_op_value(
    before_id: UUID | None, after_id: UUID | None, apps: list[Any], essays: list[Any], *, kind: str
) -> tuple[MutationChangeOperation, MutationValue | None, MutationValue | None]:
    resolver = application_name if kind == "application_id" else essay_name
    links = apps if kind == "application_id" else essays
    if after_id is None:
        return "clear", None, None
    after_value = reference_value(subject(resolver(after_id, links) or "Linked"))
    if before_id is None:
        return "set", None, after_value
    before_value = reference_value(subject(resolver(before_id, links) or "Linked"))
    return "replace", before_value, after_value


def _task_changes(
    before: Any, patch_kwargs: dict[str, Any], apps: list[Any], essays: list[Any]
) -> list[MutationChange]:
    changes: list[MutationChange] = []
    if "title" in patch_kwargs:
        changes.append(
            change(
                "title",
                "replace",
                before=text_value(before.title),
                after=text_value(patch_kwargs["title"]),
            )
        )
    if "notes" in patch_kwargs:
        changes.append(change("notes", "clear" if patch_kwargs["notes"] is None else "state_only"))
    if "category" in patch_kwargs:
        changes.append(
            change(
                "category",
                "replace",
                before=enum_value(str(before.category)),
                after=enum_value(str(patch_kwargs["category"])),
            )
        )
    if "flagged" in patch_kwargs:
        changes.append(
            change(
                "flagged",
                "replace",
                before=boolean_value(bool(before.flagged)),
                after=boolean_value(bool(patch_kwargs["flagged"])),
            )
        )
    if "done_at" in patch_kwargs:
        changes.append(
            change(
                "done_at",
                "replace",
                before=boolean_value(before.done_at is not None),
                after=boolean_value(patch_kwargs["done_at"] is not None),
            )
        )
    for field_key in ("when_on", "deadline_on"):
        if field_key in patch_kwargs:
            after_raw = patch_kwargs[field_key]
            before_raw = getattr(before, field_key)
            if after_raw is None:
                changes.append(change(field_key, "clear"))
            elif before_raw is None:
                changes.append(change(field_key, "set", after=date_value(str(after_raw))))
            else:
                changes.append(
                    change(
                        field_key,
                        "replace",
                        before=date_value(str(before_raw)),
                        after=date_value(str(after_raw)),
                    )
                )
    for field_key in ("application_id", "essay_id"):
        if field_key in patch_kwargs:
            op, before_value, after_value = _link_op_value(
                getattr(before, field_key),
                patch_kwargs[field_key],
                apps,
                essays,
                kind=field_key,
            )
            changes.append(change(field_key, op, before=before_value, after=after_value))
    return changes


async def _update_task_impl(ctx: ToolCtx, task_id: str, **fields: Any) -> dict[str, Any]:
    parsed_id = try_uuid(task_id)
    if parsed_id is None:
        return stale_task_error(task_id)

    apps, essays = await active_workspace_links(ctx)
    active_app_ids = {app.id for app in apps}
    active_essay_ids = {essay.id for essay in essays}

    patch_kwargs, patch_error = _build_task_patch(fields, active_app_ids, active_essay_ids)
    if patch_error is not None:
        return patch_error

    try:
        task, before = await service_tasks.update_task(
            ctx.app_pool,
            ctx.workspace_events,
            user_id=ctx.user_id,
            actor="counselle",
            task_id=parsed_id,
            data=TaskPatch(**patch_kwargs),
        )
    except WorkspaceNotFoundError:
        return stale_task_error(task_id)

    app_name = application_name(task.application_id, apps)
    essay_display_name = essay_name(task.essay_id, essays)
    row = render_task_row(
        task,
        app_name=app_name,
        essay_name=essay_display_name,
    )
    payload: dict[str, Any] = {
        "status": "ok",
        "summary": _change_summary(task.title, patch_kwargs, row),
        "task": row,
    }
    task_changes = _task_changes(before, patch_kwargs, apps, essays)
    if task_changes:
        receipt = update_receipt(
            family="task",
            action="update",
            update_subject=subject(task.title, task.id),
            changes=task_changes,
        )
        payload = attach_mutation(payload, receipt)
    return payload


# --------------------------------------------------------------------------
# A.5 archive_tasks
# --------------------------------------------------------------------------


def make_archive_tasks_tool(ctx: ToolCtx) -> Tool[Any]:
    async def archive_tasks(task_ids: list[str]) -> dict[str, Any]:
        """Remove tasks from the student's board. This is a soft delete — restore_task
        brings any of them back exactly as they were.

        Use for tasks that are no longer relevant: wrong school, duplicates, a plan
        that changed. Do NOT archive finished work — mark it done with update_task
        so the record of progress stays visible.

        Confirm with the student first before archiving more than two tasks at once,
        or any task that is in "doing" or "waiting". Each id must be echoed from a
        prior view_tasks or search_tasks result. Unknown or already-archived ids are
        skipped and reported; the rest still archive.

        Args:
            task_ids: Ids of the tasks to archive, 1-20.
        """
        payload = await _archive_tasks_impl(ctx, task_ids)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="archive_tasks")  # type: ignore[no-any-return]

    return Tool(archive_tasks, takes_ctx=False)


async def _archive_tasks_impl(ctx: ToolCtx, task_ids: list[str]) -> dict[str, Any]:
    if not (BATCH_MIN <= len(task_ids) <= BATCH_MAX):
        return batch_size_error("archive_tasks", len(task_ids))

    parsed: dict[str, UUID] = {}
    skipped: list[dict[str, str]] = []
    for raw_id in task_ids:
        uuid_id = try_uuid(raw_id)
        if uuid_id is None:
            skipped.append({"id": raw_id, "reason": "not a valid task id"})
        else:
            parsed[raw_id] = uuid_id

    active_rows: dict[UUID, str] = {}
    if parsed:
        async with ctx.app_pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, title FROM counselle.tasks
                WHERE user_id = $1 AND id = ANY($2::uuid[]) AND archived_at IS NULL
                """,
                ctx.user_id,
                list(parsed.values()),
            )
        active_rows = {row["id"]: row["title"] for row in rows}

    to_archive: list[UUID] = []
    for raw_id, uuid_id in parsed.items():
        if uuid_id in active_rows:
            to_archive.append(uuid_id)
        else:
            skipped.append({"id": raw_id, "reason": "not found or already archived"})

    archived_ids = await service_tasks.bulk_archive(
        ctx.app_pool,
        ctx.workspace_events,
        user_id=ctx.user_id,
        actor="counselle",
        ids=to_archive,
    )
    archived = [{"id": str(task_id), "title": active_rows[task_id]} for task_id in archived_ids]

    if not archived:
        if len(task_ids) == 1:
            return stale_task_error(task_ids[0])
        return error(
            "No active tasks found among the given ids. They may have been archived, "
            "completed and pruned from your view, or the ids may be stale.",
            retryable=False,
            recovery=STALE_TASK_RECOVERY,
        )

    payload: dict[str, Any] = {
        "status": "warning" if skipped else "ok",
        "summary": f"Archived {len(archived)} task{'' if len(archived) == 1 else 's'}.",
        "archived": archived,
        "footer": "restore_task(task_id=...) undoes any of these.",
    }
    if skipped:
        payload["skipped"] = skipped
    skipped_by_id = {row["id"]: row["reason"] for row in skipped}
    archived_uuids = set(archived_ids)
    items = []
    for index, raw_id in enumerate(task_ids):
        uuid_id = parsed.get(raw_id)
        if uuid_id is not None and uuid_id in archived_uuids:
            items.append(
                batch_item(
                    index, "changed", item_subject=subject(active_rows[uuid_id], uuid_id)
                )
            )
        else:
            items.append(
                batch_item(
                    index,
                    "skipped",
                    reason=skipped_by_id.get(raw_id, "not found or already archived"),
                )
            )
    payload = attach_mutation(payload, batch_receipt(family="task", action="archive", items=items))
    return payload


# --------------------------------------------------------------------------
# A.6 restore_task
# --------------------------------------------------------------------------


def make_restore_task_tool(ctx: ToolCtx) -> Tool[Any]:
    async def restore_task(task_id: str) -> dict[str, Any]:
        """Bring one archived task back to the student's board, exactly as it was.

        Find archived tasks with search_tasks — hits marked state "archived". A task
        whose linked application or essay is itself archived cannot be restored on
        its own: restore the application first (that brings back its tasks and
        essays together), or recreate the task without the link using create_tasks.

        Args:
            task_id: The archived task's id, echoed from a search_tasks result.
        """
        payload = await _restore_task_impl(ctx, task_id)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="restore_task")  # type: ignore[no-any-return]

    return Tool(restore_task, takes_ctx=False)


def _restore_blocked_recovery(kind: str) -> str:
    if kind == "application":
        return (
            "Restore the application first (that also restores its tasks and essays), "
            "or recreate the task without the link via create_tasks."
        )
    return (
        "The linked essay needs to be restored before this task can come back, or "
        "recreate the task without the link via create_tasks."
    )


async def _archived_parent(
    ctx: ToolCtx, application_id: UUID | None, essay_id: UUID | None
) -> tuple[str, str] | None:
    """First archived parent (application checked before essay), or None.

    Read-only pre-check kept here (not in ``service_tasks.py``): it exists only
    to produce the specific, teaching A.7 error message before attempting the
    restore — ``service_tasks.restore_task`` itself just raises
    ``WorkspaceNotFoundError`` generically when a parent is archived.
    """
    if application_id is not None:
        async with ctx.app_pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT archived_at, school_unitid FROM counselle.applications "
                "WHERE id = $1 AND user_id = $2",
                application_id,
                ctx.user_id,
            )
        if row is not None and row["archived_at"] is not None:
            name = ctx.catalog.school_name(row["school_unitid"]) or f"School {row['school_unitid']}"
            return "application", name
    if essay_id is not None:
        async with ctx.app_pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT archived_at, title FROM counselle.essays WHERE id = $1 AND user_id = $2",
                essay_id,
                ctx.user_id,
            )
        if row is not None and row["archived_at"] is not None:
            return "essay", row["title"]
    return None


async def _restore_task_impl(ctx: ToolCtx, task_id: str) -> dict[str, Any]:
    parsed_id = try_uuid(task_id)
    if parsed_id is None:
        return stale_task_error(task_id)

    async with ctx.app_pool.acquire() as conn:
        probe = await conn.fetchrow(
            "SELECT title, archived_at, application_id, essay_id FROM counselle.tasks "
            "WHERE id = $1 AND user_id = $2",
            parsed_id,
            ctx.user_id,
        )
    if probe is None:
        return stale_task_error(task_id)
    if probe["archived_at"] is None:
        return error(
            "That task is not archived — it is already on the active board.",
            retryable=False,
            recovery="No action needed. view_tasks confirms its current state.",
        )

    blocked = await _archived_parent(ctx, probe["application_id"], probe["essay_id"])
    if blocked is not None:
        kind, name = blocked
        return error(
            f'"{probe["title"]}" can\'t be restored on its own — its linked {kind} '
            f"({name}) is archived.",
            retryable=False,
            recovery=_restore_blocked_recovery(kind),
        )

    try:
        task = await service_tasks.restore_task(
            ctx.app_pool,
            ctx.workspace_events,
            user_id=ctx.user_id,
            actor="counselle",
            task_id=parsed_id,
        )
    except WorkspaceNotFoundError:
        return stale_task_error(task_id)

    apps, essays = await active_workspace_links(ctx)
    app_name = application_name(task.application_id, apps)
    essay_display_name = essay_name(task.essay_id, essays)
    row = render_task_row(
        task,
        app_name=app_name,
        essay_name=essay_display_name,
    )
    payload: dict[str, Any] = {
        "status": "ok",
        "summary": f'Restored "{task.title}" to the active board.',
        "task": row,
    }
    receipt = state_transition_receipt(
        family="task", action="restore", state="restored", subjects=[subject(task.title, task.id)]
    )
    return attach_mutation(payload, receipt)
