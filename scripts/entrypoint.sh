#!/usr/bin/env sh
set -eu

required_env="
COUNSELLE_DB_APP_DSN
COUNSELLE_DB_RO_DSN
COUNSELLE_DB_ADMIN_DSN
COUNSELLE_DB_PIPELINE_DSN
COUNSELLE_JWT_SECRET
COUNSELLE_TRUSTED_PROXY_CIDR
"

for name in $required_env; do
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "missing required environment variable: $name" >&2
    exit 1
  fi
done

# A managed database starts empty, so provision roles + every cds_library
# object (schools, the eight facts-store tables, the six reader views, D9)
# and the counselle schema before migrations run. No-op once seeded.
.venv/bin/python scripts/seed_reader_db.py

# The seed creates collegedata_schools empty; sync the committed crosswalk
# CSV into it on every boot (app/facts/crosswalk.py is its only loader,
# school-data-v3 plan §4.2/§4.6 -- upsert, so this is a no-op once synced).
.venv/bin/python -m app.facts crosswalk-sync

schema_dsn="${COUNSELLE_DB_APP_DSN}"
case "$schema_dsn" in
  *\?*) schema_dsn="${schema_dsn}&schema=counselle" ;;
  *) schema_dsn="${schema_dsn}?schema=counselle" ;;
esac

.venv/bin/yoyo apply --batch --database "$schema_dsn" migrations/

# Sync the SAT question bank into counselle.sat_* on every boot -- a no-op
# once the bank file's sha256 already matches what's live (app/sat/bank_sync.py,
# plan §3.2).
.venv/bin/python -m app.sat bank-sync

# Trust ONLY the platform's proxy CIDR. '*' makes uvicorn 0.49 take the LEFTMOST,
# client-supplied X-Forwarded-For entry, turning the per-IP auth limit into a no-op.
exec .venv/bin/uvicorn api.main:create_app \
  --factory \
  --host 0.0.0.0 \
  --port "${PORT:-8000}" \
  --proxy-headers \
  --forwarded-allow-ips "${COUNSELLE_TRUSTED_PROXY_CIDR}"
