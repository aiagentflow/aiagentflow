import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/slug.js';

test('strips accents', () => assert.equal(slugify('Crème Brûlée'), 'creme-brulee'));
test('collapses separators and trims', () => assert.equal(slugify('  --Hello,   World!!  '), 'hello-world'));
test('keeps digits', () => assert.equal(slugify('Top 10 Tips'), 'top-10-tips'));
