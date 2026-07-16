"""The single typed configuration surface for Counselle (ADR 0018).

One ``Settings`` object, loaded once via :func:`get_settings`, validated fail-fast:
a missing or malformed value kills boot with one aggregated, readable error.
Layering: code defaults -> ``.env`` / environment (``COUNSELLE_`` prefix) -> explicit
overrides. Editorial content (prompts, menus, shortlists, calendars) lives in
``config/assets/`` and is loaded through :func:`load_prompt` / :func:`load_yaml_asset`.

Google credentials ride the standard unprefixed ``GOOGLE_APPLICATION_CREDENTIALS``
environment variable and are deliberately NOT a Settings field (see ``.env.example``).

Never log Settings values: ``repr()``/``str()`` mask DSNs and API keys, but the live
attributes hold real secrets.
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any, Literal
from urllib.parse import urlsplit

import yaml
from pydantic import AliasChoices, Field, ValidationError, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

_ENV_PREFIX = "COUNSELLE_"
_DEFAULT_ASSETS_DIR = Path(__file__).parent / "assets"
DEFAULT_DB_STATEMENT_TIMEOUT_MS = 8000
DEFAULT_DB_POOL_MIN = 1
DEFAULT_DB_POOL_MAX = 5

#: A JWT signing secret shorter than this is rejected (pyjwt 2.13 warns below 32).
_MIN_JWT_SECRET_BYTES = 32

#: Fields whose values must never appear unmasked in repr/str/logs.
_SECRET_FIELDS = frozenset(
    {
        "db_ro_dsn",
        "db_app_dsn",
        "tavily_api_key",
        "vertex_api_key",
        "jwt_secret",
        "google_oauth_client_secret",
        "oauth_state_secret",
    }
)


class DbChildSettings(BaseSettings):
    """Minimal settings surface for the credential-isolated DB MCP child."""

    model_config = SettingsConfigDict(env_file=None, env_prefix=_ENV_PREFIX, extra="ignore")

    db_ro_dsn: str
    db_statement_timeout_ms: int = DEFAULT_DB_STATEMENT_TIMEOUT_MS
    db_row_cap: int = Field(default=500, gt=0)
    query_database_max_bytes: int = Field(default=262_144, gt=0)
    data_catalog_refresh_seconds: int = Field(default=3600, gt=0)
    supported_packet_extractor_versions: Annotated[frozenset[str], NoDecode] = frozenset(
        {
            "gemini-native-pdf-v2",
            "gemini-native-pdf-v5",
            "gemini-routed-extraction-v7",
            "gemini-routed-extraction-v8",
        }
    )
    db_pool_min: int = DEFAULT_DB_POOL_MIN
    db_pool_max: int = DEFAULT_DB_POOL_MAX
    log_level: str = "INFO"

    @field_validator("supported_packet_extractor_versions", mode="before")
    @classmethod
    def _parse_supported_extractors(cls, value: Any) -> Any:
        if isinstance(value, str):
            value = frozenset(part.strip() for part in value.split(","))
        if not value or any(
            not isinstance(part, str) or not part or part != part.strip() for part in value
        ):
            raise ValueError("extractor versions must be nonempty exact strings")
        return frozenset(value)


@lru_cache(maxsize=1)
def get_db_child_settings() -> DbChildSettings:
    return DbChildSettings()  # type: ignore[call-arg]


class AssetSettings(BaseSettings):
    """Minimal settings surface for packaged editorial assets.

    Asset readers are used by the credential-isolated DB child, so resolving an
    asset path must not instantiate the unrelated application settings surface.
    """

    model_config = SettingsConfigDict(env_file=".env", env_prefix=_ENV_PREFIX, extra="ignore")

    assets_dir: Path = _DEFAULT_ASSETS_DIR

    def __init__(self, **values: Any) -> None:
        if os.environ.get("COUNSELLE_SETTINGS_NO_ENV_FILE") == "1":
            values.setdefault("_env_file", None)
        super().__init__(**values)


@lru_cache(maxsize=1)
def get_asset_settings() -> AssetSettings:
    return AssetSettings()


def _mask_secret(name: str, value: str) -> str:
    """Mask a secret for display: DSNs show scheme + host only, keys show ``***``."""
    if name.endswith("_dsn"):
        parts = urlsplit(value)
        if parts.scheme and parts.hostname:
            return f"{parts.scheme}://***@{parts.hostname}"
        return "***"
    return "***"


class Settings(BaseSettings):
    """Every deploy- or cost-relevant knob, in one place (ADR 0018, ARCHITECTURE §18)."""

    model_config = SettingsConfigDict(env_file=".env", env_prefix=_ENV_PREFIX, extra="ignore")

    def __init__(self, **values: Any) -> None:
        # The DB-only MCP subprocess is started in the repository root.  Without
        # this explicit opt-out pydantic-settings would reload the repository
        # .env and defeat the transport's credential allowlist.
        if os.environ.get("COUNSELLE_SETTINGS_NO_ENV_FILE") == "1":
            values.setdefault("_env_file", None)
        super().__init__(**values)

    # --- Models ---
    model_counselor: str = "google-vertex:gemini-2.5-pro"
    model_cheap: str = "google-vertex:gemini-2.5-flash"
    model_clarifier: str = "google-vertex:gemini-2.5-flash"
    # B4 auto-titles: the cheap model that names a chat from its first exchange
    # (one no-tools call, fire-and-forget; failure leaves the derived default).
    model_title: str = "google-vertex:gemini-2.5-flash"
    agent_max_model_requests: int = 80
    agent_max_total_tokens: int = 2_000_000
    # Native provider thought output. Gemini exposes this through
    # include_thoughts; it is the rawest trace Google exposes through the API,
    # not private internal CoT tokens. Counselle displays that provider output
    # byte-for-byte when enabled.
    thinking_stream: bool = True
    # Deprecated one-release compatibility env/name. If
    # COUNSELLE_THINKING_SUMMARIES is set, it overrides thinking_stream so
    # existing deployments keep their expected behavior.
    thinking_summaries: bool | None = None

    # --- Chat (B4) ---
    title_max_len: int = 60  # cap for both the derived default and the model title
    # Chars of buffered response text below which pre-tool-call text routes to
    # `thinking` vs streaming live as `delta` (the live-timeline editorial dial,
    # §27.2). Tune against real model chunking. (CFG-07)
    thinking_threshold_chars: int = 240

    # --- Rate limiting (B4: in-process sliding windows; api/ratelimit.py) ---
    # Per-user message caps; each message send spends a token.
    turns_per_hour: int = 60
    turns_per_day: int = 300
    # Per-IP auth caps (login + forgot-password) — password-brute / reset-spam guard.
    auth_attempts_per_window: int = 10
    auth_window_seconds: int = 60

    # --- Database ---
    db_ro_dsn: str  # pipeline DB, counselle_ro role (read-only) — required
    db_app_dsn: str  # counselle.* schema (sessions, users, workspace) — required
    db_statement_timeout_ms: int = DEFAULT_DB_STATEMENT_TIMEOUT_MS
    db_row_cap: int = Field(default=500, gt=0)
    query_database_max_bytes: int = Field(default=262_144, gt=0)
    data_catalog_refresh_seconds: int = Field(default=3600, gt=0)
    supported_packet_extractor_versions: Annotated[frozenset[str], NoDecode] = frozenset(
        {
            "gemini-native-pdf-v2",
            "gemini-native-pdf-v5",
            "gemini-routed-extraction-v7",
            "gemini-routed-extraction-v8",
        }
    )
    viz_max_cells: int = Field(default=600, gt=0)
    source_evidence_max_items: int = Field(default=50, gt=0)
    db_pool_min: int = DEFAULT_DB_POOL_MIN
    db_pool_max: int = DEFAULT_DB_POOL_MAX

    # --- Sessions ---
    checkpointer: Literal["postgres", "memory"] = "postgres"
    session_ttl_days: int | None = None  # None = keep everything

    # --- Discovery ---

    # --- Sources ---
    # Required only when any external source is enabled. The validation_alias makes
    # BOTH COUNSELLE_TAVILY_API_KEY and the bare TAVILY_API_KEY populate this field
    # through the single Settings surface (DS-05) — no second config reader. With
    # env_prefix="COUNSELLE_", validation_alias overrides the prefix for THIS field
    # only (verified against pydantic-settings 2.14).
    tavily_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("COUNSELLE_TAVILY_API_KEY", "TAVILY_API_KEY"),
    )
    source_web_default: bool = True
    source_reddit_default: bool = True
    source_edu_default: bool = True
    search_max_results: int = 5

    # --- GCP ---
    # Auth: the pipeline's Vertex express-mode API key (genai.Client(vertexai=True,
    # api_key=...)) — mirrored from the pipeline repo. Service-account auth via the
    # standard GOOGLE_APPLICATION_CREDENTIALS var also works (documented in
    # .env.example); the API key wins when both are set.
    vertex_api_key: str | None = None
    google_cloud_project: str | None = None
    google_cloud_location: str = "us-central1"

    # --- API ---
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    # Prod: empty (same-origin serving, ADR 0023); dev sets its own origin via env
    # (the split-origin Vite setup runs the SPA on :5173). Default-empty is the
    # fail-safe — a prod deploy never accidentally ships a localhost CORS allowance.
    cors_origins: list[str] = Field(default_factory=list)  # 06-L1
    sse_keepalive_s: int = 15
    # --- Turn registry (B2: detached turns, reattach, cancel) ---
    # Ring-buffer capacity in events, sized to a full worst-case turn so
    # overflow is effectively unreachable (a consumer that still falls off the
    # head is terminated with an `error` event — never silently skipped).
    agent_stream_buffer_size: int = 100_000
    # Process-wide byte budget shared across EVERY live turn's ring buffer.
    # The real OOM guard: agent_stream_buffer_size bounds one turn's event COUNT,
    # this bounds the TOTAL bytes held by all in-flight buffers. When a new
    # event would push the global total over budget, the oldest events across
    # the appending buffer are evicted (head-only) — a consumer that then
    # falls off the head is terminated honestly with an `error` (BC-05/06).
    # 256 MiB default ≈ comfortably below a 512 MiB–1 GiB container; tune per
    # deploy. The accumulator lives on the TurnRegistry and is decremented on
    # eviction and at finalize.
    stream_buffer_bytes: int = 256 * 1024 * 1024
    # Bound each partial-persist DB round so a wedged DB at cancel/timeout
    # can't hold the single-flight session claim forever (BC-08). On timeout
    # the partial is lost (logged) but the turn still finalizes + frees the
    # claim — a stuck DB never permanently 409s a session.
    persist_partial_timeout_s: float = 5.0
    # Watchdog: a turn exceeding this terminates with `error` (G5 — never
    # done(cancelled): the student didn't press stop), partial persisted.
    agent_turn_timeout_s: int = 3600
    agent_mcp_read_timeout_s: float = 60.0
    agent_tool_result_max_chars: int = 8_000
    # GET /v1/sessions/{id}/stream reattach endpoint (off → always 204).
    reattach_enabled: bool = True
    # Global backstop on concurrent detached turns across all sessions — a
    # memory-exhaustion guard (over the cap → 503). Per-user caps + rate
    # limiting are B4; this is only the process-wide ceiling.
    max_concurrent_turns: int = 50
    # Per-turn consumer ceiling: how many streams may attach to one turn's
    # ring buffer at once (over the cap → 429). A cheap abuse guard.
    max_consumers_per_turn: int = 8
    # Frozen constant: the SSE event-protocol version (ADR 0016). Re-exported from
    # domain/ in Phase 1; bump only with an architecture discussion.
    protocol_version: int = 1

    # --- Workspace ---
    workspace_event_queue_size: int = 256
    workspace_writes_per_minute: int = 240
    # Fall enrollment year visibly preselected when adding a school. The user
    # still submits it explicitly; this is never a database default/backfill.
    current_admissions_cycle_year: int = Field(default=2027, ge=2000, le=2200)
    # Document summaries are optional list metadata, not a second document
    # store. Bound both source exposure and upload latency independently.
    document_summary_excerpt_max_chars: int = 8_000
    document_summary_timeout_s: float = 8.0
    # PDF/DOCX parsing (pypdf/python-docx) runs twice per upload (validate then
    # extract) off the event loop via asyncio.to_thread; a crafted small file can
    # decompress to gigabytes or pathologically stall the shared thread pool
    # (decompression-bomb DoS). Bounded the same way as the summary model call.
    document_extraction_timeout_s: float = 8.0

    # --- Auth (B3, ADR 0021) ---
    # REQUIRED: the JWT signing secret (≥32 bytes — pyjwt 2.13 warns below).
    jwt_secret: str
    cookie_name: str = "counselle_auth"
    cookie_secure: bool = False  # True in prod via env (HTTPS only)
    jwt_lifetime_seconds: int = 60 * 60 * 24 * 30  # 30 days, no refresh (locked)
    google_oauth_client_id: str | None = None
    google_oauth_client_secret: str | None = None
    # DS-09: falls back to jwt_secret (see property) — DEV-ONLY. Production MUST
    # set a distinct COUNSELLE_OAUTH_STATE_SECRET so a JWT-secret rotation/leak
    # doesn't also compromise OAuth CSRF state (key-reuse coupling).
    oauth_state_secret: str | None = None
    oauth_redirect_url: str = "/"  # where the OAuth callback 302s the SPA
    password_min_length: int = 8  # the password-policy floor (CFG-03; security knob)

    # --- Email (B3) ---
    email_provider: Literal["console"] = "console"
    email_from: str = "noreply@counselle.app"

    @field_validator("jwt_secret")
    @classmethod
    def _jwt_secret_long_enough(cls, value: str) -> str:
        if len(value.encode("utf-8")) < _MIN_JWT_SECRET_BYTES:
            raise ValueError(
                f"must be at least {_MIN_JWT_SECRET_BYTES} bytes (pyjwt 2.13 warns below)"
            )
        return value

    @field_validator("supported_packet_extractor_versions", mode="before")
    @classmethod
    def _parse_supported_extractors(cls, value: Any) -> Any:
        if isinstance(value, str):
            value = frozenset(part.strip() for part in value.split(","))
        if not value or any(
            not isinstance(part, str) or not part or part != part.strip() for part in value
        ):
            raise ValueError("extractor versions must be nonempty exact strings")
        return frozenset(value)

    @property
    def effective_oauth_state_secret(self) -> str:
        """The OAuth CSRF state secret — falls back to jwt_secret when unset.

        DEV-ONLY fallback (DS-09): production MUST set a distinct
        COUNSELLE_OAUTH_STATE_SECRET; reusing the JWT secret couples two crypto
        purposes (session JWTs + OAuth CSRF state) into one blast radius.
        """
        return self.oauth_state_secret or self.jwt_secret

    @property
    def google_oauth_configured(self) -> bool:
        """True when both Google OAuth client credentials are present."""
        return bool(self.google_oauth_client_id and self.google_oauth_client_secret)

    # --- Observability ---
    log_level: str = "INFO"
    usage_accounting: bool = True
    # Per-model token prices (USD per 1 M tokens): {model_name: (input, output)}.
    # Vertex AI list prices as of 2025-Q3 — est only, no billing guarantee.
    model_prices: dict[str, tuple[float, float]] = Field(
        default_factory=lambda: {
            "gemini-2.5-pro": (1.25, 10.0),  # est only — Vertex list price
            "gemini-2.5-flash": (0.30, 2.50),  # est only — Vertex list price
        }
    )

    # --- Assets ---
    assets_dir: Path = _DEFAULT_ASSETS_DIR

    @property
    def effective_thinking_stream(self) -> bool:
        """Whether native provider thought output should be requested."""
        return self.thinking_stream if self.thinking_summaries is None else self.thinking_summaries

    def __repr__(self) -> str:
        """Repr with secrets masked — safe to print, still never log it routinely."""
        rendered: list[str] = []
        for name in type(self).model_fields:
            value = getattr(self, name)
            if name in _SECRET_FIELDS and isinstance(value, str):
                rendered.append(f"{name}={_mask_secret(name, value)!r}")
            else:
                rendered.append(f"{name}={value!r}")
        return f"Settings({', '.join(rendered)})"

    __str__ = __repr__


def serialize_db_child_environment(
    settings: DbChildSettings | Settings, *, uv_cache_dir: str | None = None
) -> dict[str, str]:
    """Serialize only the credential-isolated DB child's typed settings."""
    child = DbChildSettings(
        **{name: getattr(settings, name) for name in DbChildSettings.model_fields}
    )
    values = child.model_dump(mode="json")
    env = {
        "COUNSELLE_DB_RO_DSN": child.db_ro_dsn,
        "COUNSELLE_SETTINGS_NO_ENV_FILE": "1",
    }
    for field, value in values.items():
        if field == "db_ro_dsn":
            continue
        serialized = ",".join(sorted(value)) if isinstance(value, list) else str(value)
        env[f"COUNSELLE_{field.upper()}"] = serialized
    if uv_cache_dir is not None:
        env["UV_CACHE_DIR"] = uv_cache_dir
    return env


