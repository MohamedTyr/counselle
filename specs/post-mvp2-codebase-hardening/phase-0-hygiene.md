# Phase 0 — Repo Hygiene & Gate Restoration

> Execution: follow the per-phase loop in plans/audit/REMEDIATION-PLAN.md §2 (Opus implementers → green gate → ≥3 Sonnet reviewers (non-leading) → Opus fixers → re-review until unanimous SHIP → commit). Implement EVERYTHING below; miss nothing.

This is the first phase on branch `refactor/codebase-hardening`. Its job is to make
the repo's quality gates **honest** (mypy green to match the docs that advertise it),
make the working tree **clean** (so every later phase's grep/mypy/ruff search isn't
polluted by 1.2 GB of duplicated worktree source and orphan scratch files), make the
**dependency manifest truthful** (declare what's imported, drop what isn't, wire what's
declared), and **truth-up the doc-counts** that have drifted (ADR 23→24, tool 10→11,
eval 50→48, `thinking_summaries` default).

Everything here is low-risk and behavior-preserving for the student-facing product.
None of it touches runtime logic except the one-line `tavily_tools.py` re-export (which
changes nothing at runtime — it only makes the symbol explicitly exported for mypy).

**Ground-truth verified (2026-06-16) against the real repo** — all line numbers, file
contents, and `mypy`/`git` outputs below were confirmed by reading the actual files and
running the commands. Where the Wave-1 report and reality differed, reality wins (noted
inline).

---

## Scope & files touched

**Code / config edited:**
- `adapters/tavily_tools.py` (add `__all__` to export `_registrable_domain`) — 06-H1
- `pyproject.toml` (deps: add `psycopg[binary]`, `pytest-cov`; swap `psycopg2-binary` → `yoyo-migrations[postgres]`; drop `anyio`; bandit kept + wired; add `[tool.coverage]`) — 06-L2/L3/L4/L5/L8
- `.gitignore` (add `.agents/`, `.claude/`, `.worktrees/`, root `*.png`, `.coverage`, coverage artifacts) — 06-M3/M5, 01-L1, 06-L9 hygiene
- `.dockerignore` (expand exclusions) — 06-M7

**Files removed from git tracking (NOT deleted from disk where reversible):**
- `.agents/**` (14 tracked files) via `git rm --cached -r` — 06-M5
- `.claude/skills/shadcn` (committed symlink) via `git rm --cached` — 06-M5
- `skills-lock.json` (stale path) — 06-M4

**Untracked scratch deleted from disk:**
- root `*.png` (7 files) — 06-M3

**Docs edited (count drift):**
- `CLAUDE.md` (ADR 23→24) — 06-M1
- `README.md` (ADR 23→24; eval 50→48; db-setup `-v` vars) — 06-M1, 06-H3, 06-M6
- `app/toolset.py` (tool "10"→"11") — 01-L2
- `counselle_db/service.py` (tool "10th"→"11th") — 01-L2
- `evals/runner.py` (docstring static text: "all 50"→neutral "the full set") — 06-H3 (static fix only; the dynamic count + re-baseline RUN are Phase 7)
- `docs/ARCHITECTURE.md` (`thinking_summaries` default doc/§27.2/§18) — 01-L3

**Git maintenance (reversible):**
- `git worktree prune`; remove the two nested `.worktrees/{home-page,sidebar}` worktrees — 06-L9, 01-L1

**Explicitly NOT in this phase (deferred to later phases — do NOT do here):**
- The eval **re-baseline RUN** (regenerate `report-<date>.{json,md}`) → **Phase 7**. Phase 0 only fixes the *count references and docstrings*. (06-H3 split: count-fix here, run there.)
- `evals` scorer unit tests (06-H2), structlog migration (06-L6), viz/service coverage (06-L7) → **Phase 7**.
- The Tavily `.env` side-parser (M2 / 06-M2) and CORS default (06-L1) → **Phase 6**.
- The merged/abandoned `feat/*` branch deletion decision (composer-polish, reasoning-experience, timeline-source-chips) → leave the *branches* alone; only prune the **nested** worktrees that pollute the tree. (Deleting feature branches is a judgement call for the human; pruning nested worktrees is pure hygiene.)

---

## Gate commands (for this phase)

Run from repo root after implementation. All must pass.

```bash
# Backend gates — mypy MUST now be green (that's the headline fix)
uv run ruff check .
uv run mypy .
uv run pytest -m "not live_llm and not live_search"

# Dependency manifest resolves cleanly after the edits
uv sync

# Bandit now runs (06-L5 wires it) — must exit 0 with no high-severity findings
uv run bandit -r app api counselle_db config adapters domain -q

# Coverage flag now works out of the box (06-L8)
uv run pytest -m "not live_llm and not live_search" --cov=. --cov-report=term-missing -q | tail -5

# Hygiene assertions
git status --porcelain          # no root *.png, no .coverage listed as untracked
git ls-files .agents .claude    # MUST be empty (untracked now)
git worktree list               # MUST NOT list .worktrees/home-page or .worktrees/sidebar

# Doc-count drift gone
! grep -rn "all 23 ADR\|23 architectural decision" CLAUDE.md README.md
! grep -rn "all 10 tools\|10th tool" app/toolset.py counselle_db/service.py
! grep -rn "all 50\|50-question" evals/runner.py README.md
```

The frontend is untouched by Phase 0, so the frontend gate is not required here (it will
be run in Phases 4/5 and in the final pre-merge gate).

---

## Findings & fixes

### 06-H1 — `mypy .` fails, but README + CLAUDE.md advertise it as a passing gate  [HIGH]

- **Files:**
  - `adapters/tavily_tools.py:33` — `from domain.urls import registrable_domain as _registrable_domain`
  - `tests/app/test_tavily_tools.py:14` — `from adapters.tavily_tools import (_registrable_domain, ...)`
  - Advertised at `README.md:96` and `CLAUDE.md` Commands block (`uv run ruff check . && uv run mypy .`)
- **Problem:** Confirmed live:
  ```
  $ uv run mypy .
  tests/app/test_tavily_tools.py:14: error: Module "adapters.tavily_tools" does not
    explicitly export attribute "_registrable_domain"  [attr-defined]
  Found 1 error in 1 file (checked 120 source files)
  ```
  `registrable_domain` now lives in `domain/urls.py` (verified: `domain/urls.py:27`). It
  is re-imported into `tavily_tools.py` under the private alias `_registrable_domain`
  (line 33). mypy's `[attr-defined]` rule treats an **underscore-prefixed re-import** as
  *not exported*, so the test's `from adapters.tavily_tools import _registrable_domain`
  is rejected. The repo advertises `mypy` as one of only two quality gates and the
  workflow rules treat it as zero-tolerance, yet a clean checkout fails it.

  The alias has 4 in-module call sites (`tavily_tools.py:60, 69, 69, 248`) and the test
  imports it (`test_tavily_tools.py:15`). Both files use the `_registrable_domain` name.
  The least-churn correct fix is to keep the alias but make it **explicitly exported**
  via `__all__` (PEP 484 / mypy treat names in `__all__` as exported regardless of the
  underscore prefix).
