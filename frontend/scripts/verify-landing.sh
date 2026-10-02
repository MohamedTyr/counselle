#!/usr/bin/env bash
# Checks a deployed landing-only site against the launch definition of done
# (plans/landing-seo-plan.md §12, plans/landing-launch-plan.md §7.3). Usage:
#   scripts/verify-landing.sh https://acceptra.ai
#   scripts/verify-landing.sh http://localhost:8788     # npm run preview:landing
#   PAGES_DEV_URL=https://acceptra.pages.dev scripts/verify-landing.sh https://acceptra.ai
# Run it against production or a local build only, never a preview: previews
# refuse every waitlist write, so the 400 checks would correctly get 403s.
# The host-redirect, analytics-proxy and Access checks run only against production;
# CHECK_COM=1 adds acceptra.com once that domain is owned.
set -uo pipefail

BASE="${1:?usage: verify-landing.sh <base-url>}"
BASE="${BASE%/}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PRODUCTION="https://acceptra.ai"
failures=0

pass() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; failures=$((failures + 1)); }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
# POST a JSON body to the waitlist and print the status; extra args go to curl.
signup() { local url="$1" body="$2"; shift 2; status -X POST -H "Content-Type: application/json" -d "$body" "$@" "$url/api/waitlist"; }
# One request, no redirect following: "<status> <location>".
hop() { curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$1"; }

echo "Home page ($BASE/)"
page="$(curl -s "$BASE/")"
has() { grep -qF -- "$1" <<<"$page"; }
check "H1 with every word separated" 'has "Elite AI college</span> <span>counseling.</span></span> <span"'
for heading in "We do what a \$10,000 counselor does" "How Acceptra compares" \
  "Drop the consultants, keep the results" "Know which students need you" \
  "Questions families" "Students who tested it"; do
  check "H2: $heading" 'has "$heading"'
done
for text in "Why not just ask ChatGPT?" "What can a counselor see?" \
  "A real mentor, twice a month" "Line-by-line comments in minutes" \
  "A list built on facts" "Money you actually qualify for" \
  "Programs that fit what you already do" \
  "Official SAT questions, until your mistakes run out" \
  "Every school’s dates, one calendar"; do
  check "text: $text" 'has "$text"'
done
check "FAQ answers are in the HTML" '[ "$(grep -o "class=\"lp-faq-answer\"" <<<"$page" | wc -l)" -ge 9 ]'
check "JSON-LD block" 'has "application/ld+json"'
check "canonical" 'has "<link rel=\"canonical\" href=\"https://acceptra.ai/\""'
check "og:image" 'has "og:image\" content=\"https://acceptra.ai/og.png\""'
check "one font preload" '[ "$(grep -o "as=\"font\"" <<<"$page" | wc -l)" -eq 1 ]'
check "no <noscript>" '! has "<noscript"'
check "no Cloudflare email obfuscation" '! has "/cdn-cgi/l/email-protection"'
check "no 400+ schools" '! has "400+ schools"'
check "2,200+ schools" 'has "2,200+"'
check "no noindex meta" '! grep -qi "name=\"robots\"[^>]*noindex" <<<"$page"'
check "no X-Robots-Tag on production host" '! curl -sI "$BASE/" | grep -qi "^x-robots-tag"'

echo "Crawlers get the same page, unchallenged"
expected="$(md5sum <<<"$page")"
for agent in Googlebot bingbot GPTBot ClaudeBot PerplexityBot; do
  body="$(curl -s -A "Mozilla/5.0 (compatible; $agent)" "$BASE/")"
  check "$agent" '[ "$(md5sum <<<"$body")" = "$expected" ]'
done

echo "Assets"
missing=""
for url in $(grep -oE '/assets/[^"'"'"' )]+' <<<"$page" | sort -u); do
  [ "$(status "$BASE$url")" = 200 ] || missing="$missing $url"
done
check "every /assets/ URL resolves" '[ -z "$missing" ]'
[ -n "$missing" ] && printf '        missing:%s\n' "$missing"
for path in /palette-preview.html /palette-first-directions.html; do
  check "$path is not served" '[ "$(status "$BASE$path")" = 404 ]'
done
check "no app bundle referenced" '! grep -q "/assets/app-" <<<"$page"'
check "no admin asset referenced" '! grep -q "/assets/admin-" <<<"$page"'
chunk="$(curl -s "$BASE$(grep -oE '/assets/landing-[^"]+\.js' <<<"$page" | head -1)")"
check "analytics posts to /ingest" 'grep -qE "[^[:alnum:]_/]/ingest[^[:alnum:]_/]" <<<"$chunk"'
check "analytics never calls PostHog directly" '! grep -qF "us.i.posthog.com" <<<"$chunk"'

echo "Waitlist endpoint (no row is written)"
check "a bad source is a 400" '[ "$(signup "$BASE" "{\"email\":\"x@check.invalid\",\"side\":\"me\",\"source\":\"<img>\"}" -H "Origin: $BASE")" = 400 ]'
check "a U+202E email is a 400" '[ "$(signup "$BASE" "{\"email\":\"a\\u202eb@check.invalid\",\"side\":\"me\",\"source\":\"nav\"}" -H "Origin: $BASE")" = 400 ]'
check "no Origin is a 403" '[ "$(signup "$BASE" "{\"email\":\"x@check.invalid\",\"side\":\"me\",\"source\":\"<img>\"}")" = 403 ]'

echo "About, legal pages and clean URLs"
check "/about 200 with its title" 'grep -q "<title>About · Acceptra" <<<"$(curl -s "$BASE/about")"'
check "/privacy 200 with its title" 'grep -q "<title>Privacy Policy" <<<"$(curl -s "$BASE/privacy")"'
check "/terms 200 with its title" 'grep -q "<title>Terms of Service" <<<"$(curl -s "$BASE/terms")"'
check "/privacy.html is one 308 to /privacy" '[[ "$(hop "$BASE/privacy.html")" =~ ^308\ .*/privacy$ ]]'
check "/landing.html is one 301 to /" '[[ "$(hop "$BASE/landing.html")" =~ ^30[18]\ .*/$ ]]'
check "/not-a-page is a 404" '[ "$(status "$BASE/not-a-page")" = 404 ]'
check "404 page body" 'grep -q "This page doesn" <<<"$(curl -s "$BASE/not-a-page")"'

echo "Crawl files"
check "robots.txt is text/plain" 'curl -sI "$BASE/robots.txt" | grep -qi "^content-type: text/plain"'
check "robots.txt is byte-identical" 'diff -q <(curl -s "$BASE/robots.txt") "$HERE/public-landing/robots.txt" >/dev/null'
check "sitemap lists four URLs" '[ "$(curl -s "$BASE/sitemap.xml" | grep -c "<loc>")" -eq 4 ]'
check "/admin is in no crawl file" '! curl -s "$BASE/sitemap.xml" "$BASE/robots.txt" | grep -q "/admin"'
check "llms.txt served" '[ "$(status "$BASE/llms.txt")" = 200 ]'
llms="$(curl -s "$BASE/llms.txt")"
check "llms.txt names the head term" 'grep -qF "AI college admissions counselor" <<<"$llms"'
check "llms.txt has the school count" 'grep -qF "2,200+" <<<"$llms"'
check "security.txt names a contact" 'curl -s "$BASE/.well-known/security.txt" | grep -q "^Contact: mailto:"'
# The IndexNow key file is public-landing/<key>.txt, and holds only its key.
indexnow="$(ls "$HERE/public-landing" | grep -oE '^[0-9a-f]{32}' | head -1)"
check "IndexNow key served" '[ "$(curl -s "$BASE/$indexnow.txt")" = "$indexnow" ]'
for path in /favicon.ico /icon.svg /apple-touch-icon.png /site.webmanifest /og.png /icon-512.png; do
  check "$path served" '[ "$(status "$BASE$path")" = 200 ]'
done

echo "Headers"
headers="$(curl -sI "$BASE/")"
check "HSTS" 'grep -qi "^strict-transport-security" <<<"$headers"'
check "framed only by PostHog" 'grep -qi "frame-ancestors [^;]*posthog.com" <<<"$headers"'
check "CSP enforced" 'grep -qi "^content-security-policy: " <<<"$headers"'
check "immutable assets" 'curl -sI "$BASE$(grep -oE "/assets/[^\"]+\.js" <<<"$page" | head -1)" | grep -qi "immutable"'

echo "Content-Security-Policy in a real browser"
node "$HERE/scripts/check-csp.mjs" "$BASE" || failures=$((failures + 1))

if [ "$BASE" = "$PRODUCTION" ]; then
  echo "Host redirects (one hop each)"
  origins="http://acceptra.ai http://www.acceptra.ai https://www.acceptra.ai"
  [ "${CHECK_COM:-}" = 1 ] && origins="$origins https://acceptra.com http://acceptra.com"
  for origin in $origins; do
    check "$origin" '[[ "$(hop "$origin/")" =~ ^30[18]\ https://acceptra\.ai/?$ ]]'
  done
  # Cache-Control: no-transform would also stop Cloudflare compressing the HTML.
  check "HTML is compressed" 'curl -s -o /dev/null -D - -H "Accept-Encoding: br, gzip" "$BASE/" | grep -qi "^content-encoding: "'
  echo "Analytics proxy"
  key="$(grep -oE 'phc_[A-Za-z0-9]+' <<<"$chunk" | head -1)"
  check "/ingest serves the project config" 'curl -s -D - -o /dev/null "$BASE/ingest/array/$key/config" | grep -qi "^content-type: application/json" && [ "$(status "$BASE/ingest/array/$key/config")" = 200 ]'
  echo "Admin page (Cloudflare Access in front)"
  check "/admin/ redirects to the Access login" '[[ "$(hop "$BASE/admin/")" =~ ^302\ https://[a-z0-9-]+\.cloudflareaccess\.com/ ]]'
  check "the admin API is a 401 without a session" '[ "$(status -H "X-Requested-With: XMLHttpRequest" "$BASE/admin/api/waitlist")" = 401 ]'
  check "an unauthenticated DELETE never succeeds" '[[ "$(status -X DELETE -H "Origin: $BASE" -H "Content-Type: application/json" -d "{\"email\":\"x@check.invalid\"}" "$BASE/admin/api/waitlist")" != 2* ]]'
fi
if [ -n "${PAGES_DEV_URL:-}" ]; then
  echo "Preview host"
  check "$PAGES_DEV_URL sends noindex" 'curl -sI "$PAGES_DEV_URL/" | grep -qi "^x-robots-tag: noindex"'
  # The Origin matches, so only the host check can refuse this.
  check "$PAGES_DEV_URL refuses waitlist writes" '[ "$(signup "$PAGES_DEV_URL" "{\"email\":\"x@check.invalid\",\"side\":\"me\",\"source\":\"nav\"}" -H "Origin: $PAGES_DEV_URL")" = 403 ]'
  # No Access here, and the production D1 is bound: the Function's own host
  # check is all that stands between this host and the list.
  check "$PAGES_DEV_URL/admin/ is a 404" '[ "$(status "$PAGES_DEV_URL/admin/")" = 404 ]'
  admin_api="$(curl -s -D - "$PAGES_DEV_URL/admin/api/waitlist")"
  check "$PAGES_DEV_URL/admin/api/waitlist is the site 404" 'grep -q "^HTTP/[0-9.]* 404" <<<"$admin_api" && grep -q "This page doesn" <<<"$admin_api" && ! grep -q "\"rows\"" <<<"$admin_api"'
fi

echo
if [ "$failures" -eq 0 ]; then echo "All checks passed."; else echo "$failures check(s) failed."; fi
exit $((failures > 0))