@lru_cache
def get_settings() -> Settings:
    """Load and cache the Settings, failing fast with one aggregated, readable error."""
    try:
        # Required fields (the DSNs) arrive via the environment, which mypy can't see.
        return Settings()
    except ValidationError as exc:
        lines = ["Invalid Counselle configuration — fix the following and restart:"]
        for error in exc.errors():
            field = ".".join(str(part) for part in error["loc"])
            env_var = f"{_ENV_PREFIX}{field.upper()}"
            lines.append(f"  - {env_var}: {error['msg']}")
        raise RuntimeError("\n".join(lines)) from exc


# NOTE: get_asset_settings/load_prompt/load_yaml_asset caches are coupled — the
# asset loaders key on `name` only, so clearing one without the others would serve
# stale assets after an assets_dir change. Always clear them together via
# reset_config_caches() (audit L4); never clear only one of these caches.
@lru_cache
def load_prompt(name: str) -> str:
    """Load an agent prompt from ``config/assets/prompts/<name>.md`` (ADR 0018)."""
    path = get_asset_settings().assets_dir / "prompts" / f"{name}.md"
    return path.read_text(encoding="utf-8")


@lru_cache
def load_yaml_asset(name: str) -> Any:
    """Load and parse a versioned data asset from ``config/assets/<name>.yaml``."""
    path = get_asset_settings().assets_dir / f"{name}.yaml"
    with path.open(encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def reset_config_caches() -> None:
    """Clear the application and coupled asset configuration caches together."""
    get_settings.cache_clear()
    get_asset_settings.cache_clear()
    load_prompt.cache_clear()
    load_yaml_asset.cache_clear()
