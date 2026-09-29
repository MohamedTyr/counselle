"""Explore query builder + response assembly (plan §5.3).

This module builds every parameterized `school_explore` statement and owns
the exclusion/`narrowest`/`control_counts`/`filter_options` accounting; it
never opens a connection itself (`counselle_db.service.explore` is the one
executor, plan §6a). `run_explore`/`run_majors` are the two orchestrators
`api/routes/schools_facts.py` calls.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from adapters.facts_store import EXPLORE_COLUMNS
from app.facts.explore_models import (
    Control,
    Exclusion,
    ExclusionReason,
    ExploreQuery,
    ExploreResponse,
    ExploreSchoolCard,
    FilterOption,
    FilterOptions,
    FitEstimate,
    MajorOption,
    MajorsResponse,
    Narrowest,
    NullTail,
)
from config.settings import Settings
from counselle_db import service as db_service
from counselle_db.catalog import Catalog
from domain.admissions_fit import estimate_admissions_fit
from domain.facts.state import ENTRANCE_DIFFICULTY_NOTE, MAJORS_MATCH_NOTE

__all__ = [
    "MAJORS_MATCH_NOTE",
    "METRIC_LABELS",
    "RELIGIOUS_AFFILIATION_NOTE",
    "SIZE_BUCKETS",
    "run_explore",
    "run_majors",
]

# Re-exported for this module's existing callers/tests -- the canonical
# string now lives in `domain/facts/state.py` (school-data-v3 Phase 3, Unit
# B), imported by both this module and `counselle_db/sql_guard.py`'s
# `query_database` majors rule so the two surfaces never say it two ways.
RELIGIOUS_AFFILIATION_NOTE = (
    "Counselle holds no affiliation for these schools. That is not the same "
    "as knowing a school has none, so this is not a list of secular schools."
)

# The size-bucket boundaries' single owner (plan §5.3).
SIZE_BUCKETS: dict[str, tuple[float | None, float | None]] = {
    "lt2k": (None, 1999),
    "2k-10k": (2000, 9999),
    "10k-25k": (10000, 24999),
    "gt25k": (25000, None),
}

# Noun phrases only, <=4 words, no trailing period (a Phase 2 test enforces
# this) -- what an exclusion chip interpolates. Distinct from a filter
# control's own (longer) label, which the frontend owns.
METRIC_LABELS: dict[str, str] = {
    "q": "search text",
    "state": "state",
    "region": "region",
    "sizeBucket": "undergraduate count",
    "testPolicy": "test policy",
    "campusSetting": "campus setting",
    "gender": "gender model",
    "hsi": "HSI status",
    "entranceDifficulty": "entrance difficulty",
    "calendar": "academic calendar",
    "major": "major",
    "deadlineBefore": "deadline date",
    "noApplicationFee": "application fee",
    "offersEarlyDecision": "early decision offer",
    "offersEarlyAction": "early action offer",
    "rollingAdmission": "rolling admission",
    "satMath": "SAT Math range",
    "satEbrw": "SAT EBRW range",
    "act": "ACT range",
    "admit": "admit rate",
    "cost": "cost of attendance",
    "needMet": "share of need met",
    "needFullyMet": "need fully met rate",
    "meritAid": "merit aid rate",
    "gradFour": "4-year graduation rate",
    "gradSix": "6-year graduation rate",
    "retention": "retention rate",
    "ratio": "undergraduates-per-faculty figure",
    "housing": "housing rate",
    "international": "international student rate",
}

_SORT_KEYS: dict[str, str] = {
    "name": "name",
    "undergraduates": "undergraduates",
    "admit": "admit_rate",
    "cost": "cost_attendance_in_state",
    "needMet": "need_met_pct",
    "gradFour": "grad_rate_4y",
    "gradSix": "grad_rate_6y",
    "retention": "retention_pct",
    "deadline": "deadline_regular",
}

_RANGE_COLUMNS: dict[str, str] = {
    "admit": "admit_rate",
    "needMet": "need_met_pct",
    "needFullyMet": "need_fully_met_pct",
    "meritAid": "merit_aid_pct",
    "gradFour": "grad_rate_4y",
    "gradSix": "grad_rate_6y",
    "retention": "retention_pct",
    "ratio": "(undergraduate_full_time::numeric / NULLIF(faculty_full_time, 0))",
    "housing": "housing_pct",
    "international": "international_pct",
}

_TABLE = "cds_library.school_explore"


@dataclass(frozen=True)
class _Clause:
    key: str
    metric_label: str
    reason: ExclusionReason
    sql: str  # e.g. "admit_rate BETWEEN {} AND {}"
    params: tuple[Any, ...]
    # None when the column can never be null (no exclusion accounting is
    # possible or meaningful for this filter).
    null_sql: str | None


def _combine(
    clauses: list[_Clause], *, skip: str | None = None, null_check_for: str | None = None
) -> tuple[str, list[Any]]:
    """Render `clauses` into one parameterized WHERE body.

    `skip` drops one clause's own predicate entirely (used both by the
    exclusion-count queries, paired with `null_check_for`, and by
    `narrowest`'s "what if this filter weren't applied at all" queries,
    used alone).
    """
    parts: list[str] = []
    params: list[Any] = []
    counter = 1
    for clause in clauses:
        if clause.key == skip:
            continue
        n = clause.sql.count("{}")
        placeholders = [f"${counter + i}" for i in range(n)]
        counter += n
        parts.append(clause.sql.format(*placeholders))
        params.extend(clause.params)
    if null_check_for is not None:
        target = next((c for c in clauses if c.key == null_check_for), None)
        if target is not None and target.null_sql is not None:
            parts.append(target.null_sql)
    return (" AND ".join(parts) if parts else "TRUE"), params


def _range_clause(
    key: str, column: str, min_v: float | None, max_v: float | None
) -> _Clause | None:
    if min_v is None and max_v is None:
        return None
    if min_v is not None and max_v is not None:
        sql = f"{column} BETWEEN {{}} AND {{}}"
        params: tuple[Any, ...] = (min_v, max_v)
    elif min_v is not None:
        sql, params = f"{column} >= {{}}", (min_v,)
    else:
        sql, params = f"{column} <= {{}}", (max_v,)
    return _Clause(key, METRIC_LABELS[key], "missing", sql, params, f"{column} IS NULL")


def _size_bucket_clause(buckets: Sequence[str]) -> _Clause | None:
    if not buckets:
        return None
    parts: list[str] = []
    params: list[Any] = []
    for bucket in buckets:
        lo, hi = SIZE_BUCKETS[bucket]
        if lo is not None and hi is not None:
            parts.append("undergraduates BETWEEN {} AND {}")
            params.extend((lo, hi))
        elif hi is not None:
            parts.append("undergraduates <= {}")
            params.append(hi)
        else:
            parts.append("undergraduates >= {}")
            params.append(lo)
    sql = "(" + " OR ".join(parts) + ")"
    return _Clause(
        "sizeBucket",
        METRIC_LABELS["sizeBucket"],
        "missing",
        sql,
        tuple(params),
        "undergraduates IS NULL",
    )


def _campus_setting_clause(families: Sequence[str]) -> _Clause | None:
    if not families:
        return None
    sql = "(" + " OR ".join("locale LIKE {} || ': %'" for _ in families) + ")"
    return _Clause(
        "campusSetting",
        METRIC_LABELS["campusSetting"],
        "not_reported",
        sql,
        tuple(families),
        "locale IS NULL",
    )


def _religious_affiliation_clause(value: str | None) -> _Clause | None:
    if value is None:
        return None
    if value == "any_affiliated":
        return _Clause(
            "religiousAffiliation", "", "missing", "religious_affiliation IS NOT NULL", (), None
        )
    if value == "none_on_file":
        return _Clause(
            "religiousAffiliation", "", "missing", "religious_affiliation IS NULL", (), None
        )
    return _Clause(
        "religiousAffiliation", "", "missing", "religious_affiliation = {}", (value,), None
    )


def _score_fit_clause(key: str, column_prefix: str, score: int | None, mode: str) -> _Clause | None:
    if score is None or mode == "any":
        return None
    p25, p75 = f"{column_prefix}_p25", f"{column_prefix}_p75"
    if mode == "at_or_above_p25":
        sql = f"{p25} <= {{}}"
    elif mode == "at_or_above_p75":
        sql = f"{p75} <= {{}}"
    else:  # inside_band
        sql = f"{{}} BETWEEN {p25} AND {p75}"
    return _Clause(
        key, METRIC_LABELS[key], "missing", sql, (score,), f"({p25} IS NULL OR {p75} IS NULL)"
    )


def _bool_clause(key: str, column: str, active: bool) -> _Clause | None:
    if not active:
        return None
    return _Clause(key, METRIC_LABELS[key], "missing", f"{column} = TRUE", (), f"{column} IS NULL")


def _deadline_before_clause(before: Any, include_rolling: bool) -> _Clause | None:
    if before is None:
        return None
    if include_rolling:
        sql = "(deadline_regular <= {} OR is_rolling = TRUE)"
        null_sql = "(deadline_regular IS NULL AND is_rolling IS NOT TRUE)"
    else:
        sql = "deadline_regular <= {}"
        null_sql = "deadline_regular IS NULL"
    return _Clause(
        "deadlineBefore", METRIC_LABELS["deadlineBefore"], "missing", sql, (before,), null_sql
    )


def _build_clauses(query: ExploreQuery) -> list[_Clause]:
    clauses: list[_Clause] = []
    if query.q:
        clauses.append(
            _Clause("q", METRIC_LABELS["q"], "missing", "name ILIKE {}", (f"%{query.q}%",), None)
        )
    if query.state:
        clauses.append(
            _Clause(
                "state", METRIC_LABELS["state"], "missing", "state = ANY({})", (query.state,), None
            )
        )
    if query.region:
        clauses.append(
            _Clause(
                "region",
                METRIC_LABELS["region"],
                "missing",
                "region = ANY({})",
                (query.region,),
                None,
            )
        )
    bucket_clause = _size_bucket_clause(query.size_bucket)
    if bucket_clause:
        clauses.append(bucket_clause)
    if query.control:
        clauses.append(_Clause("control", "", "missing", "control = {}", (query.control,), None))
    if query.test_policy:
        clauses.append(
            _Clause(
                "testPolicy",
                METRIC_LABELS["testPolicy"],
                "missing",
                "test_policy = {}",
                (query.test_policy,),
                "test_policy IS NULL",
            )
        )
    campus_clause = _campus_setting_clause(query.campus_setting)
    if campus_clause:
        clauses.append(campus_clause)
    religious_clause = _religious_affiliation_clause(query.religious_affiliation)
    if religious_clause:
        clauses.append(religious_clause)
    if query.gender:
        clauses.append(
            _Clause(
                "gender",
                METRIC_LABELS["gender"],
                "not_reported",
                "gender_model = {}",
                (query.gender,),
                "gender_model IS NULL",
            )
        )
    if query.hbcu:
        clauses.append(_Clause("hbcu", "", "missing", "hbcu = TRUE", (), None))
    if query.hsi:
        clauses.append(
            _Clause("hsi", METRIC_LABELS["hsi"], "not_reported", "hsi = TRUE", (), "hsi IS NULL")
        )
    if query.tribal:
        clauses.append(_Clause("tribal", "", "missing", "tribal = TRUE", (), None))
    if query.land_grant:
        clauses.append(_Clause("landGrant", "", "missing", "land_grant = TRUE", (), None))
    if query.entrance_difficulty:
        clauses.append(
            _Clause(
                "entranceDifficulty",
                METRIC_LABELS["entranceDifficulty"],
                "missing",
                "entrance_difficulty = {}",
                (query.entrance_difficulty,),
                "entrance_difficulty IS NULL",
            )
        )
    if query.calendar:
        clauses.append(
            _Clause(
                "calendar",
                METRIC_LABELS["calendar"],
                "missing",
                "calendar = {}",
                (query.calendar,),
                "calendar IS NULL",
            )
        )
    if query.major:
        clauses.append(
            _Clause(
                "major",
                METRIC_LABELS["major"],
                "missing",
                "majors @> ARRAY[{}]::text[]",
                (query.major,),
                "majors IS NULL",
            )
        )
    # application_fee is numeric, not boolean -- built directly rather than
    # through `_bool_clause`'s "column = TRUE" shape.
    if query.no_application_fee:
        clauses.append(
            _Clause(
                "noApplicationFee",
                METRIC_LABELS["noApplicationFee"],
                "missing",
                "application_fee = 0",
                (),
                "application_fee IS NULL",
            )
        )
    for key, column, active in (
        ("offersEarlyDecision", "offers_early_decision", query.offers_early_decision),
        ("offersEarlyAction", "offers_early_action", query.offers_early_action),
        ("rollingAdmission", "is_rolling", query.rolling_admission),
    ):
        clause = _bool_clause(key, column, active)
        if clause:
            clauses.append(clause)
    deadline_clause = _deadline_before_clause(query.deadline_before, query.include_rolling)
    if deadline_clause:
        clauses.append(deadline_clause)
    for key, prefix, score in (
        ("satMath", "sat_math", query.sat_math),
        ("satEbrw", "sat_ebrw", query.sat_ebrw),
        ("act", "act_composite", query.act),
    ):
        clause = _score_fit_clause(key, prefix, score, query.score_fit)
        if clause:
            clauses.append(clause)
    for key, (min_v, max_v) in (
        ("admit", (query.admit_min, query.admit_max)),
        ("cost", (query.cost_min, query.cost_max)),
        ("needMet", (query.need_met_min, query.need_met_max)),
        ("needFullyMet", (query.need_fully_met_min, query.need_fully_met_max)),
        ("meritAid", (query.merit_aid_min, query.merit_aid_max)),
        ("gradFour", (query.grad_four_min, query.grad_four_max)),
        ("gradSix", (query.grad_six_min, query.grad_six_max)),
        ("retention", (query.retention_min, query.retention_max)),
        ("ratio", (query.ratio_min, query.ratio_max)),
        ("housing", (query.housing_min, query.housing_max)),
        ("international", (query.international_min, query.international_max)),
    ):
        if key == "cost":
            continue  # built separately below (home_state picks the basis)
        clause = _range_clause(key, _RANGE_COLUMNS[key], min_v, max_v)
        if clause:
            clauses.append(clause)
    if query.cost_min is not None or query.cost_max is not None:
        column = (
            "CASE WHEN state = {} THEN cost_attendance_in_state "
            "ELSE cost_attendance_out_of_state END"
            if query.home_state
            else "cost_attendance_out_of_state"
        )
        params: list[Any] = [query.home_state] if query.home_state else []
        if query.cost_min is not None and query.cost_max is not None:
            sql = f"({column}) BETWEEN {{}} AND {{}}"
            params += [query.cost_min, query.cost_max]
        elif query.cost_min is not None:
            sql = f"({column}) >= {{}}"
            params.append(query.cost_min)
        else:
            sql = f"({column}) <= {{}}"
            params.append(query.cost_max)
        clauses.append(
            _Clause(
                "cost",
                METRIC_LABELS["cost"],
                "missing",
                sql,
                tuple(params),
                "(cost_attendance_in_state IS NULL AND cost_attendance_out_of_state IS NULL)",
            )
        )
    # `include_missing` opts a range key's null rows back IN by dropping its
    # clause from filtering while still reporting the exclusion count as 0
    # for it -- simplest correct implementation: drop the clause entirely.
    if query.include_missing:
        clauses = [c for c in clauses if c.key not in query.include_missing]
    return clauses


def _resolve_sort(sort: str) -> tuple[str, str]:
    key, _, direction = sort.partition(":")
    if key not in _SORT_KEYS or direction not in ("asc", "desc"):
        return "name", "asc"
    return key, direction


def _split_region_label(value: str) -> tuple[str, str | None]:
    if "(" in value and value.endswith(")"):
        label, _, rest = value.partition("(")
        return label.strip(), rest[:-1].strip()
    return value, None


def _wire_value(value: object) -> object:
    """asyncpg returns Postgres `numeric` columns as `Decimal`, which pydantic
    serializes to a JSON *string* on an untyped `fields: dict[str, object]`
    (`ExploreSchoolCard.fields` is deliberately not a hand-typed mirror of
    `EXPLORE_COLUMNS`, plan §5.3). `integer` columns already come back as
    native `int` -- only `numeric` columns need this. Every `numeric` column
    here (rates, GPA, percentages) is written from a Python `float` in the
    first place (`app/facts/explore_projection.py`'s `_as_float`), so the
    Decimal->float round trip loses nothing that wasn't already lost when it
    was first stored."""
    return float(value) if isinstance(value, Decimal) else value


def _fit_estimate(admit_rate: object) -> FitEstimate:
    """Classify one row and hand the wire the rate the category came from."""
    estimate = estimate_admissions_fit(admit_rate)
    return FitEstimate(
        category=estimate.category.value,
        admit_rate=float(estimate.admit_rate) if estimate.admit_rate is not None else None,
    )


async def run_explore(
    catalog: Catalog,
    query: ExploreQuery,
    settings: Settings,
) -> ExploreResponse:
    clauses = _build_clauses(query)
    where, params = _combine(clauses)
    sort_key, direction = _resolve_sort(query.sort)
    sort_column = _SORT_KEYS[sort_key]
    page_size = min(
        query.page_size or settings.facts_explore_page_size, settings.facts_explore_max_page_size
    )
    offset = (query.page - 1) * page_size
    columns_sql = ", ".join(EXPLORE_COLUMNS)
    # LIMIT/OFFSET are code-owned ints (page_size/offset, both clamped
    # above), never a caller-controlled string -- bound as literals rather
    # than $N params only so every filter clause above keeps its own stable
    # numbering across page turns.
    main_sql = (
        f"SELECT school_id, name, city, state, official_website, facts_updated_at, "
        f"{columns_sql}, count(*) OVER() AS total_count FROM {_TABLE} "
        f"WHERE {where} ORDER BY {sort_column} {direction} NULLS LAST, school_id ASC "
        f"LIMIT {int(page_size)} OFFSET {int(offset)}"
    )
    control_where, control_params = _combine(clauses, skip="control")
    control_sql = (
        f"SELECT control, count(*) AS n FROM {_TABLE} WHERE {control_where} GROUP BY control"
    )
    region_options_sql = f"SELECT DISTINCT region FROM {_TABLE} ORDER BY 1"
    campus_options_sql = (
        f"SELECT DISTINCT split_part(locale, ':', 1) AS family FROM {_TABLE} "
        "WHERE locale IS NOT NULL ORDER BY 1"
    )
    religious_options_sql = (
        f"SELECT DISTINCT religious_affiliation FROM {_TABLE} "
        "WHERE religious_affiliation IS NOT NULL ORDER BY 1"
    )

    def _count_statement(where_body: str, where_params: list[Any]) -> tuple[str, list[Any]]:
        return f"SELECT count(*) AS n FROM {_TABLE} WHERE {where_body}", where_params

    exclusion_eligible = [c for c in clauses if c.null_sql is not None]
    exclusion_statements = [
        _count_statement(*_combine(clauses, skip=c.key, null_check_for=c.key))
        for c in exclusion_eligible
    ]
    # One transaction (`db_service.explore` owns the snapshot), so the page
    # and every count/option derived from the same filter set agree.
    statements: list[tuple[str, list[Any]]] = [
        (main_sql, params),
        (control_sql, control_params),
        (region_options_sql, []),
        (campus_options_sql, []),
        (religious_options_sql, []),
        *exclusion_statements,
    ]
    (
        main_rows,
        control_rows,
        region_rows,
        campus_rows,
        religious_rows,
        *exclusion_rows,
    ) = await db_service.explore(catalog, statements)

    total = main_rows[0]["total_count"] if main_rows else 0
    total_is_capped = total > settings.facts_explore_max_count
    total = min(total, settings.facts_explore_max_count)

    schools = tuple(
        ExploreSchoolCard(
            unitid=row["school_id"],
            name=row["name"],
            city=row["city"],
            state=row["state"],
            website_url=row["official_website"],
            fields={col: _wire_value(row[col]) for col in EXPLORE_COLUMNS},
            fit=_fit_estimate(row["admit_rate"]),
        )
        for row in main_rows
    )
    observed_dates = [
        row["facts_updated_at"] for row in main_rows if row["facts_updated_at"] is not None
    ]
    facts_observed_from = None
    if observed_dates:
        oldest = min(observed_dates)
        if (datetime.now(UTC) - oldest).days > settings.facts_stale_days:
            facts_observed_from = oldest.isoformat()

    exclusions = tuple(
        Exclusion(
            key=clause.key,
            metric_label=clause.metric_label,
            count=rows[0]["n"],
            reason=clause.reason,
        )
        for clause, rows in zip(exclusion_eligible, exclusion_rows, strict=True)
        if rows[0]["n"] > 0
    )

    sorted_null_tail = None
    if sort_key != "name":
        tail_where, tail_params = _combine(clauses)
        tail_sql = (
            f"SELECT count(*) AS n FROM {_TABLE} WHERE {tail_where} AND {sort_column} IS NULL"
        )
        (tail_rows,) = await db_service.explore(catalog, [(tail_sql, tail_params)])
        if tail_rows[0]["n"] > 0:
            sorted_null_tail = NullTail(
                count=tail_rows[0]["n"], metric_label=METRIC_LABELS.get(sort_key, sort_key)
            )

    narrowest = None
    if total == 0 and clauses:
        removal_statements = [_count_statement(*_combine(clauses, skip=c.key)) for c in clauses]
        removal_results = await db_service.explore(catalog, removal_statements)
        best_key, best_count = None, -1
        for clause, rows in zip(clauses, removal_results, strict=True):
            count = rows[0]["n"]
            if count > best_count:
                best_key, best_count = clause.key, count
        if best_key is not None:
            label = METRIC_LABELS.get(best_key) or best_key
            narrowest = Narrowest(key=best_key, label=label, remaining_without_it=best_count)

    def _region_option(row: Any) -> FilterOption:
        label, states = _split_region_label(row["region"])
        return FilterOption(value=row["region"], label=label, states=states)

    control_counts: dict[Control, int] = {"public": 0, "private": 0, "private_for_profit": 0}
    for row in control_rows:
        if row["control"] in control_counts:
            control_counts[row["control"]] = row["n"]

    return ExploreResponse(
        schools=schools,
        page=query.page,
        page_size=page_size,
        total=total,
        total_is_capped=total_is_capped,
        exclusions=exclusions,
        sorted_null_tail=sorted_null_tail,
        control_counts=control_counts,
        narrowest=narrowest,
        filter_options=FilterOptions(
            region=tuple(_region_option(row) for row in region_rows),
            campus_setting=tuple(
                FilterOption(value=row["family"], label=row["family"]) for row in campus_rows
            ),
            religious_affiliation=tuple(
                FilterOption(value=row["religious_affiliation"], label=row["religious_affiliation"])
                for row in religious_rows
            ),
        ),
        facts_observed_from=facts_observed_from,
        entrance_difficulty_note=ENTRANCE_DIFFICULTY_NOTE,
        majors_match_note=MAJORS_MATCH_NOTE,
        religious_affiliation_note=RELIGIOUS_AFFILIATION_NOTE,
    )


async def run_majors(catalog: Catalog, q: str) -> MajorsResponse:
    rows = await db_service.majors(catalog, q)
    return MajorsResponse(
        majors=tuple(MajorOption(name=name, school_count=count) for name, count in rows),
        majors_match_note=MAJORS_MATCH_NOTE,
    )
