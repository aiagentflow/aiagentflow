import unittest

from app.roman import to_roman


class RomanTest(unittest.TestCase):
    def test_basic(self):
        self.assertEqual(to_roman(4), "IV")
