# Landing page SEO: launch plan

**Status:** draft for owner review, 2026-09-28. Nothing below is built yet.

**Review:** two independent SEO reviews ran on 2026-09-28, one technical and one on strategy and AI search. Their verified findings are folded in. Each reviewer checked the codebase, Vite 8.1.3's source, and Cloudflare's and Google's official docs.

**Scope:** everything worth doing for the landing-only deploy at `acceptra.ai`: one page, the waitlist, and Privacy/Terms. The app, school pages and a content hub come later (§16).

**Sources read:**
- the frontend: `frontend/landing.html`, `privacy.html`, `terms.html`, `vite.config.ts`, `public/`, and `src/features/landing/**`
- the FastAPI routing in `api/main.py` (`_install_spa_routes`)
- `docs/DEPLOY.md` and `plans/sat-practice/`
- live searches, linked in §17

---

## 0. What winning looks like right now

A brand-new domain with one page and no links will very likely not reach page 1 for "AI college counselor" within six months. No tag changes that. Five things *are* winnable, and every task below serves at least one:

1. **Own the brand search.** "Acceptra AI" and "Acceptra college counselor" should show us at #1, with the site name "Acceptra" (not the bare domain), our favicon and sitelinks.
   - The bare word is crowded:
     - *Acceptra Plus* and *ACCEPTRA-MR* are Indian pharmaceutical products.
     - *Acceptera* is a well-known 1931 Swedish architecture manifesto with a Wikipedia article, and also a typeface. Google may answer "Acceptra" with "did you mean Acceptera".
   - Our entity work (§5 and §10.3) is what separates the brand from these.
   - `acceptra.com` is for sale (D8).
   - Watch the near-name competitors *Counselly* and *Counsely* for brand confusion.
2. **Two long-tail commercial terms, over months:** "AI college counselor" and "AI college admissions counselor".
   - These results currently belong to Kollegio, KapAdvisor (Kaplan), Counselly, Counsely, CollegeVine Sage and DreamCollege.AI, plus roundup lists.
   - "Free AI college counselor" is deliberately **not** a pre-launch target. Every result for it is a tool you can use today, so someone landing on a waitlist leaves straight away. It moves to §16.
