"""Tests for the Settings surface and asset loaders (config/settings.py, ADR 0018)."""

import os
from collections.abc import Iterator
from pathlib import Path
from typing import Any, cast

import pytest
from pydantic_settings import SettingsConfigDict

from config.settings import (
    AssetSettings,
    Settings,
    get_settings,
    load_prompt,
    load_yaml_asset,
    reset_config_caches,
)

RO_DSN = "postgresql://counselle_ro:ro-s3cret-pw@localhost:5432/counselle_data_test"
APP_DSN = "postgresql://counselle_app:app-s3cret-pw@localhost:5432/counselle_data_test"
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
    """Strip every settings input that could make an isolation test ambient."""
    for key in list(os.environ):
        if key.startswith("COUNSELLE_"):
            monkeypatch.delenv(key)
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)


def test_asset_settings_do_not_require_application_secrets(
    clean_env: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("COUNSELLE_SETTINGS_NO_ENV_FILE", "1")
    assets = AssetSettings()
    assert assets.assets_dir.name == "assets"
    assert not hasattr(assets, "db_app_dsn")
    assert not hasattr(assets, "jwt_secret")


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
        live = "fireworks:accounts/fireworks/models/deepseek-v4p1-flash"
        assert settings.model_counselor == live
        assert settings.model_counselor_think == live
        assert settings.model_cheap == live
        assert settings.model_title == live
        assert settings.model_counselor_display_name == "DeepSeek V4.1 Flash"
        assert settings.model_counselor_think_display_name == "DeepSeek V4.1 Flash · Thinking"
        assert settings.model_counselor_think_preview is False
        assert settings.reasoning_effort_quick == "low"
        assert settings.reasoning_effort_think == "high"
        assert settings.reasoning_effort_cheap == "none"
        assert settings.fireworks_api_key is None
        assert settings.agent_model_retry_attempts == 3
        assert settings.agent_max_model_requests == 80
        assert settings.agent_max_total_tokens == 2_000_000
        assert settings.thinking_stream is False
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
        assert settings.supported_packet_extractor_versions == frozenset(
            {
                "gemini-native-pdf-v2",
                "gemini-native-pdf-v5",
                "gemini-routed-extraction-v7",
                "gemini-routed-extraction-v8",
                "counselle-cds-v1",
                "human-review-v1",
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


    def test_viz_and_source_caps_load_from_the_settings_environment(
        self, clean_env: None, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("COUNSELLE_VIZ_MAX_CELLS", "321")
        settings = EnvFileFreeSettings(
            db_ro_dsn=RO_DSN,
            db_app_dsn=APP_DSN,
            jwt_secret=JWT_SECRET,
        )
        assert settings.viz_max_cells == 321
        # Sources
        assert settings.tavily_api_key is None
        assert settings.source_web_default is True
        assert settings.source_reddit_default is True
        assert settings.source_edu_default is True
        assert settings.search_max_results == 8
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
        assert settings.agent_tool_result_max_chars == 20_000
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

    def test_thinking_stream_reads_env(
        self, clean_env: None, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("COUNSELLE_THINKING_STREAM", "true")
        settings = EnvFileFreeSettings(
            db_ro_dsn=RO_DSN, db_app_dsn=APP_DSN, jwt_secret=JWT_SECRET
        )

        assert settings.thinking_stream is True

    def test_zero_retry_attempts_fails_boot(self, clean_env: None) -> None:
        with pytest.raises(ValueError):
            EnvFileFreeSettings(
                db_ro_dsn=RO_DSN,
                db_app_dsn=APP_DSN,
                jwt_secret=JWT_SECRET,
                agent_model_retry_attempts=0,
            )


class TestLiveModelPrefix:
    """ADR 0043: every live model is Fireworks; a misconfigured env fails at
    boot, never mid-turn."""

    @pytest.mark.parametrize(
        "field",
        [
            "model_counselor",
            "model_counselor_think",
            "model_cheap",
            "model_title",
            "goal_model",
            "model_goal_judge",
            "model_goal_criteria",
        ],
    )
    def test_non_fireworks_live_model_fails_boot(self, clean_env: None, field: str) -> None:
        with pytest.raises(ValueError, match=field):
            EnvFileFreeSettings(
                db_ro_dsn=RO_DSN,
                db_app_dsn=APP_DSN,
                jwt_secret=JWT_SECRET,
                **cast(dict[str, Any], {field: "google-vertex:gemini-2.5-flash"}),
            )

    def test_unpriced_live_model_fails_boot(self, clean_env: None) -> None:
        with pytest.raises(ValueError, match="model_prices"):
            EnvFileFreeSettings(
                db_ro_dsn=RO_DSN,
                db_app_dsn=APP_DSN,
                jwt_secret=JWT_SECRET,
                model_goal_judge="fireworks:accounts/fireworks/models/unpriced",
            )

    def test_empty_fallback_fields_and_parked_cds_models_are_not_checked(
        self, clean_env: None
    ) -> None:
        settings = EnvFileFreeSettings(
            db_ro_dsn=RO_DSN,
            db_app_dsn=APP_DSN,
            jwt_secret=JWT_SECRET,
            goal_model="",
            model_goal_judge="",
            model_goal_criteria="",
            model_cds_extract="google-vertex:gemini-3.1-flash-lite",
            model_cds_detect="google-vertex:gemini-3.1-flash-lite",
        )
        assert settings.goal_model == ""
        assert settings.model_cds_extract == "google-vertex:gemini-3.1-flash-lite"


class TestFactsCrawlSettings:
    """ADR 0038 R0's identification mitigation: a User-Agent with no contact
    URL must never boot (plan §4.3)."""

    def test_defaults_match_plan_section_4_3(self, clean_env: None) -> None:
        settings = EnvFileFreeSettings(db_ro_dsn=RO_DSN, db_app_dsn=APP_DSN, jwt_secret=JWT_SECRET)

        assert settings.facts_crawl_rps == 1.0
        assert settings.facts_crawl_concurrency == 1
        assert settings.facts_crawl_request_timeout_s == 20.0
        assert settings.facts_crawl_user_agent == "CounselleBot/1.0 (+https://<domain>/bot)"
        assert settings.facts_crawl_max_build_rotations == 3

    def test_user_agent_with_no_url_fails_boot(
        self, clean_env: None, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("COUNSELLE_FACTS_CRAWL_USER_AGENT", "CounselleBot/1.0")

        with pytest.raises(ValueError, match="contact URL"):
            EnvFileFreeSettings(db_ro_dsn=RO_DSN, db_app_dsn=APP_DSN, jwt_secret=JWT_SECRET)

    def test_user_agent_with_a_url_boots(
        self, clean_env: None, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv(
            "COUNSELLE_FACTS_CRAWL_USER_AGENT", "CounselleBot/1.0 (+https://counselle.ai/bot)"
        )

        settings = EnvFileFreeSettings(db_ro_dsn=RO_DSN, db_app_dsn=APP_DSN, jwt_secret=JWT_SECRET)

        assert settings.facts_crawl_user_agent == "CounselleBot/1.0 (+https://counselle.ai/bot)"

    def test_nonpositive_crawl_knobs_fail_boot(
        self, clean_env: None, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("COUNSELLE_FACTS_CRAWL_RPS", "0")

        with pytest.raises(ValueError):
            EnvFileFreeSettings(db_ro_dsn=RO_DSN, db_app_dsn=APP_DSN, jwt_secret=JWT_SECRET)

    def test_max_response_bytes_default_and_boot_gate(self, clean_env: None) -> None:
        settings = EnvFileFreeSettings(db_ro_dsn=RO_DSN, db_app_dsn=APP_DSN, jwt_secret=JWT_SECRET)
        assert settings.facts_crawl_max_response_bytes == 20_000_000

    def test_nonpositive_max_response_bytes_fails_boot(
        self, clean_env: None, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("COUNSELLE_FACTS_CRAWL_MAX_RESPONSE_BYTES", "0")

        with pytest.raises(ValueError):
            EnvFileFreeSettings(db_ro_dsn=RO_DSN, db_app_dsn=APP_DSN, jwt_secret=JWT_SECRET)

    def test_placeholder_user_agent_boots_fine_in_development(self, clean_env: None) -> None:
        """The documented placeholder is fine in `development` — nothing
        actually crawls there, and `FetchConfig` (adapters/collegedata/
        fetch.py) independently refuses to construct itself on the
        placeholder regardless of environment, so this is not a live gap."""
        settings = EnvFileFreeSettings(db_ro_dsn=RO_DSN, db_app_dsn=APP_DSN, jwt_secret=JWT_SECRET)
        assert settings.environment == "development"
        assert settings.facts_crawl_user_agent == "CounselleBot/1.0 (+https://<domain>/bot)"

    def test_placeholder_user_agent_fails_boot_outside_development(
        self, clean_env: None, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """school-data-v3 fix-review Finding 1: an operator who deploys
        outside `development` without setting
        COUNSELLE_FACTS_CRAWL_USER_AGENT must never boot clean — that was
        the "most natural mistake" that silently defeated ADR 0038 R0's
        identification mitigation."""
        monkeypatch.setenv("COUNSELLE_ENVIRONMENT", "staging")
        monkeypatch.setenv("COUNSELLE_COOKIE_SECURE", "true")
        monkeypatch.setenv("COUNSELLE_PASSWORD_RESET_ENABLED", "false")

        with pytest.raises(ValueError, match="placeholder"):
            EnvFileFreeSettings(db_ro_dsn=RO_DSN, db_app_dsn=APP_DSN, jwt_secret=JWT_SECRET)

    def test_real_user_agent_boots_outside_development(
        self, clean_env: None, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("COUNSELLE_ENVIRONMENT", "staging")
        monkeypatch.setenv("COUNSELLE_COOKIE_SECURE", "true")
        monkeypatch.setenv("COUNSELLE_PASSWORD_RESET_ENABLED", "false")
        monkeypatch.setenv(
            "COUNSELLE_FACTS_CRAWL_USER_AGENT", "CounselleBot/1.0 (+https://counselle.ai/bot)"
        )
        monkeypatch.setenv("COUNSELLE_FIREWORKS_API_KEY", "fw-test-key")

        settings = EnvFileFreeSettings(db_ro_dsn=RO_DSN, db_app_dsn=APP_DSN, jwt_secret=JWT_SECRET)

        assert settings.facts_crawl_user_agent == "CounselleBot/1.0 (+https://counselle.ai/bot)"

    def test_missing_fireworks_key_fails_boot_outside_development(
        self, clean_env: None, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("COUNSELLE_ENVIRONMENT", "staging")
        monkeypatch.setenv("COUNSELLE_COOKIE_SECURE", "true")
        monkeypatch.setenv("COUNSELLE_PASSWORD_RESET_ENABLED", "false")
        monkeypatch.setenv(
            "COUNSELLE_FACTS_CRAWL_USER_AGENT", "CounselleBot/1.0 (+https://counselle.ai/bot)"
        )

        with pytest.raises(ValueError, match="fireworks_api_key"):
            EnvFileFreeSettings(db_ro_dsn=RO_DSN, db_app_dsn=APP_DSN, jwt_secret=JWT_SECRET)


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
            fireworks_api_key="fw-super-secret-key",
        )
        for rendered in (repr(settings), str(settings)):
            assert "ro-s3cret-pw" not in rendered
            assert "app-s3cret-pw" not in rendered
            assert "tvly-super-secret-key" not in rendered
            assert "fw-super-secret-key" not in rendered
            assert JWT_SECRET not in rendered  # jwt_secret is masked too
            # The masked DSN still shows scheme + host for debuggability.
            assert "postgresql://***@localhost" in rendered


class TestYamlAssets:
    """Pin the four asset schemas — any accidental reshape must fail here."""

    def test_subreddit_menu_schema(self, dsn_env: None) -> None:
        menu = load_yaml_asset("subreddit_menu")
        assert isinstance(menu, list)
        assert len(menu) == 13
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
