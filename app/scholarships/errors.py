"""Exception family for the scholarships service layer (plan §5).

Translated at the route boundary by
`api/routes/scholarships.py::map_scholarship_errors`. Its own family, like
`app/sat/errors.py`, so a scholarship 404 never carries another surface's
sentence.
"""

from __future__ import annotations

from domain.scholarships.publish import PublishCheck


class ScholarshipError(Exception):
    """Base for scholarship service-layer failures."""


class ScholarshipNotFoundError(ScholarshipError):
    """No such record, or (for students) not published (404)."""


class ScholarshipValidationError(ScholarshipError):
    """A domain rule refused the write (422). `problems` names the failing
    publish checks when the refusal is a publish failure."""

    def __init__(self, message: str, problems: list[PublishCheck] | None = None) -> None:
        super().__init__(message)
        self.problems = problems


class ScholarshipConflictError(ScholarshipError):
    """Someone else saved first: `expected_version` is stale (409)."""

    def __init__(self, current_version: int) -> None:
        super().__init__("Someone else changed this scholarship.")
        self.current_version = current_version


__all__ = [
    "ScholarshipConflictError",
    "ScholarshipError",
    "ScholarshipNotFoundError",
    "ScholarshipValidationError",
]