3. **Get named by AI answer engines.** ChatGPT, Perplexity, Claude, Gemini and AI Overviews, Copilot, and Siri/Apple Intelligence should name Acceptra when asked about AI college counselors. That needs:
   - crawlers that can read the page (most don't run JavaScript, and today they get an empty page, §3)
   - one quotable, true definition (§4.8)
   - third-party mentions (§10)
4. **Clean indexing:** exactly `/`, `/privacy` and `/terms` indexed. No junk pages, soft 404s, duplicates or indexed preview deploys.
5. **Good link previews:** every share renders a real card. Today, none do.

## 1. Copy changes that affect search

The page describes the product as it will be at launch. That's normal for a waitlist, and the plan doesn't change it. Only two copy changes matter for search:

1. **School count: 2,700+.** `SchoolsMarquee.tsx` says "Matched against 400+ schools". Change it to **"Matched against 2,700+ schools"**, and use 2,700+ everywhere the count appears: the "What is Acceptra?" answer, `llms.txt`, the profile descriptions and the structured data. AI engines repeat whichever number they read, so there should only be one.
2. **Testimonials (D1).** The section is off at launch, and so is its footer link (`Footer.tsx`, `Testimonials → #testimonials-heading`), otherwise that link points at nothing. Turn both back on when the real quotes arrive. Testimonials never get `Review` or `AggregateRating` markup.

## 2. Owner decisions

| # | Decision | Recommendation |
|---|---|---|
| D1 | Testimonials | Off at launch, with the footer link. On when the quotes are real and the students have consented. |
| D2 | Host | **Cloudflare Pages** (static). The page is fully static: the waitlist posts to `VITE_WAITLIST_ENDPOINT` and analytics goes to PostHog. Pages gives a CDN, HTTP/3, Brotli, `_headers`/`_redirects` and clean URLs for free, and keeps the marketing page independent of a backend that isn't launching. If you choose Render/FastAPI, follow §3B instead. |
| D3 | Canonical host | **`https://acceptra.ai`**, with `www`, `http` and `.com` all redirecting to it. Choose once and never change it. |
| D4 | The design-comparison variants (`?features=cards/bento/canvas`, `?colleges=<id>`, `?colleges=compare`) | **Commit them first, then delete them in a separate commit** (§4.4). They read `window.location` during render, which breaks prerendering. They also create duplicate URLs and ship JavaScript no visitor sees. |
| D5 | Logo mark | A **square Acceptra mark** from design. It replaces `counselle.svg`, which is currently used as the favicon **and** as the Acceptra logo in the Compare table. |
| D6 | Share image | **1200×630 PNG** exported from the Figma hero (`V66rN97MQiP3ezpNpLL7MD`). |
| D7 | AI crawlers | **Allow all of them** (§7.1). |
| D8 | `acceptra.com` | **Buy it and 301 it to `acceptra.ai`**, if the price is reasonable. |
| D9 | Copy additions (§5.8) | **Approve** a "What is Acceptra?" answer, a line naming the founders, and a data-use FAQ entry. |
| D10 | Trademark | **File a USPTO intent-to-use application for ACCEPTRA** (classes 9, 41 and 42) before any press push. The Indian drug marks are class 5 in another jurisdiction and probably don't block us, but owning the mark protects the brand and is required for most platforms' brand claims later. |

## 3A. Deploy shape: landing-only static build (D2 = Cloudflare Pages)

Today one Vite config builds four inputs (`app`, `landing`, `privacy`, `terms`) and copies all of `public/` into `dist/`. For a landing-only deploy that goes wrong in three ways:

- It ships the app bundle.
- It publishes design scratch files as crawlable pages: `palette-preview.html`, `palette-first-directions.html`, `preview-fonts/` and `onboarding/`.
- It names the page `landing.html` instead of serving it at the root.

1. **`frontend/vite.landing.config.ts`**
   - It **replaces** `build.rolldownOptions.input` with `{ landing, privacy, terms }`: spread the base config and set `input` outright.
   - Vite's `mergeConfig` deep-merges objects, so *extending* the base config would keep the `app` input and ship the 3.3 MB app bundle anyway.
   - Set `outDir: "dist-landing"` and `publicDir: "public-landing"`.
   - Add the script `"build:landing": "vite build -c vite.landing.config.ts && node scripts/prerender-landing.mjs"`.
2. **`frontend/public-landing/`** holds only what the site serves:
   - `robots.txt`, `sitemap.xml`, `llms.txt`, `404.html`
   - `_headers`, `_redirects`
   - `favicon.ico`, `icon.svg`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `site.webmanifest`
   - `og.png`, and `logo.png` (square, at least 112×112)
3. **The prerender step (§4) writes `dist-landing/index.html`** and deletes `landing.html`, so Pages serves the page at `/` without a rewrite.
4. **A `404.html` is required.** A Pages project without a top-level `404.html` is treated as a single-page app: every unknown path returns the homepage with a 200 status, which floods search engines with duplicate homepages. With a `404.html`, those paths return a real 404. Keep it simple: the brand, one line, and a link home.
5. **Clean URLs.** Pages serves `privacy.html` at `/privacy` and 308-redirects the `.html` form. Update **every** internal link:
   - `PRIVACY_URL`/`TERMS_URL` in `waitlist/LegalConsent.tsx`
   - the footer links in `privacy.html` (lines 157–158)
   - the body and footer links in `terms.html` (lines 114, 120–121)

   The Vite dev server doesn't serve `/privacy` (it falls back to the app shell). That only affects local dev, so it's acceptable.
6. **Signed-in redirect.** `landing/main.tsx` calls `fetch("/v1/me")` on every visit. With no API behind this host, that hits the 404 page each time. Build it out under a `VITE_LANDING_ONLY` flag, or drop it until the app ships.
7. **`_redirects`:** only `/landing.html  /  301`. Pages already turns `/index.html` into `/` with its own clean-URL redirect.
8. **Zone settings (Cloudflare dashboard, not files):**
   - A proxied DNS record for `www` (without one, the redirect rule never fires).
   - **One** Redirect Rule matching `www` on both `http` and `https` → `https://acceptra.ai`, so it takes one hop.
   - Always Use HTTPS on.
   - `acceptra.com` → `https://acceptra.ai` (D8).
   - **Email Address Obfuscation off.** It is on by default and rewrites every `mailto:hello@acceptra.ai` (nav, FAQ, footer, legal pages) into `/cdn-cgi/l/email-protection#…` plus an injected script. Crawlers then read "[email protected]", and the rewrite breaks hydration.
   - **Rocket Loader off.** It rewrites script tags.
   - AI Crawl Control and Crawler Hints: see §7.
9. **`_headers`:**
   ```
   /assets/*
     Cache-Control: public, max-age=31536000, immutable

   /*
     Strict-Transport-Security: max-age=31536000; includeSubDomains
     X-Content-Type-Options: nosniff
     Referrer-Policy: strict-origin-when-cross-origin
     Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self' https://us-assets.i.posthog.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://us.i.posthog.com <waitlist host>; frame-src https://calendar.google.com

   https://:project.pages.dev/*
     X-Robots-Tag: noindex
   https://:version.:project.pages.dev/*
     X-Robots-Tag: noindex
   ```
   - **Why Report-Only:** an enforced CSP that isn't exactly right breaks the page, and a broken page is what Googlebot would see. The prerendered HTML carries inline `style` attributes (for example `FeaturesStage` tab colours), `landing.html` has an inline `<style>`, and Vite inlines small assets as `data:` URIs. Enforce it only after a clean report period.
   - **Why the noindex rules:** Cloudflare already marks preview deploys `noindex`, but the production `*.pages.dev` alias is public and would be indexed as a duplicate of the real site.
   - Headers aren't a ranking factor. They're free hygiene.
10. **Keep these URLs when the app ships.** `/`, `/privacy` and `/terms` never move, whether Pages stays in front (proxying `/app` and `/v1`) or FastAPI takes over (§3B).

## 3B. Deploy shape if D2 = Render/FastAPI

`_install_spa_routes` in `api/main.py` serves `dist/landing.html` at `/`, and **requires** `landing.html` and `landing-workspace-preview.webp` at boot. Its catch-all returns the app shell (`index.html`) with a 200 for every other path. So on that host, `/privacy.html`, `/terms.html`, `/robots.txt`, `/sitemap.xml` and every mistyped URL return the app instead of themselves.

On this path:

- **Keep the prerendered output named `landing.html`.** In a shared `dist`, `index.html` is the app shell's name.
- Add routes for `/privacy`, `/terms`, `/robots.txt`, `/sitemap.xml`, `/favicon.ico`, `/site.webmanifest`, `/og.png` and `/logo.png`.
- 404 unknown paths outside `/app`.
- Set the §3A.9 headers in middleware.
- 301 `/landing.html` to `/`.

The rest of this plan applies unchanged.

## 4. Prerender the page (the biggest single win)

`landing.html` ships an empty `<div id="root"></div>`, and React builds the page in the browser:

- **Googlebot** renders JavaScript, but on a deferred second pass.
- **Bing** has limited rendering, and its index still feeds part of ChatGPT search, Copilot and DuckDuckGo.
- **OAI-SearchBot, GPTBot, ClaudeBot, Claude-SearchBot, PerplexityBot and Brave's crawler** read raw HTML and don't run JavaScript.

Today all of them see only the `<noscript>` block: one H1, one sentence and a mailto link. After this section, every crawler gets the full page in the first response.

The approach is Vite's documented SSR pre-render pattern: no framework change, no runtime server, a build step of about 40 lines. The technical review confirmed it works with this multi-page Vite 8 config. `--ssr <entry>` replaces the inputs, and asset hashing and inlining follow the same rules in the client and SSR builds, so asset URLs match.

1. **`src/features/landing/entry-server.tsx`**: `export const render = () => renderToString(<LandingPage />)`.
2. **`frontend/scripts/prerender-landing.mjs`**
   1. Run the SSR build through Vite's JS `build()` API: the landing config with `build.ssr` set to the entry, a temp `outDir`, and **`copyPublicDir: false`** (the SSR build copies `publicDir` by default).
   2. Import `render()` and inject its output into `<div id="root">` of `dist-landing/landing.html`.
   3. **Font preloads.** Find the hashed `inter-latin-wght-normal-*.woff2` and `instrument-serif-latin-400-italic-*.woff2` in `dist-landing/assets/`, and write `<link rel="preload" as="font" type="font/woff2" crossorigin>` for each into `<head>` (§8.1).
   4. **Fail the build** if any `/assets/…` URL in the rendered HTML doesn't exist in `dist-landing/`.
   5. Write the result as `index.html`, then delete `landing.html` and the temp directory.
3. **`main.tsx`:** swap `createRoot(...).render(...)` for `hydrateRoot(document.getElementById("root")!, <StrictMode><LandingPage /></StrictMode>)`. `initAnalytics()` and the `/v1/me` check stay in `main.tsx`, which the server entry never imports.
4. **Remove every browser read that happens during render.** The technical review confirmed these four are the only ones: every other `window`/`document` access is inside an effect or handler, the Base UI dialog portal renders nothing while closed, and there's no `lazy`/`Suspense`.

   | Where | Reads during render | Fix |
   |---|---|---|
   | `sections/Features.tsx` `readVariant()` | `window.location.search` | D4: delete the switch and render `FeaturesStage` directly |
   | `cards/colleges/variants.ts` (`COLLEGES_PARAM`, line 68) | `window.location.search` at module load | D4: delete the file. `featureList.tsx` imports `AskSheet` directly (size `"wide"`), and `useIllustrationMotion.ts` uses `playAsk` directly |
   | `sections/FeaturesStage.tsx` `paused` (lines 29–33) and `reduced`, `hidden` initialisers | `matchMedia` ×2, `document.hidden` | Start from fixed server-safe values. `reduced`/`hidden` already have an effect (lines 88–110). **`paused` has none**: add a mount effect, or use `useSyncExternalStore` with a `getServerSnapshot`. This matters because `paused` and `reduced` change the playback button's `aria-label` and whether it renders at all |
   | `waitlist/useWaitlistDialog.ts` `useState` initialiser | `window.location.hash` | Start `null`, and open from the hash inside the existing effect |

   **D4 deletion. First commit the current landing (84 of its files are untracked, so git can't restore them otherwise), then delete in a separate commit:**
   - **Layouts:** `sections/FeaturesBento.tsx`, `FeaturesCanvas.tsx`, `CollegesLab.tsx`, and their CSS (`features-bento.css`, `features-canvas.css`, `colleges-lab.css`).
   - **The `FeaturesCards` layout:** remove it from `Features.tsx` with its card-only imports, delete the `*Card` wrapper functions in `cards/*Card.tsx`, the `.lp-cards`/`.lp-card-*` rules in `features.css` and `responsive.css`, the `.lp-features-cards` entries in `REVEALS` (`useLandingMotion.ts:107-108`), the `.lp-card-essay` match (line 172), and the card fixtures in `useLandingMotion.test.tsx`.
   - **Colleges variants:** `cards/colleges/variants.ts`, `ColumnsSheet.tsx`, `WhySheet.tsx`, `MapSheet.tsx`, `FitCharts.tsx`, `Logo.tsx`, and `columns.css`, `why.css`, `map.css`.
   - **`cards/CollegesCard.tsx` and `cards/colleges-card.css`.**
   - **Dead code left behind:** `playColumns`/`playWhy`/`playMap` in `demos.ts`, the `PROFILE`/`FEATURED` exports in `data.ts` (keep `TIERS`, since `tierLabel` uses it), and the default `colleges` sequence in `useIllustrationMotion.ts`.
   - **Do not delete:** `playEssaySequence` (imported by `useIllustrationMotion.ts`) or any `*Sheet` export in `cards/*Card.tsx` (imported by `featureList.tsx`).
5. **Delete the `<noscript>` block** from `landing.html`. It would otherwise add a second H1 and duplicate text for crawlers.
6. **Make text read correctly as plain text.** Crawlers that don't lay out the page read raw text, and today words run together:

   | Where | Raw text today | Fix |
   |---|---|---|
   | H1 (`Hero.tsx:81-90`): flex items spaced by CSS `gap` | "AI Colleg**ecounselingFor** your nextChapter" | `{" "}` between the spans *and* between the two `.lp-headline-line` spans (flex ignores whitespace-only text, so nothing moves) |
   | `<br />` headings (Testimonials, FAQ) | "itwish", "familiesand" | A space before each `<br />` |
   | Footer tagline (`Footer.tsx:94-99`) | "counseling,without" | Add a space |
   | FAQ support line (`Faq.tsx:49-53`) | "usand" | Add a space |
   | Hero SAT card (`HeroCards.tsx:194-198`) | "36.Subtract" | Add a space |
7. **Make sure the content is in the HTML:**
   - FAQ answers are already in the markup, collapsed with `inert`/`aria-hidden`. Keep it that way.
   - Every `FEATURES` title and blurb is rendered inside the showcase tabs. Confirm all of them appear in the prerendered HTML.
   - The typewriter composer is decoration and doesn't need to be in the HTML.

## 5. Head, meta and on-page signals

**Keyword map.** One page, one intent: an AI college counselor, pre-launch waitlist.

| Role | Terms | Where it lives |
|---|---|---|
| Brand | Acceptra, Acceptra AI, Acceptra college counselor | title suffix, `og:site_name`, structured data, wordmark `alt`, the "What is Acceptra?" answer |
| Primary | AI college counselor / counseling (Google treats them as the same term) | title, H1, meta description |
| Secondary | AI college essay feedback; college list matched to you; scholarships; SAT practice; application deadlines; a real mentor | feature titles, meta description |
| Audience | students; parents; school counselors; school officials ("AI college counseling for high schools") | title, meta description, the definition, Schools section (item 9) |
| Modifiers | vs ChatGPT, vs private counselor | Compare table |

The copy already carries these terms. **Don't rewrite it for keywords.** The only copy changes are §1 and item 8.

1. **Title** (54 characters, keyword first, like every competitor in the results; "Students & Schools" names both sides of the audience and sets us apart from the grad-school and international players): `AI College Counselor for Students & Schools | Acceptra`
2. **Meta description** (156 characters, all four audiences plus the waitlist call to action): `AI college counselor for students, parents and schools: essay feedback, college lists, scholarships, SAT practice and deadlines. Join the Acceptra waitlist.`
3. **Canonical:** `<link rel="canonical" href="https://acceptra.ai/">`, and the same on `/privacy` and `/terms` with their own URLs. This also collapses `?utm_…` query variants into the one URL.
4. **Open Graph and Twitter:**
   - `og:type=website`, `og:site_name=Acceptra`, `og:locale=en_US`, `og:url`, `og:title`, `og:description`
   - `og:image=https://acceptra.ai/og.png`, with `og:image:width=1200`, `og:image:height=630` and `og:image:alt`
   - `twitter:card=summary_large_image`, plus `twitter:site` once the X handle exists

   Use absolute URLs.
5. **Icons**, all from the D5 mark:
   - `<link rel="icon">` in the homepage `<head>` pointing to a square icon that Googlebot-Image can crawl. Google requires at least 8×8 and recommends larger than 48×48.
   - `/favicon.ico` (48×48), `icon.svg`, a 180×180 `apple-touch-icon.png`, and `site.webmanifest` (name, `short_name`, 192/512 icons, `theme_color #f7fbf9`, `background_color`).
   - Replace `counselle.svg` in the Compare table too.
6. **The brand name as text.** Both wordmarks are outlined SVGs with `alt=""` inside links named with `aria-label="Acceptra home"`. Set `alt="Acceptra"` on the images and drop the `aria-label`.
7. **Headings.**
   - One H1, and H2s for Features, Compare, Pricing, Schools and FAQ (Testimonials returns with D1).
   - The feature H3s sit inside `<button role="tab">` (`FeaturesStage.tsx:199-222`). A heading inside a button is invalid HTML, and screen readers treat tab contents as presentational. Google still reads the text, so this is minor, but render the titles as plain text in the tab and don't count them as headings.
8. **Copy additions (D9), true statements only:**
   - **"What is Acceptra?" as the first FAQ entry:** what it is (an AI college counselor), who it's for (students, parents, school counselors and school officials), what it does, that it checks against 2,700+ schools, and that it opens soon (join the waitlist). Search snippets and AI answers lift self-contained sentences like this almost word for word, and today no sentence on the page defines the brand.
   - **"Is my data sold or used to train AI?"** Parents and counselors ask this first. Answer it only with what `privacy.html` already commits to ("we do not sell your personal information"). Say nothing about model training that the policy doesn't state.
   - **Who is behind it:** one line naming the founders, linked to their LinkedIn profiles, and the same people in `Organization.founder`. For a high-stakes family decision this is a trust and conversion signal. It isn't a direct ranking factor, and the plan doesn't claim it is.
   - **Reword the Common App answer.** "It works alongside them" dodges the question. State the rule plainly: applications must be the student's own work, and Acceptra suggests but never writes.
9. **Schools section:** the H2 "Know which students need you this week" has no descriptive term. Use "school counselors" and "AI college counseling for high schools" naturally in the section's copy, so the school-side audience (counselors and officials) has words to match.
10. **Footer anchors:** "Features +" and "Technology" both point to `#features`. Give each a distinct label and target, or remove the duplicate. Hide "Testimonials" with D1.
11. **`/privacy` and `/terms`:** add canonical, `og:*` and the icon set. Both already link home. Keep them indexable: they're thin, but they exist for trust.

## 6. Structured data (JSON-LD)

Render one `<StructuredData />` component inside `LandingPage` that emits `<script type="application/ld+json">`, with `<` escaped as `<`. Build it **from the same data the page renders**: export `QUESTIONS` from `Faq.tsx` and `PLANS` from `Pricing.tsx` (both are currently module-private). The markup then can't drift from the visible page.

One `@graph`:

- **`Organization`**
  - `@id` `https://acceptra.ai/#org`, `name` "Acceptra", `url`, `logo` `https://acceptra.ai/logo.png`, `email` hello@acceptra.ai
  - `description` (the same one-liner as everywhere else)
  - **`disambiguatingDescription`**: "AI college counseling software for US high school students and families", which separates us from the pharma products and *Acceptera*
  - `founder` (a `Person` for each founder, each with a LinkedIn `sameAs`)
  - `sameAs` (every official profile from §10.3; add Wikidata only when §10.4 allows)
- **`WebSite`**: `name` "Acceptra", `alternateName` "Acceptra AI", `url`, `publisher` → `#org`. This is what makes Google show "Acceptra" as the site name.
- **`FAQPage`** for the visible questions.
  - Google has reportedly retired FAQ rich results altogether as of May 2026, after limiting them to government and health sites in 2023. So expect nothing visual from Google.
  - Keep it anyway: it matches visible content exactly, and Bing and AI parsers read it.
- **`SoftwareApplication`**
  - `name`, `applicationCategory` `EducationalApplication`, `operatingSystem` `Web`, `publisher` → `#org`
  - `offers` for the three plans, built from the exported `PLANS` array in `Pricing.tsx`, each with `availability` `https://schema.org/PreOrder`, and a `UnitPriceSpecification` with a billing duration for Monthly and Yearly. This is how AI engines state our pricing correctly.
  - Google shows a software-app rich result only with `aggregateRating` or `review`, which we won't invent. So expect a "missing field" warning in the Rich Results Test and no visual result. The markup is for understanding, not for a snippet.

Validate `Organization` with Google's Rich Results Test. Validate `WebSite` and `FAQPage` with validator.schema.org, because the Rich Results Test doesn't report them.

## 7. Crawl surface

1. **`robots.txt`:**
   ```
   User-agent: *
   Allow: /

   Sitemap: https://acceptra.ai/sitemap.xml
   ```
   `*` covers everyone. Don't add per-bot rules. For reference, the crawlers that matter, and which ones Cloudflare must not block:

   | Engine | Crawler(s) | Notes |
   |---|---|---|
   | Google search, AI Overviews, Gemini | Googlebot, Googlebot-Image | `Google-Extended` is a training opt-out token only; it has no effect on search |
   | Bing, Copilot | Bingbot | |
   | OpenAI / ChatGPT | OAI-SearchBot, ChatGPT-User, GPTBot | |
   | Anthropic / Claude | ClaudeBot, Claude-SearchBot, Claude-User | |
   | Brave Search | no distinct user agent; follows Googlebot's robots rules | Anthropic lists Brave as a web-search subprocessor, and Claude's web search is widely reported to use Brave's index. Anthropic hasn't stated this publicly |
   | Perplexity | PerplexityBot, Perplexity-User | |
   | DuckDuckGo | Bing's index, plus DuckAssistBot | |
   | Apple (Siri, Apple Intelligence, Spotlight) | Applebot | `Applebot-Extended` is Apple's training token |
   | Model training | CCBot (Common Crawl), Meta-ExternalAgent, Amazonbot | Cloudflare treats these as training crawlers and may block them by default |
2. **Cloudflare AI Crawl Control. Check it before launch.** Cloudflare keeps changing its defaults for new zones:
   - It has shipped "block AI crawlers" as the default.
   - Newer defaults split crawlers into Training, Agent and Search.
   - A *managed robots.txt* option can add its own rules to ours.

   Any of these silently overrides our intent. Set every category to allow, turn off the managed robots.txt, confirm the served `/robots.txt` is byte-identical to ours, and keep Bot Fight Mode from challenging verified bots.
3. **`sitemap.xml`:** `/`, `/privacy` and `/terms` with real `<lastmod>` dates. Hand-edit them or stamp them at build time.
4. **`llms.txt`:** a short Markdown summary covering the definition, the four audiences, the features, pricing, the 2,700+ school count, "opens soon", and links. It takes five minutes. No major engine has confirmed reading it, so don't count on it.
5. **Indexing hints:**
   - Turn on Cloudflare **Crawler Hints**, which sends IndexNow to Bing, Yandex and other participants.
   - Submit the homepage at **search.brave.com/submit-url**. Brave has no webmaster console, and this is how it (and likely Claude's search) picks up a new site quickly.
   - Google doesn't use IndexNow. §10.1 covers Google.

## 8. Performance (Core Web Vitals)

After the prerender, the LCP element is the H1 text, which is the fast case.

1. **Fonts.** All four imported families are used:
   - **Inter** for the hero and **H1** (`--lp-font-hero`), pricing, compare and the dialog
   - **Geist** for the body
   - **Instrument Sans** for the composer
   - **Instrument Serif** italic for "Chapter", schools and the dialog

   Preload only **Inter (latin, variable)** and **Instrument Serif italic (latin)**, the two the H1 needs. The file names are hashed, so the prerender script writes the preload tags (§4.2.3). Fontsource's `unicode-range` already keeps other scripts from downloading.
2. **Images.** Landing PNGs total about 815 KB.
   - With D1 off, `world-map.png` (461 KB, imported only by Testimonials) doesn't ship at launch. Convert it to AVIF/WebP before the section returns.
   - Convert the logo PNGs.
   - Add explicit `width`/`height` to the **68 marquee `<img>` tags** (17 logos × 4 passes, `SchoolsMarquee.tsx:55-60`), the hero-card logos (`HeroCards.tsx:157, 247`) and the Compare logos (`Compare.tsx:200`). They're a layout-shift (CLS) risk.
3. **JavaScript.** The landing loads about 412 KB raw today: `LandingPage-*.js` (149 KB) plus a shared chunk (262 KB, react-dom and Base UI). D4 removes three unused layouts. Re-measure after the landing-only build. PostHog already loads after first paint.
4. **Hydration without a jump.** Initial state must match the server render (§4.4), or the first frame shifts.
5. **bfcache:** add no `unload` listeners.
6. **Targets** (Lighthouse mobile before deploy, PageSpeed Insights after): LCP < 2.0 s, CLS < 0.05, INP < 200 ms, SEO 100, Performance ≥ 90. Real-user field data appears in Search Console once there's traffic.

## 9. AI answer engines

| Engine | Where its answers come from | What we do |
|---|---|---|
| Google AI Overviews / Gemini | Google's index | §4–§6, plus Search Console |
| ChatGPT search | Its own index (OAI-SearchBot), with Bing results still used on part of the traffic | Allow the bots (§7), Bing Webmaster Tools, IndexNow |
| Microsoft Copilot | Bing | Bing Webmaster Tools, IndexNow |
| Perplexity | Its own index (PerplexityBot) | Allow the bot; prerendered HTML |
| Claude | Brave's index (reported), plus Claude-SearchBot/Claude-User fetches | Brave submit-url; allow the bots; prerendered HTML |
| Siri / Apple Intelligence | Applebot | Allow it |
| Meta AI, Grok | Their own crawlers and partner indexes | Nothing to do beyond not blocking them |

What makes an engine **choose** to name us:

1. A quotable, true definition on the page (§5.8).
2. The same facts everywhere: one description, one school count (2,700+), the same founders, and the same "opens soon" status across the site, the structured data, `llms.txt` and every profile.
3. Third-party mentions (§10.5). Engines lean on independent lists, press and forum threads far more than on our own page.

## 10. Launch day and after (people, not code)

1. **Google Search Console.**
   - Add a Domain property (DNS TXT record).
   - Submit the sitemap.
   - Run URL Inspection on `/`, then Request Indexing, and check that the rendered screenshot shows the full page.
   - Check *Manual actions*. It should be empty.
2. **Bing Webmaster Tools.** Import the site from Search Console and submit the sitemap.
3. **Brand entity.**
   - Pick **one handle** (`@acceptra`, or `@acceptraai` if taken) and use it everywhere: LinkedIn company page, X, Instagram, TikTok, YouTube, Crunchbase and Wellfound.
   - Use the same name, logo and one-line description, each linking to `https://acceptra.ai`.
   - Add every profile to `Organization.sameAs`.
   - Track three brand queries: "Acceptra", "Acceptra AI" and "Acceptra college counselor".
4. **Domain, brand and entity checks.**
   - Check `acceptra.ai`'s history on the Wayback Machine and in a free backlink tool, for any previous owner's spam.
   - D10: file the trademark.
   - D8: buy the `.com`.
   - **Wikidata: create an item only after at least two independent editorial articles exist,** then add it to `sameAs`. Items that rest only on self-published profiles get deleted.
5. **Links and mentions, by audience.** All must be genuine, and paid or gifted arrangements disclosed.
   1. **Everyone: independent roundups and press.**
      - Pitch the authors of independent "AI college counselor" lists that already rank (Lumiere Education, Jeffrey Neill's list, College Match Point's GenAI page) with a demo video or preview access. Skip competitor-run roundups (Solyo, Orbit), which won't treat us fairly.
      - Pitch education reporters who have covered AI in admissions (Hechinger Report, Inside Higher Ed, Forbes), and use press-request platforms such as Qwoted and Featured.
      - List on BetaList and a Product Hunt "coming soon" page, then AlternativeTo (as an alternative to CollegeVine and Kollegio), There's An AI For That, Futurepedia and Toolify.
   2. **School counselors and school officials.**
      - ASCA, NACAC and state ACAC newsletters and vendor listings.
      - District and state ed-tech channels: ed-tech directories that schools buy from, and superintendent and principal newsletters.
      - **Before pitching schools, sign the Student Privacy Pledge and apply for a Common Sense Privacy review.** For a product that will hold minors' essays, this is the trust signal schools check first, and both listings link back to us.
   3. **Parents.** Parenting and college-planning newsletters and podcasts, PTA and school parent newsletters, and parent communities (college-planning Facebook groups, r/ApplyingToCollege's parent threads). A founder who genuinely helps in these places earns mentions a directory never will.
   4. **Students.**
      - High school and college newspaper tip lines.
      - Student creators on TikTok and YouTube, with disclosure under the FTC's endorsement guides.
      - r/ApplyingToCollege and College Confidential, **only from a disclosed founder account, and only to help.** Both enforce anti-self-promotion rules, and undisclosed posting produces exactly the negative threads AI engines quote back.
   5. **Founder posts** on LinkedIn and X, sharing real, checkable observations from the 2,700-school data. That gives all four audiences a reason to link without a blog.
6. **Measurement:**
   - Search Console: the three brand queries, then non-brand terms.
   - PostHog: waitlist conversion (`waitlist_opened`/`waitlist_joined` are already wired).
   - UTM tags on every link we post. The canonical tag keeps those URLs from being indexed.
   - Cloudflare AI Crawl Control's log, to see which AI bots actually fetched the page.
   - Once a month, ask ChatGPT, Perplexity, Claude, Gemini and Siri "what's a good AI college counselor?" and "what is Acceptra?", and log the answers in a sheet.
7. **Uptime:** a free monitor for launch week. Downtime during crawlers' first visits delays indexing.

## 11. Pre-launch flip

- [ ] §1 done: the page says 2,700+ schools everywhere, and Testimonials and its footer link are off (D1).
- [ ] Nothing on the production host sends `noindex`: no meta tag, no header, no leftover `Disallow`.
- [ ] Only `https://acceptra.ai` serves the page. Every other host redirects or sends `noindex`.
- [ ] Cloudflare: Email Address Obfuscation off, Rocket Loader off, AI Crawl Control set to allow, managed robots.txt off, Crawler Hints on.
- [ ] The waitlist endpoint and PostHog key are set in the production build.

## 12. Verification (the definition of done)

Against the production URL:

- [ ] `curl -s https://acceptra.ai/` contains all of the following:
  - the H1 with every word separated
  - every H2
  - every FAQ answer, including "What is Acceptra?"
  - every feature title
  - the JSON-LD block, the canonical, the `og:*` tags and the two font preloads

  And it contains none of these:
  - a `<noscript>` H1
  - `/cdn-cgi/l/email-protection`
  - "400+ schools"
- [ ] The same response comes back for `-A Googlebot`, `-A bingbot`, `-A GPTBot`, `-A ClaudeBot` and `-A PerplexityBot`, with no Cloudflare challenge.
- [ ] Every `/assets/…` URL in the HTML resolves. (The prerender script checks this at build time; confirm again in production.)
- [ ] `dist-landing/` contains no `app-*.js`, `palette-preview.html` or `palette-first-directions.html`, and those paths 404 in production.
- [ ] `/privacy` and `/terms` return 200 with their own titles, and `/privacy.html` returns a single 308 to `/privacy`.
- [ ] `/robots.txt` is `text/plain` and byte-identical to ours. `/sitemap.xml` lists three URLs.
- [ ] `/not-a-page` returns **404** with `404.html`.
- [ ] `/landing.html`, `http://…`, `http://www…`, `https://www…` and `acceptra.com` each reach `https://acceptra.ai/` in **one** 301/308 hop.
- [ ] `https://<project>.pages.dev/` returns `X-Robots-Tag: noindex`.
- [ ] Rich Results Test shows Organization with no errors. validator.schema.org shows Organization, WebSite and FAQPage clean.
- [ ] Link previews render in opengraph.xyz, LinkedIn Post Inspector, and a real iMessage or WhatsApp send.
- [ ] No hydration warnings in the console, and no visible jump on load at desktop width or at 390px.
- [ ] CSP report-only shows no violations from the page's own resources.
- [ ] Lighthouse mobile: SEO 100, Performance ≥ 90, CLS < 0.05, LCP < 2.0 s.
- [ ] Waitlist submit works end to end, and PostHog receives `waitlist_joined`.
- [ ] Within about a week: Search Console reports "URL is on Google", and a search for "Acceptra AI" shows the site with the name "Acceptra" and our favicon.

## 13. Order of work

| Step | Work | Owner | Size |
|---|---|---|---|
| 1 | D1–D10 answered; D5/D6 assets requested | Owner | Decision |
| 2 | Create the branch; **commit the current landing as-is**; then D4 deletion and the §4.4 render-safety fixes in their own commit | Eng | S |
| 3 | §1 copy changes: 2,700+ school count, Testimonials and its footer link off | Eng | S |
| 4 | §4 prerender: server entry, prerender script (font preloads, asset check), `hydrateRoot`, text spacing, drop `<noscript>` | Eng | M |
| 5 | §3A (or §3B): landing config (replaced inputs), `public-landing/`, 404 page, redirects, headers, legal links, gate `/v1/me` | Eng | S |
| 6 | §5 and §6: head tags, icons, wordmark alt, copy additions, JSON-LD | Eng + design assets | S |
| 7 | §7 and §8: robots, sitemap, llms.txt, image work, `width`/`height` | Eng | S |
| 8 | Deploy; zone settings; DNS; Brave submit | Eng + owner (DNS access) | S |
| 9 | §11 flip and §12 verification | Eng | S |
| 10 | §10: consoles, profiles, trademark, outreach, monthly AI-answer check | Owner / growth | Ongoing |

Steps 2–7 are one to two days of engineering. Step 1 is the only blocker.

## 14. Expected timeline

- **Week 1:** indexed in Google and Bing. "Acceptra AI" likely shows us first.
- **Weeks 2–6:** the site name and favicon appear in results. Bare "Acceptra" gradually separates from the pharma listings and *Acceptera* as profiles and mentions add up.
- **Months 1–6:** measure brand queries and AI-engine mentions. Page 1 for "AI college counselor" is unlikely without real links. That is the job of §10.5 and §16, not of this page's markup.

## 15. Deliberately not doing

- **No keyword rewriting, and no hidden text.**
- **No `Review`/`AggregateRating` markup**, and no invented social proof in any form (D1).
- **No thin feature landing pages.** Near-duplicate doorway pages get demoted.
- **No blog yet.** An empty or AI-filler blog does more harm than none.
- **No Product Hunt launch yet.** Relaunches are allowed after major updates, but the first launch is the one that counts, so spend it when people can use the app.
- **No bought links, link exchanges, private blog networks, or undisclosed posting.**
- **No `hreflang`.** One language, one market.
- **No per-bot robots rules** beyond `*`.
- **No enforced CSP until the report-only period is clean** (§3A.9).

## 16. After this: what moves non-brand rankings

For later. Each item is its own plan:

- **At launch:** switch the offers' `availability` to `InStock`, target "free AI college counselor" once the Free plan is live, and do the real Product Hunt launch.
- **Per-school pages** (acceptance rate, cost, deadlines, test policy) built from public-domain IPEDS and College Scorecard data. Publishing CollegeData-scraped facts widens Risk R0 (ADR 0038), so that needs an owner/legal decision first.
- **Essay guides** drawn from the essay skill library's substance, written as real guides.

## 17. Research references (2026-09-28)

- **Brand collisions:**
  - [Acceptra Plus](https://drugcarts.com/product/acceptra-plus-tablet)
  - [ACCEPTRA-MR](https://www.lifevisionhealthcare.com/product/acceptra-mr/)
  - [Acceptera (Wikipedia)](https://en.wikipedia.org/wiki/Acceptera)
  - [acceptra.com for sale](https://www.brandbucket.com/names/acceptra)
- **Competitors and roundups:**
  - [Kollegio](https://www.kollegio.ai/)
  - [KapAdvisor](https://www.kaptest.com/college-prep/ai-advisor)
  - [Counselly](https://www.counselly.ai/ai-college-counselor)
  - [Counsely](https://www.getcounsely.com/ai-college-counselor)
  - [DreamCollege.AI](https://dreamcollege.ai/)
  - [Lumiere list](https://www.lumiere-education.com/post/8-great-ai-college-counselor-tools)
  - [Jeffrey Neill list](https://www.jeffreyneill.com/blog/2025/4/10/jeffs-top-10-ai-list)
  - [College Match Point](https://www.collegematchpoint.com/genaicollegecounseling)
  - [Hechinger Report](https://hechingerreport.org/ai-educators-college-counselors/)
  - [Inside Higher Ed](https://www.insidehighered.com/news/admissions/traditional-age/2024/04/08/can-ai-make-college-counseling-more-equitable)
  - [Forbes](https://www.forbes.com/sites/scottwhite/2026/06/10/ai-wont-replace-college-counselors-but-it-may-bring-their-best-skill-to-millions-of-students/)
- **Google:**
  - [favicon](https://developers.google.com/search/docs/appearance/favicon-in-search)
  - [software app](https://developers.google.com/search/docs/appearance/structured-data/software-app)
  - FAQ rich results retired: [seostrategy.co.uk](https://www.seostrategy.co.uk/learn/faq-schema-deprecation-2026-rich-result-vs-schema/), [Joost](https://joost.blog/faq-schema-cycle/)
- **Cloudflare:**
  - [managed robots.txt](https://blog.cloudflare.com/control-content-use-for-ai-training/)
  - [AI crawlers](https://developers.cloudflare.com/ai-crawl-control/features/manage-ai-crawlers)
  - [Pages serving and preview noindex](https://developers.cloudflare.com/pages/configuration/serving-pages/)
- **AI search:**
  - [Brave crawler](https://search.brave.com/help/brave-search-crawler)
  - [Brave submit URL](https://search.brave.com/submit-url)
  - [Claude and Brave](https://www.tryprofound.com/blog/what-is-claude-web-search-explained)
  - [ChatGPT's own index](https://searchenginewatch.com/chatgpt-own-search-engine/)
  - [Apple answers](https://searchengineland.com/apple-world-knowledge-answers-ai-search-461569)
- **Entity:**
  - [Wikidata notability](https://www.wikidata.org/wiki/Wikidata:Notability)
  - [Student Privacy Pledge](https://studentprivacypledge.org/)
