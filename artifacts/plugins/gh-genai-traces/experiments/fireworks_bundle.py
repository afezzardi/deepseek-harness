"""Export a pinned Phoenix version to private Fireworks SFT files without starting training."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess

from phoenix_dataset import Phoenix, atomic, digest, row_digest, validate_curated


def select_examples(receipt, examples, splits, objective='final-answer-format'):
    """Recheck pinned bytes and frozen membership before destination conversion."""
    by_id = {row['id']: row for row in examples}
    if len(by_id) != len(examples) or set(by_id) != set(receipt['rowHashes']) or receipt['count'] != len(by_id):
        raise ValueError('Pinned example inventory differs from receipt')
    selected, excluded, groups = [], [], {}
    for key in sorted(by_id):
        source = by_id[key]
        if row_digest(source) != receipt['rowHashes'][key]:
            raise ValueError('Pinned example hash mismatch: ' + key)
        row = copy.deepcopy(source)
        row['split'] = splits.get(key)
        if row['split'] not in ('train', 'validation', 'test'):
            raise ValueError('Missing or unknown frozen split for example ' + key)
        validate_curated(row, required=True)
        for group in row['metadata']['groupKeys']:
            if groups.setdefault(group, row['split']) != row['split']:
                raise ValueError('Connected examples cross frozen splits')
        candidate = row['metadata']['candidate']
        if candidate['target']['policy'] != 'final-answer' and objective == 'final-answer-format':
            excluded.append({'id': key, 'split': row['split'], 'reason': 'tool-decision-mask-unsupported'})
        else:
            selected.append(row)
    if not selected:
        raise ValueError('No supported SFT examples')
    return selected, excluded


def serialize(candidates, objective):
    """Use the owning TypeScript converter and candidate parser, including message/tool checks."""
    script = Path(__file__).with_name('fireworks-rows.mjs')
    completed = subprocess.run(['node', str(script)], input=json.dumps({'candidates': candidates, 'objective': objective}), text=True,
                               capture_output=True, check=False)
    if completed.returncode:
        raise ValueError(f'Fireworks converter failed (exit {completed.returncode}): {completed.stderr.strip()}')
    return json.loads(completed.stdout)


def write_bundle(output, receipt, examples, splits, converter=serialize, objective='final-answer-format'):
    """Write private split files and row provenance; an existing directory is never overwritten."""
    if objective not in ('final-answer-format', 'outcome-reasoning'):
        raise ValueError('Unsupported SFT objective')
    selected, excluded = select_examples(receipt, examples, splits, objective)
    converted = converter([row['metadata']['candidate'] for row in selected], objective)
    if len(converted) != len(selected):
        raise ValueError('Converter row count mismatch')
    output = Path(output)
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    atomic(output / 'phoenix-snapshot.json', {'receipt': receipt, 'examples': examples, 'splitSnapshot': splits})
    files, lineage = {}, []
    for split in ('train', 'validation', 'test'):
        members = [(source, row) for source, row in zip(selected, converted, strict=True) if source['split'] == split]
        content = ''.join(json.dumps(row, ensure_ascii=False, separators=(',', ':')) + '\n' for _, row in members).encode()
        name = split + '.jsonl'
        with (output / name).open('xb') as stream:
            os.chmod(stream.fileno(), 0o600)
            stream.write(content)
        files[name] = {'sha256': hashlib.sha256(content).hexdigest(), 'bytes': len(content), 'examples': len(members)}
        for line, (source, row) in enumerate(members, 1):
            candidate = source['metadata']['candidate']
            p = candidate['provenance']
            lineage.append({'file': name, 'line': line, 'exampleId': source['id'], 'sourceRowHash': row_digest(source),
                            'submittedRowHash': digest(row), 'session': p['session'], 'event': p['sourceEvent'],
                            'requestHash': p['requestHash'], 'sourceHash': p['sourceHash'],
                            'targetPolicy': candidate['target']['policy'],
                            'derivedTarget': {**candidate['target'], 'reasoning': 'supervise' if objective == 'outcome-reasoning' else 'omit'},
                            'sourceCandidateHash': digest(candidate),
                            'toolGradeBinding': 'not-applicable' if candidate['target']['policy'] == 'final-answer' else
                                'candidate-file' if candidate['sourceEvidence'].get('toolDecisions') else 'canonical-curation-only',
                            'targetReasoningOmitted': objective == 'final-answer-format' and any(b['type'] == 'reasoning' for b in candidate['response']['content']),
                            'derivationHash': digest({'sourceCandidateHash': digest(candidate), 'objective': objective, 'submittedRowHash': digest(row)}),
                            'contextReasoningMessages': sum('reasoning_content' in m for m in row['messages'][:-1]),
                            'userTurns': sum(m['role'] == 'user' for m in row['messages'])})
    implementation = [Path(__file__), Path(__file__).with_name('fireworks-rows.mjs'), Path(__file__).with_name('phoenix_dataset.py'),
                      Path(__file__).parent.parent / 'build.mjs', Path(__file__).parent.parent / 'package.json']
    implementation += sorted((Path(__file__).parent.parent / 'src').glob('*.ts'))
    implementation += sorted((Path(__file__).parent.parent / 'lib').glob('*.js'))
    manifest = {'version': 1, 'destination': 'fireworks-managed-sft', 'objective': objective,
                'targetReasoning': 'supervise' if objective == 'outcome-reasoning' else 'omit',
                'selectionEvidence': 'passing-task-outcome; reasoning-statements-not-independently-graded',
                'termination': 'trainer-owned-unverified', 'trainingReady': False,
                'source': receipt, 'files': files, 'rows': lineage, 'excluded': excluded,
                'implementationHashes': {str(p.relative_to(Path(__file__).parent.parent)): hashlib.sha256(p.read_bytes()).hexdigest() for p in implementation}}
    atomic(output / 'manifest.json', manifest)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('receipt')
    parser.add_argument('--output', required=True)
    parser.add_argument('--base', default='http://127.0.0.1:6006')
    parser.add_argument('--objective', choices=['final-answer-format', 'outcome-reasoning'], required=True)
    args = parser.parse_args()
    receipt = json.loads(Path(args.receipt).read_text())
    client = Phoenix(args.base)
    client.verify(receipt)
    version = next(v for v in client.pages('/v1/datasets/' + receipt['datasetId'] + '/versions')
                   if v['version_id'] == receipt['datasetVersion'])
    result = write_bundle(args.output, receipt, client.examples(receipt['datasetId'], receipt['datasetVersion']),
                          version['metadata']['splitSnapshot'], objective=args.objective)
    print(json.dumps({'files': result['files'], 'excluded': len(result['excluded']), 'trainingReady': result['trainingReady']}))


if __name__ == '__main__':
    main()
