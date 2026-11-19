"""Bounded local links and source snapshot integrity checks; never accesses network."""
from pathlib import Path
import hashlib
import json
import re

root = Path(__file__).resolve().parents[1]
errors = []
files = [root / "README.md", root / "AGENTS.md", root / "CONTRIBUTING.md", root / "design.md"]
files += list((root / "docs").rglob("*.md"))
files += list((root / "deploy").glob("*.md"))
files += [root / "references/README.md"]
for path in files:
    content = path.read_text(encoding="utf-8")
    for target in re.findall(r"\]\(([^)]+)\)", content):
        if target.startswith(("http:", "https:", "#", "mailto:")):
            continue
        relative = target.split("#", 1)[0].strip("<>")
        if relative and not (path.parent / relative).exists():
            errors.append(f"{path.relative_to(root)}: missing {relative}")
manifest = json.loads((root / "references/manifest.json").read_text(encoding="utf-8"))
for item in manifest["files"]:
    source = root / item["snapshot"]
    if hashlib.sha256(source.read_bytes()).hexdigest() != item["sha256"]:
        errors.append(f"Changed historical snapshot: {item['snapshot']}")
contributions = root / 'references/contributions/manifest.json'
if contributions.exists():
    for item in json.loads(contributions.read_text(encoding='utf-8'))['files']:
        if hashlib.sha256((contributions.parent / item['path']).read_bytes()).hexdigest() != item['sha256']:
            errors.append(f"Changed contribution patch: {item['path']}")
for name in ("course", "assessment", "grading", "insight"):
    for relative in (f"web/src/features/{name}/index.tsx", f"backend/internal/{name}/README.md"):
        if not (root / relative).exists():
            errors.append(f"Missing module entrypoint: {relative}")
api_inv_path = root / "docs/api-inventory.json"
if api_inv_path.exists():
    api_inv = json.loads(api_inv_path.read_text(encoding="utf-8"))
    route_files = ['server/router.go', 'course/http.go', 'identity/session.go', 'identity/context.go',
                   'learning/http.go', 'learning/materials.go', 'learning/question_bank.go', 'learning/topics.go', 'learning/intelligence.go', 'agent/http.go']
    cur_hash = hashlib.sha256(''.join((root / 'backend/internal' / f).read_text(encoding='utf-8') for f in route_files).encode()).hexdigest()
    if api_inv.get("source_sha256") != cur_hash:
        errors.append("Out-of-date docs/api-inventory.json source_sha256 (run python scripts/api-inventory.py)")
if errors:
    raise SystemExit("\n".join(errors))
print(f"PASS: {len(files)} current documents, {len(manifest['files'])} immutable source snapshots, four module entrypoints.")
