"""The only writer to the CollegeData facts *data* tables (`school_pages`,
`page_snapshots`, `school_facts`, `school_explore_rows`, `fact_coverage_
counts`, `collegedata_schools`'s sitemap bookkeeping) in `cds_library`
(plan §3.1/§3.4/§4.2, Unit E). Mirrors `adapters/cds_store.py`'s role:
every asyncpg write for the facts crawl's per-school pass lives here,
callers own the transaction boundary, and nothing here commits or rolls
back a transaction itself.

`facts_jobs`/`crawl_runs` (the job/lease/resume machinery) live in the
sibling `adapters/facts_jobs_store.py` — split out to keep both files
under the 800-line house limit; a distinct concern, not a distinct role.

Uses `Runtime.pipeline_pool` — the `cds_library_app` role (`INSERT, SELECT,
UPDATE` on all eight new tables, `DELETE` on `page_snapshots` only).
Parameterized SQL only, never f-strings, per CLAUDE.md.

**SCD2 write order is close-then-insert** (plan §3.4): a partial unique
index (`school_facts_current_idx`) cannot be deferrable, so every caller
must close before inserting within the same statement group — `write_facts`
does exactly that ordering itself so a caller can never get it backwards.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import asyncpg

from adapters.facts_jobs_store import FactsStoreError
from domain.facts.models import FactRow, TabName

__all__ = [
    "FactsWriteResult",
    "PageWriteResult",
    "get_current_facts",
    "get_current_page_hash",
    "get_school_basic_profile",
    "get_stored_deadline_year",
    "insert_unmatched_slugs",
    "previous_run_started_at",
    "record_page_changed",
    "record_page_failure",
    "record_page_unchanged",
    "retire_absent_slugs",
    "rewrite_fact_coverage_counts",
    "touch_seen_slugs",
    "upsert_explore_row",
    "write_school_facts",
]

# ---------------------------------------------------------------------------
# Pages / snapshots
# ---------------------------------------------------------------------------


async def get_school_basic_profile(
    conn: asyncpg.Connection, *, school_id: int
) -> Mapping[str, Any]:
    """`schools.basic_profile` for the IPEDS-derived explore filter columns
    (region/control/hbcu/... — plan §3.1). The writer's grant on `schools`
    is `SELECT`-only, matching this read-only use."""
    row = await conn.fetchrow(
        "SELECT basic_profile FROM cds_library.schools WHERE id = $1", school_id
    )
    if row is None:
        raise FactsStoreError(f"school {school_id} not found in cds_library.schools")
    return row["basic_profile"]  # type: ignore[no-any-return]


async def get_stored_deadline_year(conn: asyncpg.Connection, *, school_id: int) -> int | None:
    """The year of the currently-stored `deadlines.regular` fact — the
    cross-tab cycle-year fallback (plan §4.4) used when the `admission` tab
    itself was not fetched `ok` this pass."""
    value_date = await conn.fetchval(
        """
        SELECT value_date FROM cds_library.school_facts
        WHERE school_id = $1 AND fact_key = 'deadlines.regular' AND valid_to IS NULL
        """,
        school_id,
    )
    return value_date.year if value_date is not None else None


async def get_current_facts(conn: asyncpg.Connection, *, school_id: int) -> list[asyncpg.Record]:
    """Every currently-valid fact for `school_id` — the source `crawl.py`'s
    explore-row projection reads from (plan §4.2: the explore row reflects
    the school's full current fact state, not just this pass's diff)."""
    rows = await conn.fetch(
        """
        SELECT fact_key, value, value_num, value_text, value_bool, value_date
        FROM cds_library.school_facts
        WHERE school_id = $1 AND valid_to IS NULL
        """,
        school_id,
    )
    return list(rows)


async def previous_run_started_at(
    conn: asyncpg.Connection, *, exclude_run_id: int
) -> datetime | None:
    """The `started_at` of the run immediately before `exclude_run_id` —
    `retire_absent_slugs`'s "two consecutive passes" reference point."""
    return await conn.fetchval(  # type: ignore[no-any-return]
        "SELECT started_at FROM cds_library.crawl_runs "
        "WHERE id <> $1 ORDER BY started_at DESC LIMIT 1",
        exclude_run_id,
    )


async def get_current_page_hash(
    conn: asyncpg.Connection, *, school_id: int, tab: TabName
) -> bytes | None:
    """The content hash of `school_id`'s current `tab` snapshot, or `None`
    if never fetched — the change-detection comparison (plan §4.2)."""
    return await conn.fetchval(  # type: ignore[no-any-return]
        """
        SELECT ps.content_sha256
        FROM cds_library.school_pages sp
        JOIN cds_library.page_snapshots ps ON ps.id = sp.latest_snapshot_id
        WHERE sp.school_id = $1 AND sp.tab = $2
        """,
        school_id,
        tab,
    )


