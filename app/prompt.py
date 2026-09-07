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
    "facts_updated_range",
    "schools_with_facts",
    "fact_key_count",
    "section_menu",
    "stale_count",
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
    if snapshot.facts_updated_min is None or snapshot.facts_updated_max is None:
        facts_updated_range = "none yet"
    elif snapshot.facts_updated_min.date() == snapshot.facts_updated_max.date():
        facts_updated_range = str(snapshot.facts_updated_min.date())
    else:
        facts_updated_range = (
            f"{snapshot.facts_updated_min.date()}–{snapshot.facts_updated_max.date()}"
        )
    # fact_keys/sections are empty until Phase 3/Phase 2 fill them from the
    # facts store — render the honest "not yet collected" state rather than 0.
    not_yet_collected = "not yet collected"
    fact_key_count = f"{len(snapshot.fact_keys):,}" if snapshot.fact_keys else not_yet_collected
    section_menu = ", ".join(sorted(snapshot.sections)) if snapshot.sections else not_yet_collected
    return render_slots(
        load_prompt("data_picture"),
        _DATA_SLOTS,
        as_of=snapshot.refreshed_at.astimezone(UTC).isoformat(),
        n_schools=f"{len(snapshot.schools):,}",
        snapshot_date=dates,
        facts_updated_range=facts_updated_range,
        schools_with_facts=f"{snapshot.schools_with_facts:,}",
        fact_key_count=fact_key_count,
        section_menu=section_menu,
        stale_count=f"{snapshot.stale_facts_count:,}",
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
