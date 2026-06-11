# ADR 0021 — Auth: fastapi-users with cookie JWT + Google OAuth, same-origin

**Status:** Draft (MVP2 architecture pass, 2026-06-11 — moves to `docs/adr/` as Accepted when the build starts)

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
- A JWT can't be revoked before expiry — bounded by a short TTL (Settings knob); acceptable for MVP2's threat model.
- Email delivery becomes a (thin) operational dependency for password reset; `console` keeps dev friction at zero.
- Account deletion must cascade sessions + checkpoints + feedback — covered by FKs and the delete-all path, tested in §34.
