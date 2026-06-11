const { createDefaultMutex } = require('./git');
const { getInstallationToken } = require('./github-app-auth');
const { createCore } = require('./core');

const defaultCore = createCore();

function input(core, name, defaultValue = '') {
  const value = core.getInput(name);
  return value === '' ? defaultValue : value;
}

function booleanInput(core, name, defaultValue) {
  const value = input(core, name, String(defaultValue)).toLowerCase();
  return value === 'true';
}

function buildConfig(core, env = process.env) {
  const defaultCheckoutLocation = env.RUNNER_TEMP
    ? `${env.RUNNER_TEMP}/gh-action-mutex/repo`
    : '/tmp/gh-action-mutex/repo';

  return {
    branch: input(core, 'branch', 'gh-mutex'),
    checkoutLocation: input(core, 'internal_checkout-location', defaultCheckoutLocation),
    debug: booleanInput(core, 'debug', false),
    githubAppId: input(core, 'github-app-id'),
    githubAppInstallationId: input(core, 'github-app-installation-id'),
    githubAppPrivateKey: input(core, 'github-app-private-key'),
    githubServer: input(core, 'github_server', 'github.com'),
    mutexKey: input(core, 'mutex-key', 'default'),
    operation: input(core, 'operation', 'lock'),
    postExecution: booleanInput(core, 'run-post-execution', true),
    repository: input(core, 'repository', env.GITHUB_REPOSITORY || ''),
    repoToken: input(core, 'repo-token'),
    ticketIdSuffix: input(core, 'ticket-id-suffix', 'default'),
    tokenRefreshInterval: Number(input(core, 'token-refresh-interval', '2700')),
  };
}

function buildTicketId(config, env = process.env) {
  return `${env.GITHUB_RUN_ID}-${config.mutexKey}-${config.ticketIdSuffix}`;
}

async function resolveConfigToken(config, core) {
  if (!config.githubAppId || !config.githubAppPrivateKey) {
    return config;
  }

  async function refreshRepoToken() {
    const repoToken = await getInstallationToken({
      appId: config.githubAppId,
      githubServer: config.githubServer,
      installationId: config.githubAppInstallationId,
      privateKey: config.githubAppPrivateKey,
      repository: config.repository,
    });
    core.setSecret(repoToken);
    return repoToken;
  }

  const repoToken = await refreshRepoToken();

  return { ...config, repoToken, refreshRepoToken };
}

async function runMain(options = {}) {
  const core = options.core || defaultCore;
  try {
    let config = buildConfig(core, options.env || process.env);
    config = await resolveConfigToken(config, core);
    const ticketId = buildTicketId(config, options.env || process.env);
    const mutex = options.mutex || await createDefaultMutex(config);

    if (config.operation === 'lock') {
      core.saveState('ticket_id', ticketId);
      await mutex.lock(config, ticketId);
      core.info('Lock successfully acquired');
      return;
    }

    if (config.operation === 'unlock') {
      await mutex.unlock(config, ticketId);
      core.info('Successfully unlocked');
      return;
    }

    throw new Error(`Invalid operation: ${config.operation}. Must be 'lock' or 'unlock'.`);
  } catch (error) {
    core.setFailed(error);
  }
}

async function runPost(options = {}) {
  const core = options.core || defaultCore;
  try {
    let config = buildConfig(core, options.env || process.env);
    if (!config.postExecution) {
      core.info('Skipping post job unlock operation as run-post-execution is false.');
      return;
    }

    config = await resolveConfigToken(config, core);
    const ticketId = core.getState('ticket_id') || buildTicketId(config, options.env || process.env);
    const mutex = options.mutex || await createDefaultMutex(config);
    await mutex.unlock(config, ticketId);
    core.info('Successfully unlocked');
  } catch (error) {
    core.setFailed(error);
  }
}

module.exports = {
  buildConfig,
  buildTicketId,
  runMain,
  runPost,
};
