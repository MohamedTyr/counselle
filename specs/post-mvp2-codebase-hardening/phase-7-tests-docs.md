# Phase 7 — Tests, Coverage, Evals & Docs Truth-Up (close-out)

> **Execution:** follow the per-phase loop in `plans/audit/REMEDIATION-PLAN.md` §2
> (Opus implementers → gate → ≥3 Sonnet non-leading reviewers → fix↔review until
> unanimous SHIP → commit). This is the **final** phase: it locks in everything
> fixed in Phases 1–6 with coverage, structured logging, a fresh eval baseline,
> a regression-test coverage audit, and truthful docs. Implement EVERYTHING
> below; **miss nothing**. Where a snippet is given, treat it as the intended
> shape and adapt to the real current code (read the actual files — line numbers
> drift across phases).
>
> **Why this phase is last (dependency note):** Phase 7's regression-test audit
> can only verify tests that Phases 1–6 *authored*. Its eval re-baseline must run
> against the *final* post-Phase-6 code. Its docs truth-up must describe the
> *finished* refactor (new modules from Phase 3, new Settings fields from Phase 6,
> corrected counts). Do not run Phase 7 before 1–6 are committed and green.

---

## Scope & files touched

**New test files (created here):**
- `tests/evals/__init__.py` — make the eval-tests a package.
- `tests/evals/test_scorers.py` — the eval scoring-logic unit tests (06-H2).
- `tests/app/test_viz_pure.py` (or additions to existing) — DB-free viz decision-logic tests (06-L7).
- `tests/counselle_db/test_service_pure.py` — DB-free service decision-logic tests (06-L7), if extraction is chosen.

