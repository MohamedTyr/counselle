"""Counselor system-prompt builder (ARCHITECTURE §16, ADR 0018).

The prompt template lives in ``config/assets/prompts/counselor.md`` as a
``str.format``-friendly file with seven named slots:

- ``{static_field_map}``      — the static category map (always-in-context)
- ``{dossier_shortlist_summary}`` — section titles + field counts from the YAML
- ``{subreddit_menu}``        — rendered as "r/<sub> — <label>" lines
- ``{temporal_context}``      — today's date + season + data calendar (per-request)
- ``{student_context}``       — profile + documents + memory for the
  authenticated student, or the neutral unauthenticated line (per-request,
  ``app/student_context.py``)
- ``{tier_note}``             — the three tier_explanation strings joined
- ``{school_count}``          — the live coverage count (CFG-01, DB-derived)

Literal braces in the markdown are escaped as ``{{``/``}}``.
"""

from __future__ import annotations

from config.settings import load_prompt, load_yaml_asset


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
    """Compatibility slot until the Phase 5 prompt rewrite removes old tier copy."""
    return "Coverage is reported per selected CDS document and domain."


def build_system_prompt(temporal_context: str, student_context: str, school_count: int) -> str:
    """Assemble the counselor system prompt with all seven slots filled.

    Args:
        temporal_context: The rendered temporal-context block for this request
            (today's date, season phase, data calendar). Rebuilt per turn by
            the ``prepare`` graph node (``app/graph.py``).
        student_context: The rendered student-context block for this request
            (profile + documents + memory, or the neutral unauthenticated
            line). Rebuilt per turn by the ``prepare`` graph node
            (``app/student_context.py``).
        school_count: The live coverage count (``catalog.school_count``,
            DB-derived) — never a hardcoded literal (CFG-01, honesty carve-out).

    Returns:
        The complete system prompt string, ready to pass to PydanticAI.
    """
    template = load_prompt("counselor")

    # Escape any literal braces in the markdown body that are NOT our slots,
    # so str.format() does not choke on them. Our slots use single braces:
    # {static_field_map}, {dossier_shortlist_summary}, {subreddit_menu},
    # {temporal_context}, {student_context}, {tier_note}. We do a two-pass
    # approach:
    # 1. Replace our slot placeholders with unique tokens.
    # 2. Escape all remaining { } as {{ }}.
    # 3. Restore the tokens as { }.
    _SLOTS = [
        "static_field_map",
        "dossier_shortlist_summary",
        "subreddit_menu",
        "temporal_context",
        "student_context",
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
        static_field_map="The current manifest returned by database tools is the catalog.",
        dossier_shortlist_summary=_dossier_shortlist_summary(),
        subreddit_menu=_subreddit_menu(),
        temporal_context=temporal_context,
        student_context=student_context,
        tier_note=_tier_note(),
        school_count=f"{school_count:,}",
    )
