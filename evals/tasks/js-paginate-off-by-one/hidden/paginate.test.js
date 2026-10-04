import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paginate } from '../src/paginate.js';

test('page 1 is the first page', () => assert.deepEqual(paginate([1, 2, 3, 4, 5], 1, 2), [1, 2]));
test('last partial page', () => assert.deepEqual(paginate([1, 2, 3, 4, 5], 3, 2), [5]));
test('page past the end is empty', () => assert.deepEqual(paginate([1, 2, 3], 5, 2), []));
