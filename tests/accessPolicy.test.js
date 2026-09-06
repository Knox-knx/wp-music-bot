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

const OWNER = '919111111111';
const USER_A = '919555555555';
const USER_B = '919666666666';
const TARGET = '919444444444@c.us';
const GROUP = '123@g.us';

const config = parseConfig({
  NODE_ENV: 'test',
  OWNER_NUMBERS: OWNER,
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
    banUser: () => true,
    unbanUser: () => true,
    countWarnings: () => 0,
    stats: () => ({}),
    isBannedAnywhere: () => [],
    isGroupAdEnabled: () => true,
    setGroupAdEnabled: () => {},
    getKnownGroups: () => [],
    getAdConfig: () => ({}),
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

function makeWorkingChatClient(sent) {
  return {
    info: { wid: { _serialized: '919000000000@c.us' } },
    getChatById: async (chatId) => ({
      id: { _serialized: chatId },
      isGroup: true,
      name: 'Test Group',
      participants: [
        { id: { _serialized: '919000000000@c.us' }, isAdmin: true },
        { id: { _serialized: `${OWNER}@c.us` }, isAdmin: true },
        { id: { _serialized: `${USER_A}@c.us` }, isAdmin: false },
      ],
      removeParticipants: async () => {},
    }),
    sendMessage: async (chatId, text) => {
      sent.push({ chatId, text });
      return {};
    },
  };
}

function makeMessage({ from, author = null, body, mentionedIds = [] }) {
  return {
    fromMe: false,
    from,
    author,
    body,
    mentionedIds,
    _data: { pushName: 'Tester' },
    getChat: async () => {
      throw new Error('r');
    },
  };
}

async function buildStack({ workingChat = false } = {}) {
  const sent = [];
  const musicCalls = [];
  const voiceCallCalls = [];
  const adSaveCalls = [];
  const client = workingChat ? makeWorkingChatClient(sent) : makeBrokenChatClient(sent);
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
    music: {
      handleSongRequest: async ({ chatId, query, notify }) => {
        musicCalls.push({ chatId, query });
        if (notify) await notify('🎵 Mock audio sent');
      },
    },
    lyrics: { getLyrics: async () => ({ found: false }) },
    ad: {
      saveAd: async (ad) => adSaveCalls.push(ad),
      countSentToday: () => 0,
      getAdConfig: () => ({ enabled: true, timesPerDay: 2, message: '' }),
      ensureDailySchedule: () => [],
      getActiveGroups: () => [],
      setEnabled: () => {},
      setInterval: () => {},
    },
    tempMute: { muteTemporarily: () => {} },
    voiceCall: {
      startPlayback: async ({ chatId, query, notify }) => {
        voiceCallCalls.push({ chatId, query });
        if (notify) await notify('🎵 Starting live playback');
        return { status: 'streaming' };
      },
      stop: async () => {},
      pause: async () => {},
      resume: async () => {},
      nowPlaying: () => {},
    },
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
  return { listener, client, sent, db, musicCalls, voiceCallCalls, adSaveCalls, commands };
}

function groupMessage(body, author = `${USER_A}@c.us`, mentionedIds = []) {
  return makeMessage({ from: GROUP, author, body, mentionedIds });
}

function banOrKickMessage(body, author = `${USER_A}@c.us`) {
  return groupMessage(body, author, [TARGET]);
}

test('1. normal user can run !ping', async () => {
  const { listener, sent, client } = await buildStack();
  const result = await listener.handleIncomingMessage(client, makeMessage({
    from: `${USER_A}@c.us`,
    body: '!ping',
  }));
  assert.equal(result.status, 'ok');
  assert.ok(sent.some((m) => /Pong/i.test(m.text)));
});

test('2. normal user can run !menu', async () => {
  const { listener, sent, client } = await buildStack();
  const result = await listener.handleIncomingMessage(client, makeMessage({
    from: `${USER_A}@c.us`,
    body: '!menu',
  }));
  assert.equal(result.status, 'ok');
  assert.ok(sent.some((m) => /MENU/i.test(m.text)));
});

test('3. normal user can run !help', async () => {
  const { listener, sent, client } = await buildStack();
  const result = await listener.handleIncomingMessage(client, makeMessage({
    from: `${USER_A}@c.us`,
    body: '!help',
  }));
  assert.equal(result.status, 'ok');
  assert.ok(sent.some((m) => /song/i.test(m.text)));
});

test('4. normal user can run !song', async () => {
  const { listener, sent, client, musicCalls } = await buildStack();
  const result = await listener.handleIncomingMessage(client, makeMessage({
    from: `${USER_A}@c.us`,
    body: '!song glory',
  }));
  assert.equal(result.status, 'ok');
  assert.equal(musicCalls.length, 1);
  assert.equal(musicCalls[0].query, 'glory');
  assert.ok(sent.some((m) => /Mock audio sent/i.test(m.text)));
});

test('5. normal user can run !find (alias of song)', async () => {
  const { listener, client, musicCalls } = await buildStack();
  const result = await listener.handleIncomingMessage(client, makeMessage({
    from: `${USER_A}@c.us`,
    body: '!find glory',
  }));
  assert.equal(result.status, 'ok');
  assert.equal(musicCalls.length, 1);
  assert.equal(musicCalls[0].query, 'glory');
});

test('6. normal user can run !play in a group', async () => {
  const { listener, client, voiceCallCalls, sent } = await buildStack();
  const result = await listener.handleIncomingMessage(client, groupMessage('!play glory'));
  assert.equal(result.status, 'ok');
  assert.equal(voiceCallCalls.length, 1);
  assert.equal(voiceCallCalls[0].query, 'glory');
  assert.equal(voiceCallCalls[0].chatId, GROUP);
  assert.ok(sent.some((m) => /Starting live playback/i.test(m.text)));
});

test('6b. !play in a DM is rejected with the groups-only message', async () => {
  const { listener, client, voiceCallCalls, sent } = await buildStack();
  const result = await listener.handleIncomingMessage(client, makeMessage({
    from: `${USER_A}@c.us`,
    body: '!play glory',
  }));
  assert.equal(result.status, 'ok');
  assert.equal(voiceCallCalls.length, 0);
  assert.ok(sent.some((m) => /Live playback is only available in WhatsApp groups/i.test(m.text)));
});

test('7. normal user can run !lyrics', async () => {
  const { listener, sent, client } = await buildStack();
  const result = await listener.handleIncomingMessage(client, makeMessage({
    from: `${USER_A}@c.us`,
    body: '!lyrics glory',
  }));
  assert.equal(result.status, 'ok');
  assert.ok(sent.some((m) => /No lyrics found/i.test(m.text)));
});

test('8. normal user cannot run !ban', async () => {
  const { listener, sent, client } = await buildStack();
  const result = await listener.handleIncomingMessage(client, banOrKickMessage(
    `!ban @${TARGET}`,
    `${USER_A}@c.us`
  ));
  assert.equal(result.status, 'denied');
  assert.ok(sent.some((m) => /Owner-only/i.test(m.text)));
});

test('9. normal user cannot run !kick', async () => {
  const { listener, sent, client } = await buildStack();
  const result = await listener.handleIncomingMessage(client, banOrKickMessage(
    `!kick @${TARGET}`,
    `${USER_A}@c.us`
  ));
  assert.equal(result.status, 'denied');
  assert.ok(sent.some((m) => /Owner-only/i.test(m.text)));
});

test('10. normal user cannot run !mute', async () => {
  const { listener, sent, client } = await buildStack();
  const result = await listener.handleIncomingMessage(client, banOrKickMessage(
    `!mute @${TARGET}`,
    `${USER_A}@c.us`
  ));
  assert.equal(result.status, 'denied');
  assert.ok(sent.some((m) => /Owner-only/i.test(m.text)));
});

test('11. normal user cannot run !setad', async () => {
  const { listener, sent, client } = await buildStack();
  const result = await listener.handleIncomingMessage(client, makeMessage({
    from: `${USER_A}@c.us`,
    body: '!setad spam',
  }));
  assert.equal(result.status, 'denied');
  assert.ok(sent.some((m) => /Owner-only/i.test(m.text)));
});

test('12. owner can run !ban', async () => {
  const { listener, sent, client } = await buildStack({ workingChat: true });
  const result = await listener.handleIncomingMessage(client, banOrKickMessage(
    `!ban @${TARGET}`,
    `${OWNER}@c.us`
  ));
  assert.equal(result.status, 'ok');
  assert.ok(sent.some((m) => /banned and removed/i.test(m.text)));
});

test('13. owner can run !kick', async () => {
  const { listener, sent, client } = await buildStack({ workingChat: true });
  const result = await listener.handleIncomingMessage(client, banOrKickMessage(
    `!kick @${TARGET}`,
    `${OWNER}@c.us`
  ));
  assert.equal(result.status, 'ok');
  assert.ok(sent.some((m) => /User removed/i.test(m.text)));
});

test('14. owner can run !mute', async () => {
  const { listener, sent, client } = await buildStack({ workingChat: true });
  const result = await listener.handleIncomingMessage(client, banOrKickMessage(
    `!mute @${TARGET}`,
    `${OWNER}@c.us`
  ));
  assert.equal(result.status, 'ok');
  assert.ok(sent.some((m) => /muted/i.test(m.text)));
});

test('15. owner can run !setad', async () => {
  const { listener, client, adSaveCalls } = await buildStack();
  const result = await listener.handleIncomingMessage(client, makeMessage({
    from: `${OWNER}@c.us`,
    body: '!setad test advertisement',
  }));
  assert.equal(result.status, 'ok');
  assert.equal(adSaveCalls.length, 1);
  assert.equal(adSaveCalls[0].message, 'test advertisement');
});

test('16. public commands work when getChat() throws the known "r" error', async () => {
  const { listener, sent, client, musicCalls } = await buildStack();
  const result = await listener.handleIncomingMessage(client, groupMessage(
    '!song glory',
    `${USER_B}@c.us`
  ));
  assert.equal(result.status, 'ok');
  assert.equal(musicCalls.length, 1);
  assert.equal(musicCalls[0].query, 'glory');
  assert.ok(sent.some((m) => /Mock audio sent/i.test(m.text)));
});

test('17. multi-word music queries are passed through whole', async () => {
  const { listener, client, musicCalls } = await buildStack();
  const result = await listener.handleIncomingMessage(client, makeMessage({
    from: `${USER_A}@c.us`,
    body: '!song Alan Walker Faded',
  }));
  assert.equal(result.status, 'ok');
  assert.equal(musicCalls[0].query, 'Alan Walker Faded');
});

test('18. command aliases work (!find resolves to the song handler)', async () => {
  const { listener, client, musicCalls } = await buildStack();
  const result = await listener.handleIncomingMessage(client, makeMessage({
    from: `${USER_A}@c.us`,
    body: '!find Imagine Dragons Believer',
  }));
  assert.equal(result.status, 'ok');
  assert.equal(musicCalls[0].query, 'Imagine Dragons Believer');
});

test('19. command matching remains case-insensitive', async () => {
  const { listener, client, musicCalls } = await buildStack();
  const result = await listener.handleIncomingMessage(client, makeMessage({
    from: `${USER_A}@c.us`,
    body: '!SONG Glory',
  }));
  assert.equal(result.status, 'ok');
  assert.equal(musicCalls[0].query, 'Glory');
});

test('20. unauthorized owner commands return a visible error, not silence', async () => {
  const { listener, sent, client } = await buildStack();
  const result = await listener.handleIncomingMessage(client, makeMessage({
    from: `${USER_B}@c.us`,
    body: '!stats',
  }));
  assert.equal(result.status, 'denied');
  assert.ok(sent.some((m) => /Owner-only/i.test(m.text)));
});

test('owner identity is normalized (@c.us suffix vs bare number)', async () => {
  const { listener, sent, client } = await buildStack({ workingChat: true });
  const result = await listener.handleIncomingMessage(client, banOrKickMessage(
    `!kick @${TARGET}`,
    OWNER
  ));
  assert.equal(result.status, 'ok');
  assert.ok(sent.some((m) => /User removed/i.test(m.text)));
});

test('owner-only commands fail gracefully when group metadata is unavailable', async () => {
  const { listener, sent, client } = await buildStack();
  const result = await listener.handleIncomingMessage(client, banOrKickMessage(
    `!ban @${TARGET}`,
    `${OWNER}@c.us`
  ));
  assert.equal(result.status, 'ok');
  assert.ok(sent.some((m) => /⛔/i.test(m.text)));
  assert.ok(sent.some((m) => /(temporarily unavailable|needs administrator)/i.test(m.text)));
});
