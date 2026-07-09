"""The ``search_fields`` discovery tool — vector + always-on keyword fallback (ADR 0008).

The vector path searches ``counselle.field_index`` by cosine distance; the
keyword path (key/label ILIKE, ranked by pg_trgm similarity when available) is
ALWAYS attempted and unioned in, so a field missing from the index — new, or
the index is stale/empty/broken — is never invisible. When pg_trgm is
unavailable (``Catalog.trgm_available`` is False), the keyword path degrades
to ILIKE-only matching ordered by label instead of raising (ADR 0007: the
fail-safe must stay a fail-safe even without the extension). A floor of
keyword slots survives the merge for the same reason: a full vector page must
not crowd out an exact keyword match.

Vector-path failures (Vertex down, embed error) degrade to keyword-only with a
warning — they never fail the tool.
"""

import asyncpg
import structlog
from pydantic import BaseModel

from adapters.embeddings import embed_texts
from config.settings import get_settings
from counselle_db.catalog import Catalog
from counselle_db.db import fetch, vector_literal
from domain.normalize import FieldMeta

logger = structlog.get_logger(__name__)

_MAX_LIMIT = 25
#: Keyword slots guaranteed to survive the merge (the never-invisible guarantee):
#: even when the vector page is full, the top keyword hits still make the cut.
_KEYWORD_FLOOR = 2
#: pg_trgm similarity threshold for fuzzy label matches (phase-3 Slice C spec).
_TRGM_THRESHOLD = 0.25

_META_COLUMNS = "key, label, category, data_type, source, raw_table, raw_column"

_INDEX_NONEMPTY_SQL = "SELECT 1 FROM counselle.field_index LIMIT 1"

#: DATABASE_GUIDE §5 fill-tier warnings, keyed by exact key prefix (checked in order).
_NET_PRICE_FILL_NOTE = (
    "27–53% fill — net price by income band covers only Title-IV grant recipients"
)
_PREFIX_FILL_NOTES: list[tuple[str, str]] = [
    ("aid.avg_net_price_", _NET_PRICE_FILL_NOTE),
]
_CDS_FILL_NOTE = "only 8 schools have CDS data — have an IPEDS/Scorecard fallback"
_IPEDS_SELECTIVITY_FILL_NOTE = "~62% fill; use Scorecard equivalent for breadth"


class FieldHit(BaseModel):
    """One discovered catalog field plus the how-to-read metadata the agent needs."""

    key: str
    label: str
    category: str | None = None
    data_type: str
    source: str
    #: True when the int value is a coded enum that MUST be decoded before display (R1).
    needs_decode: bool
    #: Fill-tier warning from DATABASE_GUIDE §5; None when coverage is unremarkable.
    fill_note: str | None = None
    #: Cosine similarity from the vector index; None when the hit came via keyword.
    similarity: float | None = None


def _filter_clauses(
    prefix: str, start: int, category: str | None, source: str | None
) -> tuple[str, list[str]]:
    """``AND category/source = $n`` clauses + their params, numbered from ``start``."""
    clauses: list[str] = []
    params: list[str] = []
    if category is not None:
        clauses.append(f"AND {prefix}category = ${start + len(params)}")
        params.append(category)
    if source is not None:
        clauses.append(f"AND {prefix}source = ${start + len(params)}")
        params.append(source)
    return " ".join(clauses), params


def _fill_note(key: str, source: str) -> str | None:
    """The DATABASE_GUIDE §5 fill-tier warning for this field, if it has one."""
    if source == "cds":
        return _CDS_FILL_NOTE
    if source == "ipeds" and key.startswith("admissions."):
        return _IPEDS_SELECTIVITY_FILL_NOTE
    for prefix, note in _PREFIX_FILL_NOTES:
        if key.startswith(prefix):
            return note
    return None


def _merge_hits(
    vector_rows: list[asyncpg.Record],
    keyword_rows: list[asyncpg.Record],
    limit: int,
) -> tuple[list[asyncpg.Record], list[asyncpg.Record]]:
    seen = {record["key"] for record in vector_rows}
    new_keyword = [record for record in keyword_rows if record["key"] not in seen]
    reserved = min(_KEYWORD_FLOOR, len(new_keyword))
    vector_take = vector_rows[: max(0, limit - reserved)]
    keyword_take = new_keyword[: limit - len(vector_take)]
    return vector_take, keyword_take


async def _hit_from_row(
    catalog: Catalog, row: asyncpg.Record, similarity: float | None
) -> FieldHit:
    """Build one FieldHit from a metadata row (needs_decode asks the catalog — R1)."""
    meta = FieldMeta(
        key=row["key"],
        label=row["label"],
        category=row["category"],
        data_type=row["data_type"],
        source=row["source"],
        raw_table=row["raw_table"],
        raw_column=row["raw_column"],
    )
    needs_decode = meta.data_type == "int" and (await catalog.decode_map_for(meta)) is not None
    return FieldHit(
        key=meta.key,
        label=meta.label,
        category=meta.category,
        data_type=meta.data_type,
        source=meta.source,
        needs_decode=needs_decode,
        fill_note=_fill_note(meta.key, meta.source),
        similarity=similarity,
    )


