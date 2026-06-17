# Wave 1 Audit — Data-Access Layer & Security

**Auditor:** independent security-and-data engineer (read-only review)
**Date:** 2026-06-16
**Territory:** `counselle_db/` (service, catalog, search_fields, service_find, server, db), `domain/` honesty engine (normalize, vintage, envelope), all SQL, `api/auth.py`, `api/users_db.py`, `api/routes/`, `api/deps.py`, `api/ratelimit.py`, `migrations/`, `scripts/setup_db.sql`, `config/settings.py`, `adapters/tavily_tools.py`, `adapters/embeddings.py`.

## Overall assessment

The data-access and security layer is **well-built and unusually disciplined** for a startup MVP. The two highest-risk areas were checked hard and held up:

- **SQL injection:** Every query path is parameterized. The only f-stringed SQL fragments (`service_find.py`, `search_fields.py`, the `_USER_COLS`/`_OAUTH_COLS` update builders, the `list_sessions` keyset clause) interpolate **only** generated aliases, whitelist-dict tokens, fixed column-name allowlists, and a module constant — never user/LLM input. Values bind via `$N` everywhere. No injection found.
- **Authorization:** `owned_session` (api/deps.py:71) enforces `row.user_id == user.id` and returns 404 (no existence leak) on foreign/unknown. Every session route depends on it; feedback and feedback-read are user-scoped in SQL (`WHERE user_id = $1`). I could not construct a path where user A reads/writes user B's chats, turns, or feedback.
- **Read-only guarantee:** `counselle_ro` carries `default_transaction_read_only = on` + statement timeout server-side, re-applied per-connection. Helper functions are `LANGUAGE sql` (NOT `SECURITY DEFINER`) so they run with the caller's RO grants. The LLM escape hatch uses the RO pool; the writable `counselle_app` pool is only reached by the reconciler and user/session CRUD, never by LLM-controlled SQL.
- **Honesty engine:** `normalize()` degrades all data weirdness to `available=False, "not available"` and never raises on data; viz/sources degrade to explicit "do not invent values"; citations are code-built, never model-built.

Findings below are mostly hardening / edge-case honesty issues. **No CRITICAL issues found.**

---

## Findings

### DS-01 — Coded `int` with an unmapped code displays the raw code (R1 honesty edge)
- **Severity:** MEDIUM
- **Category:** Honesty / value decoding
- **Location:** `domain/normalize.py:166-173` (`_int`)
- **Evidence:**
  ```python
  def _int(value, decode_map):
      count = int(_decimal(value).to_integral_value(rounding=ROUND_HALF_UP))
      if decode_map is not None and str(count) in decode_map:  # R1
          label = decode_map[str(count)]
          return NormalizedValue(display=label, ...)
      return NormalizedValue(display=f"{count:,}", ...)  # <-- falls through
  ```
- **Why it matters:** R1 (DATABASE_GUIDE §6) is explicit: "never show `control: 2`." When a field **is** coded (a decode_map exists) but the stored code is **not in the map** — a new IPEDS code, a valuesets table that loaded partially, or a sentinel the map doesn't cover — the engine silently shows the raw integer as if it were a count. A student could be told a school's `CONTROL` is "4" or `ADMCON7` is "1" with no decode. This is exactly the misread R1 is meant to prevent, and it fails open to the wrong-looking number rather than to "not available."
- **Trigger:** Any coded IPEDS/Scorecard int field whose stored value isn't a key in its decode map (model drift, partial valuesets load, or a sentinel).
- **Fix:** When `decode_map is not None` (the field is known-coded) and `str(count)` is missing, return `_not_available()` (or a display that names the unknown code as un-decodable) instead of `f"{count:,}"`. A coded field with an unknown code is "unknown," not a count.

### DS-02 — `search_school_site` tiers any returned URL as `official` even if off-domain
- **Severity:** MEDIUM
- **Category:** Honesty / citation mis-attribution
- **Location:** `adapters/tavily_tools.py:258-286`
- **Evidence:** The citation is fixed to `tier="official", source="edu"` from the resolved school domain, then per-result the URL is overwritten with `r.get("url")` while the tier stays `official`:
  ```python
  citation = Citation(source="edu", tier="official", ...)
  items = [_result_to_item(r, citation.model_copy(update={"url": r.get("url", ...)})) for r in results]
  ```
