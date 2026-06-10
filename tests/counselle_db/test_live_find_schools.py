"""find_schools live tests + the eng-review D5 adversarial suite (phase-2 Slice C/D).

The adversarial tests prove the safe-construction recipe: injected field keys
are rejected BEFORE any SQL string is assembled, order direction is a fixed
whitelist, the filter count is capped, and the generated SQL contains only
internally generated aliases (whitebox via ``_build_sql``).
"""

import re

import pytest
from pydantic import ValidationError

from counselle_db.catalog import Catalog
from counselle_db.models import ServiceError
from counselle_db.service_find import (
    FieldFilter,
    FindCriteria,
    OrderBy,
    _all_filters,
    _build_sql,
    find_schools,
)

pytestmark = pytest.mark.live_db

ACCEPTANCE_RATE = "admissions.acceptance_rate"
INJECTED_KEY = "x'; DROP TABLE schools;--"


# --- live behavior ------------------------------------------------------------


async def test_selective_public_ca_schools_all_match_every_criterion(catalog: Catalog) -> None:
    # Arrange
    criteria = FindCriteria(state="CA", control="public", max_admit_rate=0.30)

    # Act
    hits = await find_schools(catalog, criteria)

    # Assert — >0 rows, all CA, every admit-rate raw under the cap.
    assert len(hits) > 0
    for hit in hits:
        assert hit.school.state == "CA"
        admit_rate = next(env for env in hit.values if env.field == ACCEPTANCE_RATE)
        assert isinstance(admit_rate.raw, float)
        assert admit_rate.raw < 0.30


# --- adversarial (eng-review D5) -----------------------------------------------


async def test_injected_filter_field_key_is_rejected(catalog: Catalog) -> None:
    # Arrange
    criteria = FindCriteria(field_filters=[FieldFilter(field_key=INJECTED_KEY, op="lt", value=1.0)])

    # Act / Assert
    with pytest.raises(ServiceError, match="unknown field key"):
        await find_schools(catalog, criteria)


async def test_injected_order_by_field_key_is_rejected(catalog: Catalog) -> None:
    # Arrange
    criteria = FindCriteria(state="CA", order_by=OrderBy(field_key=INJECTED_KEY))

    # Act / Assert
    with pytest.raises(ServiceError, match="unknown field key"):
        await find_schools(catalog, criteria)


async def test_injected_field_key_never_reaches_sql_assembly_whitebox(catalog: Catalog) -> None:
    # Whitebox proof of D5-a: validation fires inside the SQL builder before any
    # fetch — the injected key is rejected pre-SQL, with zero database round trips.
    # Arrange
    criteria = FindCriteria(field_filters=[FieldFilter(field_key=INJECTED_KEY, op="lt", value=1.0)])
    filters = _all_filters(criteria)

    # Act / Assert
    with pytest.raises(ServiceError, match="unknown field key"):
        _build_sql(catalog, criteria, filters)


def test_bogus_order_dir_is_rejected_at_validation() -> None:
    # Act / Assert — D5-e: dir is a fixed whitelist; "ASC; DELETE" never parses.
    with pytest.raises(ValidationError):
        OrderBy(field_key=ACCEPTANCE_RATE, dir="ASC; DELETE FROM schools")  # type: ignore[arg-type]


async def test_more_than_eight_filters_is_rejected(catalog: Catalog) -> None:
    # Arrange
    criteria = FindCriteria(
        field_filters=[FieldFilter(field_key=ACCEPTANCE_RATE, op="lt", value=1.0) for _ in range(9)]
    )

    # Act / Assert
    with pytest.raises(ServiceError, match="too many field filters"):
        await find_schools(catalog, criteria)


async def test_generated_sql_contains_only_internal_aliases_whitebox(catalog: Catalog) -> None:
    # Arrange — two filters plus an order_by on a third field (gets the `fo` alias).
    criteria = FindCriteria(
        state="CA",
        field_filters=[
            FieldFilter(field_key=ACCEPTANCE_RATE, op="lte", value=0.5),
            FieldFilter(field_key="cost.tuition_in_state", op="lte", value=60000.0),
        ],
        order_by=OrderBy(field_key="admissions.sat_average", dir="desc"),
    )
    filters = _all_filters(criteria)

    # Act
    sql, params, aliased = _build_sql(catalog, criteria, filters)

    # Assert — aliases are generated (f0, f1, fo); field keys ride only as bound
    # parameters, never interpolated into the SQL text (D5-b, D5-c).
    join_aliases = re.findall(r"JOIN field_values (\w+)", sql)
    assert join_aliases == ["f0", "f1", "fo"]
    assert all(re.fullmatch(r"f\d+|fo", alias) for alias, _ in aliased)
    for key in (ACCEPTANCE_RATE, "cost.tuition_in_state", "admissions.sat_average"):
        assert key not in sql
        assert key in params
