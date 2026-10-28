"""Stage an explicit release archive through existing private R2; never start services.

Requires locally installed paramiko/boto3. The credential host is read-only;
R2 keys stay in memory, and the new server receives only a short-lived download.
"""
import argparse
import getpass
import hashlib
import io
import json
from pathlib import Path
import re
import time

import boto3
from boto3.s3.transfer import TransferConfig
from botocore.config import Config
import paramiko

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--bundle', type=Path, required=True)
parser.add_argument('--host', required=True)
parser.add_argument('--known-hosts', type=Path, required=True)
parser.add_argument('--credential-host', default='159.195.17.123')
parser.add_argument('--key', type=Path, default=Path.home() / '.ssh/id_ed25519')
parser.add_argument('--cleanup', action='store_true', help='Remove this release R2 object after verified remote load')
args = parser.parse_args()
record = json.loads((args.bundle / 'release.json').read_text(encoding='utf-8'))
release_id = record['release_id']
if not re.fullmatch(r'hajimark-[a-zA-Z0-9_-]{1,80}', release_id):
    raise SystemExit('Invalid release ID')
archive = args.bundle / record['archive']['file']
digest = hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest()
if digest != record['archive']['sha256']:
    raise SystemExit('Archive SHA256 does not match manifest')

with paramiko.SSHClient() as credential_host:
    credential_host.load_system_host_keys()
    key = paramiko.Ed25519Key.from_private_key(io.StringIO(args.key.read_text(encoding='utf-8')))
    credential_host.connect(args.credential_host, username='ops', pkey=key, timeout=20)
    _, stdout, _ = credential_host.exec_command('sudo -n cat /etc/hikari-backup/r2.env', timeout=20)
    content = stdout.read().decode()
    if stdout.channel.recv_exit_status() != 0:
        raise SystemExit('Could not read existing R2 configuration')
values = {}
for line in content.splitlines():
    if '=' in line and not line.lstrip().startswith('#'):
        name, value = line.split('=', 1)
        values[name.strip()] = value.strip().strip('\"').strip("'")
s3 = boto3.client('s3', endpoint_url=values['R2_ENDPOINT'], aws_access_key_id=values['R2_ACCESS_KEY_ID'],
                  aws_secret_access_key=values['R2_SECRET_ACCESS_KEY'], region_name='auto',
                  config=Config(signature_version='s3v4', s3={'addressing_style': 'path'}))
bucket = values['R2_BUCKET']
object_key = f'deploy/{release_id}/{digest[:16]}-{archive.name}'
password = getpass.getpass('Target SSH password: ')
with paramiko.SSHClient() as target:
    target.load_host_keys(str(args.known_hosts))
    target.connect(args.host, username='root', password=password, look_for_keys=False, allow_agent=False, timeout=20)
    target.get_transport().set_keepalive(20)
    if args.cleanup:
        command = 'python3 - <<\'PY\'\n' + f'release_id={release_id!r}\n' + '''
import json,subprocess
from pathlib import Path
p=Path('/opt/hajimark/releases')/release_id/'release.json'
record=json.loads(p.read_text())
for image in record['images']:
 actual=subprocess.check_output(['docker','image','inspect',image['tag'],'--format','{{.Id}}'],text=True).strip()
 assert actual==image['config_id']
print('REMOTE_IMAGES_MATCH')
PY'''
        _, stdout, _ = target.exec_command(command, timeout=30)
        if stdout.channel.recv_exit_status() != 0:
            raise SystemExit('Remote image verification failed; R2 object retained')
        s3.delete_object(Bucket=bucket, Key=object_key)
        print('R2 temporary object removed after remote image verification')
    else:
        progress = [0, 0.0]
        def uploaded(count):
            progress[0] += count
            if time.monotonic() - progress[1] > 5:
                print(f'R2_UPLOAD {progress[0]}/{archive.stat().st_size}', flush=True)
                progress[1] = time.monotonic()
        s3.upload_file(str(archive), bucket, object_key, ExtraArgs={'Metadata': {'sha256': digest}},
                       Callback=uploaded, Config=TransferConfig(max_concurrency=1))
        head = s3.head_object(Bucket=bucket, Key=object_key)
        assert head['ContentLength'] == archive.stat().st_size and head['Metadata']['sha256'] == digest
        url = s3.generate_presigned_url('get_object', Params={'Bucket': bucket, 'Key': object_key}, ExpiresIn=1800)
        code = f'config={dict(url=url,sha256=digest,release_id=release_id,file=archive.name)!r}\n' + '''
import hashlib,json,os,time,urllib.request
from pathlib import Path
os.umask(0o077)
folder=Path('/opt/hajimark/releases')/config['release_id'];folder.mkdir(mode=0o700)
destination=folder/config['file'];part=folder/(config['file']+'.part')
last=time.monotonic();size=0
with urllib.request.urlopen(config['url'],timeout=60) as source,part.open('xb') as output:
 while chunk:=source.read(1024*1024):
  output.write(chunk);size+=len(chunk)
  if time.monotonic()-last>5:
   print('REMOTE_DOWNLOAD',size,flush=True);last=time.monotonic()
digest=hashlib.sha256()
with part.open('rb') as stream:
 for chunk in iter(lambda:stream.read(1024*1024),b''): digest.update(chunk)
actual=digest.hexdigest()
assert actual==config['sha256']
part.rename(destination)
print('REMOTE_SHA256_VERIFIED',actual,flush=True)
'''
        stdin, stdout, stderr = target.exec_command('python3 -u -', timeout=180)
        stdin.write(code)
        stdin.channel.shutdown_write()
        for line in stdout:
            print(line.rstrip(), flush=True)
        if stdout.channel.recv_exit_status() != 0:
            raise SystemExit('Remote download failed; inspect destination; R2 object retained')
        with target.open_sftp() as sftp:
            sftp.put(str(args.bundle / 'release.json'), f'/opt/hajimark/releases/{release_id}/release.json')
        (args.bundle / 'transfer.json').write_text(json.dumps({'r2_object_key':object_key,'sha256':digest,'remote_download_verified':True},indent=2)+'\n',encoding='utf-8')
        print('STAGED; no containers changed')
