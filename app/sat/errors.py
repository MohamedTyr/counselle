"""Narrow exception family for the SAT practice service layer (plan §4.1).

Translated at the route boundary by ``api/routes/sat.py::map_sat_errors``
— its own family, not a reuse of ``app.workspace.models.WorkspaceNotFoundError``
/ ``WorkspaceValidationError``, so a SAT 404/422 never carries the workspace
surface's "Workspace item not found." sentence (plan §4.1; precedent
``app/cds/errors.py`` + ``api/routes/cds_admin.py::map_cds_errors``).
"""

from __future__ import annotations


class SatError(Exception):
    """Base for SAT practice service-layer failures."""


class SatNotFoundError(SatError):
    """The requested question does not exist (404) — including an alias or
    case-variant id that resolves to nothing."""


class SatValidationError(SatError):
    """The request is well-formed but fails a domain rule (422) — an answer
    that is not one of the question's MCQ labels, an SPR entry outside
    ``^[0-9./-]{1,7}$``, or an import file that fails to parse."""


__all__ = ["SatError", "SatNotFoundError", "SatValidationError"]
