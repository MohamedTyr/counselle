"""Shared Vertex client construction for API-key and ADC authentication."""

from __future__ import annotations

from typing import Any


def build_vertex_client(settings: Any, *, retry_attempts: int | None = None) -> Any:
    """Build a Vertex client using an Express key or Application Default Credentials.

    An explicitly configured Express key preserves the existing local-development
    path.  Otherwise the Google SDK discovers ADC itself, using the configured
    project and location for Vertex requests.
    """
    from google import genai
    from google.genai import types

    kwargs: dict[str, Any] = {"vertexai": True}
    if settings.vertex_api_key:
        kwargs["api_key"] = settings.vertex_api_key
    else:
        kwargs["project"] = settings.google_cloud_project
        kwargs["location"] = settings.google_cloud_location
    if retry_attempts is not None:
        kwargs["http_options"] = types.HttpOptions(
            retry_options=types.HttpRetryOptions(attempts=retry_attempts)
        )
    return genai.Client(**kwargs)
