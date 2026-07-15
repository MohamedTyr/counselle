"""Tests for the Settings surface and asset loaders (config/settings.py, ADR 0018)."""

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from pydantic_settings import SettingsConfigDict

from config.settings import (
    DbChildSettings,
    Settings,
    get_settings,
    load_prompt,
    load_yaml_asset,
    reset_config_caches,
)


def test_db_child_settings_ignore_repository_env_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / ".env").write_text(
        "COUNSELLE_DB_APP_DSN=postgresql://secret-app\n"
        "COUNSELLE_MODEL_COUNSELOR=secret-model\n"
        "COUNSELLE_TAVILY_API_KEY=secret-tavily\n"
        "COUNSELLE_GOOGLE_OAUTH_CLIENT_SECRET=secret-oauth\n"
        "COUNSELLE_JWT_SECRET=secret-jwt\n"
    )
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("COUNSELLE_DB_RO_DSN", RO_DSN)
    child = DbChildSettings()  # type: ignore[call-arg]
    assert child.db_ro_dsn == RO_DSN
    for forbidden in (
        "db_app_dsn",
        "model_counselor",
        "tavily_api_key",
        "google_oauth_client_secret",
        "jwt_secret",
    ):
        assert not hasattr(child, forbidden)

RO_DSN = "postgresql://counselle_ro:ro-s3cret-pw@localhost:5432/ascensia"
APP_DSN = "postgresql://counselle_app:app-s3cret-pw@localhost:5432/ascensia"
JWT_SECRET = "test-jwt-secret-deadbeef-deadbeef-0123456789"  # ≥32 bytes


class EnvFileFreeSettings(Settings):
    """Settings that never read the repo ``.env`` — tests fully control the environment."""

    model_config = SettingsConfigDict(env_file=None, env_prefix="COUNSELLE_", extra="ignore")


@pytest.fixture(autouse=True)
def _clear_caches() -> Iterator[None]:
    """lru_cached loaders must not leak state between tests."""
    reset_config_caches()
    yield
    reset_config_caches()


@pytest.fixture
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Strip every COUNSELLE_-prefixed variable from the environment."""
    for key in list(os.environ):
        if key.startswith("COUNSELLE_"):
            monkeypatch.delenv(key)


@pytest.fixture
def dsn_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Provide just the two required DSNs via the environment."""
    monkeypatch.setenv("COUNSELLE_DB_RO_DSN", RO_DSN)
    monkeypatch.setenv("COUNSELLE_DB_APP_DSN", APP_DSN)
    monkeypatch.setenv("COUNSELLE_JWT_SECRET", JWT_SECRET)


class TestFailFast:
    def test_missing_dsns_raise_one_aggregated_error_naming_both(
        self,
        clean_env: None,
        monkeypatch: pytest.MonkeyPatch,
        tmp_path: Path,
    ) -> None:
        # chdir to an empty dir so the repo .env is not picked up.
        monkeypatch.chdir(tmp_path)
        with pytest.raises(RuntimeError) as excinfo:
            get_settings()
        message = str(excinfo.value)
        assert "COUNSELLE_DB_RO_DSN" in message
        assert "COUNSELLE_DB_APP_DSN" in message
        assert "fix the following" in message