- **Fix:** Add an `__all__` to `adapters/tavily_tools.py` that includes the private
  re-export (and the other public symbols the module intends to expose / the test
  imports). There is currently **no `__all__`** in the file. Insert it immediately after
  the imports block (after line 33's import group, before the `# Domain helpers`
  divider at line 35).

  **Before** (`adapters/tavily_tools.py:31-35`):
  ```python
  from counselle_db.service import get_values as _get_values_impl
  from domain.envelope import Citation
  from domain.urls import registrable_domain as _registrable_domain

  # ---------------------------------------------------------------------------
  # Domain helpers
  ```
  **After:**
  ```python
  from counselle_db.service import get_values as _get_values_impl
  from domain.envelope import Citation
  from domain.urls import registrable_domain as _registrable_domain

  # mypy: a leading-underscore re-import is treated as non-exported unless it is
  # named in __all__. The test suite and the schema-search docs import these names
  # from this module, so declare the public surface explicitly (keeps `mypy .` green).
  __all__ = [
      "make_tavily_client",
      "search_web",
      "search_school_site",
      "search_reddit",
      "_registrable_domain",
      "_safe_error",
      "_subreddits_allowed",
  ]

  # ---------------------------------------------------------------------------
  # Domain helpers
  ```
  > Adapt the list to the real public names if any drifted — the binding requirement is
  > that **`_registrable_domain` (and every other symbol `tests/app/test_tavily_tools.py:14-22`
  > imports) appears in `__all__`**. The current test imports: `_registrable_domain`,
  > `_safe_error`, `_subreddits_allowed`, `make_tavily_client`, `search_reddit`,
  > `search_school_site`, `search_web` (verified at `test_tavily_tools.py:14-22`).

  **Do NOT** change the test to import from `domain.urls` instead — while that also fixes
  mypy, the test deliberately verifies the adapter's re-export contract, and `__all__` is
  the smaller, more honest fix that documents the module's public surface. (The Wave-1
  report offered both; `__all__` is the chosen one.)
- **Tests / verification:**
  - `uv run mypy .` → `Success: no issues found in 121 source files` (or equivalent
    "no issues"). It must be **green**.
  - `uv run pytest -m "not live_llm and not live_search" tests/app/test_tavily_tools.py`
    → still passes (the import still resolves).
  - `uv run ruff check adapters/tavily_tools.py` → clean (an `__all__` after imports is
    idiomatic; if ruff's `RUF022`/import-sort complains, accept ruff's ordering).
- **Acceptance criteria:**
  - [ ] `uv run mypy .` exits 0 with zero errors.
  - [ ] `adapters/tavily_tools.py` has an `__all__` containing `_registrable_domain` and every name the test imports.
  - [ ] `tests/app/test_tavily_tools.py` is unchanged (still imports from `adapters.tavily_tools`).
  - [ ] The full routine pytest suite still passes (448 tests as of audit).

---

### 06-H3 — Eval question-count drifted 50→48 (FIX THE COUNT REFERENCES + docstrings/README here; the re-baseline RUN is Phase 7)  [HIGH]

- **Files:**
  - `evals/runner.py:20` — docstring usage line `uv run python -m evals.runner   # all 50 (slow, costs money)`
  - `README.md:104` — "A 50-question eval over the live DB + Gemini."
  - (Reference truth: `evals/questions.yaml` has **48** questions — verified `grep -c "^- id:" evals/questions.yaml → 48`; the committed `evals/report-2026-06-11.json` says `"total": 50` — verified.)
- **Problem:** Two questions were removed (consistent with ADR 0024 removing the
  score-band viz) without updating the runner docstring or the README. The user-facing
  README and the runner's own `--help`/usage text both still assert "50". The committed
  baseline (`report-2026-06-11.json`, `"total": 50`) no longer matches the 48-question
  set, so it can't be honestly diffed against a fresh run.
- **Fix:** Two parts. Phase 0 does only part (1).

  **(1) Count references / docstrings / README — DO THIS NOW.**

  `evals/runner.py:20` — **before:**
  ```
      uv run python -m evals.runner                 # all 50 (slow, costs money)
  ```
  **after** (drop the hardcoded number; derive intent in words, not a literal that rots):
  ```
      uv run python -m evals.runner                 # the full set (slow, costs money)
  ```

  `README.md:104` — **before:**
  ```
  A 50-question eval over the live DB + Gemini. Produces `evals/report-<date>.json` and a Markdown summary. Expect ~$2–3 in Gemini/Tavily spend.
  ```
  **after:**
  ```
  An eval over the live DB + Gemini (the question set in `evals/questions.yaml`). Produces `evals/report-<date>.json` and a Markdown summary. Expect ~$2–3 in Gemini/Tavily spend.
  ```
  > Rationale for dropping the literal rather than writing "48": the count will drift
  > again. Per the audit's own "stop hardcoding it — derive from `len(load_questions())`"
  > guidance, the docstring/README should not assert a magic number. If the implementer
  > prefers, the runner may additionally print the live count at startup
  > (`logger.info("loaded %d eval questions", len(questions))`) — optional, low value,
  > skip if it adds churn.

  **(2) The re-baseline RUN — DO NOT DO HERE. Deferred to Phase 7.** The stale
  `report-2026-06-11.json` (`"total": 50`) is **left as-is in Phase 0**. Phase 7 runs
  `uv run python -m evals.runner`, regenerates `report-<date>.{json,md}`, deletes the
  stale `report-2026-06-11.json`, and commits the fresh baseline. **Do not touch the
  committed report JSON in Phase 0.** (Reason: the run costs ~$2–3 and needs live Gemini;
  it belongs with the Phase-7 close-out so the baseline reflects all 1–6 fixes.)
- **Tests / verification:**
  - `grep -rn "all 50\|50-question\|50 (slow" evals/runner.py README.md` → no matches.
  - `evals/report-2026-06-11.json` is **unchanged** (Phase 7 owns it).
  - The runner still imports and runs (`uv run python -c "import evals.runner"` succeeds).
- **Acceptance criteria:**
  - [ ] No "50" question-count literal remains in `evals/runner.py` or `README.md`.
  - [ ] `evals/report-2026-06-11.json` is untouched in this phase (a one-line note left in the Phase-completion checklist that Phase 7 must re-baseline).
  - [ ] A cross-phase note (below) records that the re-baseline run is Phase 7's job.

---

### 06-M1 — ADR count says 23, there are 24  [MEDIUM]

- **Files:**
  - `CLAUDE.md:60` — `| `docs/adr/README.md` | **Index of all 23 ADRs** ... |`
  - `README.md:114` — `- [`docs/adr/`](docs/adr/) — the 23 architectural decision records ...`
- **Problem:** There are **24** ADR files (verified `ls docs/adr/*.md | grep -v README | wc -l → 24`, files `0001…0024`, with `docs/adr/README.md` correctly indexing 24 including `0024-remove-score-band`). Both orientation docs still say 23.
  > Note: the Wave-1 report claimed CLAUDE.md had the count in *two* places (an index
  > line + a doc-map line). Verified reality: CLAUDE.md says "23" in **exactly one**
  > place — line 60. README says it in **one** place — line 114. Fix both; there is no
  > third occurrence (`grep -n "23" CLAUDE.md README.md` confirms).
