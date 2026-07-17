"""Strict prompt and ambient live-data rendering."""

from __future__ import annotations

from datetime import UTC

from app.asset_format import render_slots
from config.settings import load_prompt, load_yaml_asset
from counselle_db.catalog import CatalogSnapshot
from domain.specs import SourceConfig

_DATA_SLOTS = (
    "as_of",
    "n_schools",
    "snapshot_date",
    "manifest_version",
    "total_metrics",
    "covered",
    "fully",
    "partial",
    "stale",
    "by_year",
    "domain_menu",
)
_PROMPT_SLOTS = ("temporal_context", "student_context", "data_picture", "subreddit_menu")
_SOURCE_AVAILABILITY_SLOTS = ("web_status", "edu_status", "reddit_status")


def _subreddit_menu() -> str:
    return "\n".join(
        f"  r/{entry.get('sub', '')} — {entry.get('label', '')}"
        for entry in load_yaml_asset("subreddit_menu")
    )


def render_data_picture(snapshot: CatalogSnapshot) -> str:
    dates = (
        str(snapshot.profile_snapshot_min)
        if snapshot.profile_snapshot_min == snapshot.profile_snapshot_max
        else f"{snapshot.profile_snapshot_min}–{snapshot.profile_snapshot_max}"
    )
    aggregates = snapshot.coverage_aggregates
    years = aggregates["by_year"]
    by_year = (
        ", ".join(
            f"{year}-{str(year + 1)[-2:]} ({count:,})"
            for year, count in sorted(years.items(), reverse=True)
        )
        or "none"
    )
    domain_menu = ", ".join(
        f"{domain.id} ({snapshot.domain_counts[domain.id]:,})" for domain in snapshot.domains
    )
    return render_slots(
        load_prompt("data_picture"),
        _DATA_SLOTS,
        as_of=snapshot.refreshed_at.astimezone(UTC).isoformat(),
        n_schools=f"{len(snapshot.schools):,}",
        snapshot_date=dates,
        manifest_version=snapshot.current_version,
        total_metrics=f"{snapshot.total_metrics:,}",
        covered=f"{aggregates['covered']:,}",
        fully=f"{aggregates['fully']:,}",
        partial=f"{aggregates['partial']:,}",
        stale=f"{aggregates['stale']:,}",
        by_year=by_year,
        domain_menu=domain_menu,
    )


def build_system_prompt(temporal_context: str, student_context: str, data_picture: str) -> str:
    return render_slots(
        load_prompt("counselor"),
        _PROMPT_SLOTS,
        temporal_context=temporal_context,
        student_context=student_context,
        data_picture=data_picture,
        subreddit_menu=_subreddit_menu(),
    )


def render_source_availability(source_config: SourceConfig) -> str:
    """Render the per-turn external-tool mount contract from a versioned asset."""
    status = {True: "enabled and mounted", False: "disabled and not mounted"}
    return render_slots(
        load_prompt("source_availability"),
        _SOURCE_AVAILABILITY_SLOTS,
        web_status=status[source_config.web],
        edu_status=status[source_config.edu],
        reddit_status=status[source_config.reddit],
    )


def validate_prompt_assets() -> None:
    """Parse strict Phase 3 prompt assets during process startup."""
    render_slots(load_prompt("data_picture"), _DATA_SLOTS, **dict.fromkeys(_DATA_SLOTS, "probe"))
    render_slots(load_prompt("counselor"), _PROMPT_SLOTS, **dict.fromkeys(_PROMPT_SLOTS, "probe"))
    render_slots(
        load_prompt("source_availability"),
        _SOURCE_AVAILABILITY_SLOTS,
        **dict.fromkeys(_SOURCE_AVAILABILITY_SLOTS, "probe"),
    )