async def record_page_failure(
    conn: asyncpg.Connection, *, school_id: int, tab: TabName, status: str
) -> None:
    """A tab that failed to fetch this pass (plan §4.1): `last_attempted_at`
    advances, `last_fetched_at` does not (so a fact's `observed_at` — read
    from `last_fetched_at` — never refreshes on a failure), and
    `consecutive_failures` increments toward `facts_failure_threshold`."""
    await conn.execute(
        """
        INSERT INTO cds_library.school_pages
            (school_id, tab, last_status, last_attempted_at, consecutive_failures)
        VALUES ($1, $2, $3, now(), 1)
        ON CONFLICT (school_id, tab) DO UPDATE SET
            last_status = EXCLUDED.last_status,
            last_attempted_at = now(),
            consecutive_failures = cds_library.school_pages.consecutive_failures + 1
        """,
        school_id,
        tab,
        status,
    )


async def record_page_unchanged(conn: asyncpg.Connection, *, school_id: int, tab: TabName) -> None:
    """The hash-equal case (plan §4.2): refresh liveness columns only — no
    `page_snapshots`/`school_facts` write at all."""
    await conn.execute(
        """
        INSERT INTO cds_library.school_pages
            (school_id, tab, last_status, last_attempted_at, last_fetched_at, consecutive_failures)
        VALUES ($1, $2, 'ok', now(), now(), 0)
        ON CONFLICT (school_id, tab) DO UPDATE SET
            last_status = 'ok', last_attempted_at = now(), last_fetched_at = now(),
            consecutive_failures = 0
        """,
        school_id,
        tab,
    )


@dataclass(frozen=True)
class PageWriteResult:
    snapshot_id: int
    is_new_snapshot: bool
    pruned: int


async def record_page_changed(
    conn: asyncpg.Connection,
    *,
    school_id: int,
    tab: TabName,
    http_status: int | None,
    build_id: str | None,
    content_sha256: bytes,
    body: Mapping[str, Any],
    retention_per_page: int,
) -> PageWriteResult:
    """Write a changed page's snapshot (insert-or-repoint-on-revert, plan
    §3.4) and prune retention **in this call** (plan §4.2: "after each
    changed page's snapshot write ... retention runs inside the pass")."""
    inserted_id = await conn.fetchval(
        """
        INSERT INTO cds_library.page_snapshots
            (school_id, tab, first_seen_at, http_status, build_id, content_sha256, body)
        VALUES ($1, $2, now(), $3, $4, $5, $6)
        ON CONFLICT (school_id, tab, content_sha256) DO NOTHING
        RETURNING id
        """,
        school_id,
        tab,
        http_status,
        build_id,
        content_sha256,
        dict(body),
    )
    is_new = inserted_id is not None
    if inserted_id is None:
        # A revert to a previously seen body (plan §3.4) — the immutability
        # trigger rejects ON CONFLICT DO UPDATE, so re-select the existing row.
        inserted_id = await conn.fetchval(
            """
            SELECT id FROM cds_library.page_snapshots
            WHERE school_id = $1 AND tab = $2 AND content_sha256 = $3
            """,
            school_id,
            tab,
            content_sha256,
        )
    assert inserted_id is not None
    await conn.execute(
        """
        INSERT INTO cds_library.school_pages
            (school_id, tab, latest_snapshot_id, last_attempted_at, last_fetched_at,
             last_changed_at, last_status, consecutive_failures)
        VALUES ($1, $2, $3, now(), now(), now(), 'ok', 0)
        ON CONFLICT (school_id, tab) DO UPDATE SET
            latest_snapshot_id = $3, last_attempted_at = now(), last_fetched_at = now(),
            last_changed_at = now(), last_status = 'ok', consecutive_failures = 0
        """,
        school_id,
        tab,
        inserted_id,
    )
    pruned_rows = await conn.fetch(
        """
        WITH keep AS (
            SELECT id FROM cds_library.page_snapshots
            WHERE school_id = $1 AND tab = $2
            ORDER BY first_seen_at DESC
            LIMIT $3
        )
        DELETE FROM cds_library.page_snapshots
        WHERE school_id = $1 AND tab = $2
          AND id NOT IN (SELECT id FROM keep)
          AND id <> $4
          AND id NOT IN (
              SELECT snapshot_id FROM cds_library.school_facts
              WHERE valid_to IS NULL AND snapshot_id IS NOT NULL
          )
        RETURNING id
        """,
        school_id,
        tab,
        retention_per_page,
        inserted_id,
    )
    return PageWriteResult(snapshot_id=inserted_id, is_new_snapshot=is_new, pruned=len(pruned_rows))


