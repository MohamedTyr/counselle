"""Deterministic display formatting shared by profile and (parked) packet reads."""

from decimal import Decimal


def format_decimal(value: int | float) -> str:
    """Render a finite number without exponent or insignificant fractional zeros."""
    rendered = format(Decimal(str(value)), "f")
    integer, separator, fraction = rendered.partition(".")
    if not separator:
        return integer
    fraction = fraction.rstrip("0")
    return f"{integer}.{fraction}" if fraction else integer


def format_cds_edition(academic_year: int) -> str:
    """Render the CDS edition whose opening year is ``academic_year``."""
    return f"CDS {academic_year}-{(academic_year + 1) % 100:02d}"


def hex_digest(value: bytes | bytearray | memoryview) -> str:
    """Render a fixed-length binary digest (sha256, etc.) as lowercase hex.

    Moved in from ``counselle_db.packets`` (school-data-v3, Phase 0): this is a
    live, boot-path dependency now — ``counselle_db.catalog.Catalog`` needs it
    for ``profile_sha256``, which survives long after the parked CDS manifest
    machinery is gone. ``packets.py`` imports it back (a parked→runtime edge,
    see ``PARKED.md``).
    """
    return bytes(value).hex()
