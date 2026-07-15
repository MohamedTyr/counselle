"""Strict named-slot rendering for versioned text assets."""

from __future__ import annotations

from string import Formatter
from typing import Any


def render_slots(template: str, declared_slots: list[str] | tuple[str, ...], **values: Any) -> str:
    declared = tuple(declared_slots)
    if set(values) != set(declared) or len(declared) != len(set(declared)):
        raise ValueError("asset slots do not exactly match supplied values")
    parsed: list[str] = []
    for _, field, format_spec, conversion in Formatter().parse(template):
        if field is None:
            continue
        if not field or conversion is not None or format_spec:
            raise ValueError("asset slots cannot use conversion or format specifications")
        parsed.append(field)
    if set(parsed) != set(declared):
        raise ValueError("asset template fields do not match its declared slots")
    return template.format_map({key: str(value) for key, value in values.items()})
