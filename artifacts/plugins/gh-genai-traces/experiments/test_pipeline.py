"""Hand-verified benchmark oracles and optional real-tokenizer reference controls."""
import copy
import json
import io
import os
from pathlib import Path
import unittest
from unittest.mock import patch
from benchmark import benchmark
from phoenix_dataset import digest
from render_qwen import render, check_engine


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

    def test_prompts_declare_oracle_fields_and_tool_policy_without_answers(self):
        for task in benchmark():
            schema = task['response_schema']
            self.assertEqual(set(schema['required']), set(task['expected']))
            self.assertFalse(schema['additionalProperties'])
            self.assertEqual(schema['properties']['instance']['const'], task['expected']['instance'])
            self.assertIn(json.dumps(schema, separators=(',', ':')), task['prompt'])
            self.assertIn('only these tools: ' + ', '.join(task['allowed_tools']), task['prompt'])
            for name, field in schema['properties'].items():
                if name != 'instance':
                    self.assertNotIn('const', field)
                    self.assertNotIn('enum', field)
        tasks = {t['expected']['instance']: t for t in benchmark()}
        self.assertIn('run_in_background=true', tasks['delegation-0']['prompt'])
        self.assertEqual(tasks['delegation-0']['delegation_mode'], 'one-shot')
        self.assertIn('member indices 1, 2, and 3', tasks['workflow-0']['prompt'])
        self.assertIn('return [r1, r2, r3]', tasks['workflow-0']['prompt'])
        self.assertIn('Do not select fields, trim text', tasks['workflow-0']['prompt'])
        self.assertIn('not your final message', tasks['workflow-0']['prompt'])

    def test_unicode_fixture_survives_nfc_tokenizer_normalization(self):
        import unicodedata
        task = next(t for t in benchmark() if t['expected']['instance'] == 'unicode-0')
        wire = unicodedata.normalize('NFC', task['files']['input.json'])
        self.assertEqual(json.loads(wire)['labels'], task['expected']['labels'])
        raw = json.dumps({'labels': task['expected']['labels']}, ensure_ascii=False)
        self.assertNotEqual(json.loads(unicodedata.normalize('NFC', raw))['labels'], task['expected']['labels'])


