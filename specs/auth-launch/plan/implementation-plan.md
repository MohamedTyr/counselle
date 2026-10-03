# Acceptra launch authentication

Status: implementation approved for merge by the owner on 2026-10-03, after independent review, fixes, and final regression checks. Google login, delivered verification/reset, emailed identity confirmation, logout everywhere and temporary-account deletion were exercised locally. The final review results are recorded below. Production deployment and full production acceptance remain pending. This plan graduated from `plans/` on owner acceptance of the implementation.

## Outcome and scope

Students can create and recover an email/password account, sign in with Google, verify their email, connect Google deliberately, add/change their password, change their email after verification, sign out on one/all devices, and delete their account. Existing workspace ownership is preserved. Auth screens and emails use **Acceptra**; internal package/schema names stay unchanged.

Production origin: `https://acceptra.ai`. Sender: `Acceptra <accounts@mail.acceptra.ai>`. Reply-To/support: `support@acceptra.ai`.

The domain currently serves a Cloudflare Pages landing page, **not the application API**. Configuring Google and Resend does not deploy the app. Production API/SPA routing is a separate launch dependency. Local provider tests can precede deployment. Never run the school-data D9 deployment/destruction scripts as part of auth setup.

## Baseline and decisions

Existing implementation: `api/auth.py`, `api/users_db.py`, `api/auth_security.py`, `api/routes/me.py`, `adapters/email.py`, React auth routes and `/v1/me`. FastAPI Users provides password hashing, user management, reset/verification token primitives and OAuth machinery. Extend these seams. Consult current official library docs and installed source before implementation.

ADR 0045 and `docs/ARCHITECTURE.md` §28 record the successor to ADR 0021: replace stateless JWT login sessions with revocable DB sessions; replace automatic email-based Google linking with explicit association; add verified-email enforcement. Keep same-origin secure HttpOnly cookies and existing ownership dependencies. All auth tables use the application pool and `counselle` schema; neither facts-store DSN changes.

### Sessions and recent authentication

Use the library database strategy with a small asyncpg adapter. Store only a SHA-256 digest of a cryptographically random opaque token, user ID, expiry, creation time and authentication time. Tokens never appear in JSON, logs, URLs or frontend storage. Migration `0022_auth_launch` creates `counselle.auth_sessions` with user cascade and expiry/user indexes. Existing JWTs become invalid at cutover; users sign in again. Preserve the current 30-day session lifetime setting.

A sensitive action requires authentication within ten minutes (`auth_recent_seconds`, default 600): password change/addition, staged email change, Google association, and account deletion. A successful password login counts as fresh; Google login is recent only when a validated provider `auth_time` proves it. Password reauthentication updates the authenticated session timestamp. Google reauthentication must prove the **already linked Google subject** and bind its state to the initiating live session; an arbitrary Google identity cannot reauthenticate this user. Google freshness uses its validated `auth_time`; an account chooser is insufficient. If Google omits that claim or it is too old, send a one-use confirmation link to the verified account email. Bind that link to the current email and initiating live session; it must open in that same browser session. This is confirmation for a signed-in user, not general magic-link login. A Google-only user can add a password after verification and this recent-auth flow.

Logout deletes the current session. Logout-all, password reset, password change/addition and confirmed email change revoke all sessions and clear the caller cookie, requiring login again. Reset and credential changes must commit token consumption, credential update and revocation atomically. No ordinary recovery flow creates a password for a Google-only user; send Google sign-in guidance under the same public acknowledgement instead.

Migration `0023_auth_credential_revision` adds an internal user revision. Password replacement and confirmed email changes advance it; reset tokens and in-flight session issuance compare it. This prevents an old reset link or stale login from becoming valid again after email A → B → A.

### Verification, tokens and delivery

Registration triggers verification. Unverified users can log in, read their own account, correct their email, request verification, and manage/delete their account. AI execution is gated by a verified-user dependency on **every** start/continuation path; a frontend gate complements it. Google signup is automatically verified only from validated Google claims establishing authoritative mailbox ownership (Gmail, or verified Google Workspace with `hd`); third-party Google addresses use Acceptra verification even if Google returns `email_verified=true`. Do not automatically verify existing password users by matching email.

