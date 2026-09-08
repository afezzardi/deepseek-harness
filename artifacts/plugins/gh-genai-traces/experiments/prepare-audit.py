"""Prepare an upstream-service audit; directory names identify sessions, never decode them."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parents[4]
campaign = Path(sys.argv[1]).resolve()
trials = json.loads((campaign/'trials.json').read_text())
ids = set()
files = {}
for trial in trials:
    directory = Path(trial.get('directory') or trial['argv'][-2]).resolve()
    if directory.suffix == '.yml':
        directory = directory.parent
    trial['directory'] = str(directory)
    store = directory/'.sessions'
    trial['sessionIds'] = [p.name for p in store.glob('*/*') if p.is_dir()]
    ids.update(trial['sessionIds'])
for store in [campaign/'.sessions', *[Path(t['directory'])/'.sessions' for t in trials]]:
    if not store.exists():
        continue
    ids.update(p.name for p in store.glob('*/*') if p.is_dir())
    for file in store.rglob('*'):
        if file.is_file():
            files[str(file)] = hashlib.sha256(file.read_bytes()).hexdigest()
output = campaign/'audit'
output.mkdir(exist_ok=True)
manifest = dict(output=str(output),sessionIds=sorted(ids),trials=trials,replay=True,revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip())
(campaign/'audit-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(campaign/'source-hashes-before.json').write_text(json.dumps(files,indent=2)+'\n')
# Multiple per-trial stores share one parent; the upstream provider accepts its root.
store_root = campaign/'.sessions'
if not store_root.exists():
    store_root = campaign/'.audit-store'
    for trial in trials:
        for source in (Path(trial['directory'])/'.sessions').glob('*/*'):
            target = store_root/source.parent.name/source.name
            if not target.exists():
                shutil.copytree(source,target)
    # Byte copies retain released generations; all decoding remains upstream-owned.
home = campaign/'.audit-home'
home.mkdir(exist_ok=True)
for name in ['settings.yaml','cordis.patch.yml']:
    if not (home/name).exists():
        shutil.copyfile(root/'artifacts/results/trace-discovery-20260908/.home'/name,home/name)
(campaign/'audit.patch.yml').write_text('- id: session-persistence-jsonl\n  config:\n    root: '+str(store_root)+'\n- id: gh-genai-traces\n  config:\n    content: rich-redacted\n    project: gh-training\n    maxContentBytes: 1048576\n- insert:\n    - id: gh-audit\n      name: '+str(root/'artifacts/plugins/gh-genai-traces/lib/audit-profile.js')+'\n')
print(json.dumps(dict(sessions=len(ids),files=len(files))))
