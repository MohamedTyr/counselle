# Wave 1 Audit — Tests, Evals, Config, Build, Dependencies, Repo Hygiene, Docs Drift

**Scope:** cross-cutting concerns of the Counselle codebase — the Python test suite, frontend tests, eval harness, configuration surface, build/containerization, dependency hygiene, scripts/migrations, repo hygiene, dead code, and docs-vs-reality drift.

**Method:** read CLAUDE.md / README / ARCHITECTURE / ADRs / TODOS / pyproject / package.json; ran the routine pytest suite (`448 passed`), the frontend suite (`142 passed, 24 files`), `ruff check .` (clean), `mypy .` (1 error), and per-package coverage; inspected migrations, scripts, the Containerfile, the vendored LibreChat ledger, and the eval runner.

**Overall:** the production code is unusually disciplined — no `print()`/TODO/`except: pass` in `app/api/counselle_db/config/adapters/domain`; property-based tests on the honesty core; well-documented vendoring. The problems are concentrated in (a) a **broken type-check gate that the docs advertise as green**, (b) **stale doc/count claims** (ADR count, eval count), (c) **repo hygiene** (orphan screenshots, committed tooling dirs, stale lock), and (d) **untested eval scoring logic + a config side-channel that bypasses the single Settings surface**.

---

## Severity summary

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 3 |
| MEDIUM | 7 |
| LOW | 9 |
| **Total** | **19** |

---

## HIGH

### H1 — `mypy .` fails, but README + CLAUDE.md advertise it as a passing gate
- **Category:** build/gate, docs-drift
- **Location:** `tests/app/test_tavily_tools.py:15`; alias at `adapters/tavily_tools.py:33`; claims at `README.md:96` and `CLAUDE.md` Commands block (`uv run ruff check . && uv run mypy .`)
- **Evidence:**
  ```
  $ uv run mypy .
  tests/app/test_tavily_tools.py:14: error: Module "adapters.tavily_tools" does not
    explicitly export attribute "_registrable_domain"  [attr-defined]
  Found 1 error in 1 file (checked 120 source files)
  ```
  `_registrable_domain` was moved to `domain/urls.py` and only re-imported into `tavily_tools.py` under a private-prefixed alias (`from domain.urls import registrable_domain as _registrable_domain`). mypy treats an underscore-prefixed re-import as non-exported, so the test's `from adapters.tavily_tools import _registrable_domain` fails the check.
- **Why it matters:** the type-check gate is one of only two quality gates the repo advertises (the workflow rules treat `mypy` as zero-tolerance). A maintainer running the documented command gets a red gate on a clean checkout — the gate is either being skipped in practice or the claim is false. Either way the advertised "lint + type-check" command is broken.
- **Fix:** import `registrable_domain` from `domain.urls` directly in the test (it is the real home), or add `__all__`/a non-underscore re-export in `adapters/tavily_tools.py`. Then make the `mypy` claim true by keeping it green.

### H2 — Eval scoring logic is shipped but has zero tests
- **Category:** weak/missing tests, eval gap
- **Location:** `evals/runner.py` (pure scorers: `value_in_prose:180`, `_fields_seen:193`, `score_fact:199`, `score_field_selection:218`, `score_clarify:238`, `score_viz:248`, `build_report:464`, `render_markdown:487`); `evals/` is a shipped wheel package (`pyproject.toml:53`). No test file imports `evals.*` (`grep` of `tests/` = empty).
- **Evidence:** `value_in_prose` carries subtle, bug-prone logic — comma stripping, a digit-boundary regex `(?<![\d.])…(?!\d)`, and a negative-number "negative $X" fallback. `score_viz` does a subset check `wanted <= unitids`. None of it is unit-tested; the only exercise is a full live run (~$2–3, requires live Gemini + DB).
- **Why it matters:** the eval report is "the deliverable" (PRD story 58) and the honesty pitch leans on it. A silent regression in `value_in_prose` (e.g. a boundary that lets `5` match inside `35`) would corrupt every fact verdict invisibly, and nobody would notice without a live run. These are the cheapest, highest-leverage unit tests in the repo and they don't exist.
- **Fix:** add `tests/evals/test_scorers.py` covering `value_in_prose` (comma/case/boundary/negative cases), `_fields_seen`, each `score_*` branch with a hand-built `TurnCapture`, and `build_report`/`render_markdown`. No live deps needed.

