"""Loader for the generated static field-category map (Phase 3 Slice A, ADR 0007).

The map (``config/assets/static_field_map.md``) is the always-in-context view of
the fields catalog, injected into agent prompts in Phase 4; the long tail goes
through ``search_fields``. It is a generated asset — see scripts/gen_static_map.py.
"""

from functools import lru_cache

from config.settings import get_settings


@lru_cache
def load_static_map() -> str:
    """The static field-category map as Markdown, cached for prompt injection."""
    path = get_settings().assets_dir / "static_field_map.md"
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise FileNotFoundError(
            f"static field map missing at {path} — "
            "run `uv run python scripts/gen_static_map.py` to generate it"
        ) from exc
