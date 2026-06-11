const { createSign } = require('node:crypto');

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function getGitHubApiUrl(githubServer) {
  return githubServer === 'github.com'
    ? 'https://api.github.com'
    : `https://${githubServer}/api/v3`;
}

function generateJwt(appId, privateKey, now = Math.floor(Date.now() / 1000)) {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 600, iss: String(appId) }));
  const unsignedToken = `${header}.${payload}`;
  const signature = createSign('RSA-SHA256').update(unsignedToken).sign(privateKey, 'base64url');

  return `${unsignedToken}.${signature}`;
}

async function readJsonResponse(response, failureMessage) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${failureMessage}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function getInstallationToken(options) {
  const fetchImpl = options.fetch || globalThis.fetch;
  if (!fetchImpl) {
    throw new Error('fetch is not available in this Node runtime');
  }

  const apiUrl = getGitHubApiUrl(options.githubServer);
  const jwt = generateJwt(options.appId, options.privateKey, options.now);
  let installationId = options.installationId;

  if (!installationId) {
    const installationResponse = await fetchImpl(`${apiUrl}/repos/${options.repository}/installation`, {
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
      },
    });
    const installation = await readJsonResponse(
      installationResponse,
      `Failed to get installation ID for repository ${options.repository}`,
    );
    installationId = installation.id;
  }

  if (!installationId) {
    throw new Error(`Failed to get installation ID for repository ${options.repository}`);
  }

  const tokenResponse = await fetchImpl(`${apiUrl}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
    },
  });
  const tokenPayload = await readJsonResponse(tokenResponse, 'Failed to get installation access token');

  if (!tokenPayload.token) {
    throw new Error(`Failed to get installation access token: ${JSON.stringify(tokenPayload)}`);
  }

  return tokenPayload.token;
}

module.exports = {
  generateJwt,
  getGitHubApiUrl,
  getInstallationToken,
};
