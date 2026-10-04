import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LRUCache } from '../src/lru.js';

test('evicts the least recently used entry', () => {
    const cache = new LRUCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3);
    assert.equal(cache.get('b'), undefined);
    assert.equal(cache.get('a'), 1);
    assert.equal(cache.get('c'), 3);
    assert.equal(cache.size, 2);
});
test('updating a key does not grow the cache', () => {
    const cache = new LRUCache(2);
    cache.set('a', 1);
    cache.set('a', 2);
    assert.equal(cache.size, 1);
    assert.equal(cache.get('a'), 2);
});
test('missing keys return undefined', () => assert.equal(new LRUCache(1).get('x'), undefined));
