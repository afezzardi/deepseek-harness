"""Run three trials per pinned Phoenix task through supported DSH profiles."""
import argparse
import concurrent.futures
import hashlib
import importlib.util
import threading
import json
import os
from pathlib import Path
import signal
import subprocess
import time
from phoenix_dataset import Phoenix, atomic, digest

ROOT = Path(__file__).resolve().parents[4]


def inventory(directory):
    result = {}
    for file in sorted(directory.rglob('*')):
        kind = 'symlink' if file.is_symlink() else 'file' if file.is_file() else 'directory' if file.is_dir() else 'other'
        result[str(file.relative_to(directory))] = {'kind': kind, 'hash': hashlib.sha256(file.read_bytes()).hexdigest() if kind == 'file' else None}
    return result


def execute(task, repetition, output, template, proxy):
    trial = task['task_id'] + '-' + str(repetition)
    directory = output / '.trials' / trial
    template_settings = (template / 'settings.yaml').read_text()
    if 'http://100.108.76.12:4000/engine/v1' not in template_settings:
        raise ValueError('Expected the declared Qwen inference route in the settings template')
    settings = template_settings.replace('http://100.108.76.12:4000/engine/v1', proxy + '/engine/v1')
    identity = digest({'task': task, 'repetition': repetition, 'settings': template_settings, 'runner': 3})
    result_file = directory / 'result.json'
    if result_file.exists():
        prior = json.loads(result_file.read_text())
        if prior['run_identity'] == identity:
            return prior
        raise RuntimeError('Existing trial inputs differ; allocate a deliberately new collection directory')
    directory.mkdir(parents=True, exist_ok=False, mode=0o700)
    workspace, home = directory / 'fixture', directory / 'home'
    workspace.mkdir(mode=0o700); home.mkdir(mode=0o700)
    for name, content in task['files'].items():
        if Path(name).is_absolute() or '..' in Path(name).parts:
            raise ValueError('Unsafe fixture path')
        file = workspace / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(content)
    (home / 'settings.yaml').write_text(settings)
    (home / 'cordis.patch.yml').write_bytes((template / 'cordis.patch.yml').read_bytes())
    prompt = task['prompt'].replace('{workspace}', str(workspace.relative_to(ROOT)))
    manifest = {**task, 'trial': trial, 'repetition': repetition, 'directory': str(directory), 'workspace': str(workspace),
                'prompt': prompt, 'before': inventory(workspace), 'run_identity': identity}
    manifest['review'] = {'reviewer': 'artifact-synthetic-fixture-policy-v2', 'evidence': 'pinned Phoenix task ' + task['task_id'],
                          'taskHash': digest({k: manifest[k] for k in ['prompt', 'before', 'outputs', 'expected']})}
    atomic(directory / 'task.json', manifest)
    patch = directory / 'trace.patch.yml'
    patch.write_text('- id: session-persistence-jsonl\n  config:\n    root: ' + str(directory / '.sessions') + '\n- id: gh-genai-traces\n  config:\n    content: rich-redacted\n    project: gh-training-v3-live\n    metadata: ' + json.dumps({'task': task['task_id'], 'trial': trial, 'family': task['family'], 'reasoning': 'medium'}) + '\n')
    with patch.open('a') as stream:
        stream.write('- insert:\n    - id: gh-benchmark-policy\n      name: ' + str(ROOT / 'artifacts/plugins/gh-genai-traces/lib/benchmark-profile.js') + '\n      config:\n        effort: medium\n')
    argv = ['pnpm', 'dsh', '--profile', 'headless', '--patch', str(ROOT / 'artifacts/plugins/gh-genai-traces/lib/overlay.yml'), '--patch', str(patch), prompt]
    started = time.time()
    timed_out, exit_code, error = False, None, None
    if task.get('driver') not in (None, 'resume-two-turns'):
        raise ValueError('Unsupported lifecycle driver: ' + task['driver'])
    if task.get('driver') == 'resume-two-turns':
        atomic(directory / 'lifecycle.json', {'prompt': prompt, 'continuation': task['continuation']})
        with patch.open('a') as stream:
            stream.write('- id: headless-startup\n  disabled: true\n- id: headless-runner\n  disabled: true\n- insert:\n    - id: gh-lifecycle\n      name: ' + str(ROOT / 'artifacts/plugins/gh-genai-traces/lib/lifecycle-profile.js') + '\n')
        argv.pop()
    if not error:
        with (directory / 'stdout.log').open('w') as stdout, (directory / 'stderr.log').open('w') as stderr:
            process = subprocess.Popen(argv, cwd=ROOT, env={**os.environ, 'DSH_HOME': str(home), 'GH_LIFECYCLE_TASK': str(directory / 'lifecycle.json')}, stdout=stdout, stderr=stderr, start_new_session=True)
            try:
                process.wait(timeout=300)
            except subprocess.TimeoutExpired:
                timed_out = True
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL); process.wait()
            exit_code = process.returncode
    result = {**manifest, 'started': started, 'ended': time.time(), 'exit_code': exit_code if exit_code is not None else -1,
              'timed_out': timed_out, 'execution_error': error, 'failure_owner': 'harness' if error else 'unclassified',
              'sessionIds': [p.name for p in (directory / '.sessions').glob('*/*') if p.is_dir()]}
    atomic(result_file, result)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('receipt'); parser.add_argument('output')
    parser.add_argument('--template', default=str(ROOT / 'artifacts/results/trace-discovery-20260908/.home'))
    parser.add_argument('--upstream', default='http://100.108.76.12:4000')
    parser.add_argument('--workers', type=int, choices=range(1, 5), default=4)
    args = parser.parse_args()
    os.umask(0o077)
    client, receipt = Phoenix(), json.loads(Path(args.receipt).read_text())
    client.verify(receipt)
    examples = client.examples(receipt['datasetId'], receipt['datasetVersion'])
    tasks = [e['input']['task'] for e in examples if e['id'] in receipt['rowHashes']]
    if len(tasks) != 48 or len({t['family'] for t in tasks}) != 12:
        raise ValueError('Expected the complete frozen balanced benchmark')
    output = Path(args.output).resolve(); output.mkdir(parents=True, exist_ok=True, mode=0o700)
    atomic(output / 'manifest.json', {'version': 2, 'dataset': receipt, 'count': 144, 'workers': args.workers, 'reasoning': 'medium'})
    os.environ.update({'UPSTREAM': args.upstream, 'RECLOG': str(output / '.recordings.jsonl'), 'REC_CONCURRENCY': '4'})
    spec = importlib.util.spec_from_file_location('gh_campaign_proxy', ROOT / 'artifacts/recproxy.py')
    proxy_module = importlib.util.module_from_spec(spec); spec.loader.exec_module(proxy_module)
    server = proxy_module.S(('127.0.0.1', 0), proxy_module.H)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True); server_thread.start()
    proxy = 'http://127.0.0.1:' + str(server.server_address[1])
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = [pool.submit(execute, task, repetition, output, Path(args.template), proxy) for task in tasks for repetition in range(1, 4)]
            results = [future.result() for future in futures]
    finally:
        server.shutdown(); server.server_close(); server_thread.join()
    atomic(output / 'trials.json', results)
    print(json.dumps({'trials': len(results), 'instances': len(tasks), 'families': 12}))
