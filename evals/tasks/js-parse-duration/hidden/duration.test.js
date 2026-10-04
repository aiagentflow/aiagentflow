import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration } from '../src/duration.js';

test('units', () => {
    assert.equal(parseDuration('15m'), 900_000);
    assert.equal(parseDuration('2h'), 7_200_000);
});
test('combined with and without spaces', () => {
    assert.equal(parseDuration('1h30m'), 5_400_000);
    assert.equal(parseDuration('1h 30m 5s'), 5_405_000);
});
test('rejects invalid input', () => {
    for (const bad of ['', 'abc', '10x', 'h', '5 m']) assert.throws(() => parseDuration(bad), RangeError, bad);
});
