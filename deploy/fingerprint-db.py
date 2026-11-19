"""Compare existing column values across additive migrations without exporting rows."""
import json
import os
from pathlib import Path
import subprocess
import sys

mode, filename = sys.argv[1:3]
container = sys.argv[3] if len(sys.argv) > 3 else os.environ.get('HAJI_DB_CONTAINER', 'hajimark-production-postgres-1')
db_user = os.environ.get('HAJI_DB_USER', 'hajimark')
db_name = os.environ.get('HAJI_DB_NAME', 'hajimark')


def query(sql):
    return subprocess.check_output(
        ['docker', 'exec', container, 'psql', '-X', '-U', db_user, '-d', db_name, '-Atc', sql],
        text=True,
    ).strip()


def quoted(name):
    return '"' + name.replace('"', '""') + '"'


def fingerprint(table, columns):
    projection = ','.join(map(quoted, columns))
    sql = (
        "SELECT count(*)::text || ':' || "
        "COALESCE(sum(('x' || left(md5(to_jsonb(t)::text), 15))::bit(60)::bigint), 0)::text || ':' || "
        "COALESCE(bit_xor(hashtextextended(to_jsonb(t)::text, 42)), 0)::text "
        'FROM (SELECT ' + projection + ' FROM public.' + quoted(table) + ') t'
    )
    return query(sql)


path = Path(filename)
if mode == 'save':
    assert not path.exists(), 'Refusing to replace a fingerprint baseline'
    rows = query(
        "SELECT table_name,column_name FROM information_schema.columns "
        "WHERE table_schema='public' AND table_name<>'goose_db_version' "
        "ORDER BY table_name,ordinal_position"
    )
    tables = {}
    for row in rows.splitlines():
        table, column = row.split('|')
        tables.setdefault(table, {'columns': []})['columns'].append(column)
    for table, item in tables.items():
        item['fingerprint'] = fingerprint(table, item['columns'])
    path.write_text(json.dumps(tables, indent=2) + '\n', encoding='utf-8')
    print('FINGERPRINT_SAVED', len(tables), flush=True)
elif mode == 'verify':
    tables = json.loads(path.read_text(encoding='utf-8'))
    failures = [table for table, item in tables.items() if fingerprint(table, item['columns']) != item['fingerprint']]
    print('FINGERPRINT_VERIFIED', len(tables), 'mismatches', failures, flush=True)
    assert not failures, 'Existing column values changed'
else:
    raise SystemExit('Use save or verify')
