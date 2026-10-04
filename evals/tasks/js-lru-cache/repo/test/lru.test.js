import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LRUCache } from '../src/lru.js';

test('stores values', () => {
    const cache = new LRUCache(2);
    cache.set('a', 1);
    assert.equal(cache.get('a'), 1);
});
