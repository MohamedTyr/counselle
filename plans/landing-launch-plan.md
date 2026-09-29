# Landing launch plan: ship acceptra.ai today, and only the landing

**Date:** 2026-09-28
**Branch:** `feat/landing-seo` → `main`
**Target:** the Cloudflare Pages project `acceptra`, on the custom domain `acceptra.ai`
**Revision:** v3, after two review rounds: technical accuracy, scope, and audit coverage in round 1; fix verification and a fresh-eyes read in round 2.

**Inputs.** On this date, five audits covered SEO, PostHog, code cleanliness, Cloudflare deploy readiness, and browser QA/perf/a11y. Five reviews then checked the plan. The raw reports and probe scripts (a PostHog storage test and a functions typecheck probe) are in the session scratchpad. File and line citations are to the tree **before** any change in this plan. This plan builds on `plans/landing-seo-plan.md` and `plans/landing-backend-plan.md`; it does not replace them.

Unless noted, every command runs from `frontend/`.

## 0. Problem, goal, non-goals

**Problem.** The landing is built and verified locally: `verify-landing.sh` passes, Lighthouse mobile scores 89 (desktop 100), and SEO scores 100. It still cannot ship:
- The backend (Pages Functions, the D1 migration, `wrangler.toml`) is untracked.
- Signups depend on a build-time env var. If it is missing, the build still succeeds and the form fails.
- The footer drops signups: its honeypot is visible, and its signups are never tracked.
- Analytics records full-session replays of teenagers, because that is the dashboard default.
- Dead code is left over from the design-variant era.
- The domain is not on Cloudflare yet.

**Goal.** Today, `https://acceptra.ai` serves the prerendered landing, `/privacy`, `/terms`, a real 404, waitlist signups into D1 that work, and storage-free PostHog analytics through `/ingest`. The code on `main` is clean: no dead code, no stray files, one source of truth per fact, and green gates.

**The work ships as two PRs, both today.**
- **PR 1 (launch)** holds everything the DNS flip depends on, plus the pure deletions.
- **PR 2 (cleanliness)** holds the structural refactors. It starts once production verification (§5.7) passes and targets a merge today; if the day runs out, it lands this week. It changes no user-facing behaviour, so it never blocks the launch.

**Non-goals.**
- The product app and its deploy (B6 stays deferred).
- New sections, or copy beyond the honesty and SEO fixes below.
- Email confirmation or double opt-in. There is no email infrastructure, and the policy already says we email when we open.
- A referral step on the thank-you state.
- Per-page OG images. One `og.png` is enough, and it states no school count.
- A designed icon.
- Turnstile.
- Founders and profiles content. The owner supplies it, and the code already handles it being empty.

## 1. Owner decisions

If a decision is unanswered, its recommendation is what gets built, **except D-1, which blocks commit 4 until the owner answers**.

