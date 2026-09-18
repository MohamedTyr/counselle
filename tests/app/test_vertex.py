"""Vertex authentication construction tests."""

from __future__ import annotations

from types import SimpleNamespace


def test_build_vertex_client_uses_adc_when_no_api_key_is_configured() -> None:
    """ADC must receive the configured project and region, never a blank key."""
    from app.vertex import build_vertex_client

    settings = SimpleNamespace(
        vertex_api_key=None,
        google_cloud_project="counselle-adc-test",
        google_cloud_location="us-central1",
    )

    client = build_vertex_client(settings)

    assert client._api_client.api_key is None
    assert client._api_client.project == "counselle-adc-test"
    assert client._api_client.location == "us-central1"


def test_build_vertex_client_preserves_express_api_key_authentication() -> None:
    """Existing Express-mode setups continue to work during the ADC migration."""
    from app.vertex import build_vertex_client

    settings = SimpleNamespace(
        vertex_api_key="test-vertex-express-mode-key",
        google_cloud_project="counselle-adc-test",
        google_cloud_location="us-central1",
    )

    client = build_vertex_client(settings)

    assert client._api_client.api_key == settings.vertex_api_key
    assert client._api_client.project is None
    assert client._api_client.location is None
