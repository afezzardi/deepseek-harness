"""Small V3 transition acceptance: eight fixture scenarios, off and medium reasoning."""
import argparse
import concurrent.futures
import importlib.util
import os
from pathlib import Path
import threading
from balanced_campaign import ROOT, execute, execution_identity, preserve_implementation, verify_preflight_recordings
from benchmark import FAMILIES, definition, publication
from phoenix_dataset import atomic


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output')
    parser.add_argument('--template', required=True)
    parser.add_argument('--preflight', action='store_true')
    parser.add_argument('--upstream', default='http://100.108.76.12:4000')
    args = parser.parse_args()
    os.umask(0o077)
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    selected = {'scoped-edit', 'recovery', 'delegation', 'workflow', 'lifecycle', 'extraction', 'unicode', 'untrusted'}
    tasks = [definition(family, domain, split, 0) for family, domain, split in FAMILIES if family in selected]
    template = Path(args.template).resolve()
    implementation = execution_identity(template)
    preserve_implementation(output, implementation)
    task_publication = publication(tasks)
    for row in task_publication['examples']:
        row['metadata'].update(repetitions=2, reasoning=['off', 'medium'])
    atomic(output / 'tasks-publication.json', task_publication)
    atomic(output / 'manifest.json', {'version': 1, 'upstreamRevision': 'c291e7961a515f6d7af9304e7fd1d257929aef26',
                                    'implementation': implementation, 'efforts': ['off', 'medium'], 'scenarios': len(tasks), 'trials': 16, 'preflight': args.preflight})
    os.environ.update({'UPSTREAM': args.upstream, 'RECLOG': str(output / '.recordings.jsonl'), 'REC_CONCURRENCY': '4'})
    spec = importlib.util.spec_from_file_location('gh_acceptance_proxy', ROOT / 'artifacts/recproxy.py')
    proxy_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(proxy_module)
    server = proxy_module.S(('127.0.0.1', 0), proxy_module.H)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    proxy = f'http://127.0.0.1:{server.server_address[1]}'
    trials = []
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(execute, task, effort, output, template, proxy, implementation,
                                   preflight=args.preflight, effort=effort, project='gh-acceptance-v4-live') for task in tasks for effort in ['off', 'medium']]
            for future in concurrent.futures.as_completed(futures):
                trials.append(future.result())
                atomic(output / 'trials.json', trials)
                print(f'{len(trials)}/16 {trials[-1]["family"]} {trials[-1]["repetition"]}: exit={trials[-1]["exit_code"]}', flush=True)
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
    if execution_identity(template) != implementation:
        raise SystemExit('Implementation changed during acceptance; retain diagnostics and use a fresh output directory')
    if args.preflight:
        atomic(output / 'preflight-recordings.json', verify_preflight_recordings(output / '.recordings.jsonl'))
    if any(t['exit_code'] != 0 or t['timed_out'] for t in trials):
        raise SystemExit('Acceptance contains execution failures; inspect trials before promotion')


if __name__ == '__main__':
    main()
