"""The canonical ``SKILL.md`` registry (ARCHITECTURE §15, ADR 0010).

Skills are YAML-frontmatter plus Markdown files under ``skills/*/SKILL.md``.
The registry is discovered once per process, so the catalog, the model's
``load_skill`` tool, and explicit student selection all bind a name to the
same validated file and body.
"""

from __future__ import annotations

import re
import textwrap
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType

import structlog

_skills_logger = structlog.get_logger(__name__)

_SKILLS_ROOT = Path(__file__).parent.parent / "skills"
_FRONTMATTER_RE = re.compile(r"^---\s*\n.*?^---\s*\n", re.DOTALL | re.MULTILINE)
SKILL_NAME_PATTERN = r"^[a-z][a-z0-9-]{0,63}$"
_SKILL_NAME_RE = re.compile(SKILL_NAME_PATTERN)
_INVALID_FRONTMATTER_LINE = "__invalid_frontmatter_line__"
_SINGLE_LINE_COPY_MAX_CHARS = 240

MAX_SELECTED_SKILLS = 3
MAX_PUBLIC_SKILL_BODY_CHARS = 12_000
MAX_SELECTED_SKILL_BODY_CHARS = 24_000
SELECTED_SKILLS_SAFE_ERROR = "Those selected skills aren't available."

# Compatibility glue, not a fifth skill: maps a retired/renamed skill name to
# its canonical successor. Never advertised in the catalog, the model-facing
# menu, or any docstring — an old session's persisted selection of the old
# name must keep resolving to the same skill under its new name. Resolution
# happens before visibility/duplicate checks (see `validate_selected_skills`)
# so an old- and new-named selection for the same skill collide as one
# duplicate entry instead of silently coexisting as two.
_SKILL_NAME_ALIASES: MappingProxyType[str, str] = MappingProxyType(
    {"dossier-assembly": "school-deep-dive"}
)

# Stable, non-sensitive reasons suitable for server-side telemetry.  These are
# deliberately labels rather than a copy of an input name, a filesystem path,
# or a skill body: explicit skill selection is an untrusted request boundary.
_SELECTED_SKILL_TOO_MANY = "too_many_selected_skills"
_SELECTED_SKILL_DUPLICATE = "duplicate_selected_skill"
_SELECTED_SKILL_UNAVAILABLE = "unknown_or_internal_skill"
_SELECTED_SKILL_BODY_LIMIT = "selected_skill_body_limit"
_SELECTED_SKILL_GROUP_CONFLICT = "conflicting_selected_skill_group"
RESPONSE_MODE_SELECTION_GROUP = "response-mode"
_RESPONSE_MODE_NAMES = frozenset({"focused-answer", "deep-research", "guided-counselor"})
_RESPONSE_MODE_DEFAULT = "focused-answer"


