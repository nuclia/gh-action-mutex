const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const test = require('node:test');

const {
  getGitHubApiUrl,
  generateJwt,
  getInstallationToken,
} = require('../src/github-app-auth');

test('selects public GitHub API URL for github.com', () => {
  assert.equal(getGitHubApiUrl('github.com'), 'https://api.github.com');
});

test('selects enterprise API URL for custom server', () => {
  assert.equal(getGitHubApiUrl('github.example.com'), 'https://github.example.com/api/v3');
});

test('generates a signed GitHub App JWT', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });

  const jwt = generateJwt('12345', pem, 1700000000);
  const parts = jwt.split('.');

  assert.equal(parts.length, 3);
  assert.match(Buffer.from(parts[0], 'base64url').toString('utf8'), /"alg":"RS256"/);
  assert.match(Buffer.from(parts[1], 'base64url').toString('utf8'), /"iss":"12345"/);
});

test('fetches installation token and masks it', async () => {
  const token = await getInstallationToken({
    appId: '1',
    privateKey: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }),
    installationId: '99',
    repository: 'owner/repo',
    githubServer: 'github.com',
    now: 1700000000,
    fetch: async () => ({
      ok: true,
      async json() {
        return { token: 'installation-token' };
      },
    }),
  });

  assert.equal(token, 'installation-token');
});
