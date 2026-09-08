"""Hand-verified benchmark oracles and optional real-tokenizer reference controls."""
import copy
import json
import os
from pathlib import Path
import unittest
from benchmark import benchmark
from phoenix_dataset import digest
from render_qwen import render


class BenchmarkTests(unittest.TestCase):
    def test_distinct_instances_and_balanced_frozen_splits(self):
        tasks = benchmark()
        self.assertEqual(tasks, benchmark())
        self.assertEqual(len({t['task_id'] for t in tasks}), 48)
        self.assertEqual(len({t['family'] for t in tasks}), 12)
        for split in ['train', 'validation', 'test']:
            self.assertEqual({t['domain'] for t in tasks if t['split'] == split}, {'business', 'repository'})
        self.assertEqual(sum(t['domain'] == 'business' for t in tasks), 24)
        self.assertTrue(all(t.get('driver') in [None, 'resume-two-turns'] for t in tasks))

    def test_hand_calculated_expected_values(self):
        tasks = {t['expected']['instance']: t for t in benchmark()}
        self.assertEqual(tasks['aggregation-0']['expected']['total'], 200)
        self.assertEqual(tasks['aggregation-3']['expected']['total'], 206)
        self.assertEqual(tasks['ordering-0']['expected']['ids'], ['d', 'a', 'b', 'c'])
        self.assertEqual(tasks['ordering-1']['expected']['ids'], ['a', 'd', 'b', 'c'])
        self.assertEqual(tasks['reconciliation-3']['expected']['outstanding'], {'a': 33, 'b': 200})
        self.assertEqual(tasks['reconciliation-3']['expected']['unmatched'], ['x'])
        self.assertEqual(tasks['unicode-0']['expected']['labels'][2:4], ['e\u0301', 'é'])
        self.assertEqual(tasks['scoped-edit-3']['outputs']['config.json'], {'enabled': True, 'limit': 11})


@unittest.skipUnless(os.environ.get('GH_TOKENIZER') and os.environ.get('GH_RENDER_CANDIDATE'), 'Reference tokenizer and neutral fixture required')
class RendererTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from transformers import AutoTokenizer
        cls.tokenizer = AutoTokenizer.from_pretrained(os.environ['GH_TOKENIZER'], local_files_only=True, trust_remote_code=False)
        cls.source = json.loads(Path(os.environ['GH_RENDER_CANDIDATE']).read_text())

    def test_context_reasoning_tools_recovery_and_long_context(self):
        evidence = []
        for case in ['tool-trajectory', 'final-answer', 'reasoning-bearing', 'recovery', 'long-context']:
            candidate = copy.deepcopy(self.source)
            if case == 'final-answer':
                candidate['request']['messages'] = [m for m in candidate['request']['messages'] if m['role'] == 'user']
                candidate['request'].pop('tools', None)
            if case == 'reasoning-bearing':
                candidate['response']['content'].insert(0, {'type': 'reasoning', 'text': 'UNGRADED_TARGET_REASONING'})
                candidate['target']['blocks'] = [i + 1 for i in candidate['target']['blocks']]
            if case == 'recovery':
                tool = next(m for m in candidate['request']['messages'] if m['source']['kind'] == 'tool')
                tool['content'][0]['isError'] = True
                tool['content'][0]['content'] = [{'type': 'text', 'text': 'RECORDED_INTERRUPTION_REPAIR'}]
            if case == 'long-context':
                candidate['request']['messages'][0]['content'][0]['text'] += '\n' + 'Unchanged historical entry.\n' * 6000
            candidate['provenance']['requestHash'] = digest(candidate['request'])
            candidate['provenance']['rowHash'] = digest({'request': candidate['request'], 'response': candidate['response'], 'target': {**candidate['target'], 'event': None}})
            result = render(candidate, self.tokenizer, {'enable_thinking': True})
            self.assertEqual(len(result['lossMask']), len(result['inputIds']))
            selected = [token for token, mask in zip(result['inputIds'], result['lossMask']) if mask]
            self.assertEqual(self.tokenizer.decode(selected), result['targetText'])
            self.assertNotIn('UNGRADED_TARGET_REASONING', result['renderedText'])
            if case == 'recovery':
                self.assertIn('RECORDED_INTERRUPTION_REPAIR', result['renderedText'])
            if case == 'long-context':
                self.assertGreater(len(result['inputIds']), 20_000)
            evidence.append({'case': case, 'tokens': len(result['inputIds']), 'lossTokens': sum(result['lossMask']),
                             'renderHash': digest(result['renderedText']), 'maskHash': digest(result['lossMask']), 'rowHash': result['rowHash']})
        if os.environ.get('GH_RENDER_REPORT'):
            from phoenix_dataset import atomic
            atomic(os.environ['GH_RENDER_REPORT'], {'referenceOnly': True, 'observedRoute': None, 'cases': evidence})

    def test_unsupported_loss_selection_fails_closed(self):
        for field, value in [('policy', 'tool-decision'), ('reasoning', 'supervise'), ('blocks', [])]:
            candidate = copy.deepcopy(self.source)
            candidate['target'][field] = value
            with self.assertRaises(ValueError):
                render(candidate, self.tokenizer, {})


if __name__ == '__main__':
    unittest.main()
