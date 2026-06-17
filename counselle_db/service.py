"""The counselle-db service layer — the real API (eng-review D2; ARCHITECTURE §8).

Every tool behavior lives here as a plain async function returning domain types;
the MCP server (Slice C) is a ~3-line shell per tool, and ``app/`` imports this
module directly. ``envelope_for`` is THE single choke point: every value from
every tool is decoded, scaled, formatted, and cited through it (the honesty
guarantee — ADR 0006).
"""

import re
from typing import Any

import asyncpg

from config.settings import get_settings, load_yaml_asset
from counselle_db.catalog import CREDLEV_DECODE, CalendarEntry, Catalog
from counselle_db.db import fetch
from counselle_db.models import (
    BenchmarkResult,
    BenchmarkStat,
    CompareResult,
    CompareRow,
    DiversityBreakdown,
    Dossier,
    DossierSection,
    FieldKeyError,
    ProgramRow,
    QueryResult,
    RaceGroup,
    ResolveCandidates,
    ResolveMatch,
    ResolveNotFound,
    ResolveResult,
    SchoolBasics,
    ServiceError,
)
from counselle_db.service_find import FieldFilter, FindCriteria, OrderBy, find_schools
from domain.envelope import Citation, CitationEnvelope
from domain.normalize import FieldMeta, normalize
from domain.tiers import CoverageTier, compute_tier, tier_explanation
from domain.vintage import vintage_for

__all__ = [
    "FieldFilter",
    "FindCriteria",
    "OrderBy",
    "ServiceError",
    "compare_schools",
    "envelope_for",
    "find_schools",
    "get_data_calendar",
    "get_diversity",
    "get_dossier",
    "get_programs",
    "get_values",
    "national_benchmark",
    "query_database",
    "resolve_school",
]

#: Protocol sanity caps for compare_schools — not tuning knobs (phase-2 Slice C #4).
_COMPARE_MAX_SCHOOLS = 6
_COMPARE_MAX_FIELDS = 25
_PROGRAMS_PREVIEW_TOP_N = 10
_BACHELORS_CREDLEV = 3

_NOT_FOUND_MESSAGE = (
    "That school is not in our database — we cover ~2,746 curated 4-year US "
    "institutions. Tell the student honestly that we don't have data on it; "
    "do not invent values."
)
_CANDIDATES_HINT = (
    "Multiple campuses matched; the main campus is listed first. Pick the campus "
    "the student means, or ask them if it is genuinely ambiguous."
)

#: The SchoolBasics column list — the single source for every schools SELECT.
#: Must match SchoolBasics.model_fields (the _school_basics builder, below).
_SCHOOL_COLUMNS = "unitid, name, city, state, control, level"
_SCHOOL_SELECT = f"SELECT {_SCHOOL_COLUMNS} FROM schools"

