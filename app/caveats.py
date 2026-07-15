"""The sole renderer for canonical student-facing caveats."""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from app.asset_format import render_slots
from config.settings import load_yaml_asset
from domain.envelope import Caveat


@lru_cache(maxsize=1)
def caveat_catalog() -> dict[str, dict[str, Any]]:
    raw = load_yaml_asset("caveats")
    if not isinstance(raw, dict):
        raise ValueError("caveats asset must be a mapping")
    expected = {
        "profile_snapshot", "stale_edition", "partial_packet", "definition_drift",
        "not_in_template_version", "edition_mismatch_comparison", "coverage_denominator",
        "not_reported", "not_applicable", "suppressed",
    }
    if set(raw) != expected:
        raise ValueError("caveats asset has an incomplete or unexpected kind set")
    for kind, item in raw.items():
        if not isinstance(item, dict) or set(item) != {"text", "slots"}:
            raise ValueError(f"invalid caveat catalog entry: {kind}")
        render_slots(str(item["text"]), item["slots"], **{slot: "probe" for slot in item["slots"]})
    return raw


def render_caveat(kind: str, **values: Any) -> Caveat:
    try:
        item = caveat_catalog()[kind]
    except KeyError:
        raise ValueError(f"unknown caveat kind: {kind}") from None
    return Caveat(kind=kind, text=render_slots(item["text"], item["slots"], **values))
