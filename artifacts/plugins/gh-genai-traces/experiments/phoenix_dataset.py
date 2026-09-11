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


def encode_field(value):
    """Keep JSONB-incompatible canonical strings lossless inside a JSON-text envelope."""
    def needs_envelope(member):
        if isinstance(member, str):
            return any(c == '\0' or 0xD800 <= ord(c) <= 0xDFFF for c in member)
        if isinstance(member, dict):
            return any(needs_envelope(k) or needs_envelope(v) for k, v in member.items())
        return isinstance(member, list) and any(needs_envelope(v) for v in member)
    if needs_envelope(value) or isinstance(value, dict) and value.get('ghEncoding') == 'json-text-v1':
        return {'ghEncoding': 'json-text-v1', 'ghJson': json.dumps(value, ensure_ascii=True, separators=(',', ':'))}
    return value


def decode_field(value):
    if isinstance(value, dict) and value.get('ghEncoding') == 'json-text-v1':
        if set(value) - {'ghEncoding', 'ghJson', 'annotations'}:
            raise ValueError('Unexpected encoded Phoenix fields')
        decoded = json.loads(value['ghJson'])
        if value.get('annotations'):
            decoded['annotations'] = value['annotations']
        return decoded
    return value


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


def validate_content(candidate):
    """Verify the neutral file's content identity before publication or reference rendering."""
    if candidate['version'] != 3 or candidate['trainingReady'] is not False:
        raise ValueError('Expected an explicitly non-training-ready v3 candidate')
    provenance, target = candidate['provenance'], candidate['target']
    if 'system' in candidate['request']:
        raise ValueError('V3 system instructions must be ordered messages')
    if not provenance.get('messageId') or provenance['messageId'] != candidate['response'].get('id') or provenance.get('throughSeq', -1) < provenance['sourceEvent']:
        raise ValueError('Candidate message identity or cutoff mismatch')
    checks = {'requestHash': digest(candidate['request']), 'toolsHash': digest(candidate['request'].get('tools')),
              'configHash': digest(candidate['request']['config']), 'outputHash': digest(candidate['response']['content']),
              'rowHash': digest({'request': candidate['request'], 'response': candidate['response'], 'target': {**target, 'event': None}}),
              'transformationHash': digest({'version': 3, 'reconstruction': 'upstream-surface', 'objective': target['policy'], 'reasoning': 'retain-source-omit-target'})}
    if any(provenance[key] != value for key, value in checks.items()):
        raise ValueError('Curated candidate content hash mismatch')
    if candidate['response']['role'] != 'assistant' or candidate['response']['source']['kind'] != 'model' or provenance['sourceEvent'] != target['event'] or target['event'] < provenance['inheritedEventCount']:
        raise ValueError('Candidate target ownership mismatch')
    if target['policy'] not in ('final-answer', 'tool-decision') or target['reasoning'] != 'omit':
        raise ValueError('Unsupported candidate target')
    blocks = candidate['response']['content']
    if any(b['type'] not in ('text', 'reasoning', 'tool-call', 'tool-result') for m in candidate['request']['messages'] + [candidate['response']] for b in m['content']):
        raise ValueError('Unsupported candidate content block')
    if target['policy'] == 'final-answer':
        if any(b['type'] not in ('text', 'reasoning') for b in blocks):
            raise ValueError('Unsupported final-answer content')
        selected = [i for i, b in enumerate(blocks) if b['type'] == 'text' and b['text'].strip()]
    else:
        if any(b['type'] not in ('tool-call', 'reasoning') for b in blocks):
            raise ValueError('Unsupported tool-decision content')
        selected = [i for i, b in enumerate(blocks) if b['type'] == 'tool-call']
    if not selected or selected != target['blocks']:
        raise ValueError('Candidate target blocks mismatch')


