import unittest

from app.csvline import parse_line


class CsvHidden(unittest.TestCase):
    def test_quoted_comma(self):
        self.assertEqual(parse_line('a,"b,c",d'), ["a", "b,c", "d"])

    def test_escaped_quote(self):
        self.assertEqual(parse_line('"say ""hi""",x'), ['say "hi"', "x"])

    def test_empty_fields(self):
        self.assertEqual(parse_line("a,,c,"), ["a", "", "c", ""])

    def test_no_csv_module(self):
        import app.csvline as mod
        self.assertNotIn("import csv", open(mod.__file__).read())
