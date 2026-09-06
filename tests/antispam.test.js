import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAntiSpamService } from '../src/services/antiSpamService.js';
import { createDbService } from '../src/services/dbService.js';
import { parseConfig } from '../src/config.js';
import { createSilentLogger } from '../src/utils/logger.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function makeService({ action = 'delete', maxMessages = 6, windowSeconds = 10, enabled = true } = {}) {
  const config = parseConfig({
    NODE_ENV: 'test',
    OWNER_NUMBERS: '919111111111',
    ANTISPAM_ACTION: action,
    ANTISPAM_MAX_MESSAGES: String(maxMessages),
    ANTISPAM_WINDOW_SECONDS: String(windowSeconds),
    ANTISPAM_ENABLED: enabled ? 'true' : 'false',
  });
  const db = createDbService({
    dbPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bot-antispam-')), 'db.sqlite'),
    logger: createSilentLogger(),
  });
  let clock = 1000;
  const deleted = [];
  const muted = [];
  const kicked = [];
  const svc = createAntiSpamService({
    config,
    logger: createSilentLogger(),
    db,
    now: () => clock,
    actions: {
      kick: async (chatId, userId) => kicked.push([chatId, userId]),
      onMute: async (chatId, userId) => muted.push([chatId, userId]),
    },
  });
  return {
    svc,
    db,
    advance: (ms) => {
      clock += ms;
    },
    deleted,
    muted,
    kicked,
    stop: () => {
      svc.stopCleanup();
      db.close();
    },
  };
}

test('under threshold is not spam', async () => {
  const env = makeService();
  for (let i = 0; i < 5; i += 1) {
    const r = await env.svc.check({
      chatId: 'g1',
      userId: 'u1',
      message: { delete: async () => {} },
      isBotAdmin: true,
    });
    assert.equal(r.detected, false);
  }
  env.stop();
});

test('threshold exceeded triggers delete action', async () => {
  const env = makeService({ action: 'delete', maxMessages: 3 });
  const message = { delete: async () => env.deleted.push(1) };
  for (let i = 0; i < 3; i += 1) {
    await env.svc.check({ chatId: 'g1', userId: 'u1', message, isBotAdmin: true });
  }
  const result = await env.svc.check({ chatId: 'g1', userId: 'u1', message, isBotAdmin: true });
  assert.equal(result.detected, true);
  assert.equal(result.action, 'delete');
  assert.equal(result.consumed, true);
  assert.equal(env.deleted.length, 1);
  env.stop();
});

test('mute action triggers a temporary mute', async () => {
  const env = makeService({ action: 'mute', maxMessages: 2 });
  for (let i = 0; i < 3; i += 1) {
    await env.svc.check({
      chatId: 'g1',
      userId: 'u2',
      message: { delete: async () => {} },
      isBotAdmin: false,
    });
  }
  assert.equal(env.muted.length, 1);
  env.stop();
});

test('kick action kicks the user', async () => {
  const env = makeService({ action: 'kick', maxMessages: 2 });
  for (let i = 0; i < 3; i += 1) {
    await env.svc.check({
      chatId: 'g1',
      userId: 'u3',
      message: { delete: async () => {} },
      isBotAdmin: false,
    });
  }
  assert.equal(env.kicked.length, 1);
  env.stop();
});

test('cooldown prevents repeated actions within the window', async () => {
  const env = makeService({ action: 'warn', maxMessages: 2, windowSeconds: 10 });
  let notifications = 0;
  for (let i = 0; i < 12; i += 1) {
    const r = await env.svc.check({
      chatId: 'g1',
      userId: 'u4',
      message: { delete: async () => {} },
      isBotAdmin: false,
    });
    if (r.notify) notifications += 1;
  }
  assert.equal(notifications, 1);
});

test('cooldown expires after the window passes', async () => {
  const env = makeService({ action: 'warn', maxMessages: 2, windowSeconds: 10 });
  let notifications = 0;
  for (let i = 0; i < 3; i += 1) {
    const r = await env.svc.check({
      chatId: 'g1',
      userId: 'u7',
      message: { delete: async () => {} },
      isBotAdmin: false,
    });
    if (r.notify) notifications += 1;
  }
  assert.equal(notifications, 1);
  env.advance(20_000);
  for (let i = 0; i < 3; i += 1) {
    const r = await env.svc.check({
      chatId: 'g1',
      userId: 'u7',
      message: { delete: async () => {} },
      isBotAdmin: false,
    });
    if (r.notify) notifications += 1;
  }
  assert.equal(notifications, 2);
  env.stop();
});

test('disabled globally does not track', async () => {
  const env = makeService({ enabled: false, maxMessages: 1 });
  for (let i = 0; i < 10; i += 1) {
    const r = await env.svc.check({
      chatId: 'g1',
      userId: 'u5',
      message: { delete: async () => {} },
      isBotAdmin: true,
    });
    assert.equal(r.detected, false);
  }
  env.stop();
});

test('old entries are pruned after the window', async () => {
  const env = makeService({ maxMessages: 3, windowSeconds: 5 });
  for (let i = 0; i < 3; i += 1) {
    await env.svc.check({ chatId: 'g1', userId: 'u6', message: {}, isBotAdmin: false });
  }
  env.advance(20_000);
  const r = await env.svc.check({ chatId: 'g1', userId: 'u6', message: {}, isBotAdmin: false });
  assert.equal(r.detected, false);
  env.stop();
});