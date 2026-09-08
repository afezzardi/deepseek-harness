"""Native Phoenix datasets with stable examples, version receipts, and split snapshots."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
import urllib.error
import urllib.parse
import urllib.request


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def atomic(file, value):
    file = Path(file)
    file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(dir=file.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, file)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def row_digest(example):
    metadata = dict(example['metadata'])
    if metadata.get('annotations') == {}:
        del metadata['annotations']
    return digest({'input': example['input'], 'output': example['output'], 'metadata': metadata})


class Phoenix:
    def __init__(self, base='http://127.0.0.1:6006'):
        self.base = base.rstrip('/')

    def request(self, route, body=None, method=None):
        headers = {'Content-Type': 'application/json'}
        if os.environ.get('PHOENIX_API_KEY'):
            headers['Authorization'] = 'Bearer ' + os.environ['PHOENIX_API_KEY']
        request = urllib.request.Request(self.base + route, headers=headers,
                                         data=None if body is None else json.dumps(body).encode(), method=method)
        with urllib.request.urlopen(request, timeout=90) as response:
            return json.load(response)

    def graphql(self, query, variables):
        response = self.request('/graphql', {'query': query, 'variables': variables})
        if response.get('errors'):
            raise RuntimeError(response['errors'])
        return response['data']

    def pages(self, route):
        result, cursor = [], None
        while True:
            page = self.request(route + ('&' if '?' in route else '?') + urllib.parse.urlencode({'limit': 100, **({'cursor': cursor} if cursor else {})}))
            result.extend(page['data'])
            cursor = page.get('next_cursor')
            if not cursor:
                return result

    def examples(self, dataset, version):
        return self.request('/v1/datasets/' + urllib.parse.quote(dataset, safe='') + '/examples?' + urllib.parse.urlencode({'version_id': version}))['data']['examples']

    def publish(self, name, examples, receipt_file, source_inventory=None):
        """Publish immutable content; retries reconcile the export identity in Phoenix."""
        if not examples or len({e['id'] for e in examples}) != len(examples):
            raise ValueError('Publication needs nonempty, unique stable example identities')
        export_id = digest({'version': 2, 'name': name, 'examples': examples, 'sources': source_inventory})
        datasets = self.pages('/v1/datasets')
        dataset = next((d for d in datasets if d['name'] == name), None)
        if dataset is None:
            dataset = self.graphql('mutation($input: CreateDatasetInput!) { createDataset(input:$input) { dataset { id name } } }',
                                   {'input': {'name': name, 'description': 'Artifact pipeline v3; canonical DSH sources remain authoritative.', 'metadata': {'owner': 'gh-pipeline-v3'}}})['createDataset']['dataset']
        versions = self.pages('/v1/datasets/' + dataset['id'] + '/versions')
        existing = next((v for v in versions if v['metadata'].get('exportIdentity') == export_id), None)
        metadata = {'exportIdentity': export_id, 'sourceInventory': source_inventory or {},
                    'rowHashes': {e['id']: row_digest(e) for e in examples},
                    'splitSnapshot': {e['id']: e['split'] for e in examples}, 'schemaVersion': 2}
        if existing is None:
            self.graphql('mutation($input: AddExamplesToDatasetInput!) { addExamplesToDataset(input:$input) { dataset { id } } }', {'input': {
                'datasetId': dataset['id'], 'datasetVersionDescription': 'Published export ' + export_id,
                'datasetVersionMetadata': metadata,
                'examples': [{'externalId': e['id'], 'input': e['input'], 'output': e['output'], 'metadata': e['metadata']} for e in examples]}})
            versions = self.pages('/v1/datasets/' + dataset['id'] + '/versions')
            existing = next(v for v in versions if v['metadata'].get('exportIdentity') == export_id)
        version = existing['version_id']
        stored = self.examples(dataset['id'], version)
        by_id = {e['id']: e for e in stored}
        for e in examples:
            actual = by_id.get(e['id'])
            if actual is None or row_digest(actual) != metadata['rowHashes'][e['id']]:
                raise RuntimeError('Pinned Phoenix row differs: ' + e['id'])
        # Native splits are mutable. Preserve their publication membership in version metadata.
        existing_splits = self.graphql('{ datasetSplits(first:100) { edges { node { id name } } pageInfo { hasNextPage } } }', {})['datasetSplits']
        if existing_splits['pageInfo']['hasNextPage']:
            raise RuntimeError('Split inventory exceeds the supported review window')
        split_ids = {edge['node']['name']: edge['node']['id'] for edge in existing_splits['edges']}
        for split in ('train', 'validation', 'test'):
            if split not in split_ids:
                continue
            present = self.request('/v1/datasets/' + dataset['id'] + '/examples?' + urllib.parse.urlencode({'version_id': version, 'split': split}))['data']['examples']
            if any(e['id'] in {p['id'] for p in present} and e['split'] != split for e in examples):
                raise RuntimeError('Native split assignment conflict; publication quarantined')
        for split in sorted({e['split'] for e in examples}):
            members = [by_id[e['id']]['node_id'] for e in examples if e['split'] == split]
            try:
                self.request('/v1/datasets/' + dataset['id'] + '/splits', {'name': split, 'example_ids': members})
            except urllib.error.HTTPError as error:
                if error.code != 409:
                    raise
                self.request('/v1/datasets/' + dataset['id'] + '/splits/' + split_ids[split], {'add_example_ids': members}, 'PATCH')
            present = self.request('/v1/datasets/' + dataset['id'] + '/examples?' + urllib.parse.urlencode({'version_id': version, 'split': split}))['data']['examples']
            if not set(e['id'] for e in examples if e['split'] == split) <= {e['id'] for e in present}:
                raise RuntimeError('Native split assignment conflict; publication quarantined')
        receipt = {'version': 2, 'datasetId': dataset['id'], 'datasetVersion': version, 'exportIdentity': export_id,
                   'rowHashes': metadata['rowHashes'], 'count': len(examples), 'url': self.base + '/datasets/' + dataset['id']}
        atomic(receipt_file, receipt)
        return receipt

    def verify(self, receipt):
        rows = self.examples(receipt['datasetId'], receipt['datasetVersion'])
        hashes = {e['id']: row_digest(e) for e in rows}
        if any(hashes.get(key) != value for key, value in receipt['rowHashes'].items()):
            raise RuntimeError('Pinned dataset row hash mismatch')
        return {'verified': len(receipt['rowHashes']), 'datasetVersion': receipt['datasetVersion']}

    def assignments(self, receipt):
        versions = self.pages('/v1/datasets/' + receipt['datasetId'] + '/versions')
        version = next(v for v in versions if v['version_id'] == receipt['datasetVersion'])
        splits = version['metadata']['splitSnapshot']
        self.verify(receipt)
        return [{'keys': e['metadata']['groupKeys'], 'split': splits[e['id']], 'version': receipt['datasetVersion']}
                for e in self.examples(receipt['datasetId'], receipt['datasetVersion']) if e['id'] in splits]

    def protect(self, project):
        """Assign a reusable non-expiring native policy only to a v3 evidence project."""
        if not project.startswith('gh-training-v3-'):
            raise ValueError('Protection operation is restricted to new v3 evidence projects')
        fields = 'id name rule { ... on TraceRetentionRuleMaxDays { maxDays } }'
        nodes = self.graphql('{ projectTraceRetentionPolicies(first:100) { edges { node { ' + fields + ' } } } }', {})
        policies = [e['node'] for e in nodes['projectTraceRetentionPolicies']['edges']]
        policy = next((p for p in policies if p['name'] == 'gh-promoted-v3'), None)
        if policy is None:
            policy = self.graphql('mutation($input:CreateProjectTraceRetentionPolicyInput!) { createProjectTraceRetentionPolicy(input:$input) { node { ' + fields + ' } } }',
                                  {'input': {'name': 'gh-promoted-v3', 'cronExpression': '0 0 * * *', 'rule': {'maxDays': {'maxDays': 0}}}})['createProjectTraceRetentionPolicy']['node']
        if policy['rule'] != {'maxDays': 0}:
            raise RuntimeError('Existing protected policy is not non-expiring')
        return self.request('/v1/projects/' + urllib.parse.quote(project, safe='') + '/retention', {'policy_id': policy['id']}, 'PATCH')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['publish', 'verify', 'assignments', 'protect'])
    parser.add_argument('input')
    parser.add_argument('--name')
    parser.add_argument('--receipt')
    parser.add_argument('--base', default='http://127.0.0.1:6006')
    args = parser.parse_args()
    client = Phoenix(args.base)
    data = None if args.operation == 'protect' else json.loads(Path(args.input).read_text())
    if args.operation == 'publish':
        result = client.publish(args.name, data['examples'], args.receipt, data.get('sourceInventory'))
    elif args.operation == 'verify':
        result = client.verify(data)
    elif args.operation == 'assignments':
        result = client.assignments(data)
    else:
        result = client.protect(args.input)
    print(json.dumps(result, ensure_ascii=False))