- **Why it matters:** Tavily's `include_domains` is a relevance bias, not a hard guarantee in all SDK/plan tiers. If a result on a non-`.edu`/non-official host comes back, it is still stamped `official` with no "verify on the official site" caveat — a community page presented to a student as the school's own authoritative source. That's a citation-attribution honesty violation.
- **Trigger:** Tavily returns a result whose URL is not on the requested school domain.
- **Fix:** Re-derive the tier per result from the actual `r["url"]` via the same `_is_official_domain` / `_citation_for_web_result` logic used by `search_web`, instead of copying a pre-stamped `official` citation onto every row.

### DS-03 — LLM SQL escape hatch bypasses the normalization/citation engine
- **Severity:** MEDIUM
- **Category:** Honesty / design (accepted but under-fenced)
- **Location:** `counselle_db/service.py:614-639` (`query_database`), `counselle_db/server.py:199-213`
- **Evidence:** `query_database` returns raw rows (`rows=[list(row) for row in rows]`) with no envelope. The only honesty control is the tool docstring ("the reading rules still apply… percent values are 0–1 fractions… negative IPEDS sentinels mean missing").
- **Why it matters:** This is the one path where a value reaches the model with **no** decode, no ×100 percent scaling, no vintage, no citation, no `available=False` for sentinels. The model is trusted, via prose in a docstring, to apply R1–R12 by hand. A model that reads `acceptance_rate = 0.036` and reports "3.6 acceptances" or reads a `-2` system sentinel as a real value would directly violate the product's non-negotiable honesty principle. ADR 0005 accepts this as a rare escape hatch, but there is no runtime guard that the raw rows are actually re-honesty-checked.
- **Trigger:** Any agent turn that uses `query_database` for values it then states to a student (percentages, coded ints, sentinel-bearing columns).
- **Fix (cheap, high value):** Keep the hatch but (a) in the tool result, flag columns that map to known coded/percent/sentinel fields with an inline "decode/scale before quoting" note, or (b) route value-bearing escape-hatch results back through `normalize` where a `field_key` is recoverable. At minimum, add an eval that catches raw-fraction / raw-code leakage from this tool.

### DS-04 — OAuth account linking trusts unverified email (`associate_by_email=True`)
- **Severity:** MEDIUM
- **Category:** Auth / account takeover surface
- **Location:** `api/main.py:189-201` (`associate_by_email=True`), `api/auth.py:139-180` (`oauth_callback` / `_user_exists`)
- **Evidence:** The Google OAuth router is mounted with `associate_by_email=True`. There is no email-verification ceremony anywhere (PRD decision 6, documented in ADR 0021): register creates `is_verified=false` and nothing enforces it (`current_active_user` checks `active`, not `verified`).
- **Why it matters:** Email-based account linking is only safe when at least one side proves email ownership. Here, a password account can be created with any email (never verified), and a later Google sign-in for that email links into it (or vice-versa). An attacker who registers `victim@gmail.com` with a password, then the victim signs in with Google, ends up sharing an identity row — or an attacker who controls a Google identity links into a pre-existing password account. The blast radius is full chat/PII access. This is a **documented, deliberate** MVP tradeoff, so it is not CRITICAL, but it is a real takeover surface that must be closed before any non-trivial user base.
- **Trigger:** Mixed password + Google sign-up on the same email without verification.
- **Fix:** Before any production exposure, either (a) require email verification before login (flip the deferred PRD decision), or (b) only `associate_by_email` when the existing account is `is_verified`, or (c) gate `current_active_user` on `is_verified` for password accounts. Track explicitly in `TODOS.md` as a pre-deploy security item.

### DS-05 — `.env` is read and parsed by hand for the Tavily key
- **Severity:** LOW
- **Category:** Secret handling / maintainability
- **Location:** `adapters/tavily_tools.py:140-159` (`make_tavily_client`)
- **Evidence:** When neither `settings.tavily_api_key` nor `TAVILY_API_KEY` is set, the code opens `.env`, line-splits it, and extracts `TAVILY_API_KEY=` itself, with a `debug` log "Tavily API key loaded from .env file".
- **Why it matters:** Hand-rolling secret loading outside the single `Settings` surface (ADR 0018) is duplication and a footgun: it bypasses the masking/`_SECRET_FIELDS` discipline, it reads from CWD (`Path(".env")`) which may not be the project root in a deployed/container context, and it puts secret-adjacent logic on a hot factory path. It also violates "never reinvent the wheel" — pydantic-settings already loads `.env`.
- **Fix:** Drop the manual `.env` reader. Make `tavily_api_key` the single source (it already reads `COUNSELLE_TAVILY_API_KEY`); if the unprefixed `TAVILY_API_KEY` convention must be supported, add it as an env alias on the Settings field rather than parsing the file by hand.

