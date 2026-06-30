"""DB evidence gathering regressions for deep research."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.research.gather_db import _fetch_school_data
from counselle_db.models import ResolveMatch, SchoolBasics


@pytest.mark.asyncio
async def test_fetch_school_data_reads_dossier_section_values() -> None:
    evidence = object()
    deps = SimpleNamespace(catalog=MagicMock())
    match = ResolveMatch(
        school=SchoolBasics(unitid=166683, name="Massachusetts Institute of Technology"),
        coverage_tier="base",
        tier_explanation="base coverage",
    )
    dossier = SimpleNamespace(
        sections=[
            SimpleNamespace(values=[evidence]),
            SimpleNamespace(values=[]),
        ]
    )

    with (
        patch("counselle_db.service.resolve_school", new_callable=AsyncMock) as resolve_school,
        patch("app.research.gather_db.get_dossier", new_callable=AsyncMock) as get_dossier,
    ):
        resolve_school.return_value = match
        get_dossier.return_value = dossier

        result = await _fetch_school_data("MIT", deps)

    assert result == [evidence]
    get_dossier.assert_awaited_once_with(deps.catalog, 166683)
