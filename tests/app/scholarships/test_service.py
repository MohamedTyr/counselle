"""Live-DB tests for `app/scholarships/service.py` (plan §11 behaviours 4,
6, 7, 9, 14-19)."""

from __future__ import annotations

import datetime as dt
from typing import Any
from uuid import UUID, uuid4

import asyncpg
import pytest

from app.scholarships import service
from app.scholarships.errors import (
    ScholarshipConflictError,
    ScholarshipNotFoundError,
    ScholarshipValidationError,
)
from app.scholarships.models import AdminScholarship, ScholarshipUpdateIn, StatusChangeIn
from tests.app.scholarships.conftest import TODAY, MakeScholarship, complete_fields

pytestmark = pytest.mark.live_db


def update_in(
    record: AdminScholarship, status: str | None = None, **overrides: Any
) -> ScholarshipUpdateIn:
    fields = record.model_dump(
        mode="json",
        exclude={"id", "created_at", "status", "version", "updated_at", "updated_by_email"},
    )
    fields.update(overrides)
    return ScholarshipUpdateIn.model_validate(
        {**fields, "status": status or record.status, "expected_version": record.version}
    )


async def revision_rows(pool: asyncpg.Pool, scholarship_id: UUID) -> list[Any]:
    records: list[Any] = await pool.fetch(
        "SELECT version, action, actor_id FROM counselle.scholarship_revisions "
        "WHERE scholarship_id = $1 ORDER BY version",
        scholarship_id,
    )
    return records


# --- behaviour 4 (L): last_checked_on bound ---------------------------------


async def test_last_checked_tomorrow_accepted_later_refused(
    make_scholarship: MakeScholarship,
) -> None:
    tomorrow = (TODAY + dt.timedelta(days=1)).isoformat()
    assert (await make_scholarship(last_checked_on=tomorrow)).last_checked_on is not None
    with pytest.raises(ScholarshipValidationError):
        await make_scholarship(last_checked_on=(TODAY + dt.timedelta(days=2)).isoformat())


# --- behaviour 6: the publish CHECK -----------------------------------------


@pytest.mark.parametrize(
    ("column", "value"),
    [("apply_url", "javascript:alert(1)"), ("award_amount", None), ("last_checked_on", None)],
)
async def test_publish_check_refuses_incomplete_insert(
    app_pool: asyncpg.Pool, column: str, value: Any
) -> None:
    values: dict[str, Any] = {
        "apply_url": "https://a.org",
        "award_amount": 100,
        "last_checked_on": TODAY,
    }
    values[column] = value
    with pytest.raises(asyncpg.CheckViolationError):
        await app_pool.execute(
            """
            INSERT INTO counselle.scholarships
              (status, name, sponsor, apply_url, source_url, award_kind, award_amount,
               deadline_kind, last_checked_on)
            VALUES ('published', 'N', 'S', $1, 'https://a.org', 'fixed', $2, 'rolling', $3)
            """,
            values["apply_url"],
            values["award_amount"],
            values["last_checked_on"],
        )


# --- behaviours 7, 9: the published list and its vintage --------------------


async def test_list_published_only_and_sorted(
    app_pool: asyncpg.Pool, make_scholarship: MakeScholarship
) -> None:
    later = (TODAY + dt.timedelta(days=90)).isoformat()
    sooner = (TODAY + dt.timedelta(days=30)).isoformat()
    b_later = await make_scholarship(
        "published", name="B", deadline={"kind": "fixed", "date": later}
    )
    a_later = await make_scholarship(
        "published", name="A", deadline={"kind": "fixed", "date": later}
    )
    soon = await make_scholarship("published", name="Z", deadline={"kind": "fixed", "date": sooner})
    rolling = await make_scholarship("published", name="R", deadline={"kind": "rolling"})
    draft = await make_scholarship("draft")
    mine = {b_later.id, a_later.id, soon.id, rolling.id, draft.id}

    listed = [item.id for item in await service.list_published(app_pool) if item.id in mine]

    assert listed[:3] == [soon.id, a_later.id, b_later.id]
    assert rolling.id in listed  # null deadline sorts last among this test's rows
    assert listed.index(rolling.id) > listed.index(b_later.id)
    assert draft.id not in listed


async def test_vintage_changes_on_every_published_change(
    app_pool: asyncpg.Pool, make_scholarship: MakeScholarship, admin: UUID
) -> None:
    previous = await service.published_vintage(app_pool)
    assert previous  # never empty, so an empty list still gets an ETag
    record = await make_scholarship("draft")

    async def changed() -> None:
        nonlocal previous
        vintage = await service.published_vintage(app_pool)
        assert vintage != previous
        previous = vintage

    record = await service.change_status(
        app_pool, record.id, StatusChangeIn(status="published"), admin
    )
    await changed()
    record = await service.update(app_pool, record.id, update_in(record, summary="New"), admin)
    await changed()
    record = await service.mark_checked(app_pool, record.id, admin)
    await changed()
    record = await service.change_status(app_pool, record.id, StatusChangeIn(status="draft"), admin)
    await changed()


