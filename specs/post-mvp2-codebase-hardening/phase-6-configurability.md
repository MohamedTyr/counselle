# Phase 6 — Configurability & Dynamic Config (+ security knobs)

> **Execution:** follow the per-phase loop in `plans/audit/REMEDIATION-PLAN.md` §2
> (dispatch Opus implementer(s) → run the gate → ≥3 non-leading Sonnet reviewers →
> fix↔re-review until unanimous SHIP → commit). Implement **EVERYTHING** below; miss
> nothing — every finding, every Settings field, every `.env.example` line, every
> read-site change, every test, every acceptance criterion.
>
> **Respect ADR 0018 + value×ease.** Three buckets only:
> bucket 1 = one fail-fast typed `Settings` surface (`config/settings.py`);
> bucket 2 = versioned data assets under `config/assets/` (loaded via `load_prompt`/`load_yaml_asset`);
> bucket 3 = facts derived live from the DB.
> **Hardcode ONLY true invariants.** Do NOT over-config invariants into Settings just
> to satisfy "no hardcoding" — that fails value×ease and adds noise. The
> **Leave-alone** section below is binding: a reviewer who flags `BATCH_SIZE`,
> `protocol_version`, the R1–R12 logic, the IPEDS schema constants, the JWT-min-bytes
> floor, or `SameSite=lax` as a "miss" is wrong, and an implementer who promotes them
> is wrong.
>
> **Method note (line numbers drift):** every line number below was captured against
> the real code at audit time. Treat the snippets as the intended shape; **read the
> actual file before editing** and match the current code. Where a Settings field is
> specified, the field definition, the env var, the `.env.example` line, and the
> read-site change are all given exactly.

---

## Scope & files touched

**Backend (Python):**
- `config/settings.py` — new Settings fields (CFG-03, CFG-06?, CFG-07, CFG-08?), CORS default (06-L1), tavily field alias (DS-05).
- `.env.example` — one documented line per new Settings field.
- `counselle_db/catalog.py` — `Catalog.school_count` derived from DB (CFG-01).
- `counselle_db/service.py` — `_NOT_FOUND_MESSAGE` → school-count-aware (CFG-01); the inline `0.4`/`0.7` fuzzy thresholds → named constants (CFG-15); optional caps → Settings (CFG-06).
- `counselle_db/server.py` — soften the MCP tool description school-count literal (CFG-01).
- `config/assets/prompts/counselor.md` — `{school_count}` slot (CFG-01).
- `app/prompt.py` — thread `school_count` into `build_system_prompt` (CFG-01).
- `app/agent_node.py` — pass the catalog's `school_count` into `build_system_prompt` (CFG-01).
- `app/turns.py` — drop the `getattr(self._settings, "x", literal)` fallbacks → direct reads (CFG-02).
- `app/steps.py` — `THINKING_THRESHOLD_CHARS` sourced from Settings via the router default (CFG-07).
- `app/titles.py` — inline `_TITLE_PROMPT` → `config/assets/prompts/title.md` via `load_prompt("title")` (CFG-09).
- `config/assets/prompts/title.md` — **new** asset (CFG-09).
- `app/run_turn.py` / wherever `EmissionRouter` is constructed — pass `threshold=settings.thinking_threshold_chars` (CFG-07).
- `adapters/tavily_tools.py` — delete the hand-rolled `.env` reader (DS-05 / 06-M2).
- `adapters/embeddings.py` — `_MAX_ATTEMPTS`/`_BACKOFF_BASE_S` decision (CFG-08; keep `BATCH_SIZE`).
- `api/auth.py` — password-min-length from Settings (CFG-03).
- `api/ratelimit.py` + `api/routes/system.py` — rate-limiter health signal (DS-06).
- `docs/DEPLOY.md` — distinct OAuth state secret + dev-only fallback (DS-09); OAuth verification pre-deploy item (DS-04); CORS prod-empty note (06-L1).
- `TODOS.md` — DS-04 pre-deploy security item, plus any deferred CFG calls.

