# ADR 0021 — Auth: fastapi-users with cookie JWT + Google OAuth, same-origin

**Status:** Accepted (2026-06-12; drafted in the MVP2 architecture pass, 2026-06-11)

## Context
MVP2 adds accounts (PRD-mvp2 stories 1–5): email + password, Google sign-in, password reset — explicitly minimal (no email-verification ceremony, no 2FA, no profile wizard; PRD decision 6). ADR 0016 reserved an optional principal in the request context; ADR 0019 reserved a nullable `sessions.user_id`. The protocol streams over SSE, and `EventSource` cannot set an `Authorization` header. The SPA is served same-origin from the service (ADR 0023).

## Decision
1. **Library: `fastapi-users`** (+ `httpx-oauth` for Google), mounted under `/v1/auth/*` — registration, login/logout, forgot/reset password, password hashing, OAuth association. We do not hand-roll any auth flow.
2. **Token transport: JWT in an httpOnly, `Secure`, `SameSite=Lax` cookie.** One transport for REST and SSE alike; zero token handling in the client.
3. **CSRF posture:** `SameSite=Lax` + JSON-only state-changing endpoints (content-type enforced). No CSRF-token machinery; revisit only if the app is ever embedded cross-origin.
4. **Google OAuth** links by email: a Google sign-in matching an existing account attaches to it. Signup collects name + email only.
5. **Reset emails** go through a thin `adapters/email.py` seam — provider (`smtp | resend | console`) and credentials in Settings; templates are data assets; `console` (log the link) is the dev default.
6. **Schema:** `counselle.users` (fastapi-users base + `name`, `created_at`, `settings jsonb` for theme + default source-config preset) and `counselle.oauth_accounts`, via the existing migration chain. New sessions always stamp `user_id`; old dev rows are deleted, not migrated.
7. **The principal:** the auth dependency fills the existing request-context principal (`api/context.py` already parses it, unvalidated — the seam is waiting) — no route-shape or orchestration changes (exactly as ADR 0016 promised). **Ownership is one FastAPI dependency** — `owned_session(session_id, principal)` — taken by every `/v1/sessions/*` route: it resolves principal → row → ownership and uniformly returns **404** for foreign/unknown sessions (never leak existence). One home for the authz rule, one test suite, plus a route-inventory test so no route can omit it. Data controls: `DELETE /v1/me/chats`, `DELETE /v1/me`.

**Amended at B0 (2026-06-12)** — spike 3 outcomes (25/25 checks passed; pinned fastapi-users 15.0.5, httpx-oauth 0.17.0, pwdlib 0.3.0, pyjwt 2.13.0):

8. **JWT TTL locked: 30 days, no refresh.** Logout stays cookie deletion. The JWT secret must be ≥ 32 bytes (pyjwt 2.13 warns below).
9. **The user store is a custom asyncpg `BaseUserDatabase` adapter** — viable as designed: 8 async methods (`get`, `get_by_email`, `get_by_oauth_account`, `create`, `update`, `delete`, `add_oauth_account`, `update_oauth_account`); plain Python classes satisfy `UserProtocol` — no SQLAlchemy, no pydantic required. Default password hasher: **argon2id** (pwdlib; bcrypt fallback with auto-upgrade on login).
10. **Login is form-encoded** — fastapi-users' login route takes a form body, so `/v1/auth/login` is the one named exemption to decision 3's JSON-only rule.
11. **The OAuth callback → set-cookie → 302-to-SPA flow is a redirect `CookieTransport` subclass** (override `get_login_response` to return the redirect through the cookie-setting path), mounted as a **second `AuthenticationBackend`** over the same `JWTStrategy`. The flow carries fastapi-users' **mandatory OAuth CSRF cookie** (`/authorize` sets it, `/callback` requires it — don't strip it at the proxy).
12. **OAuth-only users' `hashed_password` is explicitly forced NULL** — stock `oauth_callback` *generates* a password hash for new OAuth users, so the `UserManager.oauth_callback` override nulls it; the null-hash login guard (dummy-hash timing parity → 400) covers authentication either way.

## Rationale
- **The cookie choice is forced by SSE + made free by same-origin:** `EventSource` can't send headers; cookies ride along on every same-origin request, including streams. Bearer tokens would force a fetch-streaming-only client *and* client-side token storage for no benefit.
- fastapi-users is the battle-tested wheel for exactly this feature list (house principle 2); the surface we use is small and replaceable at the router layer.
- Thin user settings in `jsonb` (three fields) is KISS; a settings table for theme + a preset would be ceremony.

## Alternatives considered
- **Managed auth (Clerk / Auth0 / Supabase Auth)** — rejected for MVP2: an external dependency, cost, and an egress of student PII for flows fastapi-users covers entirely; also weakens the self-contained one-container deploy. Reconsider if SSO/2FA/orgs ever matter.
- **Hand-rolled JWT auth** — rejected: reinventing a security-critical wheel, explicitly against house rules.
- **Server-side sessions (cookie + DB session table)** — viable, but fastapi-users' JWT strategy is its paved road; stateless tokens also keep the restart story trivial. Revisit if token revocation ever becomes a real requirement (logout is cookie deletion; the short TTL bounds the rest).
- **Bearer tokens in localStorage** — rejected: XSS-exposed storage, SSE header problem, more client code.

## Consequences
- The moment `user_id` stops being nullable in practice: rate limits, history, and settings attach to a person (PRD story 5).
- A JWT can't be revoked before expiry — bounded by the TTL (Settings knob); acceptable for MVP2's threat model. *Amended at B0 (2026-06-12): the TTL is locked at 30 days with no refresh — revocation-before-expiry stays out of scope.*
- Email delivery becomes a (thin) operational dependency for password reset; `console` keeps dev friction at zero.
- Account deletion must cascade sessions + checkpoints + feedback — covered by FKs and the delete-all path, tested in §34.
