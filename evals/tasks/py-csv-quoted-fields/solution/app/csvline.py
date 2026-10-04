def parse_line(line: str) -> list[str]:
    fields, field, quoted, i = [], [], False, 0
    while i < len(line):
        c = line[i]
        if quoted:
            if c == '"' and i + 1 < len(line) and line[i + 1] == '"':
                field.append('"')
                i += 1
            elif c == '"':
                quoted = False
            else:
                field.append(c)
        elif c == '"':
            quoted = True
        elif c == ",":
            fields.append("".join(field))
            field = []
        else:
            field.append(c)
        i += 1
    fields.append("".join(field))
    return fields
