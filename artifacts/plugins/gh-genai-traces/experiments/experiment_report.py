"""Report completed trials by instance and publish recorded outcomes as native experiments."""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
import math
from pathlib import Path
from phoenix_dataset import Phoenix, atomic, digest


def wilson(successes, total):
    if not total:
        return None
    z, p = 1.959963984540054, successes / total
    denominator = 1 + z * z / total
    center = (p + z * z / (2 * total)) / denominator
    width = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator
    return [max(0, center - width), min(1, center + width)]


def report(trials, grades, answers=None):
    by_trial = defaultdict(list)
    for grade in grades:
        by_trial[grade['trial']].append(grade)
        if len(by_trial[grade['trial']]) > 1:
            raise ValueError('Duplicate grade for trial: ' + grade['trial'])
    runs, instances = [], defaultdict(list)
    for trial in trials:
        matches = by_trial[trial['trial']]
        grade = matches[0]['grade'] if len(matches) == 1 else None
        passed = grade is not None and bool(grade['required']) and all(grade['observations'][key]['status'] == 'pass' for key in grade['required'])
        execution_ok = trial['exit_code'] == 0 and not trial['timed_out']
        evidence = [v for key in (grade['required'] if grade else []) for v in grade['observations'][key]['evidence'] if grade['observations'][key]['status'] != 'pass']
        if not execution_ok:
            owner = 'execution-unclassified'
        elif grade is None:
            owner = 'capture'
        elif any(grade['observations'][key]['status'] == 'unknown' for key in grade['required']):
            owner = 'grader'
        elif any('background job identity missing' in e for e in evidence):
            owner = 'delegation-protocol-unclassified'
        elif any('undeclared tool' in e for e in evidence):
            owner = 'task-tool-policy'
        elif trial['family'] in ('aggregation', 'long-context', 'reconciliation', 'workflow') and not passed:
            owner = 'task-output-specification'
        else:
            owner = 'none' if passed else 'model'
        run = {'trial': trial['trial'], 'task': trial['task_id'], 'family': trial['family'], 'repetition': trial['repetition'],
               'taskPassed': passed, 'passed': passed and execution_ok, 'failureOwner': owner, 'evidence': evidence, 'grade': grade,
               'answer': (answers or {}).get(trial['trial']), 'runIdentity': trial['run_identity'], 'session': matches[0]['session'] if len(matches) == 1 else None,
               'started': trial['started'], 'ended': trial['ended']}
        runs.append(run)
        instances[trial['task_id']].append(run)
    if len({r['trial'] for r in runs}) != len(runs):
        raise ValueError('Duplicate trial identity')
    per_instance = []
    for task, members in sorted(instances.items()):
        if {r['repetition'] for r in members} != {1, 2, 3} or len(members) != 3:
            raise ValueError('Repeatability requires exactly repetitions 1, 2, 3 per instance')
        if len({r['family'] for r in members}) != 1:
            raise ValueError('One task identity cannot belong to different families')
        successes = sum(r['passed'] for r in members)
        per_instance.append({'task': task, 'family': members[0]['family'], 'successes': successes,
                             'passAt3': successes > 0, 'passPow3': successes == 3})
    families = []
    for family in sorted({i['family'] for i in per_instance}):
        members = [i for i in per_instance if i['family'] == family]
        families.append({'family': family, 'instances': len(members), **{key: {
            'count': sum(i[key] for i in members), 'rate': sum(i[key] for i in members) / len(members),
            'wilson95': wilson(sum(i[key] for i in members), len(members))} for key in ['passAt3', 'passPow3']}})
    return {'version': 1, 'trials': len(runs), 'instances': per_instance, 'families': families, 'runs': runs,
            'passed': sum(r['passed'] for r in runs), 'failureOwners': dict(Counter(r['failureOwner'] for r in runs)),
            'uncertaintyUnit': 'instance', 'trainingReady': False}


def publish(client, receipt, summary, output):
    """Publish recorded observations without inference; retries require native run/name evaluation upserts."""
    client.verify(receipt)
    identity = digest({'dataset': receipt, 'report': summary})
    experiments = client.pages('/v1/datasets/' + receipt['datasetId'] + '/experiments')
    experiment = next((e for e in experiments if (e.get('metadata') or {}).get('reportIdentity') == identity), None)
    if experiment is None:
        experiment = client.request('/v1/datasets/' + receipt['datasetId'] + '/experiments', {
            'name': 'medium-baseline-' + identity[:12], 'version_id': receipt['datasetVersion'], 'repetitions': 3,
            'description': 'Recorded self-hosted baseline; no model invocation during publication.',
            'metadata': {'reportIdentity': identity, 'reasoning': 'medium', 'trainingReady': False}})['data']
    experiment_id = experiment['id']
    examples = {e['id']: e for e in client.examples(receipt['datasetId'], receipt['datasetVersion'])}
    stored = client.pages('/v1/experiments/' + experiment_id + '/runs')
    runs = {(r['dataset_example_id'], r['repetition_number']): r for r in stored}
    iso = lambda timestamp: datetime.fromtimestamp(timestamp, timezone.utc).isoformat()
    published = []
    for run in summary['runs']:
        example = examples[run['task']]['node_id']
        key = (example, run['repetition'])
        prior = runs.get(key)
        body = {'dataset_example_id': example, 'repetition_number': run['repetition'], 'output': run,
                'start_time': iso(run['started']), 'end_time': iso(run['ended'])}
        if prior:
            if digest(prior['output']) != digest(run):
                raise RuntimeError('Existing native experiment run differs')
            run_id = prior['id']
        else:
            run_id = client.request('/v1/experiments/' + experiment_id + '/runs', body)['data']['id']
        for dimension, observation in (run['grade']['observations'].items() if run['grade'] else []):
            client.request('/v1/experiment_evaluations', {'experiment_run_id': run_id, 'name': dimension, 'annotator_kind': 'CODE',
                'start_time': iso(run['ended']), 'end_time': iso(run['ended']),
                'result': {'label': observation['status'], 'score': 1 if observation['status'] == 'pass' else 0 if observation['status'] == 'fail' else None,
                           'explanation': '\n'.join(observation['evidence'])}, 'metadata': {'grader': run['grade']['version']}})
        published.append(run_id)
    result = {'experimentId': experiment_id, 'datasetVersion': receipt['datasetVersion'], 'reportIdentity': identity,
              'runs': len(published), 'url': client.base + '/datasets/' + receipt['datasetId'] + '/experiments/' + experiment_id}
    atomic(output, result)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('campaign')
    parser.add_argument('--publish-receipt')
    args = parser.parse_args()
    campaign = Path(args.campaign)
    grades = json.loads((campaign / 'audit/grades.json').read_text())
    answers = {}
    for grade in grades:
        snapshot = json.loads((campaign / 'audit' / (grade['session'] + '.session.json')).read_text())
        messages = [e for e in snapshot['events'] if e['type'] == 'assistant/message']
        answers[grade['trial']] = ''.join(b['text'] for b in messages[-1]['data']['message']['content'] if b['type'] == 'text') if messages else None
    summary = report(json.loads((campaign / 'trials.json').read_text()), grades, answers)
    atomic(campaign / 'experiment-report.json', summary)
    if args.publish_receipt:
        print(json.dumps(publish(Phoenix(), json.loads(Path(args.publish_receipt).read_text()), summary, campaign / 'experiment-receipt.json')))
    else:
        print(json.dumps({'trials': summary['trials'], 'passed': summary['passed'], 'failureOwners': summary['failureOwners']}))
