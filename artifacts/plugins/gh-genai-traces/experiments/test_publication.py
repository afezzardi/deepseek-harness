"""Optional native Phoenix reconciliation tests, isolated by unique dataset names."""
import copy
import os
from pathlib import Path
import tempfile
import unittest
import uuid
from unittest.mock import patch
from phoenix_dataset import Phoenix, encode_field, decode_field, validate_curated, digest
from experiment_report import publish, report


@unittest.skipUnless(os.environ.get('GH_PHOENIX_URL'), 'Native Phoenix endpoint required')
class PublicationTests(unittest.TestCase):
    def test_changed_export_preserves_versions_and_reconciles_retry(self):
        client = Phoenix(os.environ['GH_PHOENIX_URL'])
        name = 'gh-reconciliation-' + uuid.uuid4().hex
        rows = [{'id': name + '-a', 'input': {'prompt': 'fixture', 'canonicalScope': '.\0AGENTS.md'}, 'output': {'value': 1},
                 'metadata': {'groupKeys': ['fixture:' + name]}, 'split': 'train'}]
        with tempfile.TemporaryDirectory() as directory:
            receipt = Path(directory) / 'receipt.json'
            first = client.publish(name, rows, receipt)
            changed = copy.deepcopy(rows)
            changed[0]['output']['value'] = 2
            changed.append({**copy.deepcopy(rows[0]), 'id': name + '-b'})
            with self.assertRaisesRegex(ValueError, 'previous'):
                client.publish(name, changed, receipt)
            second = client.publish(name, changed, receipt, previous=first)
            self.assertNotEqual(first['datasetVersion'], second['datasetVersion'])
            self.assertEqual(client.verify(first)['verified'], 1)
            self.assertEqual(client.examples(first['datasetId'], first['datasetVersion'])[0]['input'], rows[0]['input'])
            self.assertEqual(client.verify(second)['verified'], 2)
            self.assertEqual(client.publish(name, changed, receipt, previous=first), second)
            trials = [{'trial': name + str(i), 'task_id': rows[0]['id'], 'family': 'fixture', 'repetition': i,
                       'exit_code': 0, 'timed_out': False, 'run_identity': str(i), 'started': 1000 + i, 'ended': 1001 + i} for i in [1, 2, 3]]
            summary = report(trials, [])
            experiment = publish(client, first, summary, Path(directory) / 'experiment.json')
            self.assertEqual(experiment['runs'], 3)
            self.assertEqual(publish(client, first, summary, Path(directory) / 'experiment.json'), experiment)
            conflict = copy.deepcopy(rows)
            conflict[0]['split'] = 'test'
            with self.assertRaisesRegex(RuntimeError, 'split'):
                client.publish(name, conflict, receipt, previous=second)
            conflict[0]['id'] = name + '-other'
            with self.assertRaisesRegex(RuntimeError, 'split group conflict'):
                client.publish(name + '-conflict', conflict, receipt)


class EncodingTests(unittest.TestCase):
    def test_null_and_reserved_envelopes_round_trip_without_replacing_source_text(self):
        for value in [{'scope': 'artifacts\0AGENTS.md'}, {'ghEncoding': 'json-text-v1', 'ghJson': 'literal'}, {'ordinary': '\\u0000'}]:
            self.assertEqual(decode_field(encode_field(value)), value)



def curated_fixture():
    request = {'config': {'provider': 'fixture', 'model': 'fixture'}, 'messages': []}
    response = {'id': 'fixture-answer', 'role': 'assistant', 'source': {'kind': 'model'}, 'content': [{'type': 'text', 'text': '42'}]}
    target = {'policy': 'final-answer', 'event': 3, 'blocks': [0], 'reasoning': 'omit'}
    provenance = {'messageId': 'fixture-answer', 'throughSeq': 4, 'session': 'fixture', 'sourceHash': '1' * 64, 'sourceEvent': 3, 'inheritedEventCount': 0,
                  'requestHash': digest(request), 'toolsHash': digest(None), 'configHash': digest(request['config']),
                  'outputHash': digest(response['content']), 'rowHash': digest({'request': request, 'response': response, 'target': {**target, 'event': None}}),
                  'transformationHash': digest({'version': 3, 'reconstruction': 'upstream-surface', 'objective': 'final-answer', 'reasoning': 'retain-source-omit-target'})}
    provenance['review'] = {'contentHash': provenance['sourceHash'], 'transformationHash': provenance['transformationHash']}
    candidate = {'version': 3, 'humanFeedback': None, 'trainingReady': False, 'sftEligible': True, 'request': request, 'response': response, 'target': target,
                 'provenance': provenance, 'split': 'train', 'sourceEvidence': {'approvals': []}, 'grade': {'required': ['semantics'], 'observations': {'semantics': {'status': 'pass'}}}}
    fidelity = {'status': 'byte-exact', 'canonicalRequestHash': provenance['requestHash'], 'canonicalSourceHash': provenance['sourceHash'],
                'session': 'fixture', 'event': 3, 'recordedHash': 'e' * 64, 'reconstructedHash': 'e' * 64}
    return {'id': provenance['rowHash'], 'input': {'request': request}, 'output': {'response': response, 'target': target}, 'split': 'train',
            'metadata': {'candidate': candidate, 'fidelity': fidelity, 'groupKeys': ['fixture:admission']}}


