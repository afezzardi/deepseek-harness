"""Prepare an upstream-service audit; directory names identify sessions, never decode them."""
import argparse
import os
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
from phoenix_dataset import Phoenix, atomic

root = Path(__file__).resolve().parents[4]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('campaign')
parser.add_argument('--template', help='Directory containing settings.yaml and cordis.patch.yml; defaults to versioned artifacts configuration')
parser.add_argument('--project', default='gh-training-v4')
mode = parser.add_mutually_exclusive_group(required=True)
mode.add_argument('--receipt', help='Pinned Phoenix task or previous promoted dataset receipt')
mode.add_argument('--audit-only', action='store_true', help='Reconstruct and grade without promotion')
parser.add_argument('--legacy-cwd', help='Explicit absolute cwd for historical trials that did not record it')
parser.add_argument('--legacy-cwd-evidence', help='Recorded runner or launch evidence establishing the historical cwd')
args = parser.parse_args()
if bool(args.legacy_cwd) != bool(args.legacy_cwd_evidence) or args.legacy_cwd and not Path(args.legacy_cwd).is_absolute():
    raise ValueError('Historical cwd requires an absolute --legacy-cwd and --legacy-cwd-evidence')
os.umask(0o077)
campaign = Path(args.campaign).resolve()
receipt = json.loads(Path(args.receipt).read_text()) if args.receipt else None
assignments = Phoenix().assignments(receipt) if receipt else []
if receipt and not assignments:
    raise ValueError('Pinned dataset has no split assignments')
trials = json.loads((campaign/'trials.json').read_text())
ids = set()
files = {}
for trial in trials:
    if not trial.get('cwd'):
        if not args.legacy_cwd:
            raise ValueError('Trial cwd missing; supply --legacy-cwd with --legacy-cwd-evidence')
        trial['cwd'] = args.legacy_cwd
    if not Path(trial['cwd']).is_absolute():
        raise ValueError('Recorded trial cwd must be absolute')
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
output.mkdir(exist_ok=True, mode=0o700)
output.chmod(0o700)
manifest = dict(assignments=assignments, dataset=receipt, output=str(output),sessionIds=sorted(ids),trials=trials,replay=True,revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip())
if args.legacy_cwd:
    manifest['historicalCwdEvidence'] = {'cwd': args.legacy_cwd, 'evidence': args.legacy_cwd_evidence}
atomic(campaign/'audit-manifest.json', manifest)
atomic(campaign/'source-hashes-before.json', files)
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
home.mkdir(exist_ok=True, mode=0o700)
for name in ['settings.yaml','cordis.patch.yml']:
    if not (home/name).exists():
        source = Path(args.template)/name if args.template else root/'artifacts'/('dsh-settings.yaml' if name == 'settings.yaml' else 'dsh-cordis.patch.yml')
        shutil.copyfile(source,home/name)
(campaign/'audit.patch.yml').write_text('- id: headless-startup\n  disabled: true\n- id: headless-runner\n  disabled: true\n- id: session-persistence-jsonl\n  config:\n    root: '+str(store_root)+'\n- id: gh-genai-traces\n  config:\n    content: rich-redacted\n    project: '+args.project+'\n    maxContentBytes: 1048576\n- insert:\n    - id: gh-audit\n      name: '+str(root/'artifacts/plugins/gh-genai-traces/lib/audit-profile.js')+'\n')
print(json.dumps(dict(sessions=len(ids),files=len(files))))