### H3 — The committed eval baseline is stale and the question count drifted (50 → 48)
- **Category:** eval gap, docs-drift
- **Location:** `evals/questions.yaml` (48 questions); `evals/report-2026-06-11.json` (`"total": 50`); claims of "50" in `README.md:104`, `evals/runner.py:20` docstring.
- **Evidence:**
  ```
  $ grep -c "^- id:" evals/questions.yaml   → 48
  $ grep -o '"total": [0-9]*' evals/report-2026-06-11.json | head -1 → "total": 50
  ```
  Two questions were removed (consistent with ADR 0024 removing the score-band viz, commit `c44cb27`) without updating the docstring, the README, or re-running the baseline.
- **Why it matters:** the one committed baseline report (`.gitignore` keeps exactly one) no longer corresponds to the current question set, so it can't be diffed against a fresh run honestly. "50-question eval" is stated as fact in user-facing README and the runner's own usage string.
- **Fix:** re-baseline the eval (regenerate `report-<date>.{json,md}`), and replace every "50" with the live count (or stop hardcoding it — derive from `len(load_questions())`).

---

## MEDIUM

### M1 — ADR count is wrong everywhere except the index (says 23, there are 24)
- **Category:** docs-drift
- **Location:** `CLAUDE.md:60` ("Index of all 23 ADRs"), CLAUDE.md doc-map line ("the 23 architectural decision records"), `README.md:114` ("the 23 architectural decision records"); actual: `docs/adr/0001…0024` (24 files; `docs/adr/README.md` correctly indexes 24, including `0024-remove-score-band`).
- **Evidence:** `ls docs/adr/*.md | grep -v README | wc -l → 24`; `docs/adr/README.md` references 0024 twice; CLAUDE.md/README both still say 23.
- **Why it matters:** the ADR set is the canonical decision record CLAUDE.md tells every future maintainer to "start here" for. An off-by-one count signals the orientation docs weren't updated when 0024 landed, eroding trust in the rest of the doc map.
- **Fix:** bump "23" → "24" in CLAUDE.md (two places) and README (one place); add a guard to keep the count fresh, or just stop stating a number.

### M2 — Tavily key resolution hand-parses `.env`, bypassing the single Settings surface (ADR 0018)
- **Category:** config smell, duplication
- **Location:** `adapters/tavily_tools.py:136-165` (`make_tavily_client`)
- **Evidence:** after `settings.tavily_api_key` and `os.environ["TAVILY_API_KEY"]`, it falls through to opening `Path(".env")` (CWD-relative), splitting lines by hand, stripping inline comments, and reading the key directly — and logs via stdlib `logging`, not structlog.
- **Why it matters:** ADR 0018 is explicit — "one fail-fast typed Settings surface … hardcoding only for true invariants." This is a second, ad-hoc config reader with its own (CWD-dependent, comment-stripping) parser that diverges from pydantic-settings' `.env` handling. It silently makes the un-prefixed `TAVILY_API_KEY` a supported config path that the Settings surface doesn't know about, and a CWD-relative `.env` read is a footgun under the container (`WORKDIR /app`, `COPY . .` includes no `.env` per `.dockerignore`).
- **Fix:** drop the manual `.env` read; rely on `settings.tavily_api_key` (and optionally let pydantic-settings read an aliased env var). If the un-prefixed convention must stay, model it as a field alias on `Settings`, not a side parser.

### M3 — Orphan screenshot scratch files committed-adjacent in the repo root
- **Category:** repo hygiene, dead files
- **Location:** repo root: `panel-v2.png`, `panel-v3.png`, `reveal-off.png`, `reveal-on-light-full.png`, `sources-before-after.png`, `sources-panel-open.png`, `strip-closeup.png` (~1.2 MB total, currently untracked per `git status`)
- **Evidence:** `git status --porcelain` lists all seven as `??`; `grep` for each name across `*.md/*.tsx/*.ts` finds **zero references** — pure design-iteration scratch.
- **Why it matters:** these are one `git add -A` away from being committed (and the global rules forbid `git add -A`, but the risk stands). They are exactly the "leftover screenshots/scratch files in the repo root" the audit calls out. `.gitignore` does not cover root `*.png`, so nothing stops them.
- **Fix:** delete them, or move design captures under a gitignored `plans/.local/`. Add `*.png` at the root (or a `screenshots/` ignore) to `.gitignore` if these recur.

