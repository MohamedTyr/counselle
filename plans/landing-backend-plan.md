# Landing backend: waitlist storage, analytics proxy, and what we can see

**Status:** draft, 2026-09-28, revised after two reviews (technical, and data/security/scope). Not built.
**Companion:** `plans/landing-seo-plan.md` owns the static build, hosting (D2 = Cloudflare Pages), `_headers` and DNS. This plan owns everything the landing page needs that is *not* a static file.

## 1. Problem

The landing page is the only thing we are deploying. It is a static site on Cloudflare Pages, and it needs two things a static site can't do on its own:

1. **Store waitlist signups.**
   - `waitlist/waitlist.ts` posts `{ email, side, source, plan?, role?, classOf? }` to `VITE_WAITLIST_ENDPOINT`.
   - The student side (`ForMe`) posts the email, then re-posts the same email with each follow-up answer. The school side (`ForSchool`, which uses the same `EmailField`) posts email, side and source only.
   - In production, with no endpoint set, submitting throws, so today every signup fails.
2. **Let us read the list**: how many signed up, who they are, and where they came from.

A third need is separable and ships on its own:

3. **Get analytics past ad blockers.** PostHog is wired (`landing/analytics.ts`), but it talks to `us.i.posthog.com` directly, and ad blockers hide 25–40% of those visits.

**Non-goals.** The app API, accounts, and the FastAPI backend: none of them deploy now. No email of any kind goes out (§12 is gated). No admin dashboard: PostHog and the D1 console cover it. (Reversed by `plans/landing-admin-plan.md`: the private waitlist page at `/admin/`.) No CAPTCHA until bot signups appear.

## 2. Decisions

| # | Decision | Choice | Why |
|---|---|---|---|
| B1 | Where the endpoint runs | **A Cloudflare Pages Function** at `POST /api/waitlist`, in the same Pages project as the page | Same-origin, one deploy, no CORS, free. Cloudflare now promotes Workers with static assets for new projects, but Pages is not deprecated. Pages is the SEO plan's hosting decision (D2), and `functions/`, `_headers`, `_redirects` and `404.html` all work on it. This code ports to a Worker unchanged if we ever move. |
| B2 | Where signups are stored | **Cloudflare D1** (managed SQLite), one table | It's a binding: no connection string, no secret, no pooling. Free-plan limits: 100k rows written a day, 5M read a day, and 500 MB per database, all far above a waitlist. The app's Postgres isn't deployed, and Render's free database has already expired. This table gets imported into Postgres once, at app launch (§7). |
| B3 | Source of truth for the signup count | **D1**, not PostHog | PostHog's `waitlist_joined` is a browser event and can be blocked. D1 has every row. PostHog is for rates and funnels, D1 for the count and the list. |
| B4 | Analytics proxy | **A separate, independent task** (§6): a Pages Function at `/ingest/*` | This is PostHog's documented free pattern. PostHog also sells a managed reverse proxy, which would need no code but is paid. The waitlist doesn't depend on this, so it can ship before, after, or never. |
| B5 | Server-side `waitlist_joined` capture | **No** | D1 already holds the exact count. A server-side capture would double-count the event, or need the browser's id handed across, for little gain. |
| B6 | Channel attribution on the row | **Only `utm_source`, `utm_medium` and `utm_campaign`**, read from `location.search` when the form is submitted | "Which campaign brought signups" is answerable from our own data. There's no `sessionStorage`: the page never navigates, and the dialog's hash writes keep the query string, so the tags are still in the URL at submit time. Referrer and country are **not** stored, because PostHog already has both (see Cut, below). |
| B7 | Abuse protection | Honeypot (client-side, already there); on the server, an `Origin` check, JSON-only, a size cap and validation; plus one Cloudflare rate-limit rule | Turnstile adds a script and friction to the one form that matters, for a problem we don't have yet. |

**Cut after review:**
- `referrer`: PostHog records it already, and full referrer URLs can carry personal data in their paths.
- `country`: low value, and one more field the privacy policy would have to disclose.
- `terms_version`: `created_at` plus the dated policy already shows which Terms were live.
- `sessionStorage` UTM persistence: the tags are still in the URL at submit time.
- A test harness built on `getPlatformProxy`: a hand-run SQL check (§9) pins the one rule that matters.

**Alternatives considered:**
- **Supabase or Neon Postgres now:** the same engine as the app, but it adds a vendor, a secret and a driver for one table.
- **Formspree, Google Sheets or Airtable:** the emails would live in a third-party form tool, and the update rule breaks.
- **FastAPI on Render:** a whole backend deploy to run one insert.

