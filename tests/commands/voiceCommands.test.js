import { test } from 'node:test';
import assert from 'node:assert/strict';
import playCommand from '../../src/commands/music/play.js';
import stopCommand from '../../src/commands/music/stop.js';
import pauseCommand from '../../src/commands/music/pause.js';
import resumeCommand from '../../src/commands/music/resume.js';
import skipCommand from '../../src/commands/music/skip.js';
import playingCommand from '../../src/commands/music/playing.js';
import voiceStatusCommand from '../../src/commands/admin/voicestatus.js';

function makeContext({ isGroup = true, args = [], serviceCalls = {} } = {}) {
  const replies = [];
  const calls = { startPlayback: 0, stop: 0, pause: 0, resume: 0, nowPlaying: 0 };
  const voiceCall = {};
  for (const key of Object.keys(calls)) {
    voiceCall[key] = async (...a) => {
      calls[key] += 1;
      serviceCalls[key] = a;
      return { status: 'ok' };
    };
    if (key === 'nowPlaying') {
      voiceCall[key] = (...a) => {
        calls[key] += 1;
        serviceCalls[key] = a;
        return { status: 'playing' };
      };
    }
  }
  const ctx = {
    isGroup,
    chatId: isGroup ? '123456789@g.us' : '555123456@c.us',
    parsed: { args },
    config: { maxCommandLength: 512 },
    services: { voiceCall },
    reply: async (text) => {
      replies.push(text);
    },
  };
  return { ctx, replies, calls, serviceCalls };
}

test('!play streams a song in a group', async () => {
  const { ctx, replies, calls, serviceCalls } = makeContext({ args: 'Mast Kalander' });
  await playCommand.execute(ctx);
  assert.equal(calls.startPlayback, 1);
  assert.equal(serviceCalls.startPlayback[0].chatId, '123456789@g.us');
  assert.equal(serviceCalls.startPlayback[0].query, 'Mast Kalander');
  await serviceCalls.startPlayback[0].notify('🎵 Starting live playback:\nMast Kalander');
  assert.equal(replies.at(-1), '🎵 Starting live playback:\nMast Kalander');
});

test('!play in a DM is rejected with the groups-only message', async () => {
  const { ctx, replies, calls } = makeContext({ isGroup: false, args: 'song' });
  await playCommand.execute(ctx);
  assert.equal(calls.startPlayback, 0);
  assert.equal(replies[0], '⚠️ Live playback is only available in WhatsApp groups.');
});

test('!play with no args shows usage', async () => {
  const { ctx, replies, calls } = makeContext();
  await playCommand.execute(ctx);
  assert.equal(calls.startPlayback, 0);
  assert.ok(replies[0].includes('!play <song name>'));
});

test('!stop delegates to the voice call service', async () => {
  const { ctx, replies, calls, serviceCalls } = makeContext();
  await stopCommand.execute(ctx);
  assert.equal(calls.stop, 1);
  assert.equal(serviceCalls.stop[0], '123456789@g.us');
  await serviceCalls.stop[1]('⏹️ Playback stopped.');
  assert.equal(replies.at(-1), '⏹️ Playback stopped.');
});

test('!stop in a DM is rejected', async () => {
  const { ctx, replies, calls } = makeContext({ isGroup: false });
  await stopCommand.execute(ctx);
  assert.equal(calls.stop, 0);
  assert.equal(replies[0], '⚠️ Live playback is only available in WhatsApp groups.');
});

test('!pause delegates to the voice call service', async () => {
  const { ctx, calls, serviceCalls } = makeContext();
  await pauseCommand.execute(ctx);
  assert.equal(calls.pause, 1);
  assert.equal(serviceCalls.pause[0], '123456789@g.us');
});

test('!resume delegates to the voice call service', async () => {
  const { ctx, calls, serviceCalls } = makeContext();
  await resumeCommand.execute(ctx);
  assert.equal(calls.resume, 1);
  assert.equal(serviceCalls.resume[0], '123456789@g.us');
});

test('!skip delegates to the voice call service', async () => {
  const { ctx, calls, serviceCalls } = makeContext();
  await skipCommand.execute(ctx);
  assert.equal(calls.stop, 1);
  assert.equal(serviceCalls.stop[0], '123456789@g.us');
});

test('!playing delegates to the voice call service', async () => {
  const { ctx, calls, serviceCalls } = makeContext();
  await playingCommand.execute(ctx);
  assert.equal(calls.nowPlaying, 1);
  assert.equal(serviceCalls.nowPlaying[0], '123456789@g.us');
});

test('control commands are public (not admin-only)', () => {
  for (const cmd of [playCommand, stopCommand, pauseCommand, resumeCommand, skipCommand, playingCommand]) {
    assert.equal(cmd.adminOnly, false, `${cmd.name} should be public`);
  }
});

test('!voicestatus is owner-only and reports the pipeline', async () => {
  assert.equal(voiceStatusCommand.adminOnly, true, 'voicestatus must be admin-only');
  const replies = [];
  const diag = {
    service: [
      {
        state: 'streaming',
        song: 'Tu Hai Kahan',
        bytesSent: 96000,
        queueBytes: 1000,
        queueChunks: 2,
        sockets: 1,
      },
    ],
    bridge: {
      call: { active: true, state: 'ACTIVE', isInConnectedCall: true },
      micTrackId: 'our-track',
      context: { sampleRate: 48000, ctxState: 'running', tracks: [{ id: 'our-track', readyState: 'live', enabled: true }] },
      worklet: { inputFrames: 10, outputFrames: 100, samples: 1000, underruns: 0, overflows: 0, queueDepth: 1 },
      pcm: { readerChunks: 5, readerBytes: 1000, samplesFed: 500 },
      gum: { calls: [{ via: 'mediaDevices' }], syntheticReturns: 1 },
      rtp: [
        {
          senders: [{ kind: 'audio', trackId: 'our-track', readyState: 'live', enabled: true, ours: true, via: 'addTrack' }],
          outbound: [{ type: 'outbound-rtp', packetsSent: 42, bytesSent: 8400 }],
        },
      ],
      sourceNodes: [{ fromOurStream: true }],
    },
  };
  const ctx = {
    isGroup: true,
    chatId: '123456789@g.us',
    parsed: { args: '' },
    services: { voiceCall: { getDiagnostics: async () => diag } },
    reply: async (text) => {
      replies.push(text);
    },
  };
  await voiceStatusCommand.execute(ctx);
  const text = replies[0];
  assert.ok(text.includes('Voice call: streaming'));
  assert.ok(text.includes('Audio pipeline: running'));
  assert.ok(text.includes('PCM served: 96000 bytes'));
  assert.ok(text.includes('Current song: Tu Hai Kahan'));
  assert.ok(text.includes('Call state: ACTIVE (connected)'));
  assert.ok(text.includes('OURS:live'));
  assert.ok(text.includes('RTP sent: 42 packets, 8400 bytes'));
  assert.ok(text.includes('Worklet: in=10 out=100 samples=1000'));
});

test('!voicestatus reports idle state when nothing is playing', async () => {
  const replies = [];
  const ctx = {
    isGroup: true,
    chatId: '123456789@g.us',
    parsed: { args: '' },
    services: {
      voiceCall: {
        getDiagnostics: async () => ({ service: [], bridge: null }),
      },
    },
    reply: async (text) => {
      replies.push(text);
    },
  };
  await voiceStatusCommand.execute(ctx);
  const text = replies[0];
  assert.ok(text.includes('Voice call: disconnected'));
  assert.ok(text.includes('Audio pipeline: stopped'));
  assert.ok(text.includes('Current song: none'));
});
