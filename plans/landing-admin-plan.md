# Landing admin: a private waitlist dashboard at `acceptra.ai/admin/`

**Status:** draft r2, 2026-09-30. Revised after two reviews: security/platform, and UI/UX/design system. Neither found anything critical, and every accepted fix is folded in below (§13 lists what was declined). Not built. Branch `feat/landing-waitlist-dashboard`, rebased onto `main` at `95beda27` (PostHog full capture merged as #24).

**Reverses** the non-goal in `plans/landing-backend-plan.md` §1 ("No admin dashboard: PostHog and the D1 console cover it"). In practice nobody opens the D1 console, reading the list needs `wrangler login` in a terminal, and PostHog undercounts because blockers hide some visits. The owner asked for "a way to see the waitlist".

**Companions:** `plans/landing-backend-plan.md` (the table and the write endpoint), `plans/landing-launch-plan.md` (the deploy runbook), and `docs/DEPLOY.md` § The public landing site (the living description this plan updates).

## 1. Problem

Signups land in D1 (`acceptra-waitlist`, table `waitlist`). The founders need to answer these in seconds, from a laptop or a phone:

1. How many signed up, and is it moving (today, the last 7 days, per day since launch)? Did anyone new sign up since I last looked?
2. Who they are: student, parent, counselor or school, their class year, and the plan they chose.
3. Where they came from: the channel (`utm_*`) and the button they clicked (`source`).
4. Find one person, and delete them on request. The privacy policy promises deletion within 30 days.
5. Export the list, or a filtered slice of it, or copy the addresses to paste into an email.

**Non-goals:**

- Editing rows, emailing the list, or bulk delete.
- Roles or permissions beyond "is an admin".
- An admin for any other data.
- Server-side pagination (not until the §4.3 cap is near).
- **No analytics on the admin page.** PostHog's session replay records typed text and network bodies, so loading it here would record the whole list.

## 2. What already exists, and what we do with it

The owner remembered "some sort of dashboard". There are two, and neither one can show the waitlist:

| Surface | State | Decision |
|---|---|---|
| **CDS admin** (`features/cds-admin/`, `pages/cds-*`, `api/routes/cds_admin.py`) | Parked under ADR 0038: in the tree, unrouted and unmounted (`PARKED.md`). | **Leave it parked.** It's a PDF-extraction review tool with nothing that fits a signup list. `PARKED.md` governs it, and touching it here would smuggle an unrelated change. |
| **School-data admin** `/app/admin/facts` (`features/admin-facts/`, `api/routes/admin_facts.py`) | Live in the app, gated by `current_superuser` + `AdminGate`. | **Leave it where it is. Borrow its shape**: `PageContainer`, freshness in the `subtitle`, `ui/table`, `Skeleton`, `Empty`, `ErrorCard`, a TanStack Query hook, and the §13 copy. The waitlist page should look like its sibling. |

**Why the waitlist page doesn't go into the app at `/app/admin/waitlist`:**

- **The app isn't deployed.** B6 is deferred. A page in the app would only work on a laptop running `uvicorn` and Vite, and it would need a Cloudflare API token with D1 read *and delete* scope in the app's `.env`.
- **The data lives in the landing's Pages project.** Putting the page next to it means the same D1 binding, no token, and no CORS.
- **It isn't a stopgap.** The waitlist lives exactly as long as the landing form does. At app launch the rows move into `counselle.waitlist` (landing-backend-plan §7).
- **Moving it later is cheap.** The UI uses the app's design system and `components/ui`, so a move to `/app/admin/` is one feature folder plus one swapped query hook ("optimize for rewrite cost").

## 3. Decisions

| # | Decision | Choice | Why |
|---|---|---|---|
| A1 | Where it runs | **The `acceptra` Pages project**: a static page at `/admin/` plus a Function API at `/admin/api/waitlist`, on the existing `DB` binding | Same origin as the data. One deploy (`npm run deploy:landing`), no token, no CORS. |
| A2 | Who gets in | **Cloudflare Access** (Zero Trust Free): a self-hosted application on `acceptra.ai`, path `admin`. Allow policy = the founders' emails. Login by **one-time PIN** (emailed code). | SSO in front of the origin, for the HTML as well as the API. We write no login and store no passwords. The one-time PIN needs no OAuth client; Google can be added later. |
| A3 | Defence in depth | **`functions/admin/_middleware.ts` verifies the Access JWT itself** and checks the email against `ADMIN_EMAILS` before *any* `/admin*` response. | Access guards only `acceptra.ai`. `acceptra.pages.dev` and every preview serve the same Functions with the **production D1** bound, so without this check `https://<anything>.acceptra.pages.dev/admin/api/waitlist` would dump every email. Cloudflare's docs say to validate the JWT at the origin. The allowlist catches an Access policy that has been widened by mistake. |
| A4 | JWT library | **`jose`** (`jwtVerify`, `createRemoteJWKSet`) | It's Cloudflare's documented example, runs on Workers, and handles the 6-weekly key rotation through `kid`. |
| A5 | UI system | **The app's design system** (`src/index.css` tokens, `components/ui/*`, `PageContainer`), not the landing's `lp-` marketing CSS | This is a product-register tool (PRODUCT.md), a sibling of `/app/admin/facts`, and it should be movable into the app later. The app is light-only (DESIGN.md §3.4), and so is this page. |
| A6 | Data loading | **One GET returns every row** (capped, §4.3). Filtering, sorting, search, aggregates and CSV all run client-side. | A waitlist is hundreds to low thousands of rows; 10k rows is about 1.5 MB. Every filter is instant and the API is one read. D1's free tier allows 5M row reads a day. |
| A7 | Delete | **One row, pessimistic, no undo.** `DELETE /admin/api/waitlist` with `{ email }`, confirmed in an alert dialog. | This is a stated exception to DESIGN.md §17.4 (optimistic delete + undo). A privacy delete must be true when the UI says it is, and an undo would mean keeping the data. |
| A8 | Audit | **No durable audit.** Each delete logs `admin: deleted <n> row(s) by <admin email>` to the real-time Functions log. Recovery from a mistaken delete is D1 Time Travel (7 days on the free plan). | Pages Functions logs aren't retained, so the log line helps only while someone is tailing. For two founders that's fine. A D1 audit table storing the deleted email would defeat the delete, and one storing no subject isn't worth a migration. |
| A9 | Local dev | **`ADMIN_DEV_EMAIL` in `.dev.vars`**, honoured **only** when the hostname is `localhost`/`127.0.0.1`. It short-circuits the whole check. | `wrangler pages dev` has no Access in front of it. Both conditions must hold, and production never has the variable. `wrangler pages dev` binds to `localhost` by default; never run it with `--ip 0.0.0.0` while `.dev.vars` is set. |
| A10 | Config | `wrangler.toml` `[vars]`: `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ADMIN_EMAILS` | None of these is secret. The AUD and team domain are identifiers, the emails are the founders' own (the repo is private), and `wrangler.toml` is already this project's single source for config. `.dev.vars` overrides it locally. |

## 4. Server

### 4.1 Routing and files

```
frontend/
  admin/index.html                     new: the page entry, served at /admin/
  functions/admin/_middleware.ts       new: config, host, Access JWT, allowlist, headers
  functions/admin/api/waitlist.ts      new: GET list, DELETE one
  public-landing/_routes.json          include "/admin" and "/admin/*"
```

- **`_routes.json`** becomes `{"version":1,"include":["/api/*","/ingest/*","/admin","/admin/*"],"exclude":[]}`. A wildcard doesn't match the bare path, so both entries are needed.
  - The middleware matches `/admin`, `/admin/` and `/admin/api/*`, but not `/adminx`.
  - When no handler matches, `ctx.next()` falls through to the asset server, which serves `admin/index.html` and issues the `/admin` → `/admin/` redirect *after* the middleware has run.
- **The page's JS and CSS** land in `/assets/admin-*`, as with every chunk. That's code, not data.
- **Nothing links to `/admin/`.** Not the site, the sitemap, or `robots.txt`, since listing it there would advertise it.

### 4.2 `functions/admin/_middleware.ts`

The decision is a **pure, exported function**, so its tests exercise the real jose options (§8):

```ts
type Env = { DB: D1Database; ASSETS: Fetcher; ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string; ADMIN_EMAILS: string; ADMIN_DEV_EMAIL?: string };
type KeySet = Parameters<typeof jwtVerify>[1];
type Deny = "config" | "host" | "token" | "jwt" | "email";

export function makeVerify(env: Env, keys: KeySet) {
  return async (token: string) =>
    (await jwtVerify(token, keys, { issuer: env.ACCESS_TEAM_DOMAIN, audience: env.ACCESS_AUD, algorithms: ["RS256"] })).payload;
}
export async function authorize(url: URL, headers: Headers, env: Env, verify: ReturnType<typeof makeVerify>):
  Promise<{ ok: true; email: string } | { ok: false; reason: Deny }>;
```

`authorize` works through these steps in order, and the first failure ends it:

1. **Dev.** If `url.hostname` is `localhost` or `127.0.0.1` **and** `env.ADMIN_DEV_EMAIL` is set, allow as that email, **skipping steps 2–5**.
2. **Host.** Only `url.hostname === SITE_HOST` (from `brand.ts`) goes on. Anything else, including every `*.pages.dev` host and localhost without the dev var, fails with `host`.
3. **Config.** All of these must hold, or it fails with `config` (fail closed, never open):
   - `ACCESS_TEAM_DOMAIN` starts with `https://`;
   - `ACCESS_AUD` is non-empty;
   - `ADMIN_EMAILS` parses (comma-separated, trimmed, lowercased) to at least one address.

   This runs **before** verification, because jose skips the `audience`/`issuer` checks when given an empty string, which would admit a token from any Access app in the team.
4. **Token.** Read `Cf-Access-Jwt-Assertion`. If it's missing, fail with `token`. There's no fallback to the `CF_Authorization` cookie: Cloudflare's docs call the header the reliable one, and using the cookie would widen the CSRF surface.
5. **Verify and allowlist.**
   - `verify(token)` checks the signature, `iss`, `aud`, `alg`, `exp` and `nbf`. Any throw fails with `jwt`.
   - `payload.email` must be a `string` (service-token JWTs carry `common_name`, not `email`), and, lowercased, must be in the allowlist. Otherwise it fails with `email`.

The production key set is created **lazily** on the first request, because Pages Functions only receive `env` in the handler:

```ts
let jwks: { domain: string; keys: KeySet } | undefined;
function remoteKeys(domain: string) {
  if (jwks?.domain !== domain) jwks = { domain, keys: createRemoteJWKSet(new URL("/cdn-cgi/access/certs", domain)) };
  return jwks.keys;   // jose caches per isolate and refetches on an unknown kid
}
```

`onRequest`:

- **Deny.**
  - Log `console.warn("admin: denied (<reason>)")`. Only the reason code is logged, never the token or the claimed email.
  - Serve the site's own 404 (`env.ASSETS.fetch(new URL("/404.html", url))`, status 404) with the §4.4 headers, so the response is the same one any unknown path gets.
  - In production, Access answers unauthenticated requests before they reach us, so only a bypass attempt ever sees this.
- **Allow.**
  - Set `ctx.data.adminEmail` and `await ctx.next()`.
  - Copy the response (`new Response(res.body, res)`) and **`headers.set`**, never `append`, every §4.4 header. That makes each header single-valued whether or not the asset server also applied `_headers`, which is undocumented for responses that go through `next()`.
  - `headers.delete("Access-Control-Allow-Origin")`: Pages adds `*` to asset responses.

### 4.3 `functions/admin/api/waitlist.ts`

It follows the idioms of `functions/api/waitlist.ts`: the `reply`/`fail` envelope (`{ ok: true, … }` / `{ ok: false, error }`), and `errorCode()` logging, which never logs a message that could contain an email. Two files now need these helpers, so move them to `src/features/landing/waitlist/http.ts`, next to `contract.ts` (the existing convention for code Functions import), and import them from both Functions. That's the one change to `functions/api/waitlist.ts`, and its behaviour doesn't change.

```ts
export const LIST = `SELECT email, side, source, plan, role, class_of, utm_source, utm_medium, utm_campaign, created_at, updated_at
  FROM waitlist ORDER BY created_at DESC LIMIT ?1`;
export const COUNT = `SELECT count(*) AS total FROM waitlist`;
export const DELETE_ONE = `DELETE FROM waitlist WHERE email = ?1`;
const MAX_ROWS = 10_000;
const MAX_DELETE_BYTES = 512;
```

- **`GET`.** `db.batch([COUNT, LIST])` runs both in one transaction, so they see one snapshot. It returns `{ ok: true, rows, total, capped: total > rows.length }` with `Cache-Control: no-store`, and takes no query parameters.
- **`DELETE`.** The checks run in this order, like the write endpoint:
  1. `Origin` must equal `url.origin`, or 403.
  2. The content type must be `application/json`, or 415.
  3. `Content-Length` over 512, or 413.
  4. Read the body and **measure the bytes actually received**, or 413 (this covers chunked bodies).
  5. `email` must be a string that passes `emailShape`, or 400.

  Then delete by the email **as stored**, because the client sends back the exact key it received. The reply is `{ ok: true, deleted: meta.changes }`; `0` means the row was already gone and isn't an error. Log the §A8 line.
- **Any other method:** 405 with `Allow: GET, DELETE`.
- **A D1 failure:** 503 `unavailable`, logging the code only.

At 10k rows of about 150 bytes each, the response is roughly 1.5 MB. Past the cap, `capped` makes the UI say so (§5.5) while the counts still come from `total`. Server pagination is the next plan at that point, never a silent truncation.

### 4.4 Headers the middleware sets on every `/admin*` response

```
Cache-Control: no-store
X-Robots-Tag: noindex, nofollow
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Strict-Transport-Security: max-age=31536000; includeSubDomains
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'
```

- **`connect-src 'self'`** backstops the analytics ban (§6).
- **`frame-ancestors 'none'`** deliberately differs from `main`'s site-wide `frame-ancestors 'self' https://*.posthog.com`. The admin page must never load inside the PostHog toolbar.
- **`style-src 'unsafe-inline'`** covers ChartContainer's injected `<style>` and recharts' inline styles.
- **The `/assets/admin-*` chunks** keep the site-wide immutable cache headers. They hold code only.

### 4.5 What doesn't change

- `functions/api/waitlist.ts` behaviour, its host check, and the rate-limit rule.
- `migrations-landing/`: there's no migration, and no index is needed at this size.
- The landing page, its bundle, and its prerender.

## 5. UI and UX

### 5.1 The scene

A founder checks the list between launch posts: in the afternoon on a laptop, in the evening on a phone, a few times a day, sometimes with a teammate looking over their shoulder. They want momentum first ("is it moving, anyone new?"), then composition ("who?"), then a specific person.

The page is a quiet, dense product surface, a sibling of `/app/admin/facts`, and light-only like the app. The test is the product-register one: would someone fluent in Linear or Stripe's dashboard trust it at a glance?

### 5.2 Layout

The root is `<main className="flex h-dvh min-w-0">`. That's the `<main>` landmark and the bounded height `PageContainer`'s `flex-1 min-h-0` section needs, standing in for the app's `SidebarInset`. Inside it:

- **`PageContainer`**, with title "Waitlist" and `width="full"`.
- **Subtitle** (as the sibling page does): "Updated {relative}", from `formatRelativeTime(new Date(dataUpdatedAt).toISOString())`, re-rendered every 30s.
- **Actions**, in one `flex` row so they don't stack: `Copy emails`, `Export CSV`, and a Refresh icon button (`aria-label="Refresh"`, spinning `motion-safe:animate-spin` while it fetches).

The body has three bands, and only one of them is raised (DESIGN.md rule 9):

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Waitlist                                  [Copy emails] [Export CSV]  ⟳      │  PageHeader
│ Updated 2 min ago                                                            │
├──────────────────────────────────────────────────────────────────────────────┤
│ 412 signups · 38 in the last 7 days · 9 today · 12 new since yesterday 18:40 │  1. Momentum
│ ▁▁▂▁▃▂▂▅▃▄▃▆▅▄▇▅▆█▆▇▅▆▇▆█▇▆▇█▇                                                │
├──────────────────────────────────────────────────────────────────────────────┤
│ Channel             │ Who                     │ Class of                     │  2. Composition
│ producthunt  142 ▇▇▇│ Student     260 ▇▇▇▇▇▇  │ 2027   120 ▇▇▇▇              │     (one Card)
│ x             88 ▇▇ │ Parent       71 ▇▇      │ 2028    98 ▇▇▇               │
│ Untagged      76 ▇▇ │ School       44 ▇       │ 2029    40 ▇                 │
│ Show all 9          │ Counselor    12         │ Later   11                   │
│                     │ Didn't say   25 ▇       │ Didn't say  27 ▇             │
├──────────────────────────────────────────────────────────────────────────────┤
│ [⌕ Search email  /] [Plan: Any ▾] [From: Any ▾]  Clear filters     37 of 412 │  3. The list
│ Email                           Joined ↓    Who       Class  Plan  From  Channel⋯│
│ ● ana@school.org                3h ago      Student   2027   Free  Pricing  x  ⋯│
│                              [Show 200 more]                                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

**1. Momentum.**

- **Summary.** One sentence, not a tile grid (it avoids the hero-metric template): `412 signups · 38 in the last 7 days · 9 today · 12 new since {relative}`, with each number `font-medium tabular-nums`.
  - "Today" is the viewer's local calendar day.
  - "The last 7 days" means today plus the six previous local days, so it always equals the last seven bars.
  - The summary is always **unfiltered**: it answers "the whole list".
- **New since last visit.**
  - The time of the viewer's previous visit is kept in `localStorage` (`waitlist-admin:last-seen`). Every read and write sits in a `try/catch`, and the page renders correctly without it.
  - It's updated on `pagehide` and `visibilitychange → hidden`, so "new" means new since you last *left*.
  - Rows created after it show a small dot before the email, plus the visually hidden word "New". The dot is never colour-only; it uses the ink token, not a hue.
  - On the first visit the clause is omitted.
- **Chart.**
  - A bar chart, not a line, because a day is a discrete bucket. It's built with `ui/chart` `ChartContainer` (`className="aspect-auto h-30 w-full"`, since its default is `aspect-video`) and recharts, both already dependencies.
  - It's wrapped in `ChartFigure` (`schools/facts/charts/chart-shell.tsx`) with a text summary, for example "38 signups in the last 7 days, peak 14 on Sep 29".
  - **One bar per local day from the first signup**, keeping the last 90 once the list is older than that. There's no range control: until month three, every range would draw the same bars.
  - Days with zero signups draw as empty buckets and are never skipped.
  - **The chart draws the filtered rows.** When a filter is on, the tooltip reads "Tue, Sep 29 · 14 of 31 signups", so "which channel drove Tuesday?" takes one click.
  - `isAnimationActive={false}`.
  - **Mark colour:** a new token, `--waitlist-chart-mark: var(--ink)`, defined once in `styles/workspace.css`, like `--school-chart-mark`. The brand lime is 1.95:1 on the page, below the 3:1 floor for non-text marks.

**2. Composition.** This is the page's one raised surface: a `Card` with three columns separated by hairline dividers, not three cards. Each column is a ranked list of label, count and a thin inline bar (the same mark token; width = share of that column's largest value).

