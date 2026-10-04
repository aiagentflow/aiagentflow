import re
from collections import Counter


def top_words(text: str, n: int) -> list[tuple[str, int]]:
    words = re.findall(r"[a-z0-9]+(?:'[a-z0-9]+)*", text.lower())
    return sorted(Counter(words).items(), key=lambda kv: (-kv[1], kv[0]))[:n]