**Frontend (TS):**
- `frontend/src/config.ts` — **new** centralized network-timing + favicon-host config (CFG-04, CFG-05?, CFG-10).
- `frontend/src/components/cards/schoolLogo.ts` — single `faviconUrl` helper home (CFG-04).
- ~~`frontend/src/components/citations/SourceFavicon.tsx`~~ — **NOT touched by CFG-04** (Phase 4 FE-H1 removes its Google s2 fetch entirely; CFG-04's sub-step here is void).
- `frontend/src/api/http/auth.ts` — `AUTH_REQUEST_TIMEOUT_MS` from `config.ts` (CFG-10).
- the file holding `cancelAndAwaitClear` after Phase 5 (expected `src/app/useTurnEngine.ts`; pre-Phase-5 `ChatContext.tsx`) — cancel `TIMEOUT_MS` from `config.ts` (CFG-10).
- `frontend/vite.config.ts` — `VITE_API_PROXY_TARGET` / `VITE_DEV_PORT` env (CFG-05).
- `frontend/.env.example` — document the new VITE_ vars (CFG-05).
- `Containerfile` — note-only unless deploy needs `$PORT` (CFG-11).

**Tests:**
- `tests/counselle_db/` — `Catalog.school_count` derivation + not-found message interpolation (CFG-01).
- `tests/api/test_auth*.py` (or new) — password length sourced from Settings (CFG-03).
- `tests/app/test_turns.py` / `tests/app/test_run_turn.py::FakeSettings` — no-fallback direct reads still work (CFG-02).
- `tests/app/test_steps_router.py` — router threshold honors Settings value (CFG-07).
- `tests/app/test_titles.py` — title prompt loads from the asset (CFG-09).
- `frontend/src/**/*.test.ts(x)` — `faviconUrl` helper (CFG-04).

---

## Gate commands (for this phase)

```bash
# Backend
uv run ruff check .
uv run mypy .
uv run pytest -m "not live_llm and not live_search"
# Frontend
cd frontend && npm run typecheck && npm test && npm run build
```

`Catalog.school_count` is DB-derived — its unit test must NOT require a live DB
(use a fake pool / fixtured row, like the existing catalog tests). Keep everything
in the routine (`not live_*`) suite.

---

## Findings & fixes

Ordered HIGH → MEDIUM → LOW → security knobs.

---

### CFG-01 — School count "~2,746" hardcoded in code + prompt; derive from DB  [HIGH]

**value×ease:** High value (the honesty carve-out — never lie to a student about
coverage; the count drifts on every pipeline re-ingest), low effort. **Do it.**
**ADR-0018 bucket:** **3 — live-derived from DB.** Configuring a count would be a
lie waiting to happen; deriving it live is the whole point.

- **Files:**
  - `counselle_db/service.py:67-71` — `_NOT_FOUND_MESSAGE` literal `~2,746`, used at `:248`, `:256`, `:264`, `:379`.
  - `counselle_db/server.py:102` — MCP tool description `database of ~2,746 curated 4-year US institutions`.
  - `config/assets/prompts/counselor.md:69` — `outside our current set of ~2,746 4-year US institutions`.
  - `counselle_db/catalog.py` — the natural home for the derived count (loaded once at build, refreshed with the catalog).
  - `app/prompt.py`, `app/agent_node.py` — thread the count into the system prompt.

- **Problem:** The coverage count is a DB fact (`SELECT count(*) FROM schools`)
  hardcoded in three places, one of which is the model's own system prompt. After
  any pipeline re-ingest the live table diverges from `~2,746` and the agent tells
  students a stale coverage number — a coverage-honesty violation (CLAUDE.md
  principle 3).

- **Fix (EXACT):**

  **(a) `counselle_db/catalog.py` — derive and cache the count at build.**
  The catalog already loads `_SCHOOL_NAMES_SQL` (`SELECT unitid, name FROM schools`)
  in `_reload()`. The school count is exactly `len(self.school_names)` — no extra
  query needed. Add an attribute + accessor:

  In `Catalog.__init__` (alongside `self.school_names: dict[int, str] = {}`):
  ```python
  self.school_count: int = 0
  ```
  In `_reload()`, after `self.school_names = new_names` (the swap block, ~`:215`):
  ```python
  self.school_count = len(new_names)
  ```
  > KISS: reuse the already-loaded names map; do **not** add a separate
  > `SELECT count(*)`. The count refreshes for free with the hourly catalog
  > refresh. (If a reviewer insists on a dedicated count query, that is gold-plating
  > — reject it.)

  **(b) `counselle_db/service.py` — make the not-found message count-aware.**
  `_NOT_FOUND_MESSAGE` is a module constant consumed at four call sites, all of
  which already have the `catalog` in hand (`resolve_school`, the dossier path).
  Replace the constant-with-baked-count with a builder that takes the count, and
  pass the live count at each call site. Concretely:
  ```python
  def _not_found_message(school_count: int) -> str:
      """The not-found copy with the live coverage count (CFG-01, ADR 0018 bucket 3)."""
      return (
          f"That school is not in our database — we cover {school_count:,} curated "
          "4-year US institutions. Tell the student honestly that we don't have data "
          "on it; do not invent values."
      )
  ```
  At each of the former `_NOT_FOUND_MESSAGE` sites (`:248`, `:256`, `:264`, `:379`),
  call `_not_found_message(catalog.school_count)`. The `catalog` is the first arg of
  `resolve_school`/`get_dossier`, so it is in scope at every site — verify in the
  real code and thread it (do not reach for a global).
  - Delete the `_NOT_FOUND_MESSAGE` module constant.
  - Defensive: if `catalog.school_count` is `0` (catalog not yet loaded — should
    never happen on a served request), the message still reads sensibly ("we cover
    0 curated…" is ugly but never reached; do **not** add a fallback literal — that
    re-introduces CFG-02's drift smell).

  **(c) `config/assets/prompts/counselor.md` — add a `{school_count}` slot.**
  Line 69 currently reads:
  ```
  ...it may be a 2-year school or outside our current set of ~2,746 4-year US institutions...
  ```
  Replace `~2,746` with the slot `{school_count}` so it joins the existing
  `str.format` slots:
  ```
  ...it may be a 2-year school or outside our current set of {school_count} 4-year US institutions...
  ```

  **(d) `app/prompt.py` — fill the new slot.**
  `build_system_prompt` uses a slot-token-escape dance (`_SLOTS` list, then
  `text.format(...)`). Add `school_count` to `_SLOTS` and to the `.format(...)`
  call, and add it as a parameter:
  ```python
  def build_system_prompt(temporal_context: str, school_count: int) -> str:
      ...
      _SLOTS = [
          "static_field_map",
          "dossier_shortlist_summary",
          "subreddit_menu",
          "temporal_context",
          "tier_note",
          "school_count",
      ]
      ...
      return text.format(
          static_field_map=load_static_map(),
          dossier_shortlist_summary=_dossier_shortlist_summary(),
          subreddit_menu=_subreddit_menu(),
          temporal_context=temporal_context,
          tier_note=_tier_note(),
          school_count=f"{school_count:,}",
      )
  ```
  Update the module docstring's slot list to include `{school_count}`.

  **(e) `app/agent_node.py:305` — pass the count.**
  Current call:
  ```python
  instructions=build_system_prompt(state["temporal"]["context"]),
  ```
  **Verified at audit time:** `run_agent_node(state, deps)` already uses
  `deps.catalog` directly (e.g. `make_tool_deps(settings, deps.catalog)`,
  `_make_render_viz_tool(deps.catalog, ...)` at ~`:283-289`), so the catalog IS in
  scope. Pass its count directly — no graph-state threading needed:
  ```python
  instructions=build_system_prompt(
      state["temporal"]["context"],
      deps.catalog.school_count,
  ),
  ```
  > This is the cleaner of the two options (vs. threading `school_count` through the
  > `prepare` node into state). Use `deps.catalog.school_count`. The hermetic turn
  > tests monkeypatch `build_system_prompt` to a constant
  > (`tests/app/test_turns.py::_hermetic`) — confirm that monkeypatch still has the
  > right arity (it ignores args via `lambda ctx: ...`; update to `lambda *a: ...`
  > if the new positional arg trips it).

  **(f) `counselle_db/server.py:102` — soften the MCP tool description.**
  The tool description is a static docstring (no catalog in scope at decoration
  time). Do **not** thread DB state into a docstring (over-engineering). Soften the
  exact number to a stable phrasing:
  ```
  ...the school is not in our database of curated 4-year US institutions — say so honestly, never invent...
  ```
  (Drop `~2,746`; the agent gets the live count from the system prompt and the
  not-found message — the tool desc need only convey the *concept*.)

- **Tests to add (`tests/counselle_db/`):**
  - `test_catalog_school_count`: build a `Catalog` over a fake pool whose
    `_SCHOOL_NAMES_SQL` returns N rows; assert `catalog.school_count == N` after
    `_reload()`. (Mirror the existing catalog fake-pool tests.)
  - `test_not_found_message_uses_count`: `_not_found_message(2710)` contains
    `"2,710"` and does **not** contain `"2,746"`.
  - `test_resolve_school_not_found_message_count`: a `resolve_school` returning
    `ResolveNotFound` carries the live count in its message (fake catalog with a
    known `school_count`).
  - `test_build_system_prompt_school_count`: `build_system_prompt(ctx, 2710)`
    renders `"2,710"` and contains no literal `"2,746"`. (Guard the prompt path.)

- **Acceptance criteria:**
  - [ ] `Catalog.school_count` exists, is set in `_reload()` from the loaded names map, and refreshes with the catalog.
  - [ ] `_NOT_FOUND_MESSAGE` constant is gone; all four former sites call `_not_found_message(catalog.school_count)`.
  - [ ] `counselor.md` uses `{school_count}`; no literal `2,746` remains in the asset.
  - [ ] `build_system_prompt` takes `school_count` and fills the slot; `agent_node` passes the live count.
  - [ ] `server.py` tool desc no longer names a specific number.
  - [ ] `grep -rn "2,746\|2746" config/ counselle_db/ app/` returns nothing (outside this plan/docs).
  - [ ] All four new tests pass in the routine suite (no live DB).

---

### CFG-02 — `getattr(self._settings, "x", <literal>)` fallbacks duplicate Settings defaults  [HIGH]

**value×ease:** High value (a changed `.env` could be silently ignored if a path hit
the fallback — defeats ADR 0018's single-source promise), trivial effort. **Do it.**
**ADR-0018 bucket:** 1 (the values already live in Settings — the fallback literal IS the bug).

> **CROSS-PHASE:** Phase 1 also edits `app/turns.py` (the lifecycle/ring-buffer
> bugs). Coordinate: whichever phase lands first, the other rebases. These edits are
> read-site-only (no behavior change), so they compose cleanly with Phase 1's
> lifecycle fixes — but the implementer MUST re-read `app/turns.py` against the
> current tree (Phase 1 may have moved lines) before editing.

- **Files:** `app/turns.py:221, 224, 248, 300, 369` (the 5 pre-Phase-1 sites) **plus
  the two NEW getattr sites Phase 1 introduces** (see the post-Phase-1 list below).

- **Problem:** Each `getattr(self._settings, "<field>", <literal>)` re-states the
  Settings default. The two can silently drift: change the default in
  `config/settings.py` and the fallback keeps the stale value for any path that
  somehow saw a settings object missing the field. `TurnRegistry` is **always**
  constructed with a real `Settings` (`api/main.py:131`), so the fallback never
  fires in production — it is pure downside.

- **Fix (EXACT):** read the field directly.

  **Pre-Phase-1 sites (5):**
  - `:221` `max_turns = getattr(self._settings, "max_concurrent_turns", 50)`
    → `max_turns = self._settings.max_concurrent_turns`
  - `:224` `_RingBuffer(getattr(self._settings, "stream_buffer_size", 20_000))`
    → `_RingBuffer(self._settings.stream_buffer_size)`
  - `:248` `max_consumers = getattr(self._settings, "max_consumers_per_turn", 8)`
    → `max_consumers = self._settings.max_consumers_per_turn`
  - `:300` `timeout_s = getattr(self._settings, "turn_timeout_s", 180)`
    → `timeout_s = self._settings.turn_timeout_s`
  - `:369` `enrich_usage_event(event, getattr(self._settings, "model_counselor", ""), self._settings)`
    → `enrich_usage_event(event, self._settings.model_counselor, self._settings)`

  **Post-Phase-1 sites (2 NEW — Phase 1 adds these getattr fallbacks; remove BOTH,
  read the Settings field directly — both fields are created in Phase 1):**
  - **BC-01** adds, in `TurnRegistry.__init__`,
    `self._buffer_bytes_budget = getattr(settings, "stream_buffer_bytes", 256 * 1024 * 1024)`.
    **Note: the `__init__` parameter is named `settings`, NOT `self._settings`** —
    so this is a *bare-`settings`* getattr, which the old acceptance grep
    (`getattr(self._settings`) would MISS. Replace with
    `self._buffer_bytes_budget = settings.stream_buffer_bytes`. (The
    `stream_buffer_bytes` field is created in Phase 1 BC-01.)
  - **BC-08** adds, in `_persist_partial_guarded`,
    `timeout_s = getattr(self._settings, "persist_partial_timeout_s", 5.0)`.
    Replace with `timeout_s = self._settings.persist_partial_timeout_s`. (The
    `persist_partial_timeout_s` field is created in Phase 1 BC-08.)

  **Test seam — make the stub carry the fields.** `TurnRegistry`'s tests build it
  with `tests/app/test_run_turn.py::FakeSettings` (a plain class with class
  attributes; `tests/app/test_turns.py` mutates instances, e.g.
  `settings.turn_timeout_s = 0.1`). `FakeSettings` currently defines
  `model_counselor`, `max_tool_rounds`, `vertex_api_key`, `source_*`,
  `search_max_results` — but NOT the turn-registry fields. Add class-attr
  defaults so the direct reads work without per-test mutation. **This MUST include
  the two Phase-1 fields (`stream_buffer_bytes`, `persist_partial_timeout_s`)** —
  with the BC-01/BC-08 getattr fallbacks removed, a `FakeSettings` missing them
  raises `AttributeError` in `__init__`/`_persist_partial_guarded`:
  ```python
  class FakeSettings:
      """The slice of Settings the runner + node + registry read."""
      model_counselor = "google-vertex:gemini-2.5-pro"
      max_tool_rounds = 12
      vertex_api_key = None
      source_web_default = True
      source_reddit_default = True
      source_edu_default = True
      search_max_results = 5
      # Turn-registry knobs (CFG-02: registry reads these directly, no getattr fallback).
      max_concurrent_turns = 50
      stream_buffer_size = 20_000
      max_consumers_per_turn = 8
      turn_timeout_s = 180
      # Phase-1 fields (BC-01 / BC-08) — also read directly after CFG-02 removes
      # their getattr fallbacks; the stub MUST carry them or __init__ raises.
      stream_buffer_bytes = 256 * 1024 * 1024
      persist_partial_timeout_s = 5.0
  ```
  The existing per-test overrides (`settings.stream_buffer_size = 2`, etc.) keep
  working — they now override a real default instead of a non-existent attr.

  Type hygiene: `TurnRegistry.__init__` types `settings: Any` today. Leave it `Any`
  (the tests pass a duck-typed `FakeSettings`, not a `Settings` instance) — tightening
  to `Settings` would break the test seam and is out of scope. The `getattr` removal
  is the whole fix.

- **Tests to add:**
  - Reuse the existing `tests/app/test_turns.py` suite — the default-path tests
    (no override) now exercise the direct reads. Add one explicit
    `test_registry_reads_settings_directly`: construct a `FakeSettings` with
    distinctive values (`max_concurrent_turns = 3`, `stream_buffer_size = 7`),
    build the registry, and assert the values flow through (e.g. the 4th concurrent
    `start` raises `TooManyTurns`; a buffer of 7 evicts at the 8th append).
    (A test that the *absence* of a field now raises `AttributeError` rather than
    silently using a literal is the regression guard.)

- **Acceptance criteria:**
  - [ ] No `getattr(...settings...)` remains in `app/turns.py` — covers BOTH
        `self._settings` AND the bare-`settings` BC-01 call in `__init__`:
        `grep -nE "getattr\(.*settings" app/turns.py` → empty. (The old grep
        `getattr(self._settings` MISSED the bare-`settings` BC-01 site.)
  - [ ] `FakeSettings` carries the turn-registry fields **including the two
        Phase-1 fields** `stream_buffer_bytes` and `persist_partial_timeout_s`.
  - [ ] The full `tests/app/test_turns.py` suite is green.
  - [ ] Cross-phase note recorded: re-read against the post-Phase-1 tree.

---

### CFG-03 — Password minimum length hardcoded  [HIGH]

**value×ease:** Medium-high value (a security policy a deployer will plausibly tune),
trivial effort. **Do it.** **ADR-0018 bucket:** 1 — Settings.

- **Files:** `api/auth.py:92-94` (`validate_password`); `config/settings.py`; `.env.example`.

- **Problem:** `8` is hardcoded in both the comparison and the user-facing string;
  a deployer who wants a stronger floor must edit code in two places that can drift.

- **Fix (EXACT):**

  **Settings field** (`config/settings.py`, in the Auth section, after
  `oauth_redirect_url`):
  ```python
  password_min_length: int = 8  # the password-policy floor (CFG-03; security knob)
  ```
  - **Name:** `password_min_length`
  - **Type:** `int`
  - **Default:** `8`
  - **Env var:** `COUNSELLE_PASSWORD_MIN_LENGTH`

  **`.env.example`** (in the Auth block):
  ```
  # Minimum accepted password length (security policy floor)
  COUNSELLE_PASSWORD_MIN_LENGTH=8
  ```

  **Read site** (`api/auth.py:92-94`) — `UserManager` already holds
  `self._settings`:
  ```python
  async def validate_password(self, password: str, user: Any) -> None:
      min_len = self._settings.password_min_length
      if len(password) < min_len:
          raise InvalidPasswordException(
              f"Password must be at least {min_len} characters."
          )
  ```

- **Tests to add (`tests/api/`):**
  - `test_validate_password_uses_settings`: build a `UserManager` with a settings
    stub `password_min_length = 12`; `await validate_password("short", None)` raises
    `InvalidPasswordException` whose message contains `"12"`; a 12-char password
    passes. Build a second manager with `password_min_length = 8` to confirm the
    default still rejects a 7-char password and admits an 8-char one.

- **Acceptance criteria:**
  - [ ] `password_min_length` field in Settings (default 8) + `.env.example` line.
  - [ ] `validate_password` reads the field for BOTH the check and the message; no literal `8` remains.
  - [ ] Tests prove the length is sourced from Settings.

---

### CFG-04 — Favicon CDN host duplicated across frontend (DRY the frontend; keep the backend constant)  [MED]

**value×ease:** Medium (a CDN swap today touches multiple frontend sites), easy.
**Do the frontend DRY only.** **ADR-0018 bucket:** N/A backend (LA-1 — `domain/`
must not import `config/`, so `domain/urls.py:FAVICON_CDN_BASE` stays a module
constant — see Leave-alone). Frontend: one shared helper.

> **CROSS-PHASE (BINDING — see Phase 4 FE-H1):** Phase 4's FE-H1 **removes the
> Google s2 favicon fetch from `SourceFavicon.tsx` entirely** — it collapses to the
> glyph tile, with no remote `<img>` at all. So CFG-04's `SourceFavicon.tsx`
> sub-step is **VOID — skip it** (there is no remote URL left in that file to route
> through a shared helper). The remaining DRY work targets only `schoolLogo.ts`,
> which still uses the Google s2 reference. The implementer MUST check the Phase 4
> diff / the current `SourceFavicon.tsx` before editing — if FE-H1 has landed,
> `SourceFavicon.tsx` no longer imports or builds a favicon URL.

- **Files:**
  - `frontend/src/components/cards/schoolLogo.ts:29` — Google s2 host inside `logoCandidates` (the ONLY remaining DRY target).
  - ~~`frontend/src/components/citations/SourceFavicon.tsx:65`~~ — **VOID.** Phase 4
    FE-H1 removes the Google s2 fetch from this file entirely (collapses to the glyph
    tile, no remote `<img>`), so there is no URL here to share. Skip this sub-step.
  - `frontend/src/config.ts` (**new**) — the single home for the helper.

- **Problem:** After FE-H1, the Google s2 host lives in only one place
  (`schoolLogo.ts`). The DRY value is now narrower — extract the host/size into a
  shared `faviconUrl` helper so a future CDN/size swap is one edit, and so the helper
  + its unit test exist as the canonical favicon-URL builder. (Pre-FE-H1 the host was
  re-spelled in two files; FE-H1 already eliminated the `SourceFavicon.tsx` copy.)

- **Fix (EXACT):**
  Add a shared helper. Put the host constant + helper in `frontend/src/config.ts`
  (the new central config from CFG-10) and export a function:
  ```ts
  // frontend/src/config.ts
  /** Keyless favicon CDN (Google s2). Swap here once. The host is always dynamic. */
  export const FAVICON_CDN_BASE = 'https://www.google.com/s2/favicons';
  export const DEFAULT_FAVICON_SIZE = 64;

  /** Build the keyless favicon URL for a host. */
  export function faviconUrl(host: string, size: number = DEFAULT_FAVICON_SIZE): string {
    return `${FAVICON_CDN_BASE}?domain=${encodeURIComponent(host)}&sz=${size}`;
  }
  ```
  - **`SourceFavicon.tsx`: VOID — no change.** FE-H1 (Phase 4) already removed the
    Google s2 fetch from this file; do NOT re-add an `<img>` or route anything
    through `faviconUrl` here.
  - `schoolLogo.ts:29`: replace the Google s2 line in `logoCandidates` with
    `urls.push(faviconUrl(enc, px));` — but **note** `schoolLogo.ts` already
    `encodeURIComponent`s into `enc` and passes a computed `px`; `faviconUrl` also
    encodes. To avoid double-encoding, pass the raw `host` (not `enc`) to
    `faviconUrl` and let the helper encode once:
    `urls.push(faviconUrl(host, px));`. Verify against the real `logoCandidates`
    body (it builds `enc = encodeURIComponent(host)` for the other two CDNs — leave
    those as-is; only the Google line moves to the helper with the un-encoded host).
  - Keep the logo.dev (`:27`) and DuckDuckGo (`:30`) lines as they are (logo.dev is
    already env-gated — good; DuckDuckGo is a distinct host).

- **Tests to add (frontend):**
  - `config.test.ts`: `faviconUrl('duke.edu')` →
    `https://www.google.com/s2/favicons?domain=duke.edu&sz=64`; `faviconUrl('a b.edu', 32)`
    encodes the space and uses `sz=32`.

- **Acceptance criteria:**
  - [ ] One `faviconUrl` helper in `config.ts`; `schoolLogo.ts` uses it; no inline
        `www.google.com/s2` outside `config.ts`.
  - [ ] `SourceFavicon.tsx` is untouched here — FE-H1 (Phase 4) already removed its
        Google s2 fetch; CFG-04's `SourceFavicon.tsx` sub-step was VOID/skipped.
  - [ ] `sz` default is the named `DEFAULT_FAVICON_SIZE`, not an inline `64`.
  - [ ] No double-encoding regression in `logoCandidates` (host encoded exactly once).
  - [ ] The `faviconUrl` unit test (`config.test.ts`) is kept.
  - [ ] Backend `domain/urls.py:FAVICON_CDN_BASE` is **unchanged** (LA-1).
  - [ ] Reconciled with the Phase 4 FE-H1 outcome (noted in the report).

---

### CFG-05 — Vite dev proxy target + dev port hardcoded  [MED]

**value×ease:** Medium (a non-default backend port or remote host requires editing
committed code today), easy. **Do it.** **ADR-0018 bucket:** frontend env (Vite
`process.env`), mirrors `docs/DEPLOY.md`.

- **Files:** `frontend/vite.config.ts:14-19`; `frontend/.env.example`.

- **Problem:** The dev proxy target `http://localhost:8000` and dev `port: 5173` are
  hardcoded. The app talks to a relative `/v1` (prod is fine via same-origin); only
  the dev target + port are the configurable bits.

- **Fix (EXACT):** `vite.config.ts` already reads `process.env.*` in its `define`
  block, so the pattern exists. Change the `server` block:
  ```ts
  server: {
    port: Number(process.env.VITE_DEV_PORT ?? 5173),
    proxy: {
      '/v1': process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:8000',
    },
  },
  ```
  Defaults are the current values, so no-config behavior is identical.

  **`frontend/.env.example`** — add:
  ```
  # Dev server port (Vite). Default 5173.
  # VITE_DEV_PORT=5173
  # Dev proxy target for /v1 → the local backend. Default http://localhost:8000.
  # Set this when the backend runs on another port or a remote host during dev.
  # VITE_API_PROXY_TARGET=http://localhost:8000
  ```
  > Note: these are read in `vite.config.ts` via `process.env` (Node, build-time),
  > NOT `import.meta.env` — they need no `VITE_`-prefix exposure to the client
  > bundle, but the `VITE_` prefix is kept for convention/consistency. They are
  > dev-only; do not document them as runtime app config.

- **Tests to add:** none (config-only; covered by `npm run build` + a manual dev-server
  smoke). Do not write a brittle vite-config unit test.

- **Acceptance criteria:**
  - [ ] `vite.config.ts` reads `VITE_DEV_PORT` and `VITE_API_PROXY_TARGET` with the current values as defaults.
  - [ ] `frontend/.env.example` documents both (commented, since defaults work).
  - [ ] `npm run build` is green; default `npm run dev` behavior unchanged.

---

### CFG-06 — `compare` / dossier-preview / search-fields caps  [MED — borderline]

**value×ease:** Low-medium (these rarely change), easy. **CALL: DEFER (document,
do not promote).** **ADR-0018 bucket:** would be 1 if promoted — but the value×ease
test says no: the comment already labels them "protocol sanity caps — not tuning
knobs," and there is no current product pressure for UI density control. Promoting
them now is speculative generality (YAGNI). **Leave with rationale.**

- **Files:** `counselle_db/service.py:62-65` (`_COMPARE_MAX_SCHOOLS = 6`,
  `_COMPARE_MAX_FIELDS = 25`, `_PROGRAMS_PREVIEW_TOP_N = 10`); `app/steps.py:76`
  (`_MAX_STEP_SOURCES = 8`); `counselle_db/search_fields.py` (`_MAX_LIMIT = 25`).

- **Problem (as-is, accepted):** Named module constants with rationale comments —
  correct altitude for a sanity cap.

- **Fix:** **No code change.** Add a one-line rationale comment confirming the
  defer decision next to `_COMPARE_MAX_FIELDS` so a future reviewer doesn't re-flag:
  ```python
  # Sanity cap, not a tuning knob (CFG-06 reviewed 2026-06: kept hardcoded — no
  # product need for runtime density control; promote to Settings only if the UI
  # gains a "compare more fields" control).
  ```
  Record the defer in `TODOS.md` under a "Deferred config promotions" note.

- **Tests to add:** none.

- **Acceptance criteria:**
  - [ ] No Settings field added for these.
  - [ ] One-line CFG-06 rationale comment present.
  - [ ] `TODOS.md` notes the deferred promotion.

---

### CFG-07 — Thinking threshold is an editorial dial; promote to Settings  [MED]

**value×ease:** Medium (you'll want to tune this against real Gemini chunking
without a redeploy), easy — plumbing is already half-done (`EmissionRouter.threshold`
is a field). **Do the threshold.** **ADR-0018 bucket:** 1 — Settings. (Leave
`_LABEL_QUERY_MAX_CHARS` = presentation polish — see Leave-alone.)

- **Files:** `app/steps.py:65` (`THINKING_THRESHOLD_CHARS = 240`),
  `app/steps.py:360` (`threshold: int = THINKING_THRESHOLD_CHARS` on `EmissionRouter`);
  the `EmissionRouter` construction site (read `app/run_turn.py` / `app/agent_node.py`
  to find it); `config/settings.py`; `.env.example`.

- **Problem:** The 240-char threshold directly shapes the live-timeline UX (when
  narration vs. answer streams). It's a product/editorial dial baked as a module
  constant; `EmissionRouter` already accepts it as `threshold=`, so only the source
  of that value needs to become Settings.

- **Fix (EXACT):**

  **Settings field** (`config/settings.py`, in a "Chat (B4)" or "Turn registry"
  neighborhood — place near `thinking_summaries` or `title_max_len`):
  ```python
  # Chars of buffered response text below which pre-tool-call text routes to
  # `thinking` vs streaming live as `delta` (the live-timeline editorial dial,
  # §27.2). Tune against real model chunking. (CFG-07)
  thinking_threshold_chars: int = 240
  ```
  - **Name:** `thinking_threshold_chars`
  - **Type:** `int`
  - **Default:** `240`
  - **Env var:** `COUNSELLE_THINKING_THRESHOLD_CHARS`

  **`.env.example`** (in the Chat block):
  ```
  # Char threshold below which pre-tool narration routes to the thinking feed
  # instead of streaming live (live-timeline editorial dial)
  COUNSELLE_THINKING_THRESHOLD_CHARS=240
  ```

  **Read site:** keep `THINKING_THRESHOLD_CHARS = 240` in `app/steps.py` as the
  module **fallback default** for the `EmissionRouter.threshold` dataclass field
  (so the router still has a sane default when constructed bare in unit tests — the
  router is constructed directly in `tests/app/test_steps_router.py` without
  settings). Change ONLY the production construction site to pass the Settings value:
  ```python
  # at the EmissionRouter(...) construction in run_turn/agent_node:
  router = EmissionRouter(
      writer=...,
      mapper=...,
      threshold=settings.thinking_threshold_chars,
      unmounted=...,
  )
  ```
  > Rationale (avoids over-engineering): the dataclass default stays a module
  > constant so the router is independently testable; production wiring sources it
  > from Settings. This is NOT CFG-02-style drift — the module constant is a
  > test-only default, not a duplicated production read. Add a comment on
  > `THINKING_THRESHOLD_CHARS` saying so.

- **Tests to add (`tests/app/test_steps_router.py`):**
  - `test_router_honors_threshold`: construct `EmissionRouter(..., threshold=10)`;
    feed an under-10-char pre-tool text → it routes to `thinking`; feed ≥10 chars →
    it streams as `delta`. (Confirms the threshold is honored from the field, which
    is what the Settings value flows into.)
  - In whichever test exercises the production construction (run_turn-level), assert
    the router's threshold equals `settings.thinking_threshold_chars` if reachable;
    otherwise rely on the field test above.

- **Acceptance criteria:**
  - [ ] `thinking_threshold_chars` Settings field (default 240) + `.env.example` line.
  - [ ] Production `EmissionRouter` construction passes `settings.thinking_threshold_chars`.
  - [ ] `THINKING_THRESHOLD_CHARS` remains only as the dataclass test-default, with a comment.
  - [ ] Router-threshold test passes.

---

### CFG-08 — Embedding retry/backoff knobs (keep BATCH_SIZE)  [MED — borderline]

**value×ease:** Low-medium, easy. **CALL: DEFER (document).** **ADR-0018 bucket:**
would be 1 — but value is low (retries rarely need tuning without a deploy) and the
current named constants with rationale are the right altitude. `BATCH_SIZE` is a
true Vertex invariant — **keep** (LA-2).

- **Files:** `adapters/embeddings.py:23-25` (`BATCH_SIZE = 64`, `_MAX_ATTEMPTS = 3`,
  `_BACKOFF_BASE_S = 1.0`).

- **Problem:** `_MAX_ATTEMPTS`/`_BACKOFF_BASE_S` are operational tunables; `BATCH_SIZE`
  is a provider cap (≤64 texts/call).

- **Fix:** **No Settings promotion.** Add a one-line CFG-08 rationale comment on
  `_MAX_ATTEMPTS` confirming the defer:
  ```python
  # Resilience tunables — kept as named constants (CFG-08 reviewed 2026-06: no
  # current need to tune retry without a deploy; promote to Settings if the
  # embedding path becomes flaky in prod).
  _MAX_ATTEMPTS = 3
  _BACKOFF_BASE_S = 1.0
  ```
  Record in `TODOS.md` "Deferred config promotions." Do NOT touch `BATCH_SIZE`.

- **Tests to add:** none.

- **Acceptance criteria:**
  - [ ] No Settings field added; `BATCH_SIZE` unchanged.
  - [ ] CFG-08 rationale comment present; `TODOS.md` notes the defer.

---

### CFG-09 — Auto-title prompt is an inline string; move to a data asset  [MED]

**value×ease:** Medium (consistency with the other prompts + editorial tuning by
diff), easy, near-zero risk. **Do it.** **ADR-0018 bucket:** 2 —
`config/assets/prompts/`.

- **Files:** `app/titles.py:28-32` (`_TITLE_PROMPT`); **new**
  `config/assets/prompts/title.md`; `config/settings.py:228` (`load_prompt`).

- **Problem:** The title prompt is the lone agent prompt embedded in code; the
  counselor/clarifier/judge prompts already live in `config/assets/prompts/`. ADR
  0018 explicitly puts "agent prompts (one file per agent)" in bucket 2.

- **Fix (EXACT):**

  **New asset** `config/assets/prompts/title.md` (verbatim current copy):
  ```
  You name chat conversations. Given the first user message and the assistant's reply, produce a short, specific title (4-8 words, no quotes, no trailing punctuation) describing what the chat is about. Title only.
  ```

  **`app/titles.py`:**
  - Delete the `_TITLE_PROMPT = (...)` constant.
  - Import `load_prompt`: `from config.settings import load_prompt`.
  - In `_generate_title`, replace `system_prompt=_TITLE_PROMPT` with
    `system_prompt=load_prompt("title")`:
    ```python
    agent: Agent[None, str] = Agent(
        _title_model(runtime, settings),
        system_prompt=load_prompt("title").strip(),
    )
    ```
    (`.strip()` so a trailing newline in the `.md` doesn't change behavior.)
  - Update the module docstring's "Two pieces" note to say the prompt is a data asset.

- **Tests to add (`tests/app/test_titles.py`):**
  - `test_title_prompt_loads_from_asset`: `load_prompt("title")` returns a non-empty
    string containing `"name chat conversations"` (proves the asset exists and is
    loadable). If `test_titles.py` already stubs `_generate_title`, add a small
    direct assertion on `load_prompt("title")`.
  - Verify the existing auto-titler tests still pass (the prompt source changed,
    not the behavior).

- **Acceptance criteria:**
  - [ ] `config/assets/prompts/title.md` exists with the current copy.
  - [ ] `_TITLE_PROMPT` constant removed; `_generate_title` uses `load_prompt("title")`.
  - [ ] `load_prompt("title")` test passes; auto-title tests still green.

---

### CFG-10 — Frontend network timeouts scattered; consolidate the network ones  [MED]

**value×ease:** Low-medium, easy. **Do the light consolidation** (network timeouts
only; leave cosmetic micro-timings inline — LA-3). **ADR-0018 bucket:** frontend
config module.

- **Files:** `frontend/src/config.ts` (**new** — shared with CFG-04);
  `frontend/src/api/http/auth.ts:122` (`AUTH_REQUEST_TIMEOUT_MS = 15_000`);
  the file that holds `cancelAndAwaitClear` after Phase 5 (expected:
  `src/app/useTurnEngine.ts`; pre-Phase-5 it lives in `ChatContext.tsx:676` as
  `const TIMEOUT_MS = 5000` cancel-wait).
  **Leave inline (LA-3):** `SchoolHeader.tsx` hover `OPEN_DELAY=60`/`CLOSE_DELAY=160`,
  `useQuestionAnchoredScroll.ts:155` `setTimeout(applyAnchor, 600)`.

- **Problem:** The two *network* timeouts (auth request hang cap; cancel-wait poll
  ceiling) are network-behavior knobs with no single home; the cosmetic micro-timings
  are correctly local.

- **Fix (EXACT):** create `frontend/src/config.ts` (the same file CFG-04 uses) with
  named network-timing constants:
  ```ts
  // frontend/src/config.ts — centralized network timings + favicon CDN (CFG-04, CFG-10).

  /** Max ms a short auth/me request may hang before it's a network failure. */
  export const AUTH_REQUEST_TIMEOUT_MS = 15_000;

  /** Max ms to wait for an in-flight turn to terminate after a cancel, before
   *  surfacing a conflict (ChatContext send-while-generating path). */
  export const CANCEL_WAIT_TIMEOUT_MS = 5_000;

  // (favicon helpers from CFG-04 live here too)
  ```
  - `auth.ts`: delete the local `const AUTH_REQUEST_TIMEOUT_MS = 15_000;` and import
    it from `@/config`. Keep the explanatory JSDoc near the `safeFetch` use (move
    the rationale comment, since the constant moved).
  - In the file that holds `cancelAndAwaitClear` after Phase 5 (expected
    `src/app/useTurnEngine.ts`; pre-Phase-5 it's `ChatContext.tsx:676`): replace
    `const TIMEOUT_MS = 5000;` with an import of `CANCEL_WAIT_TIMEOUT_MS` from
    `@/config` and use it in the `Date.now() - start < CANCEL_WAIT_TIMEOUT_MS`
    loop. Keep the explanatory comment.
  - **Do NOT** move the hover/scroll cosmetic timings (LA-3).

- **Tests to add (frontend):** none strictly required (values unchanged); the
  existing auth + ChatContext tests cover behavior. If a config import breaks a
  test's module mock, fix the mock.

- **Acceptance criteria:**
  - [ ] `frontend/src/config.ts` exists with `AUTH_REQUEST_TIMEOUT_MS` and `CANCEL_WAIT_TIMEOUT_MS`.
  - [ ] `auth.ts` imports `AUTH_REQUEST_TIMEOUT_MS`, and the file that holds
        `cancelAndAwaitClear` after Phase 5 (expected `src/app/useTurnEngine.ts`;
        pre-Phase-5 it's `ChatContext.tsx`) imports `CANCEL_WAIT_TIMEOUT_MS` from
        `@/config`; no duplicate inline definitions.
  - [ ] Cosmetic hover/scroll timings remain inline (LA-3).
  - [ ] `npm run typecheck && npm test && npm run build` green.

---

### CFG-11 — Container CMD hardcodes `--host 0.0.0.0 --port 8000`  [LOW]

**value×ease:** Low. **CALL: NOTE ONLY (no change now).** **ADR-0018 bucket:** N/A
(container convention — LA-5).

- **Files:** `Containerfile:25` (CMD), `:23` (EXPOSE 8000).

- **Problem:** `Settings.api_host`/`api_port` are dead in the container path; the
  CMD's flags don't read them. Bind-all + fixed internal port is the conventional
  container pattern.

- **Fix:** **No change now.** Add a comment in `docs/DEPLOY.md` (deploy is deferred)
  noting that **if** a deploy target injects `$PORT` (e.g. Cloud Run), the CMD
  should become `--port ${PORT:-8000}`. Do not change the `Containerfile` itself
  until the deploy phase (B6) needs it.

- **Acceptance criteria:**
  - [ ] `Containerfile` unchanged.
  - [ ] `docs/DEPLOY.md` carries the `$PORT` note.

---

### CFG-12 — `model_prices` defaults in Settings  [LOW]

**value×ease:** Low (already env-overridable via `COUNSELLE_MODEL_PRICES`). **CALL:
LEAVE.** Already bucket 1, already overridable. No change.

- **Acceptance criteria:** [ ] No change (recorded as a deliberate leave).

---

### CFG-13 — `KNOWN_DOMAINS` federal hosts in the frontend  [LOW]

**value×ease:** Low. **CALL: LEAVE (optionally co-locate).** The two federal
authorities' canonical hosts (`collegescorecard.ed.gov`, `nces.ed.gov`) are fixed
invariants — a federal host doesn't change without a national-policy event.

- **Files:** `frontend/src/components/citations/SourceFavicon.tsx:15-18`.

- **Fix:** **No required change.** *Optional, low-priority:* co-locate `KNOWN_DOMAINS`
  with `sourceMeta.ts` so source metadata has one home. Only do this if it falls out
  naturally of the CFG-04 edit; otherwise leave. Do NOT make it configurable.

- **Acceptance criteria:** [ ] Not made configurable; left as a const map (co-location optional).

---

### CFG-14 — `email_from` default `noreply@counselle.app`  [LOW]

**value×ease:** Low. **CALL: LEAVE.** Already bucket 1 (env-overridable). Fine as a
default. No change.

- **Acceptance criteria:** [ ] No change.

---

### CFG-15 — Fuzzy-match thresholds: lift inline `0.4`/`0.7` to named constants  [LOW]

**value×ease:** Low value, easy. **CALL: LIFT TO NAMED CONSTANTS; DEFER Settings.**
The thresholds are tuned algorithm constants — named constants are the right altitude;
the discoverability problem is that `0.4`/`0.7` are buried inline in the SQL string.

- **Files:** `counselle_db/service.py:87-94` (`_FUZZY_SEARCH_SQL` with inline `0.4`,
  `0.7`); near `_FUZZY_EXACT_SCORE = 0.95` (`:97`).

- **Problem:** `0.4` (similarity floor) and `0.7` (word_similarity floor) are inline
  magic numbers in `_FUZZY_SEARCH_SQL`, less discoverable than the sibling
  `_FUZZY_EXACT_SCORE` module constant.

- **Fix (EXACT):** lift to named module constants and interpolate them into the SQL
  **as constants, not parameters** (they are code-owned literals, never user input —
  the existing SQL already inlines them; keep them parameterless to avoid plan churn,
  but make them named). Use a safe-construction f-string of trusted module constants
  (mirror the codebase's existing `# nosec B608` pattern for column-name allowlists):
  ```python
  #: pg_trgm fuzzy-search thresholds, tuned against the live DB (Phase 7). Named for
  #: discoverability (CFG-15); code-owned literals, never user input.
  _FUZZY_SIMILARITY_FLOOR = 0.4
  _FUZZY_WORD_SIMILARITY_FLOOR = 0.7

  _FUZZY_SEARCH_SQL = (  # nosec B608 — only trusted module-constant floats interpolated
      "SELECT unitid, name, city, state, control, level, "
      "GREATEST(similarity(name, $1), word_similarity($1, name)) AS score "
      "FROM schools "
      f"WHERE similarity(name, $1) >= {_FUZZY_SIMILARITY_FLOOR} "
      f"OR word_similarity($1, name) >= {_FUZZY_WORD_SIMILARITY_FLOOR} "
      "ORDER BY GREATEST(similarity(name, $1), word_similarity($1, name)) DESC, name "
      "LIMIT 5"
  )
  ```
  > KISS guard: only the two trusted float constants are interpolated; `$1` stays a
  > bound parameter. This is the same safe pattern the audit verified for the
  > existing allowlist-token interpolations. Do NOT promote to Settings (defer).
  > Also lift `_TRGM_THRESHOLD = 0.25` in `search_fields.py:30`? It is **already** a
  > named module constant — leave it (CFG-15 is only about the inline-in-SQL ones).

- **Tests to add:** none required (behavior unchanged — same numeric thresholds). If
  a fuzzy-resolve test exists, confirm it still passes.

- **Acceptance criteria:**
  - [ ] `0.4`/`0.7` are named module constants interpolated into the SQL via a `# nosec`-annotated safe f-string; no inline magic numbers in `_FUZZY_SEARCH_SQL`.
  - [ ] `$1` remains a bound parameter (no user input interpolated).
  - [ ] No Settings field added (deferred); ruff/mypy clean.

---

### CFG-16 — `_KEYWORD_FLOOR` and discovery merge constants  [LOW]

**value×ease:** Low. **CALL: LEAVE.** `_KEYWORD_FLOOR = 2` and `limit=8` default are
algorithm tuning / a sensible function default — named constants are appropriate. No
change.

- **Acceptance criteria:** [ ] No change.

---

## Security knobs

---

### DS-04 — OAuth account linking trusts unverified email (`associate_by_email=True`)  [MED — security]

**value×ease:** High value (account-takeover surface), but the *full* fix (an email
verification ceremony) is hard and pre-deploy. **CALL: do the cheap guard now if
feasible; otherwise track as a pre-deploy item — decision below.** **ADR-0018
bucket:** the toggle is wiring, not a Settings knob (it's an architecture decision).

- **Files:** `api/main.py:189-201` (`associate_by_email=True`), `api/auth.py:139-180`
  (`oauth_callback`, `_user_exists`), `api/auth.py:266` (`current_active_user` checks
  `active`, not `verified`).

- **Problem:** Email-based linking is only safe when one side proves email ownership.
  Today register creates `is_verified=false` and nothing enforces verification, so a
  password account on any email links with a later Google sign-in for that email (or
  vice-versa) — full chat/PII blast radius. This is a documented MVP tradeoff (ADR
  0021, PRD decision 6), so not CRITICAL, but a real takeover surface.

- **Options (specify all; pick per the decision below):**
  1. **Require email verification before login** (flip the deferred PRD decision):
     gate `current_active_user` (or a new `current_verified_user`) on `is_verified`
     for password accounts. Highest safety, highest scope (needs the verify flow
     wired end-to-end + UX) → **pre-deploy.**
  2. **Only `associate_by_email` when the existing account `is_verified`:** override
     the association logic so a Google sign-in links into a password account ONLY if
     that account is already verified; else create a separate identity / error.
     Medium scope.
  3. **Gate `current_active_user` on `is_verified` for password accounts only**
     (OAuth users are inherently provider-verified). Medium scope, UX impact.

- **What to do NOW (this phase):**
  - **Do not flip behavior in this hardening pass** (it changes the login UX and is a
    product decision — out of scope per the plan's "no new product features" fence,
    REMEDIATION-PLAN §5). Instead:
  - Add a **prominent code comment** at the `associate_by_email=True` site
    (`api/main.py:~197`) marking it a known pre-deploy security item with the option
    list and an ADR/TODO reference.
  - **Track in `TODOS.md`** as a CRITICAL-before-public pre-deploy security item:
    > **DS-04 (pre-deploy security): OAuth `associate_by_email=True` + no email
    > verification = account-takeover surface.** Before any non-trivial user base,
    > do option (1), (2), or (3) from `plans/audit/phase-6-configurability.md`
    > DS-04. Blocks B6 deploy.
  - Add the item to `docs/DEPLOY.md` open-items list.

- **Tests to add:** none now (no behavior change). The future fix carries its own tests.

- **Acceptance criteria:**
  - [ ] Comment at the `associate_by_email=True` site naming it a pre-deploy security item + options.
  - [ ] `TODOS.md` carries DS-04 as a deploy-blocking security item.
  - [ ] `docs/DEPLOY.md` open items include DS-04.
  - [ ] No behavior change shipped this phase.

---

### DS-05 / 06-M2 — Tavily key hand-parses `.env`, bypassing Settings  [LOW — security/maintainability]

**value×ease:** Medium value (removes a CWD-dependent secret-loading footgun +
ADR-0018 violation), easy. **Do it.** **ADR-0018 bucket:** 1 — Settings is the one
config surface.

- **Files:** `adapters/tavily_tools.py:125-165` (`make_tavily_client`);
  `config/settings.py:106` (`tavily_api_key`).

- **Problem:** When neither `settings.tavily_api_key` nor `os.environ["TAVILY_API_KEY"]`
  is set, the code opens `Path(".env")` (CWD-relative), line-splits it, strips inline
  comments, and reads the key — a second ad-hoc config reader that bypasses
  pydantic-settings' `.env` handling and the `_SECRET_FIELDS` masking discipline, and
  breaks under the container `WORKDIR /app` (no `.env` copied).

- **Fix (EXACT):**
  - **Delete** the entire "Last resort: read the .env file directly" block
    (`tavily_tools.py:139-159`, the `if not api_key:` that imports `logging`, opens
    `Path(".env")`, and loops). Remove the now-unused `import os` only if no other
    use remains (the `os.environ.get` fallback below still uses it — keep `os` if so;
    re-check).
  - Keep the resolution order: `settings.tavily_api_key` → `os.environ.get("TAVILY_API_KEY")`
    → raise. The `RuntimeError` message stays.
  - **Support the unprefixed `TAVILY_API_KEY` via a Settings env alias** so the
    common local-dev convention works through the single surface instead of a side
    reader. In `config/settings.py`, give the field a validation alias:
    ```python
    from pydantic import AliasChoices
    ...
    tavily_api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("COUNSELLE_TAVILY_API_KEY", "TAVILY_API_KEY"),
    )  # required only when any external source is enabled
    ```
    > Note: with `env_prefix="COUNSELLE_"`, `validation_alias` overrides the prefix
    > for THIS field only, so BOTH `COUNSELLE_TAVILY_API_KEY` and the bare
    > `TAVILY_API_KEY` populate it. Verify against pydantic-settings v2 semantics
    > (read the installed version's docs if unsure) — if `AliasChoices` interaction
    > with `env_prefix` differs, fall back to keeping the `os.environ.get` line in
    > the factory (that path is fine; it's only the `.env` *file* hand-parse that
    > must die). The hard requirement is: **no hand-rolled `.env` file reader.**
  - Confirm `tavily_api_key` stays in `_SECRET_FIELDS` (it does — `config/settings.py:37`).

  **`.env.example`:** the existing `COUNSELLE_TAVILY_API_KEY=` line stays; add a note
  that the bare `TAVILY_API_KEY` is also honored:
  ```
  # Tavily API key — required only when any external source is enabled.
  # Either COUNSELLE_TAVILY_API_KEY or the bare TAVILY_API_KEY is honored.
  COUNSELLE_TAVILY_API_KEY=
  ```

- **Tests to add (`tests/app/test_tavily_tools.py`):** the existing trio already
  covers `settings.tavily_api_key`, env-var fallback, and missing-key raise. Add:
  - `test_no_dotfile_read`: with `tavily_api_key=None`, env `TAVILY_API_KEY` unset,
    and a `.env` file present in CWD containing a key, `make_tavily_client` raises
    `RuntimeError` (proves the file is no longer read). Use `monkeypatch.chdir(tmp)`
    + a temp `.env`.
  - If the alias path is implemented: `test_settings_reads_bare_tavily_env`
    (monkeypatch `TAVILY_API_KEY`, clear the lru_cache, assert
    `get_settings().tavily_api_key` is set). Mark `live`-free.

- **Acceptance criteria:**
  - [ ] The hand-rolled `.env`-file reader block is gone from `make_tavily_client`.
  - [ ] Resolution is `settings.tavily_api_key` → `os.environ` → raise; OR (preferred) the bare `TAVILY_API_KEY` is a Settings alias and the factory reads only `settings.tavily_api_key`.
  - [ ] `test_no_dotfile_read` proves no file read; existing tavily tests stay green.
  - [ ] `tavily_api_key` remains masked (`_SECRET_FIELDS`).

---

### DS-06 — Rate limiter fails open with only a warning; auth limiter IP-only  [LOW — security]

**value×ease:** Health signal = medium value, easy → **do it.** Email-keyed /
multi-replica path = hard + needs Redis → **defer.** **ADR-0018 bucket:** N/A
(observability + a deferred infra decision).

- **Files:** `api/ratelimit.py:106-134` (`_NoopLimiter`, `get_limiter`),
  `:97-99`/`:137-141` (`check_auth`/`_client_ip`); `api/routes/system.py:26-75`
  (`/v1/health`).

- **Problem:** (1) A missing limiter on `app.state` returns `_NOOP_LIMITER` (admit
  everything) with a single `logger.warning` — easy to miss; if the limiter ever
  isn't wired, all caps silently vanish. (2) Auth limiting is per-IP only
  (distributed/rotating-IP brute force bypasses it).

- **Fix (EXACT):**
  - **(1) Promote the missing-limiter case to a health signal.** `/v1/health`
    already reports DB pools + reconciler (`system.py`). Add a `rate_limiter` field:
    in the health handler, read `getattr(request.app.state, _RATE_LIMITER_ATTR, None)`
    (import `_RATE_LIMITER_ATTR` from `api.ratelimit`) and report
    `"rate_limiter": "ok" if limiter is not None else "MISSING"`. When missing,
    include it in whatever overall-status computation the handler does (degrade the
    health status, mirroring how a failed pool degrades it — read the real handler
    to match its status grammar). This makes a mis-wired limiter visible to
    monitoring instead of silent.
  - **(2) Email-keyed + per-account auth limiting → DEFER.** This needs a body read
    (consumes the stream) or a shared store (Redis) for multi-replica — both are
    explicitly out of scope for single-replica MVP2 (ARCHITECTURE §23). Add/keep the
    multi-replica caveat comment in `ratelimit.py` (it's there) and record the
    email-keyed + per-account-attempt-cap item in `TODOS.md` under the existing
    rate-limit deferral.

- **Tests to add (`tests/api/`):**
  - `test_health_reports_rate_limiter_ok`: with the limiter wired on `app.state`,
    `/v1/health` reports `rate_limiter: "ok"`.
  - `test_health_reports_rate_limiter_missing`: delete the limiter attr from
    `app.state` (or build an app without it), `/v1/health` reports `MISSING` and the
    overall status reflects degradation. (Match the existing health-test fixtures.)

- **Acceptance criteria:**
  - [ ] `/v1/health` reports `rate_limiter` status (`ok`/`MISSING`) and degrades overall status when missing.
  - [ ] Two health tests pass.
  - [ ] Email-keyed/multi-replica path deferred with a `TODOS.md` note (no code).

---

### DS-09 — `oauth_state_secret` falls back to `jwt_secret` (key reuse)  [LOW — crypto hygiene]

**value×ease:** Low (dev convenience vs. blast-radius coupling), easy (doc + matrix).
**Do the documentation/matrix; keep the fallback as dev-only.** **ADR-0018 bucket:**
1 — the field exists; this is about requiring it in the deploy env matrix.

- **Files:** `config/settings.py:155, 171-174` (`oauth_state_secret`,
  `effective_oauth_state_secret`), `api/main.py:196`; `docs/DEPLOY.md`; `.env.example:111-112`.

- **Problem:** `oauth_state_secret` defaults to `None` and `effective_oauth_state_secret`
  falls back to `jwt_secret` — one secret for two crypto purposes (session JWTs +
  OAuth CSRF state). Rotating one forces the other; a leak of one compromises both.

- **Fix (EXACT):** **Keep the fallback** (it's the right dev ergonomics — do not
  break local dev), but make production require a distinct secret:
  - **`docs/DEPLOY.md`** env matrix: add `COUNSELLE_OAUTH_STATE_SECRET` as a
    **required, distinct** prod secret (separate from `COUNSELLE_JWT_SECRET`), with a
    one-line "generate with `python -c "import secrets; print(secrets.token_urlsafe(48))"`"
    note. State explicitly that the `jwt_secret` fallback is **dev-only**.
  - **`config/settings.py`** — update the `oauth_state_secret` comment and the
    `effective_oauth_state_secret` docstring to say "falls back to jwt_secret —
    DEV-ONLY; production MUST set a distinct COUNSELLE_OAUTH_STATE_SECRET."
  - **`.env.example`** — strengthen the existing commented line's note:
    ```
    # OAuth CSRF state secret. Dev: falls back to COUNSELLE_JWT_SECRET when unset.
    # PRODUCTION: set a DISTINCT secret (do not reuse the JWT secret).
    # COUNSELLE_OAUTH_STATE_SECRET=
    ```
  - **Optional (low priority, judgment):** a startup warning when
    `oauth_state_secret is None` AND `cookie_secure is True` (a proxy for "prod"):
    `logger.warning("oauth_state_secret unset — reusing jwt_secret; set a distinct
    COUNSELLE_OAUTH_STATE_SECRET in production")`. Only add if it fits cleanly in the
    factory/lifespan; do not contort the code for it.

- **Tests to add:** none required (doc + comment change). If the optional startup
  warning is added, a small test asserting it logs under `cookie_secure=True` +
  `oauth_state_secret=None` is welcome but optional.

- **Acceptance criteria:**
  - [ ] `docs/DEPLOY.md` requires a distinct `COUNSELLE_OAUTH_STATE_SECRET` in prod; fallback documented dev-only.
  - [ ] Settings comment + `.env.example` note updated.
  - [ ] No behavior change (the fallback still works for dev).

---

### 06-L1 — CORS default ships the dev origin; ADR 0023 wants prod default-empty  [LOW — security/fail-safe]

**value×ease:** Low-medium (a fail-safe gap), easy. **Do it (default-empty + startup
warn).** **ADR-0018 bucket:** 1 — Settings default.

- **Files:** `config/settings.py:124` (`cors_origins` default `["http://localhost:8000"]`);
  `api/context.py:81-87` (`allow_credentials=True`); `.env.example:89-90`.

- **Problem:** The default is a localhost origin and `allow_credentials=True`. ADR
  0023 (same-origin serving) says prod `CORS_ORIGINS` should be default-empty.
  Nothing stops prod accidentally shipping the localhost default. (Starlette blocks
  the `["*"]`+credentials combo, so this isn't exploitable as-is — hence LOW.)

- **Fix (EXACT):**
  - **`config/settings.py:124`** — default to empty:
    ```python
    cors_origins: list[str] = Field(default_factory=list)  # prod: empty (same-origin, ADR 0023); dev sets via env
    ```
  - **`.env.example:89-90`** — update the line + comment so dev knows to set it:
    ```
    # Allowed CORS origins, JSON list. Empty by default (prod same-origin, ADR 0023).
    # Dev (separate Vite origin) must set this to the frontend origin:
    COUNSELLE_CORS_ORIGINS=["http://localhost:5173"]
    ```
    > Note: dev now runs the SPA on `:5173` (Vite) against the `:8000` backend, so the
    > correct dev origin is `http://localhost:5173`, NOT `:8000`. The old default
    > (`:8000`) was wrong for the split-origin dev setup anyway — this fixes both.
  - **Startup warning** (belt-and-suspenders) in the lifespan or `install_middleware`:
    when `cors_origins` is non-empty AND `cookie_secure` is True (prod proxy),
    `logger.warning("CORS_ORIGINS is non-empty under same-origin serving — confirm
    this is intended (ADR 0023)")`. Add only if it fits cleanly in `api/context.py`
    `install_middleware` or the lifespan; keep it one line.
  - Verify `api/context.py` still works with an empty list (CORS middleware with
    `allow_origins=[]` simply allows no cross-origin — correct for same-origin prod).

- **Tests to add (`tests/api/`):**
  - `test_cors_default_empty`: `Settings(...)` built with no `COUNSELLE_CORS_ORIGINS`
    has `cors_origins == []`. (Use the test settings construction; clear the lru_cache.)
  - If the startup warn is added: a test asserting it fires under the prod-proxy
    condition is optional.

- **Acceptance criteria:**
  - [ ] `cors_origins` default is `[]`.
  - [ ] `.env.example` documents the empty default + the correct dev origin (`:5173`).
  - [ ] `test_cors_default_empty` passes; existing CORS/middleware tests still green.
  - [ ] No regression: dev with `COUNSELLE_CORS_ORIGINS` set behaves as before.

---

## Leave-alone (do NOT make configurable)

These are restated so reviewers do **not** flag them as misses and implementers do
**not** over-config them. Promoting any of these into Settings is a value×ease
failure and an ADR-0018 violation.

- **LA-1 — `domain/urls.py:24` `FAVICON_CDN_BASE` (module constant).** Correct by
  design: `domain/` is the inward-most layer and must not import `config/` (ADR
  0017). The one-line CDN swap here is the intended seam. **Keep.** (CFG-04 DRYs only
  the *frontend*; the backend constant is untouched.)
- **LA-2 — `adapters/embeddings.py:23` `BATCH_SIZE = 64`.** A Vertex API cap (≤64
  texts/call), an external invariant, not a preference. **Keep.** (CFG-08 leaves the
  retry knobs too — deferred, not promoted.)
- **LA-3 — Frontend cosmetic micro-timings** (`SchoolHeader` hover `60`/`160`ms,
  `useQuestionAnchoredScroll` `600`ms). Pure presentation polish; named local
  constants with rationale are the right altitude. CFG-10 consolidates only the
  *network* timeouts. **Keep these inline.**
- **LA-4 — `Settings.protocol_version = 1` (and the `v` field on events).** A frozen
  protocol invariant — "bump only with an architecture discussion." Already a Settings
  field with a guard comment; do not loosen. **Keep.**
- **LA-5 — `Containerfile` `0.0.0.0` bind.** Conventional container binding; the
  orchestrator owns external port mapping. **Keep** (CFG-11 is a deferred deploy note
  only — no `Containerfile` change this phase).
- **LA-6 — The honesty-engine + fixed-schema constants:** the SQL guard regexes
  (`_SQL_*_RE`, `service.py:165-172`), the R1–R12 reading-rule logic, `CREDLEV_DECODE`,
  the IPEDS race-group / column-stem constants, `_CONTROL_DISPLAY`,
  `SCORECARD_DECODE_MAPS`. The honesty spec + fixed external schema (IPEDS column
  names, federal credlev codes). ADR 0018 names exactly these as legitimately
  hardcoded. **Keep.** (CFG-15 only *names* two already-inline fuzzy float thresholds
  — it does NOT touch decode maps or reading rules.)
- **LA-7 — `_MIN_JWT_SECRET_BYTES = 32` (`config/settings.py:30`).** A library-imposed
  floor (pyjwt 2.13 warns below 32), used as a validator — an invariant, not a knob.
  **Keep.** (CFG-03 adds `password_min_length`, a *separate* policy knob — do not
  conflate; do not make the JWT floor configurable.)
- **LA-8 — `cookie_samesite="lax"` (`api/auth.py:207,245`).** The correct, deliberate
  default for the OAuth-redirect flow; changing it is an architecture decision.
  `cookie_secure` is already Settings-gated (the part that matters for prod). **Keep**
  `SameSite=Lax` literal.
- **LA-9 — DS-11 (catalog serves stale data on refresh failure).** Serve-stale is the
  correct availability tradeoff; monitored via /v1/health; no code change — see master
  plan §3. Relevant here because CFG-01 (school_count) edits `counselle_db/catalog.py`;
  do NOT change the serve-stale behavior while wiring the count through that file.

**CFG leave-calls (decisions recorded above, restated):**
- **CFG-06** — compare/dossier/search caps: **DEFER** (rationale comment + TODOS note; no Settings).
- **CFG-08** — embedding retry/backoff: **DEFER** (rationale comment + TODOS note; `BATCH_SIZE` kept).
- **CFG-11** — container CMD port: **NOTE-ONLY** in `docs/DEPLOY.md`; no `Containerfile` change.
- **CFG-12** — `model_prices`: **LEAVE** (already env-overridable).
- **CFG-13** — frontend `KNOWN_DOMAINS` federal hosts: **LEAVE** (fixed authorities; co-locate optional).
- **CFG-14** — `email_from` default: **LEAVE** (already env-overridable).
- **CFG-15** — fuzzy thresholds: **LIFT inline `0.4`/`0.7` to named constants; DEFER Settings.** (`_TRGM_THRESHOLD` already named — leave.)
- **CFG-16** — `_KEYWORD_FLOOR`/discovery defaults: **LEAVE** (algorithm tuning at right altitude).

---

## Cross-phase notes

- **Phase 1 ↔ CFG-02:** Both edit `app/turns.py`. CFG-02 is read-site-only (no
  behavior change), so it composes with Phase 1's lifecycle fixes — but **re-read the
  post-Phase-1 `app/turns.py`** before removing the `getattr` fallbacks (line numbers
  and surrounding code may have moved). The `FakeSettings` field additions
  (`tests/app/test_run_turn.py`) must land with CFG-02 regardless of Phase 1.
- **Phase 4 ↔ CFG-04 / CFG-10:** Phase 4 owns FE-H1 (favicon privacy) and FE-M9
  (CSP), and creates frontend resilience scaffolding. CFG-04 DRYs the favicon URL and
  CFG-10 creates `frontend/src/config.ts`. **Reconcile:** if Phase 4 already created
  a config module or already routed favicons through one helper, extend it rather
  than duplicating. If FE-H1 removed remote favicons, CFG-04's DRY may be partly
  moot — adapt. Check the Phase 4 diff first.
- **Phase 5 ↔ CFG-10:** Phase 5 de-gods `ChatContext.tsx`, moving `cancelAndAwaitClear`
  (and its cancel-wait `TIMEOUT_MS`) into `src/app/useTurnEngine.ts`. The CFG-10 edit is
  a one-line constant import in whichever file holds `cancelAndAwaitClear` after Phase 5
  (expected `src/app/useTurnEngine.ts`; pre-Phase-5 `ChatContext.tsx`) — land it there,
  reading the current tree first so the import targets the post-de-god location.
- **Phase 7 ↔ this phase:** Phase 7 writes regression tests + docs truth-up. The
  tests specified here (CFG-01/02/03/07/09, DS-05/06, 06-L1) are owned by THIS phase;
  Phase 7 only re-baselines evals and syncs docs — it does not re-test these.
- **`docs/` edits:** `docs/DEPLOY.md` gains DS-04, DS-09, CFG-11, 06-L1 items. Read
  it before writing (it's the deferred deploy guide). Do NOT mark deploy "done."

---

## Phase completion checklist

- [ ] **CFG-01** school count derives live from DB (`Catalog.school_count`); not-found message, system prompt, MCP tool desc all de-hardcoded; tests green; no `2,746` literal remains.
- [ ] **CFG-02** all `getattr(self._settings, ...)` fallbacks removed from `app/turns.py`; `FakeSettings` carries the registry fields; turns suite green.
- [ ] **CFG-03** `password_min_length` Settings field + `.env.example` + read site; tests prove it's sourced from Settings.
- [ ] **CFG-04** single `faviconUrl` helper; both frontend sites use it; backend `domain/urls.py` constant untouched; reconciled with Phase 4.
- [ ] **CFG-05** `VITE_API_PROXY_TARGET`/`VITE_DEV_PORT` env in `vite.config.ts`; `frontend/.env.example` documents them.
- [ ] **CFG-06** deferred (rationale comment + TODOS); no Settings field.
- [ ] **CFG-07** `thinking_threshold_chars` Settings field; production router construction sources it; module constant kept as the dataclass test-default; router test green.
- [ ] **CFG-08** deferred (rationale comment + TODOS); `BATCH_SIZE` kept.
- [ ] **CFG-09** `config/assets/prompts/title.md` created; `_TITLE_PROMPT` removed; `load_prompt("title")` used; tests green.
- [ ] **CFG-10** `frontend/src/config.ts` created with `AUTH_REQUEST_TIMEOUT_MS` + `CANCEL_WAIT_TIMEOUT_MS`; both read sites import them; cosmetic timings left inline.
- [ ] **CFG-11** note-only in `docs/DEPLOY.md`; `Containerfile` unchanged.
- [ ] **CFG-12/13/14/16** left as deliberate leaves (recorded).
- [ ] **CFG-15** inline `0.4`/`0.7` lifted to named constants via a safe `# nosec` f-string; `$1` stays bound; ruff/mypy clean.
- [ ] **DS-04** comment + `TODOS.md` + `docs/DEPLOY.md` pre-deploy security item; no behavior change.
- [ ] **DS-05** hand-rolled `.env` reader deleted; key resolution via Settings (bare `TAVILY_API_KEY` aliased or env-fallback only); `test_no_dotfile_read` green; key still masked.
- [ ] **DS-06** `/v1/health` reports `rate_limiter` status + degrades when missing; two tests green; email-keyed/multi-replica deferred (TODOS).
- [ ] **DS-09** distinct `COUNSELLE_OAUTH_STATE_SECRET` required in `docs/DEPLOY.md`; fallback documented dev-only; Settings comment + `.env.example` updated.
- [ ] **06-L1** `cors_origins` default `[]`; `.env.example` updated (dev origin `:5173`); `test_cors_default_empty` green.
- [ ] **Leave-alone** LA-1..LA-9 untouched and verified by reviewers (LA-9 = DS-11 serve-stale).
- [ ] **Gate green:** `ruff`, `mypy`, routine pytest, frontend `typecheck`/`test`/`build` all pass.
- [ ] **No new `2,746`/hardcoded-count/`getattr(self._settings`/inline-`.env`-reader regressions** (`grep` checks in the relevant acceptance criteria).
- [ ] `TODOS.md` updated with all deferred items (CFG-06, CFG-08, DS-04, DS-06 multi-replica).