class TestDefaults:
    def test_minimal_env_loads_documented_defaults(self, clean_env: None) -> None:
        settings = EnvFileFreeSettings(db_ro_dsn=RO_DSN, db_app_dsn=APP_DSN, jwt_secret=JWT_SECRET)

        # Models
        assert settings.model_counselor == "google-vertex:gemini-2.5-pro"
        assert settings.model_cheap == "google-vertex:gemini-2.5-flash"
        assert settings.model_clarifier == "google-vertex:gemini-2.5-flash"
        assert settings.agent_max_model_requests == 80
        assert settings.agent_max_total_tokens == 2_000_000
        assert settings.thinking_stream is True
        assert settings.thinking_summaries is None
        assert settings.effective_thinking_stream is True
        # Database
        assert settings.db_statement_timeout_ms == 8000
        assert settings.db_row_cap == 500
        assert settings.db_pool_min == 1
        assert settings.db_pool_max == 5
        # Sessions
        assert settings.checkpointer == "postgres"
        assert settings.session_ttl_days is None
        # CDS Library reader
        assert settings.data_catalog_refresh_seconds == 3600
        assert settings.query_database_max_bytes == 262_144
        assert settings.viz_max_cells == 600
        assert settings.source_evidence_max_items == 50
        assert settings.supported_packet_extractor_versions == frozenset(
            {
                "gemini-native-pdf-v2",
                "gemini-native-pdf-v5",
                "gemini-routed-extraction-v7",
                "gemini-routed-extraction-v8",
            }
        )

    def test_cds_reader_caps_and_extractors_parse_from_environment(
        self, clean_env: None, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("COUNSELLE_DATA_CATALOG_REFRESH_SECONDS", "45")
        monkeypatch.setenv("COUNSELLE_QUERY_DATABASE_MAX_BYTES", "4096")
        monkeypatch.setenv(
            "COUNSELLE_SUPPORTED_PACKET_EXTRACTOR_VERSIONS", "extractor-a, extractor-b"
        )

        settings = EnvFileFreeSettings(
            db_ro_dsn=RO_DSN, db_app_dsn=APP_DSN, jwt_secret=JWT_SECRET
        )

        assert settings.data_catalog_refresh_seconds == 45
        assert settings.query_database_max_bytes == 4096
        assert settings.supported_packet_extractor_versions == frozenset(
            {"extractor-a", "extractor-b"}
        )

    @pytest.mark.parametrize(
        ("name", "value"),
        [
            ("COUNSELLE_DATA_CATALOG_REFRESH_SECONDS", "0"),
            ("COUNSELLE_QUERY_DATABASE_MAX_BYTES", "0"),
            ("COUNSELLE_SUPPORTED_PACKET_EXTRACTOR_VERSIONS", " , "),
        ],
    )
    def test_cds_reader_environment_rejects_nonpositive_caps_and_blank_extractors(
        self,
        clean_env: None,
        monkeypatch: pytest.MonkeyPatch,
        name: str,
        value: str,
    ) -> None:
        monkeypatch.setenv(name, value)

        with pytest.raises(ValueError):
            EnvFileFreeSettings(
                db_ro_dsn=RO_DSN, db_app_dsn=APP_DSN, jwt_secret=JWT_SECRET
            )


    def test_db_child_cds_reader_environment_parsing(
        self, clean_env: None, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("COUNSELLE_DB_RO_DSN", RO_DSN)
        monkeypatch.setenv("COUNSELLE_DATA_CATALOG_REFRESH_SECONDS", "90")
        monkeypatch.setenv("COUNSELLE_QUERY_DATABASE_MAX_BYTES", "8192")
        monkeypatch.setenv("COUNSELLE_SUPPORTED_PACKET_EXTRACTOR_VERSIONS", "v7,v8")

        child = DbChildSettings()  # type: ignore[call-arg]

        assert child.data_catalog_refresh_seconds == 90
        assert child.query_database_max_bytes == 8192
        assert child.supported_packet_extractor_versions == frozenset({"v7", "v8"})

    def test_viz_and_source_caps_load_from_the_settings_environment(
        self, clean_env: None, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("COUNSELLE_VIZ_MAX_CELLS", "321")
        monkeypatch.setenv("COUNSELLE_SOURCE_EVIDENCE_MAX_ITEMS", "27")
        settings = EnvFileFreeSettings(
            db_ro_dsn=RO_DSN,
            db_app_dsn=APP_DSN,
            jwt_secret=JWT_SECRET,
        )
        assert settings.viz_max_cells == 321
        assert settings.source_evidence_max_items == 27
        # Sources
        assert settings.tavily_api_key is None
        assert settings.source_web_default is True
        assert settings.source_reddit_default is True
        assert settings.source_edu_default is True
        assert settings.search_max_results == 5
        # GCP
        assert settings.google_cloud_project is None
        assert settings.google_cloud_location == "us-central1"
        # API
        assert settings.api_host == "127.0.0.1"
        assert settings.api_port == 8000
        assert settings.cors_origins == []  # 06-L1: default-empty (prod same-origin)
        assert settings.sse_keepalive_s == 15
        assert settings.agent_stream_buffer_size == 100_000
        assert settings.agent_turn_timeout_s == 3600
        assert settings.agent_mcp_read_timeout_s == 60.0
        assert settings.agent_tool_result_max_chars == 8_000
        assert settings.protocol_version == 1
        assert settings.workspace_event_queue_size == 256
        assert settings.workspace_writes_per_minute == 240
        assert settings.document_summary_excerpt_max_chars == 8_000
        assert settings.document_summary_timeout_s == 8.0
        assert settings.document_extraction_timeout_s == 8.0
        # Chat / auth knobs promoted in Phase 6
        assert settings.thinking_threshold_chars == 240  # CFG-07
        assert settings.password_min_length == 8  # CFG-03
        # Observability
        assert settings.log_level == "INFO"
        assert settings.usage_accounting is True
        # Assets
        assert settings.assets_dir.name == "assets"
        assert settings.assets_dir.is_dir()

    def test_thinking_stream_reads_new_env(
        self, clean_env: None, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("COUNSELLE_THINKING_STREAM", "false")
        settings = EnvFileFreeSettings(
            db_ro_dsn=RO_DSN, db_app_dsn=APP_DSN, jwt_secret=JWT_SECRET
        )

        assert settings.thinking_stream is False
        assert settings.thinking_summaries is None
        assert settings.effective_thinking_stream is False

    def test_deprecated_thinking_summaries_env_overrides_for_compatibility(
        self, clean_env: None, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("COUNSELLE_THINKING_STREAM", "true")
        monkeypatch.setenv("COUNSELLE_THINKING_SUMMARIES", "false")
        settings = EnvFileFreeSettings(
            db_ro_dsn=RO_DSN, db_app_dsn=APP_DSN, jwt_secret=JWT_SECRET
        )

        assert settings.thinking_stream is True
        assert settings.thinking_summaries is False
        assert settings.effective_thinking_stream is False


class TestTavilyKeyAlias:
    def test_settings_reads_bare_tavily_env(
        self, clean_env: None, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """DS-05: the bare TAVILY_API_KEY (no COUNSELLE_ prefix) populates the
        field via the validation alias — no .env-file hand-parser needed."""
        monkeypatch.delenv("TAVILY_API_KEY", raising=False)
        monkeypatch.setenv("TAVILY_API_KEY", "tvly-bare-env-key")
        settings = EnvFileFreeSettings(
            db_ro_dsn=RO_DSN, db_app_dsn=APP_DSN, jwt_secret=JWT_SECRET
        )
        assert settings.tavily_api_key == "tvly-bare-env-key"

    def test_settings_reads_prefixed_tavily_env(
        self, clean_env: None, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The prefixed COUNSELLE_TAVILY_API_KEY still works via the alias."""
        monkeypatch.delenv("TAVILY_API_KEY", raising=False)
        monkeypatch.setenv("COUNSELLE_TAVILY_API_KEY", "tvly-prefixed-key")
        settings = EnvFileFreeSettings(
            db_ro_dsn=RO_DSN, db_app_dsn=APP_DSN, jwt_secret=JWT_SECRET
        )
        assert settings.tavily_api_key == "tvly-prefixed-key"


class TestSecretMasking:
    def test_repr_and_str_mask_dsn_passwords_and_api_key(self, clean_env: None) -> None:
        settings = EnvFileFreeSettings(
            db_ro_dsn=RO_DSN,
            db_app_dsn=APP_DSN,
            jwt_secret=JWT_SECRET,
            tavily_api_key="tvly-super-secret-key",
        )
        for rendered in (repr(settings), str(settings)):
            assert "ro-s3cret-pw" not in rendered
            assert "app-s3cret-pw" not in rendered
            assert "tvly-super-secret-key" not in rendered
            assert JWT_SECRET not in rendered  # jwt_secret is masked too
            # The masked DSN still shows scheme + host for debuggability.
            assert "postgresql://***@localhost" in rendered


class TestYamlAssets:
    """Pin the four asset schemas — any accidental reshape must fail here."""

    def test_subreddit_menu_schema(self, dsn_env: None) -> None:
        menu = load_yaml_asset("subreddit_menu")
        assert isinstance(menu, list)
        assert len(menu) == 6
        for entry in menu:
            assert isinstance(entry, dict)
            assert set(entry) == {"sub", "label"}
            assert isinstance(entry["sub"], str) and entry["sub"]
            assert isinstance(entry["label"], str) and entry["label"]
        subs = [entry["sub"] for entry in menu]
        assert "ApplyingToCollege" in subs
        assert "{school}" in subs  # the template slot the agent fills in

    def test_season_calendar_covers_all_twelve_months_in_eight_phases(self, dsn_env: None) -> None:
        calendar = load_yaml_asset("season_calendar")
        assert isinstance(calendar, list)
        assert len(calendar) == 8
        covered: list[int] = []
        for window in calendar:
            assert set(window) == {"months", "phase", "description", "entering_class"}
            months = window["months"]
            assert set(months) == {"start", "end"}
            assert 1 <= months["start"] <= months["end"] <= 12  # never wraps the year
            covered.extend(range(months["start"], months["end"] + 1))
            assert isinstance(window["phase"], str) and window["phase"]
            assert isinstance(window["description"], str) and window["description"]
            assert window["entering_class"] in {"next_fall", "this_fall"}
        # Every month exactly once: full coverage, no overlap.
        assert sorted(covered) == list(range(1, 13))
        # Pin the entering-class rule at the boundaries: Jun–Dec → next fall's
        # entering class, Jan–May → this fall's (ARCHITECTURE §16).
        by_month = {
            month: window
            for window in calendar
            for month in range(window["months"]["start"], window["months"]["end"] + 1)
        }
        assert by_month[6]["entering_class"] == "next_fall"
        assert by_month[12]["entering_class"] == "next_fall"
        assert by_month[1]["entering_class"] == "this_fall"
        assert by_month[5]["entering_class"] == "this_fall"

    def test_dossier_shortlist_sections_a_to_f_and_coa_fallback(self, dsn_env: None) -> None:
        shortlist = load_yaml_asset("dossier_shortlist")
        sections = shortlist["sections"]
        assert [section["id"] for section in sections] == ["A", "B", "C", "D", "E", "F"]
        for section in sections:
            assert isinstance(section["title"], str) and section["title"]
            assert isinstance(section["fields"], list) and section["fields"]
            for field in section["fields"]:
                assert set(field) <= {"key", "note", "fallback"}
                assert isinstance(field["key"], str) and "." in field["key"]
        # The §13.7 COA trap: room_and_board must carry its sibling fallback.
        cost_aid = next(section for section in sections if section["id"] == "B")
        room_and_board = next(
            field for field in cost_aid["fields"] if field["key"] == "cost.room_and_board"
        )
        assert room_and_board["fallback"] == "cost.on_campus_room_board_other"

    def test_abbreviations_schema(self, dsn_env: None) -> None:
        abbreviations = load_yaml_asset("abbreviations")
        assert isinstance(abbreviations, dict)
        assert len(abbreviations) >= 20
        assert all(
            isinstance(abbr, str) and isinstance(full, str) and full
            for abbr, full in abbreviations.items()
        )
        assert abbreviations["MIT"] == "Massachusetts Institute of Technology"


class TestLoadPrompt:
    def test_missing_prompt_raises_file_not_found(self, dsn_env: None) -> None:
        with pytest.raises(FileNotFoundError):
            load_prompt("no-such-prompt")


class TestConfigCacheReset:
    """The asset loaders key on ``name`` only but read ``assets_dir`` — without a
    coupled reset they serve stale assets after an assets_dir change (audit L4)."""

    def _write_prompt(self, root: Path, name: str, body: str) -> Path:
        prompts = root / "prompts"
        prompts.mkdir(parents=True, exist_ok=True)
        (prompts / f"{name}.md").write_text(body, encoding="utf-8")
        return root

    def test_reset_returns_fresh_assets_after_assets_dir_change(
        self, dsn_env: None, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        first = self._write_prompt(tmp_path / "a", "greeting", "from-A")
        monkeypatch.setenv("COUNSELLE_ASSETS_DIR", str(first))
        reset_config_caches()
        assert load_prompt("greeting") == "from-A"

        # Point assets_dir at a different tree with a different value for the same
        # name. Without a coupled reset, the name-keyed cache would serve "from-A".
        second = self._write_prompt(tmp_path / "b", "greeting", "from-B")
        monkeypatch.setenv("COUNSELLE_ASSETS_DIR", str(second))

        # Stale-by-name: the assets cache alone still holds the old value.
        assert load_prompt("greeting") == "from-A"

        # The coupled reset clears get_settings too, so assets_dir is re-read.
        reset_config_caches()
        assert load_prompt("greeting") == "from-B"
