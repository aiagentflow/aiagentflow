import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Emitter } from '../src/emitter.js';

test('on receives events', () => {
    const seen = [];
    new Emitter().on('x', v => seen.push(v)).emit('x', 1);
    assert.deepEqual(seen, [1]);
});
