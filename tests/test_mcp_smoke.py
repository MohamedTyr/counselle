from __future__ import annotations

from config.settings import DbChildSettings
from scripts.mcp_smoke import EXPECTED_TOOLS, child_environment


def test_smoke_inventory_and_child_environment_are_db_only() -> None:
    settings = DbChildSettings(
        db_ro_dsn="postgresql://reader:secret@localhost/db",
        db_row_cap=321,
        supported_packet_extractor_versions=frozenset({"packet-v8"}),
    )

    env = child_environment(settings)

    assert {
        "resolve_school",
        "get_school_profile",
        "get_domain",
        "query_database",
    } == EXPECTED_TOOLS
    assert env["COUNSELLE_DB_RO_DSN"] == settings.db_ro_dsn
    assert env["COUNSELLE_DB_ROW_CAP"] == "321"
    assert env["COUNSELLE_SUPPORTED_PACKET_EXTRACTOR_VERSIONS"] == "packet-v8"
    assert env["COUNSELLE_SETTINGS_NO_ENV_FILE"] == "1"
    assert all("TAVILY" not in key and "VERTEX" not in key for key in env)