- **Fix:** Two single-character edits.

  `CLAUDE.md:60` — **before:** `**Index of all 23 ADRs**` → **after:** `**Index of all 24 ADRs**`

  `README.md:114` — **before:** `the 23 architectural decision records` → **after:** `the 24 architectural decision records`
- **Tests / verification:** `grep -rn "23 ADR\|all 23\|23 architectural decision" CLAUDE.md README.md` → no matches; `grep -rn "24 ADR\|24 architectural decision" CLAUDE.md README.md` → 2 matches.
- **Acceptance criteria:**
  - [ ] `CLAUDE.md:60` says "24 ADRs".
  - [ ] `README.md:114` says "24 architectural decision records".
  - [ ] No "23" ADR-count literal remains in either file.

---

### 01-L2 — Tool count "10" vs the real 11  [LOW]

- **Files:**
  - `app/toolset.py:140` — docstring `"""The counselle-db MCP server as a stdio child (notes §2; all 10 tools."""`
  - `counselle_db/service.py:646` — docstring `"""Per-source vintage + cutoff (ARCHITECTURE §8) — the server's 10th tool."""`
- **Problem:** The MCP server registers **11** `@mcp.tool()`s (verified `grep -c "@mcp.tool" counselle_db/server.py → 11`). ARCHITECTURE §8 already says "the server's **11th tool**" (Layer-1 `search_fields` + 8 typed tools + `get_data_calendar` + `query_database` = 11). Two docstrings still say "10".
- **Fix:**

  `app/toolset.py:140` — **before:**
  ```python
      """The counselle-db MCP server as a stdio child (notes §2; all 10 tools).
  ```
  **after:**
  ```python
      """The counselle-db MCP server as a stdio child (notes §2; all 11 tools).
  ```

  `counselle_db/service.py:646` — **before:**
  ```python
      """Per-source vintage + cutoff (ARCHITECTURE §8) — the server's 10th tool."""
  ```
  **after:**
  ```python
      """Per-source vintage + cutoff (ARCHITECTURE §8) — the server's 11th tool."""
  ```
- **Tests / verification:** `grep -rn "all 10 tools\|10th tool" app/ counselle_db/` → no matches; `grep -c "@mcp.tool" counselle_db/server.py` → 11 (sanity).
- **Acceptance criteria:**
  - [ ] `app/toolset.py` docstring says "11 tools".
  - [ ] `counselle_db/service.py` docstring says "11th tool".
  - [ ] No "10 tools"/"10th tool" string remains in the backend.

---

### 01-L3 — `thinking_summaries` doc/default contradiction  [LOW]