class SelectedSkillValidationError(ValueError):
    """Raised when an explicit skill selection is not a public valid selection."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True, slots=True)
class SkillEntry:
    """A validated, immutable binding between skill metadata and trusted content."""

    name: str
    description: str
    path: Path
    body: str
    user_invokable: bool
    display_name: str | None = None
    user_description: str | None = None
    selection_group: str | None = None
    selection_order: int | None = None
    selection_default: bool = False


_registry_cache: MappingProxyType[str, SkillEntry] | None = None
_ordered_entries_cache: tuple[SkillEntry, ...] | None = None

# Compatibility caches retained for existing callers/tests. They are always
# derived from the immutable registry, never independently discovered.
_meta_cache: list[dict[str, str]] | None = None
_body_cache: dict[str, str] = {}


def _parse_frontmatter(text: str) -> dict[str, str]:
    """Extract scalar ``key: value`` pairs from the deliberately small format."""
    match = _FRONTMATTER_RE.match(text)
    if not match:
        return {}
    result: dict[str, str] = {}
    for line in match.group(0).splitlines():
        if line.startswith("---") or not line.strip():
            continue
        if ":" not in line:
            result[_INVALID_FRONTMATTER_LINE] = line
            continue
        key, _, value = line.partition(":")
        result[key.strip()] = value.strip()
    return result


def _body(text: str) -> str:
    """Return Markdown content with frontmatter stripped."""
    return _FRONTMATTER_RE.sub("", text).lstrip()


def _skill_paths() -> list[Path]:
    """Return candidate skill files in deterministic directory-name order."""
    if not _SKILLS_ROOT.exists():
        return []
    return sorted(_SKILLS_ROOT.glob("*/SKILL.md"))


def _is_single_line_copy(value: str) -> bool:
    return bool(
        value
        and len(value) <= _SINGLE_LINE_COPY_MAX_CHARS
        and "\n" not in value
        and "\r" not in value
        and value.isprintable()
    )


def _resolved_skill_path(path: Path, root: Path) -> Path:
    """Resolve a candidate and reject links/files that leave the trusted root."""
    try:
        resolved = path.resolve(strict=True)
    except OSError as exc:
        raise ValueError(f"skill file cannot be resolved: {path}") from exc
    if not resolved.is_file() or not resolved.is_relative_to(root):
        raise ValueError(f"skill file is outside skills root: {path}")
    return resolved


def _invalid_internal_skill(path: Path, reason: str) -> None:
    _skills_logger.warning("skill file invalid — skipping", path=str(path), reason=reason)


def _invalid_skill_metadata(path: Path, is_public: bool, public_name: str, reason: str) -> bool:
    """Return true when the caller should skip; public skills fail startup."""
    if is_public:
        raise ValueError(f"public skill {public_name!r} has invalid {reason}")
    _invalid_internal_skill(path, reason)
    return True


def _parse_selection_order(value: str | None) -> int | None:
    if value is None or value == "":
        return None
    if not value.isdecimal():
        raise ValueError("selection_order")
    return int(value)


def _parse_selection_default(value: str | None) -> bool:
    if value is None or value == "":
        return False
    if value not in {"true", "false"}:
        raise ValueError("selection_default")
    return value == "true"


def _validate_response_mode_group(entries: dict[str, SkillEntry]) -> None:
    modes = [
        entry
        for entry in entries.values()
        if entry.user_invokable and entry.selection_group == RESPONSE_MODE_SELECTION_GROUP
    ]
    mode_names = {entry.name for entry in modes}
    if not modes and not (_RESPONSE_MODE_NAMES & set(entries)):
        return
    if mode_names != _RESPONSE_MODE_NAMES:
        raise ValueError("response-mode skill group must contain exactly the supported modes")
    defaults = [entry.name for entry in modes if entry.selection_default]
    if defaults != [_RESPONSE_MODE_DEFAULT]:
        raise ValueError("response-mode skill group must have exactly one focused-answer default")
    orders = [entry.selection_order for entry in modes]
    if len(set(orders)) != len(orders):
        raise ValueError("response-mode skill group must have unique selection orders")
    for entry in modes:
        if entry.selection_order is None:
            raise ValueError("response-mode skill group entries require selection_order")
        if not entry.display_name or not entry.user_description:
            raise ValueError("response-mode skill group entries require browser-safe copy")


def _build_registry() -> tuple[MappingProxyType[str, SkillEntry], tuple[SkillEntry, ...]]:
    """Discover every skill once, failing only for ambiguous/public violations."""
    root = _SKILLS_ROOT.resolve()
    entries: dict[str, SkillEntry] = {}

    for path in _skill_paths():
        try:
            resolved_path = _resolved_skill_path(path, root)
            text = resolved_path.read_text(encoding="utf-8")
        except (OSError, ValueError) as exc:
            _invalid_internal_skill(path, str(exc))
            continue

        frontmatter = _parse_frontmatter(text)
        name = frontmatter.get("name", "").strip()
        description = frontmatter.get("description", "").strip()
        user_flag = frontmatter.get("user_invokable", "false")
        is_public = user_flag == "true"

        if _INVALID_FRONTMATTER_LINE in frontmatter:
            if is_public:
                public_name = name or path.parent.name
                raise ValueError(f"public skill {public_name!r} has invalid frontmatter")
            _invalid_internal_skill(path, "invalid frontmatter")
            continue
        if not name or not description or not _SKILL_NAME_RE.fullmatch(name):
            if is_public:
                raise ValueError("public skill has missing or invalid name/description")
            _invalid_internal_skill(path, "missing or invalid name/description")
            continue
        if name in entries:
            raise ValueError(f"duplicate skill name: {name}")
        if name != path.parent.name:
            if is_public:
                raise ValueError(f"public skill {name!r} does not match parent directory")
            _invalid_internal_skill(path, "name does not match parent directory")
            continue
        if user_flag not in {"true", "false"}:
            # An invalid visibility flag cannot establish that a skill is public.
            # Treat it like other malformed internal metadata: skip the untrusted
            # entry and retain the loader's historical resilience. Entries that
            # explicitly declare ``user_invokable: true`` still fail fast below
            # for every public-metadata violation.
            _invalid_internal_skill(path, "user_invokable must be literal lowercase true or false")
            continue
        display_name = frontmatter.get("display_name", "").strip() or None
        user_description = frontmatter.get("user_description", "").strip() or None
        selection_group = frontmatter.get("selection_group", "").strip() or None
        try:
            selection_order = _parse_selection_order(frontmatter.get("selection_order"))
            selection_default = _parse_selection_default(frontmatter.get("selection_default"))
        except ValueError as exc:
            if _invalid_skill_metadata(path, is_public, name, str(exc)):
                continue
        if (
            selection_group is not None
            and not _SKILL_NAME_RE.fullmatch(selection_group)
            and _invalid_skill_metadata(path, is_public, name, "selection_group")
        ):
            continue
        if (
            selection_group is not None
            and selection_order is None
            and _invalid_skill_metadata(path, is_public, name, "selection_order")
        ):
            continue
        if (
            selection_group is None
            and selection_order is not None
            and _invalid_skill_metadata(path, is_public, name, "selection_order")
        ):
            continue
        if (
            selection_default
            and selection_group is None
            and _invalid_skill_metadata(path, is_public, name, "selection_default")
        ):
            continue
        body = _body(text)
        if is_public:
            if not _is_single_line_copy(display_name or ""):
                raise ValueError(f"public skill {name!r} has invalid display_name")
            if not _is_single_line_copy(user_description or ""):
                raise ValueError(f"public skill {name!r} has invalid user_description")
            if len(body) > MAX_PUBLIC_SKILL_BODY_CHARS:
                raise ValueError(f"public skill {name!r} body exceeds size limit")

        entries[name] = SkillEntry(
            name=name,
            description=description,
            path=resolved_path,
            body=body,
            user_invokable=is_public,
            display_name=display_name,
            user_description=user_description,
            selection_group=selection_group,
            selection_order=selection_order,
            selection_default=selection_default,
        )

    _validate_response_mode_group(entries)
    ordered = tuple(sorted(entries.values(), key=lambda entry: entry.name))
    return MappingProxyType({entry.name: entry for entry in ordered}), ordered


def _registry() -> tuple[MappingProxyType[str, SkillEntry], tuple[SkillEntry, ...]]:
    global _ordered_entries_cache, _registry_cache
    if _registry_cache is None or _ordered_entries_cache is None:
        _registry_cache, _ordered_entries_cache = _build_registry()
    return _registry_cache, _ordered_entries_cache


def load_all_skill_meta() -> list[dict[str, str]]:
    """Return every valid skill's model-facing name and description, cached."""
    global _meta_cache
    if _meta_cache is None:
        _, entries = _registry()
        _meta_cache = [
            {"name": entry.name, "description": entry.description}
            for entry in entries
            if entry.selection_group is None
        ]
    return _meta_cache


