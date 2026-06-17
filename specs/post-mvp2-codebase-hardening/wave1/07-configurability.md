# Wave 1 Audit — 07: Hardcoding vs. Configurability

**Scope:** entire repo (backend `app/`, `api/`, `domain/`, `adapters/`, `counselle_db/`, `config/`, `evals/`, `scripts/`, `migrations/`, `Containerfile`, the React/Vite frontend).
**Lens:** ADR 0018 — one fail-fast typed `Settings` surface (bucket 1), versioned data assets `config/assets/` (bucket 2), live-derived-from-DB facts (bucket 3). Hardcoding is permitted *only* for true invariants (R1–R12 logic, protocol schemas, SQL parameterization). The test ADR 0018 itself names: *"would a developer ever plausibly change this without an architecture discussion?"*
**Decision rule:** value × ease. Make it configurable only when configurability adds real value; do **not** manufacture config for invariants or add noise.

## Headline

The codebase is genuinely well-configured. `config/settings.py` + `.env.example` are comprehensive and disciplined; the data-asset and live-from-DB buckets are used as ADR 0018 intends. Most "magic numbers" found are correctly-placed named module constants with a one-line rationale, and several are *true invariants* that should stay put. The findings below are the real gaps — a handful of genuinely-should-be-configurable values, one honesty-relevant DB-fact that is hardcoded in three places (the most important), and a cluster of duplicated-default `getattr(..., literal)` fallbacks that violate the single-source-of-truth goal.

**Counts:** HIGH 3 · MEDIUM 7 · LOW 6 · notable leave-alone 8.

---

## HIGH

### CFG-01 — School count "~2,746" hardcoded in code + prompt, should derive from DB
- **Severity:** HIGH (value: honesty-critical fact that drifts every pipeline re-ingest; ease: easy)
- **Locations:**
  - `counselle_db/service.py:67-71` — `_NOT_FOUND_MESSAGE = "That school is not in our database — we cover ~2,746 curated 4-year US institutions. ..."`
  - `counselle_db/server.py:102` — MCP tool description: "database of ~2,746 curated 4-year US institutions"
  - `config/assets/prompts/counselor.md:69` — "outside our current set of ~2,746 4-year US institutions"
- **Current value:** `~2,746` (snapshot 2026-06-09; the live table will diverge after any re-ingest).
- **Where it should live:** **bucket 3 — live-derived from DB** (`SELECT count(*) FROM schools`), cached at catalog build time (the `Catalog` already loads at startup). Exactly the ADR 0018 example of "deriving facts live is what keeps recency/coverage honest — configuring them would be a lie waiting to happen."
- **Fix direction:** add `Catalog.school_count` (computed once at build), thread it into the not-found message and the system prompt slot; drop the literal from `counselor.md` (make it a `{school_count}` slot like the other prompt slots). For the MCP tool description (a static string), either inject at registration or soften to "~2,700+".
- **value × ease:** High value (this is the one carve-out the project spends effort on — never lie to a student about coverage), low effort. **Do it.**

### CFG-02 — Turn-registry & rate-limit Settings defaults duplicated as `getattr(..., literal)` fallbacks
- **Severity:** HIGH (value: kills the single-source-of-truth ADR 0018 is built to guarantee; ease: easy)
- **Locations (the literal re-states the Settings default, so the two can silently drift):**
  - `app/turns.py:221` — `getattr(self._settings, "max_concurrent_turns", 50)` (Settings default is `50`)
  - `app/turns.py:224` — `getattr(self._settings, "stream_buffer_size", 20_000)` (Settings: `20_000`)
  - `app/turns.py:248` — `getattr(self._settings, "max_consumers_per_turn", 8)` (Settings: `8`)
  - `app/turns.py:300` — `getattr(self._settings, "turn_timeout_s", 180)` (Settings: `180`)
  - `app/turns.py:369` — `getattr(self._settings, "model_counselor", "")`
