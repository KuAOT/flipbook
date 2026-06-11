import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pad, pageFilename } from './naming.mjs';

test('pad zero-fills to 4 digits', () => {
  assert.equal(pad(1), '0001');
  assert.equal(pad(42), '0042');
  assert.equal(pad(102), '0102');
});

test('pad widens past 4 digits when needed', () => {
  assert.equal(pad(12345), '12345');
});

test('pageFilename builds jpg name from 1-based index', () => {
  assert.equal(pageFilename(1), '0001.jpg');
  assert.equal(pageFilename(102), '0102.jpg');
});
