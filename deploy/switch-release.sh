#!/bin/bash
# Execute only from update-release.sh after backup and image load.
set -euo pipefail
umask 077
target=/opt/hajimark/releases/$1
cd "$target"
python3 - "$target" <<'PY'
import json, subprocess, sys
from pathlib import Path
release = Path(sys.argv[1])
manifest = json.loads((release/'release.json').read_text())
assert Path('/opt/hajimark/current').resolve().name == manifest['previous_release'], 'Current release changed'
tags = {}
for item in manifest['images']:
    actual = json.loads(subprocess.check_output(['docker','image','inspect',item['tag']], text=True))[0]
    assert actual['Id'] in (item['local_image_id'], item['config_id']), item['tag']
    assert actual['Config']['Labels']['org.opencontainers.image.revision'] == manifest['source_commit']
    kind = next(k for k in ('backend','worker','web','postgres') if item['tag'].startswith('hajimark-'+k+':'))
    tags[kind.upper()+'_IMAGE'] = item['tag']
env = Path('/opt/hajimark/shared/.env')
lines = env.read_text().splitlines()
(release/'.env.before-switch').write_text(env.read_text())
out = [f'{k}={tags[k]}' if (k:=l.split('=',1)[0]) in tags else l for l in lines]
existing = {l.split('=',1)[0] for l in lines}
out.extend(f'{k}={v}' for k,v in tags.items() if k not in existing)
candidate = release/'.env.candidate'
candidate.write_text('\n'.join(out)+'\n')
candidate.chmod(0o600)
print('CANDIDATE_IMAGES_VERIFIED', manifest['release_id'], flush=True)
PY
dc=(docker compose --env-file "$target/.env.candidate" -f "$target/compose.production.yaml")
"${dc[@]}" config -q
"${dc[@]}" up -d --no-build --no-deps --wait --wait-timeout 150 postgres
"${dc[@]}" run --rm --no-deps migrate
python3 ./fingerprint-db.py verify ./database.before.json
"${dc[@]}" up -d --no-build --no-deps --wait --wait-timeout 150 api worker web
curl -fsS --max-time 10 http://127.0.0.1:18080/api/v1/health/ready
curl -fsS --max-time 10 http://127.0.0.1:18080/login -o /dev/null
# current records the verified selection, never an untested candidate.
python3 - "$target" <<'PY'
import json, os, sys
from pathlib import Path
release = Path(sys.argv[1])
manifest = json.loads((release/'release.json').read_text())
assert Path('/opt/hajimark/current').resolve().name == manifest['previous_release']
env = Path('/opt/hajimark/shared/.env')
assert env.read_bytes() == (release/'.env.before-switch').read_bytes(), 'Shared environment changed'
nxt = env.with_name('.env.next')
nxt.write_bytes((release/'.env.candidate').read_bytes())
nxt.chmod(0o600)
os.replace(nxt, env)
link = Path('/opt/hajimark/.current-next')
assert not link.exists() and not link.is_symlink()
link.symlink_to(release)
os.replace(link, '/opt/hajimark/current')
PY
printf '\nSWITCHED %s\n' "$1"