_SCHOOL_SQL = f"{_SCHOOL_SELECT} WHERE unitid = $1"
_SEARCH_SQL = f"{_SCHOOL_SELECT} WHERE name ILIKE '%' || $1 || '%' ORDER BY name LIMIT 10"
# Trigram fallback when ILIKE finds nothing — catches punctuation/word-order
# variants ("Alabama A&M" vs "Alabama A & M", "UNC Chapel Hill") so we never
# falsely tell a student a school is not in the database (honesty carve-out).
# pg_trgm similarity() handles whole-name closeness; word_similarity() handles
# partial-name queries. Thresholds tuned against the live DB (Phase 7).
_FUZZY_SEARCH_SQL = (
    f"SELECT {_SCHOOL_COLUMNS}, "
    "GREATEST(similarity(name, $1), word_similarity($1, name)) AS score "
    "FROM schools "
    "WHERE similarity(name, $1) >= 0.4 OR word_similarity($1, name) >= 0.7 "
    "ORDER BY GREATEST(similarity(name, $1), word_similarity($1, name)) DESC, name "
    "LIMIT 5"
)
#: A fuzzy top hit at/above this score is unambiguous — return it as a direct
#: match instead of asking the student (e.g. "Alabama A&M" → "Alabama A & M").
_FUZZY_EXACT_SCORE = 0.95
_TIER_SQL = """
SELECT (SELECT count(*) FROM field_values
         WHERE unitid = $1 AND source = 'cds' AND value IS NOT NULL) AS cds_count,
       EXISTS(SELECT 1 FROM cds_files WHERE unitid = $1)             AS has_pdf
"""
# Latest row per key (today no field has two years — DATABASE_GUIDE §5); NULL-value
# rows are kept so a stored sentinel surfaces as available=False, never invented.
# Scorecard rows are the cycle_year IS NULL rows by construction (§4.1) — NULLS FIRST
# so they win DISTINCT ON if a key ever has rows from two sources.
_VALUES_SQL = """
SELECT DISTINCT ON (field_key) field_key, value, cycle_year
FROM field_values
WHERE unitid = $1 AND field_key = ANY($2::text[])
ORDER BY field_key, cycle_year DESC NULLS FIRST
"""
_COMPARE_SQL = """
SELECT DISTINCT ON (unitid, field_key) unitid, field_key, value, cycle_year
FROM field_values
WHERE unitid = ANY($1::int[]) AND field_key = ANY($2::text[])
ORDER BY unitid, field_key, cycle_year DESC NULLS FIRST
"""
_BENCHMARK_SQL = """
SELECT percentile_cont(0.5)  WITHIN GROUP (ORDER BY (value)::numeric) AS median,
       avg((value)::numeric)                                          AS mean,
       percentile_cont(0.25) WITHIN GROUP (ORDER BY (value)::numeric) AS p25,
       percentile_cont(0.75) WITHIN GROUP (ORDER BY (value)::numeric) AS p75,
       count(*)                                                       AS n
FROM field_values
WHERE field_key = $1 AND source = $2
  AND value IS NOT NULL
  AND jsonb_typeof(value) = 'number'   -- skip BBRR privacy-range tokens (R4)
"""
_PROGRAMS_SQL = """
SELECT "CIPCODE", "CIPDESC", "CREDLEV", "CREDDESC", "IPEDSCOUNT2",
       "DEBT_ALL_STGP_ANY_MDN", "DEBT_ALL_STGP_ANY_MDN10YRPAY",
       "EARN_MDN_1YR", "EARN_MDN_4YR", "EARN_MDN_5YR"
FROM raw.scorecard_fos
WHERE unitid = $1 AND "CREDLEV" = $2
ORDER BY "CIPCODE"
"""
_DIVERSITY_SQL = """
SELECT * FROM raw.ipeds_ef2024a WHERE unitid = $1 AND "EFALEVEL" = '2' LIMIT 1
"""

#: IPEDS EF2024A column stems → student-readable race/ethnicity labels (§8).
_RACE_GROUPS: list[tuple[str, str]] = [
    ("EFAIAN", "American Indian or Alaska Native"),
    ("EFASIA", "Asian"),
    ("EFBKAA", "Black or African American"),
    ("EFHISP", "Hispanic or Latino"),
    ("EFNHPI", "Native Hawaiian or Other Pacific Islander"),
    ("EFWHIT", "White"),
    ("EF2MOR", "Two or more races"),
    ("EFUNKN", "Race/ethnicity unknown"),
    ("EFNRAL", "U.S. Nonresident"),
]

_CONTROL_DISPLAY = {
    "public": "Public",
    "private_nonprofit": "Private (nonprofit)",
    "private_forprofit": "Private (for-profit)",
}
#: Section-F pseudo keys served from ``public.schools`` (decoded text — R12).
_SCHOOLS_PSEUDO_LABELS = {
    "schools.city": "City",
    "schools.state": "State",
    "schools.control": "Control",
}

_SQL_FIRST_KEYWORD_RE = re.compile(r"^(select|with)\b", re.IGNORECASE)
_SQL_WRITE_KEYWORD_RE = re.compile(
    r"\b(insert|update|delete|merge|truncate|drop|alter|grant|revoke)\b", re.IGNORECASE
)
# Deny dangerous system/session functions called as function calls (with an opening
# parenthesis immediately after the name): set_config, pg_advisory_lock variants, and
# pg_sleep variants. Over-rejection is intentional for the escape hatch.
_SQL_FUNC_DENYLIST_RE = re.compile(r"\b(set_config|pg_advisory\w*|pg_sleep\w*)\s*\(", re.IGNORECASE)