- **Current value:** literal copies of `config/settings.py` defaults.
- **Where it should live:** they already live in `Settings` — the fallback literal is the bug.
- **Fix direction:** `TurnRegistry` is always constructed with a real `Settings` (`api/main.py:131`). Drop the `getattr`-with-default and read `self._settings.max_concurrent_turns` etc. directly (the type is `Settings`, not `Any`, ideally). If a test seam needs a stub, give the stub the fields. One source of truth, no drift.
- **value × ease:** High value (a changed `.env` could be silently ignored if a code path hit the fallback), trivial effort. **Do it.**

### CFG-03 — Password minimum length hardcoded
- **Severity:** HIGH (value: a security policy a deployer will plausibly want to tune; ease: easy)
- **Location:** `api/auth.py:92-94` — `if len(password) < 8: raise InvalidPasswordException("Password must be at least 8 characters.")`
- **Current value:** `8` (in both the check and the user-facing string).
- **Where it should live:** **bucket 1 — Settings** (`password_min_length: int = 8`), with the message derived from it.
- **Fix direction:** add `password_min_length` to `Settings`, read it in `validate_password`, interpolate into the message. This is exactly the ADR 0018 test ("a developer would plausibly change this") and it's a security knob.
- **value × ease:** Medium-high value, trivial effort. **Do it.**

---

## MEDIUM

### CFG-04 — Favicon CDN host duplicated across backend + two frontend files (no single source)
- **Severity:** MEDIUM
- **Locations:**
  - `domain/urls.py:24` — `FAVICON_CDN_BASE = "https://www.google.com/s2/favicons"`
  - `frontend/src/components/cards/schoolLogo.ts:29` — `https://www.google.com/s2/favicons?...`
  - `frontend/src/components/citations/SourceFavicon.tsx:65` — `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
  - plus `frontend/src/components/cards/schoolLogo.ts:30` DuckDuckGo + `:27` logo.dev (logo.dev is already env-gated via `VITE_LOGO_DEV_TOKEN` — good).
- **Current value:** Google s2 favicon host, repeated three times; the `sz=64` literal in `SourceFavicon.tsx` is a separate inline magic number.
- **Where it should live:** backend: `domain/urls.py` constant is correctly a swappable module constant (ADR 0017 forbids `domain/` importing `config/` — leaving it as a constant is *correct*, see leave-alone LA-1). Frontend: one shared `logoCdn` helper/const (the existing `schoolLogo.ts` is the natural home) that `SourceFavicon.tsx` reuses instead of re-spelling the URL.
- **Fix direction:** DRY the two frontend call sites onto `logoCandidates`/a shared `faviconUrl(host, size)` helper; lift `sz=64` to a named default. Keep the backend constant as-is.
- **value × ease:** Medium value (a CDN swap today touches 3 files), easy. **Do the frontend DRY.**

### CFG-05 — Vite dev proxy + API base hardcoded; no `VITE_API_BASE`
- **Severity:** MEDIUM
- **Locations:**
  - `frontend/vite.config.ts:16-18` — proxy `'/v1': 'http://localhost:8000'`
  - `frontend/vite.config.ts:15` — `port: 5173`
- **Current value:** dev proxy target `http://localhost:8000`, dev port `5173`.
- **Where it should live:** **frontend config / env** — `VITE_API_PROXY_TARGET` (dev proxy) read from `process.env`, mirroring the deploy story in `docs/DEPLOY.md`. The app talks to a relative `/v1`, so prod is fine; the *dev* target and port are the configurable bits.
- **Fix direction:** `'/v1': process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:8000'` and `port: Number(process.env.VITE_DEV_PORT ?? 5173)`. Document in `frontend/.env.example`.
- **value × ease:** Medium value (anyone running the backend on a non-default port or a remote host must edit committed code today), easy. **Do it.**

### CFG-06 — `compare_schools` / dossier / programs preview caps hardcoded
- **Severity:** MEDIUM
- **Locations:** `counselle_db/service.py:62-65`
  - `_COMPARE_MAX_SCHOOLS = 6`, `_COMPARE_MAX_FIELDS = 25`, `_PROGRAMS_PREVIEW_TOP_N = 10`
  - also `app/steps.py:75` `_MAX_STEP_SOURCES = 8`, `app/sources.py:32` `_MAX_SNIPPET_CHARS = 300`, `counselle_db/search_fields.py:25` `_MAX_LIMIT = 25`