**Modified production code:**
- `app/viz.py` — stdlib `logging` → structlog (06-L6); possibly extract pure decision helpers (06-L7).
- `adapters/tavily_tools.py` — stdlib `logging` → structlog (06-L6); the inline `.env` reader's `import logging as _logging` block (note: M2 in Phase 6 may already have deleted this whole block — coordinate; see cross-phase note).
- `counselle_db/service.py` / `counselle_db/service_find.py` / `counselle_db/search_fields.py` / `app/titles.py` — possibly extract pure decision helpers for DB-free testing (06-L7).
- `evals/runner.py` — the **dynamic** de-hardcode only: where the runner PRINTS/logs a question count, derive it from `len(load_questions())`. *(The **static** docstring "50" text + README "50" wording are Phase 0's static fix — already done there; do NOT re-edit the docstring literal here.)*

**Modified config:**
- *(none for 06-L8 — the `pytest-cov` dep and the `[tool.coverage]` config block landed in **Phase 0**; Phase 7 only documents the `--cov` command in `README.md`. Do NOT re-add the dep or config here.)*

**Regenerated artifacts:**
- `evals/report-<today>.json` + `evals/report-<today>.md` — fresh baseline (replaces the stale `report-2026-06-11.*`; `.gitignore` keeps exactly one).

**Docs (truth-up):**
- `CLAUDE.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/adr/README.md` (+ possibly two new ADRs).
- `TODOS.md` — record any deferred MEDIUM with one-line rationale.

**Cross-phase notes (read before touching shared files):**
- **`adapters/tavily_tools.py`:** Phase 6 (CFG / M2) removes the hand-rolled `.env` reader in `make_tavily_client`. If that landed, the only structlog change left here is the *remaining* `logging` import/use (there may be none). If M2 was *not* done in Phase 6, do the structlog swap on whatever `logging` calls remain. **Do not re-introduce the `.env` reader.** Verify the current state of the file first.
- **`pyproject.toml`:** Phase 0 OWNS all dep + coverage-config edits — `pytest-cov`, the canonical `[tool.coverage]` block, plus psycopg/yoyo extra/anyio removal/bandit. **Phase 7 does NOT touch `pyproject.toml` for 06-L8** (no dep re-add, no config re-author). Phase 7 only verifies Phase 0's edits are present before running the coverage gate, and documents the `--cov` command in `README.md`. Do not undo Phase 0's dep edits.
- **`evals/runner.py`:** the 06-H3 work is split. **Phase 0 owns the STATIC text fix** — the literal "50" in the `runner.py` docstring (line 20) and in `README.md` are changed to neutral wording ("the full set") *there, already done*. **Phase 7 owns ONLY (a) the DYNAMIC de-hardcode** (where the runner actually prints/logs a count → derive from `len(load_questions())`) **and (b) the eval RE-BASELINE run**. Do NOT re-edit the static docstring/README literal here — confirm Phase 0 did it, then do the dynamic count + the run.
- **`config/settings.py` / new Settings fields:** Phase 6 adds fields (CFG-01 school_count, CFG-03 password length, etc.). Phase 7's docs truth-up enumerates them but does **not** add them — verify they exist before documenting.

---

## Gate commands (this phase = the FULL pre-merge gate)

Run the **entire** set — Phase 7 is the close-out, so its gate is the whole-plan
definition-of-done (`REMEDIATION-PLAN.md` §2.5):

```bash
# Backend lint + types (zero-tolerance)
uv run ruff check .
uv run mypy .

# Routine suite (no live deps) — must include the NEW scorer + pure-logic tests
uv run pytest -m "not live_llm and not live_search and not live_db"

# Coverage (NEW — must work out of the box after 06-L8)
uv run pytest -m "not live_llm and not live_search and not live_db" \
  --cov=evals --cov=app --cov=counselle_db --cov-report=term-missing

# Full suite incl. live (Gemini + Tavily + DB)
uv run pytest

# Frontend
cd frontend && npm run typecheck && npm test && npm run build

# Eval re-baseline (regenerates evals/report-<today>.{json,md})
uv run python -m evals.runner
```

A green Phase 7 gate means: ruff clean, mypy clean, routine + live pytest 100%
pass, the new scorer tests present and passing, coverage command runs, frontend
typecheck/test/build green, and a fresh eval baseline committed with the
score-diff justification (see the eval re-baseline section).

---

## Findings & fixes

### 06-H2 — Eval scoring logic is shipped with ZERO tests  [HIGH]

- **Files:** new `tests/evals/__init__.py`, `tests/evals/test_scorers.py`.
- **Problem:** `evals/runner.py` ships pure, bug-prone scoring logic with no unit
  tests (`grep evals tests/` is empty). The eval report is "the deliverable"
  (PRD story 58) and the honesty pitch leans on it. A silent regression in
  `value_in_prose` (e.g. a boundary that lets `5` match inside `35`) would
  corrupt every fact verdict invisibly — only a ~$2–3 live run would surface it.
  These are the cheapest, highest-leverage tests in the repo.
- **Fix:** add `tests/evals/test_scorers.py` with **no live deps** (no DB, no
  Gemini, no Tavily — pure function tests against hand-built `TurnCapture`s). The
  real function signatures (verified against `evals/runner.py` as of this audit):

  - `value_in_prose(value: str, prose: str) -> bool` (runner.py:180)
  - `_fields_seen(fields: list[str], capture: TurnCapture) -> list[str]` (runner.py:193)
  - `score_fact(expects: dict, capture: TurnCapture) -> dict[str, dict]` (runner.py:199)
  - `score_field_selection(expects, capture) -> dict[str, dict]` (runner.py:218)
  - `score_clarify(expects, capture) -> dict[str, dict]` (runner.py:238)
  - `score_viz(expects, capture) -> dict[str, dict]` (runner.py:248)
  - `build_report(results: list[dict], model: str) -> dict` (runner.py:464)
  - `render_markdown(report: dict) -> str` (runner.py:487)
  - `TurnCapture` dataclass (runner.py:113) — fields: `events, prose, tool_calls,
    args_blob, returns_blob, sources, vizzes, clarifies, done_status, errored, usage`.

  **A test-helper factory** (put at the top of the test file) keeps every test
  short — `TurnCapture` has 11 required fields, most irrelevant per test:

  ```python
  from evals.runner import (
      TurnCapture, value_in_prose, _fields_seen,
      score_fact, score_field_selection, score_clarify, score_viz,
      build_report, render_markdown,
  )

  def make_capture(
      *, prose="", tool_calls=None, args_blob="", returns_blob="",
      vizzes=None, clarifies=None, done_status=None, errored=False,
  ) -> TurnCapture:
      return TurnCapture(
          events=[], prose=prose, tool_calls=tool_calls or [],
          args_blob=args_blob, returns_blob=returns_blob, sources=[],
          vizzes=vizzes or [], clarifies=clarifies or [],
          done_status=done_status, errored=errored, usage=None,
      )
  ```

  **`value_in_prose` — the highest-priority function. Cover EVERY branch:**

  | Case | Call | Expect | Why |
  |---|---|---|---|
  | exact match | `value_in_prose("5%", "the rate is 5%")` | `True` | baseline |
  | comma-insensitive value | `value_in_prose("16,000", "tuition is 16000 dollars")` | `True` | value has comma, prose doesn't |
  | comma-insensitive prose | `value_in_prose("16000", "tuition is 16,000")` | `True` | prose has comma, value doesn't |
  | case-insensitive | `value_in_prose("Public", "it is public")` | `True` | `re.IGNORECASE` |
  | **digit-boundary left (the H2 example)** | `value_in_prose("5", "graduation rate is 35")` | `False` | `5` must NOT match inside `35` (`(?<![\d.])`) |
  | **digit-boundary right** | `value_in_prose("5", "it is 50 percent")` | `False` | `5` must NOT match inside `50` (`(?!\d)`) |
  | decimal-point left guard | `value_in_prose("5", "the value 3.5 here")` | `False` | `(?<![\d.])` blocks after a `.` |
  | standalone digit ok | `value_in_prose("5", "exactly 5 schools")` | `True` | bounded both sides |
  | negative "negative $X" fallback | `value_in_prose("-$2,610", "net price is negative $2,610")` | `True` | the `startswith("-")` unsigned fallback |
  | negative no-match | `value_in_prose("-2610", "the value is 9999")` | `False` | fallback still misses |
  | no match | `value_in_prose("42", "no numbers here")` | `False` | negative case |
  | percent with trailing context | `value_in_prose("7.4%", "admit rate 7.4% overall")` | `True` | real fact shape |

  **`_fields_seen`:**
  - field present in `args_blob` → returned. `make_capture(args_blob='["admissions.acceptance_rate"]')`, `_fields_seen(["admissions.acceptance_rate"], cap) == ["admissions.acceptance_rate"]`.
  - field present in `returns_blob` only → returned (haystack is `args_blob + "\n" + returns_blob`).
  - field absent from both → not returned (empty list).
  - order preserved: input `["a", "b"]` both present → `["a", "b"]`; only `b` present → `["b"]`.

  **`score_fact` — exercise all three sub-checks (each is a `{"passed": bool, "detail": str}` dict):**
  - happy path: `expects={"tools": ["get_values"], "fields": ["admissions.acceptance_rate"], "values": ["7%"]}`, capture has a `get_values` tool_call, the field in `args_blob`, the value in prose → all three of `db_tool_called`, `field_used`, `value_in_prose` `passed=True`.
  - no value-bearing tool: tool_calls = `[{"tool_name": "search_fields"}]` → `db_tool_called.passed is False`.
  - default tools fallback: `expects` omits `"tools"` → falls back to `VALUE_BEARING_TOOLS` (frozenset incl. `get_values, get_dossier, compare_schools, national_benchmark, query_database`). A `compare_schools` call passes `db_tool_called`.
  - field not seen → `field_used.passed is False`, detail mentions the expected list.
  - value not in prose → `value_in_prose.passed is False`.

  **`score_field_selection`:**
  - right field present → `right_field.passed is True`.
  - `field_not` given and the trap field appears in `args_blob` → `trap_field_avoided.passed is False`.
  - **trap checked against ARGS ONLY:** trap field in `returns_blob` but NOT `args_blob` → `trap_field_avoided.passed is True` (a dossier RETURN may bundle a sibling field the agent never asked for — this is the documented carve-out at runner.py:226).
  - no `field_not` key → `trap_field_avoided` not in the returned checks dict at all.

  **`score_clarify`:**
  - `must_clarify=True` + a clarify event fired + `done_status == "awaiting_input"` → `clarify_fired.passed is True`.
  - `must_clarify=True` + clarify fired but `done_status="complete"` → `clarify_fired.passed is False` (both conditions required).
  - `must_clarify=False` + no clarify + `done_status="complete"` → `no_clarify.passed is True`.
  - `must_clarify=False` + a clarify fired → `no_clarify.passed is False`.

  **`score_viz`:**
  - viz type matches + wanted unitids ⊆ rendered → `viz_rendered.passed is True`. Build `vizzes=[{"type": "comparison_table", "schools": [{"unitid": 100, "name": "A"}, {"unitid": 200, "name": "B"}]}]`, `expects={"viz_type": "comparison_table", "unitids": [100, 200]}`.
  - **superset is OK** (`wanted <= unitids`): rendered has `{100, 200, 300}`, wanted `{100, 200}` → `True`.
  - **missing one school fails** (subset check): rendered has `{100}`, wanted `{100, 200}` → `False`.
  - **wrong type fails**: rendered type `stat_block`, wanted `comparison_table` → `False`.
  - no vizzes → `False`.

  **`build_report`:**
  - mixed results → per-type accuracy: pass 2 of 3 `fact` results, 1 of 1 `honesty` → `per_type["fact"] == {"passed": 2, "total": 3, "accuracy": 0.667}` (rounded to 3), `per_type["honesty"]["accuracy"] == 1.0`. Top-level `total == 4`, `passed == 3`.
  - a `QUESTION_TYPES` member with zero results is **omitted** from `per_type` (the `if not scoped: continue` at runner.py:469).
  - `model` is passed through verbatim; `generated_at` is an ISO string (assert it's a non-empty `str` / parseable — don't pin the timestamp).
  - empty results list → `total == 0`, `passed == 0`, `per_type == {}`.

  **`render_markdown`:**
  - feed a `build_report` output → assert the markdown contains the header `# Eval report — <date>`, the model line, the `## Per-type accuracy` table header, and one `| <id> | <type> | PASS/FAIL | ... |` row per result.
  - a result with a failed check → its row shows `FAIL` and the failed-check name in the "Failed checks" cell; an all-pass result shows `PASS` and `—`.
  - date prefix: `report["generated_at"][:10]` appears in the H1.

- **Acceptance criteria:**
  - [ ] `tests/evals/test_scorers.py` exists; `tests/evals/__init__.py` exists.
  - [ ] Every function in the H2 list has ≥1 test; `value_in_prose` has all 12 cases above incl. the `5`-inside-`35` boundary case.
  - [ ] Tests import only from `evals.runner` (no `app.deps`, no DB, no live model). They run under `pytest -m "not live_*"` with no env/credentials.
  - [ ] `uv run pytest tests/evals/test_scorers.py` is green.
  - [ ] Coverage of `evals/runner.py` for the listed pure functions is ≥90% (verify with `--cov=evals --cov-report=term-missing`).

---

### 06-L6 — Production modules use stdlib `logging` instead of structlog  [LOW]

- **Files:** `app/viz.py` (lines 12, 23), `adapters/tavily_tools.py` (lines 142–159, the inline-`.env` block — coordinate with Phase 6/M2).
- **Problem:** `config/logging.py` + `tests/test_logging.py` establish structlog
  (JSON renderer, ISO timestamps, `trace_id` contextvar binding) as the logging
  contract. `app/viz.py` does `import logging` / `logging.getLogger(__name__)`;
  `adapters/tavily_tools.py` does `import logging as _logging` inside
  `make_tavily_client`. Lines from these paths won't carry `trace_id` or the JSON
  shape, fragmenting observability — and `viz.py` is on the **honesty-critical
  number-fetch path** where traceability matters most.
- **Fix:**
  - `app/viz.py`: replace `import logging` with `import structlog` and
    `logger = logging.getLogger(__name__)` with `logger = structlog.get_logger(__name__)`.
    The existing call sites use `%`-style args (`logger.warning("viz: website
    lookup failed for %s; rendering without logos", unitids)` and
    `logger.exception("render_viz: unexpected error ... (type=%s, unitids=%s)",
    type, unitids)`). structlog's stdlib-style proxy accepts positional args, but
    the **idiomatic** form (and what matches the rest of the codebase, e.g.
    `app/titles.py`, `counselle_db/search_fields.py`) is structured kwargs:
    ```python
    logger.warning("viz website lookup failed; rendering without logos", unitids=unitids)
    logger.exception("render_viz unexpected error building spec", type=type, unitids=unitids)
    ```
    Convert both to kwargs form (no `%s` interpolation) so they emit clean JSON.
  - `adapters/tavily_tools.py`: **first check whether Phase 6/M2 deleted the
    inline `.env` reader.** If the `import logging as _logging` block is gone,
    there is nothing to do here — confirm no other `logging` use remains. If the
    block still exists, replace `_logging.getLogger(__name__)` with a
    module-level `logger = structlog.get_logger(__name__)` (add the `import
    structlog` at the top) and convert the two `.debug(...)` calls to structlog
    kwargs form. Do not leave a mixed stdlib/structlog file.
- **Acceptance criteria:**
  - [ ] `grep -rn "import logging" app/viz.py adapters/tavily_tools.py` returns nothing (or only inside a comment).
  - [ ] Both modules use `structlog.get_logger(__name__)`.
  - [ ] Log calls use structured kwargs, not `%s` interpolation.
  - [ ] `uv run ruff check .` and `uv run mypy .` stay green.
  - [ ] A spot-test (or existing `test_logging.py`-style check) confirms a viz warning emits JSON with the standard fields when logging is configured.

---

### 06-L7 — Honesty-critical viz/service code has low routine-suite coverage  [LOW]

- **Files:** `app/viz.py` (36%), `counselle_db/service.py` (28%),
  `counselle_db/service_find.py` (38%), `counselle_db/search_fields.py` (43%),
  `app/titles.py` (34%); `tests/app/test_viz.py` is `pytestmark = live_db`.
- **Problem:** the lowest-covered code in the routine suite is precisely the
  data-access + viz code where the project's one non-negotiable ("never lie to a
  student") lives. A DB-less CI/dev run exercises almost none of it; a regression
  there is invisible until a live run. The fix is **not** "mock the DB end to
  end" (low-value, brittle) — it's to **separate the pure decision logic from the
  I/O** and unit-test the decisions without a DB.
- **Fix (extract-and-test the pure branches; do the high-value ones, skip the
  rest per KISS):** the goal is to get the *honesty-bearing decision branches*
  under DB-free test, not to hit an arbitrary coverage number on I/O wrappers.

  **`app/viz.py` — already mostly testable; these helpers are pure or near-pure:**
  - `_with_domains(schools, domains)` (line 63) — **pure.** Test: given
    `[SchoolRef(unitid=1, name="A")]` and `{1: "duke.edu"}` returns a new list
    with `domain="duke.edu"`; a unitid missing from the map → `domain=None`;
    confirms immutability (`model_copy`, original unchanged).
  - The `render_viz` honesty guards (lines 164–180) — the `n_available == 0`
    branch returns the "no values available — tell the student honestly ... do
    not invent values" error, and the markers/sources assembly. Extract the
    post-`_build_spec` decision into a tiny pure helper, e.g.:
    ```python
    def _viz_result_from_spec(spec: RenderSpec, registry: SourceRegistry) -> tuple[dict, dict | None]:
        """Pure: given a built spec, return (tool_result, spec_to_emit_or_None)."""
        cells = [cell for row in spec.rows for cell in row.cells]
        n_available = sum(1 for cell in cells if cell.available)
        if n_available == 0:
            return ({"ok": False, "error": "no values available ... do not invent values"}, None)
        markers = sorted({registry.register(c.citation, c.citation.vintage) for c in cells})
        return ({"ok": True, "viz": f"{spec.type} rendered with {n_available} values",
                 "sources": [f"[{i}]" for i in markers]}, spec.model_dump(mode="json"))
    ```
    Then `render_viz` calls it. Test it DB-free with hand-built `RenderSpec`s
    (available cells, all-unavailable cells, mixed) and a real or fake
    `SourceRegistry`. This puts the **"all unavailable → honest error, never
    invent"** branch under routine-suite test — the single most honesty-critical
    line in the file.
  - The `_build_spec` type-dispatch error (`unknown viz type`) and the
    "needs field_keys" / "needs at least one unitid" `ServiceError`s — these are
    pure pre-checks; extract validation into a `_validate_viz_request(type,
    unitids, field_keys)` returning `None` or a `ServiceError` message and test
    each rejection without a DB.

  **`counselle_db/service.py` — extract the pure SQL-free decisions:**
  - `_campus_rank(name)` (line 232) — **pure.** Test: `"Duke University"` → 0;
    `"Penn State - Harrisburg"` → 1; `"X - Main Campus"` → 0 (the
    `endswith("main campus")` carve-out); case-insensitivity.
  - `_guard_sql(sql)` (line 585) — **pure**, already has `tests/counselle_db/test_guard_sql.py`; confirm it covers the new/changed branches (multi-statement, write-keyword, func-denylist, leading-keyword). Gap-fill if any branch is untested.
  - `_fos_number` / `_fos_count` (lines 485, 495) — **pure.** Test: `None` → `None`; `"1234"` → `1234.0` / `1234`; `"PS"`/`"NA"`/`""` (suppressed) → `None`; `"12.5"` → `12.5` / `12`.
  - `_enrollment_count(text)` (line 544) — **pure.** Test: `None` → `None`; `"500"` → `500`; `"-2"` (negative sentinel) → `None`; `"abc"` → `None`; `"500.0"` → `500`.
  - `_control_display` mapping via `_pseudo_envelope`'s `_CONTROL_DISPLAY.get(value, value)` — the decode-or-passthrough decision is pure; if not already covered, add a tiny test of the dict (`"public"` → `"Public"`, unknown → passthrough).
  - `_shortlist_sections(section_ids)` (line 304) — **near-pure** (reads a YAML asset, no DB). Test: `None` → all sections; a valid id subset → filtered; an unknown id → `ServiceError("no such dossier sections ...")`.
  - `_apply_fallback(entry, env_by_key)` (line 331) — **pure** (the COA sibling-trap §13.7 decision). Test: primary available → primary; primary unavailable + fallback available → fallback; primary unavailable + no fallback → primary; primary missing → `None`. **This is honesty-bearing** (it decides which cited value the student sees) — cover all four branches.

  **`counselle_db/search_fields.py`:**
  - `_fill_note(key, source)` (line 78) — **pure.** Test each branch: `source="cds"` → the CDS note; `source="ipeds"` + `key="admissions.x"` → the IPEDS selectivity note; `key="aid.avg_net_price_..."` → the net-price note; an unremarkable key → `None`.
  - `_filter_clauses(prefix, start, category, source)` (line 63) — **pure** SQL-fragment builder. Test: no filters → `("", [])`; category only → `("AND f.category = $2", ["x"])`; both → numbered `$2`/`$3` with the params in order.
  - The merge/floor logic in `search_fields` (lines 181–191: `seen`, `new_keyword`, `reserved = min(_KEYWORD_FLOOR, ...)`, the two slicing steps) is the **never-invisible guarantee** — extract the pure merge into a helper, e.g. `_merge_hits(vector_rows, keyword_rows, limit)` returning `(vector_take, keyword_take)` index/row plans, and test it with plain dicts: vector page full → keyword floor still reserved; overlap dedup by key; limit respected.

  **`app/titles.py`:**
  - `default_title(text, max_len)` (line 35) — **pure**, may already be tested in `tests/api/test_b4.py`; confirm and gap-fill. Cases: short text returned whole/stripped; long text truncated at a word boundary with `…`; `max_len <= len("…")` hard-truncates without ellipsis; whitespace collapsed.
  - `_first_exchange(transcript)` (line 55) — **pure.** Test: extracts first user + first assistant text; missing roles → `(None, None)`.

  **Method:** for each extracted helper, place the new tests next to the
  existing module tests (`tests/app/test_viz.py` is `live_db`-marked, so put the
  DB-free viz tests in a **new** `tests/app/test_viz_pure.py` with **no**
  `pytestmark`; same pattern for service: `tests/counselle_db/test_service_pure.py`).
  Do NOT add a `live_db` mark to the new files. Do NOT build a fixtured fake
  asyncpg pool unless a branch genuinely needs one — prefer pure extraction (KISS;
  the leave-alone is "don't build DB-mock machinery for I/O wrappers").

- **Acceptance criteria:**
  - [ ] Every **pure helper** listed above has ≥1 DB-free test running under `-m "not live_*"`.
  - [ ] The honesty-bearing branches are covered: `render_viz` all-unavailable → honest error (no invented values); `_apply_fallback` all four branches; `_enrollment_count`/`_fos_number` suppressed-sentinel → `None`; `search_fields` keyword-floor never-invisible.
  - [ ] Coverage of `app/viz.py` and `counselle_db/service.py` in the **routine** suite (`-m "not live_*"`) rises materially above the audit numbers (viz 36% → ≥70%; service.py decision helpers covered — pragmatic target, not 80% of the I/O wrappers).
  - [ ] No new test depends on a live DB, Gemini, or Tavily.
  - [ ] Any extraction is behavior-preserving (the live `test_viz.py` / `test_live_db.py` still pass unchanged).

---

### 06-L8 — coverage README doc + coverage targets (dep + config landed in Phase 0)  [LOW]

> **Cross-phase note (READ FIRST): 06-L8's dep + config landed in Phase 0; verify
> before running the coverage gate.** Phase 0 OWNS — and has already added — the
> `pytest-cov` dev dependency, the canonical `[tool.coverage.run]` /
> `[tool.coverage.report]` config block in `pyproject.toml`, and the
> `.coverage*`/`htmlcov/`/`coverage.xml` gitignore entries. **Phase 7 must NOT
> re-add the dep or re-author the `[tool.coverage]` block.** Phase 7's 06-L8 scope
> is narrowed to **(a)** the README `uv run pytest --cov` documentation and **(b)**
> the coverage-target language for the honesty-bearing modules. Before running the
> coverage gate, verify Phase 0's edits are present (`grep -n 'pytest-cov' pyproject.toml`
> and `grep -n '\[tool.coverage' pyproject.toml`); if missing, the Phase 0 commit
> regressed — escalate, do not re-add it here.

