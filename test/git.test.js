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
    updateBranch: async () => {},
  });

  await mutex.enqueue({ branch: 'locks', queueFile: 'mutex_queue' }, 'ticket-a');

  assert.equal(calls.filter((call) => call.startsWith('push ')).length, 2);
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
