#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

MODE="${1:-migrate}"
DUMP_DIR="${DUMP_DIR:-"$ROOT_DIR/.local/db-migrations"}"
TIMESTAMP="$(date '+%Y-%m-%d_%H-%M-%S')"
DUMP_PATH="${DUMP_PATH:-"$DUMP_DIR/counselle-pipeline-$TIMESTAMP.dump"}"
MAX_SOURCE_BYTES="${MAX_SOURCE_BYTES:-$((700 * 1024 * 1024))}"
MAX_DUMP_BYTES="${MAX_DUMP_BYTES:-$((700 * 1024 * 1024))}"
ALLOW_OVERSIZE="${ALLOW_OVERSIZE:-0}"
RUN_COUNSELLE_MIGRATIONS="${RUN_COUNSELLE_MIGRATIONS:-0}"
SOURCE_DOCKER_COMPOSE_DIR="${SOURCE_DOCKER_COMPOSE_DIR:-}"
SOURCE_DOCKER_SERVICE="${SOURCE_DOCKER_SERVICE:-db}"
SOURCE_DOCKER_COMPOSE_FILE="${SOURCE_DOCKER_COMPOSE_FILE:-}"
TARGET_ADMIN_DSN="${TARGET_ADMIN_DSN:-${COUNSELLE_AIVEN_ADMIN_DSN:-}}"
SOURCE_DB_DSN="${SOURCE_DB_DSN:-${COUNSELLE_SOURCE_DB_DSN:-}}"
SOURCE_DB_DSN="${SOURCE_DB_DSN:-${COUNSELLE_DB_APP_DSN:-}}"
COUNSELLE_RO_PASSWORD="${COUNSELLE_RO_PASSWORD:-}"
COUNSELLE_APP_PASSWORD="${COUNSELLE_APP_PASSWORD:-}"

REQUIRED_TABLES=(
  "public.schools"
  "public.fields"
  "public.field_values"
  "raw.files"
  "raw.scorecard_fos"
  "raw.ipeds_ef2024a"
  "raw.ipeds_valuesets24"
  "raw.ipeds_vartable24"
  "raw.ipeds_hd2024"
  "raw.ipeds_flags2024"
)

usage() {
  cat <<'EOF'
Usage:
  scripts/migrate_pipeline_to_aiven.sh check-source
  scripts/migrate_pipeline_to_aiven.sh check-target
  scripts/migrate_pipeline_to_aiven.sh dump
  scripts/migrate_pipeline_to_aiven.sh restore
  scripts/migrate_pipeline_to_aiven.sh prepare-target
  scripts/migrate_pipeline_to_aiven.sh bootstrap
  scripts/migrate_pipeline_to_aiven.sh verify
  scripts/migrate_pipeline_to_aiven.sh migrate

Required env:
  TARGET_ADMIN_DSN       Aiven admin DSN, e.g. postgres://avnadmin:.../defaultdb?sslmode=require
                         Also accepted as COUNSELLE_AIVEN_ADMIN_DSN in .env.

Optional env:
  COUNSELLE_RO_PASSWORD  Password to create/use for counselle_ro. Generated if missing.
  COUNSELLE_APP_PASSWORD Password to create/use for counselle_app. Generated if missing.

Source options, choose one:
  SOURCE_DB_DSN          Direct DSN to the populated local pipeline DB
                         Defaults to COUNSELLE_SOURCE_DB_DSN, then COUNSELLE_DB_APP_DSN.
                         This means the other dev's old .env works as the source.

  OR:
  SOURCE_DOCKER_COMPOSE_DIR  Directory containing the other dev's compose file
  SOURCE_DOCKER_COMPOSE_FILE Optional explicit compose file path
  SOURCE_DOCKER_SERVICE      Compose service name, default: db
  POSTGRES_USER              Source DB user inside the container
  POSTGRES_DB                Source DB name inside the container

Optional env:
  DUMP_PATH                  Dump file path. Default: .local/db-migrations/counselle-pipeline-<timestamp>.dump
  MAX_SOURCE_BYTES           Default: 734003200 (700 MiB)
  MAX_DUMP_BYTES             Default: 734003200 (700 MiB)
  ALLOW_OVERSIZE=1           Bypass size caps after explicit operator decision
  RUN_COUNSELLE_MIGRATIONS=1 Run yoyo migrations after bootstrap

Notes:
  - The script dumps only the pipeline-owned public/raw schemas.
  - It excludes the counselle schema so app sessions/users are not copied from a dev box.
  - It pre-creates vector and pg_trgm on Aiven before restore.
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required"
}

