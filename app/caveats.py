"""The sole renderer for canonical student-facing caveats."""

from __future__ import annotations

from functools import lru_cache
from typing import Any, get_args

from app.asset_format import render_slots
from config.settings import load_yaml_asset
from domain.envelope import Caveat, CaveatKind

# `CaveatKind` is the one place the eight-kind set is spelled out; this
# module and the yaml asset are both checked against it (plan §6a's
# `set(yaml) == set(assertion) == set(CaveatKind)`).
_EXPECTED_KINDS = set(get_args(CaveatKind))


@lru_cache(maxsize=1)
def caveat_catalog() -> dict[str, dict[str, Any]]:
    raw = load_yaml_asset("caveats")
    if not isinstance(raw, dict):
        raise ValueError("caveats asset must be a mapping")
    if set(raw) != _EXPECTED_KINDS:
        raise ValueError("caveats asset has an incomplete or unexpected kind set")
    for kind, item in raw.items():
        if not isinstance(item, dict) or set(item) != {"text", "slots"}:
            raise ValueError(f"invalid caveat catalog entry: {kind}")
        render_slots(str(item["text"]), item["slots"], **{slot: "probe" for slot in item["slots"]})
    return raw


def render_caveat(kind: CaveatKind, **values: Any) -> Caveat:
    try:
        item = caveat_catalog()[kind]
    except KeyError:
        raise ValueError(f"unknown caveat kind: {kind}") from None
    return Caveat(kind=kind, text=render_slots(item["text"], item["slots"], **values))
