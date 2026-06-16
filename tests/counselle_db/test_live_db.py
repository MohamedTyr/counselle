"""Live integration tests for the counselle-db service layer (phase-2 Slice D).

Every test hits the real pipeline database and asserts the stable facts from
DATABASE_GUIDE exactly (Duke/Stanford/MIT resolution, envelope correctness,
the COA sibling trap, escape-hatch guards, read-only enforcement).
"""

import asyncpg
import pytest

from counselle_db.catalog import Catalog
from counselle_db.models import (
    FieldKeyError,
    ResolveCandidates,
    ResolveMatch,
    ResolveNotFound,
    ServiceError,
)
from counselle_db.service import (
    compare_schools,
    get_data_calendar,
    get_diversity,
    get_dossier,
    get_programs,
    get_values,
    national_benchmark,
    query_database,
    resolve_school,
)
from domain.envelope import CitationEnvelope

pytestmark = pytest.mark.live_db

DUKE = 198419
HARVARD = 166027
# COA sibling-trap school (DATABASE_GUIDE §13.7): found live 2026-06-10 via
#   SELECT s.unitid FROM schools s
#   WHERE EXISTS (SELECT 1 FROM field_values fv WHERE fv.unitid = s.unitid
#                  AND fv.field_key = 'cost.on_campus_room_board_other'
#                  AND fv.value IS NOT NULL)
#     AND NOT EXISTS (SELECT 1 FROM field_values fv WHERE fv.unitid = s.unitid
#                  AND fv.field_key = 'cost.room_and_board' AND fv.value IS NOT NULL)
#   ORDER BY s.unitid LIMIT 1;
# → 100654, Alabama A & M University (room_and_board NULL, sibling = $11,402).
ALABAMA_AM = 100654

ACCEPTANCE_RATE = "admissions.acceptance_rate"
ROOM_AND_BOARD = "cost.room_and_board"
ROOM_BOARD_SIBLING = "cost.on_campus_room_board_other"


# --- resolve_school -----------------------------------------------------------


async def test_resolve_duke_matches_unitid_198419_with_cds_extracted_tier(
    catalog: Catalog,
) -> None:
    # Act
    result = await resolve_school(catalog, "Duke")

    # Assert
    assert isinstance(result, ResolveMatch)
    assert result.school.unitid == DUKE
    assert result.coverage_tier == "cds_extracted"


async def test_resolve_mit_expands_the_abbreviation_to_the_full_name(catalog: Catalog) -> None:
    # Act
    result = await resolve_school(catalog, "MIT")

    # Assert
    assert isinstance(result, ResolveMatch)
    assert result.school.name == "Massachusetts Institute of Technology"


async def test_resolve_stanford_is_pdf_only_the_stanford_trap(catalog: Catalog) -> None:
    # Stanford: PDF on file, extract_status 'done', but ZERO extracted values.
    # Act
    result = await resolve_school(catalog, "Stanford")

    # Assert
    assert isinstance(result, ResolveMatch)
    assert result.coverage_tier == "cds_pdf_only"


async def test_resolve_hogwarts_is_honestly_not_found(catalog: Catalog) -> None:
    # Act
    result = await resolve_school(catalog, "Hogwarts School of Witchcraft")

    # Assert
    assert isinstance(result, ResolveNotFound)
    assert result.status == "not_found"


async def test_resolve_unc_chapel_hill_fuzzy_offers_the_full_name(catalog: Catalog) -> None:
    # "UNC Chapel Hill" is not a substring of the DB name — the trigram
    # fallback must find it (Phase 7 eval regression: false not-in-DB claim).
    # Sub-exact fuzzy hits surface as candidates so the agent confirms with
    # the student instead of silently guessing.
    # Act
    result = await resolve_school(catalog, "UNC Chapel Hill")

    # Assert
    assert isinstance(result, ResolveCandidates)
    assert "University of North Carolina at Chapel Hill" in [
        school.name for school in result.candidates
    ]


async def test_resolve_alabama_am_punctuation_variant_is_a_direct_match(catalog: Catalog) -> None:
    # DB stores "Alabama A & M University"; the spacing variant must resolve
    # directly (trigram score 1.0 — no clarifying question needed).
    # Act
    result = await resolve_school(catalog, "Alabama A&M University")

    # Assert
    assert isinstance(result, ResolveMatch)
    assert result.school.name == "Alabama A & M University"


# --- get_values ----------------------------------------------------------------


