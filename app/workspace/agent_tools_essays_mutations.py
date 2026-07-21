"""General-layer mutation tools for essays: create/update/duplicate/archive/restore.

Split out of ``agent_tools_essays.py`` purely to keep each module under the
file-size convention. Content edits (``edit_essay``/``write_essay``) live in
``agent_tools_essays_content.py`` — content is deliberately not a parameter
here (plans/agent-essay-tools.md A.4).
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic_ai import Tool

from app.tool_middleware import process_tool_result
from app.workspace import essay_markdown
from app.workspace.agent_tools_essays import render_essay_row
from app.workspace.agent_tools_shared import (
    BATCH_MAX,
    BATCH_MIN,
    DATE_RECOVERY,
    EssayDraft,
    ToolCtx,
    active_workspace_links,
    application_name,
    batch_size_error,
    error,
    link_targets,
    resolve_link,
    stale_essay_error,
    today,
    try_uuid,
    validate_date_only,
)
from app.workspace.models import (
    Essay,
    EssayCreate,
    EssayPatch,
    EssayStatus,
    EssaySummary,
    EssayType,
    WorkspaceNotFoundError,
    WorkspaceValidationError,
)
from app.workspace.service_essays import (
    archive_essay as _archive_essay_service,
)
from app.workspace.service_essays import (
    create_essays_batch,
    duplicate_essay,
    get_essay,
    update_essay,
)
from app.workspace.service_essays import (
    restore_essay as _restore_essay_service,
)
from app.workspace_mutation_receipts import (
    attach_mutation,
    batch_item,
    batch_receipt,
    change,
    date_value,
    duplicate_receipt,
    enum_value,
    integer_value,
    reference_value,
    state_transition_receipt,
    subject,
    text_value,
    update_receipt,
)
from domain.mutation_receipts import MutationChange

_CLEARABLE = "clear"


# --------------------------------------------------------------------------
# create_essays
# --------------------------------------------------------------------------


def make_create_essays_tool(ctx: ToolCtx) -> Tool[Any]:
    async def create_essays(essays: list[EssayDraft]) -> dict[str, Any]:
        """Create one or more essays in the student's library. All-or-nothing: either
        every essay in the batch is created, or none are.

        Check view_essays first so you don't duplicate an existing essay for the same
        school — an active essay with the same title on the same application rejects
        the whole batch, naming the existing essay so you can update or read it
        instead. Link each essay to its school with the exact id from
        view_schools/link_targets whenever one clearly applies.

        content_markdown is optional — omit it to create an empty essay to draft
        later. If you do include an initial draft and leave status at its default,
        it's set to "Drafting" automatically.

        Args:
            essays: The essays to create, 1-20 per call.
        """
        payload = await _create_essays_impl(ctx, essays)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="create_essays")  # type: ignore[no-any-return]

    return Tool(create_essays, takes_ctx=False)


async def _duplicate_title_guard(
    ctx: ToolCtx, title: str, application_id: UUID | None
) -> dict[str, Any] | None:
    async with ctx.app_pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, title FROM counselle.essays
            WHERE user_id = $1 AND archived_at IS NULL AND lower(title) = lower($2)
              AND application_id IS NOT DISTINCT FROM $3
            """,
            ctx.user_id,
            title,
            application_id,
        )
    if row is None:
        return None
    return {"id": str(row["id"]), "title": row["title"]}


