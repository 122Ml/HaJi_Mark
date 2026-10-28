"""Bounded local links and source snapshot integrity checks; never accesses network."""
from pathlib import Path
import hashlib
import json
import re

root = Path(__file__).resolve().parents[1]
errors = []
files = [root / "README.md", root / "AGENTS.md", root / "CONTRIBUTING.md"]
files += list((root / "docs").rglob("*.md"))
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
for name in ("course", "assessment", "grading", "insight"):
    for relative in (f"web/src/features/{name}/index.tsx", f"backend/internal/{name}/README.md"):
        if not (root / relative).exists():
            errors.append(f"Missing module entrypoint: {relative}")
if errors:
    raise SystemExit("\n".join(errors))
print(f"PASS: {len(files)} current documents, {len(manifest['files'])} immutable source snapshots, four module entrypoints.")