- **Channel.** `utm_source` values from the data, plus "Untagged". It shows the top 5, then a "Show all N" disclosure. It's the only column that can grow long.
- **Who.** A single dimension with one URL param, `who`, whose values are:
  - `student`, `parent`, `counselor`: from `role`;
  - `school`: `side = school`;
  - `unanswered`: `side = me` with no role, labelled "Didn't say".

  Every value is always shown.
- **Class of.** Counts **only the rows that were asked**: `side = me` and `role ≠ counselor`, with a null role included (`ForMe.tsx` never asks counselors or schools for a year). The values are `2027`, `2028`, `2029`, `Later`, and "Didn't say". Every value is always shown.
- **Every row is a toggle button** (`aria-pressed`) that filters the list and the chart by that value. The overview doubles as the way into the filters, and it's the page's one designed interaction.
- **Selected state:** `bg-[var(--surface-selected)]`, `font-medium`, and a check glyph (never colour alone, rule 35). A selected value always stays visible, pinned with its count even at 0.
- **Counts** respect every active filter, search included, **except their own facet** (standard faceted search), so choosing "x" doesn't collapse the Channel column.

**3. The list.**

- **Toolbar:**
  - A search `InputGroup` (placeholder "Search email", a `Kbd` `/` hint; case-insensitive substring match).
  - Two radio dropdowns: `Plan` (Free / Monthly / Yearly / Not chosen) and `From` (the `source` labels, §5.9). Each trigger shows its current value, for example "Plan: Monthly", like the sibling `CoverageFilters`.
  - "Clear filters" when any filter or search is on.
  - Right-aligned `37 of 412` (`tabular-nums`).
  - There are no chips: Channel, Who and Class are filtered and shown in the composition, which *is* the filter state.