# --- behaviour 14: one revision per write ------------------------------------


async def test_every_write_appends_one_revision(
    app_pool: asyncpg.Pool, make_scholarship: MakeScholarship, admin: UUID
) -> None:
    record = await make_scholarship("draft")
    record = await service.update(app_pool, record.id, update_in(record, summary="Edited"), admin)
    record = await service.update(app_pool, record.id, update_in(record, "published"), admin)
    record = await service.mark_checked(app_pool, record.id, admin)
    record = await service.change_status(app_pool, record.id, StatusChangeIn(status="draft"), admin)
    record = await service.change_status(
        app_pool, record.id, StatusChangeIn(status="archived"), admin
    )
    record = await service.change_status(
        app_pool, record.id, StatusChangeIn(status="published"), admin
    )

    revisions = await revision_rows(app_pool, record.id)
    assert [(r["version"], r["action"]) for r in revisions] == [
        (1, "create"),
        (2, "update"),
        (3, "publish"),
        (4, "checked"),
        (5, "unpublish"),
        (6, "archive"),
        (7, "restore"),
    ]
    assert {r["actor_id"] for r in revisions} == {admin}
    assert record.version == 7
    assert record.updated_by_email == f"{admin}@scholarships.test"


def test_action_for() -> None:
    assert service.action_for("draft", "draft") == "update"
    assert service.action_for("draft", "published") == "publish"
    assert service.action_for("published", "draft") == "unpublish"
    assert service.action_for("published", "archived") == "archive"
    assert service.action_for("archived", "draft") == "restore"
    assert service.action_for("archived", "published") == "restore"


# --- behaviour 15: same-status is a no-op -----------------------------------


async def test_same_status_call_changes_nothing(
    app_pool: asyncpg.Pool, make_scholarship: MakeScholarship, admin: UUID
) -> None:
    record = await make_scholarship("draft")
    again = await service.change_status(app_pool, record.id, StatusChangeIn(status="draft"), admin)
    assert again.version == record.version
    assert again.updated_at == record.updated_at
    assert len(await revision_rows(app_pool, record.id)) == 1


# --- behaviour 16: stale expected_version -----------------------------------


async def test_stale_version_conflicts_and_changes_nothing(
    app_pool: asyncpg.Pool, make_scholarship: MakeScholarship, admin: UUID
) -> None:
    record = await make_scholarship("draft")
    current = await service.update(app_pool, record.id, update_in(record, summary="First"), admin)

    with pytest.raises(ScholarshipConflictError) as caught:
        await service.update(app_pool, record.id, update_in(record, summary="Second"), admin)
    with pytest.raises(ScholarshipConflictError):
        await service.change_status(
            app_pool,
            record.id,
            StatusChangeIn(status="archived", expected_version=record.version),
            admin,
        )

    assert caught.value.current_version == current.version
    after = await service.get(app_pool, record.id)
    assert after.summary == "First"
    assert after.version == current.version


# --- behaviours 17, 18: publish checks and transitions ----------------------


async def test_incomplete_publish_is_refused_with_problems(
    app_pool: asyncpg.Pool, make_scholarship: MakeScholarship, admin: UUID
) -> None:
    draft = await make_scholarship("draft", award={"kind": "fixed"}, last_checked_on=None)
    with pytest.raises(ScholarshipValidationError) as caught:
        await service.change_status(app_pool, draft.id, StatusChangeIn(status="published"), admin)
    assert caught.value.problems == ["award", "fresh"]

    published = await make_scholarship("published")
    with pytest.raises(ScholarshipValidationError) as caught:
        await service.update(app_pool, published.id, update_in(published, apply_url=""), admin)
    assert caught.value.problems == ["apply_url"]
    assert (await service.get(app_pool, published.id)).version == published.version
    assert (await service.get(app_pool, draft.id)).status == "draft"


async def test_create_published_incomplete_is_refused(make_scholarship: MakeScholarship) -> None:
    with pytest.raises(ScholarshipValidationError) as caught:
        await make_scholarship("published", source_url="")
    assert caught.value.problems == ["source_url"]


async def test_put_cannot_edit_archived_or_archive(
    app_pool: asyncpg.Pool, make_scholarship: MakeScholarship, admin: UUID
) -> None:
    record = await make_scholarship("draft")
    with pytest.raises(ScholarshipValidationError, match="status action"):
        await service.update(app_pool, record.id, update_in(record, "archived"), admin)

    archived = await service.change_status(
        app_pool, record.id, StatusChangeIn(status="archived"), admin
    )
    with pytest.raises(ScholarshipValidationError, match="Restore"):
        await service.update(app_pool, record.id, update_in(archived, "draft"), admin)
    with pytest.raises(ScholarshipValidationError, match="Restore"):
        await service.mark_checked(app_pool, record.id, admin)


