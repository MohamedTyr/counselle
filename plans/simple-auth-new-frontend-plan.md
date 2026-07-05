# Simple Auth for the New Frontend

## Goal

Add the smallest useful authentication layer to the new MVP3 frontend:

- students can register, log in, stay logged in via the backend cookie, and log out;
- authenticated workspace routes are inaccessible while logged out;
- auth UI is intentionally plain for now, but uses the current shadcn/COSS-style component system;
- the frontend preserves the backend's existing auth contract instead of inventing token handling.

This is a planning document only. It lives in `plans/` until implemented and verified.

## Review Status

This plan was reviewed by independent plan, architecture, security, and TypeScript/frontend reviewers.

Integrated changes from review:

- workspace routes move under `/app/*` so public `/` is not cemented as the authenticated shell;
- `/v1/me` state uses TanStack Query, matching the old frontend's backend-client seam;
- Google OAuth is removed from the simple rollout because backend `associate_by_email=True` is documented as a pre-deploy account-takeover caveat;
- backend auth POST hardening and register abuse protection are explicit prerequisites before shipping;
- COSS form primitives are not assumed installable from the current registry config;
- auth-aware test harness work is first-class, not an afterthought;
- redirect and password-handling rules are explicit.

## Ground Truth From Exploration

### Backend Contract

The backend auth is already implemented:

- `api/auth.py`
  - `POST /v1/auth/register` creates a user. It does not set a session cookie.
  - `POST /v1/auth/login` accepts form-encoded `username` and `password`, sets the auth cookie on success.
  - `POST /v1/auth/logout` clears the auth cookie.
  - `POST /v1/auth/forgot-password` and `POST /v1/auth/reset-password` exist, but are out of scope for the first simple pass.
  - Google OAuth endpoints exist when env vars are configured, but are out of scope for this pass.
- `api/routes/me.py`
  - `GET /v1/me` returns the signed-in user profile.
  - `PATCH /v1/me`, `DELETE /v1/me`, and `DELETE /v1/me/chats` exist, but profile/settings UI is out of scope for this pass.
- `api/routes/config.py`
  - `GET /v1/config` is authed.
- `config/settings.py`
  - auth cookie name defaults to `counselle_auth`;
  - JWT cookie is httpOnly, SameSite=Lax, Secure-gated by settings;
  - password minimum length defaults to `password_min_length = 8`;
  - OAuth redirect target defaults to `/`.

### Old Frontend Backup

The old FE backup at `frontend.backup-20260705-070513` handled auth with these useful decisions:

- `src/api/http/auth.ts`
  - all auth requests use `credentials: "same-origin"`;
  - `fetchMe()` returns `null` on `401`, not an exception;
  - login uses form-encoded `username` and `password`;
  - register sends JSON and then the UI follows by logging in;
  - `AuthError` preserves backend auth error codes for friendly messages;
  - auth request timeouts apply only to short auth/me calls, never to SSE.
- `src/app/auth.ts`
  - old app used TanStack Query for `/v1/me`;
  - the query cache was the source of truth, not a copied token store;
  - logout removed session-scoped cache immediately.
- `Startup.tsx`
  - authenticated users are redirected away from login/register;
  - server/network errors are treated differently from logged-out state.

### New Frontend State

Current new frontend:

- is Vite + React Router 8 + React 19 + Tailwind v4;
- has `AppProviders` with theme and tooltip only;
- has workspace routes currently mounted at `/`, but no auth gate;
- has shadcn/COSS-style Base UI primitives installed for `Button`, `Input`, `Card`, `DropdownMenu`, `Separator`, `Spinner`, etc.;
- does not currently have TanStack Query or React Hook Form;
- does not currently have `Form`, `Field`, `Alert`, or `InputGroup` primitives installed;
- has `components.json` style `radix-nova`, Base UI primitives, and `lucide` as the icon library;
- does not currently configure an `@coss` registry in `components.json`.

## Backend Prerequisites Before Shipping

The frontend can be built locally, but this feature should not ship to real users until these backend/security items are addressed.