need_target() {
  : "${TARGET_ADMIN_DSN:?TARGET_ADMIN_DSN is required}"
}

need_passwords() {
  if [[ -z "$COUNSELLE_RO_PASSWORD" ]]; then
    COUNSELLE_RO_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
  fi
  if [[ -z "$COUNSELLE_APP_PASSWORD" ]]; then
    COUNSELLE_APP_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
  fi
}

source_mode() {
  if [[ -n "${SOURCE_DB_DSN:-}" ]]; then
    printf 'dsn\n'
    return
  fi
  if [[ -n "$SOURCE_DOCKER_COMPOSE_DIR" ]]; then
    printf 'docker\n'
    return
  fi
  die "set SOURCE_DB_DSN or SOURCE_DOCKER_COMPOSE_DIR"
}

source_psql() {
  local sql="$1"
  case "$(source_mode)" in
    dsn)
      psql "$SOURCE_DB_DSN" -v ON_ERROR_STOP=1 -At -c "$sql"
      ;;
    docker)
      : "${POSTGRES_USER:?POSTGRES_USER is required for docker source mode}"
      : "${POSTGRES_DB:?POSTGRES_DB is required for docker source mode}"
      docker compose -f "$(compose_file)" exec -T "$SOURCE_DOCKER_SERVICE" \
        psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -At -c "$sql"
      ;;
  esac
}

compose_file() {
  if [[ -n "$SOURCE_DOCKER_COMPOSE_FILE" ]]; then
    printf '%s\n' "$SOURCE_DOCKER_COMPOSE_FILE"
    return
  fi
  if [[ -f "$SOURCE_DOCKER_COMPOSE_DIR/compose.yaml" ]]; then
    printf '%s\n' "$SOURCE_DOCKER_COMPOSE_DIR/compose.yaml"
    return
  fi
  if [[ -f "$SOURCE_DOCKER_COMPOSE_DIR/docker-compose.yml" ]]; then
    printf '%s\n' "$SOURCE_DOCKER_COMPOSE_DIR/docker-compose.yml"
    return
  fi
  die "no compose.yaml or docker-compose.yml found in SOURCE_DOCKER_COMPOSE_DIR"
}

source_dump() {
  mkdir -p "$(dirname "$DUMP_PATH")"
  case "$(source_mode)" in
    dsn)
      pg_dump "$SOURCE_DB_DSN" \
        --format=custom \
        --compress=6 \
        --no-owner \
        --no-privileges \
        --schema=public \
        --schema=raw \
        --exclude-schema=counselle \
        --exclude-extension=vector \
        --file="$DUMP_PATH"
      ;;
    docker)
      : "${POSTGRES_USER:?POSTGRES_USER is required for docker source mode}"
      : "${POSTGRES_DB:?POSTGRES_DB is required for docker source mode}"
      docker compose -f "$(compose_file)" exec -T "$SOURCE_DOCKER_SERVICE" \
        pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
          --format=custom \
          --compress=6 \
          --no-owner \
          --no-privileges \
          --schema=public \
          --schema=raw \
          --exclude-schema=counselle \
          --exclude-extension=vector > "$DUMP_PATH"
      ;;
  esac
}

bytes_human() {
  local bytes="$1"
  python3 - "$bytes" <<'PY'
import sys
n = int(sys.argv[1])
units = ["B", "KiB", "MiB", "GiB", "TiB"]
value = float(n)
for unit in units:
    if value < 1024 or unit == units[-1]:
        print(f"{value:.1f} {unit}")
        break
    value /= 1024
PY
}

file_size_bytes() {
  stat -c '%s' "$1"
}

check_cap() {
  local label="$1" bytes="$2" cap="$3"
  printf '%s: %s (cap %s)\n' "$label" "$(bytes_human "$bytes")" "$(bytes_human "$cap")"
  if [[ "$ALLOW_OVERSIZE" != "1" && "$bytes" -gt "$cap" ]]; then
    die "$label exceeds cap; raise the cap or set ALLOW_OVERSIZE=1 after confirming Aiven storage"
  fi
}

assert_source_is_not_target() {
  if [[ -z "${SOURCE_DB_DSN:-}" || -z "${TARGET_ADMIN_DSN:-}" ]]; then
    return
  fi
  local same
  same="$(python3 - "$SOURCE_DB_DSN" "$TARGET_ADMIN_DSN" <<'PY'
import sys
from urllib.parse import urlsplit

def ident(dsn: str) -> tuple[str | None, int | None, str]:
    p = urlsplit(dsn)
    return (p.hostname, p.port, p.path)

print("yes" if ident(sys.argv[1]) == ident(sys.argv[2]) else "no")
PY
)"
  if [[ "$same" == "yes" ]]; then
    die "source DB appears to be the Aiven target. Set SOURCE_DB_DSN/COUNSELLE_SOURCE_DB_DSN to the other dev's local pipeline DB before migrating."
  fi
}

