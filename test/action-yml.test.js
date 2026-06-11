const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');

test('action metadata uses node24 runtime', () => {
  const action = readFileSync('action.yml', 'utf8');

  assert.match(action, /^  using: 'node24'$/m);
});
