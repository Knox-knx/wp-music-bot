// codes by: @LouisPy
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { NoResultsError, TooLongError } from '../utils/errors.js';

const require = createRequire(import.meta.url);

const SAMPLE_RATE = 48000;
const CHANNELS = 1;
const BYTES_PER_SEC = SAMPLE_RATE * CHANNELS * 2;
const PACE_TICK_MS = 20;
const BYTES_PER_TICK = Math.round((BYTES_PER_SEC * PACE_TICK_MS) / 1000);
const PACE_LEAD_MS = 400;
const MAX_QUEUE_MS = 2000;
const MAX_QUEUE_BYTES = Math.round((BYTES_PER_SEC * MAX_QUEUE_MS) / 1000);
const STREAM_POLL_MS = 1000;
const DIAG_INTERVAL_MS = 10000;

export const PLAYBACK_STATES = Object.freeze({
  IDLE: 'idle',
  STARTING: 'starting',
  CONNECTING: 'connecting',
  STREAMING: 'streaming',
  PAUSED: 'paused',
  STOPPING: 'stopping',
  ENDED: 'ended',
  FAILED: 'failed',
});

const CONNECTED_STATES = new Set([
  'ACTIVE',
  'OUTGOING_RING',
  'OUTGOING_CALLING',
  'CONNECTING',
  'CONNECTED',
  'LOBBY',
]);

function resolveYtDlpBinary() {
  try {
    const pkgPath = require.resolve('yt-dlp-exec');
    const candidate = path.join(path.dirname(pkgPath), 'bin', 'yt-dlp');
    if (fs.existsSync(candidate)) return candidate;
  } catch {
    /* fall through */
  }
  return 'yt-dlp';
}