- **Current value:** as above. The comments call them "protocol sanity caps — not tuning knobs," which is a defensible position.
- **Where it should live:** judgment call. `_COMPARE_MAX_FIELDS` (25) and `_PROGRAMS_PREVIEW_TOP_N` (10) are the two a developer would plausibly tune (payload size vs. richness) → **bucket 1 Settings** if you want them tunable. The hard "1 school is degenerate" style bounds and `_MAX_SNIPPET_CHARS` are closer to invariants.
- **Fix direction:** if pursued, add `compare_max_fields`, `dossier_programs_preview_n`, `search_fields_max_limit` to Settings. Otherwise leave with the existing rationale comment.
- **value × ease:** Low-medium value (these rarely change), easy. **Borderline — defer unless product wants UI density control.**

### CFG-07 — Thinking threshold + label-length caps are editorial, not invariants
- **Severity:** MEDIUM
- **Locations:** `app/steps.py:65` `THINKING_THRESHOLD_CHARS = 240`; `app/steps.py:69` `_LABEL_QUERY_MAX_CHARS = 120`
- **Current value:** 240 (chars below which pre-tool text routes to `thinking` vs `delta`), 120 (label truncation).
- **Where it should live:** `THINKING_THRESHOLD_CHARS` directly shapes the live timeline UX (when narration vs. answer streams) — it's a product/editorial dial, arguably **bucket 1 Settings**. `_LABEL_QUERY_MAX_CHARS` is presentation polish, lower priority.
- **Fix direction:** promote `THINKING_THRESHOLD_CHARS` → `thinking_threshold_chars` in Settings (it already flows in as the `EmissionRouter.threshold` field, so plumbing is half-done). Leave label cap as a constant.
- **value × ease:** Medium value (you'll want to tune this against real Gemini chunking), easy. **Do the threshold.**

### CFG-08 — Embedding batch size + retry/backoff hardcoded
- **Severity:** MEDIUM
- **Locations:** `adapters/embeddings.py:23-25` — `BATCH_SIZE = 64`, `_MAX_ATTEMPTS = 3`, `_BACKOFF_BASE_S = 1.0`
- **Current value:** batch 64 (a Vertex API cap → near-invariant), 3 attempts, 1.0s base backoff.
- **Where it should live:** `BATCH_SIZE` is a provider limit — leave it (it's a true invariant; see LA-2). `_MAX_ATTEMPTS`/`_BACKOFF_BASE_S` are operational tunables → **bucket 1 Settings** if you want to tune resilience without a deploy.
- **Fix direction:** optionally add `embed_max_attempts` / `embed_backoff_base_s` to Settings. Low urgency.
- **value × ease:** Low-medium value, easy. **Borderline — defer.**

### CFG-09 — Auto-title prompt is an inline string, not a data asset
- **Severity:** MEDIUM
- **Location:** `app/titles.py:28-32` — `_TITLE_PROMPT = "You name chat conversations. ..."`
- **Current value:** a multi-line editorial prompt embedded in code.
- **Where it should live:** **bucket 2 — `config/assets/prompts/`** (e.g. `title.md`), loaded via the existing `load_prompt`. ADR 0018 explicitly puts "agent prompts (one file per agent)" in bucket 2; the counselor/clarifier/judge prompts already live there — this one is the outlier.
- **Fix direction:** move to `config/assets/prompts/title.md`, load with `load_prompt("title")`. (The judge prompt in `evals/judge.md` is arguably the same smell but eval-only — lower priority.)
- **value × ease:** Medium value (consistency + editorial tuning by diff), easy. **Do it.**

### CFG-10 — Frontend hover/timeout magic numbers scattered (no shared timing config)
- **Severity:** MEDIUM
- **Locations:**
  - `frontend/src/components/cards/SchoolHeader.tsx:19-20` — `OPEN_DELAY = 60`, `CLOSE_DELAY = 160`
  - `frontend/src/api/http/auth.ts:122` — `AUTH_REQUEST_TIMEOUT_MS = 15_000`
  - `frontend/src/app/ChatContext.tsx:676` — `const TIMEOUT_MS = 5000` (cancel-wait)
  - `frontend/src/app/useQuestionAnchoredScroll.ts:155` — `setTimeout(applyAnchor, 600)`
- **Current value:** as above; each is a well-named local constant with a comment (good hygiene) but there is no single timing surface.
- **Where it should live:** these are presentation micro-timings — keeping them as named local constants is acceptable (LA-3). The two worth surfacing are `AUTH_REQUEST_TIMEOUT_MS` and the cancel `TIMEOUT_MS` (network behavior, not pure cosmetics) → a small `frontend/src/config.ts` of timing constants would centralize them.
- **Fix direction:** optionally consolidate the *network* timeouts into one `frontend/src/config.ts`; leave the hover/scroll cosmetics inline.
- **value × ease:** Low-medium value, easy. **Borderline — light consolidation only.**

---

## LOW

### CFG-11 — Container `CMD` hardcodes `--host 0.0.0.0 --port 8000`, ignoring Settings
- **Severity:** LOW
- **Location:** `Containerfile:25` — `CMD ["uv","run","uvicorn","api.main:create_app","--factory","--host","0.0.0.0","--port","8000"]`; `EXPOSE 8000` (`:23`)
- **Current value:** `0.0.0.0:8000`. Note `Settings.api_host`/`api_port` exist but uvicorn's CLI flags here don't read them.
- **Where it should live:** acceptable for a container (bind-all + fixed internal port is the conventional pattern; the orchestrator maps the external port). The mild smell is that `Settings.api_host`/`api_port` are dead in the container path. **Mostly leave-alone** (LA-5) — flag only so the planner knows the two configs coexist.
- **value × ease:** Low value, leave as-is unless deploy needs `$PORT` (e.g. Cloud Run) → then `--port ${PORT:-8000}`.

### CFG-12 — `model_prices` defaults embedded in `Settings`
- **Severity:** LOW
- **Location:** `config/settings.py:186-191` — Gemini Pro `(1.25, 10.0)`, Flash `(0.30, 2.50)`.
- **Current value:** Vertex list prices, est-only, with a clear caveat; already overridable via `COUNSELLE_MODEL_PRICES` JSON env.
- **Where it should live:** already configurable (bucket 1). The only nit: prices are editorial/volatile data — could be a bucket-2 YAML asset. Low priority; the env override is sufficient.
- **value × ease:** Low value (already overridable). **Leave.**

### CFG-13 — `KNOWN_DOMAINS` for federal sources hardcoded in frontend
- **Severity:** LOW
- **Location:** `frontend/src/components/citations/SourceFavicon.tsx:15-18` — `{ scorecard: 'collegescorecard.ed.gov', ipeds: 'nces.ed.gov' }`
- **Current value:** the two federal authorities' canonical hosts.
- **Where it should live:** these are genuinely fixed canonical authorities (a federal site host doesn't change without a national-policy event). Borderline invariant; keeping it as a small const map is fine. If anything, co-locate with `sourceMeta.ts` so source metadata has one home.
- **value × ease:** Low value. **Leave (optionally co-locate).**

### CFG-14 — `email_from` default `noreply@counselle.app` baked as Settings default
- **Severity:** LOW
- **Location:** `config/settings.py:160` — `email_from: str = "noreply@counselle.app"`
- **Current value:** the From address.
- **Where it should live:** already bucket 1 (env-overridable). It's fine as a default; flagged only because `console` is the sole email provider today, so it's currently cosmetic. **Leave** (revisit when a real provider lands).

### CFG-15 — `_TRGM_THRESHOLD` / fuzzy-match scores hardcoded
- **Severity:** LOW
- **Locations:** `counselle_db/search_fields.py:30` `_TRGM_THRESHOLD = 0.25`; `counselle_db/service.py:97` `_FUZZY_EXACT_SCORE = 0.95`; the `0.4 / 0.7` thresholds inside `_FUZZY_SEARCH_SQL` (`service.py:87-94`).
- **Current value:** tuning thresholds for fuzzy school/field matching, with comments noting they were "tuned against the live DB."
- **Where it should live:** these are tuned algorithm constants. Promote to Settings only if you expect to re-tune frequently; otherwise the named constant + comment is the right altitude. Mild concern: the `0.4`/`0.7` are inline in the SQL string (less discoverable than the module constants).
- **Fix direction:** at minimum lift the `0.4`/`0.7` to named constants alongside `_FUZZY_EXACT_SCORE` for discoverability. Settings promotion optional.
- **value × ease:** Low value, easy. **Lift to named constants; defer Settings.**

### CFG-16 — `_KEYWORD_FLOOR = 2` and other discovery merge constants
- **Severity:** LOW
- **Location:** `counselle_db/search_fields.py:27` — `_KEYWORD_FLOOR = 2`; default `limit=8` in `search_fields(...)` signature (`:161`).
- **Current value:** keyword floor 2, default result limit 8.
- **Where it should live:** algorithm tuning; named constants are appropriate. The `limit=8` default is a sensible function default. **Leave.**

---

## Notable leave-alone (do NOT make these configurable — avoid over-engineering)

- **LA-1 — `domain/urls.py:24` `FAVICON_CDN_BASE` as a module constant.** Correct by design: `domain/` is the inward-most layer and must not import `config/` (ADR 0017). A one-line swap here is the intended seam. **Keep.**
- **LA-2 — `adapters/embeddings.py:23` `BATCH_SIZE = 64`.** A Vertex API cap (≤64 texts/call), verified against the SDK. A true external invariant, not a preference. **Keep.**
- **LA-3 — Frontend cosmetic micro-timings** (`SchoolHeader` hover 60/160ms, `useQuestionAnchoredScroll` 600ms). Pure presentation polish; named local constants with rationale comments are the right altitude. **Keep.**
- **LA-4 — `Settings.protocol_version = 1` (`config/settings.py:145`) and the `v` field on events.** Explicitly a frozen protocol invariant ("bump only with an architecture discussion"). Already a Settings field with a guard comment; do not loosen it further. **Keep.**
- **LA-5 — `Containerfile` `0.0.0.0` bind.** Conventional container binding; the orchestrator owns external port mapping. **Keep** (see CFG-11 nuance).
- **LA-6 — SQL guard regexes / `_SQL_*_RE` (`service.py:165-172`), the R1–R12 reading-rule logic, `CREDLEV_DECODE`, `_RACE_GROUPS` IPEDS column stems, `_CONTROL_DISPLAY`.** These are the honesty-engine spec and fixed external schema (IPEDS column names, federal credlev codes). ADR 0018 names exactly these as legitimately hardcoded. **Keep.**
- **LA-7 — `_MIN_JWT_SECRET_BYTES = 32` (`config/settings.py:30`).** A library-imposed floor (pyjwt 2.13 warns below 32), used as a validator — an invariant, not a knob. **Keep.**
- **LA-8 — `cookie_samesite="lax"` literal (`api/auth.py:207,245`).** Cookie security posture; could be a Settings field, but SameSite=Lax is the correct, deliberate default for this OAuth-redirect flow and changing it is an architecture decision. `cookie_secure` is *already* Settings-gated (the part that matters for prod). **Keep** (or promote only if a real cross-site embed need appears).

---

## Cross-cutting recommendations for the planner

1. **Fix CFG-02 first** — the duplicated `getattr(..., literal)` defaults directly defeat ADR 0018's single-source-of-truth promise and are pure downside (a `.env` change can be silently ignored). One pass over `app/turns.py`.
2. **CFG-01 is the honesty one** — the school count is a DB fact hardcoded in three places including the system prompt; it belongs in bucket 3 (live-from-DB). This is the highest-value item under the project's "never lie to a student" carve-out.
3. **CFG-03 and CFG-09 are clean ADR-0018-compliant moves** (a security knob → Settings, an editorial prompt → asset) with near-zero risk.
4. **Resist over-config:** the LOW findings and the leave-alone list exist because the codebase already does this well — do not promote invariants (BATCH_SIZE, protocol_version, reading-rule logic, IPEDS schema) into Settings just to satisfy "no hardcoded stuff." That would add noise and fail the value × ease test.
