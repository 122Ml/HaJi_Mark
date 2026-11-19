"""Server-side: verify assets, preserve the old route, publish the diagram hub."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tarfile

release = Path(sys.argv[1]).resolve()
assert release.parent == Path('/opt/hajimark/releases')
record = json.loads((release / 'diagrams.json').read_text())
assert record['release_id'] == release.name
archive = release / 'diagrams.tar.gz'
assert hashlib.sha256(archive.read_bytes()).hexdigest() == record['archive_sha256']
base = Path('/opt/1panel/www/hajimark-static')
target = base / 'releases' / release.name
assert not target.exists(), 'Static release already exists'
with tarfile.open(archive) as tar:
    members = tar.getmembers()
    assert len(members) == len(record['files'])
    assert {m.name for m in members} == set(record['files'])
    for member in members:
        name = PurePosixPath(member.name)
        assert member.isfile() and not name.is_absolute() and '..' not in name.parts and '\\' not in member.name
        data = tar.extractfile(member).read()
        assert hashlib.sha256(data).hexdigest() == record['files'][member.name]
        dest = target / member.name
        dest.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        dest.write_bytes(data)
        dest.chmod(0o644)

conf = Path('/opt/1panel/www/conf.d/hajistudy.online.conf')
before = conf.read_text()
shutil.copy2(conf, release / 'hajistudy.online.before.conf')
assert 'location ^~ /diagrams/' not in before, 'Inspect an existing diagram hub before updating its config'
marker = ' location / { proxy_pass http://127.0.0.1:18080;'
assert before.count(marker) == 1
assert before.count('client_max_body_size 1m;') == 1
assert before.count('proxy_read_timeout 35s;') == 1
snippet = ''' location = /diagrams { return 301 /diagrams/; }
 location ^~ /diagrams/ {
  root /www/hajimark-static;
  index index.html;
  autoindex off;
  add_header Strict-Transport-Security "max-age=31536000" always;
  add_header X-Content-Type-Options nosniff always;
  add_header X-Frame-Options SAMEORIGIN always;
  add_header Referrer-Policy strict-origin-when-cross-origin always;
  add_header Content-Security-Policy "default-src 'self' 'unsafe-inline' data: blob:; frame-ancestors 'self'" always;
  try_files $uri $uri/ =404;
 }
'''
updated = before.replace(marker, snippet + marker).replace('client_max_body_size 1m;', 'client_max_body_size 310m;').replace('proxy_read_timeout 35s;', 'proxy_read_timeout 120s; proxy_buffering off;')
old_links = {}
for name in ('design-atlas', 'diagrams'):
    link = base / name
    assert link.is_symlink() or not link.exists()
    old_links[name] = os.readlink(link) if link.is_symlink() else None
record['previous_links'] = old_links
(release / 'diagrams.before.json').write_text(json.dumps(record, indent=2) + '\n')

def select(name, value):
    link = base / name
    nxt = base / ('.next-' + name)
    assert not nxt.exists() and not nxt.is_symlink()
    nxt.symlink_to(value)
    os.replace(nxt, link)

container = '1Panel-openresty-VndB'
try:
    select('diagrams', 'releases/' + release.name)
    select('design-atlas', 'releases/' + release.name + '/atlas')
    conf.write_text(updated)
    subprocess.run(['docker', 'exec', container, 'nginx', '-t'], check=True)
    subprocess.run(['docker', 'exec', container, 'nginx', '-s', 'reload'], check=True)
except Exception:
    shutil.copy2(release / 'hajistudy.online.before.conf', conf)
    for name, value in old_links.items():
        if value is not None:
            select(name, value)
        elif (base / name).is_symlink():
            (base / name).unlink()
    subprocess.run(['docker', 'exec', container, 'nginx', '-t'], check=True)
    subprocess.run(['docker', 'exec', container, 'nginx', '-s', 'reload'], check=True)
    raise
record['published_path'] = str(target)
record['config_sha256'] = hashlib.sha256(conf.read_bytes()).hexdigest()
(release / 'diagrams.published.json').write_text(json.dumps(record, indent=2) + '\n')
print('DIAGRAMS_PUBLISHED', len(record['files']), flush=True)
