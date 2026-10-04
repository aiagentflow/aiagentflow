import unittest

from app.stats import median


class StatsHidden(unittest.TestCase):
    def test_even(self):
        self.assertEqual(median([1, 2, 3, 4]), 2.5)

    def test_unsorted(self):
        self.assertEqual(median([5, 1, 3]), 3)

    def test_does_not_mutate(self):
        values = [3, 1, 2]
        median(values)
        self.assertEqual(values, [3, 1, 2])

    def test_empty(self):
        with self.assertRaises(ValueError):
            median([])