- **Search** filters live off a local draft (`useDeferredValue`) and writes `q` to the URL after 250ms, the sibling's debounce.
  - `/` focuses the field unless focus is already in an input.
  - `Esc` inside the field clears it.
  - That's about 20 lines, following the pattern in `cds-admin/coverage/CoverageFilters.tsx`. That file is parked and stays untouched (§13).
- **Table.**
  - `ui/table`, rendered as `<Table render={<div className="relative w-full" />}>`. That's `StagingTable`'s escape hatch: the default wrapper's `overflow-x-auto` breaks `sticky`.
  - The header row is `sticky top-0 z-[var(--z-sticky)] bg-background` inside `PageContainer`'s scroll column.
  - At `md` and up the table is `table-fixed` with truncation, so it never scrolls sideways.

| Column | Cell | Below md |
|---|---|---|
| Email | New dot, then the address (`font-medium`), truncated, with the full value in `title` | shown |
| Joined | `formatRelativeTime`, with the absolute local date-time in a tooltip. **The only sort** (newest first by default; the header toggles direction, `aria-sort`) | shown |
| Who | Student / Parent / Counselor / School / "Didn't say" (muted) | shown |
| Class | Year, "Didn't say" (muted), or "Not asked" (muted) for counselors and schools | hidden |
| Plan | Free / Monthly / Yearly / "Not chosen" (muted) | hidden |
| From | The `source` label (§5.9) | hidden |
| Channel | `utm_source`, with `utm_medium · utm_campaign` muted beneath; "Untagged" (muted) when all three are null | hidden |
| ⋯ | Row menu: Copy email · Open in PostHog · Delete signup… | shown, always visible |

