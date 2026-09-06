import { test, mock, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createLogger, createSilentLogger } from '../../src/utils/logger.js';
import { parseConfig } from '../../src/config.js';

function makeConfig(overrides = {}) {
  return parseConfig({
    NODE_ENV: 'test',
    OWNER_NUMBERS: '919111111111',
    ...overrides,
  });
}

function makeFakeChildProcess() {
  const child = new EventEmitter();
  child.pid = 4242;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = mock.fn((signal) => {
    child._killed = child._killed || [];
    child._killed.push(signal);
    return true;
  });
  return child;
}

const spawned = [];
const killed = [];

function fakeSpawn(cmd, args) {
  const child = makeFakeChildProcess();
  spawned.push({ cmd, args, child });
  killed.length; // keep reference to killed array in scope
  if (args.includes('-version')) {
    setImmediate(() => child.emit('exit', 0));
    return child;
  }
  if (cmd.includes('yt-dlp') || cmd.endsWith('/yt-dlp') || cmd === 'yt-dlp') {
    setImmediate(() => {
      child.stderr.write('')
      child.stdout.write(Buffer.from('webm-audio-chunk'));
    });
  } else {
    // ffmpeg pipeline
    setImmediate(() => child.stderr.write(''));
  }
  return child;
}

mock.module('node:child_process', {
  exports: { spawn: fakeSpawn },
});

function makeFakeServer() {
  const server = new EventEmitter();
  server.listen = mock.fn(() => setImmediate(() => server.emit('listening')));
  server.close = mock.fn((cb) => {
    if (cb) setImmediate(cb);
  });
  return server;
}

mock.module('node:http', {
  exports: {
    createServer: () => makeFakeServer(),
  },
});

const { createVoiceCallService, PLAYBACK_STATES } = await import('../../src/services/voiceCallService.js');

function makeCallBridgeMock() {
  const calls = [];
  return {
    calls,
    isInstalled: () => true,
    ensureInstalled: async () => {
      calls.push('ensureInstalled');
      return { installed: true };
    },
    prepareAudioGraph: async () => {
      calls.push('prepareAudioGraph');
      return { ok: true };
    },
    startStreaming: async () => {
      calls.push('startStreaming');
      return { ok: true };
    },
    startGroupCall: async (chatId) => {
      calls.push('startGroupCall');
      calls.push({ startTarget: chatId });
      return { ok: true };
    },
    getCallState: async () => {
      calls.push('getCallState');
      return { isInConnectedCall: true, state: 'ACTIVE' };
    },
    endCall: async () => {
      calls.push('endCall');
      return { ok: true };
    },
    dispose: async () => {
      calls.push('dispose');
    },
  };
}