async def _create_essays_impl(ctx: ToolCtx, drafts: list[EssayDraft]) -> dict[str, Any]:
    if not (BATCH_MIN <= len(drafts) <= BATCH_MAX):
        return batch_size_error("create_essays", len(drafts))

    apps, _essays = await active_workspace_links(ctx)
    active_app_ids = {app.id for app in apps}

    parsed: list[tuple[EssayDraft, UUID | None]] = []
    seen_in_batch: set[tuple[str, UUID | None]] = set()
    for index, draft in enumerate(drafts):
        app_uuid, app_error_msg = resolve_link(
            draft.application_id, "application_id", active_app_ids
        )
        if app_error_msg:
            return error(
                f"essays[{index}]: {app_error_msg} Nothing was created.",
                retryable=True,
                recovery="Pick the exact id from link_targets below and resubmit the whole "
                "batch, or omit the link if none fits.",
                link_targets=link_targets(apps, _essays),
            )
        batch_key = (draft.title.strip().lower(), app_uuid)
        if batch_key in seen_in_batch:
            return error(
                f'essays[{index}]: "{draft.title}" duplicates another essay earlier in this '
                "same batch, on the same application. Nothing was created.",
                retryable=True,
                recovery="Give each essay in the batch a distinct title, or drop the duplicate "
                "and resubmit.",
            )
        dup = await _duplicate_title_guard(ctx, draft.title, app_uuid)
        if dup is not None:
            return error(
                f'essays[{index}]: an active essay titled "{dup["title"]}" already exists on '
                f"that application (id {dup['id']}). Nothing was created.",
                retryable=False,
                recovery="Update or read the existing essay instead of creating a duplicate.",
            )
        seen_in_batch.add(batch_key)
        parsed.append((draft, app_uuid))

    batch_data: list[EssayCreate] = []
    for draft, app_uuid in parsed:
        content = (
            essay_markdown.to_tiptap(draft.content_markdown) if draft.content_markdown else None
        )
        status = draft.status
        if content is not None and status == "Not started":
            status = "Drafting"
        batch_data.append(
            EssayCreate.model_validate(
                {
                    "title": draft.title,
                    "application_id": app_uuid,
                    "essay_type": draft.essay_type,
                    "status": status,
                    "prompt": draft.prompt,
                    "word_limit": draft.word_limit,
                    **({"content": content} if content is not None else {}),
                }
            )
        )

    try:
        # One service transaction for the whole batch (agent mutation
        # receipts plan §7.2) — a validation/TOCTOU failure on any draft
        # rolls back every insert, matching the tool's all-or-nothing promise.
        created: list[Essay] = await create_essays_batch(
            ctx.app_pool,
            ctx.catalog,
            ctx.workspace_events,
            user_id=ctx.user_id,
            actor="counselle",
            drafts=batch_data,
        )
    except (WorkspaceNotFoundError, WorkspaceValidationError) as exc:
        return error(
            f"Nothing was created — {exc}",
            retryable=True,
            recovery="Call view_schools to check the linked schools are still active, then "
            "resubmit the whole batch.",
        )

    payload: dict[str, Any] = {
        "status": "ok",
        "today": today(),
        "summary": f"Created {len(created)} essay{'s' if len(created) != 1 else ''}.",
        "essays": [render_essay_row(_to_summary(e)) for e in created],
    }
    items = [
        batch_item(index, "changed", item_subject=subject(essay.title, essay.id))
        for index, essay in enumerate(created)
    ]
    payload = attach_mutation(payload, batch_receipt(family="essay", action="create", items=items))
    return payload


def _to_summary(essay: Essay) -> EssaySummary:
    return EssaySummary(
        id=essay.id,
        user_id=essay.user_id,
        application_id=essay.application_id,
        title=essay.title,
        essay_type=essay.essay_type,
        status=essay.status,
        prompt=essay.prompt,
        preview="",
        word_count=essay.word_count,
        word_limit=essay.word_limit,
        comment_count=len(essay.comments),
        suggestion_count=len(essay.suggestions),
        archived_via_application=essay.archived_via_application,
        school_name=essay.school_name,
        school_city=essay.school_city,
        school_state=essay.school_state,
        deadline=essay.deadline,
        created_at=essay.created_at,
        updated_at=essay.updated_at,
        archived_at=essay.archived_at,
    )


# --------------------------------------------------------------------------
# update_essay
# --------------------------------------------------------------------------


def make_update_essay_tool(ctx: ToolCtx) -> Tool[Any]:
    async def update_essay_tool(
        essay_id: str,
        title: str | None = None,
        application_id: str | None = None,
        essay_type: EssayType | None = None,
        status: EssayStatus | None = None,
        prompt: str | None = None,
        word_limit: int | str | None = None,
        deadline: str | None = None,
    ) -> dict[str, Any]:
        """Change one essay's metadata. Only the fields you pass change; everything
        else is untouched. This never touches the essay's content — use edit_essay
        or write_essay for that.

        essay_id must be an exact id echoed from a view_essays result. To CLEAR an
        optional field, pass the string "clear" (clearable: application_id,
        prompt, word_limit, deadline).

        Args:
            essay_id: The essay's id, from view_essays.
            title: New title.
            application_id: Link to this school (exact id from view_schools), or
                "clear" to unlink.
            essay_type: "Personal statement", "Supplement", "Scholarship", or
                "Optional".
            status: "Not started", "Drafting", "Needs review", "Ready", or
                "Submitted".
            prompt: The school's essay question, verbatim, or "clear" to remove it.
            word_limit: The word limit, or "clear" to remove it.
            deadline: Essay-specific deadline as YYYY-MM-DD, or "clear".
        """
        payload = await _update_essay_impl(
            ctx,
            essay_id,
            title=title,
            application_id=application_id,
            essay_type=essay_type,
            status=status,
            prompt=prompt,
            word_limit=word_limit,
            deadline=deadline,
        )
        return process_tool_result(payload, ctx.tool_overflow, tool_name="update_essay")  # type: ignore[no-any-return]

    return Tool(update_essay_tool, takes_ctx=False, name="update_essay")