# ---------------------------------------------------------------------------
# SCD2 school_facts write (plan §3.4/appendix J-iv, close-then-insert)
# ---------------------------------------------------------------------------


def _normalized_value_json(row: FactRow) -> Any:
    assert row.value is not None
    return {"kind": row.value.kind, "value": row.value.value}


def _typed_columns(row: FactRow) -> tuple[float | None, str | None, bool | None, Any]:
    value = row.value
    assert value is not None
    return value.value_num, value.value_text, value.value_bool, value.value_date


def _value_changed(current: asyncpg.Record, row: FactRow) -> bool:
    value = row.value
    assert value is not None
    if current["value_type"] != value.kind:
        return True
    if (
        current["value_num"],
        current["value_text"],
        current["value_bool"],
        current["value_date"],
    ) != (value.value_num, value.value_text, value.value_bool, value.value_date):
        return True
    stored = current["value"]
    stored_inner = stored.get("value") if isinstance(stored, dict) else None
    return bool(stored_inner != value.value)


@dataclass(frozen=True)
class FactsWriteResult:
    inserted: int
    closed_withdrawn: int
    updated_metadata: int


async def write_school_facts(
    conn: asyncpg.Connection,
    *,
    school_id: int,
    changed_tabs: Sequence[TabName],
    rows: Sequence[FactRow],
    snapshot_ids: Mapping[TabName, int],
    snapshot_sha256: Mapping[TabName, bytes],
    mapper_version: str,
) -> FactsWriteResult:
    """SCD2 close-then-insert over `changed_tabs` only (plan §3.4). `rows`
    is the mapper's **full** output for this school (every tab fetched
    `ok` this pass); this function itself filters to `changed_tabs` and
    drops every `FactRow` whose `value is None` (unmapped labels and
    explicit-absence observations — neither is ever written as a row, per
    `domain/facts/normalize.py`'s own resolution of plan §5.1/§4.4: "an
    explicit absence is real, but it is not a value" — see Unit E's final
    report for why this reading was chosen over the plan's literal text)."""
    if not changed_tabs:
        return FactsWriteResult(0, 0, 0)
    # `row.value is None` already covers both unmapped labels and explicit
    # absence observations (neither is ever a row here) -- see the
    # docstring above.
    new_by_key = {
        row.fact_key: row for row in rows if row.tab in changed_tabs and row.value is not None
    }
    current_rows = await conn.fetch(
        """
        SELECT fact_key, tab, value, display, unit, value_type,
               value_num, value_text, value_bool, value_date
        FROM cds_library.school_facts
        WHERE school_id = $1 AND valid_to IS NULL AND tab = ANY($2::text[])
        """,
        school_id,
        list(changed_tabs),
    )
    current_by_key = {row["fact_key"]: row for row in current_rows}

    to_close: list[str] = []
    to_insert: list[FactRow] = []
    to_update_meta: list[FactRow] = []
    for key, current in current_by_key.items():
        row = new_by_key.get(key)
        if row is None:
            to_close.append(key)  # withdrawn: absent from the new mapped set
            continue
        if _value_changed(current, row):
            to_close.append(key)
            to_insert.append(row)
        else:
            to_update_meta.append(row)
    for key, row in new_by_key.items():
        if key not in current_by_key:
            to_insert.append(row)

    if to_close:
        await conn.execute(
            """
            UPDATE cds_library.school_facts SET valid_to = now()
            WHERE school_id = $1 AND valid_to IS NULL
              AND tab = ANY($2::text[]) AND fact_key = ANY($3::text[])
            """,
            school_id,
            list(changed_tabs),
            to_close,
        )
    if to_insert:
        insert_args = [
            (
                school_id,
                row.fact_key,
                row.tab,
                _normalized_value_json(row),
                row.value.display,  # type: ignore[union-attr]
                row.value.unit,  # type: ignore[union-attr]
                row.value.kind,  # type: ignore[union-attr]
                *_typed_columns(row),
                row.section,
                row.label,
                row.reported_period,
                row.reported_period_year,
                snapshot_ids[row.tab],
                snapshot_sha256[row.tab],
                row.source_path,
                mapper_version,
            )
            for row in to_insert
        ]
        await conn.executemany(
            """
            INSERT INTO cds_library.school_facts
                (school_id, fact_key, tab, value, display, unit, value_type,
                 value_num, value_text, value_bool, value_date,
                 section, label, reported_period, reported_period_year,
                 snapshot_id, snapshot_sha256, source_path, mapper_version, valid_from)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,now())
            """,
            insert_args,
        )
    if to_update_meta:
        meta_args = [
            (
                school_id,
                row.fact_key,
                row.value.display,  # type: ignore[union-attr]
                row.value.unit,  # type: ignore[union-attr]
                mapper_version,
                row.source_path,
                snapshot_ids[row.tab],
            )
            for row in to_update_meta
        ]
        await conn.executemany(
            """
            UPDATE cds_library.school_facts
            SET display = $3, unit = $4, mapper_version = $5, source_path = $6, snapshot_id = $7
            WHERE school_id = $1 AND fact_key = $2 AND valid_to IS NULL
            """,
            meta_args,
        )
    reinserted = len([row for row in to_insert if row.fact_key in current_by_key])
    closed_withdrawn = len(to_close) - reinserted
    return FactsWriteResult(
        inserted=len(to_insert),
        closed_withdrawn=closed_withdrawn,
        updated_metadata=len(to_update_meta),
    )


