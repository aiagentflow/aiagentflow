import unittest

from app.csvline import parse_line


class CsvTest(unittest.TestCase):
    def test_plain(self):
        self.assertEqual(parse_line("a,b,c"), ["a", "b", "c"])