### M4 — `skills-lock.json` points at a nonexistent skill path
- **Category:** repo hygiene, tooling drift
- **Location:** `skills-lock.json` (`"skillPath": "skills/shadcn/SKILL.md"`); actual shadcn skill lives at `.agents/skills/shadcn/SKILL.md`; `skills/` contains only the 4 Counselle agent skills.
- **Evidence:** `ls skills/shadcn → No such file or directory`; the four real skills are `skills/{citation-and-recency,decode-coded-value,dossier-assembly,school-comparison}/SKILL.md`.
- **Why it matters:** the lock file's recorded path and hash describe a file that isn't where it says, so the lock can never verify. It's a stale tooling artifact that misleads anyone trying to reconcile skills.
- **Fix:** regenerate the lock against the real path, or remove `skills-lock.json` if the shadcn skill is installed via the global agent tooling rather than vendored into this repo.

### M5 — Agent/editor tooling directories are committed into the product repo
- **Category:** repo hygiene
- **Location:** `.agents/skills/shadcn/**` (14 tracked files incl. PNGs) and `.claude/skills/shadcn` (committed symlink)
- **Evidence:** `git ls-files .agents | wc -l → 14`; `git ls-files .claude → .claude/skills/shadcn`.
- **Why it matters:** these are local agent-tooling caches (the shadcn skill bundle), not Counselle source. They bloat the repo, are environment-specific, and a symlink under `.claude/` is brittle across machines/CI. The product is supposed to be a clean read-only-DB consumer; vendored editor tooling muddies the boundary.
- **Fix:** add `.agents/` and `.claude/` to `.gitignore` and `git rm --cached` them, unless a deliberate decision (an ADR) says the shadcn skill must be vendored — in which case document it and fix M4.

### M6 — README DB-setup command will fail: `setup_db.sql` needs `-v` psql vars the doc omits
- **Category:** docs-drift, runnability
- **Location:** `README.md:38` (`psql postgres < scripts/setup_db.sql`) vs `scripts/setup_db.sql:6-7` (`CREATE ROLE counselle_ro LOGIN PASSWORD :'ro_pw';` / `:'app_pw'`)
- **Evidence:** the SQL references unbound psql variables `:'ro_pw'` and `:'app_pw'`; the script's own header says "passwords substituted at run time with -v," but the README's copy-paste command supplies neither, so psql errors on the first `CREATE ROLE`.
- **Why it matters:** this is the first onboarding step in the README. A new maintainer following it verbatim hits an immediate failure. The script comment and the README disagree.
- **Fix:** update the README to `psql postgres -v ro_pw=… -v app_pw=… < scripts/setup_db.sql` (or wrap it in a small script that prompts), matching the SQL's contract.

### M7 — `.dockerignore` is too thin; `COPY . .` pulls test/plan/mockup/worktree cruft into the image build context
- **Category:** build hygiene
- **Location:** `Containerfile:14` (`COPY . .`); `.dockerignore` (10 lines)
- **Evidence:** `.dockerignore` excludes `.env/.git/.venv/__pycache__/caches/dist`, but **not** `frontend/` (incl. its 368 MB `node_modules` if present locally), `tests/`, `plans/`, `mockups/`, `evals/report-*.json`, `.worktrees/`, root `*.png`, `specs/`, `docs/`. The build copies all of it before `uv sync`.
- **Why it matters:** larger, slower, less reproducible image builds and a bigger attack surface in the shipped image (tests, plans, design mockups, eval reports have no business in the runtime container). With local `frontend/node_modules` present (368 MB) the build context balloons. Deploy is deferred, so this is latent, not live — but it's a foot-gun waiting for B6.
- **Fix:** expand `.dockerignore` to exclude `frontend/`, `tests/`, `plans/`, `mockups/`, `specs/`, `docs/`, `.worktrees/`, `evals/report-*`, `*.png`, `.agents/`, `.claude/` (the backend image needs none of them).

---