# --- The one choke point -----------------------------------------------------


async def envelope_for(
    catalog: Catalog,
    unitid: int,
    meta: FieldMeta,
    value: Any,
    cycle_year: int | None,
) -> CitationEnvelope:
    """Normalize + date + cite one value. EVERY tool envelope is built here."""
    decode_map = await catalog.decode_map_for(meta)
    normalized = normalize(meta, value, decode_map)
    vintage, caveat = vintage_for(
        meta.source,
        cycle_year,
        scorecard_filename=catalog.scorecard_filename,
        field_key=meta.key,
    )
    if normalized.extra_caveat:
        caveat = f"{caveat} {normalized.extra_caveat}" if caveat else normalized.extra_caveat
    return CitationEnvelope(
        field=meta.key,
        label=meta.label,
        display=normalized.display,
        raw=normalized.raw,
        available=normalized.available,
        unit=normalized.unit,
        citation=Citation(
            source=meta.source,
            tier="official",  # ipeds/scorecard/cds are all official sources
            vintage=vintage,
            caveat=caveat,
            raw_table=meta.raw_table,
        ),
    )


# --- resolve_school -----------------------------------------------------------


def _school_basics(row: asyncpg.Record) -> SchoolBasics:
    return SchoolBasics(**{name: row[name] for name in SchoolBasics.model_fields})


async def _coverage_tier(catalog: Catalog, unitid: int) -> tuple[CoverageTier, str]:
    row = (await fetch(catalog.pool, _TIER_SQL, unitid))[0]
    tier = compute_tier(row["cds_count"], row["has_pdf"])
    return tier, tier_explanation(tier)


def _expand_abbreviation(query: str) -> str:
    abbreviations: dict[str, str] = load_yaml_asset("abbreviations")
    lowered = {key.lower(): value for key, value in abbreviations.items()}
    return lowered.get(query.lower(), query)


def _campus_rank(name: str) -> int:
    """Main-campus-first heuristic (§11): no suffix, or an explicit main campus."""
    return 0 if "-" not in name or name.lower().endswith("main campus") else 1


async def _match(catalog: Catalog, row: asyncpg.Record) -> ResolveMatch:
    tier, explanation = await _coverage_tier(catalog, row["unitid"])
    return ResolveMatch(
        school=_school_basics(row), coverage_tier=tier, tier_explanation=explanation
    )


async def resolve_school(catalog: Catalog, query: str) -> ResolveResult:
    """Name/unitid/abbreviation → one school (+ tier), candidates, or not_found."""
    query = query.strip()
    if not query:
        return ResolveNotFound(message=_NOT_FOUND_MESSAGE)
    try:
        unitid = int(query)
    except ValueError:
        unitid = None
    if unitid is not None:
        rows = await fetch(catalog.pool, _SCHOOL_SQL, unitid)
        if not rows:
            return ResolveNotFound(message=_NOT_FOUND_MESSAGE)
        return await _match(catalog, rows[0])
    expanded = _expand_abbreviation(query)
    fuzzy_path = False
    rows = await fetch(catalog.pool, _SEARCH_SQL, expanded)
    if not rows:
        rows = await fetch(catalog.pool, _FUZZY_SEARCH_SQL, expanded)
        if not rows:
            return ResolveNotFound(message=_NOT_FOUND_MESSAGE)
        if rows[0]["score"] >= _FUZZY_EXACT_SCORE:
            return await _match(catalog, rows[0])
        # Sub-exact fuzzy hits are never auto-matched — even a single row could
        # be the wrong school; the agent must confirm with the student.
        fuzzy_path = True
    if len(rows) == 1 and not fuzzy_path:
        return await _match(catalog, rows[0])
    ordered = sorted(rows, key=lambda row: (_campus_rank(row["name"]), row["name"]))
    return ResolveCandidates(
        candidates=[_school_basics(row) for row in ordered], hint=_CANDIDATES_HINT
    )