| # | Decision | Recommendation | Why |
|---|---|---|---|
| D-1 | **Testimonials** (`sections/Testimonials.tsx:7-32`: Maya Rodriguez, Daniel Kim and Priya Shah, under "Students who tested it wish they'd had it") | **Remove, unless every quote comes from a real tester who consented.** AGENTS.md records your decision to keep them. Three auditors flagged them independently, so this asks you to confirm knowingly. **If they stay:** keep written consent on file for each quote, and never add Review or AggregateRating markup. **If they go:** reword the AGENTS.md sentence "Testimonials stay on by owner decision". | FTC 16 CFR Part 465 (in force since October 2024) bans testimonials from people who don't exist, with a penalty per violation. The page's own FAQ says "Nothing is estimated or made up". The Daniel Kim quote describes `/goal`, which no real student has used. AI answer engines repeat quotes as fact. |
| D-2 | **School count** (`brand.ts:9` `SCHOOL_COUNT = "2,700+"`) | **"2,200+"** | The DB has 2,746 identity profiles, but only **2,239** have any admissions, cost or aid facts. The copy says lists are "checked against" them and that the data covers "each school". This is the number answer engines will quote. |
| D-3 | **Session replay** | **Off**, pinned in code (§3.3) and turned off in the dashboard | It currently records 100% of sessions, including console logs, for a 13–18 audience. It also multiplies `/ingest` Function calls. |
| D-4 | **Analytics storage** | **`persistence: "memory"`**. This was verified by running posthog-js 1.434.17 with every storage write and cookie logged: cookies, localStorage and sessionStorage all stay empty. The only exception is a support probe that the SDK removes in the same tick. GeoIP still works, because the proxy forwards the visitor IP and PostHog runs GeoIP before "Discard client IP data" drops it. The trade-off: one page load counts as one visit, so a reload counts twice and a returning visitor counts as new. | No banner, a policy that is true, and country data for launch traffic. The alternative, `cookieless_mode: "always"`, loses country data and bot filtering (PostHog strips the IP before GeoIP, issue #48660), and it still writes to localStorage briefly. |
| D-5 | **Workers Paid ($5/month)** | **Yes, before launch** | `/ingest` and `/api/waitlist` share the free tier's 100k requests per day. A spike would exhaust it, and signups would then fail until midnight UTC. |
| D-6 | **Mentor calls, the counselor view, and the marquee logos** (`sections/featureList.tsx:31`, `sections/faqQuestions.ts:23`, `sections/plans.ts:34`, `sections/SchoolsMarquee.tsx`) | Confirm the calls and the counselor view exist, or will exist, as described. Confirm the university marks don't imply affiliation. | The same honesty carve-out as D-1. |
| D-7 | **Deploy mode** | **Git integration**, with Pages building `main` from `frontend/` | A direct-upload project can never switch to Git later. Git integration also gives a preview per branch, which the runbook uses before merge. |

## 2. PR 1: launch

Every phase ends with this gate green:

`npm run typecheck && npx eslint src/features/landing functions --max-warnings 0 && npx vitest run src/features/landing`

The ESLint gate is scoped because `eslint .` currently fails on 8 errors in unrelated app files, and the config lints only `.ts`/`.tsx`, so `scripts/` has nothing to lint.

### Phase 1: Repo hygiene and scope

1. **Move the two PDFs out of the repo** to `~/Documents/`: `docs/research/Mohamed Abdelhamid_ PRPC Petition Response 8_30_2026.pdf` (a personal legal document) and `docs/research/College Essay Essentials - Ethan Sawyer.pdf` (a copyrighted book). Both are untracked and not ignored, so a single `git add -A` would publish them. *Acceptance:* `ls docs/research/*.pdf` finds neither file.
2. **Delete** `frontend/.el.mjs`, `frontend/.sweep.mjs` and `frontend/.tabs.mjs`, which are one-off screenshot scripts.
3. **Keep these out of both PRs:**
   - `plans/agent-speed-cost-quality.md` and `plans/perf-program-revert-plan.md`, which are unrelated.
   - `animation-plans/`, which moves to `plans/.local/animation-plans/` (gitignored).
4. **Stage file by file; never `git add -A`.** The backend lands as **one atomic commit**, containing all of `plans/landing-backend-plan.md`'s work:
   - `frontend/functions/`, `frontend/migrations-landing/`, `frontend/public-landing/_routes.json`, `frontend/wrangler.toml` (still with the placeholder id)
   - `frontend/tsconfig.json`, `frontend/package.json` and `package-lock.json` (the devDependencies `wrangler` and `@cloudflare/workers-types`)
   - `.gitignore` (the `.wrangler/` entry)
   - `frontend/public-landing/_headers`, `frontend/scripts/prerender-landing.mjs`, `frontend/src/features/landing/waitlist/waitlist.ts`, `frontend/privacy.html`
   - `docs/DEPLOY.md`, the landing-backend line in `AGENTS.md`, and `plans/landing-backend-plan.md`

   These files depend on one another, so a partial commit breaks the build:
   - `tsconfig.json` references `functions/`, and `functions/` needs `@cloudflare/workers-types`.
   - `_headers` and the prerender change must land together, or the CSP ships a literal `__WAITLIST_ORIGIN__`.

### Phase 2: Signups cannot silently fail

1. **Hard-code the endpoint** in `waitlist/waitlist.ts:14,46-51` as `const ENDPOINT = "/api/waitlist";`. Keep the dev-only fake success under `import.meta.env.DEV`, since Vite dev has no Functions. Then delete:
   - the `loadEnv` block, its warning and its now-unused import in `scripts/prerender-landing.mjs:62-70`
   - the env row in `docs/DEPLOY.md`
   - the "must not have that warning" sentence in `docs/DEPLOY.md`

   `src/app/router.tsx:74` also renders `LandingPage` in the app build, where `/api/waitlist` doesn't exist. That is no worse than today, and the app isn't deployed, so record it in TODOS for B6.
2. **Move always-needed CSS out of the lazy chunk.** `waitlist/waitlist.css` loads only with the dialog, but two things outside the dialog depend on it:
   - **The honeypot** (`.lp-wl-trap`, `.lp-wl-sr` at `:280-288`). Until the dialog has opened once, the footer trap (`Footer.tsx:64-71`) is a visible text box across half the pill. A visitor who types into both fields is silently dropped as a bot and told "You're on the list".
   - **The z-index tokens** (`.lp { --lp-z-nav; --lp-z-backdrop; --lp-z-modal }` at `:5-8`). The fixed nav reads `var(--lp-z-nav)` (`hero.css:152`), so it computes `z-index: auto` until the dialog loads.

   Move both into `landing.css`. *Acceptance* (cold load at 390 and 1440px):
   - the trap computes to clipped, is out of the tab order, and is `aria-hidden`
   - the placeholder is not truncated
   - `getComputedStyle(document.querySelector(".lp-nav")).zIndex === "30"`
3. **Footer form feedback** (`sections/Footer.tsx:26-48`):
   - `emailProblem()` messages and server errors render in a `role="alert"` element linked by `aria-describedby`, the same way `EmailField` does it. The `<label>` stays static.
   - Add `method="post"` so a pre-hydration or no-JS submit never puts the email in a URL. That submit lands on Pages' 405 page, which is acceptable.
   - Add `id="waitlist"` to the footer signup block, so no-JS `#waitlist` CTAs scroll to a real form.
   - In the **initial-hash branch** of `useWaitlistDialog` (`:32-38`) only, call `window.scrollTo(0, 0)` **before** `setOpen(true)`. A `/#waitlist` deep link that the browser scrolled to the footer then starts at the top. Clicked links never scroll.
4. **Age at the point of signup.** `waitlist/LegalConsent.tsx` (rendered on both forms) reads: "By joining, you confirm you're 13 or older and agree to our Terms and Privacy Policy." The terms and policy already say 13+ (`terms.html:48`, `privacy.html:147`).
5. **Tighten server validation before the first remote migration.** The table isn't live yet, so edit `0001` in place:
   - Reject `\p{Cc}` and `\p{Cf}` characters in the email.
   - Make `source` an enum: `nav` (the nav CTA), `plan` (Pricing), `schools` (the Schools CTA), `footer` (the footer form), and `link` (a deep link or an untagged anchor).
   - Add a `CHECK` on `source`.
   - Fix the `0001_waitlist.sql:7` comment, which omits `footer`.

   Then reset local D1 with `rm -rf .wrangler/state/v3/d1 && npx wrangler d1 migrations apply acceptra-waitlist --local`, and run `npx wrangler d1 execute acceptra-waitlist --local --file migrations-landing/checks/check_upsert.sql`. Every check must return `ok: 1`.
6. **One waitlist contract.** `src/features/landing/waitlist/contract.ts` holds pure constants and types, with no imports, no `import.meta.env`, no `location` and no DOM:
   - `ROLES`, `SIDES`, `CLASS_YEARS`, `PLAN_IDS`, `SOURCES` with `isSource()`, and `UTM_KEYS`
   - `emailShape()`, which includes the control-character rule, so `emailProblem()` says "That email doesn't look right" before the form is submitted

   The client imports it through `@/`. `functions/api/waitlist.ts` imports it by **relative path** (`../../src/features/landing/waitlist/contract`), because wrangler's esbuild doesn't resolve `@/`. The typecheck probe confirmed that it compiles under `functions/tsconfig.json`.

   Other changes that come with it:
   - `sections/plans.ts` types its ids from `PLAN_IDS`.
   - `WaitlistEntry.source` and every `Events` `source` field are typed `Source`.
   - `useWaitlistDialog.ts:49` maps an unknown `data-waitlist-source` to `"link"`, so a typo can never cause a 400 on a real signup.
   - The SQL `CHECK`s stay as the last line of defence.
7. **Accept writes only on the production host.** `brand.ts` exports `SITE_HOST = new URL(SITE_URL).hostname`, the single definition, with a header comment: "import-free: also imported by Pages Functions". `functions/api/waitlist.ts` imports it by relative path and returns 403 unless the request hostname is `SITE_HOST`, `localhost` or `127.0.0.1`. This closes three gaps:
   - the zone rate limit never covers `*.pages.dev`
   - `Origin` is attacker-controlled outside browsers
   - previews share the production D1

   A preview signup shows the generic error. The 403 is visible in DevTools → Network.
8. **Function response headers.** `reply()` adds `X-Content-Type-Options: nosniff` and `Cache-Control: no-store`, because `_headers` never applies to Functions.
9. **Runtime pins**, in this phase's commit, because they decide whether the Pages build and deploy succeed:
   - `frontend/.nvmrc` = `22.16.0`, the Pages v3 default, written in full.
   - `compatibility_date` in `wrangler.toml` goes from today's `2026-09-28` to `2026-09-20`. Wrangler rejects or clamps a date newer than the runtime it ships with, so today's date can fail a deploy.

### Phase 3: PostHog, correct and storage-free

All changes are in `src/features/landing/analytics.ts` unless noted.

1. **Hard-code the host and the key.**
   - `const HOST = "/ingest";` replaces the fallback to `us.i.posthog.com`. That fallback bypasses the proxy, so ad blockers win, and it trips the Report-Only CSP. Delete the stale comment above it.
   - `const KEY = "phc_…";` is the public project key from `frontend/.env`. Delete `VITE_POSTHOG_KEY` from `.env` afterwards. It ships in every visitor's bundle anyway. First, confirm it belongs to the PostHog project configured in §5.3: in PostHog, go to Project settings → Project API key.
   - Delete both `VITE_POSTHOG_*` rows from DEPLOY.md.

   The build then needs **zero** env vars. Once `wrangler.toml` exists, the Pages dashboard shows these settings read-only, so this avoids depending on it.
2. **Report only from production.** Replace the `import.meta.env.DEV` gate with `if (client || location.hostname !== SITE_HOST) return;`, with `SITE_HOST` imported from `brand.ts`. This also excludes `*.pages.dev` previews, `wrangler pages dev` and `vite preview`.
3. **Pin privacy in code** (D-3, D-4). The options were verified against posthog-js 1.434.17:
   ```ts
   posthog.init(KEY, {
     api_host: HOST,
     ui_host: "https://us.posthog.com",
     defaults: "2026-08-30",
     person_profiles: "identified_only",
     persistence: "memory",
     disable_session_recording: true,
     session_recording: { recordBody: false, recordHeaders: false },
     disable_surveys: true,
     disable_product_tours: true,
   });
   ```
   - The replay options make sure that re-enabling replay later can never record the waitlist POST body. The body contains the email, and the SDK's payload deny-list doesn't cover `email`.
   - `disable_surveys` and `disable_product_tours` stop a dashboard toggle from ever writing to storage.
4. **Track footer signups.** In `Footer.tsx`, after a successful `submitWaitlist`, call `track("waitlist_joined", { side: "me", source: "footer" })`.
5. **Add `waitlist_failed`** to `Events`: `{ side, source, step: "join" | "details", status?: number }`, never with the email.
   - Send it from each catch: `EmailField.tsx:71`, `Footer.tsx:37` and `ForMe.tsx:93`.
   - `submitWaitlist` throws an error carrying the HTTP status, so a 403, a 429 (rate limit) and a 503 (D1) can be told apart.
   - Without this event, a broken endpoint looks like people stopped converting.
6. **The `ref` fallback.** In `waitlist.ts`, `campaignTags()` uses `?ref=` as `utm_source` when `utm_source` is absent (Product Hunt adds `ref=producthunt`). This is D1 only, with no schema change. PostHog doesn't treat `ref` as a campaign parameter, so every launch link we post carries full UTMs from the table in §8.2. In PostHog, untagged Product Hunt traffic shows up under `$referring_domain`. D1 is the ground truth for signups per channel.
7. **Strip `set-cookie` in the proxy.** `functions/ingest/[[path]].ts` wraps the whole `onRequest` result, covering both the upstream branch and the cached-asset branch: `const r = new Response(res.body, res); r.headers.delete("set-cookie"); return r;`. The existing `X-Forwarded-For` line stays, because GeoIP depends on it.
8. **Privacy policy** (`privacy.html:73-83, 133-138`), rewritten to match the code and the zone. It says:
   - This site and its analytics store nothing on your device.
   - The one exception: if you choose "For my school", the booking step embeds Google Calendar, and Google may set its own cookies under Google's policy.
   - There is no session replay.
   - PostHog receives your IP address to work out an approximate country, and doesn't keep it. This requires the §5.3 "Discard client IP data" setting.
   - Our host keeps standard server logs. Keep the existing bullet.
   - The legal basis for analytics is legitimate interest, which is valid without device storage. The legal basis for waitlist emails stays **consent**.
   - Update "Last updated" and the sitemap `lastmod` together.
9. **Fix the `source` comment** at `waitlist.ts:7`, which lists a `hero` source that doesn't exist, to point at `contract.ts`.

### Phase 4: SEO for launch traction. Commit 4 is blocked on D-1.

1. **Honesty.**
   - **D-1, if the testimonials are removed,** delete everything that belongs to them:
     - `<Testimonials />` (`LandingPage.tsx:36`) and the footer link (`Footer.tsx:12`)
     - `sections/Testimonials.tsx` and `sections/testimonials.css`
     - the `REVEALS` selectors in `useLandingMotion.ts:109-110`
     - the testimonial and world-map rules in `responsive.css` (`:123-140`, `:308-320`)
     - `.lp-person-*` in `landing.css:135,149`, if nothing else uses them
     - `assets/world-map.avif` and `assets/avatar-{daniel,maya,priya}.webp`
     - the `"Students who tested it"` entry in `verify-landing.sh`
     - the AGENTS.md sentence (see D-1)
   - **D-2:** set `SCHOOL_COUNT = "2,200+"` and update the `"2,700+"` check in `verify-landing.sh`.
2. **Target the head term "AI college admissions counselor".** Plan §0.2 names it, but the prerendered text never says it.
   - The `brand.ts:11` DEFINITION becomes "`${BRAND}` is an AI college admissions counselor for students, parents, …". It flows to FAQ #1, both schema descriptions and `llms.txt`.
   - The meta and OG descriptions in `landing.html` (160 characters or fewer) become: "AI college admissions counselor for students, parents and schools: essay feedback, college lists, scholarships, SAT practice and deadlines. Join the waitlist."
   - The `site.webmanifest` description matches.
   - Keep the 54-character title.
3. **Keep demo text out of snippets.** Add `data-nosnippet` to these illustration roots:
   - `.lp-hero-cards` (`sections/HeroCards.tsx`)
   - the composer (`sections/Hero.tsx:98`)
   - the stage figure (`sections/StageFigure.tsx`)
   - `cards/RosterSheet.tsx`

   The first ~250 crawlable words after the H1 are mockup fragments ("definately", fake roster names). The text stays in the DOM, so this isn't cloaking.
4. **Update `llms.txt` by hand.** Generating it is PR 2.
   - Apply the new DEFINITION and the new count.
   - Use markdown links (`- [Home](https://acceptra.ai/)`). Lighthouse's agentic audit fails on bare URLs.
   - Add a `## FAQ` block with the essay, data-source and data-sold answers, copied verbatim from `sections/faqQuestions.ts`.
   - Replace the `#waitlist` sign-up URL with "sign up at https://acceptra.ai (the Join waitlist button)".
5. **Shrink `og.png`** from 323 KB to under 200 KB with oxipng or pngquant, keeping the name. WhatsApp drops previews over about 300 KB.
6. **Put the marquee school names in the text.** In `sections/SchoolsMarquee.tsx:52-67`, build the `aria-label` from `TILES` ("Including Harvard, MIT, …"). Today it reads "including" followed by nothing.
7. **`_headers`:**
   - `X-Robots-Tag: noindex` on `/404` and `/404.html`, which currently return 200
   - `X-Frame-Options: DENY`, because `frame-ancestors` is ignored in Report-Only
   - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
8. **Landmarks** (`LandingPage.tsx`). Today the site `<header>` renders last inside `<section aria-label="Acceptra">`. Move it to be the first child of `.lp-canvas`, before that section, so it becomes the `banner` landmark. The nav is `position: fixed`, so nothing moves visually. `<main>` then starts at the hero section, so the H1 is inside it, and the skip link targets the hero.
9. **Numeric plan prices.** `sections/plans.ts` gains `amount: number` and `period: "month" | "year" | null`, and the display strings render from them. `StructuredData.tsx:15-22` stops regex-parsing display strings for the offers.
10. **Single-source fixes.** `Hero.tsx:68`, `Pricing.tsx:17` and `Schools.tsx:54` import `WAITLIST_HREF` and `SCHOOLS_HREF`. The footer `mailto:` (`Footer.tsx:16`) uses `CONTACT_EMAIL`.

### Phase 5: Conversion UX and a11y

1. **An instant first dialog open.** Today, on a throttled phone, the first open takes 1,023 ms with no feedback. Warm `import("./waitlist/WaitlistDialog")` on the first `pointerenter`, `touchstart` or `focusin` of any `a[href^="#waitlist"]`, and again on idle after load.
2. **The dialog focus trap.**
   - While the dialog is open, set `inert` on `.lp-skip` and `.lp-canvas`. The dialog portals into the `.lp` root, a sibling of `.lp-canvas`, so the dialog itself stays interactive.
   - Remove `inert` **synchronously when `open` becomes false**, before Base UI restores focus.
   - Confirm `aria-modal` is set.

   *Acceptance* at 390 and 1440: Tab and Shift+Tab cycle only through the dialog's controls, and focus returns to the trigger on close.
3. **No stage height jump.** At 1440 and 1366, the stage is 468px on the first tab and 447px on the others, a 21px CLS on every autoplay loop. `sections/FeaturesStage.tsx` renders **every** blurb (today only the active one renders) in the same grid cell (`grid-area: 1 / 1`), with the inactive ones `visibility: hidden` and `aria-hidden`. The cell then sizes to the tallest blurb, with no JS measurement and no pixel constant.
4. **Touch targets.** Grow the box itself: the e2e test checks `boundingBox().height >= 44`, and an `::after` hit area doesn't change that.
   - Nav CTA at 320–390px (`responsive.css:403-411`): `padding: 6px 6px 6px 16px`, which gives 44px. The brand link (about 43px) gets the same treatment.
   - Compare picker (`compare.css:198`): `min-height` from 40px to 44px.
5. **World map**, only if D-1 keeps the testimonials: re-export it at 2080px wide, with `srcset` and `sizes`.

### Phase 6: Pure deletions (zero behaviour change)

1. **Dead CSS**, verified by grepping 415 class names against the TSX, TS and HTML:
   - `cards/colleges/colleges.css:14-51`: `.lp-cx-tier*`, `.lp-cx-logo`, `.lp-cx-muted`
   - `landing.css:143-144`: `.lp-tier`, `.lp-today-pill`
   - `--lp-screen` (`landing.css:92`, `responsive.css:6`)
   - `--lp-duration-entrance` (`landing.css:36`)
2. **Dead and duplicate assets.**
   - Delete `assets/deadline-logo-umich.png`, `fact-acceptance.svg`, `fact-cost.svg`, `fact-gpa.svg` and `world-map-mask.svg`.
   - Keep one of each byte-identical logo (`essay-logo-umich.png` = `row-logo-umich.png`, and `deadline-logo-harvard.png` = `row-logo-harvard.png`), and update every file that imports them. Find them with `grep -rl "logo-umich\|logo-harvard" src/features/landing`.
   - `public-landing/logo.png` duplicates `icon-512.png`. Point `StructuredData.tsx:51` at `/icon-512.png`, delete `logo.png`, and replace `/logo.png` in `verify-landing.sh:82` and in DEPLOY.md's file list.
3. **Lint config.** Add `dist-landing`, `.wrangler` and `coverage` to ESLint `globalIgnores`.
4. **knip config** (not a gate in PR 1).
   - Entries: `src/features/landing/main.tsx`, `src/features/landing/entry-server.tsx`, `functions/**/*.ts` and `scripts/*.mjs`.
   - Add `functions/**/*.ts` to `project`.
   - Add `ignoreDependencies`, each with a reason, for the three fontsource packages imported from CSS, and for `@cloudflare/workers-types` if knip flags it.
   - Add `"preview:landing": "wrangler pages dev dist-landing"` to package.json, and use it in DEPLOY.md.
   - Fix what knip then reports under the landing.

### Phase 7: Tests and verification

1. **Fix the three stale e2e tests** (`e2e/landing-motion.spec.ts:82,145,192`). They assume the essay tab is the default, but sessions is `FEATURES[0]`: select the essay tab first, or assert on the visible sheet. The other two failures are the real bugs fixed in 5.3 and 5.4. *Gate:* `npx playwright test -c playwright.landing.config.ts` passes 19/19.
2. **Analytics unit tests.** Analytics is off on every host except production, so these are the only pre-merge evidence for behaviours 2, 4, 6 and 9. Add `src/features/landing/analytics.test.ts`, which does `vi.mock("posthog-js")` and stubs `location.hostname`. It asserts that:
   - init is skipped on `localhost` and `x.pages.dev`
   - on `acceptra.ai`, init runs with `api_host: "/ingest"`, `persistence: "memory"` and `disable_session_recording: true`
   - a successful footer submit calls `capture("waitlist_joined", { side: "me", source: "footer" })`
   - a 503 calls `capture("waitlist_failed", { side, source, step: "join", status: 503 })`, with no `email` key
3. **Extend `verify-landing.sh`.**
   - The landing chunk contains `"/ingest"` and not `us.i.posthog.com`.
   - `POST /api/waitlist` with `-H "Origin: $BASE" -H "Content-Type: application/json"` and `{"email":"x@check.invalid","side":"me","source":"<img>"}` returns 400. So does a valid source with the email `a\u202eb@check.invalid`. The same request without `Origin` returns 403.
   - `llms.txt` contains "AI college admissions counselor" and "2,200+".
   - `X-Frame-Options` is present.
   - **When `PAGES_DEV_URL` is set:** a `POST $PAGES_DEV_URL/api/waitlist` with `Origin: $PAGES_DEV_URL` and a valid body returns **403**. The Origin matches, so the 403 can only come from the host check.
   - **Production only:** `GET /ingest/array/$KEY/config` returns 200 JSON, where `KEY=$(grep -o 'phc_[A-Za-z0-9]*' dist-landing/assets/landing-*.js | head -1)`.
   - The `acceptra.com` check is gated behind `CHECK_COM=1`.
   - The script is for production or local use only. Don't run it against a preview, where its 400 check correctly returns 403.
4. **Every gate green on the final tree:**
   - the phase gate
   - `npm run build:landing` with **no warnings**
   - e2e 19/19
   - `npm run preview:landing` + `verify-landing.sh http://localhost:8788`
   - axe with 0 violations outside the `aria-hidden` illustrations
   - `npx vitest run` for the whole suite (the known `TasksLayout.test.tsx` flake may need one rerun)
   - **Lighthouse mobile, median of 3, ≥ 89 locally.** Analytics is off locally, so this is an upper bound. The real baseline is PageSpeed Insights on production (§5.9.5), and PR 2's ≥ 90 gate uses it.
5. **Real-browser pass** (Playwright MCP, against `npm run preview:landing` on `localhost:8788`), at 320, 390, 768 and 1440:
   - one signup from each source (nav, plan, schools, footer, link), each producing a row in local D1, plus one visit to `/?ref=producthunt#waitlist` that stores `utm_source='producthunt'`
   - a footer submit with an invalid email and a forced 500 (route interception); each shows an announced `role="alert"`
   - the trap is hidden on a cold load, and the nav's z-index is 30
   - the dialog's Tab loop is clean
   - behaviour 15 measured here
   - the page is complete with JS off
   - **no Report-Only CSP violations in the console on `/`, `/privacy` or `/terms`.** This is PR 2's evidence for enforcing the CSP.

### Phase 8: Docs

1. **`docs/DEPLOY.md` § The public landing site.**

   *Fixes:*
   - "The Origin check still does" cover pages.dev is wrong; the host check from 2.7 does now.
   - Remove every env-var row, since there are none left.
   - "Change them there and in `llms.txt` together" becomes the hand-update rule, until PR 2 generates `llms.txt`.
   - Remove `logo.png` from the file list.
   - Mention `CHECK_COM=1` wherever `acceptra.com` is mentioned.

   *Additions:*
   - **Creating the Pages project:** name `acceptra`, Framework preset None, root directory `frontend`, build command `npm run build:landing`, output `dist-landing`, production branch `main`, build watch path `frontend/**`. The pages.dev subdomain may differ if `acceptra` is taken; use the real one as `PAGES_DEV_URL`.
   - The zone must be on Cloudflare before the custom domain can be added.
   - `www` is an `AAAA 100::` record, proxied, with the redirect rule from §5.6.
   - `_headers` don't apply to Functions.
   - Previews share the production D1, and the host check blocks preview writes.
   - **UTM conventions:**

     | Channel | utm_source | utm_medium | utm_campaign |
     |---|---|---|---|
     | Product Hunt | producthunt | launch | launch-2026-09 |
     | X | x | social | launch-2026-09 |
     | LinkedIn | linkedin | social | launch-2026-09 |
     | Reddit | reddit | social | launch-2026-09 |
     | Email / DM | email | direct | launch-2026-09 |

   - **Reading the list:** the headline funnel is `$pageview → waitlist_joined`, with the dialog funnel secondary. The ground truth per channel is `npx wrangler d1 execute acceptra-waitlist --remote --command "SELECT utm_source, count(*) FROM waitlist GROUP BY 1"`.
   - **Deleting a test row:** `npx wrangler d1 execute acceptra-waitlist --remote --command "DELETE FROM waitlist WHERE email = 'x@…'"`.
2. **TODOS.md, landing section:**
   - Replace the "five e2e tests fail, all pre-existing" entry with its resolution.
   - Update the Lighthouse line: the measured 89 mobile and 100 desktop, and that production PSI is now the baseline.
   - Add every item in §8 below, plus PR 2 if it slips.
3. **AGENTS.md:** a one-sentence status line for this launch pass. The three landing plans graduate to `specs/landing/` only after owner acceptance.

### PR 1 commit series

Conventional commits, staged file by file:
1. `chore(landing): commit the Pages backend (functions, D1 migration, wrangler config)`: the Phase 1.4 set.
2. `fix(landing): signups can't silently fail`: Phase 2.
3. `fix(landing): storage-free PostHog, production-only, footer and failure events`: Phase 3.
4. `feat(landing): SEO, honesty and security-header fixes for launch`: Phase 4, **after D-1 is answered**.
5. `fix(landing): instant dialog, focus trap, stable stage, 44px targets`: Phase 5.
6. `refactor(landing): delete dead CSS and assets, configure knip`: Phase 6.
7. `test(landing): fix stale e2e specs, add analytics tests, extend verify-landing`: Phase 7.1–7.3.
8. `docs(landing): deploy runbook, UTM conventions, TODOS`: Phase 8.
9. `chore(landing): bind the production D1 database`. When the owner sends the id (§5.2.2), replace the placeholder, re-run `npx wrangler d1 migrations apply acceptra-waitlist --local` and the upsert check (wrangler keys local D1 by `database_id`, so local state starts empty under the new id), then do Phase 7.4–7.5. *Hard gate before merge:* `! grep -q REPLACE_WITH wrangler.toml`.

The PR goes from `feat/landing-seo` to `main`, with these sections: Summary, Approach, Test plan (the §4 behaviour list as a checklist), No breaking changes, and the §1 decision record.

## 3. PR 2: cleanliness (starts after §5.7 passes; target today)

This branch comes off `main` after PR 1 merges. It passes the same gates, plus two more:
- **knip landing-clean:** `npx knip --include files,exports,dependencies` reports nothing under `src/features/landing`, `functions` or `scripts/*landing*`.
- **PSI mobile ≥ 90 on production** after its deploy, against the §5.9.5 baseline.

1. **Generate `llms.txt`** in `prerender-landing.mjs` from `brand.ts`, `sections/plans.ts` and `sections/faqQuestions.ts`, exported through `entry-server.tsx`, which the prerender already builds and imports. Delete `public-landing/llms.txt` and DEPLOY.md's hand-update rule.
2. **Performance to ≥ 90:**
   - Inline the landing CSS in `prerender-landing.mjs`. It is 15 kB gzipped and the only render-blocking request, and `style-src 'unsafe-inline'` is already allowed.
   - Add a size-matched Inter fallback `@font-face` (`size-adjust` / `ascent-override`).
   - Drop Instrument Sans from the landing: `.lp-composer-text` (`hero.css:488`) switches to Inter, and the `landing.css:3` import and `--lp-font-request` go. The app keeps its own import.
   - Update DESIGN.md §22 to describe the code: the fonts, the shadows actually used, and that it reflows rather than scales.
3. **Flatten `cards/colleges/`** (5 files) into `cards/AskSheet.tsx`, `cards/ask-sheet.css` and `cards/AskSheet.demo.ts`, which takes `playAsk` from `demos.ts`.
   - Keep `{ id, name, logo, tier, why }`, and delete the unread `reason`, `chances` and `fit`. (`reason` also contradicts `WHY`: "$18k" against "about $19k".)
   - Replace the labels with `Record<Tier, string>`.
   - Update the imports in `useIllustrationMotion.ts`, `useIllustrationMotion.test.tsx` and `sections/featureList.tsx`.
4. **Move `playEssaySequence`** (`useLandingMotion.ts:4-103`) into an `essay(seq)` sequence built on `Sequence.push`, beside the other sequences in `useIllustrationMotion.ts`. Delete `runner`, `Run` and the unreachable `reduced` branch.
5. **Shared motion primitives.** `landing/hooks.ts` exports `useMediaQuery`, `useDocumentHidden` and `useInView`, used by `FeaturesStage`, `useComposerTypewriter`, `useLandingMotion`, `useRosterMotion` and `WaitlistDialog`.
6. **Split `FeaturesStage`** (293 lines, complexity 17).
   - Replace `pausedChoice`, `explicitPlay` and `userPaused` with one state: `auto | userPaused | userPlaying`.
   - Extract the tab list and the playback button.
   - Split the logic-bearing components over 50 lines: `EmailField`, `ForMe`, `WaitlistPopup` and `StageFigure`. Leave pure-markup sheets alone.
7. **One source per fact, the rest.**
   - The mentor-call numbers go into `brand.ts`, and the three sentences interpolate them.
   - The easing literals (`waitlist.css:9,329-331,385,390,713`, `hero.css:500`) become `--lp-ease-*` tokens.
   - The hero's `EssayCard` (`HeroCards.tsx:88`) becomes `HeroEssayCard`.
   - The `main.tsx:21-23` comment says what the code does.
8. **The upsert check becomes a test.** `src/features/landing/waitlist/upsert.test.ts` starts with `// @vitest-environment node`. It runs the real exported `UPSERT` from `functions/api/waitlist.ts` against `node:sqlite` (Node ≥ 22.13) and covers the same five cases.
   - It lives outside `functions/`, because that folder is typechecked with Workers types only.
   - Delete `migrations-landing/checks/check_upsert.sql`, and point DEPLOY.md's integrity-check block at the test.
9. **Enforce the CSP.** `Content-Security-Policy-Report-Only` becomes `Content-Security-Policy`, backed by the clean console evidence from 7.5. Re-verify all three pages under `preview:landing`, and again on production.

**Dropped:** moving per-card choreography into separate files. `useIllustrationMotion.ts` is 544 lines, under the 800 cap.

## 4. Behaviour list (the PR 1 test plan)

1. On a cold load at 390 and 1440:
   - the footer email field isn't truncated
   - the honeypot is clipped, out of the tab order and `aria-hidden`
   - `.lp-nav` computes `z-index: 30`
2. A footer signup stores a D1 row with `source='footer'` (7.5), and fires `waitlist_joined {source:"footer"}` (unit-tested in 7.2, confirmed live in §5.7.3).
3. An invalid footer email shows a `role="alert"` message, and a 500 shows an announced error (7.5, with the 500 forced through Playwright route interception).
4. A production build with **no env vars at all** posts to `/api/waitlist` (7.3 and 7.5) and sends analytics to `/ingest` (7.2 and 7.3; confirmed live in §5.7.3).
5. Analytics never starts on any host other than `acceptra.ai` (7.2).
6. PostHog writes no cookie, localStorage or sessionStorage, and records no replay (7.2; confirmed live in §5.7.4).
7. `POST /api/waitlist` with `source:"<img>"`, or with an email containing U+202E, returns 400. Without `Origin` it returns 403 (7.3 covers both cases).
8. A `POST` to the preview's `/api/waitlist` with a matching `Origin` returns 403 and writes no row (7.3 with `PAGES_DEV_URL`, and §5.4).
9. A failed signup fires `waitlist_failed` with its step and status and no email (7.2).
10. A visit tagged `?ref=producthunt` stores `utm_source='producthunt'` on its D1 row (7.5, the real-browser pass).
11. The prerendered HTML contains "AI college admissions counselor" and "2,200+", and contains no testimonial names if D-1 removes them.
12. The feature stage's height stays constant across every tab at 1366 and 1440 (e2e).
13. At 390px, the nav CTA and the compare picker are at least 44px tall by `boundingBox` (e2e).
14. With the dialog open, Tab and Shift+Tab cycle only through its controls, and focus returns to the trigger when it closes.
15. After a hover, the first dialog open takes under 100 ms, measured on `preview:landing` from click to `[role=dialog]` being visible, with the chunk request already complete.
16. Lighthouse mobile median ≥ 89 locally, SEO 100, CLS 0. Production PSI is recorded as the baseline.
17. There are no Report-Only CSP violations on the three pages.

## 5. Go-live runbook (owner)

**Step 1 starts now**, because `.ai` delegation can take hours. Steps 2 and 3 must be done before PR 1 merges. Step 4 contains the merge.

1. **Move acceptra.ai to Cloudflare without breaking email.**
   1. At Spaceship, turn **DNSSEC off** and wait out the 3600 s TTL. Before switching nameservers, `dig +short DS acceptra.ai @1.1.1.1` must return nothing.
   2. Add the zone in Cloudflare and **re-create these records by hand**: `MX 1 smtp.google.com`, the SPF TXT, the `google-site-verification` TXT (it keeps Search Console verified), the `google._domainkey` DKIM TXT with the full key, and `_dmarc`.
   3. Switch the nameservers at Spaceship, then wait for Cloudflare to mark the zone **Active**.
   4. Re-enable DNSSEC in Cloudflare and paste the new DS record at Spaceship.
2. **Cloudflare account.**
   1. Upgrade to Workers Paid (D-5).
   2. Run `cd frontend && npx wrangler login && npx wrangler d1 create acceptra-waitlist`. If `d1 create` offers to add the binding to `wrangler.toml`, answer **no**: the binding already exists, and a second one would duplicate it. Send the id for commit 9.
   3. **Only from a checkout that contains Phase 2.5 and commit 9.** `0001` can't be edited after it runs remotely, and wrangler sends the placeholder `database_id` to the API as is, so both this command and the next fail until the real id is committed. The engineer pushes commit 9 first. Then run `npx wrangler d1 migrations apply acceptra-waitlist --remote`.
   4. Check it with `npx wrangler d1 execute acceptra-waitlist --remote --command "PRAGMA table_info(waitlist)"`.
3. **PostHog.**
   1. Turn session replay off.
   2. Turn on **Discard client IP data**. The privacy wording depends on it.
   3. In the internal/test filter, add `Host` **equals** `acceptra.ai`. These filters are keep-conditions. Make it the default.
   4. Set the web analytics domain to `https://acceptra.ai`.
   5. Set billing caps.
   6. Create the insights and the `waitlist_failed` alert from step 10 now, so they exist before any traffic arrives.
4. **Pages project and merge.**
   1. Create the project with the Git settings in Phase 8.1. Its first build of `main` fails until PR 1 merges, which is harmless. A new Git-integrated project builds only `main`, so push `feat/landing-seo` again to create its preview; if nothing is pending, push an empty commit (`git commit --allow-empty -m "chore: trigger preview"`).
   2. Manually check the `feat/landing-seo` preview:
      - the page, `/privacy`, `/terms` and a 404 load
      - the headers are right (`curl -I`)
      - the redirects work
      - a signup shows the generic error, with a **403** on `/api/waitlist` in DevTools → Network
      - with `npm run build:landing && npm run preview:landing` running locally, `PAGES_DEV_URL=<preview> scripts/verify-landing.sh http://localhost:8788` passes, including its preview probe
   3. Merge PR 1.
   4. Confirm the production build log has no warnings, and that Settings → Bindings shows `DB → acceptra-waitlist`.
5. **Zone settings, before the custom domain is attached:**
   - Always Use HTTPS: on. Automatic HTTPS Rewrites: on.
   - Email Address Obfuscation: **off**. It rewrites every `mailto:` and breaks hydration.
   - Rocket Loader: **off**. No HTML-rewriting features (Mirage, Zaraz).
   - AI Crawl Control: allow training, search and agents. Managed robots.txt: **off**.
   - **Bot Fight Mode: off.** It sets a `__cf_bm` cookie on every visitor, which would make the privacy policy untrue. Turn "Block AI bots" and JS detections off too.
   - Security level and Browser Integrity Check must not challenge `/` or verified bots.
   - Crawler Hints: on.
   - WAF rate limit: URI path equals `/api/waitlist`, keyed by IP, 10 requests per 10 s, block for 10 s.
6. **Domain.**
   1. Add `acceptra.ai` as the Pages custom domain, and wait until its certificate is Active.
   2. Add `www` as an `AAAA 100::` record, proxied.
   3. Add a Single Redirect with a wildcard pattern: request URL `*://www.acceptra.ai/*` → `https://acceptra.ai/${2}`, status 301, preserve query string.
7. **Verify production.** This is the go/no-go gate: **nothing is announced until it passes**. pages.dev has analytics off and noindex by design.
   1. Run `PAGES_DEV_URL=https://<real-subdomain>.pages.dev scripts/verify-landing.sh https://acceptra.ai`.
   2. Make one real signup through the footer and one through the dialog. Read both rows back with `wrangler d1 execute --remote`, then delete them (the command is in DEPLOY.md).
   3. In PostHog Activity, confirm `$pageview`, `waitlist_joined {source:"footer"}` and `waitlist_joined {source:"nav"}` arrive through `acceptra.ai/ingest` **with a country**. This is the proxy's first live test (it can't run locally because of IPv6), and the country proves the visitor IP gets through.
   4. With DevTools open, confirm no cookie and no storage is written on `acceptra.ai`.
