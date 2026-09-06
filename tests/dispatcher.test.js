import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import { createCommandManager } from '../src/commandManager.js';
import { parseConfig } from '../src/config.js';
import { createSilentLogger } from '../src/utils/logger.js';
import { createPermissionService } from '../src/services/permissionService.js';
import { createAntiSpamService } from '../src/services/antiSpamService.js';
import { createMessageListener } from '../src/listeners/messageListener.js';
import { createModerationListener } from '../src/listeners/moderationListener.js';

const config = parseConfig({
  NODE_ENV: 'test',
  OWNER_NUMBERS: '919111111111',
  ADMIN_NUMBERS: '',
});

const COMMANDS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'commands'
);

async function loadRealCommands() {
  const commands = [];
  async function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && entry.name.endsWith('.js') && entry.name !== 'helpers.js') {
        const mod = await import(pathToFileURL(full).href);
        const cmd = mod.default ?? mod;
        if (cmd && typeof cmd.execute === 'function' && typeof cmd.name === 'string') {
          commands.push(cmd);
        }
      }
    }
  }
  await walk(COMMANDS_DIR);
  return commands;
}

function makeStubDb() {
  const groups = new Map();
  return {
    groups,
    logCommand: () => {},
    upsertUser: () => {},
    upsertGroup: (id, name) => groups.set(id, name),
    getSetting: () => null,
    setSetting: () => {},
    incrementSetting: () => {},
    isMuted: () => false,
    logModeration: () => {},
    muteUser: () => true,
    unmuteUser: () => true,
    banUser: () => {},
    countWarnings: () => 0,
    stats: () => ({}),
    isBannedAnywhere: () => [],
  };
}

function makeBrokenChatClient(sent) {
  return {
    info: { wid: { _serialized: '919000000000@c.us' } },
    getChatById: async () => {
      throw new Error('r');
    },
    sendMessage: async (chatId, text) => {
      sent.push({ chatId, text });
      return {};
    },
  };
}

function makeMessage({ from, author = null, body, mentionedIds = [], getChat }) {
  return {
    fromMe: false,
    from,
    author,
    body,
    mentionedIds,
    _data: { pushName: 'Tester' },
    getChat: getChat ?? (async () => {
      throw new Error('r');
    }),
  };
}

async function buildStack() {
  const sent = [];
  const client = makeBrokenChatClient(sent);
  const db = makeStubDb();
  const permission = createPermissionService({
    config,
    getChat: (chatId) => client.getChatById(chatId),
    logger: createSilentLogger(),
  });
  const antiSpam = createAntiSpamService({
    config,
    logger: createSilentLogger(),
    db,
    actions: {
      kick: async () => {},
      onMute: async () => {},
    },
  });
  const moderationListener = createModerationListener({
    db,
    permission,
    logger: createSilentLogger(),
  });
  const commands = await loadRealCommands();
  const manager = createCommandManager({ config, logger: createSilentLogger(), services: null });
  manager.registerAll(commands);
  const services = {
    config,
    logger: createSilentLogger(),
    db,
    permission,
    audio: {},
    music: { handleSongRequest: async () => {} },
    lyrics: { getLyrics: async () => ({ found: false }) },
    ad: { countSentToday: () => 0 },
    tempMute: { muteTemporarily: () => {} },
    antiSpam,
    commandManager: manager,
    commands: manager.list(),
    get client() {
      return client;
    },
  };
  manager.services = services;
  const listener = createMessageListener({
    config,
    logger: createSilentLogger(),
    db,
    commandManager: manager,
    moderationListener,
    antiSpam,
    permission,
  });
  return { listener, client, sent, db, commands };
}

test('!ping works in a DM without chat lookup', async () => {
  const { listener, sent, client } = await buildStack({});
  const result = await listener.handleIncomingMessage(client, makeMessage({
    from: '919111111111@c.us',
    body: '!ping',
  }));
  assert.equal(result.status, 'ok');
  assert.ok(sent.some((m) => /Pong/i.test(m.text)));
});

test('!menu works in a DM without chat lookup', async () => {
  const { listener, sent, client } = await buildStack({});
  const result = await listener.handleIncomingMessage(client, makeMessage({
    from: '919111111111@c.us',
    body: '!menu',
  }));
  assert.equal(result.status, 'ok');
  assert.ok(sent.some((m) => /MENU/i.test(m.text)));
});

test('!help works in a DM without chat lookup', async () => {
  const { listener, sent, client } = await buildStack({});
  const result = await listener.handleIncomingMessage(client, makeMessage({
    from: '919111111111@c.us',
    body: '!help',
  }));
  assert.equal(result.status, 'ok');
  assert.ok(sent.some((m) => /song/i.test(m.text)));
});

test('a failed getChat does not crash the listener and group commands still process', async () => {
  const { listener, sent, client } = await buildStack({});
  const result = await listener.handleIncomingMessage(client, makeMessage({
    from: '123@g.us',
    author: '919333333333@c.us',
    body: '!ping',
  }));
  assert.equal(result.status, 'ok');
  assert.ok(sent.some((m) => /Pong/i.test(m.text)));
});

test('group-only commands reject DMs', async () => {
  const { listener, sent, client } = await buildStack({});
  const result = await listener.handleIncomingMessage(client, makeMessage({
    from: '919111111111@c.us',
    body: '!mute @919333333333@c.us',
  }));
  assert.equal(result.status, 'denied');
  assert.ok(sent.some((m) => /only works inside groups/i.test(m.text)));
});

test('owner-only commands reject non-owner users in DMs', async () => {
  const { listener, sent, client } = await buildStack({});
  const result = await listener.handleIncomingMessage(client, makeMessage({
    from: '919555555555@c.us',
    body: '!stats',
  }));
  assert.equal(result.status, 'denied');
  assert.ok(sent.some((m) => /Owner-only/i.test(m.text)));
});

test('owner-only commands are denied for non-owners even in groups', async () => {
  const { listener, sent, client } = await buildStack({});
  const result = await listener.handleIncomingMessage(client, makeMessage({
    from: '123@g.us',
    author: '919333333333@c.us',
    body: '!kick @919444444444@c.us',
  }));
  assert.equal(result.status, 'denied');
  assert.ok(sent.some((m) => /Owner-only/i.test(m.text)));
});

test('owner commands fail gracefully when group metadata is unavailable', async () => {
  const { listener, sent, client } = await buildStack({});
  const result = await listener.handleIncomingMessage(client, makeMessage({
    from: '123@g.us',
    author: '919111111111@c.us',
    body: '!kick @919444444444@c.us',
    mentionedIds: ['919444444444@c.us'],
  }));
  assert.equal(result.status, 'ok');
  assert.ok(sent.some((m) => /⛔/i.test(m.text)));
  assert.ok(sent.some((m) => /(temporarily unavailable|needs administrator)/i.test(m.text)));
});

test('group messages still update the group registry per message source', async () => {
  const { listener, client, db } = await buildStack({});
  await listener.handleIncomingMessage(client, makeMessage({
    from: '999@g.us',
    author: '919777777777@c.us',
    body: '!ping',
  }));
  assert.ok(db.groups.has('999@g.us'));
});