# --- get_values ---------------------------------------------------------------


async def get_values(
    catalog: Catalog, unitid: int, field_keys: list[str]
) -> list[CitationEnvelope | FieldKeyError]:
    """Specific fields, normalized + cited (§14.1). Unknown keys → error entries."""
    known = [key for key in field_keys if key in catalog.fields_by_key]
    rows = await fetch(catalog.pool, _VALUES_SQL, unitid, known) if known else []
    by_key = {row["field_key"]: row for row in rows}
    results: list[CitationEnvelope | FieldKeyError] = []
    for key in field_keys:
        meta = catalog.fields_by_key.get(key)
        if meta is None:
            results.append(FieldKeyError(field=key, error="unknown field key"))
            continue
        row = by_key.get(key)  # missing row → available=False envelope, never invented
        value = row["value"] if row else None
        cycle_year = row["cycle_year"] if row else None
        results.append(await envelope_for(catalog, unitid, meta, value, cycle_year))
    return results


# --- get_dossier ----------------------------------------------------------------


def _shortlist_sections(section_ids: list[str] | None) -> list[dict[str, Any]]:
    sections: list[dict[str, Any]] = load_yaml_asset("dossier_shortlist")["sections"]
    if section_ids is None:
        return sections
    wanted = {section_id.strip().upper() for section_id in section_ids}
    picked = [section for section in sections if section["id"] in wanted]
    if not picked:
        raise ServiceError(f"no such dossier sections: {sorted(wanted)} (valid: A–F)")
    return picked


async def _pseudo_envelope(catalog: Catalog, school: SchoolBasics, key: str) -> CitationEnvelope:
    """schools.* shortlist entries come from the schools table itself (R12)."""
    meta = FieldMeta(
        key=key,
        label=_SCHOOLS_PSEUDO_LABELS[key],
        category="institution",
        data_type="text",
        source="ipeds",
        raw_table="raw.ipeds_hd2024",
    )
    value = getattr(school, key.removeprefix("schools."))
    if key == "schools.control" and value is not None:
        value = _CONTROL_DISPLAY.get(value, value)
    return await envelope_for(catalog, school.unitid, meta, value, catalog.ipeds_cycle_year)


def _apply_fallback(
    entry: dict[str, Any], env_by_key: dict[str, CitationEnvelope]
) -> CitationEnvelope | None:
    """COA sibling trap (§13.7): emit whichever of the pair is populated, prefer primary."""
    primary = env_by_key.get(entry["key"])
    if primary is None:
        return None
    fallback_key = entry.get("fallback")
    if primary.available or not fallback_key:
        return primary
    fallback = env_by_key.get(fallback_key)
    return fallback if fallback is not None and fallback.available else primary


async def _build_sections(
    catalog: Catalog, school: SchoolBasics, sections: list[dict[str, Any]]
) -> tuple[list[DossierSection], list[str]]:
    keys: list[str] = []
    for section in sections:
        for entry in section["fields"]:
            if not entry["key"].startswith("schools."):
                keys.append(entry["key"])
                if entry.get("fallback"):
                    keys.append(entry["fallback"])
    envelopes = await get_values(catalog, school.unitid, keys)
    env_by_key = {env.field: env for env in envelopes if isinstance(env, CitationEnvelope)}
    # A drifted shortlist key must never vanish silently — surface it as a warning.
    warnings = [
        f"shortlist key not in catalog: {env.field}"
        for env in envelopes
        if isinstance(env, FieldKeyError)
    ]
    built: list[DossierSection] = []
    for section in sections:
        values: list[CitationEnvelope] = []
        for entry in section["fields"]:
            if entry["key"] in _SCHOOLS_PSEUDO_LABELS:
                values.append(await _pseudo_envelope(catalog, school, entry["key"]))
            elif (envelope := _apply_fallback(entry, env_by_key)) is not None:
                values.append(envelope)
        built.append(DossierSection(id=section["id"], title=section["title"], values=values))
    return built, warnings


