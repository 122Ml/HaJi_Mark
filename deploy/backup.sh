#!/bin/sh
set -eu
umask 077
mkdir -p /opt/hajimark/backups
file="/opt/hajimark/backups/hajimark-$(date -u +%Y%m%dT%H%M%SZ).dump"
test ! -e "$file"
docker compose --env-file /opt/hajimark/shared/.env -f /opt/hajimark/current/compose.production.yaml \
  exec -T postgres sh -c 'exec pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$file.part"
docker compose --env-file /opt/hajimark/shared/.env -f /opt/hajimark/current/compose.production.yaml \
  exec -T postgres pg_restore --list < "$file.part" > /dev/null
mv "$file.part" "$file"
sha256sum "$file" > "$file.sha256"
printf 'Backup verified: %s\n' "$file"
