# Phase 0 — Repo bootstrap

**Branch:** `feat/p0-bootstrap` (created after `git init` + an initial `main` commit containing the existing docs and this plan).
**Objective:** a running, empty-but-real project: package layout per ARCHITECTURE §5, the complete Settings surface, the data-asset skeletons, logging, tooling, Containerfile. Nothing clever — pure scaffolding, but *complete* scaffolding so later phases never touch infrastructure.

## Inputs for builder agents
- `docs/ARCHITECTURE.md` §4 (layering), §5 (repo layout), §18 (configuration), §19 (observability), §20 (deployment).
- This file.

## Step 0 (orchestrator, before any agent): git
```bash
cd ~/Projects/counselle
git init -b main
printf '%s\n' '.env' '__pycache__/' '*.pyc' '.pytest_cache/' '.mypy_cache/' '.ruff_cache/' '.venv/' 'dist/' '*.egg-info/' > .gitignore
git add .gitignore CLAUDE.md PRD.md docs/ plans/
git commit -m "docs: PRD, architecture, ADRs, database guide, MVP1 implementation plan"
git switch -c feat/p0-bootstrap
```
(The initial docs commit on `main` is the one exception to the user-gate — it contains only the documents the user already approved. Confirm with the user anyway before running it.)

## Work breakdown (slices)

### Slice A — project + tooling (one agent)
1. `uv init --package --python 3.12` shaped to this layout (flat packages at repo root, configured via `[tool.uv]`/`[project]` in `pyproject.toml`; package name `counselle`).
2. `uv add`: `pydantic`, `pydantic-settings`, `structlog`, `pyyaml`. `uv add --dev`: `pytest`, `pytest-asyncio`, `anyio`, `ruff`, `mypy`, `types-pyyaml`. (Later phases add their own deps — do not pre-add agent/db/api libraries here.)
3. Create the package directories exactly per ARCHITECTURE §5, each with `__init__.py`:
   `config/`, `config/assets/prompts/`, `domain/`, `app/`, `adapters/`, `api/`, `counselle_db/`, `skills/`, `migrations/`, `evals/`, `harness/`, `tests/` (with `tests/domain/`, `tests/counselle_db/`, `tests/api/`).
4. `pyproject.toml` tool config:
   - ruff: line-length 100, `select = ["E","F","I","UP","B","SIM"]`.
   - mypy: `strict = true` for `domain.*`; `ignore_missing_imports = true` globally.
   - pytest: `asyncio_mode = "auto"`, testpaths `tests`.