8. **Monitoring before announcing:**
   - a free external uptime check on `/` and `/privacy`
   - the `waitlist_failed` alert from step 3.6
   - `npx wrangler pages deployment tail --project-name acceptra`, left open for the first hour
   - Workers & Pages → Usage, watched all day
   - the D1 row count, run hourly
9. **Indexing.**
   1. Search Console: submit `sitemap.xml`. For `/`, `/privacy` and `/terms`, run URL Inspection → Test live URL → Request indexing. Check Manual actions and Security issues.
   2. Bing Webmaster Tools: import from Search Console, submit the sitemap, and submit `/`.
   3. Submit to Brave.
   4. Run the Rich Results Test and validator.schema.org, and check real WhatsApp, iMessage and LinkedIn share previews.
   5. Run **PageSpeed Insights mobile** and record the score in TODOS as PR 2's baseline.
10. **PostHog insights** (created in step 3.6):
    - `waitlist_joined` broken down by `source` and `side`
    - the funnel `$pageview → waitlist_joined`, broken down by the event property `utm_source` and by `$referring_domain`. `$initial_*` is always empty on personless events.
    - the dialog funnel `$pageview → waitlist_opened → waitlist_joined → waitlist_details`
    - a `waitlist_failed` trend with an alert
    - a pinned Web Analytics dashboard