async def test_acceptance_rate_is_one_cited_scorecard_percent_envelope(catalog: Catalog) -> None:
    # Act
    results = await get_values(catalog, DUKE, [ACCEPTANCE_RATE])

    # Assert
    assert len(results) == 1
    envelope = results[0]
    assert isinstance(envelope, CitationEnvelope)
    assert envelope.unit == "percent"
    assert envelope.display.endswith("%")
    assert envelope.citation.source == "scorecard"
    assert "Scorecard" in envelope.citation.vintage
    assert isinstance(envelope.raw, float)
    assert 0 < envelope.raw < 1


async def test_website_display_starts_with_https(catalog: Catalog) -> None:
    # Act
    results = await get_values(catalog, DUKE, ["institution.website"])

    # Assert
    assert len(results) == 1
    envelope = results[0]
    assert isinstance(envelope, CitationEnvelope)
    assert envelope.display.startswith("https://")


async def test_coded_ipeds_int_field_displays_a_decoded_label_not_the_code(
    catalog: Catalog,
) -> None:
    # R1 end-to-end: institution.control is a coded IPEDS int — the student must
    # see the decoded label, never the bare code digit.
    # Act
    results = await get_values(catalog, DUKE, ["institution.control"])

    # Assert
    assert len(results) == 1
    envelope = results[0]
    assert isinstance(envelope, CitationEnvelope)
    assert envelope.available
    assert not envelope.display.isdigit()  # never the bare code
    assert any(char.isalpha() for char in envelope.display)  # a real label


async def test_bogus_key_yields_an_error_entry_never_an_invented_envelope(
    catalog: Catalog,
) -> None:
    # Act
    results = await get_values(catalog, DUKE, ["bogus.key"])

    # Assert
    assert len(results) == 1
    entry = results[0]
    assert isinstance(entry, FieldKeyError)
    assert entry.field == "bogus.key"
    assert entry.error == "unknown field key"
    assert not isinstance(entry, CitationEnvelope)


# --- compare_schools -------------------------------------------------------------


async def test_compare_two_schools_on_two_fields_yields_2x2_cited_cells(
    catalog: Catalog,
) -> None:
    # Act
    result = await compare_schools(
        catalog, [DUKE, HARVARD], [ACCEPTANCE_RATE, "cost.tuition_in_state"]
    )

    # Assert — 2 rows × 2 cells, every available cell carries a citation.
    assert len(result.schools) == 2
    assert len(result.rows) == 2
    for row in result.rows:
        assert len(row.cells) == 2
        for cell in row.cells:
            if cell.available:
                assert cell.citation.source in ("ipeds", "scorecard", "cds")
                assert cell.citation.vintage


# --- get_dossier ------------------------------------------------------------------


async def test_duke_dossier_has_sections_a_through_f_with_cds_data_in_a(
    catalog: Catalog,
) -> None:
    # Act
    dossier = await get_dossier(catalog, DUKE)

    # Assert — all six sections, and section A surfaces Duke's extracted CDS.
    assert [section.id for section in dossier.sections] == ["A", "B", "C", "D", "E", "F"]
    section_a = dossier.sections[0]
    cds_envelopes = [
        env for env in section_a.values if env.citation.source == "cds" and env.available
    ]
    assert len(cds_envelopes) >= 1
    # No shortlist key has drifted out of the catalog — warnings stay empty.
    assert dossier.warnings == []


async def test_dossier_emits_the_coa_sibling_when_room_and_board_is_null(
    catalog: Catalog,
) -> None:
    # The COA sibling trap (§13.7): Alabama A & M has cost.room_and_board NULL
    # but cost.on_campus_room_board_other populated — the dossier must emit the
    # sibling, never "not available".
    # Act
    dossier = await get_dossier(catalog, ALABAMA_AM)

    # Assert
    section_b = next(section for section in dossier.sections if section.id == "B")
    fields = {env.field: env for env in section_b.values}
    assert ROOM_AND_BOARD not in fields  # the unavailable primary was replaced
    sibling = fields[ROOM_BOARD_SIBLING]
    assert sibling.available
    assert sibling.display != "not available"
    assert sibling.display.startswith("$")


# --- national_benchmark ------------------------------------------------------------


async def test_acceptance_rate_benchmark_has_all_stats_across_over_1000_schools(
    catalog: Catalog,
) -> None:
    # Act
    result = await national_benchmark(catalog, ACCEPTANCE_RATE)

    # Assert
    assert result.n > 1000
    for stat in (result.median, result.mean, result.p25, result.p75):
        assert isinstance(stat.raw, float)
        assert stat.display.endswith("%")
    assert result.p25.raw <= result.median.raw <= result.p75.raw


