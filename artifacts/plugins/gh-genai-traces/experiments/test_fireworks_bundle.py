"""Pinned export rejects changed evidence and preserves destination split isolation."""
import copy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from fireworks_bundle import select_examples, serialize, write_bundle
from phoenix_dataset import digest, row_digest
from test_publication import curated_fixture


def snapshot():
    row = curated_fixture()
    receipt = {'version': 2, 'count': 1, 'rowHashes': {row['id']: row_digest(row)}}
    return receipt, [row], {row['id']: 'train'}


class BundleTests(unittest.TestCase):
    def test_source_mutations_and_changed_frozen_splits_reject_before_conversion(self):
        for mutation in ('content', 'split', 'missing-split', 'duplicate', 'missing', 'count'):
            with self.subTest(mutation=mutation):
                receipt, rows, splits = snapshot()
                if mutation == 'content':
                    rows[0]['input']['request']['config']['model'] = 'changed'
                elif mutation == 'split':
                    splits[rows[0]['id']] = 'test'
                elif mutation == 'missing-split':
                    splits.clear()
                elif mutation == 'duplicate':
                    rows.append(copy.deepcopy(rows[0]))
                elif mutation == 'missing':
                    rows.clear()
                else:
                    receipt['count'] = 2
                with self.assertRaises(ValueError):
                    select_examples(receipt, rows, splits)

    def test_private_files_bind_lineage_and_refuse_overwrite(self):
        receipt, rows, splits = snapshot()
        submitted = {'messages': [{'role': 'user', 'content': 'fixture'}, {'role': 'assistant', 'content': '42', 'weight': 1}]}
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'bundle'
            manifest = write_bundle(output, receipt, rows, splits, converter=lambda *_: [submitted])
            self.assertEqual(manifest['rows'][0]['submittedRowHash'], digest(submitted))
            self.assertEqual(manifest['files']['train.jsonl']['examples'], 1)
            self.assertEqual(manifest['files']['test.jsonl']['examples'], 0)
            self.assertFalse(manifest['trainingReady'])
            self.assertEqual(output.stat().st_mode & 0o777, 0o700)
            for file in output.iterdir():
                self.assertEqual(file.stat().st_mode & 0o777, 0o600)
            before = (output / 'manifest.json').read_bytes()
            with self.assertRaises(FileExistsError):
                write_bundle(output, receipt, rows, splits, converter=lambda *_: [submitted])
            self.assertEqual(before, (output / 'manifest.json').read_bytes())

    def test_conversion_failure_leaves_no_apparently_complete_bundle(self):
        receipt, rows, splits = snapshot()
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'bundle'
            with patch('fireworks_bundle.serialize', side_effect=ValueError('invalid roles')) as converter:
                with self.assertRaisesRegex(ValueError, 'invalid roles'):
                    write_bundle(output, receipt, rows, splits, converter=converter)
            self.assertFalse(output.exists())

    def test_real_node_converter_reports_the_rejected_input(self):
        with self.assertRaisesRegex(ValueError, 'Unsupported SFT objective'):
            serialize([], 'unsupported')
        with self.assertRaisesRegex(ValueError, 'invalid_type'):
            serialize([{}], 'outcome-reasoning')


if __name__ == '__main__':
    unittest.main()
