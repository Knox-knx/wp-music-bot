import { test, mock, after } from 'node:test';
import assert from 'node:assert/strict';
/* global window */

// Load the module AFTER registering node mocks if any (none here) — but the
// bridge has no external deps, so a plain import is fine.
let bridgeModule;
let bridgeFactory;

const savedWindow = globalThis.window;
const savedAudioContext = globalThis.AudioContext;
const savedAudioWorkletNode = globalThis.AudioWorkletNode;

function makeFakeAudioStack() {
  const fakeTrack = {
    kind: 'audio',
    id: 'our-track',
    readyState: 'live',
    enabled: true,
    getSettings: () => ({ deviceId: '' }),
  };
  const fakeStream = {
    kind: 'audio',
    id: 'fake-stream',
    tracks: [fakeTrack],
    getAudioTracks: () => [fakeTrack],
  };
  class FakeAudioContext {
    constructor(opts) {
      this.sampleRate = opts?.sampleRate ?? 48000;
      this.state = 'running';
      this.audioWorklet = { addModule: mock.fn(async () => {}) };
    }
    async resume() {}
    createMediaStreamDestination() {
      return { stream: fakeStream, connect: mock.fn(), disconnect: mock.fn() };
    }
    async close() {}
  }
  class FakeAudioWorkletNode {
    constructor(ctx, name, opts) {
      this.ctx = ctx;
      this.name = name;
      this.opts = opts;
      this.port = { postMessage: mock.fn(() => {}) };
    }
    connect(dest) {
      this.dest = dest;
    }
    disconnect() {}
  }
  return { fakeStream, fakeTrack, FakeAudioContext, FakeAudioWorkletNode };
}

function makeFakeWindow() {
  const calls = { start: [], end: [], gum: [], gumVideo: [], replaceTrack: [] };
  const fakeCall = { id: 'call-123', getState: () => 'ACTIVE' };
  const modules = {
    WAWebWidFactory: {
      createWid: (s) => {
        calls.wid = s;
        return { _serialized: s };
      },
    },
    WAWebCollections: {
      Chat: { get: () => fakeChat(), find: async () => fakeChat() },
    },
    WAWebCallCollection: {
      get activeCall() {
        return fakeCall;
      },
      get isInConnectedCall() {
        return true;
      },
      setActiveCall: (v) => {
        calls.setActiveCall = v;
      },
    },
    WAWebWamEnumCallFromUi: { CALL_FROM_UI: { GROUP_CHAT_DIRECT: 1 } },
    WAWebWamEnumLobbyEntryPointType: { LOBBY_ENTRY_POINT_TYPE: { NOT_OPENED: 2 } },
    WAWebVoipStartCall: {
      startWAWebVoipGroupCallFromChat: async (...args) => {
        calls.start.push(args);
        return { ok: true };
      },
    },
    WAWebVoipStackInterface: {
      getVoipStackInterface: async () => ({
        endCall: async (...args) => {
          calls.end.push(args);
          return { ok: true };
        },
      }),
    },
    WAWebVoipSignalingEnums: { EndCallReason: { Self: 3 } },
    WAWebEnsureVoipInited: undefined,
    WAWebApiContact: {
      getPhoneNumber: () => ({ user: '919111111111' }),
      getAlternateUserWid: () => ({ _serialized: '919111111111@c.us' }),
    },
    WAWebContactCollection: { get: () => null },
  };
  const origGum = async (constraints) => {
    calls.gumVideo.push(constraints);
    return { video: true };
  };
  class FakePC {
    constructor() {
      this.senders = [];
      this.transceivers = [];
    }
    addTrack(track, stream) {
      const sender = { track, stream, kind: track.kind };
      this.senders.push(sender);
      return sender;
    }
    addTransceiver(kindOrTrack, _init) {
      const track = kindOrTrack && typeof kindOrTrack === 'object' ? kindOrTrack : null;
      const sender = { track, kind: track ? track.kind : String(kindOrTrack) };
      const tr = {
        sender,
        receiver: { track: { kind: 'audio' } },
        direction: 'sendrecv',
        currentDirection: 'sendrecv',
      };
      this.senders.push(sender);
      this.transceivers.push(tr);
      return tr;
    }
    getSenders() {
      return this.senders;
    }
    getTransceivers() {
      return this.transceivers;
    }
    async getStats() {
      const map = new Map();
      map.set('out1', { type: 'outbound-rtp', kind: 'audio', packetsSent: 5, bytesSent: 1000 });
      return map;
    }
  }
  const window = {
    require: (mod) => {
      if (mod in modules) return modules[mod];
      throw new Error(`module-missing:${mod}`);
    },
    MediaDevices: { prototype: { getUserMedia: origGum } },
    RTCPeerConnection: FakePC,
    RTCRtpSender: {
      prototype: {
        replaceTrack: async (track) => {
          calls.replaceTrack.push(track);
          return undefined;
        },
      },
    },
  };
  const { fakeStream, fakeTrack, FakeAudioContext, FakeAudioWorkletNode } = makeFakeAudioStack();
  window.AudioContext = FakeAudioContext;
  window.fetch = async (url) => {
    calls.fetchUrl = url;
    return {
      ok: true,
      body: {
        getReader: () => ({
          read: async () => {
            if (calls.reads) return { done: true };
            calls.reads = true;
            const i16 = new Int16Array([1000, -1000, 0]);
            return { done: false, value: new Uint8Array(i16.buffer) };
          },
          cancel: async () => {},
        }),
      },
    };
  };
  function fakeChat() {
    return { id: { _serialized: '123456789@g.us' }, isGroup: true };
  }
  return { window, modules, calls, fakeStream, fakeTrack, FakeAudioContext, FakeAudioWorkletNode, origGum };
}