async def _update_essay_impl(
    ctx: ToolCtx,
    essay_id: str,
    *,
    title: str | None,
    application_id: str | None,
    essay_type: EssayType | None,
    status: EssayStatus | None,
    prompt: str | None,
    word_limit: int | str | None,
    deadline: str | None,
) -> dict[str, Any]:
    if all(
        v is None for v in (title, application_id, essay_type, status, prompt, word_limit, deadline)
    ):
        return error(
            "No fields provided — nothing to update.",
            retryable=True,
            recovery="Pass at least one field to change.",
        )

    parsed_id = try_uuid(essay_id)
    if parsed_id is None:
        return stale_essay_error(essay_id)

    apps, essays = await active_workspace_links(ctx)

    patch_fields: dict[str, Any] = {}
    if title is not None:
        patch_fields["title"] = title
    if essay_type is not None:
        patch_fields["essay_type"] = essay_type
    if status is not None:
        patch_fields["status"] = status
    if prompt is not None:
        patch_fields["prompt"] = None if prompt == _CLEARABLE else prompt

    if application_id is not None:
        if application_id == _CLEARABLE:
            patch_fields["application_id"] = None
        else:
            app_uuid, link_error = resolve_link(
                application_id, "application_id", {a.id for a in apps}
            )
            if link_error:
                return error(
                    link_error,
                    retryable=True,
                    recovery="Pick the exact id from link_targets below and resubmit.",
                    link_targets=link_targets(apps, essays),
                )
            patch_fields["application_id"] = app_uuid

    if word_limit is not None:
        if word_limit == _CLEARABLE:
            patch_fields["word_limit"] = None
        else:
            try:
                patch_fields["word_limit"] = int(word_limit)
            except (TypeError, ValueError):
                return error(
                    f'word_limit "{word_limit}" is not a valid number.',
                    retryable=True,
                    recovery='Pass a whole number, or "clear" to remove the limit.',
                )

    if deadline is not None:
        if deadline == _CLEARABLE:
            patch_fields["deadline"] = None
        else:
            parsed_deadline, date_err = validate_date_only(deadline, "deadline")
            if date_err:
                return error(date_err, retryable=True, recovery=DATE_RECOVERY)
            patch_fields["deadline"] = parsed_deadline

    try:
        essay, before = await update_essay(
            ctx.app_pool,
            ctx.catalog,
            ctx.workspace_events,
            user_id=ctx.user_id,
            actor="counselle",
            essay_id=parsed_id,
            data=EssayPatch(**patch_fields),
            with_before=True,
        )
    except WorkspaceNotFoundError:
        return stale_essay_error(essay_id)

    payload: dict[str, Any] = {
        "status": "ok",
        "today": today(),
        "summary": f'Updated "{essay.title}".',
        "essay": render_essay_row(_to_summary(essay)),
    }
    essay_changes = _essay_changes(patch_fields, before, apps)
    if essay_changes:
        receipt = update_receipt(
            family="essay",
            action="update",
            update_subject=subject(essay.title, essay.id),
            changes=essay_changes,
        )
        payload = attach_mutation(payload, receipt)
    return payload


