import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Emitter } from '../src/emitter.js';

test('once fires a single time', () => {
    const e = new Emitter();
    let count = 0;
    e.once('x', () => count++);
    e.emit('x');
    e.emit('x');
    assert.equal(count, 1);
});
test('off removes a once listener before it fires', () => {
    const e = new Emitter();
    let count = 0;
    const listener = () => count++;
    e.once('x', listener);
    e.off('x', listener);
    e.emit('x');
    assert.equal(count, 0);
});
test('once passes arguments', () => {
    const e = new Emitter();
    let got;
    e.once('x', (a, b) => { got = a + b; });
    e.emit('x', 2, 3);
    assert.equal(got, 5);
});