def validate_curated(example, required=False):
    """Check candidate-file consistency; a review hash is not reviewer authentication."""
    candidate = example['metadata'].get('candidate')
    if candidate is None:
        if required:
            raise ValueError('Curated publication requires a candidate on every example')
        return
    validate_content(candidate)
    if candidate['sftEligible'] is not True or example['id'] != candidate['provenance']['rowHash']:
        raise ValueError('Curated publication requires admitted candidates with stable identities')
    provenance, target, grade = candidate['provenance'], candidate['target'], candidate['grade']
    if target['policy'] == 'tool-decision':
        bindings = candidate['sourceEvidence'].get('toolDecisions')
        if not bindings or [b['block'] for b in bindings] != target['blocks']:
            raise ValueError('Curated tool target lacks exact grade bindings')
        decisions = grade.get('decisions', [])
        for binding in bindings:
            block = candidate['response']['content'][binding['block']]
            if (block.get('id'), block.get('name'), block.get('arguments')) != (binding['callId'], binding['name'], binding['arguments']) or not any(d['call'] == binding['call'] and d['status'] == 'pass' for d in decisions):
                raise ValueError('Curated tool-grade binding mismatch')
        if len({d['call'] for d in decisions}) != len(decisions) or sum(d['status'] == 'pass' and d['call'] > target['event'] for d in decisions) < len(target['blocks']):
            raise ValueError('Curated tool target lacks distinct passing decisions')
    review = provenance['review']
    if not review or review['contentHash'] != provenance['sourceHash'] or review['transformationHash'] != provenance['transformationHash']:
        raise ValueError('Curated candidate review mismatch')
    if not grade['required'] or any(grade['observations'][key]['status'] != 'pass' for key in grade['required']):
        raise ValueError('Curated candidate has unpassed required observations')
    if candidate['sourceEvidence']['approvals'] or candidate.get('conflictVersions') or candidate['split'] != example['split']:
        raise ValueError('Curated candidate admission conflicts with approval or split evidence')
    if example['input'] != {'request': candidate['request']} or example['output'] != {'response': candidate['response'], 'target': target}:
        raise ValueError('Publication differs from validated candidate')
    fidelity = example['metadata'].get('fidelity') or {}
    if fidelity.get('status') != 'byte-exact' or fidelity.get('canonicalRequestHash') != provenance['requestHash'] or fidelity.get('canonicalSourceHash') != provenance['sourceHash']:
        raise ValueError('Curated publication requires exact source-bound provider fidelity')
    if fidelity.get('session') != provenance['session'] or fidelity.get('event') != target['event'] or fidelity.get('recordedHash') != fidelity.get('reconstructedHash'):
        raise ValueError('Curated provider fidelity identifies a different request')


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
        rows = self.request('/v1/datasets/' + urllib.parse.quote(dataset, safe='') + '/examples?' + urllib.parse.urlencode({'version_id': version}))['data']['examples']
        return [{**row, **{key: decode_field(row[key]) for key in ['input', 'output', 'metadata']}} for row in rows]

    def publish(self, name, examples, receipt_file, source_inventory=None, previous=None, require_curated=False):
        """Publish immutable content; retries reconcile the export identity in Phoenix."""
        if not examples or len({e['id'] for e in examples}) != len(examples):
            raise ValueError('Publication needs nonempty, unique stable example identities')
        for example in examples:
            if example['split'] not in ('train', 'validation', 'test') or not example['metadata'].get('groupKeys'):
                raise ValueError('Every example requires a frozen split and nonempty group keys')
            validate_curated(example, required=require_curated or 'graderVersion' in (source_inventory or {}))
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
            staged = next((v for v in versions if v['metadata'].get('pendingExportIdentity') == export_id), None)
            if staged and versions[0]['version_id'] != staged['version_id']:
                raise RuntimeError('Phoenix head moved after staged publication')
            if versions and staged is None:
                if previous is None or previous['datasetId'] != dataset['id']:
                    raise ValueError('Changed exports require the previous pinned receipt')
                self.verify(previous)
                if versions[0]['version_id'] != previous['datasetVersion']:
                    raise RuntimeError('Phoenix head moved; reconcile before publication')
            current = self.examples(dataset['id'], versions[0]['version_id']) if versions else []
            by_external = {e['id']: e for e in current}
            frozen = {}
            for version in reversed(versions):
                for key, split in version['metadata'].get('splitSnapshot', {}).items():
                    if key in frozen and frozen[key] != split:
                        raise RuntimeError('Conflicting historical split snapshots')
                    frozen[key] = split
            if any(e['id'] in frozen and frozen[e['id']] != e['split'] for e in examples):
                raise RuntimeError('Published split cannot change')
            self.check_groups(examples)
            additions = [e for e in examples if e['id'] not in by_external]
            updates = [e for e in examples if e['id'] in by_external]
            if additions:
                self.graphql('mutation($input: AddExamplesToDatasetInput!) { addExamplesToDataset(input:$input) { dataset { id } } }', {'input': {
                'datasetId': dataset['id'], 'datasetVersionDescription': 'Published export ' + export_id,
                'datasetVersionMetadata': metadata if not updates else {'pendingExportIdentity': export_id},
                'examples': [{'externalId': e['id'], **{key: encode_field(e[key]) for key in ['input', 'output', 'metadata']}} for e in additions]}})
            if updates:
                self.graphql('mutation($input: PatchDatasetExamplesInput!) { patchDatasetExamples(input:$input) { dataset { id } } }', {'input': {
                    'datasetId': dataset['id'], 'versionDescription': 'Published export ' + export_id, 'versionMetadata': metadata,
                    'patches': [{'exampleId': by_external[e['id']]['node_id'], **{key: encode_field(e[key]) for key in ['input', 'output', 'metadata']}} for e in updates]}})
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

    def check_groups(self, examples):
        """Reject cross-campaign connected split conflicts before any example mutation."""
        assignments = [(e['metadata']['groupKeys'], e['split']) for e in examples]
        for dataset in self.pages('/v1/datasets'):
            for version in self.pages('/v1/datasets/' + dataset['id'] + '/versions'):
                splits = version['metadata'].get('splitSnapshot')
                if not splits:
                    continue
                assignments.extend((e['metadata']['groupKeys'], splits[e['id']]) for e in self.examples(dataset['id'], version['version_id'])
                                   if e['id'] in splits and e['metadata'].get('groupKeys'))
        parent, memberships = {}, {}
        def find(key):
            parent.setdefault(key, key)
            if parent[key] != key:
                parent[key] = find(parent[key])
            return parent[key]
        for keys, _ in assignments:
            for key in keys[1:]:
                parent[find(key)] = find(keys[0])
        for keys, split in assignments:
            memberships.setdefault(find(keys[0]), set()).add(split)
        if any(len(memberships[find(e['metadata']['groupKeys'][0])]) > 1 for e in examples):
            raise RuntimeError('Cross-campaign split group conflict; publication quarantined')

    def verify(self, receipt):
        if receipt['count'] != len(receipt['rowHashes']) or not receipt['rowHashes']:
            raise ValueError('Receipt row count mismatch')
        versions = self.pages('/v1/datasets/' + receipt['datasetId'] + '/versions')
        version = next(v for v in versions if v['version_id'] == receipt['datasetVersion'])
        if version['metadata'].get('exportIdentity') != receipt['exportIdentity'] or version['metadata'].get('rowHashes') != receipt['rowHashes']:
            raise RuntimeError('Receipt differs from authoritative Phoenix version metadata')
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
    parser.add_argument('--previous', help='Pinned predecessor receipt for an explicitly reconciled changed export')
    parser.add_argument('--fidelity', help='Installed-adapter report required for curated candidate publication')
    parser.add_argument('--base', default='http://127.0.0.1:6006')
    args = parser.parse_args()
    client = Phoenix(args.base)
    data = None if args.operation == 'protect' else json.loads(Path(args.input).read_text())
    if args.operation == 'publish':
        if args.fidelity:
            fidelity = json.loads(Path(args.fidelity).read_text())
            by_source = {(r['session'], r['event']): r for r in fidelity['rows']}
            for example in data['examples']:
                candidate = example['metadata'].get('candidate')
                if candidate:
                    example['metadata']['fidelity'] = by_source.get((candidate['provenance']['session'], candidate['target']['event']))
        result = client.publish(args.name, data['examples'], args.receipt, data.get('sourceInventory'), json.loads(Path(args.previous).read_text()) if args.previous else None, require_curated=bool(args.fidelity))
    elif args.operation == 'verify':
        result = client.verify(data)
    elif args.operation == 'assignments':
        result = client.assignments(data)
    else:
        result = client.protect(args.input)
    print(json.dumps(result, ensure_ascii=False))