def _essay_changes(
    patch_fields: dict[str, Any], before: Essay, apps: list[Any]
) -> list[MutationChange]:
    """Typed changes, transaction-authoritative before/after where the
    exposure matrix (plan §8.2) calls for an exact typed value; ``prompt``
    stays state-only/clear regardless (essay prompts are ``changed_only`` —
    content never crosses the receipt seam).
    """
    changes: list[MutationChange] = []
    if "title" in patch_fields:
        changes.append(
            change(
                "title",
                "replace",
                before=text_value(before.title),
                after=text_value(patch_fields["title"]),
            )
        )
    if "essay_type" in patch_fields:
        changes.append(
            change(
                "type",
                "replace",
                before=enum_value(str(before.essay_type)),
                after=enum_value(str(patch_fields["essay_type"])),
            )
        )
    if "status" in patch_fields:
        changes.append(
            change(
                "status",
                "replace",
                before=enum_value(str(before.status)),
                after=enum_value(str(patch_fields["status"])),
            )
        )
    if "prompt" in patch_fields:
        changes.append(
            change("prompt", "clear" if patch_fields["prompt"] is None else "state_only")
        )
    if "application_id" in patch_fields:
        after_id = patch_fields["application_id"]
        before_name = application_name(before.application_id, apps)
        after_name = application_name(after_id, apps)
        if after_id is None:
            changes.append(change("school", "clear"))
        elif before.application_id is None:
            changes.append(
                change("school", "set", after=reference_value(subject(after_name or "School")))
            )
        else:
            changes.append(
                change(
                    "school",
                    "replace",
                    before=reference_value(subject(before_name or "School")),
                    after=reference_value(subject(after_name or "School")),
                )
            )
    if "word_limit" in patch_fields:
        value = patch_fields["word_limit"]
        if value is None:
            changes.append(change("word_limit", "clear"))
        elif before.word_limit is None:
            changes.append(change("word_limit", "set", after=integer_value(value)))
        else:
            changes.append(
                change(
                    "word_limit",
                    "replace",
                    before=integer_value(before.word_limit),
                    after=integer_value(value),
                )
            )
    if "deadline" in patch_fields:
        value = patch_fields["deadline"]
        if value is None:
            changes.append(change("deadline", "clear"))
        elif before.deadline is None:
            changes.append(change("deadline", "set", after=date_value(str(value))))
        else:
            changes.append(
                change(
                    "deadline",
                    "replace",
                    before=date_value(str(before.deadline)),
                    after=date_value(str(value)),
                )
            )
    return changes


# --------------------------------------------------------------------------
# duplicate_essay
# --------------------------------------------------------------------------


def make_duplicate_essay_tool(ctx: ToolCtx) -> Tool[Any]:
    async def duplicate_essay_tool(essay_id: str) -> dict[str, Any]:
        """Copy an essay ("Copy of ...") — the safe-experiment tool. Duplicate before
        a risky rework (a big restructure, a tone change the student is unsure
        about), then edit the copy and compare, rather than editing the original
        and losing the earlier version.

        Args:
            essay_id: The essay's id, from view_essays.
        """
        payload = await _duplicate_essay_impl(ctx, essay_id)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="duplicate_essay")  # type: ignore[no-any-return]

    return Tool(duplicate_essay_tool, takes_ctx=False, name="duplicate_essay")


async def _duplicate_essay_impl(ctx: ToolCtx, essay_id: str) -> dict[str, Any]:
    parsed_id = try_uuid(essay_id)
    if parsed_id is None:
        return stale_essay_error(essay_id)
    try:
        original = await get_essay(
            ctx.app_pool, ctx.catalog, user_id=ctx.user_id, essay_id=parsed_id
        )
    except WorkspaceNotFoundError:
        return stale_essay_error(essay_id)
    try:
        essay = await duplicate_essay(
            ctx.app_pool,
            ctx.catalog,
            ctx.workspace_events,
            user_id=ctx.user_id,
            actor="counselle",
            essay_id=parsed_id,
        )
    except WorkspaceNotFoundError:
        return stale_essay_error(essay_id)
    payload: dict[str, Any] = {
        "status": "ok",
        "today": today(),
        "summary": f'Created "{essay.title}".',
        "essay": render_essay_row(_to_summary(essay)),
    }
    receipt = duplicate_receipt(
        family="essay",
        source=subject(original.title, original.id),
        copy=subject(essay.title, essay.id),
    )
    return attach_mutation(payload, receipt)


# --------------------------------------------------------------------------
# archive_essays / restore_essay
# --------------------------------------------------------------------------


def make_archive_essays_tool(ctx: ToolCtx) -> Tool[Any]:
    async def archive_essays(essay_ids: list[str]) -> dict[str, Any]:
        """Remove essays from the student's library. This is a soft delete —
        restore_essay brings one back exactly as it was.

        Confirm with the student before archiving an essay with real content.
        Unknown or already-archived ids are skipped and reported; the rest still
        archive.

        Args:
            essay_ids: Ids of the essays to remove, 1-20.
        """
        payload = await _archive_essays_impl(ctx, essay_ids)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="archive_essays")  # type: ignore[no-any-return]

    return Tool(archive_essays, takes_ctx=False)


