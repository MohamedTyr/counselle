"""Counselor system-prompt builder (ARCHITECTURE §16, ADR 0018).

The prompt template lives in ``config/assets/prompts/counselor.md`` as a
``str.format``-friendly file with six named slots:

- ``{static_field_map}``      — the static category map (always-in-context)
- ``{dossier_shortlist_summary}`` — section titles + field counts from the YAML
- ``{subreddit_menu}``        — rendered as "r/<sub> — <label>" lines
- ``{temporal_context}``      — today's date + season + data calendar (per-request)
- ``{tier_note}``             — the three tier_explanation strings joined
- ``{school_count}``          — the live coverage count (CFG-01, DB-derived)

Literal braces in the markdown are escaped as ``{{``/``}}``.
"""

from __future__ import annotations

from config.settings import load_prompt, load_yaml_asset
from counselle_db.static_map import load_static_map
from domain.tiers import CoverageTier, tier_explanation


def _dossier_shortlist_summary() -> str:
    """Section titles + field counts from dossier_shortlist.yaml."""
    data = load_yaml_asset("dossier_shortlist")
    sections = data.get("sections", [])
    lines: list[str] = []
    for section in sections:
        sid = section.get("id", "?")
        title = section.get("title", "")
        fields = section.get("fields", [])
        note = section.get("note", "")
        note_str = f" ({note})" if note else ""
        lines.append(f"  Section {sid} — {title}: {len(fields)} fields{note_str}")
    return "\n".join(lines)


def _subreddit_menu() -> str:
    """Render subreddit menu as 'r/<sub> — <label>' lines."""
    entries = load_yaml_asset("subreddit_menu")
    lines: list[str] = []
    for entry in entries:
        sub = entry.get("sub", "")
        label = entry.get("label", "")
        lines.append(f"  r/{sub} — {label}")
    return "\n".join(lines)


def _tier_note() -> str:
    """All three tier_explanation strings, one per line."""
    tiers: list[CoverageTier] = ["base", "cds_pdf_only", "cds_extracted"]
    lines: list[str] = []
    for tier in tiers:
        lines.append(f"  [{tier}] {tier_explanation(tier)}")
    return "\n".join(lines)


def build_system_prompt(temporal_context: str, school_count: int) -> str:
    """Assemble the counselor system prompt with all six slots filled.

    Args:
        temporal_context: The rendered temporal-context block for this request
            (today's date, season phase, data calendar). Rebuilt per turn by
            the ``prepare`` graph node (``app/graph.py``).
        school_count: The live coverage count (``catalog.school_count``,
            DB-derived) — never a hardcoded literal (CFG-01, honesty carve-out).

    Returns:
        The complete system prompt string, ready to pass to PydanticAI.
    """
    template = load_prompt("counselor")

    # Escape any literal braces in the markdown body that are NOT our slots,
    # so str.format() does not choke on them. Our slots use single braces:
    # {static_field_map}, {dossier_shortlist_summary}, {subreddit_menu},
    # {temporal_context}, {tier_note}. We do a two-pass approach:
    # 1. Replace our slot placeholders with unique tokens.
    # 2. Escape all remaining { } as {{ }}.
    # 3. Restore the tokens as { }.
    _SLOTS = [
        "static_field_map",
        "dossier_shortlist_summary",
        "subreddit_menu",
        "temporal_context",
        "tier_note",
        "school_count",
    ]
    # Template slot sentinel, not a password (B105 is a false positive here).
    _TOKEN_PREFIX = "\x00SLOT"  # nosec B105
    tokens: dict[str, str] = {}
    text = template
    for i, slot in enumerate(_SLOTS):
        token = f"{_TOKEN_PREFIX}{i}\x00"
        text = text.replace("{" + slot + "}", token)
        tokens[token] = "{" + slot + "}"

    # Escape residual braces
    text = text.replace("{", "{{").replace("}", "}}")

    # Restore slot placeholders
    for token, placeholder in tokens.items():
        text = text.replace(token, placeholder)

    return text.format(
        static_field_map=load_static_map(),
        dossier_shortlist_summary=_dossier_shortlist_summary(),
        subreddit_menu=_subreddit_menu(),
        temporal_context=temporal_context,
        tier_note=_tier_note(),
        school_count=f"{school_count:,}",
    )
