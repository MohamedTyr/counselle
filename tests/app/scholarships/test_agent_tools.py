"""Live-DB tests for the `search_scholarships` agent tool (plan §11
behaviours 29-32)."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any
from uuid import UUID

import asyncpg
import pytest

from app.scholarships import service, service_saves
from app.scholarships.agent_tools import NOT_LISTED_NOTE, search
from app.scholarships.models import StatusChangeIn
from domain.scholarships.publish import STALE_AFTER_DAYS
from tests.app.scholarships.conftest import TODAY, MakeScholarship, MakeUser

pytestmark = pytest.mark.live_db

FORBIDDEN = ("eligible", "qualify", "qualifies", "qualified")


def tag() -> str:
    """A token unique to one test, so searches only see that test's rows."""
    return f"zq{uuid.uuid4().hex[:10]}"


def days(n: int) -> str:
    return (TODAY + dt.timedelta(days=n)).isoformat()


def ids(payload: dict[str, Any]) -> list[str]:
    return [row["id"] for row in payload["scholarships"]]


def code_built(payload: dict[str, Any]) -> list[str]:
    texts = [payload.get("how_to_say_it", ""), payload.get("note", "")]
    return [text.lower() for text in texts if text]


async def test_reads_published_only_and_saved_only_is_the_turn_users(
    app_pool: asyncpg.Pool, make_user: MakeUser, make_scholarship: MakeScholarship, admin: UUID
) -> None:
    word = tag()
    published = await make_scholarship("published", name=f"{word} Published")
    other = await make_scholarship("published", name=f"{word} Other")
    await make_scholarship("draft", name=f"{word} Draft")
    archived = await make_scholarship("published", name=f"{word} Archived")
    await service.change_status(app_pool, archived.id, StatusChangeIn(status="archived"), admin)
    alice, bob = await make_user(), await make_user()
    await service_saves.save(app_pool, alice, published.id)
    await service_saves.save(app_pool, bob, other.id)

    everything = await search(app_pool, alice, query=word)
    alice_saved = await search(app_pool, alice, saved_only=True, query=word)

    assert sorted(ids(everything)) == sorted([str(published.id), str(other.id)])
    assert ids(alice_saved) == [str(published.id)]


async def test_rows_carry_closed_and_stale_and_closed_rows_are_omitted(
    app_pool: asyncpg.Pool, make_user: MakeUser, make_scholarship: MakeScholarship
) -> None:
    word = tag()
    student = await make_user()
    open_row = await make_scholarship(
        "published", name=f"{word} Open", deadline={"kind": "fixed", "date": days(10)}
    )
    closed = await make_scholarship(
        "published", name=f"{word} Closed", deadline={"kind": "fixed", "date": days(-5)}
    )
    stale = await make_scholarship("published", name=f"{word} Stale", deadline={"kind": "rolling"})
    await app_pool.execute(
        "UPDATE counselle.scholarships SET last_checked_on = $1 WHERE id = $2",
        TODAY - dt.timedelta(days=STALE_AFTER_DAYS + 1),
        stale.id,
    )
    await service_saves.save(app_pool, student, closed.id)

    default = await search(app_pool, student, query=word)
    with_closed = await search(app_pool, student, query=word, include_closed=True)
    saved = await search(app_pool, student, saved_only=True, query=word)

    assert ids(default) == [str(open_row.id), str(stale.id)]
    assert default["closed_omitted"] == 1
    assert "1 closed scholarships were left out" in default["how_to_say_it"]
    rows = {row["id"]: row for row in with_closed["scholarships"]}
    assert rows[str(closed.id)]["closed"] is True
    assert rows[str(open_row.id)]["closed"] is False
    assert rows[str(open_row.id)]["days_until_deadline"] == 10
    assert rows[str(stale.id)]["stale"] is True
    assert rows[str(open_row.id)]["stale"] is False
    assert ids(saved) == [str(closed.id)]
    assert saved["scholarships"][0]["closed"] is True
    assert saved["closed_omitted"] == 0


async def test_truncation_reports_total(
    app_pool: asyncpg.Pool, make_user: MakeUser, make_scholarship: MakeScholarship
) -> None:
    word = tag()
    student = await make_user()
    for index in range(3):
        await make_scholarship("published", name=f"{word} {index}")

    payload = await search(app_pool, student, query=word, limit=2)

    assert len(payload["scholarships"]) == 2
    assert payload["truncated"] is True
    assert payload["total_matching"] == 3
    assert "Showing 2 of 3 matches" in payload["how_to_say_it"]


async def test_query_matches_fields_and_escapes_wildcards(
    app_pool: asyncpg.Pool, make_user: MakeUser, make_scholarship: MakeScholarship
) -> None:
    word = tag()
    student = await make_user()
    by_field = await make_scholarship("published", fields=[f"{word} Engineering"])
    await make_scholarship("published", name=f"{word}x other")

    field_hit = await search(app_pool, student, query=f"{word} engineering")
    wildcard = await search(app_pool, student, query=f"{word}%")

    assert ids(field_hit) == [str(by_field.id)]
    assert ids(wildcard) == []


async def test_code_built_strings_never_claim_eligibility_but_sponsor_text_is_verbatim(
    app_pool: asyncpg.Pool, make_user: MakeUser, make_scholarship: MakeScholarship
) -> None:
    word = tag()
    student = await make_user()
    record = await make_scholarship(
        "published",
        name=f"{word} Pell",
        other_eligibility=["Must be eligible for a Pell Grant"],
        deadline={"kind": "fixed", "date": days(-1)},
    )
    payloads = [
        await search(app_pool, student, query=word, include_closed=True),
        await search(app_pool, student, query=word),
        await search(app_pool, student, query=f"{word} nothing"),
        await search(app_pool, student, scholarship_id=str(record.id)),
        await search(app_pool, student, scholarship_id="not-a-uuid"),
    ]

    for payload in payloads:
        for text in code_built(payload):
            assert not any(word_ in text for word_ in FORBIDDEN), text
    one = payloads[3]
    assert one["scholarship"]["student_must_check"] == ["Must be eligible for a Pell Grant"]
    assert "Deadline passed on" in one["how_to_say_it"]
    assert one["scholarship"]["rules"] == [{"kind": "state", "any_of": ["TX"]}]


async def test_unpublished_or_bad_id_is_no_longer_listed(
    app_pool: asyncpg.Pool, make_user: MakeUser, make_scholarship: MakeScholarship
) -> None:
    student = await make_user()
    draft = await make_scholarship("draft")

    for value in (str(draft.id), str(uuid.uuid4()), "not-a-uuid"):
        payload = await search(app_pool, student, scholarship_id=value)
        assert payload == {"found": False, "note": NOT_LISTED_NOTE}
