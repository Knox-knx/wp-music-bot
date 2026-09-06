import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from '../src/config.js';

const baseEnv = {
  NODE_ENV: 'test',
  OWNER_NUMBERS: '919876543210,918765432109',
};

test('parseConfig accepts a valid environment', () => {
  const config = parseConfig({ ...baseEnv, DEFAULT_ADS_PER_DAY: '3' });
  assert.equal(config.prefix, '!');
  assert.deepEqual(config.ownerNumbers, ['919876543210', '918765432109']);
  assert.equal(config.ads.defaultPerDay, 3);
  assert.equal(config.maxAudioBytes, 16 * 1024 * 1024);
});

test('parseConfig rejects missing owners in production', () => {
  assert.throws(() => parseConfig({ NODE_ENV: 'production' }), /OWNER_NUMBERS/);
});

test('parseConfig rejects invalid ad interval default', () => {
  assert.throws(() => parseConfig({ ...baseEnv, DEFAULT_ADS_PER_DAY: '1' }));
  assert.throws(() => parseConfig({ ...baseEnv, DEFAULT_ADS_PER_DAY: '6' }));
});

test('parseConfig rejects invalid antispam action', () => {
  assert.throws(() => parseConfig({ ...baseEnv, ANTISPAM_ACTION: 'explode' }));
});

test('parseConfig accepts all valid antispam actions', () => {
  for (const action of ['delete', 'warn', 'mute', 'kick']) {
    const config = parseConfig({ ...baseEnv, ANTISPAM_ACTION: action });
    assert.equal(config.antispam.action, action);
  }
});

test('parseConfig coerces booleans', () => {
  const config = parseConfig({ ...baseEnv, ANTISPAM_ENABLED: '0', BROWSER_HEADLESS: 'true' });
  assert.equal(config.antispam.enabled, false);
  assert.equal(config.browser.headless, true);
});

test('parseConfig parses browser args into a list', () => {
  const config = parseConfig({
    ...baseEnv,
    BROWSER_ARGS: '--no-sandbox, --disable-gpu',
    VOICE_CALL_ENABLED: 'false',
  });
  assert.deepEqual(config.browser.args, ['--no-sandbox', '--disable-gpu']);
});

test('parseConfig parses voice call options with defaults', () => {
  const config = parseConfig(baseEnv);
  assert.deepEqual(config.voiceCall, {
    enabled: false,
    connectTimeoutMs: 30000,
    startTimeoutMs: 30000,
    maxDurationSeconds: 600,
    streamHost: '127.0.0.1',
    streamPort: 38980,
  });
});

test('parseConfig overrides voice call options from env', () => {
  const config = parseConfig({
    ...baseEnv,
    VOICE_CALL_ENABLED: 'true',
    VOICE_CALL_CONNECT_TIMEOUT_MS: '15000',
    VOICE_CALL_START_TIMEOUT_MS: '20000',
    VOICE_CALL_MAX_DURATION_SECONDS: '300',
    VOICE_CALL_STREAM_PORT: '39000',
  });
  assert.equal(config.voiceCall.enabled, true);
  assert.equal(config.voiceCall.connectTimeoutMs, 15000);
  assert.equal(config.voiceCall.startTimeoutMs, 20000);
  assert.equal(config.voiceCall.maxDurationSeconds, 300);
  assert.equal(config.voiceCall.streamPort, 39000);
});

test('voice call browser flags are added when enabled', () => {
  const config = parseConfig({ ...baseEnv, VOICE_CALL_ENABLED: 'true' });
  assert.ok(
    config.browser.args.includes('--use-fake-device-for-media-stream'),
    'fake media stream flag missing'
  );
  assert.ok(
    config.browser.args.includes('--use-fake-ui-for-media-stream'),
    'fake UI flag missing'
  );
  assert.ok(
    config.browser.args.includes('--autoplay-policy=no-user-gesture-required'),
    'autoplay flag missing'
  );
  assert.ok(
    config.browser.args.includes('--unsafely-treat-insecure-origin-as-secure=http://127.0.0.1:38980'),
    'insecure origin flag missing'
  );
});

test('voice call browser flags are skipped when disabled', () => {
  const config = parseConfig({ ...baseEnv, VOICE_CALL_ENABLED: 'false' });
  assert.ok(!config.browser.args.includes('--use-fake-device-for-media-stream'));
  assert.ok(
    !config.browser.args.some((a) => a.startsWith('--unsafely-treat-insecure-origin-as-secure'))
  );
});