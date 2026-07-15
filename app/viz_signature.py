"""Canonical semantic signatures for known and future visualization payloads."""

from __future__ import annotations

import json
from typing import Any

from domain.specs import OpaqueRenderSpec, ParsedRenderSpec, TabularRenderSpec, parse_render_spec


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, str | int | float | bool):
        return value
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [_json_safe(item) for item in value]
    return repr(value)


def _stable_json(payload: Any) -> str:
    return json.dumps(
        _json_safe(payload), ensure_ascii=False, separators=(",", ":"), sort_keys=True
    )


def render_spec_signature(spec: ParsedRenderSpec) -> str:
    """Hash all truth/provenance for tables; all payload fields for open types."""
    if isinstance(spec, OpaqueRenderSpec):
        return _stable_json(spec.model_dump(mode="json"))
    payload = {
        "v": spec.v,
        "type": spec.type,
        "columns": [{"unitid": column.unitid, "name": column.name} for column in spec.columns],
        "rows": [
            {
                "label": row.label,
                "cells": [cell.model_dump(mode="json") for cell in row.cells],
            }
            for row in spec.rows
        ],
    }
    return _stable_json(payload)


def viz_payload_signature(payload: Any) -> str:
    try:
        if isinstance(payload, (TabularRenderSpec, OpaqueRenderSpec)):
            return render_spec_signature(payload)
        return render_spec_signature(parse_render_spec(payload))
    except Exception:
        return _stable_json(payload)
