"""Deterministic display formatting for profile reads (plus `hex_digest`,
shared with the catalog).

``format_cds_edition`` moved out to ``counselle_db.packets`` in
school-data-v3 Phase 3 (Unit B) so that module — the parked CDS
manifest/packet reader — is fully self-contained; nothing outside
``packets.py`` reads a CDS edition label any more.
"""

from decimal import Decimal


def format_decimal(value: int | float) -> str:
    """Render a finite number without exponent or insignificant fractional zeros."""
    rendered = format(Decimal(str(value)), "f")
    integer, separator, fraction = rendered.partition(".")
    if not separator:
        return integer
    fraction = fraction.rstrip("0")
    return f"{integer}.{fraction}" if fraction else integer


def hex_digest(value: bytes | bytearray | memoryview) -> str:
    """Render a fixed-length binary digest (sha256, etc.) as lowercase hex.

    Moved in from ``counselle_db.packets`` (school-data-v3, Phase 0): this is a
    live, boot-path dependency now — ``counselle_db.catalog.Catalog`` needs it
    for ``profile_sha256``, which survives long after the parked CDS manifest
    machinery is gone. ``packets.py`` imports it back (a parked→runtime edge,
    see ``PARKED.md``).
    """
    return bytes(value).hex()
