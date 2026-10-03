# ADR 0045 — Revocable sessions and complete account lifecycle

**Status:** Proposed — implementation in the working tree, with local Google
login and delivered verification/reset journeys exercised. Independent reviews
and local regression checks passed after the review fixes. The owner approved
the implementation for merge on 2026-10-03. Remaining production acceptance
journeys and deployment are pending.

Supersedes ADR 0021's JWT login sessions, cookie-only logout, automatic Google
association by email, and omission of email verification. Retains FastAPI Users,
asyncpg, same-origin cookies, existing user IDs and ownership checks.

## Context

Launch needs usable password recovery, email verification, account settings and
sign-out across devices. A 30-day JWT remains usable after logout or recovery,
and associating Google by email can attach a provider to an account whose owner
has never proved control of that address. Existing generic credential mutations
also bypass staged email changes and recent authentication.

The public product is Acceptra (`https://acceptra.ai`). Internal Counselle package,
schema and environment-variable names remain unchanged.

## Decision

1. **Opaque, revocable sessions.** FastAPI Users' `DatabaseStrategy` uses an
   asyncpg adapter over `counselle.auth_sessions`. The browser holds a random
   token in the existing HttpOnly, Secure-in-production, SameSite=Lax cookie;
   Postgres stores only its SHA-256 digest. Expiry and authentication time are
   separate columns. The existing `jwt_lifetime_seconds` setting retains the
   30-day session lifetime; `jwt_secret` now signs recovery/verification tokens,
   not login cookies. Deploying this change invalidates old JWT cookies.
2. **Revocation reaches streams.** Logout deletes one session. Logout-all,
   password replacement and confirmed email change revoke all user sessions.
   Credential replacement and revocation share a transaction. Chat and workspace
   SSE periodically recheck the session, including while idle, with a five-second
   polling interval. Loss of access closes the subscription; ordinary logout
   does not cancel detached work. Account deletion retains the existing explicit
   turn cancellation and checkpoint cleanup path.
3. **Recent authentication for sensitive changes.** Password/email changes,
   Google linking and account deletion require a recent proof, currently ten
   minutes (`auth_recent_seconds`). Password confirmation verifies the existing
   hash. Google confirmation requires the linked subject and a validated recent
   `auth_time`; account selection or token issuance does not substitute for it.
   If Google cannot provide this proof, a one-use link to the account's verified
   email confirms control. That link is bound to the initiating login session
   and current email, so it must be opened in the same browser session. It does
   not create a new login or work as a general magic link.
4. **Verification before AI use.** Unverified students can sign in and use
   verification/account controls; the frontend and model-execution endpoints
   require verified email. Registration sends verification. Existing unverified
   accounts are not silently grandfathered. Reset links bind to both current
   email, password fingerprint and persistent credential revision; a conditional database update makes concurrent
   reuse fail and revokes sessions atomically. Google-only accounts receive
   sign-in guidance from recovery and can add a password deliberately after
   verification and recent authentication. Password replacement and confirmed
   email changes advance the revision, so changing email A → B → A cannot revive
   a reset link. Session issuance also checks the observed revision.
5. **Explicit Google association.** Login resolves Google's stable `sub`.
   Existing `people/<sub>` records are recognized by provider identity, never by
   matching email. A same-email collision requires signing in to the existing
   account, verifying its email and explicitly connecting Google after recent
   authentication. Verification is checked at authorization, callback and under
   the account transaction lock. Separate login, association and
   reauthentication callbacks bind state to purpose, nonce and a CSRF cookie;
   association/reauthentication also bind to the initiating session and user.
   The Google library verifies signature, issuer, audience and expiry; the app
   checks nonce, subject and email claims. Provider access/refresh tokens are
   not retained because this app needs identity only.
6. **Google email trust is explicit.** Google-hosted verified email can establish
   verification for new accounts. Third-party Google addresses still require
   Acceptra verification: Google's `email_verified` can outlive third-party
   mailbox ownership. Linking never transfers a workspace or automatically
   merges two accounts.
