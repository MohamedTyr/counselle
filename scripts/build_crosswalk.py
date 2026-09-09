#!/usr/bin/env python3
"""One-off CollegeData <-> IPEDS crosswalk builder (plan §2/§4.6).

Three sub-commands, run in order once:

    uv run python scripts/build_crosswalk.py fetch   # live: one request per slug
    uv run python scripts/build_crosswalk.py ladder   # offline: stages 1-6 + shortlist
    uv run python scripts/build_crosswalk.py merge    # offline: ladder + manual -> CSV

``fetch`` is the only sub-command that talks to collegedata.com, through
``adapters/collegedata/fetch.py``'s ``CollegeDataFetcher`` at its configured
1 req/s with the real self-identifying User-Agent (ADR 0038 R0) — it fetches
exactly one tab (``overview``, the index route) per slug, never the other
five, because the crosswalk only needs ``profile.{id, name, alternativeName,
address}`` (plan §4.6: "built from each school's own payload ... not from a
search list"). It is resumable: results append to a JSONL cache
(``artifacts/school-data-v3/crosswalk/profiles.jsonl``) and a slug already
present is skipped on the next run.

``ladder`` runs the six-stage matching ladder from plan §2's "Crosswalk
matching" row against ``cds_library.schools`` (read via
``COUNSELLE_DB_PIPELINE_DSN`` — ``cds_library_app`` holds ``SELECT`` on it)
using Postgres ``similarity()`` on ``COUNSELLE_DB_APP_DSN`` (the ``counselle``
schema owns ``pg_trgm`` via migration 0009 — no Python reimplementation of
``similarity()``, matching ``app/workspace/service_tasks.py``'s precedent).
Auto-matched rows go straight into the working CSV; everything stages 1-6
leave unresolved is written as a 3-candidate shortlist for manual
adjudication (``artifacts/school-data-v3/crosswalk/shortlist.md``).

``merge`` combines the ladder's auto-matches with the hand-authored
adjudication decisions in ``ADJUDICATED`` below (~320 rows, each reviewed
against its shortlist — plan §2: "no LLM anywhere in ingestion", the
adjudication is a build-time human decision recorded as data) into the
final, committed ``config/facts/collegedata_crosswalk.csv``.

Reuses ``counselle_db/catalog.py::normalize_school_name`` and its
abbreviations asset — no second name normalizer (plan §2/§4.6).
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import asyncpg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from adapters.collegedata.fetch import (  # noqa: E402
    NON_SCHOOL_SLUGS,
    CollegeDataFetcher,
    FetchConfig,
    build_client,
    match_college_search_url,
    parse_sitemap_locs,
)
from config.settings import get_settings  # noqa: E402
from counselle_db.catalog import normalize_school_name  # noqa: E402
from domain.facts.models import TAB_NAMES  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[1]
SITEMAP_DIR = REPO_ROOT / "artifacts/school-data-v3/captures/collegedata/sitemap"
CACHE_DIR = REPO_ROOT / "artifacts/school-data-v3/crosswalk"
PROFILES_JSONL = CACHE_DIR / "profiles.jsonl"
AUTO_MATCHES_JSON = CACHE_DIR / "auto_matches.json"
SHORTLIST_MD = CACHE_DIR / "shortlist.md"
UNMATCHED_JSON = CACHE_DIR / "unmatched_no_candidate.json"
OUTPUT_CSV = REPO_ROOT / "config/facts/collegedata_crosswalk.csv"

CSV_HEADER = ("slug", "unitid", "method", "matched_at", "note")
VALID_METHODS = {
    "exact",
    "exact_city",
    "trigram",
    "trigram_city",
    "token_city",
    "single_city",
    "manual",
    "unmatched",
}

_STOPWORDS = {
    "university",
    "college",
    "of",
    "the",
    "at",
    "and",
    "campus",
    "school",
    "institute",
}
# NOT a stopword: "state" is load-bearing in many pairs of genuinely
# different schools (Ohio State University vs Ohio University, Kent State
# University vs "Kent" anything else) — dropping it would make stage 5's
# token-containment check conflate them.


# ---------------------------------------------------------------------------
# Slug discovery (offline — reuses the committed sitemap capture at
# `artifacts/school-data-v3/captures/collegedata/sitemap`, no
# live fetch needed just to enumerate slugs; `fetch` still needs one live
# HTML request to resolve the current buildId).
# ---------------------------------------------------------------------------


def discover_slugs_offline() -> tuple[str, ...]:
    """Mirrors ``CollegeDataFetcher.discover_slugs`` but reads the sitemap
    bytes already captured live, instead of hitting the network."""
    slug_tabs: dict[str, set[str]] = {}
    slug_order: list[str] = []
    for name in ("a-sitemap.xml", "b-sitemap.xml"):
        body = (SITEMAP_DIR / name).read_bytes()
        for loc in parse_sitemap_locs(body):
            matched = match_college_search_url(loc)
            if matched is None:
                continue
            slug, tab = matched
            if slug not in slug_tabs:
                slug_tabs[slug] = set()
                slug_order.append(slug)
            slug_tabs[slug].add(tab)
    return tuple(
        slug
        for slug in slug_order
        if len(slug_tabs[slug]) == len(TAB_NAMES) and slug not in NON_SCHOOL_SLUGS
    )


# ---------------------------------------------------------------------------
# fetch — live, resumable
# ---------------------------------------------------------------------------


def _load_cached_slugs() -> set[str]:
    if not PROFILES_JSONL.exists():
        return set()
    done: set[str] = set()
    with PROFILES_JSONL.open() as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            done.add(json.loads(line)["slug"])
    return done


async def _fetch_all() -> None:
    settings = get_settings()
    slugs = discover_slugs_offline()
    print(f"discovered {len(slugs)} slugs from the committed sitemap capture")
    already = _load_cached_slugs()
    print(f"{len(already)} already cached, {len(slugs) - len(already)} remaining")
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    config = FetchConfig(
        rps=settings.facts_crawl_rps,
        request_timeout_s=settings.facts_crawl_request_timeout_s,
        user_agent=settings.facts_crawl_user_agent,
        max_build_rotations=settings.facts_crawl_max_build_rotations,
        max_response_bytes=settings.facts_crawl_max_response_bytes,
    )
    async with build_client(config) as client:
        fetcher = CollegeDataFetcher(config, client)
        first_pending = next((s for s in slugs if s not in already), None)
        if first_pending is None:
            print("nothing left to fetch")
            return
        await fetcher.resolve_build_id(first_pending)
        print(f"buildId={fetcher.build_id}")

        with PROFILES_JSONL.open("a") as out:
            for i, slug in enumerate(slugs, start=1):
                if slug in already:
                    continue
                try:
                    page = await fetcher.fetch_tab(slug, "overview")
                except Exception as exc:  # BuildIdRotationLimitExceeded / TooManyRateLimitBlocks
                    print(f"ABORTING at slug={slug!r} ({i}/{len(slugs)}): {exc}")
                    return
                record: dict[str, Any] = {"slug": slug, "status": page.page_status}
                if page.page_status == "ok" and page.profile is not None:
                    p = page.profile
                    address = p.get("address") or {}
                    record.update(
                        {
                            "collegedata_id": p.get("id"),
                            "name": p.get("name"),
                            "alternative_name": p.get("alternativeName"),
                            "city": address.get("city") if isinstance(address, dict) else None,
                            "state": address.get("state") if isinstance(address, dict) else None,
                            "zip": address.get("zipCode") if isinstance(address, dict) else None,
                        }
                    )
                out.write(json.dumps(record) + "\n")
                out.flush()
                if i % 50 == 0 or i == len(slugs):
                    print(f"  {i}/{len(slugs)} ({slug} -> {page.page_status})")
    print("fetch complete")


# ---------------------------------------------------------------------------
# ladder — offline, six stages
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CdRow:
    slug: str
    collegedata_id: int | None
    name: str
    alternative_name: str | None
    city: str | None
    state: str | None
    zip: str | None


@dataclass(frozen=True)
class IpedsRow:
    unitid: int
    name: str
    city: str | None
    state: str | None
    zip: str | None
    search_name: str
    aliases: tuple[str, ...]


def _load_cd_rows() -> list[CdRow]:
    rows: list[CdRow] = []
    with PROFILES_JSONL.open() as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            if rec.get("status") != "ok" or not rec.get("name"):
                continue
            rows.append(
                CdRow(
                    slug=rec["slug"],
                    collegedata_id=rec.get("collegedata_id"),
                    name=rec["name"],
                    alternative_name=rec.get("alternative_name"),
                    city=rec.get("city"),
                    state=rec.get("state"),
                    zip=rec.get("zip"),
                )
            )
    return rows


async def _load_ipeds_rows() -> list[IpedsRow]:
    settings = get_settings()
    conn = await asyncpg.connect(settings.db_pipeline_dsn)
    try:
        records = await conn.fetch(
            "SELECT id, name, city, state, postal_code, search_name, aliases "
            "FROM cds_library.schools"
        )
    finally:
        await conn.close()
    rows = []
    for r in records:
        zip5 = (r["postal_code"] or "")[:5] or None
        rows.append(
            IpedsRow(
                unitid=r["id"],
                name=r["name"],
                city=r["city"],
                state=r["state"],
                zip=zip5,
                search_name=r["search_name"],
                aliases=tuple(r["aliases"] or ()),
            )
        )
    return rows


def _tokens(name: str) -> set[str]:
    norm = normalize_school_name(name)
    return {t for t in norm.split() if t not in _STOPWORDS}


@dataclass
class LadderResult:
    auto: dict[str, tuple[int, str, str]]  # slug -> (unitid, method, note)
    shortlist: dict[str, list[tuple[int, str, float]]]  # slug -> [(unitid, name, score)]
    no_candidate: list[str]


async def _run_ladder() -> LadderResult:
    cd_rows = _load_cd_rows()
    ipeds_rows = await _load_ipeds_rows()
    print(f"{len(cd_rows)} CollegeData rows with a fetched profile")
    print(f"{len(ipeds_rows)} IPEDS candidate schools")

    # Indexed by normalized main name AND by each normalized alias (plan
    # §4.6: "alternativeName ('UG') feeds aliases matching") — so a
    # CollegeData row's `name` OR `alternative_name` can hit either an
    # IPEDS school's own name or one of its `aliases`.
    by_norm_name_state: dict[tuple[str, str], list[IpedsRow]] = defaultdict(list)
    for candidate in ipeds_rows:
        if not candidate.state:
            continue
        for name in (candidate.name, *candidate.aliases):
            norm = normalize_school_name(name)
            if norm and candidate not in by_norm_name_state[(norm, candidate.state)]:
                by_norm_name_state[(norm, candidate.state)].append(candidate)

    settings = get_settings()
    app_conn = await asyncpg.connect(settings.db_app_dsn)
    # `norm_name` is precomputed with the same `normalize_school_name` used
    # on the CollegeData side, so `similarity()` always compares two
    # normalized strings, never a normalized query against a raw IPEDS name
    # (plan §2: "no second name normalizer" — this reuses it, it does not
    # reimplement it).
    await app_conn.execute(
        "CREATE TEMP TABLE crosswalk_candidates (unitid int, name text, "
        "norm_name text, state text, city text, zip text)"
    )
    await app_conn.executemany(
        "INSERT INTO crosswalk_candidates VALUES ($1,$2,$3,$4,$5,$6)",
        [
            (r.unitid, r.name, normalize_school_name(r.name), r.state, r.city, r.zip)
            for r in ipeds_rows
        ],
    )

    auto: dict[str, tuple[int, str, str]] = {}
    remaining: list[CdRow] = []

    for row in cd_rows:
        # Stage 1: exact normalized name (or alternativeName) + state.
        if row.state:
            names = (row.name, row.alternative_name) if row.alternative_name else (row.name,)
            matched_candidates: list[IpedsRow] = []
            for name in names:
                norm = normalize_school_name(name)
                for candidate in by_norm_name_state.get((norm, row.state), []):
                    if candidate not in matched_candidates:
                        matched_candidates.append(candidate)
            if len(matched_candidates) == 1:
                auto[row.slug] = (matched_candidates[0].unitid, "exact", "")
                continue
        remaining.append(row)

    stage2_left: list[CdRow] = []
    for row in remaining:
        if row.slug in auto:
            continue
        norm = normalize_school_name(row.name)
        if row.state:
            candidates = by_norm_name_state.get((norm, row.state), [])
            if len(candidates) > 1 and row.city:
                city_matches = [c for c in candidates if c.city == row.city]
                if len(city_matches) == 1:
                    auto[row.slug] = (city_matches[0].unitid, "exact_city", "")
                    continue
        stage2_left.append(row)

    # Stages 3-6 use one `similarity()` query per row on the counselle app
    # DSN's `crosswalk_candidates` temp table (both sides normalized) —
    # never a Python reimplementation of `similarity()`.
    _SIM_BY_STATE_SQL = (
        "SELECT unitid, similarity($1, norm_name) AS sim FROM crosswalk_candidates "
        "WHERE state = $2 AND similarity($1, norm_name) >= $3 ORDER BY sim DESC"
    )
    _SIM_BY_CITY_ZIP_SQL = (
        "SELECT unitid, similarity($1, norm_name) AS sim FROM crosswalk_candidates "
        "WHERE (city = $2 OR zip = $3) AND similarity($1, norm_name) >= $4 ORDER BY sim DESC"
    )

    stage3_left: list[CdRow] = []
    for row in stage2_left:
        norm = normalize_school_name(row.name)
        if not row.state:
            stage3_left.append(row)
            continue
        scored = await app_conn.fetch(_SIM_BY_STATE_SQL, norm, row.state, 0.9)
        if len(scored) == 1 or (
            len(scored) >= 2 and scored[0]["sim"] - scored[1]["sim"] >= 0.02
        ):
            auto[row.slug] = (scored[0]["unitid"], "trigram", "")
            continue
        stage3_left.append(row)

    stage4_left: list[CdRow] = []
    for row in stage3_left:
        norm = normalize_school_name(row.name)
        scored = await app_conn.fetch(_SIM_BY_CITY_ZIP_SQL, norm, row.city, row.zip, 0.6)
        if len(scored) == 1:
            auto[row.slug] = (scored[0]["unitid"], "trigram_city", "")
            continue
        stage4_left.append(row)

    stage5_left: list[CdRow] = []
    for row in stage4_left:
        toks = _tokens(row.name)
        pool = [
            r
            for r in ipeds_rows
            if (row.city and r.city == row.city) or (row.zip and r.zip == row.zip)
        ]
        contained = [r for r in pool if toks and toks <= _tokens(r.name)]
        contained_rev = [r for r in pool if toks and _tokens(r.name) <= toks]
        combined = list({r.unitid: r for r in contained + contained_rev}.values())
        if len(combined) == 1:
            auto[row.slug] = (combined[0].unitid, "token_city", "")
            continue
        stage5_left.append(row)

    stage6_left: list[CdRow] = []
    for row in stage5_left:
        # Stage 6 is structurally different from 3-5: it fires when the
        # city/zip pool itself has exactly one IPEDS candidate (no
        # ambiguity to resolve), so the confidence bar drops to 0.45.
        pool = [
            r
            for r in ipeds_rows
            if (row.city and r.city == row.city) or (row.zip and r.zip == row.zip)
        ]
        if len(pool) == 1:
            norm = normalize_school_name(row.name)
            sim = await app_conn.fetchval(
                "SELECT similarity($1, $2)", norm, normalize_school_name(pool[0].name)
            )
            if sim is not None and sim >= 0.45:
                auto[row.slug] = (pool[0].unitid, "single_city", "")
                continue
        stage6_left.append(row)

    # Build a 3-candidate shortlist for everything stages 1-6 could not
    # resolve — still Postgres `similarity()`, never a Python
    # reimplementation, statewide when a state is known else nationwide.
    _SHORTLIST_SQL_STATE = (
        "SELECT unitid, name, similarity($1, norm_name) AS sim FROM crosswalk_candidates "
        "WHERE state = $2 ORDER BY sim DESC LIMIT 3"
    )
    _SHORTLIST_SQL_ALL = (
        "SELECT unitid, name, similarity($1, norm_name) AS sim FROM crosswalk_candidates "
        "ORDER BY sim DESC LIMIT 3"
    )
    shortlist: dict[str, list[tuple[int, str, float]]] = {}
    no_candidate: list[str] = []
    for row in stage6_left:
        norm = normalize_school_name(row.name)
        if row.state:
            top3 = await app_conn.fetch(_SHORTLIST_SQL_STATE, norm, row.state)
        else:
            top3 = await app_conn.fetch(_SHORTLIST_SQL_ALL, norm)
        if top3 and top3[0]["sim"] >= 0.15:
            shortlist[row.slug] = [(r["unitid"], r["name"], r["sim"]) for r in top3]
        else:
            no_candidate.append(row.slug)

    await app_conn.close()

    return LadderResult(auto=auto, shortlist=shortlist, no_candidate=no_candidate)


def _cd_row_by_slug(cd_rows: list[CdRow]) -> dict[str, CdRow]:
    return {r.slug: r for r in cd_rows}


async def _ladder_command() -> None:
    result = await _run_ladder()
    cd_rows = _load_cd_rows()
    by_slug = _cd_row_by_slug(cd_rows)

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    auto_entries = {
        slug: {"unitid": u, "method": m, "note": n} for slug, (u, m, n) in result.auto.items()
    }
    AUTO_MATCHES_JSON.write_text(json.dumps(auto_entries, indent=2))
    UNMATCHED_JSON.write_text(json.dumps(result.no_candidate, indent=2))

    lines = ["# Crosswalk adjudication shortlist\n"]
    for slug, candidates in sorted(result.shortlist.items()):
        row = by_slug[slug]
        lines.append(
            f"\n## {slug}  ({row.name!r}, {row.city}, {row.state} {row.zip or ''})"
        )
        for unitid, name, sim in candidates:
            lines.append(f"- {unitid}  {name!r}  sim={sim:.2f}")
    SHORTLIST_MD.write_text("\n".join(lines))

    total = len(cd_rows)
    n_auto = len(result.auto)
    n_shortlist = len(result.shortlist)
    n_no_candidate = len(result.no_candidate)
    print(f"total profiles: {total}")
    print(f"auto-matched: {n_auto} ({n_auto / total:.1%})")
    print(f"needs adjudication (has candidates): {n_shortlist}")
    print(f"needs adjudication (no plausible candidate): {n_no_candidate}")
    print(f"wrote {AUTO_MATCHES_JSON}, {SHORTLIST_MD}, {UNMATCHED_JSON}")


# ---------------------------------------------------------------------------
# merge — offline: auto-matches + ADJUDICATED (hand-authored below) -> CSV
# ---------------------------------------------------------------------------

# Hand-authored adjudication decisions (plan §2/§4.6: build-time human
# review, no LLM in ingestion, D7). Each entry: slug -> (unitid|None, note).
# unitid=None means "no Title-IV IPEDS row / deliberately left unmatched" —
# never a guess to inflate coverage. Filled in by build_crosswalk's author
# after reviewing artifacts/school-data-v3/crosswalk/shortlist.md.
from scripts.crosswalk_adjudication import ADJUDICATED  # noqa: E402

_METHOD_RANK = {
    "exact": 0,
    "exact_city": 1,
    "trigram": 2,
    "trigram_city": 3,
    "token_city": 4,
    "single_city": 5,
    "manual": 6,
}


def _dedupe_unitid_collisions(
    rows: list[tuple[str, str, str, str, str]],
) -> list[tuple[str, str, str, str, str]]:
    """`collegedata_schools_live_school_idx` (`UNIQUE (school_id) WHERE
    retired_at IS NULL`) forbids two live rows claiming the same unitid —
    the plan's multi-campus case (plan §4.6: "the adjudicator picks the
    main campus, the rest get retired_at + a note"). This CSV has no
    `retired_at` column, so the equivalent here is: keep exactly one row
    per unitid (best method rank, then shortest/lowest slug as a
    deterministic tie-break) and demote every other claimant to
    `unmatched` with a note naming the slug that kept it — never silently
    dropped, never two live rows for one school.
    """
    by_unitid: dict[str, list[tuple[str, str, str, str, str]]] = defaultdict(list)
    for row in rows:
        if row[1]:
            by_unitid[row[1]].append(row)

    demote: dict[str, tuple[str, str, str, str, str]] = {}
    kept_slug_by_unitid: dict[str, str] = {}
    for unitid, claimants in by_unitid.items():
        if len(claimants) == 1:
            continue
        ranked = sorted(claimants, key=lambda r: (_METHOD_RANK.get(r[2], 99), len(r[0]), r[0]))
        winner = ranked[0]
        kept_slug_by_unitid[unitid] = winner[0]
        for loser in ranked[1:]:
            demote[loser[0]] = loser

    if not demote:
        return rows

    result = []
    for row in rows:
        slug = row[0]
        if slug in demote:
            winner_slug = kept_slug_by_unitid[row[1]]
            note = f"multi-campus collision on unitid {row[1]}; kept slug={winner_slug!r}"
            result.append((slug, "", "unmatched", row[3], note))
        else:
            result.append(row)
    return result


def _merge_command() -> None:
    if not AUTO_MATCHES_JSON.exists():
        print("run `ladder` first", file=sys.stderr)
        sys.exit(1)
    auto = json.loads(AUTO_MATCHES_JSON.read_text())
    all_slugs = discover_slugs_offline()

    now = datetime.now(UTC).isoformat()
    rows: list[tuple[str, str, str, str, str]] = []
    seen: set[str] = set()

    for slug, entry in sorted(auto.items()):
        rows.append((slug, str(entry["unitid"]), entry["method"], now, entry["note"]))
        seen.add(slug)

    for slug, (unitid, note) in sorted(ADJUDICATED.items()):
        if slug in seen:
            raise ValueError(f"{slug} is both auto-matched and adjudicated")
        method = "manual" if unitid is not None else "unmatched"
        rows.append((slug, str(unitid) if unitid is not None else "", method, now, note))
        seen.add(slug)

    # Anything never fetched (http_error/not_found/parse_error, or a slug
    # dropped from the profile cache) is recorded unmatched with a note so
    # coverage accounting is honest about *why* — never silently absent.
    fetched_status: dict[str, str] = {}
    if PROFILES_JSONL.exists():
        with PROFILES_JSONL.open() as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                rec = json.loads(line)
                fetched_status[rec["slug"]] = rec["status"]

    for slug in all_slugs:
        if slug in seen:
            continue
        status = fetched_status.get(slug, "never_fetched")
        rows.append((slug, "", "unmatched", now, f"profile fetch status={status}"))
        seen.add(slug)

    rows = _dedupe_unitid_collisions(rows)

    bad_methods = {r[2] for r in rows} - VALID_METHODS
    if bad_methods:
        raise ValueError(f"methods outside the CHECK set: {bad_methods}")

    rows.sort(key=lambda r: r[0])
    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_CSV.open("w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(CSV_HEADER)
        writer.writerows(rows)

    matched = sum(1 for r in rows if r[1])
    print(f"wrote {OUTPUT_CSV}: {len(rows)} rows, {matched} with a unitid")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["fetch", "ladder", "merge"])
    args = parser.parse_args()
    if args.command == "fetch":
        asyncio.run(_fetch_all())
    elif args.command == "ladder":
        asyncio.run(_ladder_command())
    else:
        _merge_command()


if __name__ == "__main__":
    main()
