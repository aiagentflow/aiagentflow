NUMERALS = [(1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"),
            (50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")]


def to_roman(n: int) -> str:
    if not 1 <= n <= 3999:
        raise ValueError(f"out of range: {n}")
    out = []
    for value, symbol in NUMERALS:
        count, n = divmod(n, value)
        out.append(symbol * count)
    return "".join(out)


def from_roman(text: str) -> int:
    values = {symbol: value for value, symbol in NUMERALS if len(symbol) == 1}
    if not text or any(c not in values for c in text):
        raise ValueError(f"invalid numeral: {text!r}")
    total = 0
    for i, c in enumerate(text):
        v = values[c]
        total += -v if i + 1 < len(text) and values[text[i + 1]] > v else v
    if not 1 <= total <= 3999 or to_roman(total) != text:
        raise ValueError(f"invalid numeral: {text!r}")
    return total