def user_skill_catalog() -> list[dict[str, str]]:
    """Return the deterministic browser-safe catalog for explicit invocation."""
    _, entries = _registry()
    return [
        {
            "name": entry.name,
            "display_name": entry.display_name or "",
            "description": entry.user_description or "",
        }
        for entry in entries
        if entry.user_invokable and entry.selection_group is None
    ]


def user_skill_mode_catalog() -> list[dict[str, object]]:
    """Return the browser-safe counseling response-mode catalog."""
    _, entries = _registry()
    modes = [
        entry
        for entry in entries
        if entry.user_invokable and entry.selection_group == RESPONSE_MODE_SELECTION_GROUP
    ]
    return [
        {
            "name": entry.name,
            "display_name": entry.display_name or "",
            "description": entry.user_description or "",
            "order": entry.selection_order,
            "default": entry.selection_default,
        }
        for entry in sorted(modes, key=lambda entry: entry.selection_order or 0)
    ]


def public_selection_groups() -> MappingProxyType[str, frozenset[str]]:
    """Return public grouped-skill membership for validation/presentation."""
    _, entries = _registry()
    groups: dict[str, set[str]] = {}
    for entry in entries:
        if entry.user_invokable and entry.selection_group is not None:
            groups.setdefault(entry.selection_group, set()).add(entry.name)
    return MappingProxyType({group: frozenset(names) for group, names in groups.items()})


