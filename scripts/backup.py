"""Create a local PostgreSQL custom-format backup without shell redirection.

The resulting .local/backups file contains private course/account records.
Keep it local and protect it like the database. Never deletes existing backups.
"""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import subprocess
import argparse
import uuid

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--verify-restore',action='store_true',help='Restore into an isolated temporary database, inspect and drop only that database')
args=parser.parse_args()

root = Path(__file__).resolve().parents[1]
folder = root / '.local' / 'backups'
folder.mkdir(parents=True, exist_ok=True)
target = folder / ('hajimark-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ') + '.dump')
with target.open('xb') as stream:
    subprocess.run(['docker', 'compose', 'exec', '-T', 'postgres', 'sh', '-c',
                    'exec pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
                   cwd=root, stdout=stream, check=True)
with target.open('rb') as stream:
    listing = subprocess.run(['docker', 'compose', 'exec', '-T', 'postgres', 'pg_restore', '--list'],
                             cwd=root, stdin=stream, capture_output=True, check=True)
metadata = {'file': target.name, 'bytes': target.stat().st_size,
            'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
            'archive_listing_verified': bool(listing.stdout),
            'restore_exercised': False}
if args.verify_restore:
    database='hajimark_restore_'+uuid.uuid4().hex
    assert database.startswith('hajimark_restore_') and database.replace('_','').isalnum()
    def command(script,*extra,**kwargs):
        return subprocess.run(['docker','compose','exec','-T','postgres','sh','-c',script,'restore-check',*extra],cwd=root,check=True,**kwargs)
    command('exec createdb -U "$POSTGRES_USER" "$1"',database)
    try:
        with target.open('rb') as stream:
            command('exec pg_restore --exit-on-error -U "$POSTGRES_USER" -d "$1"',database,stdin=stream)
        tables=('submissions','grading_revisions','material_sources','material_assets','knowledge_topics','knowledge_entries','bank_question_versions','content_decisions','regrade_batches','regrade_items')
        query=' '.join('SELECT count(*) FROM '+table+';' for table in tables)
        check=command('exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1" -At -c "$2"',database,query,capture_output=True)
        counts=[int(v) for v in check.stdout.decode().splitlines()]
        metadata['restore_exercised']=True
        metadata['restored_record_counts']=dict(zip(tables,counts))
        print('PASS: isolated database restore and teaching record queries')
    finally:
        command('exec dropdb -U "$POSTGRES_USER" "$1"',database)
target.with_suffix('.json').write_text(json.dumps(metadata, indent=2), encoding='utf8')
print(f'Backup saved and pg_restore archive listing verified: {target}')
if not args.verify_restore:
    print('This validates archive readability. Use --verify-restore for an isolated restore rehearsal.')
