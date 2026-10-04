import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paginate } from '../src/paginate.js';

test('returns a page of the requested size', () => {
    assert.equal(paginate([1, 2, 3, 4, 5], 2, 2).length, 2);
});