async def test_archive_undo_to_published_runs_publish_checks(
    app_pool: asyncpg.Pool, make_scholarship: MakeScholarship, admin: UUID
) -> None:
    record = await make_scholarship("draft", last_checked_on=None)
    await service.change_status(app_pool, record.id, StatusChangeIn(status="archived"), admin)
    with pytest.raises(ScholarshipValidationError) as caught:
        await service.change_status(app_pool, record.id, StatusChangeIn(status="published"), admin)
    assert caught.value.problems == ["fresh"]
    restored = await service.change_status(
        app_pool, record.id, StatusChangeIn(status="draft"), admin
    )
    assert restored.status == "draft"


async def test_unknown_id_is_not_found(app_pool: asyncpg.Pool, admin: UUID) -> None:
    with pytest.raises(ScholarshipNotFoundError):
        await service.get(app_pool, uuid4())
    with pytest.raises(ScholarshipNotFoundError):
        await service.mark_checked(app_pool, uuid4(), admin)
    with pytest.raises(ScholarshipNotFoundError):
        await service.revisions(app_pool, uuid4())


async def test_mark_checked_sets_only_the_date(
    app_pool: asyncpg.Pool, make_scholarship: MakeScholarship, admin: UUID
) -> None:
    old = (TODAY - dt.timedelta(days=200)).isoformat()
    record = await make_scholarship("draft", last_checked_on=old)
    checked = await service.mark_checked(app_pool, record.id, admin)
    assert checked.last_checked_on == TODAY
    assert checked.model_dump(
        exclude={"last_checked_on", "version", "updated_at"}
    ) == record.model_dump(exclude={"last_checked_on", "version", "updated_at"})


# --- behaviour 19: revision diffs --------------------------------------------


async def test_revision_changed_lists_differing_keys(
    app_pool: asyncpg.Pool, make_scholarship: MakeScholarship, admin: UUID
) -> None:
    record = await make_scholarship("draft")
    record = await service.update(
        app_pool, record.id, update_in(record, summary="Edited", fields=["Biology"]), admin
    )
    record = await service.update(app_pool, record.id, update_in(record, "published"), admin)

    revisions = await service.revisions(app_pool, record.id)
    assert [r.version for r in revisions] == [3, 2, 1]
    assert revisions[0].changed == ["status"]
    assert revisions[1].changed == ["fields", "summary"]
    assert revisions[2].changed == []
    assert revisions[0].snapshot["status"] == "published"
    assert revisions[0].actor_email == f"{admin}@scholarships.test"
    assert "version" not in revisions[0].snapshot


async def test_revisions_cap_and_diff_the_oldest_returned(
    app_pool: asyncpg.Pool,
    make_scholarship: MakeScholarship,
    admin: UUID,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(service, "REVISIONS_LIMIT", 2)
    record = await make_scholarship("draft")
    record = await service.update(app_pool, record.id, update_in(record, summary="One"), admin)
    record = await service.update(app_pool, record.id, update_in(record, summary="Two"), admin)
    revisions = await service.revisions(app_pool, record.id)
    assert [r.version for r in revisions] == [3, 2]
    assert revisions[1].changed == ["summary"]


async def test_create_round_trips_every_field(make_scholarship: MakeScholarship) -> None:
    fields = complete_fields(
        logo_url="https://acme.org/logo.png",
        award={
            "kind": "range",
            "min": 1000,
            "max": 5000,
            "renewable": True,
            "years": 4,
            "awards_count": 10,
        },
        deadline={
            "kind": "fixed",
            "date": "2027-03-01",
            "opens_on": "2026-11-01",
            "recurs_annually": True,
        },
        basis=["merit", "need"],
        fields=["Biology"],
        eligibility=[
            {"kind": "citizenship", "any_of": ["us_citizen", "daca"]},
            {"kind": "gpa_min", "value": 3.5},
            {"kind": "first_gen"},
        ],
        other_eligibility=["Must be eligible for a Pell Grant"],
        requirements={
            "essays": [{"prompt": "Why you?", "words": 500}],
            "recommendations": 2,
            "transcript": True,
            "financial_documents": True,
            "interview": False,
        },
    )
    record = await make_scholarship("draft", **fields)
    dumped = record.model_dump(mode="json")
    for key, value in fields.items():
        if key == "requirements":
            assert dumped[key] == value
        elif isinstance(value, dict):
            assert {k: dumped[key][k] for k in value} == value
        else:
            assert dumped[key] == value, key