async def _archive_essays_impl(ctx: ToolCtx, essay_ids: list[str]) -> dict[str, Any]:
    if not (BATCH_MIN <= len(essay_ids) <= BATCH_MAX):
        return batch_size_error("archive_essays", len(essay_ids))

    archived: list[str] = []
    skipped: list[dict[str, str]] = []
    items = []
    for index, raw_id in enumerate(essay_ids):
        parsed_id = try_uuid(raw_id)
        if parsed_id is None:
            skipped.append({"id": raw_id, "reason": "not a valid essay id"})
            items.append(batch_item(index, "skipped", reason="not a valid essay id"))
            continue
        try:
            essay = await _archive_essay_service(
                ctx.app_pool,
                ctx.workspace_events,
                user_id=ctx.user_id,
                actor="counselle",
                essay_id=parsed_id,
            )
            archived.append(raw_id)
            items.append(
                batch_item(index, "changed", item_subject=subject(essay.title, essay.id))
            )
        except WorkspaceNotFoundError:
            skipped.append({"id": raw_id, "reason": "no active essay with this id"})
            items.append(batch_item(index, "skipped", reason="no active essay with this id"))

    summary = f"Archived {len(archived)} essay{'s' if len(archived) != 1 else ''}."
    if skipped:
        summary += f" Skipped {len(skipped)}."
    payload: dict[str, Any] = {
        "status": "warning" if skipped else "ok",
        "today": today(),
        "summary": summary,
        "archived": archived,
    }
    if skipped:
        payload["skipped"] = skipped
    payload = attach_mutation(
        payload, batch_receipt(family="essay", action="archive", items=items)
    )
    return payload


def make_restore_essay_tool(ctx: ToolCtx) -> Tool[Any]:
    async def restore_essay_tool(essay_id: str) -> dict[str, Any]:
        """Bring one archived essay back to the student's library, exactly as it was.

        Find archived essays with view_essays(status="archived"). If the essay's
        linked school is also archived, restore fails cleanly — restore the school
        first with restore_school.

        Args:
            essay_id: The archived essay's id, from view_essays(status="archived").
        """
        payload = await _restore_essay_impl(ctx, essay_id)
        return process_tool_result(payload, ctx.tool_overflow, tool_name="restore_essay")  # type: ignore[no-any-return]

    return Tool(restore_essay_tool, takes_ctx=False, name="restore_essay")


async def _restore_essay_impl(ctx: ToolCtx, essay_id: str) -> dict[str, Any]:
    parsed_id = try_uuid(essay_id)
    if parsed_id is None:
        return stale_essay_error(essay_id)

    async with ctx.app_pool.acquire() as conn:
        probe = await conn.fetchrow(
            """
            SELECT e.title, e.archived_at, a.archived_at AS app_archived_at
            FROM counselle.essays e
            LEFT JOIN counselle.applications a
              ON a.id = e.application_id AND a.user_id = e.user_id
            WHERE e.id = $1 AND e.user_id = $2
            """,
            parsed_id,
            ctx.user_id,
        )
    if probe is None:
        return stale_essay_error(essay_id)
    if probe["archived_at"] is None:
        return error(
            f'"{probe["title"]}" is not archived — it is already in the student\'s library.',
            retryable=False,
            recovery="No action needed. view_essays confirms its current state.",
        )
    if probe["app_archived_at"] is not None:
        return error(
            f'"{probe["title"]}" is linked to a school that is also archived.',
            retryable=True,
            recovery="Restore the school first with restore_school, then retry restore_essay.",
        )

    try:
        essay = await _restore_essay_service(
            ctx.app_pool,
            ctx.catalog,
            ctx.workspace_events,
            user_id=ctx.user_id,
            actor="counselle",
            essay_id=parsed_id,
        )
    except WorkspaceNotFoundError:
        return stale_essay_error(essay_id)
    except WorkspaceValidationError as exc:
        return error(str(exc), retryable=True, recovery="Check view_essays and try again.")

    payload: dict[str, Any] = {
        "status": "ok",
        "today": today(),
        "summary": f'Restored "{essay.title}".',
        "essay": render_essay_row(_to_summary(essay)),
    }
    receipt = state_transition_receipt(
        family="essay",
        action="restore",
        state="restored",
        subjects=[subject(essay.title, essay.id)],
    )
    return attach_mutation(payload, receipt)
