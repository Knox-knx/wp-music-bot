import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMessageContextResolver, isGroupId } from '../src/utils/messageContext.js';
import { createSilentLogger } from '../src/utils/logger.js';

test('isGroupId detects group ids', () => {
  assert.ok(isGroupId('123@g.us'));
  assert.ok(!isGroupId('919111111111@c.us'));
  assert.ok(!isGroupId('status@broadcast'));
  assert.ok(!isGroupId(null));
});

test('basic builds context from message without any chat lookup', () => {
  const resolve = createMessageContextResolver({ logger: createSilentLogger() });
  const ctx = resolve.basic({
    from: '123@g.us',
    author: '919111111111@c.us',
    body: '!ping',
  });
  assert.equal(ctx.chatId, '123@g.us');
  assert.equal(ctx.senderId, '919111111111@c.us');
  assert.equal(ctx.isGroup, true);
  assert.equal(ctx.body, '!ping');
  assert.equal(ctx.chat, null);
});

test('basic falls back to from as sender for direct messages', () => {
  const resolve = createMessageContextResolver({ logger: createSilentLogger() });
  const ctx = resolve.basic({ from: '919111111111@c.us', body: 'hi' });
  assert.equal(ctx.senderId, '919111111111@c.us');
  assert.equal(ctx.isGroup, false);
});

test('getChat returns null when resolution fails (never throws)', async () => {
  const resolve = createMessageContextResolver({ logger: createSilentLogger() });
  const message = {
    from: '123@g.us',
    getChat: async () => {
      throw new Error('r');
    },
  };
  const chat = await resolve.getChat(message);
  assert.equal(chat, null);
});

test('getChat returns chat when resolution succeeds', async () => {
  const resolve = createMessageContextResolver({ logger: createSilentLogger() });
  const fakeChat = { id: { _serialized: '123@g.us' }, isGroup: true, name: 'Test Group' };
  const message = {
    from: '123@g.us',
    getChat: async () => fakeChat,
  };
  const chat = await resolve.getChat(message);
  assert.equal(chat, fakeChat);
});

test('getChat returns null when getChat is not a function', async () => {
  const resolve = createMessageContextResolver({ logger: createSilentLogger() });
  const chat = await resolve.getChat({ from: '123@g.us' });
  assert.equal(chat, null);
});