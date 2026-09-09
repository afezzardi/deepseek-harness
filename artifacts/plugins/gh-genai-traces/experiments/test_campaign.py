"""Campaign provenance, interruption, launch-failure, and no-inference controls."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import balanced_campaign as campaign
from benchmark import benchmark


class CampaignTests(unittest.TestCase):
    def test_identity_captures_overlay_proxy_dirty_source_and_untracked_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = ['artifacts/recproxy.py', 'artifacts/plugins/gh-genai-traces/experiments/balanced_campaign.py',
                     'artifacts/plugins/gh-genai-traces/lib/overlay.yml', 'packages/example.ts',
                     'home/settings.yaml', 'home/cordis.patch.yml']
            for name in files:
                target = root / name; target.parent.mkdir(parents=True, exist_ok=True); target.write_text('original\n')
            subprocess.run(['git', 'init', '-q', str(root)], check=True)
            subprocess.run(['git', '-C', str(root), 'add', '.'], check=True)
            subprocess.run(['git', '-C', str(root), '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture'], check=True)
            with patch.object(campaign, 'ROOT', root):
                original = campaign.execution_identity(root / 'home')
                for name in ['artifacts/plugins/gh-genai-traces/lib/overlay.yml', 'artifacts/recproxy.py', 'packages/example.ts']:
                    (root / name).write_text('changed\n')
                    self.assertNotEqual(campaign.execution_identity(root / 'home'), original)
                    (root / name).write_text('original\n')
                untracked = root / 'untracked.ts'; untracked.write_text('one\n')
                first = campaign.execution_identity(root / 'home')
                untracked.write_text('two\n')
                second = campaign.execution_identity(root / 'home')
                self.assertNotEqual(first, second)
                output = root / 'artifacts/results/campaign'; output.mkdir(parents=True)
                campaign.preserve_implementation(output, second)
                self.assertEqual((output / '.implementation/untracked.ts').read_text(), 'two\n')
                self.assertEqual(campaign.execution_identity(root / 'home'), second)
                untracked.write_text('three\n')
                with self.assertRaisesRegex(RuntimeError, 'Executable changed'):
                    campaign.preserve_implementation(output, second)

    def test_launch_failure_is_retained_and_interrupted_workspace_is_untouched(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); template = root / 'home'; template.mkdir()
            (template / 'settings.yaml').write_text('http://100.108.76.12:4000/engine/v1\n')
            (template / 'cordis.patch.yml').write_text('[]\n')
            task = benchmark()[0]; output = root / 'campaign'; output.mkdir()
            with patch.object(campaign, 'ROOT', root), patch.object(campaign.subprocess, 'Popen', side_effect=FileNotFoundError('fixture launcher missing')) as popen:
                result = campaign.execute(task, 1, output, template, 'http://127.0.0.1:1', {'fixture': True})
                self.assertEqual(result['failure_owner'], 'harness')
                self.assertIn('fixture launcher missing', result['execution_error'])
                self.assertEqual(result['exit_code'], -1)
                self.assertFalse(result['timed_out'])
                self.assertEqual(json.loads((Path(result['directory']) / 'result.json').read_text()), result)
                interrupted = output / '.trials' / (task['task_id'] + '-2'); interrupted.mkdir()
                sentinel = interrupted / 'preserve.txt'; sentinel.write_text('original')
                with self.assertRaisesRegex(RuntimeError, 'Interrupted trial.*fresh campaign directory'):
                    campaign.execute(task, 2, output, template, 'http://127.0.0.1:1', {'fixture': True})
                self.assertEqual(popen.call_count, 1)
                self.assertEqual(sentinel.read_text(), 'original')

    def test_preflight_rejects_admission_even_without_response(self):
        with tempfile.TemporaryDirectory() as directory:
            recording = Path(directory) / 'recordings.jsonl'
            self.assertEqual(campaign.verify_preflight_recordings(recording)['recordedEvents'], 0)
            recording.write_text(json.dumps({'event': 'admitted', 'request_id': 'fixture'}) + '\n')
            with self.assertRaisesRegex(RuntimeError, 'Preflight emitted proxy traffic'):
                campaign.verify_preflight_recordings(recording)


if __name__ == '__main__':
    unittest.main()