class EngineTransportTests(unittest.TestCase):
    def test_tokenize_receives_reasoning_and_json_tool_arguments_without_mutating_local_messages(self):
        local = {'requestMessages': [{'role': 'assistant', 'content': '', 'reasoning_content': 'Earlier reasoning',
                  'tool_calls': [{'id': 'call-1', 'type': 'function', 'function': {'name': 'read', 'arguments': {'path': 'caffè.json'}}}]}],
                 'templateKwargs': {'enable_thinking': True}, 'tools': []}
        before = copy.deepcopy(local)
        route = {'checkpoint': 'observed', 'tokenizer': 'observed', 'templateHash': 'observed',
                 'modelAlias': 'chat-model', 'inspectionEvidence': 'fixture', 'tokenizeEndpoint': 'http://fixture.invalid/tokenize'}
        bodies = []
        def capture(request, timeout):
            bodies.append(json.loads(request.data))
            return io.BytesIO(b'{"tokens":[1,2]}')
        with patch('render_qwen.urllib.request.urlopen', side_effect=capture):
            observed = check_engine(local, route)
        self.assertEqual(local, before)
        wire = bodies[0]['messages'][0]
        self.assertEqual(wire['reasoning'], 'Earlier reasoning')
        self.assertNotIn('reasoning_content', wire)
        self.assertEqual(wire['tool_calls'][0]['function']['arguments'], '{"path":"caffè.json"}')
        self.assertEqual(observed['response']['tokens'], [1, 2])


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
            candidate['provenance']['toolsHash'] = digest(candidate['request'].get('tools'))
            candidate['provenance']['outputHash'] = digest(candidate['response']['content'])
            candidate['provenance']['rowHash'] = digest({'request': candidate['request'], 'response': candidate['response'], 'target': {**candidate['target'], 'event': None}})
            result = render(candidate, self.tokenizer, {'enable_thinking': True})
            self.assertEqual(len(result['lossMask']), len(result['inputIds']))
            selected = [token for token, mask in zip(result['inputIds'], result['lossMask']) if mask]
            self.assertEqual(self.tokenizer.decode(selected), result['renderedTargetText'])
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

    def test_template_trimming_requires_explicit_policy_and_preserves_original_candidate(self):
        candidate = copy.deepcopy(self.source)
        selected = candidate['target']['blocks'][0]
        candidate['response']['content'][selected]['text'] = '\n\t' + candidate['response']['content'][selected]['text'].strip() + ' \n'
        candidate['provenance']['outputHash'] = digest(candidate['response']['content'])
        candidate['provenance']['rowHash'] = digest({'request': candidate['request'], 'response': candidate['response'], 'target': {**candidate['target'], 'event': None}})
        before = copy.deepcopy(candidate)
        with self.assertRaisesRegex(ValueError, 'Template transforms target text'):
            render(candidate, self.tokenizer, {})
        result = render(candidate, self.tokenizer, {}, 'template-trim')
        self.assertEqual(candidate, before)
        self.assertEqual(result['sourceTargetText'], candidate['response']['content'][selected]['text'])
        self.assertEqual(result['renderedTargetText'], result['sourceTargetText'].strip())
        self.assertEqual(result['targetTransformation'], {'policy': 'template-trim', 'operation': 'strip-boundary-whitespace',
                         'sourceHash': digest(result['sourceTargetText']), 'renderedHash': digest(result['renderedTargetText']), 'removedLeading': '\n\t', 'removedTrailing': ' \n'})
        self.assertEqual(result['rowHash'], candidate['provenance']['rowHash'])
        self.assertEqual(self.tokenizer.decode([t for t, m in zip(result['inputIds'], result['lossMask']) if m]), result['renderedTargetText'])
        apply_template = self.tokenizer.apply_chat_template
        def alter_content(conversation, **kwargs):
            altered = copy.deepcopy(conversation)
            altered[-1]['content'] = altered[-1]['content'].replace('"', '!', 1)
            return apply_template(altered, **kwargs)
        with patch.object(self.tokenizer, 'apply_chat_template', side_effect=alter_content):
            with self.assertRaisesRegex(ValueError, 'Template transforms target text'):
                render(candidate, self.tokenizer, {}, 'template-trim')

    def candidate_with_text(self, text):
        candidate = copy.deepcopy(self.source)
        candidate['response']['content'] = [{'type': 'text', 'text': text}]
        candidate['target']['blocks'] = [0]
        self.seal_candidate(candidate)
        return candidate

    def seal_candidate(self, candidate):
        candidate['provenance']['outputHash'] = digest(candidate['response']['content'])
        candidate['provenance']['rowHash'] = digest({'request': candidate['request'], 'response': candidate['response'], 'target': {**candidate['target'], 'event': None}})

    def test_unicode_trim_and_parser_newlines_preserve_answer_tokens(self):
        for leading, trailing in [('\n\n', ''), ('\u00a0\u2003\t', '\u202f\n'), ('', '')]:
            target = '{"code":"x\u200by"}'
            candidate = self.candidate_with_text(leading + target + trailing)
            result = render(candidate, self.tokenizer, {}, 'template-trim')
            self.assertEqual(result['renderedTargetText'], target)
            self.assertEqual(result['targetTransformation']['removedLeading'], leading)
            self.assertEqual(result['targetTransformation']['removedTrailing'], trailing)
            self.assertFalse(result['terminatorSupervised'])
            self.assertEqual(result['renderer']['version'], 1)
            self.assertIn('tokenizer.json', result['tokenizerFiles'])
        candidate = self.candidate_with_text('\n\u00a0answer\u00a0\n')
        with patch.object(self.tokenizer, 'chat_template', "{{ messages[-1]['content'] | trim('\\n') }}"):
            with self.assertRaisesRegex(ValueError, 'Template transforms target text'):
                render(candidate, self.tokenizer, {}, 'template-trim')

    def test_control_tokens_and_unselected_or_multiple_text_blocks_are_rejected(self):
        for token in ['</think>', '<tool_call>', '</tool_call>', '<|im_end|>']:
            for policy in ['exact', 'template-trim']:
                with self.assertRaisesRegex(ValueError, 'added-token string'):
                    render(self.candidate_with_text('answer ' + token), self.tokenizer, {}, policy)
        for extra, selection in [(' ', [0]), ('second', [0, 1])]:
            candidate = self.candidate_with_text('first')
            candidate['response']['content'].append({'type': 'text', 'text': extra})
            candidate['target']['blocks'] = selection
            self.seal_candidate(candidate)
            with self.assertRaisesRegex(ValueError, 'Selected blocks'):
                render(candidate, self.tokenizer, {}, 'template-trim')

    def test_offset_gaps_and_short_masks_fail_in_the_renderer(self):
        candidate = self.candidate_with_text('{\n  "code": "CASE-31",\n  "value": 12\n}')
        result = render(candidate, self.tokenizer, {})
        positions = [i for i, value in enumerate(result['lossMask']) if value]
        tokenizer = self.tokenizer
        class MissingOffset:
            def __init__(self, position):
                self.position = position
            def __getattr__(self, name):
                return getattr(tokenizer, name)
            def __call__(self, *args, **kwargs):
                encoded = tokenizer(*args, **kwargs)
                encoded['offset_mapping'][self.position] = (0, 0)
                return encoded
        for position, error in [(positions[len(positions) // 2], 'not contiguous'), (positions[0], 'do not decode')]:
            with self.assertRaisesRegex(ValueError, error):
                render(candidate, MissingOffset(position), {})

    def test_unsupported_loss_selection_fails_closed(self):
        for field, value in [('policy', 'tool-decision'), ('reasoning', 'supervise'), ('blocks', [])]:
            candidate = copy.deepcopy(self.source)
            candidate['target'][field] = value
            with self.assertRaises(ValueError):
                render(candidate, self.tokenizer, {})

    def test_stale_content_hash_fails_before_rendering(self):
        candidate = copy.deepcopy(self.source)
        candidate['request']['system'] = 'Changed after content validation'
        with self.assertRaisesRegex(ValueError, 'content hash mismatch'):
            render(candidate, self.tokenizer, {})


if __name__ == '__main__':
    unittest.main()