check_source() {
  need_cmd psql
  source_mode >/dev/null
  assert_source_is_not_target
  printf 'source database:\n'
  source_psql "select current_database() || ' | ' || version();"
  local size
  size="$(source_psql "select pg_database_size(current_database());")"
  check_cap "source database size" "$size" "$MAX_SOURCE_BYTES"
  printf 'required tables:\n'
  local table
  for table in "${REQUIRED_TABLES[@]}"; do
    source_psql "select case when to_regclass('$table') is null then 'missing: $table' else 'ok: $table' end;"
  done
  if printf '%s\n' "${REQUIRED_TABLES[@]}" | while read -r table; do source_psql "select to_regclass('$table') is null;"; done | grep -q '^t$'; then
    die "source DB is not the Counselle pipeline schema"
  fi
  printf 'row counts:\n'
  source_psql "select 'schools=' || count(*) from public.schools;"
  source_psql "select 'fields=' || count(*) from public.fields;"
  source_psql "select 'field_values=' || count(*) from public.field_values;"
}

check_target() {
  need_cmd psql
  need_target
  printf 'target database:\n'
  psql "$TARGET_ADMIN_DSN" -v ON_ERROR_STOP=1 -At -c "select current_database() || ' | ' || version();"
  psql "$TARGET_ADMIN_DSN" -v ON_ERROR_STOP=1 -At -c "create extension if not exists vector; create extension if not exists pg_trgm;"
  psql "$TARGET_ADMIN_DSN" -v ON_ERROR_STOP=1 -At -c "select extname || '=' || extversion from pg_extension where extname in ('vector','pg_trgm') order by extname;"
  local size
  size="$(psql "$TARGET_ADMIN_DSN" -v ON_ERROR_STOP=1 -At -c "select pg_database_size(current_database());")"
  printf 'target database size: %s\n' "$(bytes_human "$size")"
}

dump_pipeline() {
  need_cmd pg_dump
  check_source
  printf 'creating dump: %s\n' "$DUMP_PATH"
  source_dump
  local dump_bytes
  dump_bytes="$(file_size_bytes "$DUMP_PATH")"
  check_cap "dump file size" "$dump_bytes" "$MAX_DUMP_BYTES"
}

restore_pipeline() {
  need_cmd pg_restore
  need_target
  [[ -f "$DUMP_PATH" ]] || die "dump not found: $DUMP_PATH"
  check_target
  printf 'restoring dump into target...\n'
  pg_restore \
    --dbname="$TARGET_ADMIN_DSN" \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    --exit-on-error \
    "$DUMP_PATH"
}

make_role_dsn() {
  local role="$1" password="$2"
  python3 - "$TARGET_ADMIN_DSN" "$role" "$password" <<'PY'
import sys
from urllib.parse import quote, urlsplit, urlunsplit

dsn, role, password = sys.argv[1:]
parts = urlsplit(dsn)
userinfo = f"{quote(role)}:{quote(password, safe='')}"
host = parts.hostname or ""
if ":" in host and not host.startswith("["):
    host = f"[{host}]"
if parts.port:
    host = f"{host}:{parts.port}"
print(urlunsplit((parts.scheme, f"{userinfo}@{host}", parts.path, parts.query, parts.fragment)))
PY
}

role_dsns() {
  local ro_dsn app_dsn
  ro_dsn="$(make_role_dsn "counselle_ro" "$COUNSELLE_RO_PASSWORD")"
  app_dsn="$(make_role_dsn "counselle_app" "$COUNSELLE_APP_PASSWORD")"
  printf 'export COUNSELLE_DB_RO_DSN=%q\n' "$ro_dsn"
  printf 'export COUNSELLE_DB_APP_DSN=%q\n' "$app_dsn"
}

yoyo_dsn() {
  local dsn="$1"
  if [[ "$dsn" == *\?* ]]; then
    printf '%s&schema=counselle\n' "$dsn"
  else
    printf '%s?schema=counselle\n' "$dsn"
  fi
}

