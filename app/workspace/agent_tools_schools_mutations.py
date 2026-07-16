"""Mutation tools for the workspace agent: add/update/archive/restore schools.

Split out of ``agent_tools_schools.py`` purely to keep each module under the
file-size convention — see that module's docstring for the full picture. These
wrap ``service_applications`` directly with ``actor="counselle"`` (ADR 0029).
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg
from pydantic import BaseModel
from pydantic_ai import Tool

from app.tool_middleware import process_tool_result
from app.workspace.agent_tools_schools import render_school_row
from app.workspace.agent_tools_shared import (
    BATCH_MAX,
    BATCH_MIN,
    DATE_RECOVERY,
    ToolCtx,
    batch_size_error,
    error,
    stale_school_error,
    try_uuid,
    validate_date_only,
)
from app.workspace.models import (
    ApplicationCreate,
    ApplicationPatch,
    ApplicationStatus,
    ApplicationView,
    ListType,
    Round,
    WorkspaceNotFoundError,
    WorkspaceValidationError,
)
from app.workspace.service_applications import (
    add_application,
    archive_application,
    restore_application,
    update_application,
)

#: Valid ``test_plan`` values. Typed as ``str`` (not the ``TestPlan`` Literal) on
#: the tool signature so the ``"clear"`` sentinel survives schema validation and
#: reaches _build_application_patch; validated by hand there instead.
_TEST_PLAN_VALUES = ("submit", "withhold", "undecided")

#: Optional-string fields that accept the ``"clear"`` sentinel in update_school.
_CLEARABLE_DATES = (
    ("deadline", "deadline"),
    ("aid_deadline", "aid_deadline"),
    ("scholarship_deadline", "scholarship_deadline"),
)


class SchoolDraft(BaseModel):
    """One school to add in an ``add_schools`` batch."""

    unitid: int
    cycle_year: int
    list_type: ListType = "Target"
    round: Round = "RD"
    deadline: str | None = None


# --------------------------------------------------------------------------
# add_schools
# --------------------------------------------------------------------------


def make_add_schools_tool(ctx: ToolCtx) -> Tool[Any]:
    async def add_schools(schools: list[SchoolDraft]) -> dict[str, Any]:
        """Add one or more schools to the student's list. Each school is created with a
        explicit admissions cycle. Adding a school never creates tasks or essays.

        Get each unitid from search_schools first — never guess one. A school already
        on the student's list is skipped and reported (adding it again does not
        duplicate it); the rest are still added. Defaults per school: list_type
        "Target", round "RD".

        Args:
            schools: The schools to add, 1-20 per call. Each needs a unitid (from
                search_schools), cycle_year (fall enrollment year), and may set
                list_type, round, and a deadline (YYYY-MM-DD).
        """
        payload = await _add_schools_impl(ctx, schools)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="add_schools")  # type: ignore[no-any-return]

    return Tool(add_schools, takes_ctx=False)


async def _add_schools_impl(ctx: ToolCtx, drafts: list[SchoolDraft]) -> dict[str, Any]:
    if not (BATCH_MIN <= len(drafts) <= BATCH_MAX):
        return batch_size_error("add_schools", len(drafts))
    # Validate every deadline up front — a bad date rejects the whole batch so the
    # model fixes it and resubmits, rather than silently adding some and not others.
    for index, draft in enumerate(drafts):
        if draft.deadline is not None:
            _, date_err = validate_date_only(draft.deadline, "deadline")
            if date_err:
                return error(
                    f"schools[{index}]: {date_err} Nothing was added.",
                    retryable=True,
                    recovery=DATE_RECOVERY,
                )

    added: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    for draft in drafts:
        deadline = validate_date_only(draft.deadline, "deadline")[0] if draft.deadline else None
        try:
            result = await add_application(
                ctx.app_pool,
                ctx.catalog,
                ctx.workspace_events,
                user_id=ctx.user_id,
                actor="counselle",
                data=ApplicationCreate(
                    unitid=draft.unitid,
                    cycle_year=draft.cycle_year,
                    list_type=draft.list_type,
                    round=draft.round,
                    deadline=deadline,
                ),
            )
        except WorkspaceValidationError as exc:
            name = ctx.catalog.school_name(draft.unitid) or f"unitid {draft.unitid}"
            skipped.append({"school": name, "reason": str(exc)})
            continue
        app = result.application
        added.append(
            {
                "id": str(app.id),
                "school": app.school_name,
                "cycle_year": app.cycle_year,
            }
        )

    if not added:
        return error(
            "No schools were added — every one was already on the list or not in the catalog.",
            retryable=False,
            recovery="Check view_schools; use search_schools to confirm the unitid.",
            skipped=skipped,
        )

    payload: dict[str, Any] = {
        "status": "warning" if skipped else "ok",
        "summary": f"Added {len(added)} school{'' if len(added) == 1 else 's'} to the list.",
        "added": added,
        "footer": "No tasks or essays were created automatically.",
        "ui": {
            "widget": "school_added",
            "data": {
                "title": added[0]["school"] if len(added) == 1 else f"{len(added)} schools",
                "count": len(added),
            },
        },
    }
    if skipped:
        payload["skipped"] = skipped
    return payload


# --------------------------------------------------------------------------
# update_school
# --------------------------------------------------------------------------


def make_update_school_tool(ctx: ToolCtx) -> Tool[Any]:
    async def update_school(
        application_id: str,
        status: ApplicationStatus | None = None,
        list_type: ListType | None = None,
        round: Round | None = None,
        deadline: str | None = None,
        aid_deadline: str | None = None,
        scholarship_deadline: str | None = None,
        intended_major: str | None = None,
        test_plan: str | None = None,
        notes: str | None = None,
    ) -> dict[str, Any]:
        """Change one school on the student's list. Only the fields you pass change;
        everything else is untouched.

        application_id must be an exact id echoed from a view_schools result — never
        guess an id. This edits active schools only; to change an archived school,
        restore_school it first. Typical moves: advancing status ("Submitted", "Accepted"),
        re-bucketing the list_type, setting an application round or deadlines, the
        intended major, or the testing plan.

        To CLEAR an optional field, pass the string "clear" (clearable: deadline,
        aid_deadline, scholarship_deadline, intended_major, test_plan, notes).

        Args:
            application_id: The school's id, echoed exactly from view_schools.
            status: Application status (e.g. "Applying", "Submitted", "Accepted").
            list_type: "Reach", "Target", or "Safety".
            round: Application round (e.g. "EA", "ED", "RD", "Rolling").
            deadline: Application deadline as YYYY-MM-DD, or "clear".
            aid_deadline: Financial-aid deadline as YYYY-MM-DD, or "clear".
            scholarship_deadline: Scholarship deadline as YYYY-MM-DD, or "clear".
            intended_major: The major the student intends here, or "clear".
            test_plan: "submit", "withhold", or "undecided" — the score plan, or "clear".
            notes: Free notes on this school, or "clear".
        """
        payload = await _update_school_impl(
            ctx,
            application_id,
            status=status,
            list_type=list_type,
            round=round,
            deadline=deadline,
            aid_deadline=aid_deadline,
            scholarship_deadline=scholarship_deadline,
            intended_major=intended_major,
            test_plan=test_plan,
            notes=notes,
        )
        return process_tool_result(payload, ctx.tool_overflow, tool_name="update_school")  # type: ignore[no-any-return]

    return Tool(update_school, takes_ctx=False)


def _build_application_patch(
    fields: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    patch: dict[str, Any] = {}
    # Non-nullable enums: set only when provided (no "clear").
    for key in ("status", "list_type", "round"):
        value = fields.get(key)
        if value is not None:
            patch[key] = value
    # Clearable free-text fields.
    for key in ("intended_major", "notes"):
        value = fields.get(key)
        if value is None:
            continue
        patch[key] = None if value == "clear" else value
    # test_plan: a fixed vocabulary, but clearable — validated by hand because the
    # tool signature is ``str`` (so "clear" is accepted) rather than the enum.
    test_plan = fields.get("test_plan")
    if test_plan is not None:
        if test_plan == "clear":
            patch["test_plan"] = None
        elif test_plan in _TEST_PLAN_VALUES:
            patch["test_plan"] = test_plan
        else:
            return {}, error(
                f'test_plan "{test_plan}" is not valid.',
                retryable=True,
                recovery='Use "submit", "withhold", "undecided", or "clear".',
            )
    # Clearable date fields.
    for patch_key, param_key in _CLEARABLE_DATES:
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
    return patch, None


def _change_summary(name: str, patch: dict[str, Any]) -> str:
    parts = [f"{key} → {'cleared' if value is None else value}" for key, value in patch.items()]
    return f"Updated {name} — " + ", ".join(parts) + "."


async def _update_school_impl(ctx: ToolCtx, application_id: str, **fields: Any) -> dict[str, Any]:
    parsed_id = try_uuid(application_id)
    if parsed_id is None:
        return stale_school_error(application_id)

    patch_kwargs, patch_error = _build_application_patch(fields)
    if patch_error is not None:
        return patch_error
    if not patch_kwargs:
        return error(
            "No changes were given.",
            retryable=True,
            recovery="Pass at least one field to change (status, deadline, notes, …).",
        )

    try:
        app: ApplicationView = await update_application(
            ctx.app_pool,
            ctx.catalog,
            ctx.workspace_events,
            user_id=ctx.user_id,
            actor="counselle",
            application_id=parsed_id,
            data=ApplicationPatch(**patch_kwargs),
        )
    except WorkspaceNotFoundError:
        return stale_school_error(application_id)

    return {
        "status": "ok",
        "summary": _change_summary(app.school_name, patch_kwargs),
        "school": render_school_row(app),
    }


# --------------------------------------------------------------------------
# archive_schools
# --------------------------------------------------------------------------


def make_archive_schools_tool(ctx: ToolCtx) -> Tool[Any]:
    async def archive_schools(application_ids: list[str]) -> dict[str, Any]:
        """Remove schools from the student's list. This is a soft delete that also
        removes each school's linked tasks and essays — restore_school brings any of
        them back together, exactly as they were.

        Use for a school the student dropped or added by mistake. Confirm with the
        student first before archiving more than two schools at once. Each id must be
        echoed from a view_schools result. Unknown or already-archived ids are
        skipped and reported; the rest still archive.

        Args:
            application_ids: Ids of the schools to remove, 1-20.
        """
        payload = await _archive_schools_impl(ctx, application_ids)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="archive_schools")  # type: ignore[no-any-return]

    return Tool(archive_schools, takes_ctx=False)


async def _active_school_names(ctx: ToolCtx, ids: list[UUID]) -> dict[UUID, str]:
    if not ids:
        return {}
    async with ctx.app_pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, school_unitid FROM counselle.applications
            WHERE user_id = $1 AND id = ANY($2::uuid[]) AND archived_at IS NULL
            """,
            ctx.user_id,
            ids,
        )
    return {
        row["id"]: ctx.catalog.school_name(row["school_unitid"]) or f"School {row['school_unitid']}"
        for row in rows
    }