### DS-06 — Rate limiter fails open with no surfaced alarm; auth limiter is IP-only
- **Severity:** LOW
- **Category:** Rate-limit robustness
- **Location:** `api/ratelimit.py:106-134` (`_NoopLimiter`, `get_limiter`), `:97-99` + `:137-141` (`check_auth`/`_client_ip`)
- **Evidence:** A missing limiter on `app.state` returns `_NOOP_LIMITER` (admit everything) with a `logger.warning`. Auth limiting is per-IP only ("email-keying would need a body read… so we don't").
- **Why it matters:** (1) Fail-open is the right call for a boot-config bug, but a single `warning` log is easy to miss — if the limiter ever isn't wired, all caps silently vanish. (2) IP-only auth limiting is bypassable by a distributed/rotating-IP brute force against a single account; with no account lockout and a 30-day token, that's the weakest brute-force control. Both are explicitly acknowledged single-replica MVP tradeoffs (process-local, §23), so LOW.
- **Fix:** (1) Promote the missing-limiter case to a health-check signal so it can't go unnoticed. (2) When moving to Redis (multi-replica), add an email-keyed counter alongside IP, and consider a per-account attempt cap.

### DS-07 — SQL guard denylist omits `INTO`/`CALL`/`COPY`/`DO`; relies on RO role
- **Severity:** LOW
- **Category:** Defense-in-depth (escape hatch)
- **Location:** `counselle_db/service.py:165-172`, `:585-611` (`_guard_sql`)
- **Evidence:** `_SQL_WRITE_KEYWORD_RE` covers `insert|update|delete|merge|truncate|drop|alter|grant|revoke`. The first-keyword gate requires `select`/`with`, which blocks `COPY`/`CALL`/`DO` at the start. But `SELECT … INTO new_table` (creates a table) is not in the write denylist.
- **Why it matters:** `SELECT INTO` and similar are caught only because `default_transaction_read_only` rejects them at the DB. The guard is advertised as defense-in-depth; this gap means the guard alone wouldn't stop a `SELECT INTO` if the RO role were ever misconfigured (the exact failure mode the per-connection `statement_timeout` re-application was added to defend against). Low because the RO role is the real and correctly-configured backstop.
- **Fix:** Add `into` to the write-keyword regex (`\binto\b` is over-rejecting for the escape hatch, which is the stated design preference). Optionally reject leading comments so the first-keyword gate can't be confused.

### DS-08 — `national_benchmark` casts every stored value to `::numeric` (BBRR token crash)
- **Severity:** LOW
- **Category:** Robustness / honesty-adjacent
- **Location:** `counselle_db/service.py:119-127` (`_BENCHMARK_SQL`), `:445-479`
- **Evidence:** The benchmark SQL runs `percentile_cont(...) WITHIN GROUP (ORDER BY (value)::numeric)` and `avg((value)::numeric)` across all rows for a numeric field. BBRR fields are `data_type` percent but store a **mix** of numeric strings and privacy-range tokens (`"<=0.05"`, `"0.05-0.09"`) per DATABASE_GUIDE R4.
- **Why it matters:** A benchmark over a BBRR-backed percent field will hit a Postgres cast error on the token rows, surfacing as a generic `ServiceError("query failed: …")`. It degrades to an error (honest), not a wrong number, so it's LOW — but it's an un-handled known data shape, and the error message echoes the raw Postgres text to the model (acceptable per the code comment, but worth confirming it never carries schema internals a student could see if mis-rendered).
- **Fix:** Exclude token rows in the benchmark predicate (e.g. `AND value::text ~ '^-?[0-9.]+$'`) or scope benchmarks to fields known to be clean numerics; document that BBRR fields are not benchmarkable.

### DS-09 — `effective_oauth_state_secret` falls back to the JWT secret (key reuse)
- **Severity:** LOW
- **Category:** Crypto hygiene
- **Location:** `config/settings.py:171-174`, used at `api/main.py:196`
- **Evidence:** `oauth_state_secret` defaults to `None` and falls back to `jwt_secret` for the OAuth CSRF state token.
- **Why it matters:** Reusing one secret for two cryptographic purposes (session JWTs and OAuth state) couples their blast radius — rotating one forces the other, and a leak of one compromises both contexts. The 32-byte minimum is only validated on `jwt_secret`; the fallback inherits it, so length is fine, but separation of concerns isn't.
- **Fix:** Document the fallback as dev-only and require a distinct `COUNSELLE_OAUTH_STATE_SECRET` in the deploy env matrix (`docs/DEPLOY.md`).