1. **Auth POST CSRF hardening**
   - Current login is form-encoded because fastapi-users expects it.
   - SameSite=Lax is not enough for login CSRF: a cross-site form POST could log a student into an attacker-controlled account.
   - Add backend `Origin` / `Referer` enforcement for auth state-changing POSTs, or add an equivalent CSRF control.
   - Tests must prove cross-origin auth POSTs are rejected.

2. **Register abuse protection**
   - Register is currently not rate-limited in the same way login/reset are.
   - Add rate limiting to register, or temporarily gate registration behind a dev/invite flag.
   - Decide whether to keep precise `REGISTER_USER_ALREADY_EXISTS` copy. If keeping it, pair it with throttling and accept the enumeration tradeoff explicitly.

3. **Google OAuth remains blocked**
   - Do not add a Google button in this simple pass.
   - Backend currently uses `associate_by_email=True`, with a documented account-takeover caveat.
   - Google can be added after one backend fix exists:
     - verified-email-only association;
     - mandatory email verification before password login;
     - or disabling associate-by-email.

## Product and Security Posture

The frontend must not read or store auth tokens. The httpOnly cookie is the session.

Auth checks must be honest:

- `GET /v1/me` 401 means logged out.
- network/5xx errors mean the server could not be reached or failed. Show a retry state, not a login redirect.
- login/register errors render inline on the form.

Password handling rules:

- never log passwords;
- never put passwords in route state;
- never persist passwords in localStorage/sessionStorage;
- never trim, lowercase, or normalize passwords;
- clear password fields after successful submit/navigation;
- use password-manager-friendly autocomplete:
  - email: `autoComplete="email"`;
  - login password: `autoComplete="current-password"`;
  - registration password and confirm password: `autoComplete="new-password"`.

Redirect rules:

- preserve only internal relative destinations generated from React Router `location`;
- never honor arbitrary `next`, `redirect`, or `return_to` query params;
- store full attempted location (`pathname`, `search`, `hash`), not just pathname;
- reject any post-auth destination that is not an internal app path.

The first pass should stay boring:

- no clever auth UI;
- no client-side password strength meter;
- no profile/settings implementation;
- no password reset UI;
- no Google OAuth UI.

## Proposed Architecture

### Dependencies

Add TanStack Query:

```bash
cd frontend
npm install @tanstack/react-query
```

Do not add React Hook Form for this pass.

### Component Discovery

Before building auth forms:

1. Search shadcn registries from `frontend/` for form/field/alert primitives.
2. If a COSS-compatible `field` / `form` primitive is actually available through the configured registry setup, install and read the generated files before use.
3. If not available, do not block the feature. Use existing `Card`, `Input`, `Button`, `Separator`, `Spinner` and add a tiny local `AuthField` wrapper inside `features/auth`, not under `components/ui`.

Important: do not hard-code `npx shadcn@latest add @coss/form @coss/field` unless `@coss` is first configured or verified available.

### Files to Add

```text
frontend/src/config.ts
frontend/src/api/http/constants.ts
frontend/src/api/http/errors.ts
frontend/src/api/http/auth.ts
frontend/src/app/query-client.ts
frontend/src/app/auth.ts
frontend/src/app/auth/RequireAuth.tsx
frontend/src/app/auth/GuestOnly.tsx
frontend/src/features/auth/AuthLayout.tsx
frontend/src/features/auth/AuthField.tsx
frontend/src/features/auth/LoginRoute.tsx
frontend/src/features/auth/RegisterRoute.tsx
frontend/src/features/auth/auth-validation.ts
frontend/src/features/auth/auth-routes.test.tsx
frontend/src/api/http/auth.test.ts
frontend/src/test/render-app.tsx
```

### Files to Modify

```text
frontend/package.json
frontend/package-lock.json
frontend/src/app/AppProviders.tsx
frontend/src/app/router.tsx
frontend/src/app/shell/navigation.tsx
frontend/src/features/shell/AppSidebar.tsx
frontend/src/app/shell/WorkspaceShell.test.tsx
```

## API Client Plan

### `constants.ts`

