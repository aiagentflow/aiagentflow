const UNITS = { h: 3_600_000, m: 60_000, s: 1_000 };

/** Parse a duration like "1h30m" into milliseconds. */
export function parseDuration(text) {
    const pattern = /^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/;
    const match = typeof text === 'string' ? text.trim().match(pattern) : null;
    if (!text || !match || match.slice(1).every(p => p === undefined)) {
        throw new RangeError(`Invalid duration: "${text}"`);
    }
    const [, h = '0', m = '0', s = '0'] = match;
    return Number(h) * UNITS.h + Number(m) * UNITS.m + Number(s) * UNITS.s;
}
