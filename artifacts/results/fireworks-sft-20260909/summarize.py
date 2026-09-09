"""Reconcile foundation row counts, native previews, DPO availability, and canonical integrity."""
import collections
import hashlib
import json
from pathlib import Path
import sys

output = Path(__file__).resolve().parent
sys.path.insert(0, str(output.parents[2] / 'artifacts/plugins/gh-genai-traces/experiments'))
from fireworks_bundle import select_examples, serialize

baseline = output.parent / 'trace-pipeline-r3-20260909/baseline-r5'
manifest_path = output / '.bundle-reviewed/manifest.json'
manifest = json.loads(manifest_path.read_text())
snapshot = json.loads((output / '.bundle-reviewed/phoenix-snapshot.json').read_text())
uploaded_manifest = json.loads((output / '.bundle-actions/manifest.json').read_text())
implementation_root = output.parents[2] / 'artifacts/plugins/gh-genai-traces'
for name, expected in manifest['implementationHashes'].items():
    if hashlib.sha256((implementation_root / name).read_bytes()).hexdigest() != expected:
        raise ValueError('Reviewed export implementation differs: ' + name)
selected, excluded = select_examples(snapshot['receipt'], snapshot['examples'], snapshot['splitSnapshot'], 'outcome-reasoning')
converted = serialize([r['metadata']['candidate'] for r in selected], 'outcome-reasoning')
reexported = {}
for split in ['train', 'validation', 'test']:
    data = ''.join(json.dumps(row, ensure_ascii=False, separators=(',', ':')) + '\n'
                   for source, row in zip(selected, converted, strict=True) if source['split'] == split).encode()
    reexported[split + '.jsonl'] = hashlib.sha256(data).hexdigest()
    if reexported[split + '.jsonl'] != manifest['files'][split + '.jsonl']['sha256']:
        raise ValueError('Current exporter differs from retained submitted rows')
    if reexported[split + '.jsonl'] != uploaded_manifest['files'][split + '.jsonl']['sha256']:
        raise ValueError('Reviewed export differs from uploaded dataset bytes')
hashes = json.loads((baseline / 'source-hashes-before.json').read_text())
changed = [name for name, expected in hashes.items() if hashlib.sha256(Path(name).read_bytes()).hexdigest() != expected]
if changed:
    raise ValueError('Canonical source files changed: ' + repr(changed))
candidates = [json.loads(line) for line in (baseline / 'audit/candidates.jsonl').read_text().splitlines()]
finals = [c for c in candidates if c['target']['policy'] == 'final-answer']
groups = collections.defaultdict(list)
for c in finals:
    groups[c['provenance']['requestHash']].append(c)
pairs = sum(sum(c['sftEligible'] for c in group) * sum(any(c['grade']['observations'][k]['status'] == 'fail' for k in c['grade']['required']) for c in group)
            for group in groups.values())
previews = {}
for name in ['actions-train-preview-check.json', 'actions-validation-preview-check.json', 'actions-validation-single-check.json']:
    path = output / name
    report = json.loads(path.read_text())
    previews[name] = {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'sourceRowsVerified': report['sourceRowsVerified'],
                      'renderings': len(report['results']), 'matched': sum(r.get('selectedLossMatch', False) for r in report['results']),
                      'errors': dict(collections.Counter(r['error'] for r in report['results'] if 'error' in r)),
                      'matchesCollectionSettings': sum(r.get('matchesCollectionTemplateSettings', False) for r in report['results'])}
result = {'objective': manifest['objective'], 'sourceDataset': manifest['source']['datasetId'],
          'sourceVersion': manifest['source']['datasetVersion'], 'files': manifest['files'],
          'targets': {split: dict(collections.Counter(r['targetPolicy'] for r in manifest['rows'] if r['file'] == split + '.jsonl'))
                      for split in ['train', 'validation', 'test']},
          'excluded': len(manifest['excluded']), 'canonicalFilesUnchanged': len(hashes), 'finalCandidates': len(finals),
          'identicalRequestPassFailPairs': pairs, 'previews': previews, 'trainingReady': False}
result['currentExporterMatchesSubmittedFiles'] = reexported
result['reviewedBundle'] = {'path': '.bundle-reviewed', 'manifestSha256': hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
                           'implementationFilesVerified': len(manifest['implementationHashes']),
                           'toolGradeBindings': dict(collections.Counter(r['toolGradeBinding'] for r in manifest['rows']))}
result['repeatedCompleteFinalRequests'] = sum(len(group) > 1 for group in groups.values())
(output / 'summary.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