function runInPage(fn, arg, fakeWindow) {
  const fnStr = fn.toString();
  const runner = new Function(`return (${fnStr})`);
  const fnCopy = runner();
  return fnCopy.call(fakeWindow, arg);
}

async function setup() {
  bridgeModule = await import('../../src/services/whatsappCallBridge.js');
  bridgeFactory = bridgeModule.createWhatsappCallBridge;
  const fake = makeFakeWindow();
  globalThis.window = fake.window;
  globalThis.AudioContext = fake.FakeAudioContext;
  globalThis.AudioWorkletNode = fake.FakeAudioWorkletNode;
  return fake;
}

after(() => {
  if (savedWindow === undefined) delete globalThis.window;
  else globalThis.window = savedWindow;
  globalThis.AudioContext = savedAudioContext;
  globalThis.AudioWorkletNode = savedAudioWorkletNode;
});

test('install patches getUserMedia and exposes the voice bridge', async () => {
  const fake = await setup();
  const client = {
    config: { voiceCall: { streamHost: '127.0.0.1', streamPort: 38980 } },
    pupPage: { evaluate: (fn, arg) => runInPage(fn, arg, fake.window) },
  };
  const bridge = bridgeFactory({ getClient: () => client, logger: null, config: client.config });
  const res = await bridge.ensureInstalled();
  assert.equal(res.installed, true);
  assert.equal(bridge.isInstalled(), true);
  await bridge.prepareAudioGraph();

  const patchedGum = fake.window.MediaDevices.prototype.getUserMedia;
  const audioStream = await patchedGum({ audio: true });
  assert.equal(audioStream, fake.fakeStream, 'audio-only getUserMedia should return the fake stream');
  const videoStream = await patchedGum({ video: true });
  assert.equal(videoStream.video, true, 'video getUserMedia should call the original');
});

test('ensureInstalled is idempotent', async () => {
  const fake = await setup();
  const client = {
    config: { voiceCall: { streamHost: '127.0.0.1', streamPort: 38980 } },
    pupPage: { evaluate: (fn, arg) => runInPage(fn, arg, fake.window) },
  };
  const bridge = bridgeFactory({ getClient: () => client, logger: null, config: client.config });
  const first = await bridge.ensureInstalled();
  const second = await bridge.ensureInstalled();
  assert.equal(first.installed, true);
  assert.equal(second.reused, true);
});

test('startGroupCall invokes the page VoIP start API with correct args', async () => {
  const fake = await setup();
  const client = {
    config: { voiceCall: { streamHost: '127.0.0.1', streamPort: 38980 } },
    pupPage: { evaluate: (fn, arg) => runInPage(fn, arg, fake.window) },
  };
  const bridge = bridgeFactory({ getClient: () => client, logger: null, config: client.config });
  const res = await bridge.startGroupCall('123456789@g.us');
  assert.equal(res.ok, true);
  assert.equal(fake.calls.wid, '123456789@g.us');
  const startArgs = fake.calls.start[0];
  assert.equal(startArgs[1], false, 'voice call must not request video');
  assert.equal(startArgs[2], 1, 'CALL_FROM_UI.GROUP_CHAT_DIRECT');
  assert.equal(startArgs[3], 2, 'LOBBY_ENTRY_POINT_TYPE.NOT_OPENED');
});

