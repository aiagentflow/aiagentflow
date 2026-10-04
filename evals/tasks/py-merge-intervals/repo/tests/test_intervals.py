import unittest

from app.intervals import merge


class IntervalsTest(unittest.TestCase):
    def test_disjoint(self):
        self.assertEqual(merge([[1, 2], [5, 6]]), [[1, 2], [5, 6]])