## LOW

### L1 — CORS default ships the dev origin; ADR 0023 says prod should be empty
- **Category:** config smell / fail-safe gap
- **Location:** `config/settings.py:124` (`cors_origins` default `["http://localhost:8000"]`); `api/context.py:81-87` (`allow_credentials=True`); ADR 0023 consequence: "Same-origin serving makes `CORS_ORIGINS` default-empty in production."
- **Evidence:** the default is a localhost origin, and `allow_credentials=True` is set. Starlette blocks the truly dangerous `["*"]`+credentials combo, so this is not exploitable as-is, but nothing validates that prod doesn't accidentally ship the localhost default contrary to ADR 0023.
- **Fix:** default `cors_origins=[]` and let dev set it via env, or add a startup check that warns when a non-empty CORS list is configured alongside same-origin serving.

### L2 — `psycopg` (psycopg3) is imported but not a declared direct dependency
- **Category:** dependency hygiene
- **Location:** `app/checkpointer.py:17-18` (`from psycopg import AsyncConnection` / `psycopg.rows.dict_row`); `pyproject.toml` lists no `psycopg`.
- **Evidence:** `grep psycopg pyproject.toml` → only `psycopg2-binary` (dev). `psycopg` resolves only transitively via `langgraph-checkpoint-postgres`.
- **Why it matters:** importing a transitive dep directly is fragile — a future `langgraph-checkpoint-postgres` release could drop or repin psycopg3 and silently break `app/checkpointer.py`. Direct imports should be direct deps.
- **Fix:** add `psycopg[binary]` (or `psycopg`) to `[project].dependencies`.

### L3 — `psycopg2-binary` is a loose dev dep instead of the proper `yoyo-migrations[postgres]` extra
- **Category:** dependency hygiene
- **Location:** `pyproject.toml:33` (`psycopg2-binary>=2.9.12` in dev) and `:24` (`yoyo-migrations>=9.0.0`, no extra)
- **Evidence:** `psycopg2-binary` is imported nowhere (`grep` empty); `yoyo-migrations` declares `psycopg2 ; extra == 'postgres'`. The README's `uv run yoyo apply` only works because the loose dev pin happens to satisfy it.
- **Fix:** request `yoyo-migrations[postgres]` and drop the standalone `psycopg2-binary` pin, making the coupling explicit.

### L4 — `anyio` is a declared dev dependency but never imported
- **Category:** dead dependency
- **Location:** `pyproject.toml:29` (`anyio>=4.13.0`)
- **Evidence:** `grep -rl "import anyio|from anyio" tests app api` → empty. (pytest-asyncio is the async test driver; anyio rides in transitively anyway.)
- **Fix:** remove from dev deps unless a planned anyio-based test needs it.

### L5 — `bandit` is declared but unwired; no script or gate runs it
- **Category:** dependency hygiene / unused tooling
- **Location:** `pyproject.toml:30` (`bandit>=1.9.4`); appears nowhere else (no CI, no `scripts/`, no Makefile)
- **Evidence:** the only hits for "bandit" are pyproject + stale worktree copies. The workflow rules (Phase 7) expect `bandit` to run; nothing invokes it.
- **Why it matters:** a security scanner that is installed but never run gives false comfort. Either wire it or drop it.
- **Fix:** add a `bandit -r app api counselle_db config adapters domain` step to a documented command (and/or the deferred CI), or remove the dep.

### L6 — Production modules use stdlib `logging` instead of the project-standard structlog
- **Category:** consistency / observability
- **Location:** `app/viz.py:12,21`; `adapters/tavily_tools.py:142-159`
- **Evidence:** `config/logging.py` + `test_logging.py` establish structlog (JSON, trace_id binding) as the logging contract; these two modules instantiate `logging.getLogger(__name__)` and emit outside the structured pipeline.
- **Why it matters:** log lines from these paths won't carry `trace_id`/JSON shape, fragmenting observability — and `viz.py` is on the honesty-critical number-fetch path where traceability matters most.
- **Fix:** switch both to `structlog.get_logger(__name__)`.