test('getCallState reads the active call from the page', async () => {
  const fake = await setup();
  const client = {
    config: { voiceCall: { streamHost: '127.0.0.1', streamPort: 38980 } },
    pupPage: { evaluate: (fn, arg) => runInPage(fn, arg, fake.window) },
  };
  const bridge = bridgeFactory({ getClient: () => client, logger: null, config: client.config });
  await bridge.ensureInstalled();
  const state = await bridge.getCallState();
  assert.equal(state.active, true);
  assert.equal(state.isInConnectedCall, true);
  assert.equal(state.state, 'ACTIVE');
  assert.equal(state.callId, 'call-123');
});

test('getCallState before install returns defaults', async () => {
  const fake = await setup();
  const client = {
    config: { voiceCall: { streamHost: '127.0.0.1', streamPort: 38980 } },
    pupPage: { evaluate: (fn, arg) => runInPage(fn, arg, fake.window) },
  };
  const bridge = bridgeFactory({ getClient: () => client, logger: null, config: client.config });
  const state = await bridge.getCallState();
  assert.deepEqual(state, { active: false, isInConnectedCall: false, state: null, callId: null });
});

test('endCall hangs up through the stack interface', async () => {
  const fake = await setup();
  const client = {
    config: { voiceCall: { streamHost: '127.0.0.1', streamPort: 38980 } },
    pupPage: { evaluate: (fn, arg) => runInPage(fn, arg, fake.window) },
  };
  const bridge = bridgeFactory({ getClient: () => client, logger: null, config: client.config });
  await bridge.ensureInstalled();
  const res = await bridge.endCall();
  assert.equal(res.ok, true);
  assert.deepEqual(fake.calls.end[0], [3, true], 'EndCallReason.Self with isVideo=true');
});

test('dispose restores the original getUserMedia', async () => {
  const fake = await setup();
  const client = {
    config: { voiceCall: { streamHost: '127.0.0.1', streamPort: 38980 } },
    pupPage: { evaluate: (fn, arg) => runInPage(fn, arg, fake.window) },
  };
  const bridge = bridgeFactory({ getClient: () => client, logger: null, config: client.config });
  await bridge.ensureInstalled();
  await bridge.dispose();
  assert.equal(fake.window.MediaDevices.prototype.getUserMedia, fake.origGum);
  assert.equal(bridge.isInstalled(), false);
});

test('getDiagnostics reports context, worklet, pcm and gum counters', async () => {
  const fake = await setup();
  const client = {
    config: { voiceCall: { streamHost: '127.0.0.1', streamPort: 38980 } },
    pupPage: { evaluate: (fn, arg) => runInPage(fn, arg, fake.window) },
  };
  const bridge = bridgeFactory({ getClient: () => client, logger: null, config: client.config });
  await bridge.ensureInstalled();
  await bridge.prepareAudioGraph();

  await fake.window.MediaDevices.prototype.getUserMedia({ audio: { echoCancellation: true } });
  const diag = await bridge.getDiagnostics();

  assert.equal(diag.version, 2);
  assert.equal(diag.context.sampleRate, 48000);
  assert.equal(diag.context.tracks.length, 1);
  assert.equal(diag.context.tracks[0].id, 'our-track');
  assert.equal(diag.micTrackId, 'our-track');
  assert.ok(diag.worklet, 'worklet counters must be present');
  assert.equal(diag.gum.calls.length, 1);
  assert.equal(diag.gum.calls[0].via, 'mediaDevices');
  assert.equal(diag.gum.calls[0].kind, 'audio-only');
  assert.equal(diag.gum.syntheticReturns, 1);
  assert.equal(diag.pcm.readerBytes, 0);
  assert.equal(diag.call.isInConnectedCall, true);
});