- **Files:**
  - `config/settings.py:74` — `thinking_summaries: bool = False` (the real, intentional default, with a 5-line comment at `:69-73` explaining *why* it's off — verified).
  - `docs/ARCHITECTURE.md` §18 and §27.2 — describe `thinking_summaries` as default **on** ("Settings-gated, default on"); risk-table §35 also references "native Gemini thought summaries cut dead air to ~16s".
- **Problem:** The architecture doc misdescribes a shipped default in the very section a
  maintainer reads to understand the feature. The **settings comment is the source of
  truth**: the default is `False` *by design* (the live timeline shows one model-authored
  intent line per round; native Gemini thought summaries would dump full reasoning into
  the rail — not wanted). The product intent is the `False` default, not the doc.
- **Fix:** Update `docs/ARCHITECTURE.md` to match the `False` default (the code is right;
  the doc is wrong). Locate every place the doc asserts "default on" for
  `thinking_summaries` and correct it. Use the settings comment (`config/settings.py:69-73`)
  as the canonical explanation:

  1. `grep -n "thinking_summaries" docs/ARCHITECTURE.md` to find the exact lines (§18, §27.2, and any §35 risk-table mention).
  2. In §18 and §27.2: change "default **on**" / "Settings-gated, default on" → "**Settings-gated, default off** (`thinking_summaries=False`) by design — the live timeline shows one model-authored intent line per round of work; native Gemini thought summaries would dump the model's full multi-paragraph reasoning into the rail, which the product does not want. See `config/settings.py`."
  3. In the §35 risk table: if the entry implies the summaries are *on*, reword to clarify the model's own "Narrate As You Work" one-liner is the dead-air mitigation that ships (not native thought summaries). If §35 merely *mentions* the capability without asserting it's enabled, leave it; the binding fix is §18/§27.2.

  > Do **not** flip the code default. The comment is explicit that `False` is by-design
  > product intent (it's the §27.2 narration-rail decision). This is a docs-truth-up only.
- **Tests / verification:**
  - `grep -n "thinking_summaries" docs/ARCHITECTURE.md` — every hit consistent with `default off`.
  - No code change to `config/settings.py` (it stays `= False`).
  - `! grep -in "thinking_summaries.*default on\|default on.*thinking_summaries" docs/ARCHITECTURE.md`.
- **Acceptance criteria:**
  - [ ] `docs/ARCHITECTURE.md` §18 and §27.2 describe `thinking_summaries` as default **off** with the by-design rationale.
  - [ ] `config/settings.py:74` is unchanged (`thinking_summaries: bool = False`).
  - [ ] No "default on" claim for `thinking_summaries` survives anywhere in the docs.

---

### 06-M3 — Orphan root screenshots committed-adjacent  [MEDIUM]

- **Files:** repo root: `panel-v2.png`, `panel-v3.png`, `reveal-off.png`, `reveal-on-light-full.png`, `sources-before-after.png`, `sources-panel-open.png`, `strip-closeup.png` (7 files; currently **untracked** per `git status --porcelain` — verified all 7 show as `??`).
- **Problem:** Pure design-iteration scratch (verified `grep` of each name across `*.md/*.tsx/*.ts` finds zero references — they are unreferenced). `.gitignore` does not cover root `*.png`, so one stray `git add -A` commits ~1.2 MB of scratch. They also clutter the root listing.
- **Fix:** Delete the untracked PNGs from disk (they're untracked, so this is safe and
  reversible only via re-export from the design tool — but they're unreferenced scratch,
  so deletion is correct), and add an ignore rule so they don't recur.

  ```bash
  # From repo root. These are untracked scratch; remove from disk.
  rm -f panel-v2.png panel-v3.png reveal-off.png reveal-on-light-full.png \
        sources-before-after.png sources-panel-open.png strip-closeup.png
  ```
  Then add to `.gitignore` (see the consolidated `.gitignore` edit under 06-M5 below —
  the root-`*.png` line is added there).
- **Tests / verification:** `ls *.png 2>/dev/null` → empty; `git status --porcelain | grep '\.png'` → empty.
- **Acceptance criteria:**
  - [ ] No `*.png` files in the repo root.
  - [ ] `.gitignore` ignores root `*.png` (so they can't be re-added accidentally).

---

### 06-M5 — Agent/editor tooling directories committed into the product repo  [MEDIUM]

- **Files:**
  - `.agents/skills/shadcn/**` — **14 tracked files** incl. PNGs (verified `git ls-files .agents | wc -l → 14`; the real shadcn skill bundle lives here: `SKILL.md`, `agents/openai.yml`, `assets/*.png`, `cli.md`, `customization.md`, `evals/evals.json`, `mcp.md`, `registry.md`, `rules/base-vs-radix.md`, …).
  - `.claude/skills/shadcn` — a committed **symlink** (verified `git ls-files .claude → .claude/skills/shadcn`).
- **Problem:** These are local agent-tooling caches (the shadcn skill bundle the global
  agent rules install), **not Counselle source**. They bloat the repo, are
  environment-specific, and a committed symlink under `.claude/` is brittle across
  machines/CI. The product is a clean read-only-DB consumer; vendored editor tooling
  muddies that boundary. There is no ADR sanctioning vendoring the shadcn skill into this
  repo (the frontend rule in CLAUDE.md installs shadcn components via the MCP/CLI, not by
  committing the skill bundle).
- **Fix:** Untrack both (reversible — `--cached` keeps the files on disk), and ignore them.

  ```bash
  # From repo root. --cached removes from the index but keeps the files on disk
  # (so the local shadcn tooling keeps working; only git stops tracking it).
  git rm --cached -r .agents
  git rm --cached .claude/skills/shadcn
  ```
  Then add the ignore rules. **Consolidated `.gitignore` edit** (covers 06-M3, 06-M5,
  01-L1, 06-L9, and the new `.coverage`/coverage artifacts from 06-L8):

  **Append to `.gitignore`** (after the existing `plans/.local/` block at the end):
  ```gitignore
  # Local agent / editor tooling caches — not Counselle source (06-M5).
  # The shadcn skill bundle is installed locally via the global agent rules; it
  # is not vendored into the product repo (no ADR sanctions vendoring it here).
  .agents/
  .claude/

  # Nested git worktrees live under .worktrees/ — duplicated source trees that
  # pollute every recursive grep/mypy/ruff walk. Keep them out of the index and
  # off the search path (01-L1, 06-L9).
  .worktrees/

  # Design-iteration screenshot scratch dropped in the repo root (06-M3).
  /*.png

  # Coverage artifacts (06-L8 adds pytest-cov; don't commit run output).
  .coverage
  .coverage.*
  htmlcov/
  coverage.xml
  ```
  > `.claude/skills/shadcn` is a symlink; `git rm --cached` removes the tracked symlink
  > entry. The `.claude/` ignore then prevents re-adding it. If `.claude/` also holds
  > other tracked files you want to keep, narrow the ignore to `.claude/skills/` — but
  > verified: the **only** tracked path under `.claude/` is `.claude/skills/shadcn`, so
  > ignoring all of `.claude/` is safe.
- **Tests / verification:**
  - `git ls-files .agents .claude` → empty.
  - `ls .agents/skills/shadcn/SKILL.md` → still exists on disk (the `--cached` kept it).
  - `git status --porcelain` → does NOT list `.agents`/`.claude` as untracked (they're ignored now).
- **Acceptance criteria:**
  - [ ] `.agents/` and `.claude/` are untracked (removed via `git rm --cached`, files still on disk).
  - [ ] `.gitignore` ignores `.agents/` and `.claude/`.
  - [ ] No `.agents`/`.claude` paths appear in `git ls-files`.

---

### 01-L1 — `.worktrees/` (1.2 GB) lives inside the repo and is not gitignored  [LOW]
### 06-L9 — Stale git worktrees & abandoned per-feature plan trees linger  [LOW]

(Combined — same root cause, same fix.)

- **Files / state (verified):**
  - `du -sh .worktrees → 1.2G`.
  - `git worktree list` shows **6** entries: the main checkout, three **sibling** worktrees (`../counselle-composer-polish`, `../counselle-reasoning-experience`, `../counselle-timeline-source-chips` on `feat/*` branches), and **two nested inside the repo**: `.worktrees/home-page` (`feat/home-page`) and `.worktrees/sidebar` (`feat/sidebar`).
  - `.gitignore` has no `worktree` entry (verified).
  - The nested trees are the source of the duplicate grep hits seen throughout this audit (e.g. every `_registrable_domain` grep returned 2× extra hits from `.worktrees/home-page` and `.worktrees/sidebar`).
- **Problem:** Two near-identical 1.2 GB source trees nested inside the repo root
  pollute every tool that walks the tree (ripgrep, mypy, ruff, IDE indexers, `find`) and
  are one stray `git add .worktrees` from disaster. The sibling worktrees
  (`../counselle-*`) are outside the repo and harmless to the tree — leave them.
- **Fix:** Remove the **nested** worktrees and prune. The `.worktrees/` ignore line is
  already added in the consolidated `.gitignore` edit under 06-M5.

  ```bash
  # From repo root. Remove the two NESTED worktrees (they pollute the tree).
  # Use `git worktree remove` (clean) rather than rm -rf so git's metadata stays sane.
  git worktree remove .worktrees/home-page
  git worktree remove .worktrees/sidebar
  # If either has uncommitted changes git will refuse — inspect first, and only then:
  #   git worktree remove --force .worktrees/<name>
  # (Confirm with the human before --force; the feat/home-page and feat/sidebar
  #  BRANCHES are preserved either way — only the working trees are removed.)
  git worktree prune
  ```
  > **Do NOT** delete the `feat/home-page` / `feat/sidebar` *branches* — only their nested
  > working trees. The branches remain in the repo; a human decides later whether they're
  > merged/abandoned. **Do NOT** touch the three sibling `../counselle-*` worktrees —
  > they're outside the repo and outside this phase's scope.
  > If `git worktree remove` refuses because of dirty state, **stop and report to the
  > orchestrator** rather than forcing — losing in-flight work violates the reversibility
  > rule.
- **Tests / verification:**
  - `git worktree list` → no `.worktrees/home-page` or `.worktrees/sidebar` entries.
  - `ls .worktrees 2>/dev/null` → empty or absent.
  - `git branch --list 'feat/home-page' 'feat/sidebar'` → both branches still exist.
  - A repeat of `grep -rn "_registrable_domain" --include="*.py" .` returns only the real
    `adapters/`, `tests/`, `domain/` hits (no `.worktrees/*` duplicates).
- **Acceptance criteria:**
  - [ ] `.worktrees/home-page` and `.worktrees/sidebar` are removed from the working copy.
  - [ ] `git worktree list` no longer lists nested worktrees.
  - [ ] `.gitignore` ignores `.worktrees/` (from the 06-M5 consolidated edit).
  - [ ] `feat/home-page` and `feat/sidebar` branches are preserved.
  - [ ] No nested-worktree duplicate hits in a recursive grep.

---

### 06-M4 — `skills-lock.json` points at a nonexistent skill path  [MEDIUM]

- **Files:** `skills-lock.json` (verified content):
  ```json
  {
    "version": 1,
    "skills": {
      "shadcn": {
        "source": "shadcn/ui",
        "sourceType": "github",
        "skillPath": "skills/shadcn/SKILL.md",
        "computedHash": "ac9d0d69caac7de1d1e5647f3db3bcd2f13af355d6b3a78780fbf7fc80e8dca0"
      }
    }
  }
  ```
- **Problem:** `skillPath` is `skills/shadcn/SKILL.md`, but `skills/` contains only the
  **4 Counselle agent skills** (`citation-and-recency`, `decode-coded-value`,
  `dossier-assembly`, `school-comparison` — verified `ls skills/`). The real shadcn skill
  lives at `.agents/skills/shadcn/SKILL.md`. The recorded path + hash describe a file
  that isn't where it says, so the lock can never verify — it's a stale tooling artifact
  that misleads anyone reconciling skills.
- **Fix:** Since 06-M5 untracks `.agents/` (the shadcn skill is **not vendored** into the
  product repo — it's a local agent-tooling cache), the lock file has nothing valid to
  point at within tracked source. **Remove it** (it tracks a tool that is no longer part
  of the repo's committed surface):
  ```bash
  git rm skills-lock.json
  ```
  > Rationale: the alternative (regenerate the lock against `.agents/skills/shadcn/SKILL.md`)
  > is wrong now that `.agents/` is gitignored — a lock pointing at an ignored path is
  > just as stale. The four real Counselle skills under `skills/` are not lock-managed by
  > this file (it only ever tracked shadcn). Removing it is the honest fix. If a future
  > decision vendors shadcn deliberately (an ADR), the lock can be regenerated then.
- **Tests / verification:** `ls skills-lock.json 2>/dev/null` → absent; `git ls-files skills-lock.json` → empty; the 4 real skills under `skills/` are untouched (`git ls-files skills/ | wc -l` unchanged).
- **Acceptance criteria:**
  - [ ] `skills-lock.json` is removed from the repo.
  - [ ] The four Counselle skills under `skills/` are untouched.

---

### 06-M6 — README DB-setup command will fail: `setup_db.sql` needs `-v` psql vars  [MEDIUM]

- **Files:**
  - `README.md:38` — `psql postgres < scripts/setup_db.sql`
  - `scripts/setup_db.sql:2,6,7` — header "passwords substituted at run time with -v"; `CREATE ROLE counselle_ro LOGIN PASSWORD :'ro_pw';` and `CREATE ROLE counselle_app LOGIN PASSWORD :'app_pw';` (verified).
- **Problem:** The SQL references unbound psql variables `:'ro_pw'` and `:'app_pw'`. The
  script's own header says they're "substituted at run time with -v", but the README's
  copy-paste command supplies neither, so `psql` errors on the first `CREATE ROLE`. This
  is the **first onboarding step**; a new maintainer following it verbatim fails
  immediately.
- **Fix:** Update the README command to pass the `-v` vars, matching the SQL's contract.

  `README.md:37-42` — **before:**
  ```bash
  psql postgres < scripts/setup_db.sql
  # Append ?schema=counselle so yoyo keeps its bookkeeping tables in the
  # counselle schema (owned by counselle_app), not in public.
  uv run yoyo apply --batch --database "${COUNSELLE_DB_APP_DSN}?schema=counselle" migrations/
  ```
  **after:**
  ```bash
  # setup_db.sql substitutes the role passwords at run time via -v (see the
  # script header). Supply both, matching the passwords in your .env DSNs.
  psql postgres \
    -v ro_pw="<counselle_ro password>" \
    -v app_pw="<counselle_app password>" \
    < scripts/setup_db.sql
  # Append ?schema=counselle so yoyo keeps its bookkeeping tables in the
  # counselle schema (owned by counselle_app), not in public.
  uv run yoyo apply --batch --database "${COUNSELLE_DB_APP_DSN}?schema=counselle" migrations/
  ```
  > Keep the placeholder angle-bracket form (`<...>`) so the reader substitutes their own
  > secrets — do **not** hardcode any password in the README. The `-v name=value` flags
  > bind the `:'ro_pw'`/`:'app_pw'` psql variables the script expects.
- **Tests / verification:** `grep -n "setup_db.sql" README.md` shows the command now
  includes `-v ro_pw=` and `-v app_pw=`. (A live `psql` run is not part of the gate — no
  DB-write access from the gate — but the command now matches `scripts/setup_db.sql`'s
  documented `-v` contract.)
- **Acceptance criteria:**
  - [ ] README `setup_db.sql` invocation passes `-v ro_pw=...` and `-v app_pw=...`.
  - [ ] No real password is hardcoded in the README (placeholders only).

---

### 06-M7 — `.dockerignore` is too thin; `COPY . .` pulls test/plan/mockup/worktree cruft into the build context  [MEDIUM]

- **Files:**
  - `Containerfile:14` — `COPY . .` (verified).
  - `.dockerignore` — 9 lines (verified): excludes `.env`, `.git/`, `.venv/`, `__pycache__/`, `*.pyc`, `.pytest_cache/`, `.mypy_cache/`, `.ruff_cache/`, `dist/`, `*.egg-info/`. (Wave-1 said "10 lines"; reality is 9 — same gist.)
- **Problem:** The build copies everything before `uv sync`. `.dockerignore` does **not**
  exclude `frontend/` (incl. a multi-hundred-MB `node_modules` if present locally),
  `tests/`, `plans/`, `mockups/`, `specs/`, `docs/`, `.worktrees/` (1.2 GB!), root `*.png`,
  `evals/report-*`, `.agents/`, `.claude/`. Result: larger/slower/less-reproducible image
  builds and a bigger attack surface (tests, plans, design mockups, eval reports have no
  business in the runtime container). Deploy is deferred (B6), so this is latent — but
  it's a foot-gun waiting for B6, and with `.worktrees/` at 1.2 GB the build context is
  enormous.
- **Fix:** Rewrite `.dockerignore` to exclude everything the backend runtime image
  doesn't need. The backend image needs: `config/`, `domain/`, `app/`, `adapters/`,
  `api/`, `counselle_db/`, `evals/` (it's a packaged wheel per `pyproject.toml`),
  `pyproject.toml`, `uv.lock`, `migrations/`, `scripts/`, `README.md`. It does NOT need
  the frontend source, tests, plans, specs, docs, mockups, worktrees, screenshots, eval
  *reports*, or agent tooling.

  **Replace the entire `.dockerignore`** with:
  ```dockerignore
  # Secrets & VCS
  .env
  .git/
  .gitignore

  # Python build / cache artifacts
  .venv/
  __pycache__/
  *.pyc
  .pytest_cache/
  .mypy_cache/
  .ruff_cache/
  .hypothesis/
  dist/
  *.egg-info/
  .coverage
  .coverage.*
  htmlcov/
  coverage.xml

  # Frontend source — the backend runtime image does not serve the SPA build here
  # (same-origin serving is a deferred B6 concern). node_modules is huge.
  frontend/

  # Not needed at runtime: tests, plans, specs, docs, design mockups, eval reports
  tests/
  plans/
  specs/
  mockups/
  docs/
  evals/report-*

  # Nested worktrees (1.2 GB of duplicated source) and local agent tooling
  .worktrees/
  .agents/
  .claude/
  .gstack/
  .playwright-mcp/

  # Design-iteration screenshot scratch
  *.png
  ```
  > Verify the runtime image still builds conceptually: `evals/` stays in (it's a wheel
  > package); `migrations/`, `scripts/`, `config/`, `domain/`, `app/`, `adapters/`,
  > `api/`, `counselle_db/` are NOT excluded, so `COPY . .` still brings them. `docs/` is
  > excluded — confirm no runtime code reads from `docs/` (verified: the agent reads its
  > prompts/assets from `config`/assets, not `docs/`). If a runtime path does need a
  > `docs/` file (it doesn't, per the audit), narrow the `docs/` exclusion.
  > **Deploy is deferred**, so this is not exercised by a real build in Phase 0 — the fix
  > is correctness-of-intent, not a tested image. Do not attempt a container build in the
  > gate.
- **Tests / verification:**
  - `.dockerignore` excludes (at minimum) `frontend/`, `tests/`, `plans/`, `specs/`, `mockups/`, `docs/`, `.worktrees/`, `.agents/`, `.claude/`, `evals/report-*`, `*.png`.
  - `.dockerignore` does NOT exclude `evals/` wholesale, `migrations/`, `scripts/`, or any backend package dir.
- **Acceptance criteria:**
  - [ ] `.dockerignore` excludes all the cruft listed above.
  - [ ] `.dockerignore` keeps the backend packages, `migrations/`, `scripts/`, and `evals/` (the package, not its reports).

---

### 06-L2 — `psycopg` (psycopg3) imported but not a declared direct dependency  [LOW]

- **Files:** `app/checkpointer.py:17-18` (`from psycopg import AsyncConnection`,
  `from psycopg.rows import dict_row` — verified); `pyproject.toml` declares no `psycopg`
  (verified — only `psycopg2-binary` in dev, transitively `psycopg` 3.3.4 is present via
  `langgraph-checkpoint-postgres`).
- **Problem:** `app/checkpointer.py` imports psycopg3 directly, but it resolves only
  transitively through `langgraph-checkpoint-postgres`. A future release that drops or
  repins psycopg3 would silently break the checkpointer. Direct imports should be direct
  deps.
- **Fix:** Add `psycopg[binary]` to `[project].dependencies`. (The Containerfile installs
  `libpq5` for the non-binary path, but `[binary]` is the safest declaration for local
  dev + matches how it's currently resolving; the wheel ships its own libpq.)

  `pyproject.toml` `[project].dependencies` — **before** (lines 7-25):
  ```toml
  dependencies = [
      "asyncpg>=0.31.0",
      "fastapi>=0.136.3",
      "fastapi-users[oauth]>=15.0.5",
      "google-genai>=2.8.0",
      "httpx>=0.28.1",
      "langgraph>=1.2.4",
      "langgraph-checkpoint-postgres>=3.1.0",
      "mcp>=1.27.2",
      "pydantic>=2.13.4",
      "pydantic-ai>=1.107.0",
      "pydantic-settings>=2.14.1",
      "pyyaml>=6.0.3",
      "sse-starlette>=3.4.4",
      "structlog>=26.1.0",
      "tavily-python>=0.7.25",
      "uvicorn>=0.49.0",
      "yoyo-migrations>=9.0.0",
  ]
  ```
  **after** (add `psycopg[binary]` — keep alphabetical-ish order; insert after `mcp`):
  ```toml
  dependencies = [
      "asyncpg>=0.31.0",
      "fastapi>=0.136.3",
      "fastapi-users[oauth]>=15.0.5",
      "google-genai>=2.8.0",
      "httpx>=0.28.1",
      "langgraph>=1.2.4",
      "langgraph-checkpoint-postgres>=3.1.0",
      "mcp>=1.27.2",
      "psycopg[binary]>=3.3.0",
      "pydantic>=2.13.4",
      "pydantic-ai>=1.107.0",
      "pydantic-settings>=2.14.1",
      "pyyaml>=6.0.3",
      "sse-starlette>=3.4.4",
      "structlog>=26.1.0",
      "tavily-python>=0.7.25",
      "uvicorn>=0.49.0",
      "yoyo-migrations[postgres]>=9.0.0",
  ]
  ```
  (The `yoyo-migrations[postgres]` change is 06-L3, folded into the same edit — see below.)

  Then resolve the lock:
  ```bash
  uv sync
  ```
- **Tests / verification:** `grep -n 'psycopg\[binary\]' pyproject.toml` → present; `uv sync` succeeds; `uv run python -c "import psycopg; print(psycopg.__version__)"` → `3.3.x`; routine pytest still green.
- **Acceptance criteria:**
  - [ ] `psycopg[binary]>=3.3.0` is a declared `[project].dependency`.
  - [ ] `uv sync` resolves cleanly and `app/checkpointer.py`'s import still works.

---

### 06-L3 — `psycopg2-binary` is a loose dev dep instead of `yoyo-migrations[postgres]`  [LOW]

- **Files:** `pyproject.toml:33` (`psycopg2-binary>=2.9.12` in dev), `:24`
  (`yoyo-migrations>=9.0.0`, no extra). Verified: `psycopg2-binary` 2.9.12 IS installed
  and is imported **nowhere** in source (`grep psycopg2 --include="*.py"` → empty); yoyo
  declares `psycopg2 ; extra == 'postgres'` (verified via `importlib.metadata.requires`).
  The README's `uv run yoyo apply` works today only because the loose dev pin happens to
  satisfy yoyo's runtime psycopg2 need.
- **Problem:** The coupling is implicit — `psycopg2-binary` exists in dev solely to feed
  yoyo, but nothing declares that relationship. If someone removes the "unused" dev dep,
  `yoyo apply` breaks.
- **Fix:** Request the proper extra and drop the standalone pin. The
  `yoyo-migrations[postgres]` change is already in the 06-L2 `dependencies` edit above
  (`"yoyo-migrations[postgres]>=9.0.0"`). Now remove `psycopg2-binary` from the dev group.

  `pyproject.toml` `[dependency-groups].dev` — **before** (lines 28-38):
  ```toml
  dev = [
      "anyio>=4.13.0",
      "bandit>=1.9.4",
      "hypothesis>=6.155.2",
      "mypy>=2.1.0",
      "psycopg2-binary>=2.9.12",
      "pytest>=9.0.3",
      "pytest-asyncio>=1.4.0",
      "ruff>=0.15.16",
      "types-pyyaml>=6.0.12.20260518",
  ]
  ```
  **after** (drop `anyio` per 06-L4, drop `psycopg2-binary` per 06-L3, add `pytest-cov`
  per 06-L8 — all dev-group edits consolidated):
  ```toml
  dev = [
      "bandit>=1.9.4",
      "hypothesis>=6.155.2",
      "mypy>=2.1.0",
      "pytest>=9.0.3",
      "pytest-asyncio>=1.4.0",
      "pytest-cov>=6.0.0",
      "ruff>=0.15.16",
      "types-pyyaml>=6.0.12.20260518",
  ]
  ```
  Then `uv sync`. (psycopg2 now arrives via the `yoyo-migrations[postgres]` extra.)

  > **AS-BUILT DEVIATION (2026-06-16, empirically verified — reality wins per this
  > plan's own deviation rule).** The snippet above assumed `yoyo-migrations[postgres]`
  > would supply an *importable* psycopg2. On Linux it does NOT: the `psycopg2`
  > (non-binary) distribution that the `[postgres]` extra requires ships **zero Linux
  > wheels** — only an sdist that must be compiled (gcc + libpq-dev). Verified against
  > PyPI: `psycopg2` 2.9.12 → 0 linux wheels; `psycopg2-binary` 2.9.12 → 48 manylinux
  > wheels. Confirmed by direct experiment: with `yoyo-migrations[postgres]` and
  > **no** `psycopg2-binary`, a clean `uv sync` leaves `import psycopg2` raising
  > `ModuleNotFoundError`, which breaks the README `uv run yoyo apply` onboarding step.
  >
  > The two original acceptance bullets ("remove psycopg2-binary" vs "psycopg2 still
  > importable after uv sync") are therefore **mutually exclusive** on Linux. The
  > importability/onboarding criterion governs (it has real consequences; the
  > "remove the binary" bullet was a cosmetic nicety premised on a false assumption).
  >
  > **As-built end state:** keep `yoyo-migrations[postgres]` (declares the
  > yoyo↔psycopg relationship — the real point of 06-L3) AND keep
  > `psycopg2-binary>=2.9.12` in the dev group (the only Linux-importable provider),
  > with a comment in `pyproject.toml` documenting the binary↔source coupling. The
  > dev-group "after" snippet above is thus amended to retain `psycopg2-binary`.
- **Tests / verification:** `uv sync` succeeds; `uv run python -c "import psycopg2; print(psycopg2.__version__)"` → **must succeed** (this is the binding criterion); `grep -n 'yoyo-migrations\[postgres\]' pyproject.toml` → present.
- **Acceptance criteria:**
  - [ ] `yoyo-migrations[postgres]>=9.0.0` is declared (extra, not bare).
  - [ ] `psycopg2` is importable after `uv sync` (BINDING — the README `yoyo apply` step depends on it). On Linux this requires retaining `psycopg2-binary` in the dev group; the original "remove psycopg2-binary" bullet is **retracted** per the AS-BUILT DEVIATION above (psycopg2 source ships no Linux wheels).
  - [ ] The yoyo↔psycopg coupling is documented (comment in `pyproject.toml`).

---

### 06-L4 — `anyio` is a declared dev dependency but never imported  [LOW]

- **Files:** `pyproject.toml:29` (`anyio>=4.13.0` in dev). Verified: `grep -rl "import anyio\|from anyio"` across `app/ api/ tests/ counselle_db/ domain/ adapters/ config/` → **empty**. (pytest-asyncio is the async test driver; anyio rides in transitively anyway.)
- **Problem:** Dead dev dependency — declared but unused.
- **Fix:** Already removed in the consolidated dev-group edit under 06-L3 above (the
  `anyio>=4.13.0` line is dropped). No separate edit needed beyond that.
- **Tests / verification:** `grep -n 'anyio' pyproject.toml` → empty; `uv sync` succeeds; routine pytest still green (anyio remains available transitively for anything that needs it, but nothing in-repo imports it directly).
- **Acceptance criteria:**
  - [ ] `anyio` is no longer a declared dev dependency.
  - [ ] The routine test suite still passes after `uv sync`.

---

### 06-L5 — `bandit` is declared but unwired; no script or gate runs it  [LOW]

- **Files:** `pyproject.toml:30` (`bandit>=1.9.4`). Verified: the only `bandit` hit in
  tracked source is the pyproject line — no CI, no `scripts/`, no Makefile invokes it.
- **Problem:** A security scanner installed but never run gives false comfort. The
  workflow rules (Phase 7) expect bandit to run; nothing invokes it.
- **Fix:** **Keep the dep and WIRE it** (do not drop it — the project wants a security
  scan). Add a documented invocation to the README's commands block and make it part of
  the Phase-0 gate (and the standing dev workflow). Add a `[tool.bandit]` config so the
  scan targets the backend source and skips the noise.

  **(a) Add `[tool.bandit]` to `pyproject.toml`** (append after `[tool.pytest.ini_options]`):
  ```toml
  [tool.bandit]
  # Scan the backend source only (the honesty/auth/DB paths). Tests, plans, the
  # frontend, and vendored/tooling dirs are out of scope.
  exclude_dirs = ["tests", "frontend", ".worktrees", ".agents", ".claude", "evals"]
  ```
  (Targets are passed on the command line; `exclude_dirs` belongs to the config.)

  **(b) Document the command in `README.md`** (in the commands block, after the
  ruff+mypy line — `README.md:96`):
  ```bash
  # Lint + type-check:
  uv run ruff check . && uv run mypy .

  # Security scan (bandit) over the backend source:
  uv run bandit -r app api counselle_db config adapters domain -q
  ```
  > `-q` suppresses the per-file progress noise; the scan must exit 0. If bandit flags a
  > genuine issue, that is **out of scope for Phase 0** — record it as a deferred finding
  > for the Phase-7/security pass and add a targeted `# nosec` with a one-line rationale
  > only if it is a confirmed false positive (e.g. the parameterized-SQL guard). Do not
  > suppress real findings; report them up.
- **Tests / verification:** `uv run bandit -r app api counselle_db config adapters domain -q` exits 0 (or, if it surfaces findings, they're enumerated and reported to the orchestrator, not silently suppressed). `grep -n 'bandit' README.md pyproject.toml` shows it declared AND invoked.
- **Acceptance criteria:**
  - [ ] `bandit` is still a declared dev dep.
  - [ ] A bandit invocation is documented in the README and runs as part of this phase's gate.
  - [ ] `[tool.bandit]` config exists with sensible exclusions.
  - [ ] The bandit scan exits 0 (or any finding is reported to the orchestrator with a disposition, not silently hidden).

---

### 06-L8 — `pytest-cov` is not a dev dependency; the documented coverage workflow can't run  [LOW]

- **Files:** `pyproject.toml` dev group (no `pytest-cov` — verified). The global testing
  rule + CLAUDE house-rules imply coverage matters; `uv run pytest --cov=…` currently
  fails with `unrecognized arguments: --cov` (coverage only ran via `uv run --with pytest-cov`).
- **Problem:** No first-class way to measure coverage from committed config — nobody can
  reproduce a coverage number.
- **Fix:** `pytest-cov` is already added to the dev group in the consolidated 06-L3 edit
  above (`"pytest-cov>=6.0.0"`). Additionally add a `[tool.coverage]` config so a bare
  `--cov` has sane defaults, and ensure the run artifacts are gitignored (done in the
  06-M5 `.gitignore` edit — `.coverage`, `.coverage.*`, `htmlcov/`, `coverage.xml`).

  **Append to `pyproject.toml`** (after `[tool.bandit]`):
  ```toml
  [tool.coverage.run]
  branch = true
  source = ["config", "domain", "app", "adapters", "api", "counselle_db", "evals"]
  omit = ["tests/*", "*/__pycache__/*", "*/__init__.py"]

  [tool.coverage.report]
  show_missing = true
  skip_covered = false
  ```
  > **This is the single canonical `[tool.coverage]` block.** Phase 0 OWNS the
  > `[tool.coverage]` config (and the `pytest-cov` dep, and the coverage gitignore
  > entries — see 06-M5). Phase 7 does **not** re-add the dep or this config block;
  > it only documents the `--cov` README command and sets coverage *targets*. The
  > `omit` list intentionally covers both intents (`*/__pycache__/*` and
  > `*/__init__.py`) so Phase 7 has nothing to diverge on.
  > Do NOT add `--cov` to `addopts` — that would force coverage on every test run
  > (including the fast routine loop reviewers use), slowing the inner gate. Coverage is
  > opt-in via the documented `--cov` flag. (The audit's L7 — raising the *actual*
  > coverage of viz/service — is **Phase 7**, not here. Phase 0 only makes the tool
  > runnable.)
- **Tests / verification:**
  - `uv run pytest -m "not live_llm and not live_search" --cov=. --cov-report=term-missing -q | tail -5` runs and prints a coverage table (no "unrecognized arguments").
  - The `.coverage` file produced is gitignored (`git status` doesn't list it).
- **Acceptance criteria:**
  - [ ] `pytest-cov>=6.0.0` is in the dev group.
  - [ ] `uv run pytest --cov=. ...` works out of the box.
  - [ ] `[tool.coverage.run]`/`[tool.coverage.report]` config exists.
  - [ ] Coverage artifacts (`.coverage`, `htmlcov/`, `coverage.xml`) are gitignored.

---

## Cross-phase notes

- **06-H3 split (READ THIS, Phase 7):** Phase 0 fixed only the **count references**
  (`evals/runner.py` docstring, `README.md`). The **eval re-baseline RUN** — regenerate
  `report-<date>.{json,md}`, delete the stale `evals/report-2026-06-11.json` (which still
  says `"total": 50`) — is **Phase 7's** responsibility (it costs ~$2–3 in live Gemini
  and should reflect all 1–6 fixes). Phase 7 must: run `uv run python -m evals.runner`,
  diff against `report-2026-06-11.json` per the §4 risk-register requirement (justify any
  score drop), commit the fresh baseline, and remove the stale one. **The stale report is
  intentionally left untouched in Phase 0.**
- **06-L1 CORS default** is NOT in Phase 0 — it's Phase 6 (config/security knobs).
- **M2 / 06-M2 Tavily `.env` side-parser** is NOT in Phase 0 — it's Phase 6.
- **06-L6 (structlog migration) and 06-L7 (viz/service coverage)** are Phase 7. Phase 0
  only made the coverage tool *runnable* (06-L8); it does not raise coverage.
- **06-L8 ownership split:** Phase 0 OWNS the `pytest-cov` dependency add, the canonical
  `[tool.coverage]` config block, and the `.coverage*`/`htmlcov/`/`coverage.xml` gitignore
  entries. **Phase 7 must NOT re-add the dep or the config block** — Phase 7's 06-L8 scope
  is narrowed to the README `uv run pytest --cov` doc + coverage-target language only.
- **`feat/*` branch cleanup:** Phase 0 removed the two *nested* worktrees and pruned, but
  deliberately left the `feat/home-page`, `feat/sidebar`, `feat/composer-polish`,
  `feat/reasoning-experience`, `feat/timeline-source-chips` **branches** and the three
  **sibling** worktrees (`../counselle-*`) alone. Whether those branches are merged or
  abandoned is a human decision outside this hardening pass — note it in `TODOS.md` if not
  already tracked.
- **`.coverage` already untracked at audit time:** `git status` showed a `.coverage`
  artifact and the `plans/audit/` dir as untracked. The `.gitignore` edit covers
  `.coverage`; `plans/audit/` is this plan itself and will be committed separately by the
  orchestrator (not part of the Phase-0 code commit).

---

## Phase completion checklist

Gate (all must pass — see "Gate commands" above):
- [ ] `uv run ruff check .` clean.
- [ ] `uv run mypy .` GREEN (zero errors) — the headline 06-H1 fix.
- [ ] `uv run pytest -m "not live_llm and not live_search"` all pass (≈448).
- [ ] `uv sync` resolves cleanly after the dependency edits.
- [ ] `uv run bandit -r app api counselle_db config adapters domain -q` exits 0 (or findings reported with disposition).
- [ ] `uv run pytest --cov=. --cov-report=term-missing -q` runs (no "unrecognized arguments").

Per-finding (every owned finding closed):
- [ ] 06-H1 — `__all__` exports `_registrable_domain`; mypy green.
- [ ] 06-H3 — "50" count references removed from `evals/runner.py` + `README.md`; stale report left for Phase 7.
- [ ] 06-M1 — ADR count 23→24 in `CLAUDE.md:60` + `README.md:114`.
- [ ] 01-L2 — tool count 10→11 in `app/toolset.py:140` + `counselle_db/service.py:646`.
- [ ] 01-L3 — `thinking_summaries` docs say default **off** (`docs/ARCHITECTURE.md` §18/§27.2/§35); code unchanged.
- [ ] 06-M3 — root `*.png` deleted; ignored.
- [ ] 06-M5 — `.agents/` + `.claude/` untracked (`git rm --cached`) and ignored.
- [ ] 01-L1 / 06-L9 — nested `.worktrees/{home-page,sidebar}` removed + pruned; `.worktrees/` ignored; `feat/*` branches preserved.
- [ ] 06-M4 — `skills-lock.json` removed; the 4 real skills untouched.
- [ ] 06-M6 — README `setup_db.sql` command passes `-v ro_pw=` / `-v app_pw=`; no hardcoded secrets.
- [ ] 06-M7 — `.dockerignore` expanded (frontend/tests/plans/specs/mockups/docs/.worktrees/.agents/.claude/eval-reports/*.png excluded; backend packages + migrations + scripts + evals package kept).
- [ ] 06-L2 — `psycopg[binary]` declared.
- [ ] 06-L3 — `yoyo-migrations[postgres]` extra declared; `psycopg2` importable after `uv sync` (BINDING). Per the AS-BUILT DEVIATION, `psycopg2-binary` is **retained** on Linux (psycopg2 source ships no Linux wheels); the original "drop psycopg2-binary" bullet is retracted.
- [ ] 06-L4 — `anyio` dev dep removed.
- [ ] 06-L5 — bandit wired (README command + `[tool.bandit]` + gate); kept as dep.
- [ ] 06-L8 — `pytest-cov` dep added; canonical `[tool.coverage]` config; artifacts gitignored. (Phase 7 owns only the README `--cov` doc + coverage targets — it must NOT re-add the dep or config.)

Hygiene assertions:
- [ ] `git ls-files .agents .claude skills-lock.json` → empty.
- [ ] `git worktree list` → no nested worktrees.
- [ ] `ls *.png` → empty.
- [ ] `! grep -rn "all 23 ADR\|23 architectural decision\|all 10 tools\|10th tool\|all 50\|50-question" CLAUDE.md README.md app/toolset.py counselle_db/service.py evals/runner.py`.

Commit (only after ≥3 Sonnet reviewers return unanimous SHIP):
- [ ] Stage file-by-file (never `git add -A`). Include: `adapters/tavily_tools.py`, `pyproject.toml`, `uv.lock`, `.gitignore`, `.dockerignore`, `CLAUDE.md`, `README.md`, `app/toolset.py`, `counselle_db/service.py`, `evals/runner.py`, `docs/ARCHITECTURE.md`, and the deletions (`git rm --cached` of `.agents`/`.claude`, `git rm` of `skills-lock.json`).
- [ ] Conventional commit: `chore(phase0): restore mypy gate, clean repo hygiene, truth-up doc counts & deps`.
