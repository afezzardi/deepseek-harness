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
IDENTITY_PATHS = ['.', ':(exclude)artifacts/results/**']


def working_tree():
    """Keep generated campaign evidence outside the executable working-tree identity."""
    return {name: subprocess.check_output(['git', *argv, '--', *IDENTITY_PATHS], cwd=ROOT)
            for name, argv in [('diff', ['diff', 'HEAD', '--binary']),
                               ('status', ['status', '--porcelain=v1', '-z', '--untracked-files=all'])]}


def execution_identity(template):
    """Bind trial reuse to the configuration and executable artifact files."""
    plugin = ROOT / 'artifacts/plugins/gh-genai-traces'
    untracked = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', '-z', '--', *IDENTITY_PATHS], cwd=ROOT).decode().split('\0')
    files = {plugin / 'experiments/balanced_campaign.py', ROOT / 'artifacts/recproxy.py', template / 'settings.yaml', template / 'cordis.patch.yml',
             *(p for p in (plugin / 'lib').iterdir() if p.is_file()),
             *(p for directory in ['src', 'experiments'] for p in (plugin / directory).rglob('*') if p.suffix in ['.ts', '.py']),
             *(ROOT / name for name in untracked if name and (ROOT / name).is_file())}
    return {'revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
            'workingTree': {name: hashlib.sha256(data).hexdigest() for name, data in working_tree().items()},
            'files': {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(files)}}


def preserve_implementation(output, implementation):
    """Retain exact source/configuration bytes and the Git patch before collection."""
    archive = output / '.implementation'
    archive.mkdir(exist_ok=True, mode=0o700)
    for name, expected in implementation['files'].items():
        data = (ROOT / name).read_bytes()
        if hashlib.sha256(data).hexdigest() != expected:
            raise RuntimeError('Executable changed during capture: ' + name)
        target = archive / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and target.read_bytes() != data:
            raise RuntimeError('Retained executable differs: ' + str(target))
        target.write_bytes(data)
    for name, data in working_tree().items():
        if hashlib.sha256(data).hexdigest() != implementation['workingTree'][name]:
            raise RuntimeError('Working tree changed during capture')
        (archive / ('git-' + name)).write_bytes(data)
    atomic(archive / 'identity.json', implementation)


def verify_preflight_recordings(recording):
    """Reject any proxy activity; even an admission without a response is unexpected."""
    rows = [] if not recording.exists() else [json.loads(line) for line in recording.read_text().splitlines() if line.strip()]
    if rows:
        raise RuntimeError('Preflight emitted proxy traffic: ' + str(recording))
    return {'recording': str(recording), 'recordedEvents': len(rows)}


def inventory(directory):
    result = {}
    for file in sorted(directory.rglob('*')):
        kind = 'symlink' if file.is_symlink() else 'file' if file.is_file() else 'directory' if file.is_dir() else 'other'
        result[str(file.relative_to(directory))] = {'kind': kind, 'hash': hashlib.sha256(file.read_bytes()).hexdigest() if kind == 'file' else None}
    return result


