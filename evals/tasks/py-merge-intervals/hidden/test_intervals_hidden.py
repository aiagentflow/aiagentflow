import unittest

from app.intervals import merge


class IntervalsHidden(unittest.TestCase):
    def test_overlap_and_touch(self):
        self.assertEqual(merge([[8, 10], [1, 3], [2, 6], [6, 7]]), [[1, 7], [8, 10]])

    def test_contained(self):
        self.assertEqual(merge([[1, 10], [2, 3]]), [[1, 10]])

    def test_empty_and_input_untouched(self):
        self.assertEqual(merge([]), [])
        data = [[3, 4], [1, 2]]
        merge(data)
        self.assertEqual(data, [[3, 4], [1, 2]])
