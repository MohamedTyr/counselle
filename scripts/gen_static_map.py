"""Generate ``config/assets/static_field_map.md`` (Phase 3 Slice A, ADR 0007).

Queries the live ``fields`` catalog for per-category counts, merges the
DATABASE_GUIDE §5 one-line descriptions and the dossier-shortlist notable keys,
and writes a compact Markdown tree — the always-in-context category map. The
long tail of the 1,093-field catalog stays behind ``search_fields``.

HARD BUDGET: the file must be ≤ 2,400 characters (~600 tokens); notable-key
lists are trimmed to fit and the script fails loudly if even that can't fit.
Run: uv run python scripts/gen_static_map.py — regenerate whenever the catalog
changes (the reconciler logs a reminder when it sees deltas).
"""

import asyncio
from pathlib import Path

from config.settings import load_yaml_asset
from counselle_db.db import create_pool, fetch

CHAR_BUDGET = 2_400
MAX_NOTABLE_KEYS = 6
OUT_PATH = Path(__file__).resolve().parent.parent / "config" / "assets" / "static_field_map.md"

#: One line per category, copied from the DATABASE_GUIDE §5 table ("What's in it").
CATEGORY_DESCRIPTIONS: dict[str, str] = {
    "admissions": (
        "Test ranges, admit/yield, requirements, CDS: C7 factor weights, test policy, "
        "GPA dist, HS rank, ED/EA dates, waitlist"
    ),
    "aid": (
        "Net price by income band, grants/loans, debt, repayment, CDS: % need met, CSS Profile flag"
    ),
    "outcomes": "Grad/completion/retention/default rates",
    "programs": "CIP degree-offered flags, degree counts",
    "cost": "Tuition/fees/room&board, net price",
    "institution": "Identity, Carnegie, HBCU/HSI, locale, URLs, endowment",
    "academics": (
        "Student-faculty ratio, expenditures, services, CDS: class-size dist, grad requirements"
    ),
    "enrollment": "Headcounts, FTE, FT/PT",
    "demographics": "Race/ethnicity, sex, age",
    "earnings": "Scorecard only. Post-entry/post-completion earnings (lagged)",
    "retention": "Retention & multi-year persistence",
    "student_life": "CDS only. On-campus living, Greek life, housing",
    "faculty": "CDS only. Class sizes, terminal-degree %, ratio",
    "transfer": "CDS only. Transfer admission detail",
    "students": "Scorecard family-income/first-gen/veteran",
    "completers": "IPEDS bachelor's completers by race/sex",
    "general": "CDS Section A (control, calendar, DEI URL)",
}

_COUNTS_SQL = "SELECT category, count(*) AS n FROM fields WHERE enabled GROUP BY category"
_KEY_CATEGORY_SQL = "SELECT key, category FROM fields WHERE enabled AND key = ANY($1::text[])"

_HEADER_TEMPLATE = (
    "# Field-category map ({total} fields, {categories} categories)\n\n"
    "Always-in-context map of the catalog: each category, its size, and a few "
    "notable keys (`category.name`, pasteable). Deliberately not exhaustive — "
    "use `search_fields` for the long tail.\n\n"
)


def _shortlist_keys() -> list[str]:
    """The dossier-shortlist field keys, in asset order, deduped."""
    asset = load_yaml_asset("dossier_shortlist")
    seen: dict[str, None] = {}
    for section in asset["sections"]:
        for field in section["fields"]:
            seen.setdefault(field["key"], None)
    return list(seen)


def _notable_by_category(keys: list[str], key_to_category: dict[str, str]) -> dict[str, list[str]]:
    """Group shortlist keys by their catalog category; sparse cds.* keys go last."""
    grouped: dict[str, list[str]] = {}
    for key in keys:
        category = key_to_category.get(key)
        if category is None:
            print(f"note: shortlist key not in fields catalog, skipped: {key}")
            continue
        grouped.setdefault(category, []).append(key)
    # Stable sort: well-filled IPEDS/Scorecard keys before sparse-today CDS keys.
    return {cat: sorted(ks, key=lambda k: k.startswith("cds.")) for cat, ks in grouped.items()}


def _render(counts: dict[str, int], notable: dict[str, list[str]], take: dict[str, int]) -> str:
    """Render the full map with ``take[category]`` notable keys per category."""
    total = sum(counts.values())
    lines = [_HEADER_TEMPLATE.format(total=total, categories=len(counts))]
    for category, count in sorted(counts.items(), key=lambda item: -item[1]):
        line = f"- **{category}** ({count} fields): {CATEGORY_DESCRIPTIONS[category]}."
        keys = notable.get(category, [])[: take.get(category, 0)]
        if keys:
            line += f" Notable: {', '.join(keys)}."
        lines.append(line + "\n")
    return "".join(lines)


def _render_within_budget(counts: dict[str, int], notable: dict[str, list[str]]) -> str:
    """Add notable keys round-robin (biggest category first) while the budget holds."""
    take = dict.fromkeys(notable, 0)
    content = _render(counts, notable, take)
    if len(content) > CHAR_BUDGET:
        raise SystemExit(
            f"static map exceeds the {CHAR_BUDGET}-char budget even with no notable keys "
            f"({len(content)} chars) — shorten the header or descriptions"
        )
    order = sorted(notable, key=lambda cat: -counts[cat])
    for _ in range(MAX_NOTABLE_KEYS):
        for category in order:
            if take[category] >= min(MAX_NOTABLE_KEYS, len(notable[category])):
                continue
            take[category] += 1
            candidate = _render(counts, notable, take)
            if len(candidate) > CHAR_BUDGET:
                take[category] -= 1  # over budget — this list is done growing
            else:
                content = candidate
    return content


async def _load_live(keys: list[str]) -> tuple[dict[str, int], dict[str, str]]:
    """Live per-category counts + key→category for the shortlist keys."""
    pool = await create_pool()
    try:
        count_rows = await fetch(pool, _COUNTS_SQL)
        key_rows = await fetch(pool, _KEY_CATEGORY_SQL, keys)
    finally:
        await pool.close()
    counts = {row["category"]: row["n"] for row in count_rows}
    return counts, {row["key"]: row["category"] for row in key_rows}


async def main() -> None:
    shortlist = _shortlist_keys()
    counts, key_to_category = await _load_live(shortlist)
    if set(counts) != set(CATEGORY_DESCRIPTIONS):
        raise SystemExit(
            "live categories diverge from CATEGORY_DESCRIPTIONS — update this script "
            f"(db-only: {sorted(set(counts) - set(CATEGORY_DESCRIPTIONS))}, "
            f"script-only: {sorted(set(CATEGORY_DESCRIPTIONS) - set(counts))})"
        )
    content = _render_within_budget(counts, _notable_by_category(shortlist, key_to_category))
    assert len(content) <= CHAR_BUDGET, f"budget breach: {len(content)} > {CHAR_BUDGET}"
    OUT_PATH.write_text(content, encoding="utf-8")
    print(f"wrote {OUT_PATH} ({len(content)} chars, budget {CHAR_BUDGET})")


if __name__ == "__main__":
    asyncio.run(main())
