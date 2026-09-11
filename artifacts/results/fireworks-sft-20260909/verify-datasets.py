"""Verify dataset-only validation, native status, and downloaded bytes for the foundation fixture."""
import hashlib
import json
from pathlib import Path
import sys
import urllib.error
import urllib.request

root = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(root / 'artifacts/plugins/gh-genai-traces/experiments'))
from fireworks_preview import api_key
from phoenix_dataset import atomic

output = Path(__file__).resolve().parent
manifest = json.loads((output / '.bundle-actions/manifest.json').read_text())
key = api_key()
results = []
for split, dataset_id in [('train', 'gh-r5-actions-train-e0a2cb06'), ('validation', 'gh-r5-actions-val-5cf85866')]:
    resource = 'accounts/gh01-andrea-fezzardi/datasets/' + dataset_id
    url = 'https://api.fireworks.ai/v1/' + resource
    headers = {'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'}
    try:
        with urllib.request.urlopen(urllib.request.Request(url + ':validateUpload', data=b'{}', headers=headers), timeout=60) as response:
            validation = {'httpStatus': response.status, 'response': json.load(response)}
    except urllib.error.HTTPError as error:
        validation = {'httpStatus': error.code, 'response': error.read().decode()}
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as response:
        status = json.load(response)
    expected = manifest['files'][split + '.jsonl']
    downloaded = [f for f in (output / '.remote' / ('download-' + split)).rglob('*') if f.is_file()]
    matches = [f for f in downloaded if hashlib.sha256(f.read_bytes()).hexdigest() == expected['sha256']]
    if len(matches) != 1 or status['state'] != 'READY' or status['format'] != 'CHAT' or int(status['exampleCount']) != expected['examples']:
        raise ValueError('Uploaded dataset bytes, status, or example count differ from the bundle')
    results.append({'split': split, 'resource': resource, 'validation': validation,
                    'state': status['state'], 'format': status['format'], 'examples': int(status['exampleCount']),
                    'estimatedTokens': status.get('estimatedTokenCount'), 'averageTurns': status.get('averageTurnCount'),
                    'sha256': expected['sha256'], 'downloadedBytesMatch': True})
atomic(output / 'remote-datasets.json', {'datasets': results, 'heldOutTestExamples': manifest['files']['test.jsonl']['examples'],
                                       'operations': ['validateUpload', 'get', 'local-download-hash-comparison']})
print(json.dumps(results))
