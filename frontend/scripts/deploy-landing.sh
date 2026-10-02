#!/usr/bin/env bash
# Deploys the landing site to production from origin/main, and only from there.
# The Pages project is direct upload (it can never become Git-connected), so this
# guard is what keeps production equal to main. Usage: npm run deploy:landing
# Emergency bypass: npx wrangler pages deploy dist-landing --project-name acceptra --branch main
set -euo pipefail

cd "$(dirname "$0")/.."

git fetch --quiet origin main
if [ -n "$(git status --porcelain)" ]; then
  echo "Refusing to deploy: the working tree has uncommitted or untracked changes." >&2
  exit 1
fi
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "Refusing to deploy: HEAD is not origin/main. Check out main and pull first." >&2
  exit 1
fi

npm ci
npm run build:landing
npx wrangler pages deploy dist-landing --project-name acceptra --branch main \
  --commit-hash "$(git rev-parse HEAD)" --commit-message "$(git log -1 --format=%s)"
