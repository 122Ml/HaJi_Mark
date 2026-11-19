#!/bin/sh
set -eu
umask 077

usage() {
  printf 'Usage: %s <dump-file> <target-db> [--force-live]\n' "$0" >&2
}

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  usage
  exit 1
fi

dump="$1"
target_db="$2"
force_live=0

if [ "$#" -eq 3 ]; then
  if [ "$3" = "--force-live" ]; then
    force_live=1
  else
    printf 'Unknown option: %s\n' "$3" >&2
    usage
    exit 1
  fi
fi

if [ ! -f "$dump" ]; then
  printf 'Dump file not found: %s\n' "$dump" >&2
  exit 1
fi

nl=$(printf '\n_')
nl=${nl%_}
case "$target_db" in
  *"$nl"*)
    printf 'Invalid target database name\n' >&2
    exit 1
    ;;
esac
if ! printf '%s\n' "$target_db" | LC_ALL=C grep -Eq '^[A-Za-z_][A-Za-z0-9_]{0,62}$'; then
  printf 'Invalid target database name: %s\n' "$target_db" >&2
  exit 1
fi

env_file="/opt/hajimark/shared/.env"
compose_file="/opt/hajimark/current/compose.production.yaml"

read_env_var() {
  _rev_key="$1"
  _rev_file="$2"
  [ -r "$_rev_file" ] || return 0
  awk -v k="$_rev_key" '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
    {
      line = $0
      sub(/^[[:space:]]*(export[[:space:]]+)?/, "", line)
      idx = index(line, "=")
      if (idx == 0) next
      name = substr(line, 1, idx - 1)
      sub(/[[:space:]]+$/, "", name)
      if (name != k) next
      val = substr(line, idx + 1)
      sub(/^[[:space:]]+/, "", val)
      sub(/[[:space:]]+$/, "", val)
      sq = sprintf("%c", 39)
      if ((substr(val, 1, 1) == "\"" && substr(val, length(val), 1) == "\"") ||
          (substr(val, 1, 1) == sq && substr(val, length(val), 1) == sq)) {
        if (length(val) >= 2) val = substr(val, 2, length(val) - 2)
      }
      found = val
    }
    END { if (found != "") printf "%s", found }
  ' "$_rev_file"
}

if [ -z "${POSTGRES_USER:-}" ]; then
  POSTGRES_USER=$(read_env_var POSTGRES_USER "$env_file")
fi
POSTGRES_USER="${POSTGRES_USER:-hajimark}"
case "$POSTGRES_USER" in
  *"$nl"*)
    printf 'Invalid POSTGRES_USER\n' >&2
    exit 1
    ;;
esac
if ! printf '%s\n' "$POSTGRES_USER" | LC_ALL=C grep -Eq '^[A-Za-z_][A-Za-z0-9_-]{0,62}$'; then
  printf 'Invalid POSTGRES_USER: %s\n' "$POSTGRES_USER" >&2
  exit 1
fi

if [ -z "${POSTGRES_DB:-}" ]; then
  POSTGRES_DB=$(read_env_var POSTGRES_DB "$env_file")
fi
POSTGRES_DB="${POSTGRES_DB:-hajimark}"

if [ "$target_db" = "$POSTGRES_DB" ] && [ "$force_live" -ne 1 ]; then
  printf 'Refusing to restore into live database %s without --force-live\n' "$target_db" >&2
  exit 1
fi

if [ -f "$dump.sha256" ]; then
  if [ "$(grep -c . "$dump.sha256")" -ne 1 ]; then
    printf 'Invalid checksum file: %s\n' "$dump.sha256" >&2
    exit 1
  fi
  dump_dir=$(dirname "$dump")
  dump_base=$(basename "$dump")
  expected_line=$(head -n 1 "$dump.sha256")
  expected_target=${expected_line#* }
  expected_target=${expected_target# }
  expected_target=${expected_target#\*}
  if [ "$expected_target" = "$dump_base" ]; then
    (cd "$dump_dir" && sha256sum -c "$dump_base.sha256")
  elif [ "$expected_target" = "$dump" ]; then
    sha256sum -c "$dump.sha256"
  elif [ "$(basename "$expected_target")" = "$dump_base" ]; then
    expected_hash=${expected_line%% *}
    printf '%s  %s\n' "$expected_hash" "$dump" | sha256sum -c -
  else
    printf 'Checksum file %s does not match dump %s\n' "$dump.sha256" "$dump" >&2
    exit 1
  fi
fi

docker compose --env-file "$env_file" -f "$compose_file" \
  exec -T postgres pg_restore --list < "$dump" > /dev/null

db_exists=$(printf "SELECT 1 FROM pg_database WHERE datname = :'db';\n" | \
  docker compose --env-file "$env_file" -f "$compose_file" exec -T postgres \
  psql -X -v ON_ERROR_STOP=1 -v "db=$target_db" -U "$POSTGRES_USER" -d postgres -At)

if [ "$db_exists" = "1" ] && [ "$force_live" -ne 1 ]; then
  printf 'Refusing to restore into existing database %s without --force-live\n' "$target_db" >&2
  exit 1
fi

if [ "$db_exists" != "1" ]; then
  docker compose --env-file "$env_file" -f "$compose_file" exec -T postgres \
    createdb -U "$POSTGRES_USER" "$target_db"
fi

if [ "$force_live" -eq 1 ]; then
  docker compose --env-file "$env_file" -f "$compose_file" \
    exec -T postgres pg_restore --clean --if-exists --no-owner --no-privileges \
    -U "$POSTGRES_USER" -d "$target_db" < "$dump"
else
  docker compose --env-file "$env_file" -f "$compose_file" \
    exec -T postgres pg_restore --no-owner --no-privileges \
    -U "$POSTGRES_USER" -d "$target_db" < "$dump"
fi

printf 'Restore completed: %s -> %s\n' "$dump" "$target_db"
