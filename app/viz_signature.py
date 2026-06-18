from __future__ import annotations

import json
from typing import Any

from domain.specs import RenderSpec


def render_spec_signature(spec: RenderSpec) -> str:
    payload = {
        "type": spec.type,
        "schools": [
            {
                "unitid": school.unitid,
                "name": school.name,
            }
            for school in spec.schools
        ],
        "rows": [
            {
                "label": row.label,
                "cells": [
                    {
                        "field": cell.field,
                        "display": cell.display,
                        "raw": cell.raw,
                        "unit": cell.unit,
                        "available": cell.available,
                        "citation": cell.citation.model_dump(mode="json"),
                    }
                    for cell in row.cells
                ],
            }
            for row in spec.rows
        ],
    }
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def viz_payload_signature(payload: Any) -> str:
    try:
        return render_spec_signature(RenderSpec.model_validate(payload))
    except Exception:
        return json.dumps(payload, default=repr, separators=(",", ":"), sort_keys=True)
