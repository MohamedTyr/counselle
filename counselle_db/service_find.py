"""find_schools — cross-database filter/rank (DATABASE_GUIDE §14.3, eng-review D5).

Safe-construction recipe (MANDATORY — D5):
(a) every field_key is validated against the in-memory catalog BEFORE any SQL
    string is assembled — unknown key → tool error, no SQL;
(b) field keys are bound as parameters in ``fv.field_key = $n`` — never interpolated;
(c) JOIN aliases are generated internally (``f0``, ``f1``, …) — never from input;
(d) ``op`` maps through a fixed dict; (e) ``dir`` through a fixed dict;
(f) ``limit`` is clamped server-side and bound as a parameter.
The only f-stringed SQL fragments are the generated aliases and the dict-looked-up
op/dir tokens — all from trusted whitelists, never user input.
"""

from typing import Literal

from pydantic import BaseModel, Field

from counselle_db.catalog import Catalog
from counselle_db.db import fetch
from counselle_db.models import FindHit, SchoolBasics, ServiceError
from domain.normalize import FieldMeta

_OPS: dict[str, str] = {"lt": "<", "lte": "<=", "gt": ">", "gte": ">=", "eq": "="}
_DIRS: dict[str, str] = {"asc": "ASC", "desc": "DESC"}
#: Sanity caps — protocol limits, not tuning knobs (phase-2 Slice C #5).
_MAX_FILTERS = 8
_LIMIT_DEFAULT = 20
_LIMIT_MAX = 50
#: Only these data_types can take a numeric cast (jsonb → numeric).
_NUMERIC_TYPES = frozenset({"int", "number", "percent", "currency"})

#: Convenience criteria → (field_key, op). Percent filters are 0–1 fractions (§14).
_DERIVED_FILTERS: dict[str, tuple[str, Literal["lt", "lte", "gt", "gte", "eq"]]] = {
    "max_admit_rate": ("admissions.acceptance_rate", "lte"),
    "min_admit_rate": ("admissions.acceptance_rate", "gte"),
    "min_sat_avg": ("admissions.sat_average", "gte"),
    "max_net_price": ("aid.avg_net_price_title4", "lte"),
}


class FieldFilter(BaseModel):
    field_key: str
    op: Literal["lt", "lte", "gt", "gte", "eq"]
    value: float


class OrderBy(BaseModel):
    field_key: str
    dir: Literal["asc", "desc"] = "asc"


class FindCriteria(BaseModel):
    """Filter/rank criteria. Percent values are 0–1 fractions (0.30, not 30)."""

    state: str | None = None
    control: Literal["public", "private_nonprofit", "private_forprofit"] | None = None
    max_admit_rate: float | None = None
    min_admit_rate: float | None = None
    min_sat_avg: float | None = None
    max_net_price: float | None = None
    field_filters: list[FieldFilter] = Field(default_factory=list)
    order_by: OrderBy | None = None
    limit: int = _LIMIT_DEFAULT


def _numeric_meta(catalog: Catalog, field_key: str) -> FieldMeta:
    """(D5-a) Validate a field key against the catalog BEFORE SQL assembly."""
    meta = catalog.fields_by_key.get(field_key)
    if meta is None:
        raise ServiceError(f"unknown field key: {field_key!r}")
    if meta.data_type not in _NUMERIC_TYPES:
        raise ServiceError(f"field {field_key!r} is {meta.data_type}, not numeric-filterable")
    return meta


def _all_filters(criteria: FindCriteria) -> list[FieldFilter]:
    filters = [
        FieldFilter(field_key=key, op=op, value=value)
        for name, (key, op) in _DERIVED_FILTERS.items()
        if (value := getattr(criteria, name)) is not None
    ]
    filters.extend(criteria.field_filters)
    if len(filters) > _MAX_FILTERS:
        raise ServiceError(f"too many field filters: {len(filters)} (max {_MAX_FILTERS})")
    return filters


class _SqlBuilder:
    """Accumulates bound parameters; only whitelist-derived fragments are f-stringed."""

    def __init__(self) -> None:
        self.params: list[object] = []

    def bind(self, value: object) -> str:
        self.params.append(value)
        return f"${len(self.params)}"


