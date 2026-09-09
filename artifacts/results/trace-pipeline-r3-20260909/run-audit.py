"""Supervise a fresh artifact audit; stop its owned process group after durable output."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

root = Path(__file__).resolve().parents[3]
campaign = Path(sys.argv[1]).resolve()
summary = campaign / 'audit/summary.json'
if summary.exists():
    raise RuntimeError('Use a fresh audit output; an existing summary cannot prove this run completed')
argv = ['pnpm', 'dsh', '--profile', 'headless', '--patch', 'artifacts/plugins/gh-genai-traces/lib/overlay.yml',
        '--patch', str(campaign / 'audit.patch.yml')]
with (campaign / 'audit-process.log').open('w') as stream:
    process = subprocess.Popen(argv, cwd=root, env={**os.environ, 'DSH_HOME': str(campaign / '.audit-home'),
                               'GH_AUDIT_MANIFEST': str(campaign / 'audit-manifest.json')}, stdout=stream, stderr=stream, start_new_session=True)
    deadline = time.monotonic() + 900
    try:
        while not summary.exists() and process.poll() is None and time.monotonic() < deadline:
            time.sleep(0.2)
        if not summary.exists():
            raise RuntimeError('Audit exited or exceeded its deadline without a durable summary')
        result = json.loads(summary.read_text())
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
    receipt = {'summaryWritten': True, 'supervisorStoppedAfterSummary': True, 'launcherExitCode': process.returncode,
               'graded': result['graded'], 'sessions': result['sessions'], 'failures': result['failures'],
               'eligibleTargets': result['eligibleTargets'], 'telemetryErrors': sum('error' in item for item in result['telemetry'])}
    (campaign / 'audit-process-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt))
