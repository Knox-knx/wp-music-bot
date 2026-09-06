// codes by: @LouisPy
import 'dotenv/config';
import qrcode from 'qrcode-terminal';
import { loadConfig } from './config.js';
import { createLogger } from './utils/logger.js';
import { acquireInstanceLock, releaseInstanceLock } from './utils/instanceLock.js';
import { ensureDirectories, cleanupTmp, purgeStaleCache } from './utils/cleanup.js';
import { createDbService } from './services/dbService.js';
import { createClient } from './client.js';
import { createPermissionService } from './services/permissionService.js';
import { createAudioService } from './services/audioService.js';
import { createMusicService } from './services/musicService.js';
import { createLyricsService } from './services/lyricsService.js';
import { createAntiSpamService } from './services/antiSpamService.js';
import { createAdService } from './services/adService.js';
import { createAdScheduler } from './scheduler/adScheduler.js';
import { createMessageListener } from './listeners/messageListener.js';
import { createModerationListener } from './listeners/moderationListener.js';
import { createParticipantListener } from './listeners/participantListener.js';
import { createHealthServer } from './health/server.js';
import { createCommandManager, loadCommandsFromDir } from './commandManager.js';
import { createTemporaryMute } from './utils/tempMute.js';
import { createGroupSync } from './utils/groupSync.js';
import { createVoiceCallService } from './services/voiceCallService.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
config.startTime = Date.now();

const lock = acquireInstanceLock(config.lockFile);
if (!lock.acquired) {
  console.error(
    `[whatsapp-bot] Another bot instance is already using this session (pid ${lock.pid}). Exiting safely.`
  );
  process.exit(1);
}

const logger = createLogger({
  level: config.logLevel,
  logDir: config.logDir,
  pretty: config.logPretty,
});
logger.info({ pid: lock.pid }, 'Instance lock acquired');

ensureDirectories(config);
purgeStaleCache(config.cacheDir, config.cache.ttlSeconds);
cleanupTmp(config);

const db = createDbService({ dbPath: config.dbPath, logger });

let client = null;
const permission = createPermissionService({
  config,
  getChat: (chatId) => (client ? client.getChatById(chatId) : Promise.reject(new Error('client not ready'))),
  resolveWidNumber: (_serializedId) => Promise.resolve(null),
  logger,
});
const audio = createAudioService({ config, logger });
const music = createMusicService({ config, logger, audioService: audio, db });
const lyrics = createLyricsService({ config, logger });
const ad = createAdService({ config, logger, db });

// No browser VoIP bridge is bundled with this build, so live voice-call
// streaming is unavailable. Wire the voice-call service with a bridge stub
// that reports unavailable: !play then falls back to sending the searched
// song as an audio message instead of crashing on `undefined.startPlayback`.
const unavailableCallBridge = {
  async prepareAudioGraph() {
    throw new Error('voice-bridge-unavailable');
  },
  async startGroupCall() {
    return { ok: false, error: 'voice-bridge-unavailable' };
  },
  async getCallState() {
    return { isInConnectedCall: false, state: 'DISCONNECTED' };
  },
  async getDiagnostics() {
    return null;
  },
  async startStreaming() {
    throw new Error('voice-bridge-unavailable');
  },
  async endCall() {
    return { ok: false };
  },
  async dispose() {},
};
const voiceCall = createVoiceCallService({
  config,
  logger,
  audioService: audio,
  music,
  client: null,
  getClient: () => client,
  callBridge: unavailableCallBridge,
});

const commandsDir = new URL('./commands/', import.meta.url).pathname;
const allCommands = await loadCommandsFromDir(commandsDir, logger);

const commandManager = createCommandManager({ config, logger, services: null });
commandManager.registerAll(allCommands);

const services = {
  config,
  logger,
  db,
  permission,
  audio,
  music,
  lyrics,
  ad,
  // Alias kept for commands that address the ad service by its full name.
  get adService() {
    return this.ad;
  },
  voiceCall: null,
  commandManager: null,
  commands: [],
  antiSpam: null,
  adScheduler: null,
  get client() {
    return client;
  },
};

services.commandManager = commandManager;
services.commands = commandManager.list();
services.voiceCall = voiceCall;
commandManager.services = services;

const moderationListener = createModerationListener({ db, permission, logger });
const participantListener = createParticipantListener({ db, logger });

const tempMute = createTemporaryMute({
  db,
  logger,
  defaultSeconds: config.antispam.muteSeconds,
});

const antiSpam = createAntiSpamService({
  config,
  logger,
  db,
  permission,
  actions: {
    kick: async (chatId, userId) => {
      const chat = await client.getChatById(chatId);
      await chat.removeParticipants([userId]);
    },
    onMute: (chatId, userId, seconds) => {
      tempMute.muteTemporarily(chatId, userId, seconds, 'antispam');
    },
  },
});
services.antiSpam = antiSpam;
services.tempMute = tempMute;

const messageListener = createMessageListener({
  config,
  logger,
  db,
  commandManager,
  moderationListener,
  antiSpam,
  permission,
});

const adScheduler = createAdScheduler({
  config,
  logger,
  adService: ad,
  sendAdToGroup: (chatId, text) => client.sendMessage(chatId, text),
  isGroupAvailable: async (chatId) => {
    try {
      await client.getChatById(chatId);
      return true;
    } catch (err) {
      logger.warn({ err, chatId }, 'ad: group lookup failed');
      return false;
    }
  },
});
services.adScheduler = adScheduler;

