import unittest

from app.words import top_words


class WordsTest(unittest.TestCase):
    def test_simple(self):
        self.assertEqual(top_words("a a b", 1), [("a", 2)])