11. **Rollback.** Go to Pages → Deployments, pick the previous production deployment, and choose Rollback. It is instant and needs no rebuild. `0001` only adds a table, so rolling back never needs a schema change. If signups fail, roll back first and investigate second.
12. **Other owner items:**
    - Make sure the Google appointment schedule has open slots from launch day onward. Every visible September date currently shows as struck through.
    - Claim the social handles, then fill in `PROFILES`, `FOUNDERS` and `twitter:site`.
    - Buy `acceptra.com` and 301 it.
    - Check acceptra.ai on the Wayback Machine for a previous owner.

## 6. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Switching nameservers while the DS record is still live sends the site and email dark (SERVFAIL) | Medium | High | §5.1: DNSSEC off, then `dig` for DS returns nothing, then re-create the mail records, then switch |
| `.ai` delegation is slow, and the apex isn't live today | Medium | High | Start §5.1 first. The §5.7 go/no-go gate means nothing is announced on pages.dev |
| The remote migration runs before Phase 2.5 tightens `0001` | Medium | Medium | Gated in §5.2.3. If it already ran, add a `0002` migration instead of editing `0001` |
| The proxy loses the visitor IP, so no country and GeoIP resolves to Cloudflare | Low | Medium | The `X-Forwarded-For` line is kept (3.7). §5.7.3 checks that the country shows up |
| The live `/ingest` proxy fails (it was untestable locally because of IPv6) | Medium | Medium | §5.7.3 plus the verify-landing config probe. If it fails, only analytics is lost; the page and signups keep working |
| A spike or flood exhausts the Functions quota | Low (after D-5) | High | Workers Paid, the host check (2.7), and the WAF rule on the apex. Turnstile is queued in TODOS |
| Removing testimonials leaves a gap in the page rhythm | Low | Low | Visual check at 6 widths in 7.5 |
| A PR 2 refactor causes a visual regression | Medium | Medium | PR 2 ships after launch, behind every gate plus e2e and the browser pass. Roll back via §5.11 |

