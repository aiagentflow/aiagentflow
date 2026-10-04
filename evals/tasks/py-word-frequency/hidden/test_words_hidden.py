import unittest

from app.words import top_words


class WordsHidden(unittest.TestCase):
    def test_case_and_punctuation(self):
        self.assertEqual(top_words("The cat. THE dog! the end?", 2), [("the", 3), ("cat", 1)])

    def test_apostrophes(self):
        self.assertEqual(top_words("Don't stop; don't.", 1), [("don't", 2)])

    def test_ties_alphabetical(self):
        self.assertEqual(top_words("b a c", 3), [("a", 1), ("b", 1), ("c", 1)])