```ts
export const BASE = "/v1";
```

### `errors.ts`

Adapt the old backup's typed transport errors:

- `unauthorized`
- `conflict`
- `rate_limited`
- `invalid_edit`
- `network`
- `server`

For this auth pass, the important mappings are:

- 401 -> `unauthorized`
- 429 -> `rate_limited`, including `Retry-After`
- 5xx and other non-ok -> `server`
- fetch/abort failure -> `network`

### `auth.ts`

Implement:

```ts
export interface MeData {
  id: string;
  name: string | null;
  email: string;
  has_password: boolean;
  google_connected: boolean;
  settings: UserSettings;
}

export interface UserSettings {
  theme?: string;
  default_source_config?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
}

export interface LoginInput {
  email: string;
  password: string;
}
```

Functions:

- `fetchMe(): Promise<MeData | null>`
  - `GET ${BASE}/me`
  - `credentials: "same-origin"`
  - return `null` on 401
  - throw on non-401 failures
- `login(input: LoginInput): Promise<void>`
  - `POST ${BASE}/auth/login`
  - `Content-Type: application/x-www-form-urlencoded`
  - body keys: `username`, `password`
  - `credentials: "same-origin"`
- `register(input: RegisterInput): Promise<void>`
  - `POST ${BASE}/auth/register`
  - JSON body
  - `credentials: "same-origin"`
- `logout(): Promise<void>`
  - `POST ${BASE}/auth/logout`
  - `credentials: "same-origin"`
- `authErrorMessage(error: unknown): string`
  - preserve old mappings:
    - `LOGIN_BAD_CREDENTIALS` -> `Incorrect email or password.`
    - `REGISTER_USER_ALREADY_EXISTS` -> either generic registration failure or precise copy only if the backend abuse/enumeration tradeoff is accepted;
    - `REGISTER_INVALID_PASSWORD` / `UPDATE_USER_INVALID_PASSWORD` -> `Password must be at least 8 characters.`
    - 429 -> include retry-after seconds when present
    - network -> `Could not reach the server. Check your connection and try again.`
    - default -> `Something went wrong. Please try again.`

Use `AUTH_REQUEST_TIMEOUT_MS = 15_000` for short auth requests. Do not apply this timeout to future SSE/chat streaming requests.

## TanStack Auth State Plan

### Query Setup

Add `QueryClientProvider` in `AppProviders`.

`query-client.ts`:

- create one `QueryClient`;
- set auth-friendly defaults:
  - `retry: false` for auth query/mutations;
  - keep normal defaults minimal for now.

`app/auth.ts` exports:

- `authQueryKey = ["me"] as const`;
- `useMe()`;
- `useAuthUser()`;
- `useLogin()`;
- `useRegisterAndLogin()`;
- `useLogout()`.

### `useMe()`

Use TanStack Query:

- query function: `fetchMe`;
- `staleTime: 60_000`;
- `retry: false`;
- data states:
  - `isPending`: checking cookie;
  - `data === null`: logged out;
  - `isError`: server/network error;
  - `data`: authenticated.

### Mutations

`useLogin()`:

- call `login(input)`;
- on success invalidate `authQueryKey`;
- caller navigates after `fetchMe` confirms auth.

`useRegisterAndLogin()`:

1. call `register(input)`;
2. call `login({ email, password })`;
3. invalidate `authQueryKey`;
4. if register succeeds but login fails:
   - clear password fields;
   - navigate to `/login` with notice: `Your account was created. Please log in.`

`useLogout()`:

- call `logout()`;
- immediately remove auth query and session-scoped queries from the cache;
- navigate to `/login`.

For now, session-scoped query removal can remove only `authQueryKey`; when chat/session queries return, add their keys here.

## Routing Plan

### Route Shape

Move authenticated workspace routes under `/app/*`.

Public routes:

- `/`
  - simple public entry route for now;
  - if authenticated, redirect to `/app/tasks`;
  - if anonymous, show minimal links to login/register or redirect to `/login`;
  - this keeps `/` public and leaves room for the real landing page.