async def _archive_schools_impl(ctx: ToolCtx, application_ids: list[str]) -> dict[str, Any]:
    if not (BATCH_MIN <= len(application_ids) <= BATCH_MAX):
        return batch_size_error("archive_schools", len(application_ids))

    parsed: dict[str, UUID] = {}
    skipped: list[dict[str, str]] = []
    for raw_id in application_ids:
        uuid_id = try_uuid(raw_id)
        if uuid_id is None:
            skipped.append({"id": raw_id, "reason": "not a valid school id"})
        else:
            parsed[raw_id] = uuid_id

    active_names = await _active_school_names(ctx, list(parsed.values()))

    archived: list[dict[str, str]] = []
    for raw_id, uuid_id in parsed.items():
        if uuid_id not in active_names:
            skipped.append({"id": raw_id, "reason": "not found or already archived"})
            continue
        try:
            await archive_application(
                ctx.app_pool,
                ctx.workspace_events,
                user_id=ctx.user_id,
                actor="counselle",
                application_id=uuid_id,
            )
        except WorkspaceNotFoundError:
            skipped.append({"id": raw_id, "reason": "not found or already archived"})
            continue
        except asyncpg.PostgresError as exc:
            # Archives are per-item and each commits independently; a mid-batch DB
            # error leaves earlier ids archived. Report what succeeded plus the
            # failure so the model can retry only the remainder (teaching payload,
            # not a raised exception — ADR 0029). Scoped to DB errors so a genuine
            # programming bug still surfaces loudly rather than being absorbed here.
            return error(
                f'Archiving stopped after a database error on "{raw_id}": {exc}',
                retryable=True,
                recovery=(
                    "Some schools may already be archived. Call view_schools to see the "
                    "current list, then retry archive_schools on the ones still present."
                ),
                archived=archived,
            )
        archived.append({"id": raw_id, "school": active_names[uuid_id]})

    if not archived:
        if len(application_ids) == 1:
            return stale_school_error(application_ids[0])
        return error(
            "No active schools found among the given ids. They may already be archived, "
            "or the ids may be stale.",
            retryable=False,
            recovery=stale_school_error(application_ids[0])["recovery"],
        )

    payload: dict[str, Any] = {
        "status": "warning" if skipped else "ok",
        "summary": f"Archived {len(archived)} school{'' if len(archived) == 1 else 's'}.",
        "archived": archived,
        "footer": (
            "Each also removed its tasks and essays. restore_school(...) undoes any of these."
        ),
    }
    if skipped:
        payload["skipped"] = skipped
    return payload


