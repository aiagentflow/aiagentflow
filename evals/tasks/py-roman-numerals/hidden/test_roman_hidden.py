import unittest

from app.roman import from_roman, to_roman


class RomanHidden(unittest.TestCase):
    def test_round_trip(self):
        for n in range(1, 4000):
            self.assertEqual(from_roman(to_roman(n)), n)

    def test_known(self):
        self.assertEqual(to_roman(1994), "MCMXCIV")
        self.assertEqual(from_roman("MMXXVI"), 2026)

    def test_invalid(self):
        for bad in (0, 4000, -1):
            with self.assertRaises(ValueError):
                to_roman(bad)
        for bad in ("IIII", "VX", "", "ABC"):
            with self.assertRaises(ValueError):
                from_roman(bad)
