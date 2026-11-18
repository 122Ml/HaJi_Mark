"""Package only public viewer assets from the exact release commit."""
import hashlib
import html
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import io

root = Path(__file__).resolve().parents[1]
bundle = Path(sys.argv[1]).resolve()
release = json.loads((bundle / 'release.json').read_text(encoding='utf-8'))
commit = release['source_commit']

def committed(path):
    return subprocess.check_output(['git', 'show', commit + ':' + path], cwd=root)

files = {}
for group in ('atlas', 'current', 'interactions'):
    prefix = 'docs/diagrams/' + group + '/'
    # -z avoids Git's quoting of Chinese filenames.
    names = subprocess.check_output(['git', 'ls-tree', '-rz', '--name-only', commit, '--', prefix], cwd=root).decode().split('\0')
    for name in names:
        if name and (name.endswith(('.svg', '.png')) or name == prefix + 'index.html'):
            files[group + '/' + name[len(prefix):]] = committed(name)
for ext in ('svg', 'png'):
    files['agent/architecture.' + ext] = committed('docs/diagrams/agent/architecture.' + ext)
for name in ('index.html', 'app.css', 'app.js'):
    files['prototype/' + name] = committed('docs/prototypes/task-workspace/' + name)

def page(title, content):
    return ('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>' + title + '</title><style>body{font:16px/1.7 system-ui,sans-serif;max-width:960px;margin:40px auto;padding:0 20px}li{margin:16px 0}img{max-width:100%;height:auto}a{color:#00675c}small{color:#555}</style>'
            + content + '</html>').encode()

files['agent/index.html'] = page('HaJi Mark · 助理架构', '<a href="../">全部图册</a><h1>助理架构</h1><p>实现架构；公网生成模型未配置。</p><p><a href="architecture.svg">SVG</a> · <a href="architecture.png">PNG</a></p><img src="architecture.svg" alt="助理架构">')
files['index.html'] = page('HaJi Mark · 项目图册',
    '<h1>HaJi Mark · 项目图册</h1><p>2026-11-19 发布包 · <code>' + html.escape(release['source_tag']) + '</code> · <code>' + commit[:12] + '</code></p>'
    '<p>图中标注实现能力；公网模型未配置，AI生成、向量化及模型问答不可用。人工教学、常规解析与关键词检索可用。图形与应用运行验收范围分开记录。</p>'
    '<ul><li><a href="current/">全景业务与实现架构：5张</a> — 保留图中实现状态与未完成边界。</li>'
    '<li><a href="interactions/">师生交互泳道：10张</a> — 人工操作、确认、异步任务与异常分支；11月17日交互图基线，11月19日工作区修复见仓库验收记录。</li>'
    '<li><a href="agent/">对话助理架构</a> — 编排、授权执行及持久化；公网模型未配置。</li>'
    '<li><a href="atlas/">详细设计图册：27张</a> — 原设计基线，教师/学生概念角色已拆分；41表/103外键不是00016最新物理结构。</li>'
    '<li><a href="prototype/">工作台交互原型</a> — 示例数据，仅供设计参考。</li></ul><p><a href="/login">进入实际平台</a></p>')
record = {'release_id': release['release_id'], 'source_commit': commit, 'source_tag': release['source_tag'],
          'files': {n: hashlib.sha256(data).hexdigest() for n, data in sorted(files.items())}}
archive = bundle / 'diagrams.tar.gz'
assert not archive.exists(), 'Refusing to overwrite a diagram archive'
with tarfile.open(archive, 'w:gz') as tar:
    for name, data in sorted(files.items()):
        info = tarfile.TarInfo(name)
        info.size = len(data)
        info.mode = 0o644
        tar.addfile(info, io.BytesIO(data))
record['archive_sha256'] = hashlib.sha256(archive.read_bytes()).hexdigest()
(bundle / 'diagrams.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('DIAGRAMS_PACKAGED', len(files), archive.stat().st_size, record['archive_sha256'])