class CuratedAdmissionTests(unittest.TestCase):
    def test_valid_candidate_passes_the_file_gate(self):
        validate_curated(curated_fixture())

    def test_rejects_corrupted_admission_evidence_before_native_access(self):
        mutations = [
            ('missing fidelity', lambda row: row['metadata'].pop('fidelity')),
            ('request fidelity', lambda row: row['metadata']['fidelity'].update(canonicalRequestHash='0' * 64)),
            ('source fidelity', lambda row: row['metadata']['fidelity'].update(canonicalSourceHash='0' * 64)),
            ('event fidelity', lambda row: row['metadata']['fidelity'].update(event=4)),
            ('session fidelity', lambda row: row['metadata']['fidelity'].update(session='unrelated')),
            ('wire fidelity', lambda row: row['metadata']['fidelity'].update(recordedHash='0' * 64)),
            ('split', lambda row: row.update(split='test')),
            ('approval', lambda row: row['metadata']['candidate']['sourceEvidence']['approvals'].append({'type': 'approval/asked'})),
            ('ineligible', lambda row: row['metadata']['candidate'].update(sftEligible=False)),
            ('unknown grade', lambda row: row['metadata']['candidate']['grade']['observations']['semantics'].update(status='unknown')),
        ]
        for label, mutate in mutations:
            with self.subTest(label=label):
                row = curated_fixture()
                mutate(row)
                client = Phoenix()
                with patch.object(client, 'pages', side_effect=AssertionError('Unexpected native access')):
                    with self.assertRaises(ValueError):
                        client.publish('fixture', [row], Path('unused-receipt.json'))


    def test_candidate_is_mandatory_for_curated_exports(self):
        row = curated_fixture()
        row['metadata'].pop('candidate')
        for kwargs in [{'require_curated': True}, {'source_inventory': {'graderVersion': 'fixture'}}]:
            with self.subTest(kwargs=kwargs), patch.object(Phoenix, 'pages', side_effect=AssertionError('Unexpected native access')):
                with self.assertRaisesRegex(ValueError, 'candidate on every example'):
                    Phoenix().publish('fixture', [row], Path('unused-receipt.json'), **kwargs)

    def test_tool_targets_require_distinct_passing_decisions(self):
        row = curated_fixture()
        c = row['metadata']['candidate']
        c['response']['content'] = [{'type': 'tool-call', 'id': 'call', 'name': 'read', 'arguments': '{}'}]
        c['target']['policy'] = 'tool-decision'
        p = c['provenance']
        p['outputHash'] = digest(c['response']['content'])
        p['rowHash'] = digest({'request': c['request'], 'response': c['response'], 'target': {**c['target'], 'event': None}})
        p['transformationHash'] = digest({'version': 3, 'reconstruction': 'upstream-surface', 'objective': 'tool-decision', 'reasoning': 'retain-source-omit-target'})
        p['review']['transformationHash'] = p['transformationHash']
        row['id'] = p['rowHash']
        passed = {'call': 4, 'status': 'pass', 'evidence': ['fixture']}
        c['grade']['decisions'] = [passed]
        c['sourceEvidence']['toolDecisions'] = [{'block': 0, 'call': 4, 'callId': 'call', 'name': 'read', 'arguments': '{}'}]
        validate_curated(row)
        for decisions in [[], [{**passed, 'status': 'fail'}], [{**passed, 'status': 'unknown'}], [passed, passed], [{**passed, 'call': 2}]]:
            with self.subTest(decisions=decisions):
                c['grade']['decisions'] = decisions
                with self.assertRaisesRegex(ValueError, 'binding|distinct passing decisions'):
                    validate_curated(row)


if __name__ == '__main__':
    unittest.main()