- **Files:** `README.md` (document the command). *(The `pyproject.toml` dep + config
  belong to Phase 0 — see the cross-phase note above; do not touch them here.)*
- **Problem:** Before Phase 0, `uv run pytest --cov=…` failed with `unrecognized
  arguments: --cov`; coverage only ran via the ad-hoc `uv run --with pytest-cov`.
  Phase 0 made the tool runnable from committed config. What remains for Phase 7 is
  to (a) document the reproducible coverage command in the README and (b) state the
  coverage targets for the honesty-bearing modules (the 06-L7 work).
- **Fix:**
  - **Do NOT** re-add `pytest-cov` to the dev group or re-author the
    `[tool.coverage]` block — both are Phase 0's, already in `pyproject.toml`. Just
    confirm they are present (see the cross-phase note).
  - Document the command in `README.md` near the test commands:
    ```bash
    # Coverage (no live deps)
    uv run pytest -m "not live_llm and not live_search and not live_db" --cov --cov-report=term-missing
    ```
  - State the coverage targets in the README/docs alongside the command: coverage is
    a **visibility** tool, not a merge gate — there is **no `fail_under` threshold**
    (CLAUDE.md startup-mode; CI declined per `TODOS.md`). The 06-L7 targets are the
    honesty-bearing decision branches (viz/service), not a global percentage.