def execute(task, repetition, output, template, proxy, implementation=None, preflight=False, effort="medium", project="gh-training-v4-live"):
    trial = task['task_id'] + '-' + str(repetition)
    directory = output / '.trials' / trial
    template_settings = (template / 'settings.yaml').read_text()
    if 'http://100.108.76.12:4000/engine/v1' not in template_settings:
        raise ValueError('Expected the declared Qwen inference route in the settings template')
    settings = template_settings.replace('http://100.108.76.12:4000/engine/v1', proxy + '/engine/v1')
    implementation = implementation or execution_identity(template)
    identity = digest({'task': task, 'repetition': repetition, 'implementation': implementation, 'cwd': str(ROOT), 'runner': 7, 'preflight': preflight, 'effort': effort, 'project': project})
    result_file = directory / 'result.json'
    if result_file.exists():
        prior = json.loads(result_file.read_text())
        if prior['run_identity'] == identity:
            return prior
        raise RuntimeError('Existing trial inputs differ; allocate a deliberately new collection directory')
    if directory.exists():
        raise RuntimeError('Interrupted trial has no result.json: ' + str(directory) + '; preserve it and use a fresh campaign directory')
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
                'prompt': prompt, 'before': inventory(workspace), 'run_identity': identity, 'cwd': str(ROOT)}
    manifest['review'] = {'reviewer': 'artifact-synthetic-fixture-policy-v2', 'evidence': 'pinned Phoenix task ' + task['task_id'],
                          'taskHash': digest({k: manifest[k] for k in ['prompt', 'before', 'outputs', 'expected']})}
    atomic(directory / 'task.json', manifest)
    patch = directory / 'trace.patch.yml'
    patch.write_text('- id: session-persistence-jsonl\n  config:\n    root: ' + str(directory / '.sessions') + '\n- id: gh-genai-traces\n  config:\n    content: rich-redacted\n    project: ' + project + '\n    metadata: ' + json.dumps({'task': task['task_id'], 'trial': trial, 'family': task['family'], 'reasoning': effort}) + '\n')
    with patch.open('a') as stream:
        stream.write('- insert:\n    - id: gh-benchmark-policy\n      name: ' + str(ROOT / 'artifacts/plugins/gh-genai-traces/lib/benchmark-profile.js') + '\n      config: ' + json.dumps({'effort': effort, 'rootTools': task['allowed_tools'], 'childTools': task['child_tools']}) + '\n')
        stream.write('- id: tool-subagent\n  config:\n    provider: spawn\n    toolName: subagent\n    backgroundMode: ' + task['delegation_mode'] + '\n    enableRunInBackground: true\n    toolFilter:\n      allow: [read]\n')
    argv = ['pnpm', 'dsh', '--profile', 'headless', '--patch', str(ROOT / 'artifacts/plugins/gh-genai-traces/lib/overlay.yml'), '--patch', str(patch), prompt]
    started = time.time()
    timed_out, exit_code, error = False, None, None
    if task.get('driver') not in (None, 'resume-two-turns'):
        raise ValueError('Unsupported lifecycle driver: ' + task['driver'])
    if preflight:
        with patch.open('a') as stream:
            stream.write('- id: headless-startup\n  disabled: true\n- id: headless-runner\n  disabled: true\n- insert:\n    - id: gh-preflight\n      name: ' + str(ROOT / 'artifacts/plugins/gh-genai-traces/lib/preflight-profile.js') + '\n')
        argv.pop()
    elif task.get('driver') == 'resume-two-turns':
        atomic(directory / 'lifecycle.json', {'prompt': prompt, 'continuation': task['continuation']})
        with patch.open('a') as stream:
            stream.write('- id: headless-startup\n  disabled: true\n- id: headless-runner\n  disabled: true\n- insert:\n    - id: gh-lifecycle\n      name: ' + str(ROOT / 'artifacts/plugins/gh-genai-traces/lib/lifecycle-profile.js') + '\n')
        argv.pop()
    try:
        with (directory / 'stdout.log').open('w') as stdout, (directory / 'stderr.log').open('w') as stderr:
            process = subprocess.Popen(argv, cwd=ROOT, env={**os.environ, 'DSH_HOME': str(home), 'GH_LIFECYCLE_TASK': str(directory / 'lifecycle.json'), 'GH_PREFLIGHT_OUTPUT': str(directory / 'preflight.json')}, stdout=stdout, stderr=stderr, start_new_session=True)
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
    except OSError as failure:
        error = str(failure)
    result = {**manifest, 'started': started, 'ended': time.time(), 'exit_code': exit_code if exit_code is not None else -1,
              'timed_out': timed_out, 'execution_error': error, 'failure_owner': 'harness' if error else 'unclassified',
              'sessionIds': [p.name for p in (directory / '.sessions').glob('*/*') if p.is_dir()]}
    if preflight:
        if exit_code != 0 or timed_out:
            raise RuntimeError('Profile preflight failed: ' + str(directory / 'stderr.log'))
        evidence = json.loads((directory / 'preflight.json').read_text())
        if sorted(t['name'] for t in evidence['root']) != sorted(task['allowed_tools']):
            raise RuntimeError('Effective root tools differ from task policy')
        if sorted(t['name'] for t in evidence['child']) != ['read']:
            raise RuntimeError('Effective read-only child tools differ')
        if task['family'] == 'delegation':
            tool = next(t for t in evidence['root'] if t['name'] == 'subagent')
            if 'run_in_background' not in tool['parameters']['properties'] or 'job' not in tool['description']:
                raise RuntimeError('Background job delegation schema missing')
    atomic(result_file, result)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('receipt'); parser.add_argument('output')
    parser.add_argument('--template', default=str(ROOT / 'artifacts/results/trace-discovery-20260908/.home'))
    parser.add_argument('--upstream', default='http://100.108.76.12:4000')
    parser.add_argument('--workers', type=int, choices=range(1, 5), default=4)
    parser.add_argument('--repetitions', type=int, choices=range(1, 4), default=3)
    parser.add_argument('--pilot', action='store_true', help='Run instance zero of each family in a separate acceptance campaign')
    parser.add_argument('--preflight', action='store_true', help='Inspect root and child tool schemas without inference')
    args = parser.parse_args()
    os.umask(0o077)
    client, receipt = Phoenix(), json.loads(Path(args.receipt).read_text())
    client.verify(receipt)
    examples = client.examples(receipt['datasetId'], receipt['datasetVersion'])
    tasks = [e['input']['task'] for e in examples if e['id'] in receipt['rowHashes']]
    if len(tasks) != 48 or len({t['family'] for t in tasks}) != 12:
        raise ValueError('Expected the complete frozen balanced benchmark')
    if any(t['version'] != 5 for t in tasks):
        raise ValueError('Collection requires repaired version-5 task definitions')
    if args.preflight:
        args.pilot, args.repetitions = True, 1
    if args.pilot:
        tasks = [t for t in tasks if t['expected']['instance'].endswith('-0')]
    implementation = {**execution_identity(Path(args.template).resolve()), 'upstream': args.upstream}
    output = Path(args.output).resolve(); output.mkdir(parents=True, exist_ok=True, mode=0o700)
    manifest = {'version': 3, 'dataset': receipt, 'count': len(tasks) * args.repetitions, 'workers': args.workers,
                'reasoning': 'medium', 'pilot': args.pilot, 'preflight': args.preflight, 'implementation': implementation}
    if (output / 'manifest.json').exists() and json.loads((output / 'manifest.json').read_text()) != manifest:
        raise ValueError('Campaign inputs differ; allocate a fresh campaign directory')
    preserve_implementation(output, implementation)
    atomic(output / 'manifest.json', manifest)
    os.environ.update({'UPSTREAM': args.upstream, 'RECLOG': str(output / '.recordings.jsonl'), 'REC_CONCURRENCY': '4'})
    spec = importlib.util.spec_from_file_location('gh_campaign_proxy', ROOT / 'artifacts/recproxy.py')
    proxy_module = importlib.util.module_from_spec(spec); spec.loader.exec_module(proxy_module)
    server = proxy_module.S(('127.0.0.1', 0), proxy_module.H)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True); server_thread.start()
    proxy = 'http://127.0.0.1:' + str(server.server_address[1])
    results, errors = [], []
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = [pool.submit(execute, task, repetition, output, Path(args.template), proxy, implementation, args.preflight) for task in tasks for repetition in range(1, args.repetitions + 1)]
            for future in concurrent.futures.as_completed(futures):
                try:
                    result = future.result()
                except Exception as failure:
                    errors.append(str(failure))
                    continue
                results.append(result)
                atomic(output / 'trials.json', results)
                print(json.dumps({'completed': len(results), 'instance': result['expected']['instance'], 'repetition': result['repetition'], 'exit_code': result['exit_code'], 'timed_out': result['timed_out']}), flush=True)
    finally:
        server.shutdown(); server.server_close(); server_thread.join()
    atomic(output / 'trials.json', results)
    atomic(output / 'collection-errors.json', errors)
    if args.preflight:
        atomic(output / 'preflight-traffic.json', verify_preflight_recordings(output / '.recordings.jsonl'))
    if errors:
        raise RuntimeError('Campaign incomplete; completed receipts retained. ' + '; '.join(errors))
    print(json.dumps({'trials': len(results), 'instances': len(tasks), 'families': 12}))
