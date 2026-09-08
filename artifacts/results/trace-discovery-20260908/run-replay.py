"""Replay explicit canonical sessions and compare stored-generation hashes."""
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
ids = json.loads((OUT/'session-ids.json').read_text())
files = [p for p in (OUT/'.sessions').rglob('*') if p.is_file() and p.parent.name in ids]
def hashes():
    return {str(p.relative_to(OUT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}
before = hashes()
argv = ['pnpm', 'dsh', '--profile', 'headless', '--patch', str(ROOT/'artifacts/plugins/gh-genai-traces/lib/overlay.yml'), '--patch', str(OUT/'discovery.patch.yml'), 'Reply with exactly REPLAY-READY. Do not use tools.']
env = dict(os.environ, DSH_HOME=str(OUT/'.home'), GH_GENAI_PROJECT='gh-discovery-20260908-canonical', GH_GENAI_REPLAY_SESSIONS=','.join(ids))
with (OUT/'replay.stdout.log').open('w') as stdout, (OUT/'replay.stderr.log').open('w') as stderr:
    result = subprocess.run(argv, cwd=ROOT, env=env, stdout=stdout, stderr=stderr, timeout=180)
after = hashes()
(OUT/'replay-integrity.json').write_text(json.dumps(dict(argv=argv, session_ids=ids, exit_code=result.returncode, unchanged=before==after, before=before, after=after),indent=2)+'\n')
print(json.dumps(dict(exit_code=result.returncode, sessions=len(ids), generations=len(files), unchanged=before==after)))