# ---------------------------------------------------------------------------
# school_explore_rows (one upsert per school, plan §3.1/§4.2)
# ---------------------------------------------------------------------------

# The subset of school_explore_rows columns this unit populates (plan §3.1's
# ~100-column table minus every column requiring distribution-bucket
# percentile extraction from BarGraph values — see Unit E's final report;
# every other column stays NULL, a legitimate "not yet projected" state,
# never a 0/invented value). Fixed, code-owned list — never built from
# untrusted input, so this is safe despite being interpolated into the SQL.
EXPLORE_COLUMNS: tuple[str, ...] = (
    "region",
    "locale",
    "control",
    "institution_level",
    "gender_model",
    "religious_affiliation",
    "hbcu",
    "hsi",
    "tribal",
    "land_grant",
    "undergraduates",
    "graduate_students",
    "international_pct",
    "admit_rate",
    "admit_rate_women",
    "admit_rate_men",
    "applicants_total",
    "admitted_total",
    "enrolled_total",
    "yield_rate",
    "entrance_difficulty",
    "sat_math_p25",
    "sat_math_p75",
    "sat_ebrw_p25",
    "sat_ebrw_p75",
    # NO sat_total_* columns ever (R14/D10): the 25th percentile of a total
    # is not the sum of two section 25th percentiles. See
    # `tests/app/facts/test_explore_projection.py`'s exit test.
    "act_composite_p25",
    "act_composite_p75",
    "act_composite_avg",
    "gpa_avg",
    "need_met_pct",
    "cost_attendance_in_state",
    "cost_attendance_out_of_state",
    "tuition_in_state",
    "tuition_out_of_state",
    "room_and_board",
    "books_and_supplies",
    "other_expenses",
    "avg_indebtedness",
    "graduates_with_loans_pct",
    "retention_pct",
    "grad_rate_4y",
    "grad_rate_5y",
    "grad_rate_6y",
    "undergraduate_full_time",
    "faculty_full_time",
    "faculty_part_time",
    "faculty_terminal_pct",
    "housing_pct",
    "greek_pct_men",
    "greek_pct_women",
    "calendar",
    "application_fee",
    "application_fee_waiver",
    "accepts_common_app",
    "offers_early_decision",
    "offers_early_action",
    "is_rolling",
    "deadline_regular",
    "waitlist_used",
    "majors",
    "majors_count",
    "special_programs",
)

_EXPLORE_UPSERT_SQL = (
    "INSERT INTO cds_library.school_explore_rows "
    "(school_id, " + ", ".join(EXPLORE_COLUMNS) + ", facts_updated_at, mapper_version, retired_at) "
    "VALUES ($1, " + ", ".join(f"${i + 2}" for i in range(len(EXPLORE_COLUMNS))) + ", "
    f"now(), ${len(EXPLORE_COLUMNS) + 2}, NULL) "
    "ON CONFLICT (school_id) DO UPDATE SET "
    + ", ".join(f"{col} = EXCLUDED.{col}" for col in EXPLORE_COLUMNS)
    + ", facts_updated_at = now(), mapper_version = EXCLUDED.mapper_version, retired_at = NULL"
)  # nosec B608 -- EXPLORE_COLUMNS is a fixed, code-owned tuple, never external input.