Reuse library token generation/validation where it meets requirements, adding narrowly scoped persistence/atomic consumption for single use if necessary. Verification, password reset and pending-email tokens bind to the relevant account state, purpose and expiration. Repeated or concurrent consumption cannot change state twice. An email change leaves the existing address valid until confirmation; only the newest pending address can be confirmed, and uniqueness is rechecked in the transaction. Confirmation invalidates outstanding old-address recovery/verification tokens. Do not grandfather all existing users as verified.

Resend implements the existing email adapter; console remains development-only. Provider API keys are Settings secrets, never printed. Public links use a configured trusted frontend URL, never a request Host header. Templates cover verification, reset, Google recovery guidance, new-address confirmation, and password/email change notices (old address gets the email-change notice). Resend failures produce structured secret-free operational logs and an actionable resend path. Public forgot/resend responses stay generic even for unknown addresses; per-IP and per-account limits also cover provider sends. Avoid returning provider failures only for existing accounts, which would reveal membership.

## Shared frontend/backend contract

Paths below are under `/v1`. Reuse existing FastAPI Users response conventions for existing routes. JSON mutation requests receive origin protection and rate limiting. Login remains the named form-encoded exception. Success with no body is 204 unless stated otherwise. New auth errors use `{ "detail": "CODE" }`; frontend parses them for 400, 403 and 409 responses.

The shared HTTP transport includes the displayed account ID in `X-Expected-User-Id` on private reads and writes, preserving explicitly captured IDs. `GET /me` identity discovery and public auth/config requests omit the implicit header. Central `current_active_user` and `current_superuser` dependencies reject a different cookie owner with `409 ACCOUNT_CHANGED` before route work. Older API clients may omit the header; existing resource ownership checks still apply. Workspace EventSource uses `expected_user_id` in its URL, retaining the initiating owner on reconnect.

| Method/path | Input | Result |
|---|---|---|
| GET `/config/public` | none, public | Existing response plus `auth: {google_enabled, signup_enabled, password_reset_enabled, password_min_length, support_email}` |
| POST `/auth/register` | `{email,password,name}` | Existing 201 user result; sends verification. Frontend logs in and opens verification screen. |
| POST `/auth/login` | form `username,password` | 204 + session cookie; unverified login allowed |
| POST `/auth/logout` | none | 204; revoke current session |
| POST `/auth/logout-all` | none, authenticated | 204; revoke all and clear cookie |
| POST `/auth/forgot-password` | `{email}` | 202 generic acknowledgement |
| POST `/auth/reset-password` | `{token,password}` | 200 library convention; revoke sessions; return to login |
| POST `/auth/request-verify-token` | `{email}` | 202 generic acknowledgement |
| POST `/auth/verify` | `{token}` | 200 user result; works without an existing browser session |
| POST `/auth/reauthenticate` | `{password}`, authenticated | 204; mark current session fresh |
| POST `/auth/reauthenticate/email` | none, authenticated + verified | 202; send a one-use link bound to this session |
| POST `/auth/reauthenticate/email/confirm` | `{token}`, same authenticated session | 204; consume link and mark session fresh |
| POST `/auth/password` | `{password}`, fresh authentication | 204; add/change password and revoke sessions |
| POST `/auth/email/change` | `{email}`, fresh authentication | 202; stage address and send confirmation; refresh `/me` |
| POST `/auth/email/confirm` | `{token}` | 204; change address and revoke sessions; works across devices |
| GET `/auth/google/authorize` | optional `next` | `{authorization_url}` |
| GET `/auth/google/associate/authorize` | optional `next`, verified account + fresh auth | `{authorization_url}` |
| GET `/auth/google/reauth/authorize` | optional `next`, authenticated | `{authorization_url}` |
| GET `/auth/google/callback` | provider parameters | set session cookie and redirect |
| GET `/auth/google/associate/callback` | provider parameters | explicit association then redirect |
| GET `/auth/google/reauth/callback` | provider parameters | refresh initiating session's authentication time then redirect |
| GET `/me` | authenticated | Existing shape plus `is_verified:boolean`, `pending_email:string|null`, `reauthentication_required:boolean` |
| PATCH `/me` | existing name/settings payload | Existing behavior; cannot change credentials |
| DELETE `/me` | fresh authentication | Existing cleanup, session revocation, cookie deletion; 204 |