async def get_dossier(catalog: Catalog, unitid: int, sections: list[str] | None = None) -> Dossier:
    """The wedge: the curated shortlist + programs preview + diversity, all cited."""
    rows = await fetch(catalog.pool, _SCHOOL_SQL, unitid)
    if not rows:
        raise ServiceError(_NOT_FOUND_MESSAGE)
    school = _school_basics(rows[0])
    tier, explanation = await _coverage_tier(catalog, unitid)
    built, warnings = await _build_sections(catalog, school, _shortlist_sections(sections))
    programs = await get_programs(catalog, unitid)
    programs.sort(
        key=lambda row: row.completions if row.completions is not None else -1, reverse=True
    )
    return Dossier(
        school=school,
        tier=tier,
        tier_explanation=explanation,
        sections=built,
        programs_preview=programs[:_PROGRAMS_PREVIEW_TOP_N],
        diversity=await get_diversity(catalog, unitid),
        warnings=warnings,
    )


# --- compare_schools ------------------------------------------------------------


async def compare_schools(
    catalog: Catalog, unitids: list[int], field_keys: list[str]
) -> CompareResult:
    """N×M matrix of envelopes (§14.2); missing cell → available=False envelope."""
    if not unitids or len(unitids) > _COMPARE_MAX_SCHOOLS:
        raise ServiceError(f"compare 1–{_COMPARE_MAX_SCHOOLS} schools, got {len(unitids)}")
    if not field_keys or len(field_keys) > _COMPARE_MAX_FIELDS:
        raise ServiceError(f"compare 1–{_COMPARE_MAX_FIELDS} fields, got {len(field_keys)}")
    school_rows = await fetch(
        catalog.pool,
        f"{_SCHOOL_SELECT} WHERE unitid = ANY($1::int[])",
        unitids,
    )
    basics = {row["unitid"]: _school_basics(row) for row in school_rows}
    missing = [unitid for unitid in unitids if unitid not in basics]
    if missing:
        raise ServiceError(f"unitid(s) not in our database: {missing}")
    errors = [
        FieldKeyError(field=key, error="unknown field key")
        for key in field_keys
        if key not in catalog.fields_by_key
    ]
    known = [key for key in field_keys if key in catalog.fields_by_key]
    value_rows = await fetch(catalog.pool, _COMPARE_SQL, unitids, known) if known else []
    cells = {(row["unitid"], row["field_key"]): row for row in value_rows}
    rows_out: list[CompareRow] = []
    for key in known:
        meta = catalog.fields_by_key[key]
        row_cells = []
        for unitid in unitids:
            cell = cells.get((unitid, key))
            value = cell["value"] if cell else None
            cycle_year = cell["cycle_year"] if cell else None
            row_cells.append(await envelope_for(catalog, unitid, meta, value, cycle_year))
        rows_out.append(CompareRow(field=key, label=meta.label, cells=row_cells))
    return CompareResult(
        schools=[basics[unitid] for unitid in unitids], rows=rows_out, errors=errors
    )


# --- national_benchmark ---------------------------------------------------------


async def national_benchmark(catalog: Catalog, field_key: str) -> BenchmarkResult:
    """National distribution for one field (§14.4), display-normalized."""
    meta = catalog.fields_by_key.get(field_key)
    if meta is None:
        raise ServiceError(f"unknown field key: {field_key!r}")
    if meta.data_type not in ("int", "number", "percent", "currency"):
        raise ServiceError(f"field {field_key!r} is {meta.data_type}, not numeric")
    # Scope to the field's own source so a future cross-source key can't pollute it.
    row = (await fetch(catalog.pool, _BENCHMARK_SQL, field_key, meta.source))[0]
    if not row["n"]:
        raise ServiceError(f"no values stored for {field_key!r}")
    vintage, caveat = vintage_for(
        meta.source, None, scorecard_filename=catalog.scorecard_filename, field_key=meta.key
    )

    def stat(value: Any) -> BenchmarkStat:
        return BenchmarkStat(raw=float(value), display=normalize(meta, float(value)).display)

    return BenchmarkResult(
        field=field_key,
        label=meta.label,
        n=row["n"],
        median=stat(row["median"]),
        mean=stat(row["mean"]),
        p25=stat(row["p25"]),
        p75=stat(row["p75"]),
        citation=Citation(
            source=meta.source,
            tier="official",
            vintage=vintage,
            caveat=f"National distribution across {row['n']} institutions in our database."
            + (f" {caveat}" if caveat else ""),
            raw_table="field_values",
        ),
    )


