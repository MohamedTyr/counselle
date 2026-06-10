"""SKILL.md loader (ARCHITECTURE §15, ADR 0010).

Skills are YAML-frontmatter + Markdown files living in ``skills/*/SKILL.md``.
Metadata loads at startup (progressive disclosure — the LLM sees names +
descriptions without loading bodies). ``load_skill(name)`` returns the body only,
on demand.

This module is side-effect-free at import time: :func:`load_all_skill_meta` and
:func:`load_skill` each open files on first call; the cached results are
module-level dicts.
"""

from __future__ import annotations

import re
import textwrap
from collections.abc import Awaitable, Callable
from pathlib import Path

# ---------------------------------------------------------------------------
# Internal: locate the skills tree (relative to this file's package parent)
# ---------------------------------------------------------------------------

_SKILLS_ROOT = Path(__file__).parent.parent / "skills"

# Regex to strip YAML frontmatter (--- ... ---) from the top of a .md file.
_FRONTMATTER_RE = re.compile(r"^---\s*\n.*?^---\s*\n", re.DOTALL | re.MULTILINE)


def _parse_frontmatter(text: str) -> dict[str, str]:
    """Extract key: value pairs from YAML frontmatter (minimal, no full YAML parse)."""
    match = _FRONTMATTER_RE.match(text)
    if not match:
        return {}
    block = match.group(0)
    result: dict[str, str] = {}
    for line in block.splitlines():
        if ":" in line and not line.startswith("---"):
            key, _, value = line.partition(":")
            result[key.strip()] = value.strip()
    return result


def _body(text: str) -> str:
    """Return the markdown body with frontmatter stripped."""
    return _FRONTMATTER_RE.sub("", text).lstrip()


# ---------------------------------------------------------------------------
# Module-level cache
# ---------------------------------------------------------------------------

_meta_cache: list[dict[str, str]] | None = None
_body_cache: dict[str, str] = {}


def _skill_paths() -> list[Path]:
    """All SKILL.md files found under the skills root, sorted by directory name."""
    if not _SKILLS_ROOT.exists():
        return []
    return sorted(_SKILLS_ROOT.glob("*/SKILL.md"))


def load_all_skill_meta() -> list[dict[str, str]]:
    """Parse and cache YAML frontmatter from every SKILL.md at startup.

    Returns a list of dicts, each with ``name`` and ``description``.
    Unknown or malformed frontmatter is silently skipped so a broken skill
    file does not prevent the server from starting.
    """
    global _meta_cache
    if _meta_cache is not None:
        return _meta_cache

    meta: list[dict[str, str]] = []
    for path in _skill_paths():
        try:
            text = path.read_text(encoding="utf-8")
            fm = _parse_frontmatter(text)
            name = fm.get("name", "").strip()
            description = fm.get("description", "").strip()
            if name and description:
                meta.append({"name": name, "description": description})
        except OSError:
            pass  # missing or unreadable file — skip

    _meta_cache = meta
    return _meta_cache


def load_skill(name: str) -> str:
    """Return the body (no frontmatter) of the named skill.

    If the skill is unknown, returns a helpful error string listing all
    available skill names. This function never raises so a tool call
    cannot crash the agent.
    """
    if name in _body_cache:
        return _body_cache[name]

    for path in _skill_paths():
        text = path.read_text(encoding="utf-8")
        fm = _parse_frontmatter(text)
        if fm.get("name", "").strip() == name:
            body = _body(text)
            _body_cache[name] = body
            return body

    available = [m["name"] for m in load_all_skill_meta()]
    names_list = ", ".join(f'"{n}"' for n in available) if available else "(none loaded)"
    return (
        f'Skill "{name}" not found. '
        f"Available skills: {names_list}. "
        "Call load_skill with one of those names."
    )


# ---------------------------------------------------------------------------
# PydanticAI tool factory
# ---------------------------------------------------------------------------


def make_load_skill_tool() -> Callable[[str], Awaitable[str]]:
    """Return a plain async function wrapping load_skill, ready for PydanticAI.

    The docstring lists every available skill + description so the LLM can
    decide which to load without fetching all bodies upfront (progressive
    disclosure, ADR 0010).
    """
    meta = load_all_skill_meta()
    menu = "\n".join(f"  - {m['name']}: {m['description']}" for m in meta) or "  (no skills loaded)"

    docstring = textwrap.dedent(f"""\
        Load the full instructions for a named skill.

        Available skills:
        {menu}

        Pass the skill name exactly as shown (e.g. "dossier-assembly").
        Returns the skill body as Markdown text.
        If the name is wrong, returns a helpful error listing valid names.
    """)

    async def load_skill_tool(name: str) -> str:
        return load_skill(name)

    load_skill_tool.__doc__ = docstring
    load_skill_tool.__name__ = "load_skill"
    return load_skill_tool
