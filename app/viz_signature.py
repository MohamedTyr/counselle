from __future__ import annotations

import json
from typing import Any

from domain.specs import RenderSpec


def _stable_json(payload: Any) -> str:
    try:
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    except Exception:
        try:
            return json.dumps(
                _json_safe(payload),
                ensure_ascii=False,
                separators=(",", ":"),
                sort_keys=True,
            )
        except Exception:
            return repr(payload)


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, str | int | float | bool):
        return value
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [_json_safe(item) for item in value]
    return repr(value)


def render_spec_signature(spec: RenderSpec) -> str:
    spec_json = spec.model_dump(mode="json")
    payload = {
        "type": spec_json.get("type"),
        "schools": [
            {
                "unitid": school.get("unitid"),
                "name": school.get("name"),
            }
            for school in spec_json.get("schools", [])
        ],
        "rows": [
            {
                "label": row.get("label"),
                "cells": [
                    {
                        "field": cell.get("field"),
                        "display": cell.get("display"),
                        "raw": cell.get("raw"),
                        "unit": cell.get("unit"),
                        "available": cell.get("available"),
                        "citation": cell.get("citation"),
                    }
                    for cell in row.get("cells", [])
                ],
            }
            for row in spec_json.get("rows", [])
        ],
    }
    return _stable_json(payload)


def viz_payload_signature(payload: Any) -> str:
    try:
        return render_spec_signature(RenderSpec.model_validate(payload))
    except Exception:
        return _stable_json(payload)