### L7 — `viz.py` (honesty-critical) and the DB service layer have low routine-suite coverage; gated only behind `live_db`
- **Category:** test coverage of critical paths
- **Location:** routine-suite coverage: `app/viz.py` 36%, `counselle_db/service.py` 28%, `counselle_db/service_find.py` 38%, `counselle_db/search_fields.py` 43%, `app/titles.py` 34%; `tests/app/test_viz.py:27` is `pytestmark = live_db`.
- **Evidence:** `uv run --with pytest-cov pytest -m "not live_*"` reports the above; the honesty-bearing viz/number-fetch and field-resolution code only executes under the live DB.
- **Why it matters:** the lowest-covered code in the routine suite is precisely the data-access + viz code where the project's one non-negotiable ("never lie to a student") lives. CI/dev runs without a DB exercise almost none of it; a regression there is invisible until a live run.
- **Fix:** extract the pure decision logic (field selection, ref building, error mapping) and unit-test it without a DB; or add a thin fixtured DB layer so the non-`live_db` suite touches `service.py`/`viz.py` decision branches.

### L8 — pytest-cov is not a dev dependency, so the documented coverage workflow can't run out of the box
- **Category:** tooling gap
- **Location:** `pyproject.toml` dev group (no `pytest-cov`); the global testing rule + CLAUDE house-rules imply coverage (80% min) matters.
- **Evidence:** `uv run pytest --cov=…` fails with `unrecognized arguments: --cov`; coverage only ran via `uv run --with pytest-cov`.
- **Why it matters:** the project asserts test rigor (property tests, "tested hard") but provides no first-class way to measure coverage; nobody can reproduce a coverage number from the committed config.
- **Fix:** add `pytest-cov` to the dev group and a `[tool.coverage]` config (or a documented `uv run pytest --cov` command).

### L9 — Stale git worktrees and abandoned per-feature plan trees linger under the working copy
- **Category:** repo hygiene
- **Location:** `.worktrees/{home-page,sidebar}` (gitignored, but live worktrees with full repo copies incl. their own `pyproject.toml`, `plans/`); `git worktree list` shows 5 extra worktrees on feature branches (`feat/composer-polish`, `feat/reasoning-experience`, `feat/timeline-source-chips`, `feat/home-page`, `feat/sidebar`).
- **Evidence:** `git worktree list` → 6 entries; `.worktrees/*/pyproject.toml` exist; `grep` for "bandit"/"mockups" surfaces duplicate stale copies inside `.worktrees/`.
- **Why it matters:** five parallel worktrees on feature branches mean unmerged in-flight work and duplicated trees on disk; the grep noise from stale copies (`.worktrees/sidebar/...`) actively confuses codebase searches. Not shipped, but a maintenance smell and a sign of unfinished feature branches.
- **Fix:** `git worktree prune` / remove finished worktrees; merge or delete the dangling `feat/*` branches once their work landed (some, e.g. composer/reasoning, appear already merged per the main branch log).

---

## Notes / things checked that were clean (for the synthesis pass)

- **Routine test suite:** `448 passed, 97 deselected` — green, fast (~10 s). No flakiness observed.
- **Frontend suite:** `142 passed (24 files)` — green (jsdom `--localstorage-file` warnings are harmless tooling noise).
- **`ruff check .`** — clean. Sensible rule set (`E,F,I,UP,B,SIM`) with a justified FastAPI `B008` carve-out.
- **No debug/TODO/silent-except** in `app/api/counselle_db/config/adapters/domain` — disciplined.
- **Migrations** (`0001…0006`) use a correct yoyo `-- depends:` chain with matching rollback files; `setup_db.sql` grants are read-only-role correct.
- **Settings surface** is well-built: fail-fast aggregation, secret masking in `__repr__`/`__str__`, a JWT-length validator. `extra="ignore"` silently drops unknown `COUNSELLE_*` vars (minor — a typo'd knob is silently ignored rather than rejected), noted here but below LOW.
- **`.env` is not tracked**; secrets stay in `.env`/Settings as required.
- **Vendored LibreChat** is meticulously ledgered (`UPSTREAM.md`, pinned commit, per-file subtraction notes) — a model of how to vendor.
- **Domain honesty-core tests** (`test_normalize_properties.py`, `test_specs.py`, `test_settings.py`, `test_supervision.py`) are genuine behavior tests with edge/error cases and property-based invariants — high quality, not mock-theater.
