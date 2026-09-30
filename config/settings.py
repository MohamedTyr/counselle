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
import re
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any, Literal
from urllib.parse import urlsplit

import yaml
from pydantic import (
    AliasChoices,
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

_ENV_PREFIX = "COUNSELLE_"
_DEFAULT_ASSETS_DIR = Path(__file__).parent / "assets"
DEFAULT_DB_STATEMENT_TIMEOUT_MS = 8000
DEFAULT_DB_POOL_MIN = 1
DEFAULT_DB_POOL_MAX = 5

#: A JWT signing secret shorter than this is rejected (pyjwt 2.13 warns below 32).
_MIN_JWT_SECRET_BYTES = 32

#: The documented, never-real `facts_crawl_user_agent` placeholder (ADR 0038
#: R0 Finding 1). Shared by both `facts_crawl_user_agent` validators below;
#: also duplicated (by necessity, see the validators' docstrings) in
#: `adapters/collegedata/fetch.py`.
_FACTS_CRAWL_UA_PLACEHOLDER_MARKER = "<domain>"

#: The only provider prefix a live model setting may carry (ADR 0043).
#: `app/llm.py::build_model` constructs these; the validator below rejects
#: anything else at boot so a misconfigured env never fails mid-turn.
FIREWORKS_MODEL_PREFIX = "fireworks:"

#: The default live model for every role (ADR 0043): the only serverless
#: DeepSeek on Fireworks. Roles differ only in reasoning effort.
_DEFAULT_LIVE_MODEL = "fireworks:accounts/fireworks/models/deepseek-v4p1-flash"

#: Live model fields checked by the prefix validator. `""` values fall back to
#: `model_cheap` and are skipped; the parked CDS `model_cds_*` fields are not
#: live and are never checked.
_LIVE_MODEL_FIELDS = (
    "model_counselor",
    "model_counselor_think",
    "model_cheap",
    "model_title",
    "goal_model",
    "model_goal_judge",
    "model_goal_criteria",
)

#: How hard a DeepSeek call reasons. The model reasons by default, so every
#: call sends one of these explicitly.
ReasoningEffort = Literal["none", "low", "medium", "high"]

#: Fields whose values must never appear unmasked in repr/str/logs.
_SECRET_FIELDS = frozenset(
    {
        "db_ro_dsn",
        "db_app_dsn",
        "db_pipeline_dsn",
        "tavily_api_key",
        "fireworks_api_key",
        "vertex_api_key",
        "jwt_secret",
        "google_oauth_client_secret",
        "oauth_state_secret",
    }
)


class AssetSettings(BaseSettings):
    """Minimal settings surface for packaged editorial assets.

    Resolving an asset path must not instantiate the unrelated application
    settings surface.
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


class ModelPriceTier(BaseModel):
    """USD-per-1M-token rates for one model, with an optional long-context tier.

    A long-context tier applies to ALL tokens once input context
    exceeds ``long_context_threshold_tokens`` — it is not incremental pricing
    on the overage alone. All three long-context fields are set together or
    left ``None`` together; a model with a uniform price omits
    them.
    """

    model_config = ConfigDict(frozen=True)

    input_per_1m: float
    output_per_1m: float
    long_context_input_per_1m: float | None = None
    long_context_output_per_1m: float | None = None
    long_context_threshold_tokens: int | None = None


class Settings(BaseSettings):
    """Every deploy- or cost-relevant knob, in one place (ADR 0018, ARCHITECTURE §18)."""

    model_config = SettingsConfigDict(env_file=".env", env_prefix=_ENV_PREFIX, extra="ignore")

    def __init__(self, **values: Any) -> None:
        # Tests that build Settings from explicit env vars need to opt out of
        # pydantic-settings' default .env reload, or the repository .env would
        # silently override the values the test just set.
        if os.environ.get("COUNSELLE_SETTINGS_NO_ENV_FILE") == "1":
            values.setdefault("_env_file", None)
        super().__init__(**values)

    # --- Models ---
    model_counselor: str = _DEFAULT_LIVE_MODEL
    # Think mode's model (plans/quick-think-response-mode.md §3.2). Kept
    # configurable so it can change without touching turn-lifecycle code.
    model_counselor_think: str = _DEFAULT_LIVE_MODEL
    model_counselor_display_name: str = "DeepSeek V4.1 Flash"
    model_counselor_think_display_name: str = "DeepSeek V4.1 Flash · Thinking"
    model_counselor_think_preview: bool = False
    # Reasoning effort per role (ADR 0043). Quick and Think counselor turns
    # (and goal turns started in each) use the first two; titles and document
    # summaries use `cheap`.
    reasoning_effort_quick: ReasoningEffort = "low"
    reasoning_effort_think: ReasoningEffort = "high"
    reasoning_effort_cheap: ReasoningEffort = "none"
    # The roles that define and decide a goal: the criteria writer and the
    # judge. At `none`/`low` the writer padded or restated criteria; at `high`
    # it matched Gemini (evals/goal_judge/REPORT-20260930-deepseek.md). One
    # call per goal (writer) and one per round (judge), so the cost is small.
    reasoning_effort_goal: ReasoningEffort = "high"
    # Honest-disable switch: remove Think from GET /v1/config response_modes
    # without silently remapping it to Flash (plan §14 Emergency disable).
    response_mode_think_enabled: bool = True
    model_cheap: str = _DEFAULT_LIVE_MODEL
    # B4 auto-titles: the cheap model that names a chat from its first exchange
    # (one no-tools call, fire-and-forget; failure leaves the derived default).
    model_title: str = _DEFAULT_LIVE_MODEL
    # CDS admin pipeline (plan §B4/§E): the one-shot, no-tool, schema-constrained
    # PDF extraction call, and the cheap per-file school+year detection call.
    model_cds_extract: str = "google-vertex:gemini-3.1-flash-lite"
    # Gemini thinking budget for the CDS extraction call. 0 disables thinking
    # (the current and default behaviour, byte-identical to before this
    # setting existed); -1 is the provider's automatic budget; a positive
    # integer is an explicit token budget.
    model_cds_extract_thinking_budget: int = 0
    # Extra thinking budget for the few batches whose hints put them in
    # `app/cds/manifest.py`'s `DELIBERATION_HINTS` set (currently just H14,
    # the checkbox-grid selection-state metrics) -- 0 means "use
    # model_cds_extract_thinking_budget for every batch, same as before this
    # setting existed". The deliberation those batches need costs ~$0.09 on
    # a single call; paying it on the ~20 other batches per document as well
    # (a global thinking budget) blew the per-document cost ceiling for zero
    # measured accuracy gain on those other batches.
    model_cds_extract_deliberation_budget: int = 0
    # Empty means "use model_cds_extract_deliberation_budget instead". When
    # set, this takes precedence for deliberation-hinted batches: measured on
    # gemini-3.1-flash-lite, thinking_budget behaves as a discrete TIER
    # SELECTOR on this model rather than an allowance -- 8192, 32768, and -1
    # all produced the exact same 62,914 thought tokens on the same batch,
    # busting the cost floor. thinking_level exposes cheaper tiers the
    # budget field cannot reach.
    #
    # HIGH is the shipped default: it is the configuration the tuning corpus
    # measured at 99.01% accuracy / 97.26% coverage across 5 documents, versus
    # ~96.9% with deliberation off. It buys that accuracy at ~$0.21/doc and
    # ~410s/doc, both above the tuning targets ($0.15, 360s) -- a deliberate
    # trade, because a wrong value shown to a student costs more than a slow
    # cheap one (AGENTS.md principle 3). Set to "" to fall back to
    # model_cds_extract_deliberation_budget and trade accuracy for cost.
    model_cds_extract_deliberation_level: str = "HIGH"
    model_cds_detect: str = "google-vertex:gemini-3.1-flash-lite"
    # Transport-level retry for every live model call, as TOTAL attempts
    # (first try included). `app/llm.py::build_model` passes `attempts - 1`
    # to the openai SDK as `max_retries`. The SDK retries only 408/409/429/5xx
    # and connection/timeout errors -- never a blanket retry, so a genuine
    # 400/401/403 still surfaces immediately.
    agent_model_retry_attempts: int = Field(default=3, gt=0)
    agent_max_model_requests: int = 80
    # Focused Answer (the default response mode) on the chat surface may call
    # tools in this many model requests; the next request has no function
    # tools and must answer from what was gathered (`app/tool_budget.py`).
    focused_answer_max_tool_rounds: int = Field(default=4, gt=0)
    # ...and may run this many searches (web, a school's site, Reddit) in all.
    focused_answer_max_searches: int = Field(default=2, ge=0)
    agent_max_total_tokens: int = 2_000_000

    # --- Compaction (also closes plans/agent-loop-hardening.md §1) ---
    # `ClearToolResults` (pydantic-ai-harness==0.4.0, D3) is mounted for EVERY
    # turn, goal or not (D11, plans/goal-mode-plan.md §4.2/§4.4) — cheap,
    # zero-LLM, in-place blanking of old tool results. The `goal_compaction_*`
    # knobs configure the goal-only `SummarizingCompaction` tier behind it.
    compaction_clear_tool_results_after_messages: int = Field(default=40, ge=1)
    compaction_clear_tool_keep_pairs: int = Field(default=3, ge=0)
    compaction_min_clear_tokens: int = Field(default=20_000, ge=0)  # OpenCode's PRUNE_MINIMUM
    # The token budget a goal turn escalates on: above it the cheap tier runs
    # again and, if that is not enough, a summary is paid for. It is the whole
    # headroom knob — a separate "reserve" subtracted from it would only ever
    # be equivalent to setting it lower, so there is one number, not two.
    # MUST stay < 200_000 (price cliff)
    goal_compaction_target_tokens: int = Field(default=100_000, gt=0)
    goal_compaction_keep_tokens: int = Field(default=8_000, ge=0)  # OpenCode's DEFAULT_KEEP_TOKENS

    # --- Goal mode (plans/goal-mode-plan.md §2.10; Phase 2 knobs. The
    # compaction_*/goal_compaction_* knobs above shipped in Phase 1;
    # goal_max_concurrent_turns ships in Phase 3. This is the single source
    # of truth for which phase ships which knob.) ---
    goal_model: str = ""  # "" => model_cheap (D15). Resolved through
    # app/model_selection.py, the SAME ADR 0011 seam as
    # model_goal_judge/model_goal_criteria — not inline in agent_node, so
    # all three stay consistent. (Consumed by Phase 3's agent construction.)
    goal_max_cost_usd: float = Field(default=3.00, gt=0)  # THE primary budget
    # (D14), but a SOFT one: UsageLimits understands requests/tokens, not
    # dollars, so this is enforced as a projection checked before each
    # iteration, by Phase 3's GoalLoopController — a single unusually
    # expensive iteration can overshoot it before the next checkpoint fires.
    goal_max_model_requests: int = Field(default=90, gt=0)  # DERIVED: at
    # model_cheap ($0.30 in / $1.20 out) and a ~55k average context, 90
    # requests ~ 4.95M input + ~72k output ~ $1.57 - about 48% headroom under
    # the $3.00 cap for reasoning tokens and the judge, criteria, and wrap-up
    # calls. Re-derive whenever goal_model, its price, or
    # the cap moves. Passed to pydantic-ai's own `UsageLimits` per SEGMENT
    # (an `ask_student` pause starts a fresh `UsageLimits`, unlike cost/
    # iterations/wall-clock, which carry across the pause via the ledger) —
    # these two are the library's per-run safety stops, not the run's
    # budget; the cost cap above is what a resumed run is actually judged
    # against end to end.
    goal_max_total_tokens: int = Field(default=10_000_000, gt=0)  # backstop
    # ONLY, sized so cost genuinely binds first: $3.00 at model_cheap's
    # $0.30/1M input is ~10M input-equivalent tokens. Also per-segment, same
    # reason as goal_max_model_requests above.
    goal_max_iterations: int = Field(default=6, gt=0)  # judge rounds
    goal_wrapup_reserve_requests: int = Field(default=3, ge=0)
    goal_max_wall_clock_s: float = Field(default=3600.0, gt=0)  # 60 min,
    # inside goal_turn_timeout_s
    goal_turn_timeout_s: int = Field(default=5400, gt=0)  # 90 min watchdog
    # (vs 3600 normal)
    goal_stall_iterations: int = Field(default=2, gt=0)
    goal_max_consecutive_tool_errors: int = Field(default=3, gt=0)
    goal_judge_retries: int = Field(default=2, ge=0)  # then stopped_check_failed (C12)
    # "" => model_cheap. A cheap-tier judge is the model MOST vulnerable to
    # verbosity/padding attacks (R2, plans/goal-mode-plan.md §7.1) — raising
    # this to a stronger tier than the agent is a live owner option (§9(b)),
    # made a config change rather than a rewrite by this knob existing.
    model_goal_judge: str = ""
    model_goal_criteria: str = ""  # "" => model_cheap
    goal_max_criteria: int = Field(default=6, gt=0)
    goal_judge_evidence_max_chars: int = Field(
        default=30_000, gt=0
    )  # §3.3 — bounded, was unbounded

    # Whether the model's own reasoning text is streamed to the student as
    # `thinking` events. Off by default (ADR 0043): DeepSeek returns raw chain
    # of thought -- speculative, with uncited numbers -- not a summary, and a
    # student reading it beside a cited answer would take the guess as fact.
    # The model reasons either way; this only gates what is shown.
    thinking_stream: bool = False

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
    # The third DSN (plan §C3): cds_library_app role, INSERT/SELECT/UPDATE on the
    # cds_library.* base tables. Optional — the app boots fine whether this is
    # unset or set-but-unreachable, and the CDS admin surface returns a clean
    # 503 until it is configured.
    db_pipeline_dsn: str | None = None
    db_statement_timeout_ms: int = DEFAULT_DB_STATEMENT_TIMEOUT_MS
    db_row_cap: int = Field(default=500, gt=0)
    query_database_max_bytes: int = Field(default=262_144, gt=0)
    data_catalog_refresh_seconds: int = Field(default=3600, gt=0)
    # Hard cap on request bodies the API accepts (document uploads, etc.).
    # Default = app.workspace.models.DOCUMENT_MAX_BYTES (15 MiB) + 1 MiB of
    # multipart framing headroom (boundaries, part headers). Replaces the
    # parked cds_upload_max_bytes as the middleware-level limit — a route's
    # own limit (e.g. the document upload cap) still applies first and is
    # what the user-facing 413 message names (plan §4.3).
    max_request_body_bytes: int = Field(default=16_777_216, gt=0)
    # --- CollegeData facts store (school-data-v3) ---
    # In-process crawl-pass worker kill switch — mirrors cds_worker_enabled's
    # shape. Defaults false: a brand-new crawler against a third-party site
    # must be switched on deliberately after staging verification. The real
    # worker (adapters/collegedata, app/facts/jobs.py) lands in Phase 1; this
    # name only needs to exist so boot never fails on a missing setting.
    facts_worker_enabled: bool = False
    # Days since a school's last successful facts crawl before its data is
    # flagged stale (the `stale_facts` caveat, and the data picture's stale
    # count — counselle_db.catalog.Catalog reads this at every load, so it is
    # a real Phase 0 consumer even though the crawler itself ships in Phase 1).
    facts_stale_days: int = Field(default=120, gt=0)
    # The shared token-bucket rate for adapters/collegedata/fetch.py's
    # CollegeDataFetcher — one request per (1 / facts_crawl_rps) seconds,
    # shared across facts_crawl_concurrency schools in flight (plan §4.1/
    # §4.3; ADR 0038 R0's rate-limit mitigation). 1 req/s, not 2 (Q9).
    facts_crawl_rps: float = Field(default=1.0, gt=0)
    # How many schools app/facts/crawl.py is *designed* to run
    # concurrently against the same shared token bucket above — 1 means
    # requests are strictly sequential (plan §4.1). NOT YET CONSUMED: the
    # current app/facts/crawl.py loop always processes schools sequentially
    # and never reads this field (school-data-v3 fix-review finding #4) —
    # actual behavior is more conservative than this setting's name implies,
    # never less. Kept rather than deleted because the plan's crawl-duration
    # math (plan §4.1: "~4.3h at 1 req/s") and the shared-token-bucket design
    # both name it as the real crawl-pass orchestration knob; wire it into
    # app/facts/crawl.py when concurrent scheduling is actually built,
    # rather than re-adding the setting from scratch.
    facts_crawl_concurrency: int = Field(default=1, gt=0)
    # Per-request httpx timeout, seconds (adapters/collegedata/fetch.py).
    facts_crawl_request_timeout_s: float = Field(default=20.0, gt=0)
    # The truthful, self-identifying User-Agent every collegedata.com
    # request carries (ADR 0038 R0's identification mitigation) — boot-
    # validated below to contain a contact URL and to not still be the
    # documented `<domain>` placeholder. Consumed by
    # adapters/collegedata/fetch.py's FetchConfig, which independently
    # refuses the placeholder too (so a real crawl can never proceed on it
    # even if Settings itself boots with the placeholder in `development`).
    facts_crawl_user_agent: str = Field(
        default="CounselleBot/1.0 (+https://<domain>/bot)", min_length=1
    )
    # How many distinct Next.js buildId rotations adapters/collegedata/
    # fetch.py's CollegeDataFetcher tolerates in one crawl pass before
    # raising BuildIdRotationLimitExceeded (plan §4.1) — app/facts/crawl.py
    # closes the pass as 'aborted' when this is exceeded.
    facts_crawl_max_build_rotations: int = Field(default=3, gt=0)
    # Hard ceiling on any single fetched response body from collegedata.com
    # (after gunzip, if applicable) — adapters/collegedata/fetch.py is the
    # one module ingesting raw third-party HTTP content (CLAUDE.md: "never
    # trust external data"), so every fetch path (robots.txt, sitemap XML,
    # per-tab JSON) enforces this before handing bytes to a parser. Real
    # traffic is far below this (plan §4.1: the whole ~15,522-request pass
    # moves ~100 MB combined; no single response is more than a few MB) —
    # this is a safety floor against a malformed/adversarial response, not a
    # tuning knob for legitimate traffic.
    facts_crawl_max_response_bytes: int = Field(default=20_000_000, gt=0)
    # How often the in-process poller (app/facts/jobs.py) sweeps
    # expired leases / checks for claimable work / runs the daily enqueue
    # tick when idle — mirrors cds_worker_poll_seconds's shape.
    facts_worker_poll_seconds: int = Field(default=30, gt=0)
    # A facts_jobs claim's lease window (claim/renew/sweep, plan §4.2/§4.3) —
    # ~180s = three renewals at facts_worker_poll_seconds/3, covering worker
    # liveness, never the pass duration itself.
    facts_crawl_lease_seconds: int = Field(default=180, gt=0)
    # How often a new crawl_pass is auto-enqueued (the idempotent daily
    # enqueue tick, plan §4.2/appendix J-iii) — read only by the SQL
    # statement in app/facts/jobs.py, never a Python timer.
    facts_crawl_interval_hours: int = Field(default=24, gt=0)
    # observed_at_spread's "compared at different times" threshold (days) —
    # much tighter than facts_stale_days (120): two facts on the same
    # school observed more than this many days apart get a spread caveat.
    # Not yet consumed by any Phase 1 module; Phase 2's caveat renderer
    # reads it (plan §4.3) — declared here so the name exists at boot.
    facts_spread_days: int = Field(default=30, gt=0)
    # Consecutive per-page fetch failures before a page is skipped for the
    # rest of the pass (plan §4.1 "stuck pages") — app/facts/crawl.py.
    facts_failure_threshold: int = Field(default=3, gt=0)
    # How many page_snapshots rows adapters/facts_store.py keeps per
    # (school_id, tab), newest first, pruning the rest in-pass (plan §3.4).
    facts_snapshot_retention_per_page: int = Field(default=3, gt=0)
    # `adapters/facts_store.py.retire_absent_slugs`'s safety ceiling
    # (school-data-v3 fix review): above `facts_retirement_min_floor` live
    # `collegedata_schools` rows, a single pass refuses to retire more than
    # this fraction of them rather than silently mass-retiring the
    # crosswalk (a `previous_run_started_at` bug once retired all 2,587
    # live rows in one pass, unnoticed).
    facts_retirement_max_fraction: float = Field(default=0.10, gt=0, le=1)
    # Below this many live `collegedata_schools` rows,
    # `facts_retirement_max_fraction` is not enforced at all -- a fresh,
    # small, or test crosswalk legitimately retiring "most" or "all" of a
    # handful of rows is not a bug.
    facts_retirement_min_floor: int = Field(default=50, ge=0)
    # crawl_runs.unmapped_label_count above this raises the
    # facts_crawl_shape_drift error at end-of-pass (plan §4.2).
    facts_unmapped_alert_threshold: int = Field(default=50, gt=0)
    # How many recent crawl_runs app/facts/service_admin.py's
    # FactsStatusResponse.history returns (plan §4.3/§5.5).
    facts_admin_history_limit: int = Field(default=20, gt=0)
    # Cap on FactsStatusResponse.unmapped_labels (plan §4.3/§5.5) — also the
    # size of the bounded, frequency-sorted sample crawl_runs.unmapped_labels
    # stores at end of pass.
    facts_admin_unmapped_limit: int = Field(default=200, gt=0)
    # --- Facts page + Explore (school-data-v3 Phase 2) ---
    # counselle_db.service.get_facts's row cap for a *narrowing* call (a
    # `sections=`/`keys=` argument was not given). Not yet consumed: the
    # Phase 2 HTTP facts route always calls get_facts unfiltered for the
    # whole page (no narrowing, no cap — a page is 200-260 facts, well under
    # the 150 KB budget); this cap exists for the Phase 3 agent tool, whose
    # `get_facts(unitid)` with neither `sections` nor `keys` must stay small
    # enough to be a useful default rather than a whole-school dump.
    get_facts_max_rows: int = Field(default=60, gt=0)
    # GET /v1/schools/explore's default and max page size (plan §5.3's
    # request model; "Load more" appends pages of this size, Q18).
    facts_explore_page_size: int = Field(default=24, gt=0)
    facts_explore_max_page_size: int = Field(default=100, gt=0)
    # Hard ceiling on ExploreResponse.total (plan §5.3) — must exceed the
    # real browsable universe (~2,300-2,400 schools) so it never binds on a
    # real corpus; it exists only as a runaway guard against a future
    # filter bug that matches everything.
    facts_explore_max_count: int = Field(default=3000, gt=0)
    # The sign-in reset notice (plan §5.6, Q14): the date the `counselle`
    # schema was last rebuilt, surfaced by the unauthenticated
    # GET /v1/config/public for AuthLayout's dismissible notice. `None`
    # (the default) means no notice renders — this field was documented in
    # .env.example once before any consumer existed (TODOS.md) and was
    # removed rather than left describing dead behavior; it is re-added
    # here together with its consumer (api/routes/config.py's
    # GET /v1/config/public and, on the frontend, AuthLayout).
    db_reset_notice_date: date | None = None
    # How many days after db_reset_notice_date the notice keeps rendering.
    db_reset_notice_days: int = Field(default=30, gt=0)
    # parked (ADR 0036) — read only by the parked adapters/cds_store.py.
    supported_packet_extractor_versions: Annotated[frozenset[str], NoDecode] = frozenset(
        {
            "gemini-native-pdf-v2",
            "gemini-native-pdf-v5",
            "gemini-routed-extraction-v7",
            "gemini-routed-extraction-v8",
            "counselle-cds-v1",
            "human-review-v1",
        }
    )
    viz_max_cells: int = Field(default=600, gt=0)
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
    search_max_results: int = 8
    # Reddit is where volume converts into a *pattern*: one anecdote is noise,
    # a recurring signal across many posts is evidence. It gets a higher cap
    # than web/.edu so archetype and reputation questions can triangulate.
    reddit_max_results: int = 12

    # --- Model provider ---
    # Fireworks (ADR 0043): the provider for every live model call. Required
    # outside development; in development `app/llm.py::build_model` raises on
    # first use, so the routine suite never needs a key.
    fireworks_api_key: str | None = None

    # --- GCP ---
    # Read only by the parked CDS extraction system (ADR 0038, PARKED.md).
    # Auth: an optional Vertex Express-mode API key. When it is unset, the Google
    # SDK discovers Application Default Credentials (ADC) from the environment.
    vertex_api_key: str | None = None
    google_cloud_project: str | None = None
    google_cloud_location: str = "us-central1"

    # --- API ---
    environment: Literal["development", "recording", "staging"] = "development"
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    # Prod: empty (same-origin serving, ADR 0023); dev sets its own origin via env
    # (the split-origin Vite setup runs the SPA on :5173). Default-empty is the
    # fail-safe — a prod deploy never accidentally ships a localhost CORS allowance.
    cors_origins: list[str] = Field(default_factory=list)  # 06-L1
    serve_spa: bool = False
    spa_dist_dir: Path = Path("frontend/dist")
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
    # A result over this spills to a handle the model must read back, which
    # costs a whole model round. Sized so one compact `get_facts` section
    # (about 15k characters) comes back inline.
    agent_tool_result_max_chars: int = 20_000
    # GET /v1/sessions/{id}/stream reattach endpoint (off → always 204).
    reattach_enabled: bool = True
    # Global backstop on concurrent detached turns across all sessions — a
    # memory-exhaustion guard (over the cap → 503). Per-user caps + rate
    # limiting are B4; this is only the process-wide ceiling.
    max_concurrent_turns: int = 50
    # A goal turn can hold a slot (and a disproportionate share of the shared
    # stream_buffer_bytes pool) for up to goal_turn_timeout_s — far longer
    # than an ordinary turn. A separate, tighter ceiling on how many may run
    # at once, checked alongside max_concurrent_turns in the same synchronous
    # claim window (plans/goal-mode-plan.md §2.12, R10).
    goal_max_concurrent_turns: int = 5
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
    # Ceiling on the essay markdown inlined into the essay-surface system prompt
    # (Surface.ESSAY). ~1,300 words — generous headroom over any real essay
    # limit, so it only bites on a pasted-in outlier; past it the prompt says
    # the text is truncated and points the model at read_essay.
    essay_context_max_chars: int = Field(default=8_000, gt=0)

    # --- CDS admin pipeline (parked, ADR 0036/0038 — D8) ---
    # In-process asyncio poller kill switch — all queue state lives in
    # cds_extractions (Postgres), so flipping this off just stops new claims.
    # Defaults false under school-data-v3: the CDS extraction pipeline is
    # parked, and COUNSELLE_DB_PIPELINE_DSN now drives the facts crawler —
    # this must never be true wherever that DSN is used for facts (the
    # untouched poller would otherwise spin forever against the dropped
    # cds_extractions table). See PARKED.md.
    cds_worker_enabled: bool = False
    # How often the poller checks for a claimable extraction when idle.
    cds_worker_poll_seconds: int = 3
    # Concurrent extraction runs (bounded so the shared event loop/thread pool
    # never starves student chat traffic — ADR 0023, one deployable).
    cds_worker_concurrency: int = 3
    # Lease duration on a claimed cds_extractions row; renewed at lease/3 while
    # running, swept to failed/worker_lost by recover_expired() after expiry.
    cds_extraction_lease_seconds: int = 900
    # Per-model-call timeout for a single extraction/detection request.
    cds_model_timeout_seconds: int = 180
    # Hard cap on one uploaded CDS PDF, bytes.
    cds_upload_max_bytes: int = 50_000_000

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
    auth_self_signup_enabled: bool = True
    password_reset_enabled: bool = True
    # PATCH /v1/me `settings` jsonb ceiling. `AsyncpgUserDatabase.get` (SELECT *)
    # re-reads and json-decodes this column on every authenticated request (the
    # auth dependency), so an unbounded blob taxes the whole db_pool_max=5 pool,
    # not just the one PATCH. Shipped keys (theme, default_source_config,
    # onboarding) run low hundreds of bytes; 64 KB leaves ample headroom.
    user_settings_max_bytes: int = Field(default=64_000, gt=0)

    # --- Email (B3) ---
    email_provider: Literal["console"] = "console"
    email_from: str = "noreply@counselle.app"

    @model_validator(mode="after")
    def _validate_deploy_auth_posture(self) -> Settings:
        if self.environment != "development":
            if self.password_reset_enabled and self.email_provider == "console":
                raise ValueError(
                    "password_reset_enabled cannot use the console email provider "
                    "outside development"
                )
            if not self.cookie_secure:
                raise ValueError("cookie_secure must be true outside development")
            if _FACTS_CRAWL_UA_PLACEHOLDER_MARKER in self.facts_crawl_user_agent:
                # Finding 1 (school-data-v3 fix review): the documented
                # `<domain>` placeholder resolves to nothing — an operator
                # who deploys without setting COUNSELLE_FACTS_CRAWL_USER_AGENT
                # would otherwise boot clean and silently defeat ADR 0038
                # R0's identification mitigation the moment a crawl runs.
                # Deliberately placed here (a model validator gated on
                # `environment`), not in `_facts_crawl_user_agent_has_contact_url`
                # above: see that validator's docstring for why a stricter
                # per-field check would instead fail every Settings() call,
                # in every environment, including routine local dev and the
                # test suite.
                raise ValueError(
                    "facts_crawl_user_agent is still the documented '<domain>' "
                    "placeholder — set COUNSELLE_FACTS_CRAWL_USER_AGENT to your "
                    "own real, reachable contact URL before deploying outside "
                    "development (ADR 0038 R0)"
                )
            if not self.fireworks_api_key:
                raise ValueError(
                    "fireworks_api_key must be set outside development — every "
                    "live model call goes to Fireworks (ADR 0043)"
                )
        return self

    @model_validator(mode="after")
    def _validate_live_models(self) -> Settings:
        # Every live model is a Fireworks model with a price: an unpriced model
        # would cost $0 in the goal ledger and `goal_max_cost_usd` would never
        # bind.
        for field in _LIVE_MODEL_FIELDS:
            value = getattr(self, field)
            if not value:
                continue
            if not value.startswith(FIREWORKS_MODEL_PREFIX):
                raise ValueError(
                    f"{field}={value!r} must start with {FIREWORKS_MODEL_PREFIX!r} "
                    "— Fireworks is the only supported live provider (ADR 0043)"
                )
            if value.removeprefix(FIREWORKS_MODEL_PREFIX) not in self.model_prices:
                raise ValueError(
                    f"{field}={value!r} has no model_prices entry — add one keyed "
                    f"{value.removeprefix(FIREWORKS_MODEL_PREFIX)!r}"
                )
        return self

    @field_validator("facts_crawl_user_agent")
    @classmethod
    def _facts_crawl_user_agent_has_contact_url(cls, value: str) -> str:
        # ADR 0038 R0's identification mitigation: the fetcher must always
        # be truthfully self-identifying with a reachable contact URL.
        # Shared logic lives in adapters.collegedata.fetch (this module
        # cannot import adapters/ without inverting ADR 0017's layering, so
        # the one-line rule is duplicated there rather than imported here).
        #
        # This deliberately does NOT also reject the documented `<domain>`
        # placeholder the way `adapters.collegedata.fetch.FetchConfig`'s
        # equivalent validator does: unlike a plain `BaseModel`,
        # `pydantic-settings` runs field validators against a field's own
        # *default* value too (verified — not the plain-Pydantic behavior
        # most validators assume), so a stricter check here would fail
        # every Settings() construction, in every environment, the moment
        # nobody overrides this one field — breaking local dev and most of
        # the test suite. `_validate_deploy_auth_posture` below carries the
        # placeholder-specific check instead, gated to fire only outside
        # `development`, exactly like the cookie_secure/password_reset
        # checks it already makes.
        if not re.search(r"https?://\S+", value):
            raise ValueError(
                "facts_crawl_user_agent must contain a contact URL (http:// or https://)"
            )
        return value

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
    # Per-model token prices (USD per 1 M tokens), keyed by the bare model
    # name — see ModelPriceTier / estimate_cost in app/usage.py. DeepSeek V4.1
    # Flash is priced at the highest Global rate Fireworks publishes
    # (serverless-pricing doc, 2026-09-29) until the account price is
    # confirmed. There is no cached-input rate, so cached tokens are
    # overcounted: the goal budget binds earlier, never later.
    model_prices: dict[str, ModelPriceTier] = Field(
        default_factory=lambda: {
            "accounts/fireworks/models/deepseek-v4p1-flash": ModelPriceTier(
                input_per_1m=0.30, output_per_1m=1.20
            ),
        }
    )

    # --- Assets ---
    assets_dir: Path = _DEFAULT_ASSETS_DIR

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
    # Deferred import: `app/facts/crosswalk.py`'s CSV loader is the one
    # non-`config/assets/` file cache this function also owns (plan §2/§4.6)
    # — imported here, not at module load, so `config/` (read by every
    # layer) never has a static import of `app/` (ADR 0017 layering).
    from app.facts.crosswalk import load_crosswalk

    load_crosswalk.cache_clear()