- **Acceptance criteria:**
  - [ ] `uv run pytest --cov --cov-report=term-missing` runs out of the box (verifying Phase 0's dep + config are in place; no `--with`).
  - [ ] `README.md` documents the coverage command and the "visibility, not a gate" target language.
  - [ ] Phase 7 did **not** re-add `pytest-cov` nor re-author `[tool.coverage]` (those stay Phase 0's; verify they exist).
  - [ ] The command produces a per-module table including `evals/runner.py`, `app/viz.py`, `counselle_db/service.py`.

---

## Regression-test coverage audit (Phases 1–6)

**Framing (per the master plan §0):** the regression tests for the Phase 1–6
behavioral fixes are **authored in their own phases** — Phase 7 does **not**
duplicate them. Phase 7's job here is a **coverage audit + gap-fill**: for every
listed fix, confirm a regression test exists, runs in the routine suite where
possible, and actually pins the fixed behavior (not a hollow assertion). Where a
test is **missing, weak, or live-only when it could be routine**, Phase 7 writes
or strengthens it.

**Procedure (run per row):**
1. Locate the test (grep the test file for the behavior / finding ID / function under change).
2. Read it: does it assert the *post-fix* behavior and would it *fail* against the pre-fix code? (A test that passes both before and after the fix is worthless — flag it.)
3. If present and real → mark ✓. If missing/weak → **gap-fill** in the named test file.

| Fix (phase) | Behavior to pin | Expected test location | Action |
|---|---|---|---|
| **BC-01** (1) | Ring buffer enforces a **byte cap**; an oversized turn evicts/errors **honestly** (no silent OOM, no invented truncation) | `tests/app/test_turns.py` | verify a test feeds events past the byte cap and asserts the cap is enforced + a terminal/honest signal; gap-fill if absent |
| **BC-03** (1) | Concurrent `cancel()` + `aclose()` / double-cancel → **exactly one** terminal event, **one** finalize | `tests/app/test_turns.py` | verify single-flight terminal under concurrent cancel |
| **BC-04** (1) | `_drive` `finally` does not append `error` after a terminal `done(cancelled)` already landed | `tests/app/test_turns.py` | verify no double-terminal on the shutdown/external-cancel race |
| **BC-05** (1) | `append` after `close` is a **no-op** (no event lands post-close) | `tests/app/test_turns.py` | verify append-after-close drops the event |
| **BC-06** (1) | Cross-turn / future-seq `Last-Event-ID` → **full replay**, never a silent skip | `tests/api/test_sse.py` | verify a `Last-Event-ID` ahead of the buffer replays from start, not skips |
| **BC-11** (3) | Clarify survives a **failed resume** `aupdate_state` — the parked clarify is not orphaned | `tests/app/test_clarify.py` / `test_turns.py` | verify resume-failure leaves the clarify recoverable |
| **BC-12** (1) | **No** default-title write and **no** source-config write when `registry.start()` rejects (409/503/422) | `tests/api/test_routes_unit.py` / `test_sse.py` | verify no pre-start side-effect persists on a rejected start |
| **BC-15** (1) | Shutdown drain labels a parked turn's terminal `error`, **not** `cancelled`; pending clarify not silently cleared | `tests/app/test_turns.py` / `test_durability.py` | verify shutdown-drain status label |
| **FE-C1** (2) | Reveal/dejargon **never** crosses a clause over a prior **external** citation (no external claim certified as verified DB data) | `frontend/.../*.test.ts(x)` (citations) | verify clause boundary stops at external citation |
| **FE-H4** (2) | "Counselle data" inclusion derived from **viz/DB registry entries**, not from prose `[n]` markers | `frontend/.../*.test.ts(x)` (sources) | verify DB-data flag ignores prose-only citations |
| **FE-H2** (4) | `useElapsed` **resets across turns**; no stale-closure timer | `frontend/.../useElapsed.test.ts` | verify elapsed resets on new turn |
| **FE-H3** (4) | `ThinkNode` uses a **stable key**, not the array index | `frontend/.../*.test.tsx` | verify reorder/insert doesn't remount the wrong node |
| **FE-H5** (4) | Top-level **error boundary** renders a fallback when the chat tree throws | `frontend/.../ErrorBoundary.test.tsx` | verify fallback renders, app not blanked |
| **FE-SSE-NOSCHEMA** (4) | A **malformed SSE frame** is dropped (not cast blindly to `ProtocolEvent`) | `frontend/.../consumeStream.test.ts` | verify schema-invalid frame is discarded |
| **DS-01** (2) | An unmapped coded `int` → **not-available** display, never the raw code | `tests/domain/test_normalize.py` | verify unmapped enum code → not-available |
| **DS-02** (2) | `search_school_site` tiers per-result; an **off-domain** URL is not blanket `official` | `tests/app/test_tavily_tools.py` | verify per-result tier, off-domain not official |
| **DS-08** (2) | `national_benchmark` does not crash on a **BBRR**-style non-numeric token | `tests/counselle_db/test_*` (service / live) | verify benchmark survives a non-numeric stored value |
| **DS-10** (2) | A percent value **out of bounds** (>1 fraction / >100) → **not-available**, not a fabricated number | `tests/domain/test_normalize.py` | verify percent range guard → not-available |
| **CFG-01** (6) | `school_count` is **live-derived from the DB**, not the hardcoded `2,746` | `tests/test_settings.py` / `tests/counselle_db/test_*` | verify the count comes from a query/Settings, not a literal |
| **CFG-02** (6) | No `getattr(settings, "x", <literal>)` fallback for turn-registry / rate-limit knobs — Settings is the single source | `tests/test_settings.py` | verify defaults come from Settings, not inline literals |
| **CFG-03** (6) | Password minimum length comes from **Settings**, not a hardcoded literal | `tests/api/test_auth.py` | verify password-length policy reads Settings |

**Gap-fill rules:**
- Prefer the **routine** suite (`not live_*`) for any behavior that can be tested without a DB/model. Several of the above (BC-01/03/04/05, FE-*, DS-01/10, CFG-02/03) are pure/logic-level and **must** be routine — if a phase only tested them live, add a routine test.
- A regression test must **fail against the pre-fix code path**. If you can't construct such an assertion, the underlying fix is suspect — escalate as a NO-SHIP must-fix, do not paper over it.
- Record every gap-fill in the phase commit message so reviewers can confirm completeness.

---

## Eval re-baseline procedure

**Why:** the committed baseline `evals/report-2026-06-11.json` is **stale** —
`total: 50` but `questions.yaml` now has **48** (two removed with ADR 0024's
score-band removal). A stale baseline can't be diffed honestly, and a score drop
after Phases 1–6 could be **hiding a regression** introduced by the refactor
(risk register row 6). This procedure produces a fresh, trustworthy baseline and
forces a human-readable justification for any drop.

**Steps:**

1. **De-hardcode the DYNAMIC count** (06-H3 tail — the dynamic half only). In
   `evals/runner.py`:
   - **Static text is Phase 0's, already done — do NOT re-edit it.** Phase 0 already
     changed the docstring line 20 literal "50" → neutral wording ("the full set")
     and the `README.md` "50-question eval" wording. Phase 7 only **verifies** that
     fix landed (`! grep -n "all 50\|50-question" evals/runner.py README.md`); if it
     regressed, escalate — do not re-author the static text here.
   - **The dynamic de-hardcode is Phase 7's:** ensure every place the runner
     *prints/logs* a question count derives it from `len(load_questions())`, never a
     literal. Confirm `amain` already logs `total=len(questions)` (it does,
     runner.py:563); add the derivation anywhere a count is emitted that still uses a
     literal. No `50`/`48` literal may remain anywhere in `runner.py`.
   - Audit `CLAUDE.md` for any stray "50"/"48" — replace with "the eval set" or the
     live count (docs truth-up section also covers this). *(README "50" wording is
     Phase 0's static fix; just verify it.)*

2. **Run the full eval against the FINAL post-Phase-6 code** (this is the live
   gate — costs ~$2–3, needs `COUNSELLE_VERTEX_API_KEY`, the DB container, and
   `TAVILY_API_KEY` for the `web: true` questions):
   ```bash
   uv run python -m evals.runner
   ```
   This writes `evals/report-<today>.json` + `evals/report-<today>.md` and prints
   the markdown summary.

3. **Diff against the prior committed baseline** (`report-2026-06-11.json`):
   - Compare **overall** `passed/total` and **per-type** accuracy (`per_type`).
   - Compare **per-question** `passed` flags (the `results[].id` → `passed` map)
     to find *which specific questions* changed verdict, in both directions.
   - Note: the prior baseline has `total: 50`; the new run has 48 (or current
     count). Account for the two removed questions — do not read the count delta
     as a regression. Diff on the **common question ids**.

4. **Require a human-readable justification for ANY score drop** (per-type
   accuracy down, or a previously-passing question id now failing). For each
   regression, the implementer must write one of:
   - "Expected — the prior pass was a false positive the Phase N fix corrected
     (explain)."
   - "Expected — question removed/changed by ADR 00XX."
   - "**Unexpected — investigate.** A Phase 1–6 change regressed behavior X." → this
     **blocks** the phase: bounce to an Opus fixer, root-cause it, re-run, before
     committing the new baseline. A drop with no justification is a NO-SHIP.
   - Put the justification in the phase commit message and in `TODOS.md` if any
     drop is accepted-and-deferred.

5. **Replace the committed baseline.** `.gitignore` keeps exactly one report —
   delete `report-2026-06-11.{json,md}`, commit `report-<today>.{json,md}`. (Verify
   the `.gitignore` rule still matches the new filename; if it pins the old date,
   fix it.)

6. **Re-run a focused subset to confirm reproducibility** of any investigated
   regression fix (`--only <id>` / `--type <t>`) — don't pay for a full second run.

**Acceptance criteria:**
- [ ] No `50`/`48` literal remains in `evals/runner.py`; the printed/logged counts derive from `len(load_questions())` (dynamic de-hardcode owned here; the static docstring text was Phase 0's, verified present).
- [ ] A fresh `evals/report-<today>.{json,md}` is committed; the stale `2026-06-11` pair is removed.
- [ ] A written per-type + per-question diff vs the prior baseline exists in the commit message.
- [ ] Every score drop has a justification; any "unexpected" drop was root-caused and fixed (not shipped).
- [ ] `.gitignore` correctly keeps exactly the new report pair.

---

## Docs truth-up checklist

After Phases 1–6 land, sync the living docs to reality. **Read each doc before
editing** (CLAUDE.md house rule). `docs/` is version-agnostic (no MVP/phase
labels — auto-memory `docs-version-agnostic`); build *status* lives only in
`CLAUDE.md` + `README.md`.

- [ ] **ADR count (06-M1) — VERIFY only.** Phase 0 (06-M1) already fixed the ADR
      count — VERIFY `CLAUDE.md` and `README.md` read '24'; if either still says
      '23', the Phase 0 commit regressed — escalate, do NOT re-author the fix here.
      (Spots Phase 0 owned: `CLAUDE.md:60` "Index of all 23 ADRs", the CLAUDE.md
      doc-map "the 23 architectural decision records" line, and `README.md:114`
      "the 23 architectural decision records".)
- [ ] **New ADRs (if Phases 3/5 created decisions):**
      - **ADR 0025 — Turn-persistence module extraction.** Phase 3 (H1/BC-09)
        extracts a single-owner persistence module (e.g. `app/turn_persistence.py`).
        That is an architectural decision (new module + ownership boundary) → add
        `docs/adr/0025-turn-persistence-module.md` (context → decision → rationale
        → alternatives → consequences) and register it in `docs/adr/README.md`.
        If added, bump the ADR count from 24 to **25** in the `CLAUDE.md:60`
        index line, the CLAUDE.md doc-map line, and `README.md:114` (this is a
        *new* fact created by this remediation — distinct from the 06-M1 fix,
        which Phase 0 owns).
      - **ADR 0026 — Vendor-fork ownership decision.** Phase 5 (FE-COUPLING)
        resolves the LibreChat vendor-fork question as a *documented ownership
        decision* (per master-plan non-goal: no upstream resync). If Phase 5 wrote
        it as an ADR, register `docs/adr/0026-vendor-fork-ownership.md` and bump
        the count to **26**. If Phase 5 captured it in `frontend/.../UPSTREAM.md`
        instead, link that from the ADR index note rather than creating a stub ADR
        (don't manufacture an ADR for documentation that already lives elsewhere).
      - **Decide explicitly:** confirm with the Phase 3/5 commits whether 0025/0026
        were created; if so, the count becomes 25 or 26 — propagate consistently.
- [ ] **Tool count (01-L2).** Phase 0 (01-L2) already corrected `service.py:646`
      to '11th tool' — verify that landed, then reconcile any remaining stale
      '9 tools'/'10 tools' claim in `docs/ARCHITECTURE.md` / `CLAUDE.md` with the
      reality of 11 tools (cross-check against the actual exported tools:
      `counselle_db/service.py.__all__` value-bearing functions + the MCP catalog).
- [ ] **New modules from Phase 3.** Add `app/turn_persistence.py` (and any other
      extracted module — lifecycle predicates owner) to `docs/ARCHITECTURE.md`
      Part II where the turn registry is described, and to the CLAUDE.md
      documentation/feature map if it lists modules.
- [ ] **New Settings fields from Phase 6.** Enumerate the new `config/settings.py`
      fields (e.g. `school_count` source/CFG-01, password-length/CFG-03,
      turn-registry & rate-limit knobs/CFG-02, compare caps/CFG-06, thinking
      threshold/CFG-07, embed retry/CFG-08, CORS default/06-L1) in the
      `docs/ARCHITECTURE.md` config section (§18 area). **Verify each field
      actually exists** before documenting (read `config/settings.py`).
- [ ] **Eval count (06-H3).** The **static** "50-question eval" removal from
      `README.md:104` and the runner docstring is **Phase 0's static fix** — here,
      only *verify* it landed (don't re-edit). Phase 7's part is the **dynamic**
      count (derive printed/logged counts from `len(load_questions())`) plus any
      stray "50"/"48" in `CLAUDE.md` → "the eval set" or the live count.
- [ ] **mypy gate is now true (06-H1, fixed in Phase 0).** Confirm the
      `README.md:96` / CLAUDE.md "Commands" `uv run ruff check . && uv run mypy .`
      claim is honest (mypy green) — it is the gate Phase 0 restored.
- [ ] **New gate / coverage command.** Add the `--cov` command (06-L8) to
      `README.md` and CLAUDE.md "Commands" if CLAUDE.md lists test commands.
- [ ] **README DB-setup command (06-M6, Phase 0).** Confirm Phase 0 fixed the
      `psql ... -v ro_pw=… -v app_pw=…` invocation — if not already done, do it
      here (it's a docs fix).
- [ ] **TODOS.md.** Record any MEDIUM finding deferred across Phases 1–6 with a
      one-line rationale (§2.5 definition of done). Do not re-propose CI (declined).
- [ ] **No retro-editing shipped specs.** `specs/` are historical records — do
      **not** rewrite shipped plan narratives. Living description goes in `docs/`.

---

## Final pre-merge gate + live E2E smoke

This is the **whole-plan** definition-of-done check (`REMEDIATION-PLAN.md` §2.5).
Run after all of Phases 0–7 are committed on `refactor/codebase-hardening`.

**1. Full automated gate (all green, zero tolerance):**
```bash
uv run ruff check .
uv run mypy .
uv run pytest -m "not live_llm and not live_search and not live_db"   # routine
uv run pytest                                                          # full incl. live
uv run pytest --cov --cov-report=term-missing                         # coverage runs
cd frontend && npm run typecheck && npm test && npm run build
uv run python -m evals.runner                                         # re-baseline
```
- ruff: clean. mypy: clean. Routine + full pytest: 100% pass. Frontend
  typecheck/test/build: green. Eval: fresh baseline committed with the
  score-diff justification.

**2. Live-app E2E smoke (the "no student-facing regression" check):**

Per auto-memory `inbrowser-gate-setup` (servers: `fuser` to free ports, plain `&`
backgrounding; Google OAuth consent is human-only so use a non-OAuth path or a
pre-seeded session):

```bash
# Terminal 1 — backend
uv run uvicorn api.main:create_app --factory --port 8000
# Terminal 2 — frontend (proxies /v1 → :8000)
cd frontend && npm run dev    # http://localhost:5173
```

Then run **one real turn end to end** and confirm no student-facing regression:
- Open `http://localhost:5173`, start a chat, ask a real factual question
  (e.g. "What is Duke University's acceptance rate?").
- Confirm: the activity timeline shows step/thinking events; the answer streams;
  a **cited** value renders (the citation grammar works — the honesty surface is
  intact); the sources strip shows the DB source; no console errors; the error
  boundary did not trigger.
- Confirm a **viz** path works (e.g. "Compare Duke and UNC tuition") → a
  comparison_table renders with cited cells, numbers came from the DB (provenance
  boundary intact, FE-C1/FE-H4 honesty preserved).
- Confirm **cancel** works (start a turn, cancel mid-stream → exactly one
  terminal, UI returns to idle — BC-03/04/05).
- Confirm **resume** (reload mid-turn or reconnect → full replay, not a skip —
  BC-06).

A failure in the smoke is a NO-SHIP for the whole plan: bounce to an Opus fixer,
re-run the relevant phase gate, then re-smoke.

**Acceptance criteria:**
- [ ] Every command in the full automated gate exits 0 / 100% pass.
- [ ] The live E2E smoke ran a real turn with a cited answer, a viz, a cancel, and a resume — all behaving correctly, no console errors, no error-boundary trigger.
- [ ] The fresh eval baseline is committed with its diff justification.
- [ ] Docs (CLAUDE.md, README.md, docs/ARCHITECTURE.md, ADR count) match reality.

---

## Phase completion checklist

- [ ] **06-H2:** `tests/evals/test_scorers.py` + `__init__.py` created; every scorer covered; `value_in_prose` boundary cases incl. `5`-not-in-`35`; green, no live deps.
- [ ] **06-L6:** `app/viz.py` + `adapters/tavily_tools.py` on structlog (kwargs form); no stray `import logging`; ruff/mypy green.
- [ ] **06-L7:** pure decision helpers extracted + DB-free-tested (viz honesty guards, `_apply_fallback`, sentinel parsers, search-fields floor, `_campus_rank`, `_fill_note`); routine-suite coverage of viz/service materially up; no live deps added.
- [ ] **06-L8:** `--cov` command documented in `README.md` with "visibility, not a gate" target language; dep + `[tool.coverage]` config verified present (they landed in Phase 0 — NOT re-added here); command runs out of the box.
- [ ] **Regression audit:** all 21 rows verified ✓ or gap-filled; each gap-fill fails against pre-fix code; routine-where-possible.
- [ ] **Eval re-baseline:** dynamic count de-hardcoded (printed/logged counts from `len(load_questions())`; static docstring/README text verified as Phase 0's); fresh `report-<today>.{json,md}` committed; stale pair removed; per-type + per-question diff + drop justifications recorded; any unexpected drop root-caused and fixed.
- [ ] **Docs truth-up:** ADR count corrected (24, or 25/26 if 0025/0026 added); new modules + Settings fields documented; eval count de-hardcoded; mypy/cov/db-setup commands honest; TODOS.md updated.
- [ ] **Final gate:** full automated gate green; live E2E smoke passed (cited answer + viz + cancel + resume, no regressions).
- [ ] Phase committed on `refactor/codebase-hardening`; ≥3 Sonnet reviewers returned unanimous SHIP (quality + completeness).

---

## Leave-alone (do NOT "fix" — recorded so reviewers don't flag as misses)

- **No `fail_under` coverage gate / no CI.** CLAUDE.md is startup-mode; CI was
  explicitly declined (`TODOS.md`). Coverage is visibility, not a merge gate.
- **No 80%-everywhere coverage push.** Target the **honesty-bearing decision
  branches**, not the I/O wrappers. Don't build DB-mock machinery for thin
  asyncpg wrappers (KISS — value × ease).
- **The sanctioned swallow in `app/titles.py`** (`make_auto_titler._hook`) stays —
  titling is best-effort decoration; it's documented and correct.
- **The `_guard_sql` over-rejection** (semicolons/keywords in string literals) —
  belt-and-suspenders on top of the RO role; intentional. Test it, don't loosen it.
- **`evals/` left-in-DB sessions** — deliberate (cheap, useful for post-mortems).
- **Do not re-vendor LibreChat upstream** (master-plan non-goal §5).