async def upsert_explore_row(
    conn: asyncpg.Connection, *, school_id: int, values: Mapping[str, Any], mapper_version: str
) -> None:
    """One upsert per school, after all six tabs (plan §3.4/§4.2). `values`
    must carry every key in `EXPLORE_COLUMNS`; a column this unit doesn't
    populate should be passed as `None` explicitly (never omitted)."""
    args = [values.get(col) for col in EXPLORE_COLUMNS]
    await conn.execute(_EXPLORE_UPSERT_SQL, school_id, *args, mapper_version)


# ---------------------------------------------------------------------------
# Sitemap bookkeeping / retirement (plan §4.1)
# ---------------------------------------------------------------------------


async def touch_seen_slugs(conn: asyncpg.Connection, *, slugs: Sequence[str]) -> None:
    """Stamp `last_seen_in_sitemap_at = now()` for every slug the sitemap
    listed this pass — the record `retire_absent_slugs` reads."""
    await conn.execute(
        "UPDATE cds_library.collegedata_schools SET last_seen_in_sitemap_at = now() "
        "WHERE slug = ANY($1::text[])",
        list(slugs),
    )


async def insert_unmatched_slugs(conn: asyncpg.Connection, *, slugs: Sequence[str]) -> int:
    """Insert any slug the sitemap lists that isn't in `collegedata_schools`
    yet, as `match_method='unmatched'` — "needs adjudication," never
    crawled (plan §4.1). Returns the count actually inserted."""
    if not slugs:
        return 0
    rows = await conn.fetch(
        """
        INSERT INTO cds_library.collegedata_schools (slug, match_method, last_seen_in_sitemap_at)
        SELECT slug, 'unmatched', now() FROM unnest($1::text[]) AS slug
        ON CONFLICT (lower(slug)) DO NOTHING
        RETURNING slug
        """,
        list(slugs),
    )
    return len(rows)


async def retire_absent_slugs(
    conn: asyncpg.Connection, *, previous_run_started_at: datetime
) -> list[str]:
    """Retire every slug the sitemap has not listed for two consecutive
    passes (plan §4.1): not touched by this pass's `touch_seen_slugs`
    (checked by the caller running this *before* that call would defeat
    the purpose, so this reads `last_seen_in_sitemap_at` **before** this
    pass's discovery step stamps it) and already missing as of the start
    of the previous pass."""
    rows = await conn.fetch(
        """
        UPDATE cds_library.collegedata_schools
        SET retired_at = now()
        WHERE retired_at IS NULL AND last_seen_in_sitemap_at < $1
        RETURNING slug
        """,
        previous_run_started_at,
    )
    slugs = [row["slug"] for row in rows]
    if slugs:
        await conn.execute(
            """
            UPDATE cds_library.school_explore_rows r
            SET retired_at = now()
            FROM cds_library.collegedata_schools cs
            WHERE cs.slug = ANY($1::text[]) AND cs.school_id = r.school_id
            """,
            slugs,
        )
    return slugs


# ---------------------------------------------------------------------------
# fact_coverage_counts (end-of-pass aggregate rewrite, plan §3.1/§4.2)
# ---------------------------------------------------------------------------


async def rewrite_fact_coverage_counts(conn: asyncpg.Connection) -> None:
    """Recompute every `fact_key`'s coverage in one pass-ending statement
    (plan §3.1: "a plain GROUP BY view ... would aggregate on every
    `query_database` call; the counts are no staler than the facts they
    describe"). `schools_total` is the number of schools with a **live**
    crosswalk row (plan §3.2), not the full `schools` count. A key no
    longer produced by any school is zeroed, never deleted (the writer has
    no DELETE grant on this table by design)."""
    schools_total = await conn.fetchval(
        "SELECT count(*) FROM cds_library.collegedata_schools "
        "WHERE retired_at IS NULL AND school_id IS NOT NULL"
    )
    await conn.execute(
        """
        INSERT INTO cds_library.fact_coverage_counts
            (fact_key, schools_with_value, schools_total, computed_at)
        SELECT fact_key, count(DISTINCT school_id), $1, now()
        FROM cds_library.school_facts
        WHERE valid_to IS NULL AND fact_key NOT LIKE 'unmapped:%'
        GROUP BY fact_key
        ON CONFLICT (fact_key) DO UPDATE SET
            schools_with_value = EXCLUDED.schools_with_value,
            schools_total = EXCLUDED.schools_total,
            computed_at = EXCLUDED.computed_at
        """,
        schools_total,
    )
    await conn.execute(
        """
        UPDATE cds_library.fact_coverage_counts
        SET schools_with_value = 0, schools_total = $1, computed_at = now()
        WHERE computed_at < now() - interval '1 second'
        """,
        schools_total,
    )