Stable new errors: `REAUTHENTICATION_REQUIRED`, `EMAIL_NOT_VERIFIED`, `GOOGLE_ACCOUNT_ALREADY_LINKED`, `EMAIL_ALREADY_EXISTS`, `INVALID_OR_EXPIRED_TOKEN`, `ACCOUNT_CHANGED`. Preserve library login/register/reset/verify password-validation codes where already present. Account-specific errors belong only in authenticated flows; public recovery stays generic.

All three Google callback paths are registered at `https://acceptra.ai`, `http://localhost:5173` and `http://localhost:8000`. The implementation currently derives callback URLs through `request.url_for`, so production trusted-host/proxy configuration must be verified; email and completion destinations use the configured `auth_public_url`. All three flows retain OAuth state/CSRF-cookie validation. Restrict `next` to relative application paths, rejecting protocol-relative and encoded external destinations; bind it in signed/validated state. Completion redirects to `/auth/callback?next=<local-path>` with optional `error=<stable-code>`; the frontend routes success to the intended page and renders failure/recovery guidance. Preserve the attempted internal destination through cancellation/retry.

Google identity must use OIDC `sub`, not the current httpx-oauth People API `resourceName`. Verify relevant Google claims and provider response rules; if existing stored account IDs use the old format, inspect and migrate deliberately before changing identity matching. Never join accounts solely by matching email. New Google accounts keep `hashed_password=NULL` and advertise `has_password=false`.

Association requires the existing local account to be verified at authorization, callback and inside the locked transaction. An attacker who registered someone else's email cannot attach a persistent Google identity before proving mailbox ownership.

Browser owner changes discard private query data and remount protected route state. Only public catalog/config queries survive. Private mutations capture owner and cache generation; clearing private data advances that generation, preventing late results or optimistic rollbacks from restoring another account's data, including across A → B → A transitions.
Queued workspace updates, essay autosave/keepalive callbacks and SAT callbacks enforce the same account boundary.

## Open streams and detached turns

A revoked session must stop receiving data without waiting for a new HTTP request. Add one shared stream guard using the request's authenticated session digest, wrapping both chat SSE generators (send and reattach) and workspace SSE. Recheck DB validity on connection and every five seconds during both active forwarding and idle waits; handle generator cancellation/cleanup and fail closed on session-check errors. Avoid holding a database connection while waiting for an event. Reconnect is denied normally by auth. Frontend performs an account refresh after stream authorization loss and presents sign-in while retaining unsent input in its existing draft mechanism.

Logout disconnects the revoked browser stream; ordinary logout does not cancel a student's detached turn. Account deletion still cancels owned runs before deleting their storage. Preserve this distinction explicitly. A browser cannot acquire new events after the guard has observed revocation.

## Implementation ownership and sequence

