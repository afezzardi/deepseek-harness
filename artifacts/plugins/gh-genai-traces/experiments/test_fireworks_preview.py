"""Native preview provenance and ordered loss checks reject corrupted or incomplete evidence."""
import copy
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fireworks_bundle import write_bundle
from fireworks_preview import capture
from phoenix_dataset import atomic, digest
from test_fireworks_bundle import snapshot
from verify_fireworks_preview import compare_rendering, verify


class TemplateFixture:
    chat_template = "{%- set resolved_reasoning_effort = reasoning_effort|default('fixture-effort') %}"

    def apply_chat_template(self, messages, **kwargs):
        target = messages[-1]
        return 'context\n<think>\n' + target.get('reasoning_content', '').strip() + '\n</think>\n\n' + target['content'].strip() + '<|im_end|>\n'


def preview_row():
    return {'messages': [{'role': 'user', 'content': 'fixture'},
                         {'role': 'assistant', 'content': '42', 'reasoning_content': 'Observed 42.', 'weight': 1}]}


def rendering():
    return {'thinkingTraceHistoryMode': 'THINKING_TRACE_HISTORY_MODE_PRESERVED', 'renderedDatums': [
        {'datumIndex': 0, 'segments': [{'text': 'context\n<think>\n', 'lossWeight': 0, 'image': None},
                                     {'text': 'Observed 42.\n</think>\n\n42<|im_end|>', 'lossWeight': 1, 'image': None}]}]}


class PreviewTests(unittest.TestCase):
    def test_template_adaptations_reject_an_unverified_revision(self):
        for options in ({'json_serialization': 'ascii'}, {'tool_responses': 'separate'}):
            with self.subTest(options=options), self.assertRaisesRegex(ValueError, 'template SHA-256'):
                compare_rendering(preview_row(), rendering(), TemplateFixture(), **options)
        result = compare_rendering(preview_row(), rendering(), TemplateFixture())
        self.assertEqual(result['comparisonSettings']['native']['reasoning_effort'], 'fixture-effort')
        tokenizer = TemplateFixture()
        tokenizer.chat_template = 'no default'
        with self.assertRaisesRegex(ValueError, 'reasoning_effort default'):
            compare_rendering(preview_row(), rendering(), tokenizer)

    def test_missing_credentials_leave_the_output_path_available_for_retry(self):
        with tempfile.TemporaryDirectory() as directory, patch('fireworks_preview.api_key', side_effect=FileNotFoundError('credentials')):
            output = Path(directory) / 'preview'
            with self.assertRaises(FileNotFoundError):
                capture('accounts/fixture/datasets/source', 'fixture-model', output, 4096)
            self.assertFalse(output.exists())

    def test_selected_continuation_includes_reasoning_and_termination_but_never_context(self):
        row, native = preview_row(), rendering()
        self.assertTrue(compare_rendering(row, native, TemplateFixture())['selectedLossMatch'])
        for change in ('context-loss', 'omitted-target', 'fractional', 'reordered', 'truncated', 'missing-datum', 'datum-index', 'remote-error'):
            with self.subTest(change=change):
                broken = copy.deepcopy(native)
                segments = broken['renderedDatums'][0]['segments']
                if change == 'context-loss':
                    segments[0]['lossWeight'] = 1
                elif change == 'omitted-target':
                    segments[1]['lossWeight'] = 0
                elif change == 'fractional':
                    segments[1]['lossWeight'] = 0.5
                elif change == 'reordered':
                    segments.reverse()
                elif change == 'truncated':
                    segments[1]['text'] = segments[1]['text'].removesuffix('<|im_end|>')
                elif change == 'missing-datum':
                    broken['renderedDatums'] = []
                elif change == 'datum-index':
                    broken['renderedDatums'][0]['datumIndex'] = 1
                else:
                    broken['error'] = 'preview size limit'
                with self.assertRaises(ValueError):
                    compare_rendering(row, broken, TemplateFixture())

    def test_preview_source_lines_and_page_hashes_bind_to_the_submitted_file(self):
        receipt, examples, splits = snapshot()
        row = preview_row()
        with tempfile.TemporaryDirectory() as directory:
            bundle, preview = Path(directory) / 'bundle', Path(directory) / 'preview'
            write_bundle(bundle, receipt, examples, splits, converter=lambda *_: [row])
            page = {'examples': [{'sourceJsonlRowIndex': '0', 'sourceJsonlLineNumber': '1', 'sourceJsonl': json.dumps(row),
                                 'renderings': [rendering()]}], 'totalCount': '1',
                    'thinkingTraceHistoryModeOptions': [{'mode': 'THINKING_TRACE_HISTORY_MODE_PRESERVED', 'default': True}]}
            def persist(value):
                atomic(preview / 'page.json', value)
                atomic(preview / 'receipt.json', {'dataset': 'fixture', 'baseModel': 'fixture', 'complete': True,
                                                'pages': [{'file': 'page.json', 'responseHash': digest(value)}]})
            persist(page)
            self.assertEqual(verify(bundle, 'train', preview, TemplateFixture())['sourceRowsVerified'], 1)
            for mutation in ('hash', 'source', 'line', 'missing', 'duplicate', 'empty-modes', 'duplicate-modes'):
                with self.subTest(mutation=mutation):
                    corrupt = copy.deepcopy(page)
                    if mutation == 'source':
                        corrupt['examples'][0]['sourceJsonl'] = '{}'
                    elif mutation == 'line':
                        corrupt['examples'][0]['sourceJsonlLineNumber'] = '2'
                    elif mutation == 'missing':
                        corrupt['examples'] = []
                    elif mutation == 'duplicate':
                        corrupt['examples'] *= 2
                    elif mutation == 'empty-modes':
                        corrupt['thinkingTraceHistoryModeOptions'] = []
                        corrupt['examples'][0]['renderings'] = []
                    elif mutation == 'duplicate-modes':
                        corrupt['thinkingTraceHistoryModeOptions'] *= 2
                        corrupt['examples'][0]['renderings'] *= 2
                    persist(corrupt)
                    if mutation == 'hash':
                        atomic(preview / 'page.json', {})
                    with self.assertRaises(ValueError):
                        verify(bundle, 'train', preview, TemplateFixture())

    def test_capture_paginates_only_the_renderer_and_keeps_credentials_out_of_receipts(self):
        pages = [{'examples': [], 'nextPageToken': 'second'}, {'examples': [], 'totalCount': '0'}]
        calls = []
        def respond(request, **kwargs):
            calls.append(request)
            return io.BytesIO(json.dumps(pages[len(calls) - 1]).encode())
        with tempfile.TemporaryDirectory() as directory, patch('fireworks_preview.api_key', return_value='fixture-secret'), patch('urllib.request.urlopen', side_effect=respond):
            output = Path(directory) / 'preview'
            result = capture('accounts/fixture/datasets/source', 'fixture-model', output, 4096)
            self.assertEqual(result['pages'], 2)
            self.assertTrue(all(r.full_url == 'https://api.fireworks.ai/v1/accounts/fixture/datasets/source:renderPreview' for r in calls))
            self.assertEqual(json.loads(calls[1].data)['pageToken'], 'second')
            self.assertEqual(json.loads(calls[0].data)['pageSize'], 1)
            self.assertNotIn('fixture-secret', (output / 'receipt.json').read_text())
            self.assertTrue(json.loads((output / 'receipt.json').read_text())['complete'])


if __name__ == '__main__':
    unittest.main()
