#!/usr/bin/env sh
set -eu

required_env="
COUNSELLE_DB_APP_DSN
COUNSELLE_DB_RO_DSN
COUNSELLE_JWT_SECRET
"

for name in $required_env; do
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "missing required environment variable: $name" >&2
    exit 1
  fi
done

schema_dsn="${COUNSELLE_DB_APP_DSN}"
case "$schema_dsn" in
  *\?*) schema_dsn="${schema_dsn}&schema=counselle" ;;
  *) schema_dsn="${schema_dsn}?schema=counselle" ;;
esac

.venv/bin/yoyo apply --batch --database "$schema_dsn" migrations/

exec .venv/bin/uvicorn api.main:create_app \
  --factory \
  --host 0.0.0.0 \
  --port "${PORT:-8000}" \
  --proxy-headers \
  --forwarded-allow-ips "*"