5. `Containerfile`: `FROM python:3.12-slim`, install uv, copy project, `uv sync --frozen`, `CMD ["uv", "run", "uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]`. (api.main exists from Phase 5; the Containerfile is written now and simply won't be built until then.)
6. `README.md`: one screen — what Counselle is, how to run tests, pointer to docs/plan.

### Slice B — Settings (one agent; THE config surface, ADR 0018)
`config/settings.py` — a single `Settings(BaseSettings)` with `env_prefix="COUNSELLE_"`, `.env` loading, and **fail-fast**: module exposes `get_settings()` (cached) that raises a clear, aggregated error listing every missing/invalid field. Groups and fields (types; defaults in parens; `…` = required, no default):

- **Models:** `model_counselor: str` ("google-vertex:gemini-2.5-pro"), `model_cheap: str` ("google-vertex:gemini-2.5-flash"), `model_clarifier: str` ("google-vertex:gemini-2.5-flash"), `max_tool_rounds: int` (12 — the agent tool-loop bound, eng-review).
- **Database:** `db_ro_dsn: str` (…), `db_app_dsn: str` (…), `db_statement_timeout_ms: int` (8000), `db_row_cap: int` (500), `db_pool_min: int` (1), `db_pool_max: int` (5).
- **Sessions:** `checkpointer: Literal["postgres","memory"]` ("postgres"), `session_ttl_days: int | None` (None = keep everything).
- **Discovery:** `embed_model: str` ("gemini-embedding-001"), `embed_dimensions: int` (768), `reconcile_interval_minutes: int` (20), `vector_search_enabled: bool` (True).
- **Sources:** `tavily_api_key: str | None` (None — required only when any external source is enabled), `source_web_default: bool` (True), `source_reddit_default: bool` (True), `source_edu_default: bool` (True), `search_max_results: int` (5).
- **GCP:** `google_cloud_project: str | None`, `google_cloud_location: str` ("us-central1") — credentials themselves ride the standard `GOOGLE_APPLICATION_CREDENTIALS` var (not prefixed; document in `.env.example`).
- **API:** `api_host: str` ("127.0.0.1"), `api_port: int` (8000), `cors_origins: list[str]` (["http://localhost:8000"]), `sse_keepalive_s: int` (15), `protocol_version: int` (1, frozen const re-exported from domain).
- **Observability:** `log_level: str` ("INFO"), `usage_accounting: bool` (True).
- **Assets:** `assets_dir: Path` (repo `config/assets`), plus loader helpers `load_prompt(name) -> str`, `load_yaml_asset(name) -> Any` (with `@lru_cache`).

`.env.example`: every variable above with its default and a one-line comment; secrets blank. **Never** print settings values in logs (write a `repr` that masks DSNs/keys).

### Slice C — assets + logging (one agent)
1. `config/assets/subreddit_menu.yaml` — the labeled menu (ARCHITECTURE §14):
   ```yaml
   - sub: ApplyingToCollege
     label: general admissions process, deadlines, culture
   - sub: chanceme
     label: chances/profile discussions (vibe only, never odds)
   - sub: financialaid
     label: aid, FAFSA, net price experiences
   - sub: premed
     label: pre-med tracks
   - sub: csMajors
     label: CS programs, recruiting
   - sub: "{school}"
     label: "school-specific campus life — agent substitutes the likely subreddit name (best-effort)"
   ```
2. `config/assets/season_calendar.yaml` — the 8 phase windows from ARCHITECTURE §16 (month ranges → phase name, description, entering-class rule: phases Jun–Dec map to entering class = next calendar year's fall +1 as documented; encode exactly the table in §16).
3. `config/assets/dossier_shortlist.yaml` — sections A–F with the full field-key lists **copied verbatim from `docs/DATABASE_GUIDE.md` §7** (A: admissions & selectivity… F: institution basics). Each entry: `key`, optional `note` (e.g. "decode", "sparse-CDS", "prefer over X"), optional `fallback:` (sibling key emitted when the primary is NULL — required on `cost.room_and_board` → `cost.on_campus_room_board_other`, the §13.7 COA trap; eng-review).
4. `config/assets/abbreviations.yaml` — common school abbreviation → full-name expansions used by `resolve_school` (DATABASE_GUIDE §11): MIT, Caltech, NYU, UCLA, USC, UNC, UVA, CMU, Georgia Tech, UMich, UPenn, JHU, WashU, BU, BC, A&M, UT Austin, UIUC, Ohio State, Penn State (≥20 entries; values are the IPEDS-style names).
5. `config/assets/prompts/` — empty placeholder files created in Phase 4; here just add `README.md` ("one file per agent prompt; loaded by `load_prompt`").
6. `config/logging.py` — `setup_logging(level)` configuring structlog: JSON renderer, ISO timestamps, `bind_trace_id(trace_id)` helper. Unit-test: a log call emits valid JSON containing the bound trace_id.

### Slice D — tests for the scaffolding (one agent, after B+C)
- `tests/test_settings.py`: missing required DSNs → one aggregated error naming both; defaults load with a minimal env; DSN masking in repr; asset loaders return parsed content for all four YAML assets (this pins the assets' schemas).
- `tests/test_logging.py` as above.

## Live verification
None (no external systems yet). `uv run pytest`, `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy .` all clean.

## Try it yourself (user)
```bash
cd ~/Projects/counselle && uv run pytest -q   # all green
uv run python -c "from config.settings import get_settings; get_settings()"   # fails fast, listing the missing DB DSNs — that's correct behavior
```

## Gate checklist
- [ ] Layout matches ARCHITECTURE §5 exactly (every directory exists, importable).
- [ ] Settings covers every group in ARCHITECTURE §18's table; fail-fast verified by test.
- [ ] All four data assets exist with the exact content sources named above.
- [ ] Lint/format/mypy/pytest clean. `uv.lock` present.
- [ ] `.env` is gitignored (verify: `git check-ignore .env`).

## Milestone commit (after user approval)
```
feat(scaffold): project skeleton, settings surface, data assets, tooling

Layout per ARCHITECTURE §5; typed fail-fast Settings per ADR 0018; subreddit
menu, season calendar, dossier shortlist, abbreviations as versioned assets.
```
Then merge `feat/p0-bootstrap` → `main`.