1. **Session core worker:** `api/auth_sessions.py`, the auth migration and session regression tests. Implement hashed storage, strategy, revocation and recent-auth timestamp primitives. Own migration edits and accept schema requirements from lifecycle.
2. **Auth lifecycle worker:** `api/auth.py`, `api/main.py`, `config/settings.py`, `api/routes/auth_account.py`, `api/routes/me.py`, `api/routes/config.py`, `api/users_db.py` and lifecycle regression tests. Implement reset/verification hooks, staged email, password, recent-auth dependencies and deletion. Integrate Google mount helper. Own the final auth-route inventory.
3. **Google worker:** `api/auth_google.py` and focused Google tests only; export `install_google_auth(app, settings)` for lifecycle to mount. Consume shared session and active-user helpers. Implement login, explicit association, reauthentication and provider identity validation.
4. **Email worker:** `adapters/email.py`, email templates and email tests only. Keep `build_email_sender(settings)`. Shared signature: `send(*, to, subject, purpose, token="", link=None)`, with required purpose `verify_email|reset_password|google_signin_help|email_change|password_changed|email_changed|reauthenticate`. Token is console-only; actionable Resend messages require a complete trusted link. Lifecycle owns Settings additions: `email_provider: console|resend`, `email_from`, `email_reply_to`, `resend_api_key: SecretStr|None`, `email_timeout_seconds` (positive, default 10).
5. **Frontend worker:** active `frontend/` only; auth API/hooks, route registration, auth pages, settings security section, frontend regression tests. Read `DESIGN.md` and the local shadcn skill. Use established controls and layout. Mobile, keyboard and password-manager support; sensible loading, resend and error states. Brand auth surfaces Acceptra.
6. **Integration owner:** stream guard integration, public config, AI verification-route coverage, architecture/ADR/deploy documentation, final API-contract reconciliation, full relevant checks and live browser runs. Coordinate exact file ownership before parallel edits.
7. **External setup owner:** Google consent/web client, Resend domain/key and DNS verification, local provider configuration and real inbox tests. User enters credentials directly. Do not log secrets or alter existing mail MX records. Do not purchase a paid service without approval.

Current session helpers in `api/auth_sessions.py`: `get_session_strategy(request)`, `get_oauth_session_strategy(request, authenticated_at)`, `get_request_session(request, user=None)`, `require_recent_auth(request, user=None)`, `mark_session_recent(request, user=None, authenticated_at=...)`, `revoke_user_sessions(pool_or_conn, user_id)` and `stream_with_session(request, events)`. The database digest is `token_hash` and identifies the session; there is no separate session UUID. `api/auth_account_security.py::lock_account_session` rechecks credentials and recent session under transaction locks.

The contract above is the coordination baseline. Workers must communicate changes before diverging; avoid duplicate credential APIs or additional wrappers around existing helpers.

## Route bypass inventory and validation

Inspect the **mounted** route graph, not only source files:

- Remove stock `/auth/me` credential mutation and deletion surfaces (confirm exact mounted paths) (and administrative user mutations if unused); they must not bypass recent authentication, staged email, cleanup, or revoke hooks. Preserve necessary user reads only if actually consumed.
- Protect all auth mutation routes with origin checks and rate limits, including account routes outside `/auth`, logout-all and deletion. OAuth callback GETs use their own state protection; protect authenticated association/reauth initiation as well.
- Inventory AI starts: normal messages, goal mode, retry/regenerate/clarify continuations, steer, essay chat/session creation as applicable, and any SAT/other model-triggering endpoint. Route all actual execution paths through verification; do not mistake a frontend redirect for enforcement.
- Preserve existing ownership checks on chat/workspace/admin paths. Explicitly check unauthenticated, inactive, unverified, foreign-user and revoked-session access.
- Account deletion must remove users, OAuth/session rows, workspace data, checkpoints and uploaded documents; use the existing purge path and verify every user-owned store. Leave facts-store data untouched.

No TDD or coverage target: project-specific instructions require tests that earn their place. Security/data-integrity regressions do: session hashing/revocation/expiry; concurrent reset/email-token consumption; Google-only null-password recovery; linking collision and identity substitution; CSRF; generic-route bypass; all AI verification paths; deletion cleanup; and idle/active SSE revocation. Run appropriate backend lint/type/tests, frontend type/lint/tests/build, then code/security review. Fix high/critical findings.

Live acceptance: email signup → delivered verification → AI use; reset with expired/reused link; Google signup and returning login; explicit same-email linking; Google-only reauth → add password; email change opened on another device; single/all-device logout including an open SSE; account deletion and attempted reuse. Exercise desktop/mobile and keyboard paths. Send an external test message to the support group. Record artifacts under `artifacts/` and report provider/deployment or browser-engine gaps honestly. Production acceptance additionally requires the real SPA/API behind `acceptra.ai` with HTTPS secure-cookie/proxy behavior verified.

## Provider details confirmed during implementation planning

