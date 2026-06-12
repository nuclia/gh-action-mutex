const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');

const { removeTicketFromQueue, createMutex } = require('../src/git');

test('removes first ticket as unlock', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mutex-test-'));
  const queue = join(dir, 'mutex_queue');
  await writeFile(queue, 'ticket-a\nticket-b\n');

  const message = await removeTicketFromQueue(queue, 'ticket-a');

  assert.equal(message, '[ticket-a] Unlock');
  assert.equal(await readFile(queue, 'utf8'), 'ticket-b\n');
  await rm(dir, { recursive: true, force: true });
});

test('removes queued ticket that does not hold lock', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mutex-test-'));
  const queue = join(dir, 'mutex_queue');
  await writeFile(queue, 'ticket-a\nticket-b\n');

  const message = await removeTicketFromQueue(queue, 'ticket-b');

  assert.equal(message, '[ticket-b] Dequeue');
  assert.equal(await readFile(queue, 'utf8'), 'ticket-a\n');
  await rm(dir, { recursive: true, force: true });
});

test('retries enqueue when pushing fails once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mutex-test-'));
  const queueFile = join(dir, 'mutex_queue');
  const calls = [];
  const mutex = createMutex({
    queueFile,
    sleep: async () => {},
    git: async (args) => {
      calls.push(args.join(' '));
      if (args[0] === 'push' && calls.filter((call) => call.startsWith('push ')).length === 1) {
        throw new Error('rejected');
      }
      return '';
    },
    updateBranch: async () => {
      await writeFile(queueFile, '');
    },
  });

  await mutex.enqueue({ branch: 'locks', queueFile: 'mutex_queue' }, 'ticket-a');

  assert.equal(calls.filter((call) => call.startsWith('push ')).length, 2);
  await rm(dir, { recursive: true, force: true });
});

test('refetches and rebuilds enqueue after push race rejection', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mutex-test-'));
  const queueFile = join(dir, 'mutex_queue');
  let updateCount = 0;
  let pushCount = 0;
  const mutex = createMutex({
    queueFile,
    sleep: async () => {},
    git: async (args) => {
      if (args[0] === 'push') {
        pushCount += 1;
        if (pushCount === 1) {
          throw new Error('fetch first');
        }
      }
      return '';
    },
    updateBranch: async () => {
      updateCount += 1;
      if (updateCount === 1) {
        await writeFile(queueFile, 'ticket-a\n');
      } else {
        await writeFile(queueFile, 'ticket-a\nticket-b\n');
      }
    },
  });

  await mutex.enqueue({ branch: 'locks' }, 'ticket-client-2');

  assert.equal(updateCount, 2);
  assert.equal(pushCount, 2);
  assert.equal(await readFile(queueFile, 'utf8'), 'ticket-a\nticket-b\nticket-client-2\n');
  await rm(dir, { recursive: true, force: true });
});

test('refreshes GitHub App token before remote network operations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mutex-test-'));
  const queueFile = join(dir, 'mutex_queue');
  const urls = [];
  const mutex = createMutex({
    queueFile,
    sleep: async () => {},
    git: async (args) => {
      if (args[0] === 'remote' && args[1] === 'set-url') {
        urls.push(args[3]);
      }
      return '';
    },
    updateBranch: undefined,
  });
  const config = {
    branch: 'locks',
    githubServer: 'github.com',
    queueFile: 'mutex_queue',
    repoToken: 'initial-token',
    repository: 'owner/repo',
    refreshRepoToken: async () => 'fresh-token',
  };

  await mutex.enqueue(config, 'ticket-refresh');

  assert.ok(urls.some((url) => url.includes('fresh-token')));
  await rm(dir, { recursive: true, force: true });
});

test('logs progress while waiting for another ticket to release the lock', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mutex-test-'));
  const queueFile = join(dir, 'mutex_queue');
  const messages = [];
  let updateCount = 0;
  const mutex = createMutex({
    queueFile,
    sleep: async () => {},
    info: (message) => messages.push(message),
    git: async () => '',
    updateBranch: async () => {
      updateCount += 1;
      if (updateCount === 1) {
        await writeFile(queueFile, 'ticket-a\nticket-b\n');
      } else {
        await writeFile(queueFile, 'ticket-b\n');
      }
    },
  });

  await mutex.waitForLock({ branch: 'locks' }, 'ticket-b');

  assert.deepEqual(messages, ['[ticket-b] Waiting for lock - Current lock assigned to [ticket-a]']);
  await rm(dir, { recursive: true, force: true });
});