# --------------------------------------------------------------------------
# restore_school
# --------------------------------------------------------------------------


def make_restore_school_tool(ctx: ToolCtx) -> Tool[Any]:
    async def restore_school(application_id: str) -> dict[str, Any]:
        """Bring one archived school back to the student's list, together with the
        tasks and essays that were removed with it.

        Find archived schools with view_schools(status="archived"). A school can be on
        the list only once: if this same school was added again (on any list) after
        this copy was archived, the restore is blocked — archive the newer copy first,
        or leave this one archived.

        Args:
            application_id: The archived school's id, from view_schools(status="archived").
        """
        payload = await _restore_school_impl(ctx, application_id)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="restore_school")  # type: ignore[no-any-return]

    return Tool(restore_school, takes_ctx=False)


async def _restore_school_impl(ctx: ToolCtx, application_id: str) -> dict[str, Any]:
    parsed_id = try_uuid(application_id)
    if parsed_id is None:
        return stale_school_error(application_id)

    async with ctx.app_pool.acquire() as conn:
        probe = await conn.fetchrow(
            "SELECT school_unitid, archived_at FROM counselle.applications "
            "WHERE id = $1 AND user_id = $2",
            parsed_id,
            ctx.user_id,
        )
    if probe is None:
        return stale_school_error(application_id)
    name = ctx.catalog.school_name(probe["school_unitid"]) or f"School {probe['school_unitid']}"
    if probe["archived_at"] is None:
        return error(
            f"{name} is not archived — it is already on the student's list.",
            retryable=False,
            recovery="No action needed. view_schools confirms its current state.",
        )

    try:
        await restore_application(
            ctx.app_pool,
            ctx.workspace_events,
            user_id=ctx.user_id,
            actor="counselle",
            application_id=parsed_id,
        )
    except WorkspaceValidationError:
        return error(
            f"{name} can't be restored — it is already back on the student's list.",
            retryable=False,
            recovery=(
                "This school was added again after it was archived (a school can be on the "
                "list only once). Archive the newer copy first, or leave this one archived."
            ),
        )
    except WorkspaceNotFoundError:
        return stale_school_error(application_id)

    return {
        "status": "ok",
        "summary": f"Restored {name} to the student's list, with its tasks and essays.",
    }
