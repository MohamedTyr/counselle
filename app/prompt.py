"""Strict prompt and ambient live-data rendering."""

from __future__ import annotations

from datetime import UTC

from app.asset_format import render_slots
from app.workspace import essay_markdown
from app.workspace.models import Essay
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
_ESSAY_PROMPT_SLOTS = ("temporal_context", "student_context", "essay_context")

#: Fills the ``essay_context`` slot when the turn's essay could not be loaded
#: (an unauthenticated harness run, or an essay deleted mid-session). The model
#: must never act as though it read an essay it was never given.
ESSAY_CONTEXT_UNAVAILABLE = (
    "## The essay you're working on\n\n"
    "This essay could not be loaded for this turn. Do not guess at its contents "
    "or write anything into it — tell the student the essay is unavailable."
)


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


def build_essay_system_prompt(
    temporal_context: str, student_context: str, essay_context: str
) -> str:
    """The essay-surface system prompt (Surface.ESSAY) — a workshop partner for
    the one essay in ``essay_context``, not the general counselor."""
    return render_slots(
        load_prompt("essay_partner"),
        _ESSAY_PROMPT_SLOTS,
        temporal_context=temporal_context,
        student_context=student_context,
        essay_context=essay_context,
    )


def render_essay_context(essay: Essay, *, selection: str | None, max_chars: int) -> str:
    """The essay the turn is about, rendered for the ``essay_context`` slot.

    Values interpolated here are never re-parsed as slots (``str.format_map``
    does not recurse), so essay prose containing braces is safe. An unusually
    long draft is truncated and *says so* — the model must know its view is
    partial and reach for ``read_essay`` rather than act on a silent excerpt.
    """
    markdown = essay_markdown.to_markdown(essay.content)
    truncated = len(markdown) > max_chars
    limit = f"{essay.word_limit} word limit" if essay.word_limit else "no word limit"
    truncation_note = (
        "\n\nThe text above is TRUNCATED. Call read_essay for the rest; never "
        "claim you have read the whole essay."
        if truncated
        else ""
    )
    selection_note = (
        f"The student currently has this text selected:\n\n> {selection}"
        if selection
        else "No text is currently selected."
    )
    return (
        "## The essay you're working on\n\n"
        f"- Title: {essay.title}\n"
        f"- Prompt: {essay.prompt or '(no prompt recorded)'}\n"
        f"- School: {essay.school_name or '(not linked to a school)'}\n"
        f"- Status: {essay.status} · {essay.word_count} words · {limit}\n"
        f"- Essay id (pass as essay_id): {essay.id}\n"
        f"- Version token (echo verbatim as expected_version): {essay.updated_at.isoformat()}\n\n"
        f"Current text:\n\n---\n{markdown[:max_chars]}\n---{truncation_note}\n\n{selection_note}"
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
        load_prompt("essay_partner"),
        _ESSAY_PROMPT_SLOTS,
        **dict.fromkeys(_ESSAY_PROMPT_SLOTS, "probe"),
    )
    render_slots(
        load_prompt("source_availability"),
        _SOURCE_AVAILABILITY_SLOTS,
        **dict.fromkeys(_SOURCE_AVAILABILITY_SLOTS, "probe"),
    )