- `/login`
- `/register`

Protected routes:

- `/app`
  - redirects to `/app/tasks`
- `/app/tasks`
- `/app/calendar`
- `/app/schools`
- `/app/activities`
- `/app/essays`
- `/app/essays/:essayId`

Update sidebar/navigation links from `/tasks`, `/schools`, etc. to `/app/tasks`, `/app/schools`, etc.

### `RequireAuth`

- pending: render simple centered spinner/skeleton;
- query error: render a simple `Card` with `Retry` button calling query refetch;
- `data === null`: redirect to `/login`;
- `data`: render `<Outlet />`.

Preserve the attempted destination:

```ts
const from = {
  pathname: location.pathname,
  search: location.search,
  hash: location.hash,
};
```

Only preserve destinations whose pathname starts with `/app`.

### `GuestOnly`

- pending: render simple spinner;
- authenticated: redirect to `/app/tasks`;
- anonymous or `/me` error: render `<Outlet />`.

An auth-check error should not block login/register, because the user may need to re-authenticate after a transient `/me` failure.

## Form and UI Plan

Auth UI should be functional, not polished.

Use existing primitives:

- `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardPanel`
- `Button`
- `Input`
- `Separator`
- `Spinner` through the `Button` `loading` prop

Use registry-provided `Field`/`Form` only if verified available. Otherwise use local `AuthField`:

```tsx
type AuthFieldProps = {
  id: string;
  label: string;
  error?: string;
  description?: string;
  children: React.ReactNode;
};
```

`AuthField` requirements:

- visible label;
- error text with `role="alert"` when present;
- child input receives `aria-invalid` and `aria-describedby` from caller;
- no placeholder-as-label.

### Form State and Validation

No React Hook Form in this pass.

Use controlled inputs with typed local state:

- `LoginFormState = { email: string; password: string }`;
- `RegisterFormState = { name: string; email: string; password: string; confirmPassword: string }`.

Validation module:

- `validateLogin(values): Partial<Record<keyof LoginFormState, string>>`;
- `validateRegister(values): Partial<Record<keyof RegisterFormState, string>>`.

Validation behavior:

- show field errors after blur and after submit;
- submit validates all fields;
- disable submit while mutation is pending;
- clear password fields after successful submit or navigation;
- do not trim password;
- email can be trimmed for validation/submission;
- name can be trimmed for validation/submission.

Field rules:

- name required, 3-80 chars;
- email required and basic email pattern;
- password required, min 8, max 128;
- confirm password must match.

### Layout

- full-screen `AuthLayout` with centered card;
- Counselle wordmark text only;
- `LoginRoute`
  - email field
  - password field
  - submit button
  - “Create account” link
- `RegisterRoute`
  - name
  - email
  - password
  - confirm password
  - submit button
  - “Already have an account” link

No Google button in this pass.

## Logout Plan

Add a minimal account area to `AppSidebar`.

Simplest acceptable first pass:

- show `user.name ?? user.email` when sidebar is expanded;
- show a `Log out` button;
- when collapsed, show an icon button with tooltip;
- clicking logout calls `useLogout()` then navigates `/login`.

Potential later upgrade: replace with `DropdownMenu` containing account/settings/logout.

## Testing Plan

### Shared Test Harness

Add `frontend/src/test/render-app.tsx`.

It should provide:

- `createTestQueryClient()`;
- `renderApp(path, options)` with router + providers;
- auth fixtures for:
  - authenticated user;
  - anonymous user;
  - auth-check pending when needed;
  - auth-check network/server error.

Route tests should prefer `createMemoryRouter` or an equivalent router setup where initial entries can include search/hash.

Existing app-level tests must opt into authenticated state instead of relying on the app being public.

### API Client Tests

`frontend/src/api/http/auth.test.ts`

- `fetchMe()` returns user on 200.
- `fetchMe()` returns `null` on 401.
- `fetchMe()` throws typed network error on fetch failure.
- `login()` sends form-encoded `username` and `password`.
- `register()` sends JSON.
- `logout()` sends credentials.
- 400 auth bodies extract codes from both string and object `detail`.
- `authErrorMessage()` maps bad credentials, weak password, rate limit, network.
- register existing-email messaging follows the final enumeration decision.
- 429 handling covers login and register.