async def test_bbrr_percent_field_benchmark_does_not_crash(catalog: Catalog) -> None:
    # DS-08: BBRR percent fields can carry jsonb privacy-range STRING tokens
    # ("<=0.05", "0.05-0.09") per R4 alongside numbers. Casting a string token to
    # ::numeric crashed the benchmark; the jsonb_typeof = 'number' predicate must
    # skip them so the benchmark a student asked for returns valid stats.
    #
    # `outcomes.bbrr2_ug_default` is a numeric-typed BBRR percent field that
    # reaches the benchmark SQL — it must aggregate cleanly under the predicate.
    # Act — should NOT raise ServiceError.
    result = await national_benchmark(catalog, "outcomes.bbrr2_ug_default")

    # Assert — valid distribution computed over the numeric rows.
    assert result.n >= 1
    for stat in (result.median, result.mean, result.p25, result.p75):
        assert isinstance(stat.raw, float)
        assert stat.display.endswith("%")


async def test_benchmark_sql_predicate_skips_string_tokens(catalog: Catalog) -> None:
    # DS-08 (the load-bearing assertion): the jsonb_typeof = 'number' predicate is
    # what prevents the ::numeric crash on a token-mixed BBRR field. Running the
    # real _BENCHMARK_SQL over `outcomes.bbrr2_pell_default` (privacy-range string
    # tokens per R4) must execute cleanly — without the predicate, the cast raises
    # a Postgres InvalidParameterValueError. The numeric rows there are 0, so the
    # benchmark's data_type guard rightly never serves it; this test pins the SQL.
    from counselle_db.service import _BENCHMARK_SQL

    # Act — the guarded SQL must not raise on the token-mixed field.
    rows = await catalog.pool.fetch(
        _BENCHMARK_SQL, "outcomes.bbrr2_pell_default", "scorecard"
    )

    # Assert — it ran (string tokens skipped), and a clean numeric field aggregates.
    assert rows[0]["n"] == 0  # all rows are string tokens → none benchmarkable
    numeric_rows = await catalog.pool.fetch(
        _BENCHMARK_SQL, "outcomes.bbrr2_ug_default", "scorecard"
    )
    assert numeric_rows[0]["n"] >= 1
    assert numeric_rows[0]["median"] is not None


# --- get_programs / get_diversity -----------------------------------------------------


async def test_duke_programs_returns_bachelors_rows_only(catalog: Catalog) -> None:
    # Act
    programs = await get_programs(catalog, DUKE)

    # Assert
    assert len(programs) > 0
    assert all(program.credlev == 3 for program in programs)


async def test_duke_diversity_has_a_positive_total_and_nine_race_groups(
    catalog: Catalog,
) -> None:
    # Act
    breakdown = await get_diversity(catalog, DUKE)

    # Assert
    assert breakdown is not None
    assert breakdown.total is not None
    assert breakdown.total > 0
    assert len(breakdown.by_race) == 9


# --- query_database (Layer 3) + read-only enforcement -----------------------------------


async def test_query_database_rejects_a_delete_statement(catalog: Catalog) -> None:
    # Act / Assert — a tool-level error with a readable message, not a crash.
    with pytest.raises(ServiceError, match="read-only"):
        await query_database(catalog, "DELETE FROM schools", [])


async def test_query_database_counts_2746_schools(catalog: Catalog) -> None:
    # Act
    result = await query_database(catalog, "SELECT count(*) FROM schools", [])

    # Assert
    assert result.row_count == 1
    assert result.rows[0][0] == 2746


async def test_an_update_through_the_ro_pool_raises_read_only_enforcement(
    catalog: Catalog,
) -> None:
    # The gate requirement: counselle_ro verifiably cannot write, even bypassing
    # the query_database guard.
    # Act / Assert
    with pytest.raises(asyncpg.PostgresError):
        async with catalog.pool.acquire() as conn:
            await conn.execute("UPDATE schools SET name = name WHERE unitid = $1", DUKE)


# --- get_data_calendar -------------------------------------------------------------------


async def test_data_calendar_has_three_sources_with_the_scorecard_publication_month(
    catalog: Catalog,
) -> None:
    # Act
    entries = await get_data_calendar(catalog)

    # Assert
    assert len(entries) == 3
    assert {entry.source for entry in entries} == {"ipeds", "scorecard", "cds"}
    scorecard = next(entry for entry in entries if entry.source == "scorecard")
    assert "Mar 2026" in scorecard.vintage