def _build_sql(
    catalog: Catalog, criteria: FindCriteria, filters: list[FieldFilter]
) -> tuple[str, list[object], list[tuple[str, str]]]:
    """Assemble the §14.3-shaped query. Returns (sql, params, [(alias, field_key)])."""
    builder = _SqlBuilder()
    select_cols = ["s.unitid", "s.name", "s.city", "s.state", "s.control", "s.level"]
    joins: list[str] = []
    aliased: list[tuple[str, str]] = []  # (generated alias, field_key) — D5-c
    for index, field_filter in enumerate(filters):
        _numeric_meta(catalog, field_filter.field_key)
        alias, op = f"f{index}", _OPS[field_filter.op]  # D5-c, D5-d
        key_param = builder.bind(field_filter.field_key)  # D5-b
        value_param = builder.bind(float(field_filter.value))
        joins.append(
            f"JOIN field_values {alias} ON {alias}.unitid = s.unitid"
            f" AND {alias}.field_key = {key_param} AND {alias}.value IS NOT NULL"
            f" AND ({alias}.value)::numeric {op} {value_param}"
        )
        select_cols += [f"{alias}.value AS {alias}_value", f"{alias}.cycle_year AS {alias}_year"]
        aliased.append((alias, field_filter.field_key))
    order_sql = _order_clause(catalog, criteria, builder, joins, select_cols, aliased)
    where: list[str] = []
    if criteria.state:
        where.append(f"s.state = {builder.bind(criteria.state.strip().upper())}")
    if criteria.control:
        where.append(f"s.control = {builder.bind(criteria.control)}")
    limit_param = builder.bind(max(1, min(criteria.limit, _LIMIT_MAX)))  # D5-f
    sql = "\n".join(
        [
            f"SELECT {', '.join(select_cols)}",
            "FROM schools s",
            *joins,
            *(["WHERE " + " AND ".join(where)] if where else []),
            order_sql,
            f"LIMIT {limit_param}",
        ]
    )
    return sql, builder.params, aliased


def _order_clause(
    catalog: Catalog,
    criteria: FindCriteria,
    builder: _SqlBuilder,
    joins: list[str],
    select_cols: list[str],
    aliased: list[tuple[str, str]],
) -> str:
    if criteria.order_by is None:
        if aliased:  # default rank: first filter's value, ascending
            return f"ORDER BY ({aliased[0][0]}.value)::numeric ASC, s.name"
        return "ORDER BY s.name"
    _numeric_meta(catalog, criteria.order_by.field_key)
    direction = _DIRS[criteria.order_by.dir]  # D5-e
    alias = next((a for a, key in aliased if key == criteria.order_by.field_key), None)
    if alias is None:
        alias = "fo"  # generated, never from input (D5-c)
        key_param = builder.bind(criteria.order_by.field_key)
        joins.append(
            f"JOIN field_values {alias} ON {alias}.unitid = s.unitid"
            f" AND {alias}.field_key = {key_param} AND {alias}.value IS NOT NULL"
        )
        select_cols += [f"{alias}.value AS {alias}_value", f"{alias}.cycle_year AS {alias}_year"]
        aliased.append((alias, criteria.order_by.field_key))
    return f"ORDER BY ({alias}.value)::numeric {direction}, s.name"


async def find_schools(catalog: Catalog, criteria: FindCriteria) -> list[FindHit]:
    """Filter/rank schools across the database; values come back as envelopes."""
    from counselle_db.service import envelope_for  # one choke point, no cycle at import time

    filters = _all_filters(criteria)
    if not filters and not criteria.state and not criteria.control:
        raise ServiceError("give at least one criterion (state, control, or a field filter)")
    sql, params, aliased = _build_sql(catalog, criteria, filters)
    rows = await fetch(catalog.pool, sql, *params)
    hits: list[FindHit] = []
    for row in rows:
        envelopes = [
            await envelope_for(
                catalog,
                row["unitid"],
                catalog.fields_by_key[field_key],
                row[f"{alias}_value"],
                row[f"{alias}_year"],
            )
            for alias, field_key in aliased
        ]
        school = SchoolBasics(**{k: row[k] for k in SchoolBasics.model_fields})
        hits.append(FindHit(school=school, values=envelopes))
    return hits