async def _vector_rows(
    pool: asyncpg.Pool, query: str, category: str | None, source: str | None, limit: int
) -> list[asyncpg.Record]:
    """Cosine-nearest catalog rows for the query; [] when the index is empty."""
    if not await fetch(pool, _INDEX_NONEMPTY_SQL):
        return []
    [vector] = await embed_texts([query])
    filters, filter_params = _filter_clauses("f.", 2, category, source)
    # _META_COLUMNS and the _filter_clauses fragments are fixed module constants /
    # a column allowlist, never user input; every value binds via $N. Safe by
    # construction.
    sql = f"""
        SELECT {", ".join("f." + col for col in _META_COLUMNS.split(", "))},
               1 - (fi.embedding <=> $1::vector) AS similarity
        FROM counselle.field_index fi
        JOIN fields f ON f.key = fi.field_key
        WHERE f.enabled {filters}
        ORDER BY fi.embedding <=> $1::vector
        LIMIT ${2 + len(filter_params)}
    """  # nosec B608
    return await fetch(pool, sql, vector_literal(vector), *filter_params, limit)


def _keyword_sql(filters: str, n_filter_params: int, *, trgm: bool) -> str:
    """The keyword-search SQL, with or without the pg_trgm similarity clause."""
    limit_param = f"${2 + n_filter_params}"
    # _TRGM_THRESHOLD and _META_COLUMNS are module constants, never user input;
    # every value binds via $N. Safe by construction.
    if trgm:
        return f"""
            SELECT {_META_COLUMNS}, similarity(label, $1) AS sim
            FROM fields
            WHERE enabled
              AND (key ILIKE '%' || $1 || '%'
                   OR label ILIKE '%' || $1 || '%'
                   OR similarity(label, $1) > {_TRGM_THRESHOLD})
              {filters}
            ORDER BY sim DESC NULLS LAST
            LIMIT {limit_param}
        """  # nosec B608
    return f"""
        SELECT {_META_COLUMNS}
        FROM fields
        WHERE enabled
          AND (key ILIKE '%' || $1 || '%'
               OR label ILIKE '%' || $1 || '%')
          {filters}
        ORDER BY label
        LIMIT {limit_param}
    """  # nosec B608


async def _keyword_rows(
    catalog: Catalog, query: str, category: str | None, source: str | None, limit: int
) -> list[asyncpg.Record]:
    """ILIKE + pg_trgm fallback rows, best label-similarity first.

    Degrades to ILIKE-only (ordered by label) when ``catalog.trgm_available``
    is False — this is the ADR 0007 fail-safe layer and must never itself
    depend on an optional extension (the production incident this guards
    against: pg_trgm not installed made the "always-on" fallback also throw).
    """
    filters, filter_params = _filter_clauses("", 2, category, source)
    if not catalog.trgm_available:
        sql = _keyword_sql(filters, len(filter_params), trgm=False)
        return await fetch(catalog.pool, sql, query, *filter_params, limit)
    sql = _keyword_sql(filters, len(filter_params), trgm=True)
    try:
        return await fetch(catalog.pool, sql, query, *filter_params, limit)
    except asyncpg.exceptions.UndefinedFunctionError:
        # pg_trgm was available at startup but is gone now (dropped mid-lifetime)
        # — rarer than the "never installed" case caught by the startup preflight,
        # so this is a warning, not the error-level startup log.
        logger.warning(
            "pg_trgm similarity() unavailable at query time — falling back to "
            "ILIKE-only keyword search; run `CREATE EXTENSION pg_trgm;` on the DB",
            exc_info=True,
        )
        plain_sql = _keyword_sql(filters, len(filter_params), trgm=False)
        return await fetch(catalog.pool, plain_sql, query, *filter_params, limit)


async def search_fields(
    catalog: Catalog,
    query: str,
    category: str | None = None,
    source: str | None = None,
    limit: int = 8,
    use_vector: bool | None = None,
) -> list[FieldHit]:
    """Semantic + keyword search over the fields catalog (ADR 0008).

    Vector hits come first (ascending cosine distance), then keyword hits not
    already present, capped at ``limit`` — with a small keyword floor so a field
    absent from the vector index is never invisible. ``use_vector`` overrides
    the Settings flag (tests); None defers to ``vector_search_enabled``.
    """
    limit = max(1, min(limit, _MAX_LIMIT))
    vector_enabled = use_vector if use_vector is not None else get_settings().vector_search_enabled
    vector_records: list[asyncpg.Record] = []
    if vector_enabled:
        try:
            vector_records = await _vector_rows(catalog.pool, query, category, source, limit)
        except Exception:
            logger.warning("search_fields vector path failed — serving keyword-only", exc_info=True)
    keyword_records = await _keyword_rows(catalog, query, category, source, limit)

    vector_take, keyword_take = _merge_hits(vector_records, keyword_records, limit)
    hits = [
        await _hit_from_row(catalog, record, similarity=record["similarity"])
        for record in vector_take
    ]
    hits += [
        await _hit_from_row(catalog, record, similarity=None)
        for record in keyword_take
    ]
    return hits