test('RTCPeerConnection hooks record senders and mark our track', async () => {
  const fake = await setup();
  const client = {
    config: { voiceCall: { streamHost: '127.0.0.1', streamPort: 38980 } },
    pupPage: { evaluate: (fn, arg) => runInPage(fn, arg, fake.window) },
  };
  const bridge = bridgeFactory({ getClient: () => client, logger: null, config: client.config });
  await bridge.ensureInstalled();
  await bridge.prepareAudioGraph();

  await runInPage(
    async () => {
      const pc = new window.RTCPeerConnection();
      const track = window.__waVoice.micStream.getAudioTracks()[0];
      pc.addTrack(track);
      pc.addTransceiver('audio');
      await window.RTCRtpSender.prototype.replaceTrack.call(pc.senders[0], track);
      return { ok: true };
    },
    null,
    fake.window
  );

  const diag = await bridge.getDiagnostics();
  assert.equal(diag.rtp.length, 1, 'the created pc must be tracked');
  const senders = diag.rtp[0].senders;
  const ours = senders.find((s) => s.ours);
  assert.ok(ours, 'an outgoing sender must reference our synthetic track');
  assert.equal(ours.trackId, 'our-track');
  assert.equal(ours.readyState, 'live');
  assert.equal(ours.enabled, true);
  assert.equal(ours.via, 'addTrack');
  assert.equal(diag.rtp[0].outbound.length, 1);
  assert.equal(diag.rtp[0].outbound[0].packetsSent, 5);
  assert.equal(diag.replaceTracks.length, 1);
  assert.equal(diag.replaceTracks[0].newId, 'our-track');
  assert.equal(diag.rtp[0].audioTransceivers.length, 1);
  assert.equal(diag.rtp[0].audioTransceivers[0].direction, 'sendrecv');
});

test('startStreaming reads PCM bytes and feeds the worklet port', async () => {
  const fake = await setup();
  const client = {
    config: { voiceCall: { streamHost: '127.0.0.1', streamPort: 38980 } },
    pupPage: { evaluate: (fn, arg) => runInPage(fn, arg, fake.window) },
  };
  const bridge = bridgeFactory({ getClient: () => client, logger: null, config: client.config });
  await bridge.ensureInstalled();
  await bridge.prepareAudioGraph();
  await bridge.startStreaming();
  await new Promise((r) => setTimeout(r, 10));

  const diag = await bridge.getDiagnostics();
  assert.ok(diag.pcm.readerBytes > 0, 'page must have fetched PCM bytes');
  assert.ok(diag.pcm.readerChunks >= 1);
  assert.equal(diag.pcm.samplesFed, 3, '3 int16 samples converted and fed');
  assert.equal(fake.calls.fetchUrl, 'http://127.0.0.1:38980/stream');
});

test('startGroupCall records the resolved chat model and exact call args', async () => {
  const fake = await setup();
  const client = {
    config: { voiceCall: { streamHost: '127.0.0.1', streamPort: 38980 } },
    pupPage: { evaluate: (fn, arg) => runInPage(fn, arg, fake.window) },
  };
  const bridge = bridgeFactory({ getClient: () => client, logger: null, config: client.config });
  const res = await bridge.startGroupCall('123456789@g.us');
  assert.equal(res.ok, true);
  const diag = await bridge.getDiagnostics();
  assert.equal(diag.callDebug.target, '123456789@g.us');
  assert.equal(diag.callDebug.get, '123456789@g.us');
  assert.equal(diag.callDebug.getIsGroup, true);
  assert.equal(diag.callDebug.resolvedChatId, '123456789@g.us');
  assert.equal(diag.callDebug.resolvedIsGroup, true);
  assert.equal(diag.callDebug.callArgs[0], '123456789@g.us');
  assert.equal(diag.callDebug.callArgs[1], false);
});

test('resolveSenderNumber resolves a lid to its phone number', async () => {
  const fake = await setup();
  const client = {
    config: { voiceCall: { streamHost: '127.0.0.1', streamPort: 38980 } },
    pupPage: { evaluate: (fn, arg) => runInPage(fn, arg, fake.window) },
  };
  const bridge = bridgeFactory({ getClient: () => client, logger: null, config: client.config });
  const pn = await bridge.resolveSenderNumber('1409000000000001@lid');
  assert.equal(pn, '919111111111');
  const again = await bridge.resolveSenderNumber('1409000000000001@lid');
  assert.equal(again, '919111111111', 'result should be cached');
  const nonLid = await bridge.resolveSenderNumber('919111111111@c.us');
  assert.equal(nonLid, null, 'non-lid ids are returned untouched');
});