Google’s [ID-token verification guidance](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token) distinguishes authoritative Gmail/Workspace email claims from third-party addresses that can change owners. Its [current OIDC reference](https://developers.google.com/identity/openid-connect/reference) supports requesting `auth_time`, but lists only `none`, `consent`, and `select_account` prompts. A new token or account selection alone does not establish fresh password entry. The implementation must describe its Google reconfirmation guarantee accurately and avoid assuming unsupported forced-password parameters.

## Operational evidence and remaining verification

Verified 2026-10-02:

- Google project `acceptra-auth`, web client **Acceptra web**: External audience,
  **In production**, with homepage/privacy/terms saved and all nine production/
  localhost callback URLs registered.
- Resend `mail.acceptra.ai` verified; a sending-only domain-scoped key is stored
  in ignored local `.env` with mode `600`. Support uses the
  `support@acceptra.ai` Google Group. Exact DNS records are in `docs/DEPLOY.md`;
  root MX records were untouched.
- Real delivered verification/reset messages and explicit link-confirmation
  flows were exercised locally. Real Google login returned
  `google_connected=true`, `is_verified=true`, `has_password=false`.
- `0022_auth_launch` and `0023_auth_credential_revision` were applied to the local
  app database on port `5434`; no production migration was applied.
- Full frontend suite: 167 files passed, 1,694 tests passed, one skipped.
  Backend suite: 3,606 passed, 310 live cases deselected. Additional native-route
  and disposable-database session suites passed five scenarios each. The Render
  configuration helper passed 22 tests without making real remote API calls.
- Browser checks also covered the delivered mailbox confirmation, new-password
  login, logout everywhere (subsequent `/me` returned 401), and deletion of the
  temporary account. Its row and temporary credentials were removed. Resend
  recorded delivery of the support-group test; member-inbox forwarding was not
  independently inspected. Full local evidence is in
  `artifacts/auth-launch/live-verification.md`.
- Google cannot force fresh account authentication; the normal sensitive-action
  UI uses password or email confirmation. Its optional authentication-time claim
  remains strictly checked by the backend Google reauthentication route.
- Mailbox send protection is implemented: five messages per 15 minutes, in
  addition to per-IP auth limits; both are process-local. Uvicorn filters auth
  query values, while upstream proxy/CDN logging needs equivalent configuration.

`acceptra.ai` remains a static landing deployment with no app API. Production
migration, HTTPS/proxy behavior and the full account journey matrix still need
acceptance. Local evidence above does not claim same-email Google association,
all-device stream revocation, or deletion was exercised through production.
ADR 0045 remains Proposed pending production acceptance; the owner has approved the implementation for merge.

### Independent review follow-up

Review fixes cover verified-account Google association, reset-token revival
after email cycles, stale-tab private reads/writes and EventSource connections, private query and mutation
isolation, and mobile/recovery feedback. Settings/deployment review also tightened
secret-safe startup errors and required deployment configuration. Native logout
and personalized configuration also carry the displayed-account binding.

Final local validation (2026-10-03):

- Routine backend suite: **3,745 passed**, 312 live cases deselected. The later
  native logout guard passed **75 related tests**, including six new regressions.
- Frontend: **1,738 passed**, one skipped, across all 170 test files. The final
  production build passed. A cold development-route test now waits explicitly
  for its lazy import; its original assertions remain intact.
- Generated-account live suite: **6 passed**. Disposable-database session/race
  suite: **6 passed**. Mail was captured and the disposable database removed.
- Chromium: **10 scenarios passed** with mocked APIs, including native stale-tab
  profile reads, saves and logout. Backend enforcement was checked separately.
- Fresh independent review closed all confirmed findings; its isolated checks
  passed **148 backend and 56 frontend tests**. Deployment/settings review also
  passed 96 tests without remote writes.

The earlier counts above remain the pre-review baseline. Full review evidence,
test logs and browser artifacts are in `artifacts/auth-review/REVIEW.md`. No
deployment, commit or push was performed during the review; the owner subsequently
authorized merging and pushing the implementation. Production acceptance is still open;
the local checks do not establish that every browser or provider journey is
bug-free.
