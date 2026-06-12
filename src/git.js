const { execFile } = require('node:child_process');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const { dirname, join } = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const DEFAULT_QUEUE_FILE = 'mutex_queue';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function repoUrl(config) {
  return `https://x-access-token:${config.repoToken}@${config.githubServer}/${config.repository}`;
}

async function refreshConfigToken(config) {
  if (config.refreshRepoToken) {
    config.repoToken = await config.refreshRepoToken();
  }
}

function createGitRunner(cwd) {
  return async function git(args) {
    const { stdout } = await execFileAsync('git', args, { cwd });
    return stdout;
  };
}

async function readQueue(queuePath) {
  try {
    const contents = await readFile(queuePath, 'utf8');
    return contents.split('\n').filter(Boolean);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function writeQueue(queuePath, lines) {
  await mkdir(dirname(queuePath), { recursive: true });
  await writeFile(queuePath, lines.length > 0 ? `${lines.join('\n')}\n` : '');
}

async function removeTicketFromQueue(queuePath, ticketId) {
  const lines = await readQueue(queuePath);
  const index = lines.indexOf(ticketId);

  if (index === -1) {
    throw new Error(`[${ticketId}] Not in queue! Mutex file:\n${lines.join('\n')}`);
  }

  lines.splice(index, 1);
  await writeQueue(queuePath, lines);

  return index === 0 ? `[${ticketId}] Unlock` : `[${ticketId}] Dequeue`;
}

function createMutex(options = {}) {
  const git = options.git;
  const info = options.info || (() => {});
  const sleepImpl = options.sleep || sleep;
  const queueFile = options.queueFile || DEFAULT_QUEUE_FILE;
  const updateBranchOverride = options.updateBranch;

  async function updateBranch(config) {
    if (updateBranchOverride) {
      await updateBranchOverride(config);
      return;
    }

    const branch = config.branch;
    await git(['switch', '--orphan', `gh-action-mutex/temp-branch-${Date.now()}`]).catch(() => {});
    await git(['branch', '-D', branch]).catch(() => {});
    await refreshConfigToken(config);
    await git(['remote', 'set-url', 'origin', repoUrl(config)]);
    await git(['fetch', 'origin', branch]).catch(() => {});
    await git(['checkout', branch]).catch(async () => {
      await git(['switch', '--orphan', branch]);
    });
  }

  async function pushWithRetry(config) {
    await git(['push', '--set-upstream', 'origin', config.branch]);
  }

  async function commitQueue(config, message) {
    await git(['add', queueFile]);
    await git(['commit', '-m', message]);
    await refreshConfigToken(config);
    await git(['remote', 'set-url', 'origin', repoUrl(config)]).catch(() => {});
    await pushWithRetry(config);
  }

  async function enqueue(config, ticketId) {
    await updateBranch(config);
    const lines = await readQueue(queueFile);
    if (!lines.includes(ticketId)) {
      lines.push(ticketId);
      await writeQueue(queueFile, lines);
      try {
        await commitQueue(config, `[${ticketId}] Enqueue`);
      } catch (error) {
        await sleepImpl(1000);
        await enqueue(config, ticketId);
      }
    }
  }

  async function waitForLock(config, ticketId) {
    await updateBranch(config);
    const lines = await readQueue(queueFile);
    if (lines.length > 0 && lines[0] !== ticketId) {
      info(`[${ticketId}] Waiting for lock - Current lock assigned to [${lines[0]}]`);
      await sleepImpl(5000);
      await waitForLock(config, ticketId);
    }
  }

  async function dequeue(config, ticketId) {
    await updateBranch(config);
    const message = await removeTicketFromQueue(queueFile, ticketId);
    try {
      await commitQueue(config, message);
    } catch (error) {
      await sleepImpl(1000);
      await dequeue(config, ticketId);
    }
  }

  async function lock(config, ticketId) {
    await enqueue(config, ticketId);
    await waitForLock(config, ticketId);
  }

  async function unlock(config, ticketId) {
    await dequeue(config, ticketId);
  }

  return {
    dequeue,
    enqueue,
    lock,
    unlock,
    waitForLock,
  };
}

async function createDefaultMutex(config, options = {}) {
  await mkdir(config.checkoutLocation, { recursive: true });
  const git = createGitRunner(config.checkoutLocation);
  await git(['init']);
  await git(['config', '--local', 'user.name', 'github-bot']);
  await git(['config', '--local', 'user.email', 'github-bot@users.noreply.github.com']);
  await git(['remote', 'remove', 'origin']).catch(() => {});
  await refreshConfigToken(config);
  await git(['remote', 'add', 'origin', repoUrl(config)]);

  return createMutex({ git, info: options.info, queueFile: join(config.checkoutLocation, DEFAULT_QUEUE_FILE) });
}

module.exports = {
  createDefaultMutex,
  createMutex,
  removeTicketFromQueue,
};