## 3. Data model

`frontend/migrations-landing/0001_waitlist.sql`:

```sql
CREATE TABLE waitlist (
  email         TEXT PRIMARY KEY,               -- NFC-normalised, trimmed, lowercased by the function
  side          TEXT NOT NULL CHECK (side IN ('me', 'school')),
  source        TEXT NOT NULL,                  -- today: nav | plan | schools | link; length-capped, not enum-checked
  plan          TEXT CHECK (plan IN ('free', 'monthly', 'yearly')),
  role          TEXT CHECK (role IN ('student', 'parent', 'counselor')),
  class_of      TEXT CHECK (class_of IN ('2027', '2028', '2029', 'Later')),
  utm_source    TEXT,
  utm_medium    TEXT,
  utm_campaign  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
```

Every value is allow-listed or length-capped. The `CHECK`s repeat the function's validation so a bad row can't be written even from the console. The class years are the chips `ForMe` offers today; widening them later is a one-line migration.

**The update rule.** This is the data-integrity core, and it must stay exactly this way:

```sql
INSERT INTO waitlist (email, side, source, plan, role, class_of, utm_source, utm_medium, utm_campaign)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
ON CONFLICT (email) DO UPDATE SET
  role       = CASE WHEN excluded.side <> waitlist.side THEN excluded.role
                    ELSE COALESCE(excluded.role, waitlist.role) END,
  class_of   = CASE WHEN excluded.side <> waitlist.side THEN excluded.class_of
                    ELSE COALESCE(excluded.class_of, waitlist.class_of) END,
  side       = excluded.side,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now');
```

- **Same side, repeat email:** fills in answers, and never replaces a stored answer with null. The form can't clear an answer anyway.
- **Side changed** ("me" to "school" or back): the row takes the new side, and the old side's answers are dropped. A row never says "school" while still carrying a student's class year.
- **First-touch fields never change:** `source`, `plan`, `utm_*` and `created_at`.
- **Known and accepted:**
  - A student who switches to counselor keeps the class year they picked earlier, because `ForMe` hides that question for counselors.
  - Two rapid clicks within one question group are last-write-wins.
  - "Wrong email?" leaves the mistyped address as its own row. Nothing is emailed, so it costs one junk row, and confirming addresses (§12) is what will separate these out.

**Stored:** only what's above. No IP, user agent, referrer or country.

## 4. The endpoint: `functions/api/waitlist.ts`

In order:

1. **Method:** only `POST` is accepted. Anything else gets a 405.
2. **Origin:** the `Origin` header must equal the request's own origin. That's the custom domain in production, and `localhost` under `wrangler pages dev`. Otherwise the request gets a 403.
3. **Content type:** `Content-Type` must be `application/json`, otherwise 415. This forces a CORS preflight on any cross-site attempt.
4. **Size:** a `Content-Length` over 2 KB gets a 413. After `request.text()`, the length is checked again, because a chunked body has no `Content-Length`.
5. **Validation.** A bad value gets a 400 `{ ok: false, error }`, and nothing is written.
   - **`email`:** trim it, apply `normalize("NFC")` and lowercase it. It must match the client's `EMAIL_SHAPE` or something stricter (never looser), with at most 254 characters and a local part of at most 64.
   - **`side`, `plan`, `role`, `classOf`:** must be one of the allowed values in §3.
   - **`source`:** at most 32 characters.
   - **`utm_*`:** each must match `^[\w\-.~ ]{1,100}$`. A value that fails is dropped, not rejected, so a mangled tag never blocks a signup.
6. **Write:** one prepared statement using D1's `.bind()`. SQL is never built from strings.
7. **Response:** `200 { ok: true }` for a new email and a repeat one alike, so the response never reveals who is on the list.
8. **D1 error:** log the error code only (never the body or the email) and return 503. The dialog already shows "We couldn't reach the list. Try again."

## 5. Frontend and build changes

- **`waitlist.ts`:** add `utm_source`, `utm_medium` and `utm_campaign` from `new URLSearchParams(location.search)` to each post, omitting empty ones.
- **The Pages build environment:** set `VITE_WAITLIST_ENDPOINT=/api/waitlist`. It's a `VITE_` variable, so Vite bakes it in at build time; setting it only as a runtime variable does nothing. The dev server keeps its fake 700 ms success when the variable is unset.
- **Fix `scripts/prerender-landing.mjs:73-80`.** This is a **blocker**: it runs `new URL(endpoint).origin`, which throws on `/api/waitlist`, so the build would fail.
  - Delete the `__WAITLIST_ORIGIN__` substitution from the script, and delete the placeholder from `public-landing/_headers`.
  - The endpoint is same-origin, so `connect-src 'self'` already covers it.
  - Keep the "endpoint not set" warning.
