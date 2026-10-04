import unittest

from app.stats import median


class StatsTest(unittest.TestCase):
    def test_odd(self):
        self.assertEqual(median([1, 2, 3]), 2)
