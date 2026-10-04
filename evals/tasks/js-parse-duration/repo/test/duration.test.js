import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration } from '../src/duration.js';

test('parses seconds', () => assert.equal(parseDuration('90s'), 90_000));