- **Absent values are words, never blanks** (rule 34). The ordinary state gets no colour (rule 5), and no cell is a status, so there are no badges.
- The first **200** filtered rows render, then `Show 200 more`. There's no virtualization.
- **Open in PostHog** goes to `https://us.posthog.com/project/<id>/person/<encodeURIComponent(email)>` in a new tab (`rel="noopener noreferrer"`). A join calls `identify(email)` (merged in #24), so the email is the person's distinct id. The project id is a named constant in `features/waitlist-admin/links.ts`. The admin can't import `analytics.ts` (§6), and nothing else needs the id.

### 5.3 Narrow screens (below md)

- **Header:** the actions shrink to icon buttons with `aria-label`s, in one row.
- **Summary:** it wraps, and the chart stays full width.
- **Composition:** it shows **one column at a time**, behind a `SegmentedControl` (label "Breakdown": Channel / Who / Class). Stacking all three would push the list about 600px down.
- **Table:** four columns (Email, Joined, Who, ⋯), per the table above. The `⋯` is always visible, and tapping the row itself does nothing, so Delete is never one mis-tap away from a scroll (the `TaskRow` touch rule).
- **Targets and overflow:** 44px targets on coarse pointers (rule 26), and no horizontal page scroll at 320px (checked in e2e).

### 5.4 State

- **URL** (`useSearchParams`, `replace: true`, modelled on `coverage-params.ts`): `q`, `who`, `channel`, `class`, `plan`, `from`, `dir`. Reload, back and a shared link reproduce the view.
- **Server:** TanStack Query `useWaitlist()` in `features/waitlist-admin/api.ts`, with `staleTime` 30s, refetch on window focus, and manual refresh.
  - The admin entry has its own `QueryClientProvider`; the app's providers assume `/v1`.
  - **Every request** sends `X-Requested-With: XMLHttpRequest` (so an expired Access session answers `401` instead of a cross-origin redirect) and uses `redirect: "manual"` (so any redirect that still comes back is an `opaqueredirect`, not a CORS `TypeError`).
  - A `401` or an `opaqueredirect` means the session ended. A `TypeError` means a network error. A 404 or 5xx is the generic error, never "session ended", because a reload can't fix it and would loop.
- **Derived data** is pure functions in `features/waitlist-admin/derive.ts`: `whoOf`, `wasAskedClass`, `applyFilters`, `facetCounts`, `dailyBuckets`, `summary`, `toCsv`. Components only render. This is the honesty core, and it's where the tests go (§8).

### 5.5 States the page draws

The copy follows DESIGN.md §13 exactly.

| State | What it shows |
|---|---|
| First load | `Skeleton` blocks: the summary line, the chart area, three columns of 5 rows, and 8 table rows. No spinner in the content. |
| Refetching | The data stays and the refresh icon spins. No layout shift. |
| Error, no data | `ErrorCard`: **"Could not load the waitlist"** / "The workspace could not reach the waitlist." / `[Try again]`. |
| Error, stale data | The data stays, with one inline line above the list: "Could not refresh. Showing the list from {relative}." `[Try again]`. |
| Empty | `Empty`: **"No signups yet"** / "Signups from acceptra.ai appear here." No CTA; it's seen once. |
| Filtered to zero | **"No signups match"** / "{narrowest filter} is the narrowest filter — {N} signups match everything else." / `[Relax {filter}]` `[Clear all filters]`. Search counts as a filter named `Search "{q}"`. |
| Capped | One quiet line above the list: "Showing the newest 10,000 of 12,431 signups. Counts include all of them." |
| Session ended | `Empty`: **"Your session ended"** / "Sign in again to see the waitlist." / `[Sign in again]`. The button does a full reload, so Access can redirect to its login. |

### 5.6 Interaction states and motion

DESIGN.md is the authority here. Where a skill differs, the house system wins.

- **Hover and press:** 4% on hover and 7% on press, applied to controls and rows. A card's hover lands on its border. **There's no transform on hover or press** (rule 31); that overrides better-ui's `scale(0.96)`.
- **Focus:** a visible `focus-visible` ring on every control, the facet rows and the Joined sort header included.
- **Disabled:** `opacity-64` plus the quiet fill (rule 25). For example, Export and Copy emails at zero rows.
- **Motion:** 150/200ms only, and never `transition-all` (rules 27–29).
  - Filter, search and sort changes apply **instantly**, because they happen tens of times a visit (emil: never animate high-frequency or keyboard changes).
  - Dialog and dropdowns keep their existing enter and exit.
  - No page-load choreography, and no stagger on the table.
- **Copy feedback** (Copy email, Copy emails):
  - The icon cross-fades from copy to check: opacity + `scale(0.25→1)` + `blur(4px→0)`, 150ms `ease-out` (the house curve, rule 27).
  - It holds for 1.2s, then fades back. The accompanying toast is the static cue.
  - Under `prefers-reduced-motion` it's opacity only.
- **Keyboard:**
  - `/` focuses search.
  - Menus and the dialog get Radix arrow-key navigation and focus return.
  - Rows aren't focusable, but their `⋯` buttons are.
- `tabular-nums` applies wherever a count or date sits in a column.

### 5.7 Delete flow

Delete lives in a modal, which is the right tool here: the action is destructive, irreversible and rare.

1. Row menu → **Delete signup…** opens `Dialog` with `role="alertdialog"`.
   - **Title:** "Delete {email}?" (`[overflow-wrap:anywhere]`).
   - **Body:** "This removes their signup from the waitlist and can't be undone. Also delete them in PostHog and from any export you've saved." with an **Open in PostHog** link.
   - **Buttons:** `Cancel` (focused by default) and `Delete signup` (destructive).
2. **Confirm:** `Delete signup` takes the Button `loading` state. Cancel is **not** natively disabled (that would drop focus to `<body>`), and `onOpenChange` ignores close requests while the request is in flight.
3. **Success:** the dialog closes, the row leaves the query cache (then a refetch runs), and a `sonner` toast says "Deleted {email}". There's no undo (§A7).
4. **Failure:** the dialog stays open with an inline error: "Could not delete {email}. Nothing was changed." `[Try again]`. A 401 shows the session-ended state instead.
5. **`deleted: 0`** shows the same success: the person is gone, which is what was asked.

### 5.8 Export and copy

- **`Export CSV`** exports **the current filtered view**, all of it, not only the 200 rendered rows. When a filter is on, the label reads "Export 37".
  - **Columns:** `email, created_at, updated_at, side, role, class_of, plan, source, utm_source, utm_medium, utm_campaign`, as raw values in ISO UTC.
  - **Format:** RFC 4180 quoting, `\r\n` line endings, and a UTF-8 BOM.
  - **Formula guard:** any cell beginning with `=`, `+`, `-` or `@` gets a leading `'`. `emailShape` allows `=…@x.co`, and `UTM_SHAPE` allows a leading `-`. Tab and CR can't occur (both shapes reject control characters), but the guard covers them anyway. The file round-trips **except for guarded cells**.
  - **File:** `acceptra-waitlist-YYYY-MM-DD.csv` (local date), built with a `Blob` and a temporary `<a download>`.
- **`Copy emails`** copies the current filtered view's addresses, newline-separated, ready to paste into a BCC field. The toast reads "Copied 37 emails". When a filter is on, the label reads "Copy 37 emails".

### 5.9 Copy and labels

Copy is sentence case and second person, and says the noun (§13.4). There's no descriptive copy under headings. Labels live in one place:

- **Move `ROLE_LABELS` out of `ForMe.tsx` into `contract.ts`**, and add `PLAN_LABELS` and `SOURCE_LABELS` there. The form and the dashboard read one list, so adding a role is one edit.
- **`SOURCE_LABELS`:** `nav` → "Header button", `plan` → "Pricing", `schools` → "For schools", `footer` → "Footer", `link` → "Direct link".

This is a small deliberate refactor that the feature needs.

## 6. Build

- **`vite.landing.config.ts`:** add `admin: path.resolve(__dirname, "admin/index.html")` to `input`.
  - The prerender only touches `landing.html`, and it already fails loudly if a second stylesheet reaches the landing page (`prerender-landing.mjs:33`).
  - React may land in a shared chunk. That's fine, but the landing page must reference no `admin-` asset (checked by `verify-landing.sh`, §8).
- **`admin/index.html`:** `<meta name="robots" content="noindex, nofollow">`, `<title>Waitlist · Acceptra</title>`, `lang="en"`, the favicon links, `<div id="root">`, and `/src/features/waitlist-admin/main.tsx`. There's no body class, because `index.css`'s base layer already sets the page background.
- **`src/features/waitlist-admin/main.tsx`:**
  - `createRoot`, with `StrictMode`, `QueryClientProvider`, `BrowserRouter` (react-router 8), `TooltipProvider` and `Toaster`.
  - It imports `@/index.css`.
  - **The analytics ban:** an ESLint `no-restricted-imports` rule scoped to `src/features/waitlist-admin/**` bans `@/features/landing/analytics` and `posthog-js`. The CSP (§4.4) is the backstop, never the only guard.
- **Dependencies:** add `jose` to `dependencies`, since Pages bundles `functions/` from `node_modules`. Nothing else is new.
- **`.gitignore`:** add `.dev.vars`. `frontend/.dev.vars.example` documents `ADMIN_DEV_EMAIL=you@example.com`.

## 7. Access setup

**The owner makes one click; the agent does the rest over the API** with `CLOUDFLARE_ACCESS_TOKEN` in `.env.deploy`.

1. **Owner, once, in the dashboard:** Zero Trust → Get started, team name `acceptra`, plan **Free**. The API returns `access.api.error.not_enabled` until this is done (checked 2026-09-30).
2. **Agent, via the API** (`/accounts/{id}/access/...`):
   - Confirm the organization's `auth_domain` is `acceptra.cloudflareaccess.com`.
   - Add the **one-time PIN** identity provider.
   - Create the **self-hosted application** "Acceptra admin":
     - domain `acceptra.ai/admin` (this path covers subpaths; `admin/*` would *not* cover `/admin`);
     - session 24h, `http_only_cookie_attribute: true`, `same_site_cookie_attribute: "lax"`, `enable_binding_cookie: true`;
     - `app_launcher_visible: false`, `allowed_idps` = [one-time PIN], `auto_redirect_to_identity: true`.
   - Create the **"Founders"** policy: `decision: allow`, include = `email` entries for each founder. **Never** `everyone`, an `email_domain`, or a `login_method` rule. With one-time PIN, this list *is* the whole security of Access.
   - Read the app's `aud` and write `ACCESS_AUD`, `ACCESS_TEAM_DOMAIN = "https://acceptra.cloudflareaccess.com"` and `ADMIN_EMAILS` (the same list as the policy) into `wrangler.toml` `[vars]`.
3. **Agent, after merge and deploy, checks:**
   - `curl -sI https://acceptra.ai/admin/` → 302 to `acceptra.cloudflareaccess.com`.
   - `curl -sI -H 'X-Requested-With: XMLHttpRequest' https://acceptra.ai/admin/api/waitlist` → 401.
   - `curl -sI https://acceptra.pages.dev/admin/api/waitlist` → 404.
4. **Owner:** open `https://acceptra.ai/admin/`, enter your email, type the emailed code, and see the list.

**Adding or removing an admin** takes two edits: the policy and `ADMIN_EMAILS`. That's deliberate (A3). DEPLOY.md gets both, and the agent can do both.

## 8. Verification

The repo's test stance still applies: tests go where they earn their place, which here is the security core and the honesty core.

**Unit tests (vitest, `npm test`).** Access and SQL tests sit under `src/features/waitlist-admin/`, importing the Functions by relative path like `upsert.test.ts`. The access test starts with `// @vitest-environment node`, because jose under jsdom trips on `Uint8Array` realms.

- **`access.test.ts`** runs the real `makeVerify` over `createLocalJWKSet` from a `generateKeyPair("RS256")`, so the actual `issuer`/`audience`/`algorithms` options are what's under test.
  - **Allowed:**
    - `acceptra.ai` with a valid token and a listed email;
    - the same email in different case.
  - **Denied:**
    - a missing token;
    - a bad signature;
    - the right key but **another app's `aud`**;
    - a wrong `iss`;
    - an expired token;
    - `alg: none`/HS256;
    - no `email` claim (a service token);
    - an unlisted email;
    - `acceptra.pages.dev` and `x.acceptra.pages.dev`;
    - empty `ACCESS_AUD`, a team domain without `https://`, and empty `ADMIN_EMAILS` (each fails `config` before verification);
    - `localhost` without `ADMIN_DEV_EMAIL`;
    - a production host with `ADMIN_DEV_EMAIL` set and no token (the bypass is bound to the host).
  - **Dev path:** `localhost` with the dev var is allowed.
- **`sql.test.ts`** runs `LIST`, `COUNT` and `DELETE_ONE` in `node:sqlite` against the real migration. It checks:
  - newest first;
  - `LIMIT` respected;
  - `COUNT` independent of the limit;
  - a delete returns `changes` 1, then 0.
- **`derive.test.ts`** covers:
  - `whoOf` and `wasAskedClass`, for every side/role combination;
  - facet counts, which exclude their own facet and include search;
  - a pinned selected value at 0;
  - daily buckets, where zero days are present and the last 7 bars sum to "last 7 days" at a fixed clock, including across a DST change;
  - "new since";
  - `toCsv`: quoting, the BOM, CRLF, and the formula guard on `=`, `+`, `-`, `@`.
- **`a11y.test.tsx`:** axe on the loaded page, the empty state, and the delete dialog (DESIGN.md §18).

**E2E.** A new `playwright.admin.config.ts` and `e2e/landing-admin.spec.ts`.

- **`webServer`:** `npm run build:landing && wrangler d1 migrations apply acceptra-waitlist --local && wrangler d1 execute acceptra-waitlist --local --file e2e/fixtures/waitlist-seed.sql && wrangler pages dev dist-landing --port 8788`, with `.dev.vars` providing `ADMIN_DEV_EMAIL`. The seed starts with `DELETE FROM waitlist;`, so the test can be re-run.
- **The spec:**
  1. Load the page; the counts match the seed.
  2. Click the "x" channel row; the table, chart tooltip and URL update.
  3. Search.
  4. Export, then read the downloaded file.
  5. Copy emails.
  6. Delete a row; after a reload it's gone.
  7. At 320px there's no horizontal overflow.
- The existing `playwright.landing.config.ts` run must still pass.

**`scripts/verify-landing.sh` additions.**

- **Any base URL:**
  - `/` references no `admin-` asset;
  - `sitemap.xml` has no `/admin`.
- **Production:**
  - `/admin/` → 302 to `*.cloudflareaccess.com`;
  - `/admin/api/waitlist` with `X-Requested-With` → 401;
  - `DELETE` without auth → never 2xx.
- **With `PAGES_DEV_URL` set:**
  - `/admin/` → 404;
  - `/admin/api/waitlist` → 404, with the site's 404 body and no JSON.

**Manual, once, in a real browser in production after §7:**

- Walk the §5.5 states on a laptop and a phone.
- Session end: delete the `CF_Authorization` cookie, press Refresh, and expect "Your session ended".

## 9. Tasks, in order

1. **The security core:**
   - `_middleware.ts` (`authorize`, `makeVerify`, lazy JWKS, the §4.4 headers, the site 404);
   - `access.test.ts`;
   - `jose`;
   - `_routes.json`;
   - `.dev.vars` in `.gitignore`.
2. **The API:**
   - extract `http.ts`, and repoint `functions/api/waitlist.ts` to it;
   - `functions/admin/api/waitlist.ts`;
   - `sql.test.ts`.
3. **Labels:** move them into `contract.ts`, and have `ForMe.tsx` read them there. The landing e2e must stay green.
4. **Derived data:** `derive.ts` and `derive.test.ts`.
5. **The entry:**
   - `admin/index.html`;
   - `main.tsx`;
   - the ESLint ban;
   - the Vite input;
   - the `--waitlist-chart-mark` token.

   `npm run build:landing` passes, and the prerender still finds one stylesheet.
6. **The page:** header, momentum, composition, list, the §5.5 states, delete, export and copy. Build it against the seeded local D1 under `wrangler pages dev`.
7. **Checks:** e2e, a11y and the verify-landing additions. Also `npm run typecheck`, `npm run build` (the only check that catches undefined identifiers), `npm run lint` and `npm test`.
8. **Access (§7):** the owner's one click, then the agent's API setup and the `wrangler.toml` vars.
9. **Docs:**
   - `docs/DEPLOY.md` § The public landing site: an "Admin page" paragraph, the Access setup and how to add an admin, and the "Reading the list" table's first row pointing at `/admin/`.
   - `AGENTS.md` status.
   - A pointer from `plans/landing-backend-plan.md`'s non-goal to this plan.
   - `TODOS.md`: the stale `AdminGate` doc comment, and the "CDS" sidebar label that points at the facts admin (both out of scope here).
10. **Ship:** PR → merge → `npm run deploy:landing` from `main` → the §7 production checks → the owner signs in.

## 10. Risks

| Risk | Mitigation |
|---|---|
| A preview or `pages.dev` host exposes the list (the production D1 is bound there) | The middleware's host and JWT checks don't depend on Access (A3). They're unit-tested, and verified live via `PAGES_DEV_URL`. |
| The Access policy is widened by mistake | The `ADMIN_EMAILS` allowlist in the Function. |
| Empty or malformed vars (jose skips empty `aud`/`iss`) | The config check fails closed before verification. Tested. |
| The admin page gets recorded by PostHog | The ESLint import ban, plus `connect-src 'self'`. |
| Admin CSS or chunks reach the landing page | Separate entries, the prerender's one-stylesheet check, and `verify-landing.sh` asserting no `admin-` asset on `/`. |
| CSV formula injection | The §5.8 guard. Tested. |
| CSRF delete | The Origin check, JSON-only (a non-simple request, so it gets a preflight), and the SameSite=Lax Access cookie. |
| `ADMIN_DEV_EMAIL` reaches production | It's honoured only on localhost hostnames, which can't be spoofed on the edge (Cloudflare routes by `Host`). Tested with the var set on a production host. `.dev.vars` is gitignored and never uploaded. |
| The Functions free quota (100k/day, shared) runs out | On the default fail-open, static files are served without Functions: `/admin/` HTML with no data, and the API 404s. That's no leak, but the page shows the generic error. At waitlist traffic this won't happen; it's noted in DEPLOY.md. |
| The list outgrows 10k rows | `capped` is shown honestly and the counts stay exact. Server pagination is the next plan. |
| An expired session misreads as an outage | `X-Requested-With` makes Access answer 401, and `redirect: "manual"` catches the rest. 404 never maps to "session ended". |

## 11. Files

**New**

- `frontend/admin/index.html`
- `frontend/functions/admin/_middleware.ts`
- `frontend/functions/admin/api/waitlist.ts`
- `frontend/src/features/landing/waitlist/http.ts`
- `frontend/src/features/waitlist-admin/`:
  - `main.tsx`, `WaitlistAdminPage.tsx`, `api.ts`, `derive.ts`, `params.ts`, `links.ts`, `useLastSeen.ts`
  - `Momentum.tsx`, `Composition.tsx`, `WaitlistToolbar.tsx`, `WaitlistTable.tsx`, `DeleteSignupDialog.tsx`
  - `access.test.ts`, `sql.test.ts`, `derive.test.ts`, `a11y.test.tsx`
- `frontend/playwright.admin.config.ts`
- `frontend/e2e/landing-admin.spec.ts`
- `frontend/e2e/fixtures/waitlist-seed.sql`
- `frontend/.dev.vars.example`

**Modified**

- `frontend/functions/api/waitlist.ts` (imports `http.ts`; no behaviour change)
- `frontend/public-landing/_routes.json`
- `frontend/wrangler.toml` (`[vars]`)
- `frontend/vite.landing.config.ts`
- `frontend/package.json` (`jose`)
- `frontend/eslint.config.js`
- `frontend/src/styles/workspace.css` (`--waitlist-chart-mark`)
- `frontend/src/features/landing/waitlist/contract.ts` and `ForMe.tsx`
- `frontend/scripts/verify-landing.sh`
- `.gitignore`
- `docs/DEPLOY.md`
- `AGENTS.md`
- `TODOS.md`
- `plans/landing-backend-plan.md`

**Untouched on purpose:** `migrations-landing/`, the landing page, the app, `features/admin-facts/`, and everything parked (`CoverageFilters.tsx` included).

## 12. Later (not in this plan)

- Server-side pagination and filtering, when `capped` first shows.
- Moving the page to `/app/admin/waitlist` at app launch, if the waitlist outlives the landing form.
- Google as a second Access login method (needs an OAuth client).
- A weekly digest of new signups.

## 13. Review disposition

| Suggestion | Decision | Why |
|---|---|---|
| Make `ADMIN_EMAILS` a Pages secret instead of `[vars]` | Declined | The repo is private and the founders' addresses aren't secret. A secret would need Wrangler's OAuth login, and it would split config away from `wrangler.toml`, which is this project's single source. |
| Cut the separate mobile layout; let the table scroll sideways | Middle path | Hide four columns below md instead. It's one class per cell, with no second component and no sideways scroll fighting the sticky header. |
| Cut the `/` shortcut, URL state, Open in PostHog, and the axe test | Kept | Each is a few lines. URL state makes a view shareable, PostHog is merged and the link is the bridge to replays, and DESIGN.md §18 asks for axe. |
| Extract or reuse `CoverageFilters`' search handling | Declined | It lives in parked CDS code. Extracting it would edit parked code, and reusing it would import CDS types. About 20 lines in the waitlist toolbar follow the same pattern. |
| Enable Access on preview deployments (Pages setting) | Declined for now | It doesn't cover the `acceptra.pages.dev` alias, so the host check is needed regardless, and it guards everything. |
| Keep Google login (r1) | Replaced by one-time PIN | It needs no OAuth client, which is human-only work in the Google console. |