export function createVoiceCallService({
  config,
  logger,
  audioService,
  music,
  client,
  getClient = null,
  callBridge,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  const sessions = new Map();
  const server = createStreamServer();
  let serverListening = false;
  let disposed = false;

  function isActiveState(state) {
    return ![PLAYBACK_STATES.ENDED, PLAYBACK_STATES.FAILED].includes(state);
  }

  function activeSessionFor(chatId) {
    const session = sessions.get(chatId);
    if (session && isActiveState(session.state)) return session;
    return null;
  }

  function formatPosition(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  async function ensureServer() {
    if (serverListening) return;
    server.listen(config.voiceCall.streamPort, config.voiceCall.streamHost);
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    serverListening = true;
  }

  async function ensureFfmpeg() {
    const ffmpegPath = config.audioService?.ffmpegPath || 'ffmpeg';
    await new Promise((resolve, reject) => {
      const probe = spawn(ffmpegPath, ['-version'], { stdio: 'ignore' });
      probe.once('error', () => reject(new Error('ffmpeg-missing')));
      probe.once('exit', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg-missing'))));
    });
    return ffmpegPath;
  }

  function createSession(chatId, notify) {
    const session = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      chatId,
      notify,
      state: PLAYBACK_STATES.STARTING,
      song: null,
      ytProcess: null,
      ffmpegProcess: null,
      sockets: new Set(),
      queue: [],
      queueBytes: 0,
      bytesSent: 0,
      paceStartedAt: null,
      accumPauseMs: 0,
      streamTimer: null,
      diagTimer: null,
      connectDeadline: null,
      maxDurationTimer: null,
      stoppedByUser: false,
    };
    sessions.set(chatId, session);
    return session;
  }

  function pushAudio(session, chunk) {
    session.queue.push(chunk);
    session.queueBytes += chunk.length;
    while (session.queueBytes > MAX_QUEUE_BYTES && session.queue.length > 1) {
      const dropped = session.queue.shift();
      session.queueBytes -= dropped.length;
    }
  }

  function tick(session) {
    if (session.state !== PLAYBACK_STATES.STREAMING) return;
    const socket = [...session.sockets].find((s) => !s.destroyed);
    if (!socket || socket.writableNeedDrain) return;
    const playedMs = Date.now() - session.paceStartedAt - session.accumPauseMs;
    const allowedBytes =
      (playedMs / 1000) * BYTES_PER_SEC + (PACE_LEAD_MS / 1000) * BYTES_PER_SEC;
    if (session.bytesSent >= allowedBytes) return;
    const budget = Math.min(allowedBytes - session.bytesSent, BYTES_PER_TICK * 4);
    let sent = 0;
    while (budget > 0 && session.queue.length) {
      const chunk = session.queue[0];
      const n = Math.min(chunk.length, budget);
      socket.write(chunk.subarray(0, n));
      sent += n;
      budget -= n;
      session.queueBytes -= n;
      if (n < chunk.length) {
        session.queue[0] = chunk.subarray(n);
      } else {
        session.queue.shift();
      }
    }
    session.bytesSent += sent;
  }

  function compactDiag(bridgeDiag) {
    if (!bridgeDiag) return null;
    const senders = [];
    for (const pc of bridgeDiag.rtp || []) {
      for (const s of pc.senders || []) {
        senders.push(
          `${s.kind}|${s.ours ? 'ours' : 'other'}|id=${s.trackId}|${s.readyState}|en=${s.enabled}|via=${s.via}`
        );
      }
    }
    const outbound = [];
    for (const pc of bridgeDiag.rtp || []) {
      for (const o of pc.outbound || []) {
        if (o.type === 'outbound-rtp' && o.packetsSent != null) {
          outbound.push({ packetsSent: o.packetsSent, bytesSent: o.bytesSent });
        }
      }
    }
    return {
      callState: bridgeDiag.call?.state ?? null,
      isConnected: Boolean(bridgeDiag.call?.isInConnectedCall),
      ctxState: bridgeDiag.context?.ctxState ?? null,
      sampleRate: bridgeDiag.context?.sampleRate ?? null,
      micTrack: bridgeDiag.context?.tracks?.[0] ?? null,
      worklet: bridgeDiag.worklet ?? null,
      pcm: bridgeDiag.pcm ?? null,
      gum: {
        calls: bridgeDiag.gum?.calls?.length ?? 0,
        synthetic: bridgeDiag.gum?.syntheticReturns ?? 0,
      },
      sources: bridgeDiag.sourceNodes ?? [],
      contexts: bridgeDiag.contextLog ?? [],
      replaceTracks: bridgeDiag.replaceTracks ?? [],
      senders,
      outbound,
    };
  }

  async function logDiagnostics(session) {
    try {
      const bridgeDiag = await callBridge.getDiagnostics();
      logger.info(
        { chatId: session.chatId, state: session.state, diag: compactDiag(bridgeDiag) },
        'voice playback diagnostics'
      );
    } catch (err) {
      logger.warn({ err }, 'voice playback diagnostics failed');
    }
  }

  async function startPlayback({ chatId, query, notify }) {
    const safeNotify = async (text) => {
      try {
        await notify?.(text);
      } catch (err) {
        logger.warn({ err, chatId }, 'voice playback notification failed; continuing');
      }
    };
    const targetChatId = String(chatId || '');
    if (!targetChatId.endsWith('@g.us')) {
      logger.warn({ chatId: targetChatId }, 'voice call rejected: target is not a group');
      await safeNotify('⚠️ Live playback is only available in WhatsApp groups.');
      return { status: 'dm-not-supported' };
    }
    logger.info({ target: targetChatId }, 'voice call: group target confirmed');
    const existing = activeSessionFor(targetChatId);
    if (existing) {
      await safeNotify('⚠️ A song is already playing in this group.');
      return { status: 'duplicate' };
    }
    for (const s of sessions.values()) {
      if (isActiveState(s.state)) {
        await safeNotify('⚠️ A song is already playing in this group.');
        return { status: 'duplicate' };
      }
    }
    const session = createSession(targetChatId, notify);
    try {
      await safeNotify(`🔎 Searching for "${query}"...`);
      const results = await audioService.search(query);
      const best = audioService.pickBest(results);
      if (!best) {
        throw new NoResultsError();
      }
      session.song = best;

      const ffmpegPath = await ensureFfmpeg();
      await ensureServer();

      const startDeadline = Date.now() + config.voiceCall.startTimeoutMs;
      const pipeline = await startPipeline(session, best, ffmpegPath);
      session.ytProcess = pipeline.ytProcess;
      session.ffmpegProcess = pipeline.ffmpegProcess;

      await callBridge.prepareAudioGraph();

      logger.info({ chatId: targetChatId, title: best.title }, 'starting group call for playback');
      const startRes = await callBridge.startGroupCall(targetChatId);
      if (!startRes?.ok) {
        throw new Error(`call-start-failed:${startRes?.error || 'unknown'}`);
      }

      session.state = PLAYBACK_STATES.CONNECTING;
      session.connectDeadline = Math.min(
        Date.now() + config.voiceCall.connectTimeoutMs,
        startDeadline
      );

      const connected = await waitForConnection(session);
      if (!connected) {
        throw new Error('call-not-connected');
      }

      session.state = PLAYBACK_STATES.STREAMING;
      session.paceStartedAt = Date.now();
      session.accumPauseMs = 0;
      session.maxDurationTimer = setTimeout(() => {
        endPlayback(session, 'max-duration', '⏹️ Playback ended (maximum duration reached).');
      }, config.voiceCall.maxDurationSeconds * 1000);
      session.maxDurationTimer.unref?.();
      session.streamTimer = setInterval(() => tick(session), PACE_TICK_MS);
      session.streamTimer.unref?.();
      session.diagTimer = setInterval(() => logDiagnostics(session), DIAG_INTERVAL_MS);
      session.diagTimer.unref?.();

      await callBridge.startStreaming();
      await safeNotify(
        `🎵 Starting live playback:\n${best.title}${best.channel ? `\n${best.channel}` : ''}`
      );
      return { status: 'streaming', song: best };
    } catch (err) {
      await teardown(session, { endCall: true });
      session.state = PLAYBACK_STATES.FAILED;
      sessions.delete(chatId);
      sessions.delete(targetChatId);
      if (err instanceof NoResultsError || err instanceof TooLongError) {
        await safeNotify(err.message);
        return { status: 'error', error: err };
      }
      logger.warn({ err, chatId: targetChatId }, 'live playback unavailable, falling back to audio message');
      await safeNotify(
        [
          '⚠️ Live voice-call streaming is currently unavailable.',
          '🎵 Sending the audio file instead...',
        ].join('\n')
      );
      try {
        const liveClient = typeof getClient === 'function' ? getClient() : client;
        await music.handleSongRequest({ client: liveClient, chatId: targetChatId, query, notify });
        return { status: 'fallback' };
      } catch (fallbackErr) {
        logger.warn({ err: fallbackErr, chatId }, 'fallback audio message failed');
        await safeNotify('⚠️ Failed to send the audio file. Please try again later.');
        return { status: 'fallback-failed', error: fallbackErr };
      }
    }
  }

  async function waitForConnection(session) {
    for (;;) {
      if (session.state !== PLAYBACK_STATES.CONNECTING) return false;
      if (Date.now() > session.connectDeadline) return false;
      try {
        const st = await callBridge.getCallState();
        if (st?.isInConnectedCall || CONNECTED_STATES.has(st?.state)) {
          return true;
        }
      } catch {
        /* poll again */
      }
      await sleep(STREAM_POLL_MS);
    }
  }

  function startPipeline(session, song, ffmpegPath) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      };
      const succeed = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      try {
        const ytProcess = spawn(resolveYtDlpBinary(), [
          song.url,
          '-f',
          'bestaudio/best',
          '-o',
          '-',
          '--no-playlist',
          '--quiet',
          '--no-warnings',
          '--no-call-home',
          '--no-progress',
          '-R',
          '2',
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
        const ffmpegProcess = spawn(ffmpegPath, [
          '-hide_banner',
          '-loglevel',
          'error',
          '-i',
          'pipe:0',
          '-vn',
          '-acodec',
          'pcm_s16le',
          '-ar',
          String(SAMPLE_RATE),
          '-ac',
          String(CHANNELS),
          '-f',
          's16le',
          'pipe:1',
        ], { stdio: ['pipe', 'pipe', 'pipe'] });

        session.ytProcess = ytProcess;
        session.ffmpegProcess = ffmpegProcess;

        ytProcess.once('error', (err) => fail(new Error(`ytdlp-spawn:${err.message}`)));
        ffmpegProcess.once('error', (err) => fail(new Error(`ffmpeg-spawn:${err.message}`)));
        ytProcess.stderr?.on('data', () => {});
        ffmpegProcess.stderr?.on('data', () => {});

        ytProcess.stdout.pipe(ffmpegProcess.stdin);

        ffmpegProcess.stdout.on('data', (chunk) => pushAudio(session, chunk));
        ffmpegProcess.once('exit', (code) => {
          if (!session.stoppedByUser) {
            endPlayback(
              session,
              code === 0 ? 'track-ended' : 'pipeline-error',
              code === 0 ? '✅ Playback finished.' : '⚠️ Playback stopped due to an error.'
            );
          }
        });
        ytProcess.once('exit', () => {
          try {
            if (!ffmpegProcess.stdin.destroyed) ffmpegProcess.stdin.end();
          } catch {
            /* ignore */
          }
        });

        succeed({ ytProcess, ffmpegProcess });
      } catch (err) {
        fail(err);
      }
    });
  }

  async function endPlayback(session, reason, userText = null) {
    if (!isActiveState(session.state)) return;
    session.state = PLAYBACK_STATES.STOPPING;
    session.stoppedByUser = true;
    await teardown(session, { endCall: true });
    session.state = PLAYBACK_STATES.ENDED;
    sessions.delete(session.chatId);
    if (userText) {
      try {
        await session.notify?.(userText);
      } catch {
        /* ignore */
      }
    }
  }

  async function teardown(session, { endCall = false } = {}) {
    clearTimeout(session.maxDurationTimer);
    clearInterval(session.streamTimer);
    clearInterval(session.diagTimer);
    session.streamTimer = null;
    session.diagTimer = null;
    session.stoppedByUser = true;

    for (const socket of [...session.sockets]) {
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
    }
    session.sockets.clear();

    if (session.ffmpegProcess) {
      try {
        session.ffmpegProcess.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
    if (session.ytProcess) {
      try {
        session.ytProcess.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
    if (endCall) {
      try {
        await callBridge.endCall();
      } catch {
        /* ignore */
      }
    }
  }

  async function stop(chatId, notify) {
    const session = activeSessionFor(chatId);
    if (!session) {
      notify('Nothing is currently playing in this group.');
      return { status: 'none' };
    }
    await endPlayback(session, 'user-stop', '⏹️ Playback stopped.');
    return { status: 'stopped' };
  }

  async function pause(chatId, notify) {
    const session = activeSessionFor(chatId);
    if (!session) {
      notify('Nothing is currently playing in this group.');
      return { status: 'none' };
    }
    if (session.state === PLAYBACK_STATES.PAUSED) {
      notify('⏸️ Playback is already paused.');
      return { status: 'already' };
    }
    if (session.state !== PLAYBACK_STATES.STREAMING) {
      notify('⏳ Playback is still getting ready.');
      return { status: 'not-ready' };
    }
    session.accumPauseMs += Date.now() - session.paceStartedAt;
    session.state = PLAYBACK_STATES.PAUSED;
    try {
      session.ffmpegProcess?.kill('SIGSTOP');
    } catch {
      /* ignore */
    }
    notify('⏸️ Playback paused.');
    return { status: 'paused' };
  }

  async function resume(chatId, notify) {
    const session = activeSessionFor(chatId);
    if (!session) {
      notify('Nothing is currently playing in this group.');
      return { status: 'none' };
    }
    if (session.state !== PLAYBACK_STATES.PAUSED) {
      notify(
        session.state === PLAYBACK_STATES.STREAMING ? '▶️ Already playing.' : '⏳ Playback is not paused.'
      );
      return { status: 'not-paused' };
    }
    try {
      session.ffmpegProcess?.kill('SIGCONT');
    } catch {
      /* ignore */
    }
    session.paceStartedAt = Date.now();
    session.accumPauseMs = 0;
    session.state = PLAYBACK_STATES.STREAMING;
    notify('▶️ Playback resumed.');
    return { status: 'resumed' };
  }

  function nowPlaying(chatId, notify) {
    const session = activeSessionFor(chatId);
    if (!session) {
      notify('Nothing is currently playing in this group.');
      return { status: 'none' };
    }
    const song = session.song;
    const lines = [];
    if (session.state === PLAYBACK_STATES.STARTING || session.state === PLAYBACK_STATES.CONNECTING) {
      lines.push('⏳ Playback is getting ready...');
      if (song?.title) lines.push(song.title);
    } else {
      lines.push(`🎶 Now playing: ${song?.title ?? 'Unknown'}`);
      if (song?.channel) lines.push(song.channel);
      const elapsed = session.bytesSent / BYTES_PER_SEC;
      const duration = song?.duration;
      const pos = formatPosition(elapsed);
      const total = Number.isFinite(duration) ? formatPosition(duration) : null;
      if (session.state === PLAYBACK_STATES.STREAMING) {
        lines.push(`⏱ ${pos}${total ? ` / ${total}` : ''}`);
      } else if (session.state === PLAYBACK_STATES.PAUSED) {
        lines.push(`⏸ ${pos}${total ? ` / ${total}` : ''}`);
      }
    }
    notify(lines.join('\n'));
    return { status: 'playing' };
  }

  function createStreamServer() {
    const srv = createServer((req, res) => {
      if (req.method !== 'GET' || req.url !== '/stream') {
        res.writeHead(404);
        res.end();
        return;
      }
      const session = activeSessionForCall();
      if (!session || session.state !== PLAYBACK_STATES.STREAMING) {
        res.writeHead(503);
        res.end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      session.sockets.add(res);
      res.on('close', () => {
        session.sockets.delete(res);
        if (session.sockets.size === 0 && session.state === PLAYBACK_STATES.STREAMING) {
          endPlayback(session, 'stream-lost', '⚠️ Playback ended (connection lost).');
        }
      });
    });
    return srv;
  }

  function activeSessionForCall() {
    for (const s of sessions.values()) {
      if (s.state === PLAYBACK_STATES.STREAMING || s.state === PLAYBACK_STATES.PAUSED) return s;
    }
    return null;
  }

  async function shutdown() {
    if (disposed) return;
    disposed = true;
    try {
      await callBridge.endCall();
    } catch {
      /* ignore */
    }
    try {
      await callBridge.dispose();
    } catch {
      /* ignore */
    }
    for (const session of [...sessions.values()]) {
      await teardown(session, { endCall: false });
    }
    sessions.clear();
    if (serverListening) {
      await new Promise((resolve) => {
        server.close(() => resolve());
        setTimeout(resolve, 1000);
      });
      serverListening = false;
    }
  }

  async function getDiagnostics() {
    const out = { service: [], bridge: null };
    for (const s of sessions.values()) {
      out.service.push({
        chatId: s.chatId,
        target: s.chatId,
        state: s.state,
        song: s.song ? s.song.title : null,
        bytesSent: s.bytesSent,
        queueBytes: s.queueBytes,
        queueChunks: s.queue.length,
        sockets: s.sockets.size,
      });
    }
    try {
      out.bridge = await callBridge.getDiagnostics();
    } catch (err) {
      out.bridge = { error: String((err && err.message) || err) };
    }
    return out;
  }

  return {
    startPlayback,
    stop,
    pause,
    resume,
    nowPlaying,
    getDiagnostics,
    shutdown,
    _getSessionForTest: (chatId) => sessions.get(chatId),
  };
}