7. **Staged email changes.** Keep the current address until a one-use challenge
   for the new address is consumed. Only the latest pending challenge is valid;
   its digest and target address live in `counselle.auth_action_tokens`. Database
   uniqueness handles races. Confirmation verifies the new address, revokes
   sessions, and sends notifications to both addresses. Generic FastAPI Users
   user-update/delete routes are unmounted; `/v1/me` keeps profile/settings reads
   and writes, while dedicated auth routes own credentials.
8. **Transactional email.** The existing adapter gains Resend with versioned
   HTML/text templates. Sender: `Acceptra <accounts@mail.acceptra.ai>`; Reply-To:
   `support@acceptra.ai`. Action links use the configured `auth_public_url`, not
   a request Host header. Console delivery remains for development. Provider
   errors log the message purpose and error category without credentials; the
   public recovery response stays generic and a committed account mutation is
   not reported as rolled back because its notification failed.
9. **One public capability contract.** `/v1/config/public` exposes `auth` flags
   for Google, signup, reset, password minimum and support address. `/v1/me` adds
   verification, pending email and recent-auth state. OAuth uses a validated
   local `next` path and returns to `/auth/callback`. Browser mutation routes
   retain origin checks and existing per-IP limits. Account email delivery also
   limits each mailbox to five messages per 15 minutes; both limits are
   process-local.
10. **Bind browser actions and caches to their account.** The shared HTTP
    transport sends the displayed account ID in `X-Expected-User-Id` on private
    reads and writes, preserving explicitly captured IDs. Identity discovery
    (`GET /me`) and public auth/config requests omit the implicit header.
    Central active-user and superuser dependencies reject a different cookie
    owner with `409 ACCOUNT_CHANGED` before route work. Older API clients may
    omit the header. Workspace EventSource uses an `expected_user_id` URL query
    bound to the initiating owner, including reconnects. These checks complement
    existing resource ownership checks. Owner changes discard private queries and
    remount protected route state; public catalog/config queries are preserved.
    Private mutations capture the initiating owner and cache generation, so
    late results, rollbacks and callbacks cannot restore the previous owner's
    data. Clearing private caches advances that generation even if the browser
    later returns to the same account. Queued workspace updates, essay
    autosave/keepalive callbacks and SAT callbacks enforce the same boundary.

## Rationale and alternatives

The installed library already handles transport, session strategy, password
hashing and signed-token primitives. Small transactional extensions close the
specific concurrency and lifecycle gaps. A hosted auth migration would add a
second user store and require migrating ownership without solving an unmet
launch need. Keeping stateless JWTs would prevent the accepted logout/recovery
behavior. Treating Google's account chooser as fresh authentication would claim
a guarantee its documented parameters do not provide.

## Consequences and verification

Migration `0022_auth_launch` adds application-schema auth tables;
`0023_auth_credential_revision` adds the internal user credential revision. Both
are applied locally; production migration remains pending. The facts-store
contract is untouched. Session validation now reads Postgres. Rotating
`COUNSELLE_JWT_SECRET` invalidates outstanding signed action tokens but does not
revoke opaque sessions; session revocation is a database operation.

Regression checks cover token storage/expiry/revocation, concurrent credential
changes, Google state and identity substitution, null-password recovery,
verification gates and stream closure. Local checks also exercised real Google
login and delivered verification/reset messages. They do not establish every account journey or production acceptance.
The current `acceptra.ai` Cloudflare Pages deployment serves the public landing
site, not the app API; application deployment remains separate work. See
`docs/DEPLOY.md` for launch setup and
`specs/auth-launch/plan/implementation-plan.md` for the implementation/acceptance record.

## References

- [FastAPI Users database strategy](https://fastapi-users.github.io/fastapi-users/latest/configuration/authentication/strategies/database/)
- [Google identity verification and email authority](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)
- [Google OIDC claims and request parameters](https://developers.google.com/identity/openid-connect/reference)