- **`privacy.html`:**
  - Add the campaign tags to "When you join the waitlist", worded as "the campaign link you arrived from, if any".
  - Name Cloudflare as the host that stores the list.
  - State the deletion process: email us, and the row is deleted within 30 days (the policy already promises a 30-day answer).

## 6. Analytics proxy: `functions/ingest/[[path]].ts` (independent task)

- **Routing:** `/ingest/static/*` and `/ingest/array/*` go to `https://us-assets.i.posthog.com/…`, and every other `/ingest/*` path goes to `https://us.i.posthog.com/…`.
- **Methods:** only `GET`, `POST` and `OPTIONS`. Anything else gets a 405, so it can't act as an open forwarder for other methods.
- **The upstream request** is built from a new URL: the method, the body, the query string, and `X-Forwarded-For` taken from `CF-Connecting-IP` (so PostHog's location lookup keeps working). It never copies the client's `Host`, `Cookie` or `Authorization` headers.
- **Then:** set `VITE_POSTHOG_HOST=/ingest` in the Pages build environment (`analytics.ts` already reads it), and in `_headers` drop both PostHog domains from `script-src` and `connect-src`, leaving `'self'`.
- **Build against PostHog's current Cloudflare proxy doc** (https://posthog.com/docs/advanced/proxy/cloudflare), because the upstream paths change occasionally.
- **If this breaks,** PostHog stops receiving events and signups keep working. The two paths are independent.

## 7. Reading the list

| Question | Where to look |
|---|---|
| How many signed up? | D1 console: `SELECT count(*) FROM waitlist;` The PostHog `waitlist_joined` trend shows the curve. |
| Conversion rate and drop-off | The PostHog funnel: Pageview → `waitlist_opened` → `waitlist_joined` → `waitlist_details` |
| Which channel converts | The PostHog funnel broken down by `utm_source` or referring domain; for exact counts, `SELECT utm_source, count(*) FROM waitlist GROUP BY 1;` |
| Who they are | `SELECT side, role, class_of, count(*) FROM waitlist GROUP BY 1,2,3;` |
| Export | `npx wrangler d1 export acceptra-waitlist --remote --output waitlist.sql` |
| Delete on request | `DELETE FROM waitlist WHERE email = ?;` in the D1 console, within 30 days of the email |

**At app launch:** export from D1, and load the rows into a `counselle.waitlist` table in Postgres (one migration and one `COPY`). Then either point the form at the API, or swap the Pages Function to write to Postgres. The table shape carries over unchanged.

## 8. Tasks (in order)

1. **Cloudflare setup (the owner, or me once `wrangler login` is done here):**
   - Run `npx wrangler d1 create acceptra-waitlist` and note the `database_id`.
   - Set the Pages project's **root directory to `frontend`** and its build command to `npm run build:landing`.
   - Set the build environment variable `VITE_WAITLIST_ENDPOINT=/api/waitlist`.
2. **`frontend/wrangler.toml`:** `name`, `compatibility_date`, `pages_build_output_dir = "dist-landing"`, and `[[d1_databases]]` with `binding = "DB"`, `database_name`, `database_id` and `migrations_dir = "migrations-landing"`.
   - Once this file exists, the dashboard shows the bindings read-only, so the binding lives only here.
   - Add `.wrangler/` to `.gitignore`.
   - Add the dev dependencies `wrangler` and `@cloudflare/workers-types`, and a `functions/tsconfig.json`.
3. **`public-landing/_routes.json`:** `{"version":1,"include":["/api/*","/ingest/*"],"exclude":[]}`, so static files never invoke a Function.
4. **The migration:** add `0001_waitlist.sql`, then run `npx wrangler d1 migrations apply acceptra-waitlist --local`, then the same with `--remote`.
5. **`functions/api/waitlist.ts`** as specified in §4. Depends on 2 and 4.
6. **Frontend and build** (§5): UTM on each post, the prerender fix (the blocker), and the privacy wording.
7. **The rate-limit rule** (dashboard): an exact match on the path `/api/waitlist`, 10 requests per 10 seconds per IP, then block for 10 seconds.
   - The free plan allows exactly this, and it only slows a bot down. The real defences are §4's checks.
   - The rule is zone-scoped, so it doesn't protect `*.pages.dev`. That's acceptable: the `Origin` check still applies there.
8. **Verify locally** with `npm run build:landing && npx wrangler pages dev dist-landing`, run §9, and run the SQL check.
9. **Verify in production** after the first deploy: one real signup, check the row, delete the row.
10. **Separately, whenever:** the proxy in §6.

## 9. Behaviors to verify

1. A new valid email returns 200 and creates one row with `side`, `source`, `plan` (when there is one) and any UTM tags from the URL.
2. A repeat email on the same side with `role` and `classOf` fills those in, and `created_at`, `source`, `plan` and `utm_*` don't change.
3. A repeat email on the same side **without** `role` leaves the stored `role` as it was.
4. A repeat email that switches side resets `role` and `class_of` to what the new post carries.
5. `  Email@Example.com` and `email@example.com` end up as one row.
6. A bad email, `side`, `role`, `classOf` or `plan` returns 400 and writes nothing. A bad UTM value is dropped and the signup still succeeds.
7. A wrong `Origin` returns 403, a non-JSON content type returns 415, a body over 2 KB returns 413, and a `GET` returns 405.
8. A filled honeypot sends nothing (client-side; confirm it hasn't regressed).
9. When D1 fails, the endpoint returns 503, the dialog shows its retry message, and the log line has no email in it.
10. A new email and a repeat email get byte-identical responses.
11. `npm run build:landing` succeeds with `VITE_WAITLIST_ENDPOINT=/api/waitlist`, and the built `_headers` has no leftover placeholder.

**Tests.** AGENTS.md says to test only what earns it. Behaviors 2–5 are the data-integrity rule, so pin them in one checked-in script, `migrations-landing/check_upsert.sql`: it inserts, re-posts, switches side, and `SELECT`s the expected state. Run it with `wrangler d1 execute acceptra-waitlist --local --file …` after any change to the statement. Everything else is covered by the manual pass in task 8.

## 10. Risks

| Risk | Mitigation |
|---|---|
| The update rule loses follow-up answers, rewrites where someone first came from, or mixes student and school answers | The rule in §3, pinned by `check_upsert.sql` |
| Someone submits other people's addresses | Nothing is emailed, so today it costs one junk row. The gate before any email is §12 (confirming addresses first). |
| Bot floods | Honeypot, the `Origin`/JSON/size/validation checks, and the rate rule. Watch the daily count, and add Turnstile if junk appears. |
| The build breaks on a relative endpoint | The prerender fix in §5 (the blocker), checked by behavior 11 |
| D1 becomes a second database to maintain | One table, no app code reads it, and it's imported once at app launch (§7) |
| Cloudflare moves Pages toward Workers | Pages is still supported, and the function code ports to a Worker unchanged |
| Minors' data | We store only an email, a role, a class year and campaign tags; no IP or user agent. The class years imply ages 15–18. The policy and terms carry the age statement, but the form has no age gate. That is an **accepted risk** for a waitlist, and must be revisited before accounts launch. |

## 11. Files

| File | Change |
|---|---|
| `frontend/wrangler.toml` | new: name, compatibility date, output dir, D1 binding with `migrations_dir` |
| `frontend/migrations-landing/0001_waitlist.sql` | new |
| `frontend/migrations-landing/check_upsert.sql` | new: the hand-run integrity check |
| `frontend/functions/api/waitlist.ts` | new |
| `frontend/functions/tsconfig.json` | new: Workers types |
| `frontend/public-landing/_routes.json` | new |
| `frontend/public-landing/_headers` | drop the `__WAITLIST_ORIGIN__` placeholder; PostHog domains go later, with §6 |
| `frontend/scripts/prerender-landing.mjs` | drop the origin substitution (the blocker) |
| `frontend/src/features/landing/waitlist/waitlist.ts` | attach UTM tags |
| `frontend/privacy.html` | campaign tags, Cloudflare as the host, the deletion process |
| `frontend/package.json` | dev dependencies `wrangler` and `@cloudflare/workers-types` |
| `.gitignore` | `.wrangler/` |
| *(§6, separately)* `frontend/functions/ingest/[[path]].ts` | new |

## 12. Later (not in this plan)

- **Confirming addresses (double opt-in).** This is a hard prerequisite for sending *any* email.
  - Without it, anyone can make us email a stranger (possibly a minor's parent) from the domain we're warming up.
  - Send only "confirm your spot", with a signed link. Add `confirmed_at`.
  - Every email after that carries the unsubscribe link the privacy policy promises.
- **A welcome email** through Resend, once confirming addresses exists. It needs SPF and DKIM records on `acceptra.ai`.
- **Referral links**, with a `referred_by` column.
- **Turnstile**, if bot signups appear.
- **An age gate**, before accounts launch.
