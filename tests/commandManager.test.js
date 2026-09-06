import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCommandManager } from '../src/commandManager.js';
import { parseConfig } from '../src/config.js';
import { createSilentLogger } from '../src/utils/logger.js';

const config = parseConfig({
  NODE_ENV: 'test',
  OWNER_NUMBERS: '919111111111',
});

function makeEnv({ groupAdmin = false, isOwner = false } = {}) {
  const sent = [];
  const db = {
    logCommand: () => {},
  };
  const client = {
    sendMessage: async (chatId, text) => {
      sent.push(text);
      return {};
    },
  };
  const permission = {
    canManage: async () => (groupAdmin ? { ok: true } : { ok: false, reason: 'not allowed' }),
    isOwnerId: () => isOwner,
    isOwnerIdAsync: async () => isOwner,
    isConfiguredAdminId: () => false,
    isGroupAdmin: async () => groupAdmin,
  };
  const executed = [];
  const svc = {
    client,
    db,
    permission,
    commands: [],
    commandManager: null,
  };
  const manager = createCommandManager({ config, logger: createSilentLogger(), services: svc });
  svc.commands = manager.list();
  svc.commandManager = manager;
  manager.register({
    name: 'echo',
    aliases: ['say'],
    description: 'Echo args',
    usage: '!echo <text>',
    category: 'General',
    adminOnly: false,
    groupOnly: false,
    minArgs: 1,
    async execute(ctx) {
      executed.push({ name: 'echo', args: ctx.parsed.args, sender: ctx.senderId, chat: ctx.chatId });
      await ctx.reply(ctx.parsed.args);
    },
  });
  manager.register({
    name: 'secret',
    aliases: [],
    description: 'Admin secret',
    usage: '!secret',
    category: 'Admin',
    adminOnly: true,
    groupOnly: false,
    minArgs: 0,
    async execute(ctx) {
      await ctx.reply('top secret');
    },
  });
  manager.register({
    name: 'groupsonly',
    aliases: [],
    description: 'Group only',
    usage: '!groupsonly',
    category: 'General',
    adminOnly: false,
    groupOnly: true,
    minArgs: 0,
    async execute(ctx) {
      await ctx.reply('in group');
    },
  });

  const makeMessage = (body) => ({
    body,
    from: 'ch1',
    author: '919999999999@c.us',
  });
  const makeChat = (isGroup) => ({ id: { _serialized: 'ch1' }, isGroup });

  return { manager, sent, executed, client, makeMessage, makeChat };
}

test('executes a valid command', async () => {
  const env = makeEnv();
  const result = await env.manager.execute({
    message: env.makeMessage('!echo hello world'),
    chat: env.makeChat(false),
  });
  assert.equal(result.status, 'ok');
  assert.deepEqual(env.executed[0].args, 'hello world');
  assert.equal(env.sent[0], 'hello world');
});

test('command names are case-insensitive', async () => {
  const env = makeEnv();
  const result = await env.manager.execute({
    message: env.makeMessage('!ECHO hi'),
    chat: env.makeChat(false),
  });
  assert.equal(result.status, 'ok');
  assert.equal(env.sent[0], 'hi');
});

test('aliases resolve', async () => {
  const env = makeEnv();
  const result = await env.manager.execute({
    message: env.makeMessage('!say via alias'),
    chat: env.makeChat(false),
  });
  assert.equal(result.status, 'ok');
  assert.equal(env.executed[0].args, 'via alias');
});

test('unknown command replies with a hint', async () => {
  const env = makeEnv();
  const result = await env.manager.execute({
    message: env.makeMessage('!nope'),
    chat: env.makeChat(false),
  });
  assert.equal(result.status, 'unknown');
  assert.match(env.sent[0], /Unknown command/);
});

test('missing arguments replies with usage', async () => {
  const env = makeEnv();
  const result = await env.manager.execute({
    message: env.makeMessage('!echo'),
    chat: env.makeChat(false),
  });
  assert.equal(result.status, 'missing_args');
  assert.match(env.sent[0], /Usage/);
});

test('owner-only command is denied for normal users', async () => {
  const env = makeEnv();
  const result = await env.manager.execute({
    message: env.makeMessage('!secret'),
    chat: env.makeChat(false),
  });
  assert.equal(result.status, 'denied');
  assert.match(env.sent[0], /Owner-only/);
});

test('owner-only command is denied for group admins', async () => {
  const env = makeEnv({ groupAdmin: true });
  const result = await env.manager.execute({
    message: env.makeMessage('!secret'),
    chat: env.makeChat(true),
  });
  assert.equal(result.status, 'denied');
  assert.match(env.sent[0], /Owner-only/);
});

test('owner-only command executes for the configured owner', async () => {
  const env = makeEnv({ isOwner: true });
  const result = await env.manager.execute({
    message: env.makeMessage('!secret'),
    chat: env.makeChat(false),
  });
  assert.equal(result.status, 'ok');
  assert.equal(env.sent[0], 'top secret');
});

test('owner gate runs before group-only gate', async () => {
  const env = makeEnv({ isOwner: false, groupAdmin: true });
  const result = await env.manager.execute({
    message: env.makeMessage('!groupsonly'),
    chat: env.makeChat(false),
  });
  assert.equal(result.status, 'denied');
  assert.match(env.sent[0], /only works inside groups/);
});

test('group-only command is blocked in private chats', async () => {
  const env = makeEnv();
  const result = await env.manager.execute({
    message: env.makeMessage('!groupsonly'),
    chat: env.makeChat(false),
  });
  assert.equal(result.status, 'denied');
  assert.match(env.sent[0], /only works inside groups/);
});

test('group-only command works in groups', async () => {
  const env = makeEnv();
  const result = await env.manager.execute({
    message: env.makeMessage('!groupsonly'),
    chat: env.makeChat(true),
  });
  assert.equal(result.status, 'ok');
});

test('non-command messages are ignored', async () => {
  const env = makeEnv();
  const result = await env.manager.execute({
    message: env.makeMessage('just chatting'),
    chat: env.makeChat(false),
  });
  assert.equal(result.status, 'not_command');
  assert.equal(env.sent.length, 0);
});

test('command errors are caught and reported', async () => {
  const env = makeEnv();
  env.manager.register({
    name: 'boom',
    aliases: [],
    description: 'Crash',
    usage: '!boom',
    category: 'General',
    adminOnly: false,
    groupOnly: false,
    minArgs: 0,
    async execute() {
      throw new Error('kaboom');
    },
  });
  const result = await env.manager.execute({
    message: env.makeMessage('!boom'),
    chat: env.makeChat(false),
  });
  assert.equal(result.status, 'error');
  assert.match(env.sent[0], /error/i);
});