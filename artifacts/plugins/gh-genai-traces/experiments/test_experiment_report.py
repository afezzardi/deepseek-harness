"""Repeatability uses independent instances and rejects incomplete repetition groups."""
import copy
import unittest
from experiment_report import report


class ReportTests(unittest.TestCase):
    def setUp(self):
        self.trials = [{'trial': str(i), 'task_id': 'task', 'family': 'fixture', 'repetition': i,
                        'exit_code': 0, 'timed_out': False, 'run_identity': str(i), 'started': i, 'ended': i + 1} for i in [1, 2, 3]]
        self.grades = [{'trial': str(i), 'session': str(i), 'grade': {'version': 'fixture', 'required': ['semantics'],
                       'observations': {'semantics': {'status': 'pass' if i == 1 else 'fail', 'evidence': ['oracle']}}}} for i in [1, 2, 3]]

    def test_mixed_repeats_and_sabotaged_grader(self):
        result = report(self.trials, self.grades)
        self.assertEqual(result['passed'], 1)
        self.assertTrue(result['instances'][0]['passAt3'])
        self.assertFalse(result['instances'][0]['passPow3'])
        self.assertEqual(result['families'][0]['instances'], 1)
        for grade in self.grades:
            grade['grade']['observations']['semantics']['status'] = 'fail'
        self.assertFalse(report(self.trials, self.grades)['instances'][0]['passAt3'])
        for grade in self.grades:
            grade['grade']['required'] = []
        self.assertEqual(report(self.trials, self.grades)['passed'], 0)

    def test_missing_duplicate_and_cross_family_repetitions_fail(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate grade'):
            report(self.trials, self.grades + [self.grades[0]])
        for trials in [self.trials[:-1], self.trials + [self.trials[0]]]:
            with self.assertRaises(ValueError):
                report(trials, self.grades)
        changed = copy.deepcopy(self.trials)
        changed[-1]['family'] = 'unrelated'
        with self.assertRaisesRegex(ValueError, 'different families'):
            report(changed, self.grades)


if __name__ == '__main__':
    unittest.main()