## 7. File change manifest (PR 1)

**Committed as-is in commit 1 (currently untracked or modified):**
- `frontend/functions/` (`api/waitlist.ts`, `ingest/[[path]].ts`, `tsconfig.json`)
- `frontend/migrations-landing/` (`0001_waitlist.sql`, `checks/check_upsert.sql`)
- `frontend/public-landing/_routes.json`, `frontend/wrangler.toml`
- `frontend/tsconfig.json`, `frontend/package.json`, `package-lock.json`, `.gitignore`
- `plans/landing-backend-plan.md`
- plus the modified `_headers`, `prerender-landing.mjs`, `waitlist.ts`, `privacy.html`, `DEPLOY.md` and `AGENTS.md`

**Deleted:**
- `frontend/.el.mjs`, `.sweep.mjs`, `.tabs.mjs`
- `assets/deadline-logo-umich.png`, `fact-acceptance.svg`, `fact-cost.svg`, `fact-gpa.svg`, `world-map-mask.svg`, and one of each duplicate umich and harvard logo
- `public-landing/logo.png`
- If D-1 removes the testimonials: `sections/Testimonials.tsx`, `sections/testimonials.css`, `assets/world-map.avif` and `assets/avatar-{daniel,maya,priya}.webp`

**Moved out of the repo:** the two `docs/research/*.pdf` files, and `animation-plans/` (to `plans/.local/`).

