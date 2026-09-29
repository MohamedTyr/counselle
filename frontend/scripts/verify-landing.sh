#!/usr/bin/env bash
# Checks a deployed landing-only site against the launch definition of done
# (plans/landing-seo-plan.md §12). Usage:
#   scripts/verify-landing.sh https://acceptra.ai
#   PAGES_DEV_URL=https://acceptra.pages.dev scripts/verify-landing.sh https://acceptra.ai
# The host-redirect checks run only against the production origin.
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
# One request, no redirect following: "<status> <location>".
hop() { curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$1"; }

echo "Home page ($BASE/)"
page="$(curl -s "$BASE/")"
has() { grep -qF -- "$1" <<<"$page"; }
check "H1 with every word separated" 'has "AI College</span> <span>counseling</span></span> <span"'
for heading in "Everything a \$10,000 counselor does" "How Acceptra compares" \
  "Drop the consultants, keep the results" "Know which students need you" \
  "Questions families" "Students who tested it"; do
  check "H2: $heading" 'has "$heading"'
done
for text in "What is Acceptra?" "Is my data sold or used for advertising?" \
  "A real mentor, twice a month" "Essay feedback, line by line" \
  "Colleges that match you" "Scholarships you match" "Activities that fit you" \
  "Official SAT questions, until your mistakes run out" \
  "Tasks and deadlines, all in one place"; do
  check "text: $text" 'has "$text"'
done
check "FAQ answers are in the HTML" '[ "$(grep -o "class=\"lp-faq-answer\"" <<<"$page" | wc -l)" -ge 9 ]'
check "JSON-LD block" 'has "application/ld+json"'
check "canonical" 'has "<link rel=\"canonical\" href=\"https://acceptra.ai/\""'
check "og:image" 'has "og:image\" content=\"https://acceptra.ai/og.png\""'
check "two font preloads" '[ "$(grep -o "as=\"font\"" <<<"$page" | wc -l)" -eq 2 ]'
check "no <noscript>" '! has "<noscript"'
check "no Cloudflare email obfuscation" '! has "/cdn-cgi/l/email-protection"'
check "no 400+ schools" '! has "400+ schools"'
check "2,700+ schools" 'has "2,700+"'
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

echo "Legal pages and clean URLs"
check "/privacy 200 with its title" 'curl -s "$BASE/privacy" | grep -q "<title>Privacy Policy"'
check "/terms 200 with its title" 'curl -s "$BASE/terms" | grep -q "<title>Terms of Service"'
check "/privacy.html is one 308 to /privacy" '[[ "$(hop "$BASE/privacy.html")" =~ ^308\ .*/privacy$ ]]'
check "/landing.html is one 301 to /" '[[ "$(hop "$BASE/landing.html")" =~ ^30[18]\ .*/$ ]]'
check "/not-a-page is a 404" '[ "$(status "$BASE/not-a-page")" = 404 ]'
check "404 page body" 'curl -s "$BASE/not-a-page" | grep -q "This page doesn"'

echo "Crawl files"
check "robots.txt is text/plain" 'curl -sI "$BASE/robots.txt" | grep -qi "^content-type: text/plain"'
check "robots.txt is byte-identical" 'diff -q <(curl -s "$BASE/robots.txt") "$HERE/public-landing/robots.txt" >/dev/null'
check "sitemap lists three URLs" '[ "$(curl -s "$BASE/sitemap.xml" | grep -c "<loc>")" -eq 3 ]'
check "llms.txt served" '[ "$(status "$BASE/llms.txt")" = 200 ]'
for path in /favicon.ico /icon.svg /apple-touch-icon.png /site.webmanifest /og.png /logo.png; do
  check "$path served" '[ "$(status "$BASE$path")" = 200 ]'
done

echo "Headers"
headers="$(curl -sI "$BASE/")"
check "HSTS" 'grep -qi "^strict-transport-security" <<<"$headers"'
check "CSP report-only" 'grep -qi "^content-security-policy-report-only" <<<"$headers"'
check "immutable assets" 'curl -sI "$BASE$(grep -oE "/assets/[^\"]+\.js" <<<"$page" | head -1)" | grep -qi "immutable"'

if [ "$BASE" = "$PRODUCTION" ]; then
  echo "Host redirects (one hop each)"
  for origin in http://acceptra.ai http://www.acceptra.ai https://www.acceptra.ai https://acceptra.com http://acceptra.com; do
    check "$origin" '[[ "$(hop "$origin/")" =~ ^30[18]\ https://acceptra\.ai/?$ ]]'
  done
fi
if [ -n "${PAGES_DEV_URL:-}" ]; then
  echo "Preview host"
  check "$PAGES_DEV_URL sends noindex" 'curl -sI "$PAGES_DEV_URL/" | grep -qi "^x-robots-tag: noindex"'
fi

echo
if [ "$failures" -eq 0 ]; then echo "All checks passed."; else echo "$failures check(s) failed."; fi
exit $((failures > 0))
