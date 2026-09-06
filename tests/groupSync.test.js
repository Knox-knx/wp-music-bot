import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGroupSync } from '../src/utils/groupSync.js';
import { createSilentLogger } from '../src/utils/logger.js';

function makeEnv({ chatResults, swapOnFailure = false }) {
  const upserted = [];
  const sleeps = [];
  let calls = 0;
  let client = {
    getChats: async () => {
      calls += 1;
      const result = chatResults[calls - 1];
      if (result === 'ok') {
        return [
          { isGroup: true, id: { _serialized: '1@g.us' }, name: 'One' },
          { isGroup: false, id: { _serialized: '2@c.us' }, name: 'Two' },
        ];
      }
      if (swapOnFailure && calls === 2) {
        client = { getChats: async () => [] };
      }
      throw new Error('r');
    },
  };
  const db = {
    upsertGroup: (id, name) => upserted.push([id, name]),
  };
  const sync = createGroupSync({
    getClient: () => client,
    db,
    logger: createSilentLogger(),
    sleep: async (ms) => sleeps.push(ms),
    maxAttempts: 5,
    retryBaseMs: 1000,
  });
  return { sync, upserted, sleeps, countCalls: () => calls };
}

test('a getChats failure does not throw and does not prevent completion', async () => {
  const { sync } = makeEnv({ chatResults: ['fail', 'fail', 'fail', 'fail', 'fail'] });
  const result = await sync.run();
  assert.equal(result.ok, false);
  assert.ok(result.error);
  assert.equal(result.attempts, 5);
});

test('group sync retries after failure and succeeds later', async () => {
  const { sync, upserted, sleeps, countCalls } = makeEnv({
    chatResults: ['fail', 'fail', 'ok'],
  });
  const result = await sync.run();
  assert.equal(result.ok, true);
  assert.equal(result.activeGroups, 1);
  assert.equal(result.attempts, 3);
  assert.deepEqual(upserted, [['1@g.us', 'One']]);
  assert.deepEqual(sleeps, [1000, 2000]);
  assert.equal(countCalls(), 3);
});

test('group sync stops if the client reference changes mid-retry', async () => {
  const upserted = [];
  let calls = 0;
  let client = {
    getChats: async () => {
      calls += 1;
      if (calls === 1) throw new Error('r');
      client = { getChats: async () => [] };
      return [
        { isGroup: true, id: { _serialized: '1@g.us' }, name: 'One' },
      ];
    },
  };
  const sync = createGroupSync({
    getClient: () => client,
    db: { upsertGroup: (id, name) => upserted.push([id, name]) },
    logger: createSilentLogger(),
    sleep: async () => {},
    maxAttempts: 5,
    retryBaseMs: 1000,
  });
  const result = await sync.run();
  assert.equal(result.ok, false);
  assert.deepEqual(upserted, []);
  assert.equal(calls, 2);
});

test('group sync stops early when shouldContinue returns false', async () => {
  const { countCalls } = makeEnv({ chatResults: ['fail', 'fail', 'fail', 'fail', 'fail'] });
  await createGroupSync({
    getClient: () => ({ getChats: async () => [] }),
    db: { upsertGroup: () => {} },
    logger: createSilentLogger(),
    shouldContinue: () => false,
  }).run();
  assert.equal(countCalls(), 0);
});