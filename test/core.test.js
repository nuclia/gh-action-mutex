const assert = require('node:assert/strict');
const test = require('node:test');

const { createCore } = require('../src/core');

test('reads GitHub Actions inputs with hyphenated names', () => {
  const core = createCore({
    'INPUT_REPO-TOKEN': 'abc123',
    INPUT_GITHUB_SERVER: 'github.example.com',
  });

  assert.equal(core.getInput('repo-token'), 'abc123');
  assert.equal(core.getInput('github_server'), 'github.example.com');
});