### Route and UI Tests

`frontend/src/features/auth/auth-routes.test.tsx`

Cases:

- anonymous `/app/tasks` redirects to `/login`;
- authenticated `/login` redirects to `/app/tasks`;
- `/me` network/server error on `/app/tasks` renders retry card, not login;
- login success navigates to intended internal route;
- destination restoration preserves `pathname`, `search`, and `hash`;
- external or non-app destination is rejected and falls back to `/app/tasks`;
- register success performs register then login and lands in workspace;
- register success + login failure goes to `/login` with created-account notice;
- logout clears query state and lands on `/login`;
- password fields are cleared after successful register/login navigation.

### Existing Shell Tests

Update `WorkspaceShell.test.tsx` helpers to use the shared authenticated test harness.

Do not weaken the shell tests.

### Backend Prerequisite Tests

If this auth UI is implemented in the same feature branch, add backend tests for:

- cross-origin auth POST rejected;
- register route rate-limited or gated;
- precise existing-email copy is covered by the accepted enumeration decision.

## Implementation Sequence

1. Add backend prerequisite tasks to the implementation checklist. Do not ship without them.
2. Install TanStack Query.
3. Search component registries from `frontend/` for form/field primitives.
4. Either install verified form/field primitives or add local `features/auth/AuthField.tsx`.
5. Add HTTP constants/errors/auth client and API tests.
6. Add query client and `app/auth.ts` hooks.
7. Add `RequireAuth` and `GuestOnly`.
8. Wire `QueryClientProvider` into `AppProviders`.
9. Reshape router:
   - public `/`, `/login`, `/register`;
   - protected `/app/*`.
10. Update shell navigation links to `/app/*`.
11. Build `AuthLayout`, `LoginRoute`, `RegisterRoute`, validation.
12. Add sidebar logout.
13. Add shared test harness and update existing app-level tests.
14. Run:
   - `cd frontend && npm run typecheck`
   - `cd frontend && npm test`
15. Manual smoke:
   - logged out user sees `/login` when visiting `/app/tasks`;
   - register creates user and enters `/app/tasks`;
   - logout returns to `/login`;
   - login restores `/app/tasks`;
   - attempted `/app/schools?tab=list#target` restores after login;
   - killing backend while loading `/app/tasks` shows retry state, not redirect loop.

## Out of Scope

- Password reset pages.
- Profile/settings/account deletion UI.
- Theme syncing from `user.settings`.
- Chat/session data cache clearing beyond auth logout state.
- Google OAuth UI.
- Production deployment changes.

## Known Follow-Ups

- Add password reset routes using existing backend endpoints.
- Add account/settings screen using `/v1/me`.
- Sync theme from `user.settings.theme`.
- Add Google OAuth after backend association/email-verification risk is fixed.
- Add session-scoped query clearing once chat/session queries return.

## Risks and Mitigations

- **Risk: redirect loop on `/me` failure.**
  - Mitigation: distinguish `data === null` from `isError`; only 401 becomes anonymous.
- **Risk: frontend accidentally stores auth token.**
  - Mitigation: no token fields, no localStorage/sessionStorage for auth.
- **Risk: login CSRF.**
  - Mitigation: backend origin/referer or equivalent CSRF protection before shipping.
- **Risk: register abuse and email enumeration.**
  - Mitigation: backend register throttle/gate plus explicit copy decision.
- **Risk: register creates account but auto-login fails.**
  - Mitigation: redirect to `/login` with explicit account-created notice.
- **Risk: existing tests fail because routes become protected.**
  - Mitigation: shared auth-aware test harness.
- **Risk: COSS form primitive APIs are assumed incorrectly.**
  - Mitigation: registry discovery first; otherwise use local `AuthField`.
- **Risk: public `/` remains vague.**
  - Mitigation: implement a minimal public entry now; real landing page can replace it later without moving workspace routes.