# --- get_programs ----------------------------------------------------------------


def _fos_number(text: str | None) -> float | None:
    """Scorecard FoS cells are text; suppressed (PS/NA/blank) stays null (§8)."""
    if text is None:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _fos_count(text: str | None) -> int | None:
    number = _fos_number(text)
    return int(number) if number is not None else None


async def get_programs(
    catalog: Catalog,
    unitid: int,
    cip_prefix: str | None = None,
    credlev: int = _BACHELORS_CREDLEV,
) -> list[ProgramRow]:
    """Earnings/debt by major from raw.scorecard_fos (§8); suppressed cells stay null."""
    if credlev not in CREDLEV_DECODE:
        raise ServiceError(
            f"unknown credlev {credlev!r}; valid values: "
            + ", ".join(f"{code} ({label})" for code, label in sorted(CREDLEV_DECODE.items()))
        )
    vintage, _ = vintage_for("scorecard", None, scorecard_filename=catalog.scorecard_filename)
    citation = Citation(
        source="scorecard",
        tier="official",
        vintage=vintage,
        caveat="Earnings/debt by major lag the entry cohort by years.",
        raw_table="raw.scorecard_fos",
    )
    rows = await fetch(catalog.pool, _PROGRAMS_SQL, unitid, str(credlev))
    programs = [
        ProgramRow(
            cipcode=row["CIPCODE"],
            cipdesc=row["CIPDESC"],
            credlev=credlev,
            creddesc=row["CREDDESC"] or CREDLEV_DECODE.get(credlev),
            completions=_fos_count(row["IPEDSCOUNT2"]),
            debt_median=_fos_number(row["DEBT_ALL_STGP_ANY_MDN"]),
            debt_monthly_payment=_fos_number(row["DEBT_ALL_STGP_ANY_MDN10YRPAY"]),
            earnings_1yr=_fos_number(row["EARN_MDN_1YR"]),
            earnings_4yr=_fos_number(row["EARN_MDN_4YR"]),
            earnings_5yr=_fos_number(row["EARN_MDN_5YR"]),
            citation=citation,
        )
        for row in rows
        if cip_prefix is None or row["CIPCODE"].startswith(cip_prefix)
    ]
    return programs


# --- get_diversity ----------------------------------------------------------------


def _enrollment_count(text: str | None) -> int | None:
    """IPEDS EF cells are text; negative sentinels → null (§8)."""
    if text is None:
        return None
    try:
        count = int(float(text))
    except ValueError:
        return None
    return None if count < 0 else count


async def get_diversity(catalog: Catalog, unitid: int) -> DiversityBreakdown | None:
    """Undergrad race/sex breakdown (raw.ipeds_ef2024a, EFALEVEL='2'); None if unreported."""
    rows = await fetch(catalog.pool, _DIVERSITY_SQL, unitid)
    if not rows:
        return None
    row = rows[0]
    vintage, _ = vintage_for("ipeds", catalog.ipeds_cycle_year)
    return DiversityBreakdown(
        unitid=unitid,
        total=_enrollment_count(row["EFTOTLT"]),
        men=_enrollment_count(row["EFTOTLM"]),
        women=_enrollment_count(row["EFTOTLW"]),
        by_race=[
            RaceGroup(
                race_label=label,
                total=_enrollment_count(row[f"{stem}T"]),
                men=_enrollment_count(row[f"{stem}M"]),
                women=_enrollment_count(row[f"{stem}W"]),
            )
            for stem, label in _RACE_GROUPS
        ],
        citation=Citation(
            source="ipeds", tier="official", vintage=vintage, raw_table="raw.ipeds_ef2024a"
        ),
    )


