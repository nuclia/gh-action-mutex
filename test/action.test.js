const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildConfig,
  buildTicketId,
  runMain,
  runPost,
} = require('../src/action');

function inputCore(inputs, state = {}) {
  const savedState = {};
  const masks = [];
  const messages = [];

  return {
    getInput(name) {
      return inputs[name] ?? '';
    },
    getState(name) {
      return state[name] ?? '';
    },
    saveState(name, value) {
      savedState[name] = value;
    },
    setSecret(value) {
      masks.push(value);
    },
    info(message) {
      messages.push(message);
    },
    setFailed(error) {
      throw error instanceof Error ? error : new Error(String(error));
    },
    savedState,
    masks,
    messages,
  };
}

test('builds config with existing input defaults', () => {
  const core = inputCore({
    branch: '',
    debug: '',
    'github-app-id': '',
    'github-app-installation-id': '',
    'github-app-private-key': '',
    github_server: '',
    'internal_checkout-location': '',
    'mutex-key': '',
    operation: '',
    repository: '',
    'repo-token': '',
    'run-post-execution': '',
    'ticket-id-suffix': '',
    'token-refresh-interval': '',
  });

  assert.deepEqual(buildConfig(core, { GITHUB_REPOSITORY: 'owner/repo', RUNNER_TEMP: '/runner/temp' }), {
    branch: 'gh-mutex',
    checkoutLocation: '/runner/temp/gh-action-mutex/repo',
    debug: false,
    githubAppId: '',
    githubAppInstallationId: '',
    githubAppPrivateKey: '',
    githubServer: 'github.com',
    mutexKey: 'default',
    operation: 'lock',
    postExecution: true,
    repository: 'owner/repo',
    repoToken: '',
    ticketIdSuffix: 'default',
    tokenRefreshInterval: 2700,
  });
});

test('builds ticket id from run id mutex key and suffix', () => {
  assert.equal(
    buildTicketId({ mutexKey: 'deploy', ticketIdSuffix: 'linux' }, { GITHUB_RUN_ID: '1234' }),
    '1234-deploy-linux',
  );
});

test('runMain locks by saving state and invoking mutex lock', async () => {
  const core = inputCore({
    branch: 'locks',
    github_server: 'github.com',
    'internal_checkout-location': '/tmp/mutex',
    'mutex-key': 'deploy',
    operation: 'lock',
    repository: 'owner/repo',
    'repo-token': 'token',
    'run-post-execution': 'true',
    'ticket-id-suffix': 'a',
  });
  const calls = [];

  await runMain({
    core,
    env: { GITHUB_REPOSITORY: 'owner/repo', GITHUB_RUN_ID: '99' },
    mutex: {
      async lock(config, ticketId) {
        calls.push(['lock', config.branch, ticketId]);
      },
    },
  });

  assert.deepEqual(core.savedState, { ticket_id: '99-deploy-a' });
  assert.deepEqual(calls, [['lock', 'locks', '99-deploy-a']]);
});

test('runPost skips unlock when post execution is disabled', async () => {
  const core = inputCore({
    'run-post-execution': 'false',
  });
  const calls = [];

  await runPost({
    core,
    env: {},
    mutex: {
      async unlock() {
        calls.push('unlock');
      },
    },
  });

  assert.deepEqual(calls, []);
  assert.deepEqual(core.messages, ['Skipping post job unlock operation as run-post-execution is false.']);
});