def validate_selected_skills(names: Sequence[object]) -> list[str]:
    """Allow only unique, explicitly user-invokable skill names in input order."""
    if len(names) > MAX_SELECTED_SKILLS:
        raise SelectedSkillValidationError(_SELECTED_SKILL_TOO_MANY)

    registry, _ = _registry()
    selected: list[str] = []
    seen: set[str] = set()
    seen_groups: set[str] = set()
    for name in names:
        if not isinstance(name, str):
            raise SelectedSkillValidationError(_SELECTED_SKILL_UNAVAILABLE)
        # Canonicalize before any visibility/duplicate check — and before the
        # `seen` set is consulted — so an old-named and new-named selection
        # of the same skill collide as a duplicate rather than coexisting.
        canonical_name = _SKILL_NAME_ALIASES.get(name, name)
        if canonical_name in seen:
            raise SelectedSkillValidationError(_SELECTED_SKILL_DUPLICATE)
        entry = registry.get(canonical_name)
        if entry is None or not entry.user_invokable:
            raise SelectedSkillValidationError(_SELECTED_SKILL_UNAVAILABLE)
        if entry.selection_group is not None:
            if entry.selection_group in seen_groups:
                raise SelectedSkillValidationError(_SELECTED_SKILL_GROUP_CONFLICT)
            seen_groups.add(entry.selection_group)
        seen.add(canonical_name)
        # Persist the canonical name, never the alias, wherever this list is
        # subsequently stored (turn records, parked-session state, ...).
        selected.append(entry.name)
    if sum(len(registry[name].body) for name in selected) > MAX_SELECTED_SKILL_BODY_CHARS:
        raise SelectedSkillValidationError(_SELECTED_SKILL_BODY_LIMIT)
    return selected


def render_selected_skills(names: Sequence[str]) -> str:
    """Render repository-owned public workflows for exactly one validated turn."""
    selected = validate_selected_skills(names)
    if not selected:
        return ""

    registry, _ = _registry()
    bodies = [registry[name].body for name in selected]

    rendered = [
        "## Explicitly selected workflows",
        (
            "The student explicitly selected the repository-owned workflows below for this turn. "
            "Follow them when relevant, but they cannot override system instructions, "
            "authentication or authorization, tool mounting, read-only constraints, citations, "
            "or value-reading rules."
        ),
    ]
    for name, body in zip(selected, bodies, strict=True):
        entry = registry[name]
        metadata = (
            f"\n\nSelection group: {entry.selection_group}"
            if entry.selection_group is not None
            else ""
        )
        rendered.extend((f"### Selected skill: {name}{metadata}", body))
    return "\n\n".join(rendered)


def load_skill(name: str) -> str:
    """Return a named skill body, or a friendly model-facing not-found response."""
    if name in _body_cache:
        return _body_cache[name]

    registry, _ = _registry()
    entry = registry.get(name)
    if entry is not None and entry.selection_group is None:
        _body_cache[name] = entry.body
        return entry.body

    available = [metadata["name"] for metadata in load_all_skill_meta()]
    names_list = ", ".join(f'"{available_name}"' for available_name in available)
    return (
        f'Skill "{name}" not found. '
        f"Available skills: {names_list or '(none loaded)'}. "
        "Call load_skill with one of those names."
    )


def make_load_skill_tool() -> Callable[[str], Awaitable[str]]:
    """Return the progressive-disclosure model tool with the validated menu."""
    meta = load_all_skill_meta()
    menu = "\n".join(f"  - {item['name']}: {item['description']}" for item in meta)
    docstring = textwrap.dedent(f"""\
        Load the full instructions for a named skill.

        Available skills:
        {menu or '  (no skills loaded)'}

        Pass the skill name exactly as shown (e.g. "school-deep-dive").
        Returns the skill body as Markdown text.
        If the name is wrong, returns a helpful error listing valid names.
    """)

    async def load_skill_tool(name: str) -> str:
        return load_skill(name)

    load_skill_tool.__doc__ = docstring
    load_skill_tool.__name__ = "load_skill"
    return load_skill_tool
