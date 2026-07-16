"""Deterministic display formatting shared by profile and packet reads."""

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