prepare_target_roles() {
  need_cmd psql
  need_target
  need_passwords
  check_target
  printf 'preparing Counselle roles/schema on target...\n'
  psql "$TARGET_ADMIN_DSN" \
    -v ON_ERROR_STOP=1 \
    -v ro_pw="$COUNSELLE_RO_PASSWORD" \
    -v app_pw="$COUNSELLE_APP_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE counselle_ro LOGIN PASSWORD %L', :'ro_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'counselle_ro') \gexec
SELECT format('CREATE ROLE counselle_app LOGIN PASSWORD %L', :'app_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'counselle_app') \gexec

ALTER ROLE counselle_ro PASSWORD :'ro_pw';
ALTER ROLE counselle_app PASSWORD :'app_pw';
ALTER ROLE counselle_ro SET default_transaction_read_only = on;
ALTER ROLE counselle_ro SET statement_timeout = '8s';

CREATE SCHEMA IF NOT EXISTS counselle AUTHORIZATION counselle_app;
GRANT USAGE ON SCHEMA counselle TO counselle_ro;
SQL
  role_dsns
}

bootstrap_counselle() {
  need_cmd psql
  need_target
  need_passwords
  printf 'bootstrapping Counselle roles/schema...\n'
  psql "$TARGET_ADMIN_DSN" \
    -v ON_ERROR_STOP=1 \
    -v ro_pw="$COUNSELLE_RO_PASSWORD" \
    -v app_pw="$COUNSELLE_APP_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE counselle_ro LOGIN PASSWORD %L', :'ro_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'counselle_ro') \gexec
SELECT format('CREATE ROLE counselle_app LOGIN PASSWORD %L', :'app_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'counselle_app') \gexec

ALTER ROLE counselle_ro PASSWORD :'ro_pw';
ALTER ROLE counselle_app PASSWORD :'app_pw';
ALTER ROLE counselle_ro SET default_transaction_read_only = on;
ALTER ROLE counselle_ro SET statement_timeout = '8s';

GRANT USAGE ON SCHEMA public, raw TO counselle_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO counselle_ro;
GRANT SELECT ON raw.scorecard_fos, raw.ipeds_ef2024a, raw.ipeds_valuesets24,
               raw.ipeds_vartable24, raw.files, raw.ipeds_hd2024, raw.ipeds_flags2024
       TO counselle_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO counselle_ro;

CREATE SCHEMA IF NOT EXISTS counselle AUTHORIZATION counselle_app;
GRANT USAGE ON SCHEMA counselle TO counselle_ro;
GRANT SELECT ON public.fields TO counselle_app;
SQL
  role_dsns
  local app_dsn
  app_dsn="$(make_role_dsn "counselle_app" "$COUNSELLE_APP_PASSWORD")"
  if [[ "$RUN_COUNSELLE_MIGRATIONS" == "1" ]]; then
    need_cmd uv
    printf 'running Counselle migrations...\n'
    COUNSELLE_DB_APP_DSN="$app_dsn" uv run yoyo apply --batch --database "$(yoyo_dsn "$app_dsn")" migrations/
  else
    printf 'migrations skipped; set RUN_COUNSELLE_MIGRATIONS=1 to apply them.\n'
  fi
}

verify_target_state() {
  need_cmd psql
  need_target
  need_passwords
  local ro_dsn app_dsn
  ro_dsn="$(make_role_dsn "counselle_ro" "$COUNSELLE_RO_PASSWORD")"
  app_dsn="$(make_role_dsn "counselle_app" "$COUNSELLE_APP_PASSWORD")"
  printf 'target pipeline counts via counselle_ro:\n'
  psql "$ro_dsn" -v ON_ERROR_STOP=1 -At -c "select 'schools=' || count(*) from public.schools;"
  psql "$ro_dsn" -v ON_ERROR_STOP=1 -At -c "select 'fields=' || count(*) from public.fields;"
  psql "$ro_dsn" -v ON_ERROR_STOP=1 -At -c "select 'field_values=' || count(*) from public.field_values;"
  printf 'target Counselle schema via counselle_app:\n'
  psql "$app_dsn" -v ON_ERROR_STOP=1 -At -c "select 'counselle_schema=' || coalesce(to_regnamespace('counselle')::text, 'missing');"
  psql "$app_dsn" -v ON_ERROR_STOP=1 -At -c "select 'field_index=' || coalesce(to_regclass('counselle.field_index')::text, 'missing');"
}

case "$MODE" in
  check-source)
    check_source
    ;;
  check-target)
    check_target
    ;;
  dump)
    dump_pipeline
    ;;
  restore)
    restore_pipeline
    ;;
  prepare-target)
    prepare_target_roles
    ;;
  bootstrap)
    bootstrap_counselle
    ;;
  verify)
    verify_target_state
    ;;
  migrate)
    dump_pipeline
    restore_pipeline
    bootstrap_counselle
    verify_target_state
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage
    exit 1
    ;;
esac