const health = createHealthServer({
  config,
  logger,
  getStatus: () => (readyState ? 'ready' : 'connecting'),
});

let readyState = false;
let stopRequested = false;
let reconnectAttempts = 0;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function syncGroupsFromClient() {
  const groupSync = createGroupSync({
    getClient: () => client,
    db,
    logger,
    shouldContinue: () => !stopRequested,
    sleep,
    // WhatsApp Web fires 'ready' while its internal Chat collection is
    // still hydrating; wait before the first getChats() to avoid the
    // minified `r` evaluation error (wwebjs#201845).
    initialDelayMs: 10_000,
  });
  await groupSync.run();
}

function wireEvents(bot) {
  bot.on('qr', (qr) => {
    logger.info('Scan this QR code using WhatsApp -> Linked Devices -> Link a Device');
    qrcode.generate(qr, { small: true });
  });

  bot.on('authenticated', () => {
    logger.info('WhatsApp authenticated. Session stored.');
  });

  bot.on('auth_failure', (message) => {
    if (stopRequested) return;
    logger.fatal(
      { message },
      'Authentication failed. Delete .wwebjs_auth to force a new QR login.'
    );
    shutdown(1);
  });

  bot.on('ready', () => {
    readyState = true;
    reconnectAttempts = 0;
    logger.info(`Bot is ready. Session: ${bot.info?.wid?._serialized ?? 'unknown'}`);
    void syncGroupsFromClient();
    void health.start().catch((err) => logger.warn({ err }, 'health server failed to start'));
    adScheduler.start();
  });

  bot.on('disconnected', (reason) => {
    if (stopRequested) return;
    logger.warn({ reason }, 'WhatsApp client disconnected');
    if (reason === 'LOGGED_OUT') {
      logger.fatal('Session logged out. Delete .wwebjs_auth and scan the QR code again.');
      shutdown(1);
      return;
    }
    void handleReconnect();
  });

  bot.on('change_state', (state) => {
    logger.debug({ state }, 'connection state changed');
  });

  bot.on('message', (message) => {
    messageListener.handleIncomingMessage(bot, message).catch((err) => {
      logger.error({ err }, 'message handler failed');
    });
  });

  bot.on('group_join', (notification) => {
    const botWid = bot.info?.wid?._serialized ?? null;
    participantListener.handleGroupJoin(bot, notification, botWid).catch((err) => {
      logger.error({ err }, 'group_join handler failed');
    });
  });

  bot.on('group_leave', (notification) => {
    const botWid = bot.info?.wid?._serialized ?? null;
    participantListener.handleGroupLeave(notification, botWid).catch((err) => {
      logger.error({ err }, 'group_leave handler failed');
    });
  });

  bot.on('group_update', (notification) => {
    participantListener.handleGroupUpdate(bot, notification).catch((err) => {
      logger.error({ err }, 'group_update handler failed');
    });
  });
}

async function destroyCurrentClient() {
  if (!client) return;
  const toDestroy = client;
  client = null;
  try {
    await toDestroy.destroy();
  } catch (err) {
    logger.warn({ err }, 'error destroying WhatsApp client');
  }
}

async function scheduleReconnect() {
  if (stopRequested) return;
  if (reconnectAttempts >= config.maxReconnectAttempts) {
    logger.fatal('Maximum reconnect attempts reached. Exiting.');
    shutdown(1);
    return;
  }
  reconnectAttempts += 1;
  const backoff =
    Math.min(1000 * 2 ** reconnectAttempts, 300_000) + Math.floor(Math.random() * 1000);
  logger.warn(
    { attempt: reconnectAttempts, backoffMs: backoff },
    'scheduling reconnection'
  );
  await sleep(backoff);
  if (stopRequested || client) return;
  await startClientFlow();
}

async function handleReconnect() {
  if (stopRequested) return;
  await destroyCurrentClient();
  await scheduleReconnect();
}

async function startClientFlow() {
  try {
    if (stopRequested || client) return;
    client = createClient({ config });
    wireEvents(client);
    logger.info('Starting WhatsApp client...');
    await client.initialize();
  } catch (err) {
    logger.error({ err }, 'client initialization failed');
    await destroyCurrentClient();
    if (!stopRequested) {
      void scheduleReconnect();
    }
  }
}

async function shutdown(exitCode = 0) {
  if (stopRequested) return;
  stopRequested = true;
  logger.info('Shutting down...');

  const forceTimer = setTimeout(() => {
    logger.warn('Forced exit after shutdown timeout');
    process.exit(1);
  }, 15_000);
  forceTimer.unref();

  try {
    adScheduler.stop();
    antiSpam.stopCleanup();
    tempMute.stop();
    music.stopCleanup();
    try {
      await voiceCall.shutdown();
    } catch (err) {
      logger.warn({ err }, 'voice call service shutdown failed');
    }
    await health.stop();
    await destroyCurrentClient();
    cleanupTmp(config);
    db.close();
    releaseInstanceLock(config.lockFile, logger);
    logger.flush();
    await sleep(200);
    logger.info('Shutdown complete.');
    process.exit(exitCode);
  } catch (err) {
    logger.error({ err }, 'error during shutdown');
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandled promise rejection');
});

void startClientFlow();

export { shutdown, logger, services };