**Created:**
- `src/features/landing/waitlist/contract.ts`
- `src/features/landing/analytics.test.ts`
- `frontend/.nvmrc`
- `plans/landing-launch-plan.md`

**Modified:**
- Waitlist and analytics: `analytics.ts`, `brand.ts`, `StructuredData.tsx`, `LandingPage.tsx`, `useLandingMotion.ts` (only if D-1 removes the testimonials), `waitlist/waitlist.ts`, `waitlist/EmailField.tsx`, `waitlist/ForMe.tsx`, `waitlist/WaitlistDialog.tsx`, `waitlist/useWaitlistDialog.ts`, `waitlist/LegalConsent.tsx`, `waitlist/waitlist.css`
- Sections: `sections/Footer.tsx`, `sections/Hero.tsx`, `sections/HeroCards.tsx`, `sections/SchoolsMarquee.tsx`, `sections/Pricing.tsx`, `sections/Schools.tsx`, `sections/StageFigure.tsx`, `sections/FeaturesStage.tsx`, `sections/plans.ts`, `sections/features-stage.css`, `sections/compare.css`
- Other components and styles: `cards/RosterSheet.tsx`, the files importing the deduplicated logos, `landing.css`, `responsive.css`
- Pages and scripts: `landing.html`, `privacy.html`, `scripts/prerender-landing.mjs`, `scripts/verify-landing.sh`
- Public files: `public-landing/_headers`, `llms.txt`, `sitemap.xml`, `site.webmanifest`, `og.png`
- Backend: `functions/api/waitlist.ts`, `functions/ingest/[[path]].ts`, `migrations-landing/0001_waitlist.sql`
- Config: `wrangler.toml`, `knip.json`, `eslint.config.js`, `package.json`
- Tests: `e2e/landing-motion.spec.ts`
- Docs: `docs/DEPLOY.md`, `TODOS.md`, `AGENTS.md`

## 8. Deferred (recorded in TODOS, not done in either PR)

- Turnstile on the waitlist.
- A separate preview D1, only needed if preview signups must work.
- Merging Geist and Inter (a design call).
- A designed square icon.
- Founders and profiles content.
- The app build's `LandingPage` endpoint (B6).
- Optional analytics events (`faq_opened`, `section_viewed`).
- Stream-limiting chunked request bodies.
- `worker-src` and the toolbar origin, if replay or the toolbar is ever enabled under the enforced CSP.
- posthog-js `module.slim`, and `advanced_disable_feature_flags_on_first_load`.
- Pausing the typewriter and marquee off screen, and moving the composer animation off `background-color`.
- WebP for three PNG logo tiles.
- A `<details>` FAQ for no-JS.
- A server-side honeypot check.
- Spreadsheet-safe CSV export.
- Contrast in the decorative illustrations.
- Trimming the 40 kB of inline SVG data URIs.
- The 37px "Skip to content" link (accepted: it is a keyboard target, not a touch target).
