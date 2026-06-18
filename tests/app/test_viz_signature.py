from __future__ import annotations

from decimal import Decimal

from app.viz_signature import viz_payload_signature


class Unserializable:
    pass


def test_viz_payload_signature_handles_non_json_safe_payloads() -> None:
    payload = {
        "decimal": Decimal("1.23"),
        42: {"object": Unserializable()},
    }

    signature = viz_payload_signature(payload)

    assert isinstance(signature, str)
    assert signature
