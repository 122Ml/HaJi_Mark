"""Read structural catalog metadata only from the local Compose database."""
import hashlib
import json
from pathlib import Path
import subprocess

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
SQL="""
SELECT json_build_object(
 'tables', (SELECT json_agg(t ORDER BY name) FROM (
   SELECT c.relname name,
   (SELECT json_agg(json_build_object('name',a.attname,'nullable',NOT a.attnotnull) ORDER BY a.attnum)
      FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) columns,
   (SELECT json_agg(json_build_object('name',k.conname,'kind',k.contype,'definition',pg_get_constraintdef(k.oid)) ORDER BY k.conname)
      FROM pg_constraint k WHERE k.conrelid=c.oid) constraints
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind='r' AND c.relname<>'goose_db_version'
 )t),
 'foreign_keys',(SELECT json_agg(json_build_object('from',c.relname,'to',p.relname,'definition',pg_get_constraintdef(k.oid)) ORDER BY c.relname,k.conname)
 FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_class p ON p.oid=k.confrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND k.contype='f')
);
"""
result=subprocess.run(['docker','compose','exec','-T','postgres','psql','-U','hajimark','-d','hajimark','-At','-v','ON_ERROR_STOP=1'],input=SQL,text=True,encoding='utf-8',capture_output=True,cwd=ROOT,check=True)
data=json.loads(result.stdout)
data['migrations']={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((ROOT/'backend/db/migrations').glob('*.sql'))}
(HERE/'schema.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(f"Captured {len(data['tables'])} tables / {len(data['foreign_keys'])} foreign keys; no business rows read")
