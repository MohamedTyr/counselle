"""Narrow exception family for the CDS admin surface (plan §D).

Translated at the route boundary by ``api/routes/cds_admin.py::map_cds_errors``
— mirrors ``api/routes/workspace_common.py::map_workspace_errors`` in shape,
but is its own family rather than a reuse of ``WorkspaceNotFoundError`` (those
are workspace-domain-specific, per plan §D).
"""

from __future__ import annotations


class CdsAdminError(Exception):
    """Base for CDS admin service-layer failures."""


class CdsAdminNotFoundError(CdsAdminError):
    """The requested school/document/upload row/extraction does not exist (404)."""


class CdsAdminValidationError(CdsAdminError):
    """The request is well-formed but fails a domain rule (422)."""


class CdsAdminConflictError(CdsAdminError):
    """The request conflicts with current state (409) — e.g. approve blocked
    by unresolved review flags, or a live job already running on this slot."""


__all__ = [
    "CdsAdminConflictError",
    "CdsAdminError",
    "CdsAdminNotFoundError",
    "CdsAdminValidationError",
]