### DS-10 — `_percent` / `_currency` do not range-validate the input
- **Severity:** LOW
- **Category:** Honesty (defensive, currently covered by DB invariant)
- **Location:** `domain/normalize.py:145-163`
- **Evidence:** `_percent` blindly does `fraction * 100` with no check that `0 <= fraction <= 1`. DATABASE_GUIDE §6 guarantees percents are stored as 0–1 fractions (max 1.0), so this is correct **today**.
- **Why it matters:** The honesty guarantee here rests entirely on an upstream pipeline invariant that this repo treats as "the contract" but does not enforce. If the pipeline ever stored a percent as `45` (a real cross-source drift risk the guide itself warns about: IPEDS was `divisor:100`-converted), a student would be told "4500%". The product's own principle is to put honesty in code, not trust an external producer.
- **Fix:** Clamp/guard: if a `percent` value exceeds a sane bound (e.g. > 1.5), degrade to `available=False` with a caveat rather than emitting a nonsensical display. Cheap insurance for the highest-value invariant.

### DS-11 — Catalog refresh / search index serve stale data silently on failure (acceptable, note)
- **Severity:** LOW
- **Category:** Honesty / observability
- **Location:** `counselle_db/catalog.py:179-198` (`maybe_refresh` serves stale on failure), `api/main.py:81-95` (reconcile failures swallowed)
- **Evidence:** On refresh failure the stale catalog is served and the next retry is deferred ~10 min; reconcile failures are caught and reduced to a class name. These are deliberate availability choices.
- **Why it matters:** Serving a stale catalog is the right tradeoff (the alternative is an outage), but vintage strings derive from the catalog's `scorecard_filename`/`ipeds_cycle_year` — if a refresh that would have bumped the vintage fails silently, the student could be shown an older vintage label than reality for up to the deferral window. Very low impact given vintages change rarely; flagging for completeness because it's a (small) recency-honesty surface.
- **Fix:** None required. Ensure the `/v1/health` reconciler/catalog staleness is monitored so prolonged stale-serving is visible.

---

## Things checked and found SOLID (no action)

- **Parameterized SQL everywhere** — service.py, service_find.py (D5 safe-construction recipe verified), search_fields.py, users_db.py, sessions.py, feedback.py, me.py. The `# nosec B608` annotations are accurate (column names from fixed allowlists only).
- **Authorization** — `owned_session` ownership check; 404-not-403 (no existence leak); feedback read/write user-scoped; account/chat deletes enumerate by `user_id`.
- **Read-only role** — `default_transaction_read_only` + per-connection statement timeout; helper functions are non-`SECURITY DEFINER`; RO vs app pool cleanly separated; LLM never touches the writable pool.
- **Secret handling** — `Settings.__repr__`/`__str__` mask `_SECRET_FIELDS`; DSNs show scheme+host only; the 500 handler logs traceback server-side and returns only a trace_id; `_safe_error` (tavily) suppresses URLs/IPv4/emails/`tvly-`/`password`; reconcile error reduced to class name. (One exception: DS-05 hand-rolled `.env` read.)
- **Auth mechanics** — null-hash guard with timing parity (`authenticate`); OAuth null-hash forcing with delete-on-failure compensation; httpOnly + Secure(gated) + SameSite=Lax cookie; JWT secret length-validated (≥32B); password min-length validated.
- **Honesty degradation** — `normalize` never raises on data; `available=False`/"not available" for NULL/missing/unparseable; viz and sources both emit explicit "do not invent values" on empty/error; BBRR tokens render as ranges with `raw=None` (no arithmetic); citations are code-constructed, model only repeats `[n]` markers.
- **Input validation at boundaries** — Pydantic bounds on message text (1–4000), titles, message_id path length; UUID path params (422 not 500); Last-Event-ID parsed+clamped; cursor decode degrades to first page; `require_json` 415 posture.
- **pgvector literal** — `vector_literal` output is bound as a `$N::vector` parameter (not interpolated) and its contents come from the embedding model, not user input.
