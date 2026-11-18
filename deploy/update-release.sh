#!/bin/bash
# Started detached by the operator; logs and status survive SSH disconnection.
set -euo pipefail
umask 077
exec 9>/opt/hajimark/deployment.lock
flock -n 9 || { echo 'Another deployment holds the lock'; exit 1; }
cd /opt/hajimark/releases/__RELEASE__
trap 'code=$?; echo "$code" > deployment.exit; if [ "$code" != 0 ]; then echo "DEPLOYMENT_FAILED: retain logs and data; no automatic schema rollback"; fi' EXIT
test ! -e deployment.started
date -u +%FT%TZ > deployment.started
sha256sum -c <<<"__SHA256__  images.tar.gz"
test "$(basename "$(readlink -f /opt/hajimark/current)")" = '__PREVIOUS__'
readlink /opt/hajimark/current > .previous-current
docker load -i images.tar.gz
# Stop writers before the final backup and schema upgrade.
docker compose --env-file /opt/hajimark/shared/.env -f /opt/hajimark/current/compose.production.yaml stop web api worker
python3 ./fingerprint-db.py save ./database.before.json
/bin/sh /opt/hajimark/current/backup.sh
bash ./switch-release.sh __RELEASE__