# --- query_database (Layer 3) -------------------------------------------------------


def _guard_sql(sql: str) -> str:
    """Reject anything that isn't a single read-only SELECT/WITH statement.

    Defense-in-depth on top of the RO role (which already blocks writes). Note:
    semicolons (and write keywords) inside string literals are over-rejected by
    design — the escape hatch prefers over-rejection.
    """
    stripped = sql.strip()
    if stripped.endswith(";"):
        stripped = stripped[:-1].rstrip()
    if ";" in stripped:
        raise ServiceError("rejected: multiple SQL statements are not allowed")
    if not _SQL_FIRST_KEYWORD_RE.match(stripped):
        raise ServiceError("rejected: read-only — the statement must start with SELECT or WITH")
    write_keyword = _SQL_WRITE_KEYWORD_RE.search(stripped)
    if write_keyword:
        raise ServiceError(
            f"rejected: read-only — write keyword {write_keyword.group(1).upper()!r} "
            "is not allowed anywhere in the statement (including CTEs)"
        )
    func_denied = _SQL_FUNC_DENYLIST_RE.search(stripped)
    if func_denied:
        raise ServiceError(
            f"rejected: function call {func_denied.group(1).lower()!r} is not permitted "
            "in the escape hatch (set_config, pg_advisory_lock variants, pg_sleep variants)"
        )
    return stripped


def _decode_hints_for(catalog: Catalog, columns: list[str]) -> dict[str, str]:
    """DS-03: honesty reminders for value-bearing columns the raw rows bypass.

    Pure (no pool, no I/O): resolves each column name against the catalog's
    field index and flags percent / coded-int / raw-``value`` columns so the
    model is reminded to decode/scale before quoting (R1/R2/R4). Unresolvable
    columns get no hint — no false reassurance.
    """
    hints: dict[str, str] = {}
    for col in columns:
        meta = catalog.fields_by_key.get(col)
        if meta is not None and meta.data_type == "percent":
            hints[col] = "0–1 fraction — multiply by 100 before quoting (R2)."
        elif meta is not None and meta.data_type == "int":
            hints[col] = (
                "may be a coded enum — decode via counselle.decode_ipeds before quoting (R1)."
            )
        elif col == "value":
            hints[col] = (
                "raw field_values payload — percents are 0–1 fractions, coded ints "
                "need decoding, '-2'/range tokens are sentinels (R1/R2/R4)."
            )
    return hints


async def query_database(
    catalog: Catalog, sql: str, params: list[Any] | None = None
) -> QueryResult:
    """Guarded read-only SQL escape hatch (Layer 3). Raw rows bypass normalization:
    the reading rules still apply; prefer counselle.decode_ipeds / counselle.value_vintage;
    percent values are 0–1 fractions."""
    params = params or []
    inner = _guard_sql(sql)
    row_cap = get_settings().db_row_cap
    # The wrapper is a fixed template; ``inner`` is the _guard_sql-validated query
    # and the row cap binds as the final $N parameter. Safe by construction.
    wrapped = f"SELECT * FROM ({inner}) q LIMIT ${len(params) + 1}"  # nosec B608
    try:
        rows = await fetch(catalog.pool, wrapped, *params, row_cap + 1)
    except asyncpg.PostgresError as exc:
        # Deliberately echo the Postgres error message: the LLM tool loop needs it
        # to self-correct its SQL, and it contains no credentials.
        raise ServiceError(f"query failed: {exc}") from exc
    truncated = len(rows) > row_cap
    rows = rows[:row_cap]
    columns = list(rows[0].keys()) if rows else []
    return QueryResult(
        columns=columns,
        rows=[list(row) for row in rows],
        row_count=len(rows),
        truncated=truncated,
        decode_hints=_decode_hints_for(catalog, columns),
    )


# --- get_data_calendar ----------------------------------------------------------------


async def get_data_calendar(catalog: Catalog) -> list[CalendarEntry]:
    """Per-source vintage + cutoff (ARCHITECTURE §8) — the server's 11th tool."""
    return await catalog.data_calendar()