function makeDeps({ searchResults = null, bridge, connectTimeoutMs } = {}) {
  const notifications = [];
  const config = makeConfig(
    connectTimeoutMs ? { VOICE_CALL_CONNECT_TIMEOUT_MS: String(connectTimeoutMs) } : {}
  );
  const audioService = {
    search: async () =>
      searchResults || [
        {
          id: 'vid1',
          title: 'Mast Kalander',
          channel: 'A.R. Rahman',
          duration: 264,
          url: 'https://www.youtube.com/watch?v=vid1',
        },
      ],
    pickBest: (results) => results?.[0] ?? null,
  };
  const music = {
    handleSongRequest: mock.fn(async ({ notify }) => {
      notify('✅ Sent!');
    }),
  };
  const callBridge = bridge || makeCallBridgeMock();
  const svc = createVoiceCallService({
    config,
    logger: process.env.DBG ? createLogger({ level: 'debug' }) : createSilentLogger(),
    audioService,
    music,
    client: {},
    callBridge,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
  const notify = (text) => notifications.push(text);
  return { svc, config, audioService, music, callBridge, notifications, notify };
}

after(() => {
  mock.reset();
});

beforeEach(() => {
  spawned.length = 0;
});

test('startPlayback streams a song in a group call', async () => {
  const { svc, callBridge, notifications, notify } = makeDeps();
  const res = await svc.startPlayback({
    chatId: '123456789@g.us',
    query: 'Mast Kalander',
    notify,
  });
  assert.equal(res.status, 'streaming');
  assert.equal(res.song.title, 'Mast Kalander');
  assert.ok(callBridge.calls.includes('prepareAudioGraph'));
  assert.ok(callBridge.calls.includes('startGroupCall'));
  assert.ok(callBridge.calls.includes('startStreaming'));
  assert.ok(notifications.some((n) => n.includes('Starting live playback')));
  const session = svc._getSessionForTest('123456789@g.us');
  assert.equal(session.state, PLAYBACK_STATES.STREAMING);
  assert.equal(session.song.title, 'Mast Kalander');
});

test('startPlayback rejects a duplicate request while a song is streaming', async () => {
  const { svc, notifications, notify } = makeDeps();
  await svc.startPlayback({ chatId: '123456789@g.us', query: 'first song', notify });
  const res = await svc.startPlayback({ chatId: '123456789@g.us', query: 'second song', notify });
  assert.equal(res.status, 'duplicate');
  assert.ok(notifications.some((n) => n.includes('already playing')));
});

test('startPlayback rejects duplicates across different groups', async () => {
  const { svc, notify } = makeDeps();
  await svc.startPlayback({ chatId: '111111@g.us', query: 'first song', notify });
  const res = await svc.startPlayback({ chatId: '222222@g.us', query: 'second song', notify });
  assert.equal(res.status, 'duplicate');
});

test('startPlayback falls back to an audio message when no results are found', async () => {
  const { svc, music, notifications, notify } = makeDeps({ searchResults: [] });
  const res = await svc.startPlayback({ chatId: '123456789@g.us', query: 'zzz', notify });
  assert.equal(res.status, 'error');
  assert.ok(notifications.some((n) => n.includes('No results')));
  assert.equal(music.handleSongRequest.mock.callCount(), 0);
});

test('startPlayback falls back to an audio message when the live call fails', async () => {
  const bridge = makeCallBridgeMock();
  bridge.startGroupCall = async () => ({ ok: false, error: 'chat-not-found' });
  const { svc, music, notifications, notify } = makeDeps({ bridge });
  const res = await svc.startPlayback({ chatId: '123456789@g.us', query: 'Mast Kalander', notify });
  assert.equal(res.status, 'fallback');
  assert.ok(notifications.some((n) => n.includes('Live voice-call streaming is currently unavailable')));
  assert.equal(music.handleSongRequest.mock.callCount(), 1);
  assert.ok(bridge.calls.includes('endCall'));
});

test('startPlayback falls back when the call never connects', async () => {
  const bridge = makeCallBridgeMock();
  bridge.getCallState = async () => ({ active: false, isInConnectedCall: false, state: null });
  const { svc, music, notify } = makeDeps({
    bridge,
    connectTimeoutMs: 60,
  });
  const res = await svc.startPlayback({ chatId: '123456789@g.us', query: 'Mast Kalander', notify });
  assert.equal(res.status, 'fallback');
  assert.equal(music.handleSongRequest.mock.callCount(), 1);
  assert.ok(bridge.calls.includes('endCall'));
});

test('track ending ends playback and cleans up', async () => {
  const { svc, callBridge, notifications, notify } = makeDeps();
  await svc.startPlayback({ chatId: '123456789@g.us', query: 'Mast Kalander', notify });
  const session = svc._getSessionForTest('123456789@g.us');
  session.ffmpegProcess.emit('exit', 0);
  await new Promise((r) => setImmediate(r));
  assert.ok(notifications.some((n) => n.includes('Playback finished')));
  assert.ok(callBridge.calls.includes('endCall'));
  assert.equal(svc._getSessionForTest('123456789@g.us'), undefined);
});

test('stop ends playback, kills the pipeline and hangs up the call', async () => {
  const { svc, callBridge, notifications, notify } = makeDeps();
  await svc.startPlayback({ chatId: '123456789@g.us', query: 'Mast Kalander', notify });
  const session = svc._getSessionForTest('123456789@g.us');
  const res = await svc.stop('123456789@g.us', notify);
  assert.equal(res.status, 'stopped');
  assert.ok(notifications.some((n) => n.includes('Playback stopped')));
  assert.ok(session.ffmpegProcess.kill.mock.calls.some((c) => c.arguments[0] === 'SIGKILL'));
  assert.ok(callBridge.calls.includes('endCall'));
  assert.equal(svc._getSessionForTest('123456789@g.us'), undefined);
});

test('stop reports nothing playing when no session exists', async () => {
  const { svc, notifications, notify } = makeDeps();
  const res = await svc.stop('999999@g.us', notify);
  assert.equal(res.status, 'none');
  assert.ok(notifications.some((n) => n.includes('Nothing is currently playing')));
});

test('pause and resume control the ffmpeg process', async () => {
  const { svc, notifications, notify } = makeDeps();
  await svc.startPlayback({ chatId: '123456789@g.us', query: 'Mast Kalander', notify });
  const session = svc._getSessionForTest('123456789@g.us');

  const paused = await svc.pause('123456789@g.us', notify);
  assert.equal(paused.status, 'paused');
  assert.equal(session.state, PLAYBACK_STATES.PAUSED);
  assert.ok(session.ffmpegProcess.kill.mock.calls.some((c) => c.arguments[0] === 'SIGSTOP'));
  assert.ok(notifications.some((n) => n.includes('paused')));

  const pausedAgain = await svc.pause('123456789@g.us', notify);
  assert.equal(pausedAgain.status, 'already');

  const resumed = await svc.resume('123456789@g.us', notify);
  assert.equal(resumed.status, 'resumed');
  assert.equal(session.state, PLAYBACK_STATES.STREAMING);
  assert.ok(session.ffmpegProcess.kill.mock.calls.some((c) => c.arguments[0] === 'SIGCONT'));
  assert.ok(notifications.some((n) => n.includes('resumed')));
});

test('nowPlaying reports the current song and position', async () => {
  const { svc, notifications, notify } = makeDeps();
  await svc.startPlayback({ chatId: '123456789@g.us', query: 'Mast Kalander', notify });
  const res = svc.nowPlaying('123456789@g.us', notify);
  assert.equal(res.status, 'playing');
  assert.ok(notifications.some((n) => n.includes('Now playing: Mast Kalander')));
  assert.ok(notifications.some((n) => n.includes('A.R. Rahman')));
});

test('nowPlaying reports nothing playing without a session', async () => {
  const { svc, notifications, notify } = makeDeps();
  svc.nowPlaying('999999@g.us', notify);
  assert.ok(notifications.some((n) => n.includes('Nothing is currently playing')));
});

test('shutdown cleans up sessions, bridge and server', async () => {
  const { svc, callBridge } = makeDeps();
  await svc.startPlayback({ chatId: '123456789@g.us', query: 'Mast Kalander', notify: () => {} });
  await svc.shutdown();
  assert.ok(callBridge.calls.includes('endCall'));
  assert.ok(callBridge.calls.includes('dispose'));
  assert.equal(svc._getSessionForTest('123456789@g.us'), undefined);
});

test('max duration ends playback automatically', async () => {
  const config = makeConfig({ VOICE_CALL_MAX_DURATION_SECONDS: '1' });
  const notifications = [];
  const notify = (t) => notifications.push(t);
  const audioService = {
    search: async () => [
      { id: 'vid1', title: 'T', channel: 'C', duration: 300, url: 'https://youtu.be/vid1' },
    ],
    pickBest: (r) => r[0],
  };
  const music = { handleSongRequest: async () => {} };
  const callBridge = makeCallBridgeMock();
  const svc = createVoiceCallService({
    config,
    logger: createSilentLogger(),
    audioService,
    music,
    client: {},
    callBridge,
    sleep: async () => {},
  });
  await svc.startPlayback({ chatId: '123456789@g.us', query: 'T', notify });
  await new Promise((r) => setTimeout(r, 1200));
  assert.ok(notifications.some((n) => n.includes('maximum duration')));
  assert.equal(svc._getSessionForTest('123456789@g.us'), undefined);
});

test('startPlayback refuses a private chat target and starts nothing', async () => {
  const { svc, music, callBridge, notifications, notify } = makeDeps();
  const res = await svc.startPlayback({
    chatId: '919111111111@c.us',
    query: 'Mast Kalander',
    notify,
  });
  assert.equal(res.status, 'dm-not-supported');
  assert.ok(notifications.some((n) => n.includes('only available in WhatsApp groups')));
  assert.ok(!callBridge.calls.includes('startGroupCall'), 'no call may be started for a DM');
  assert.ok(!callBridge.calls.includes('prepareAudioGraph'));
  assert.equal(music.handleSongRequest.mock.callCount(), 0, 'no fallback audio for a DM');
});

test('group play passes the exact group id to the call bridge', async () => {
  const { svc, callBridge, notify } = makeDeps();
  await svc.startPlayback({ chatId: '120363429633423063@g.us', query: 'Mast Kalander', notify });
  const targetCalls = callBridge.calls.filter((c) => c && typeof c === 'object' && c.startTarget);
  assert.equal(targetCalls.length, 1);
  assert.equal(targetCalls[0].startTarget, '120363429633423063@g.us');
  assert.ok(String(targetCalls[0].startTarget).endsWith('@g.us'));
  assert.ok(!String(targetCalls[0].startTarget).endsWith('@c.us'));
});

test('group live-call failure falls back in the same group, never a DM', async () => {
  const bridge = makeCallBridgeMock();
  bridge.startGroupCall = async (chatId) => {
    bridge.calls.push('startGroupCall');
    bridge.calls.push({ startTarget: chatId });
    return { ok: false, error: 'boom' };
  };
  const { svc, music, notify } = makeDeps({ bridge });
  const res = await svc.startPlayback({
    chatId: '120363429633423063@g.us',
    query: 'Mast Kalander',
    notify,
  });
  assert.equal(res.status, 'fallback');
  const fallbackArgs = music.handleSongRequest.mock.calls[0].arguments[0];
  assert.equal(fallbackArgs.chatId, '120363429633423063@g.us', 'fallback audio goes to the group');
  assert.ok(!fallbackArgs.chatId.endsWith('@c.us'), 'never a DM fallback target');
  const targetCalls = bridge.calls.filter((c) => c && typeof c === 'object' && c.startTarget);
  assert.equal(targetCalls[0].startTarget, '120363429633423063@g.us');
});
