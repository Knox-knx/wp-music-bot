import { test, mock, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAudioService } from '../../src/services/audioService.js';
import { TooLargeError, ConvertError } from '../../src/utils/errors.js';
import { createSilentLogger } from '../../src/utils/logger.js';
import { parseConfig } from '../../src/config.js';

const MB = 1024 * 1024;

const mockState = { fail: false, sizeBytes: 5 * MB, extraFile: null };
const calls = [];

const mockYtDlp = async (url, opts, execOptions) => {
  calls.push({ url, opts, execOptions });
  if (mockState.fail) {
    const err = new Error('yt-dlp: error: download failed');
    err.stderr = 'ERROR: unable to download video';
    throw err;
  }
  const ext = 'mp3';
  const out = String(opts.output).replace('%(ext)s', ext);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.alloc(mockState.sizeBytes, 1));
  if (mockState.extraFile) {
    const extra = String(opts.output).replace('%(ext)s', mockState.extraFile);
    fs.writeFileSync(extra, Buffer.alloc(1, 1));
  }
};

mock.module('yt-dlp-exec', { exports: { ytDlp: mockYtDlp } });

after(() => {
  mock.reset();
});

function makeConfig() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-test-'));
  fs.mkdirSync(path.join(tmpDir, 'downloads'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'converted'), { recursive: true });
  const config = parseConfig({
    NODE_ENV: 'test',
    OWNER_NUMBERS: '919111111111',
    TMP_DIR: tmpDir,
  });
  const svc = createAudioService({ config, logger: createSilentLogger() });
  return { config, tmpDir, svc };
}

test('downloadAndConvert forwards the configured download timeout', async () => {
  const { config, svc } = makeConfig();
  mockState.fail = false;
  mockState.sizeBytes = 5 * MB;
  calls.length = 0;

  await svc.downloadAndConvert('Abc123def');

  assert.equal(calls[0].execOptions.timeout, 120_000);
  assert.equal(config.downloadTimeoutMs, 600_000);
});

test('downloadAndConvert downloads and converts successfully', async () => {
  const { tmpDir, svc } = makeConfig();
  mockState.fail = false;
  mockState.sizeBytes = 5 * MB;
  mockState.extraFile = null;
  calls.length = 0;

  const result = await svc.downloadAndConvert('Abc123def');

  assert.ok(result.filePath.endsWith('.mp3'));
  assert.equal(result.sizeBytes, 5 * MB);
  assert.ok(fs.existsSync(result.filePath));
  assert.ok(path.dirname(result.filePath).endsWith('converted'));
  assert.deepEqual(fs.readdirSync(path.join(tmpDir, 'downloads')), []);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://www.youtube.com/watch?v=Abc123def');
});

test('downloadAndConvert does not pass the unsupported maxFileSize option', async () => {
  const { svc } = makeConfig();
  mockState.fail = false;
  mockState.sizeBytes = 5 * MB;
  calls.length = 0;

  await svc.downloadAndConvert('Abc123def');

  assert.ok(!('maxFileSize' in calls[0].opts));
  assert.equal(calls[0].opts.extractAudio, true);
  assert.equal(calls[0].opts.audioFormat, 'mp3');
});

test('downloadAndConvert prefers the final mp3 when intermediates are left behind', async () => {
  const { tmpDir, svc } = makeConfig();
  mockState.fail = false;
  mockState.sizeBytes = 6 * MB;
  mockState.extraFile = 'm4a';
  calls.length = 0;

  const result = await svc.downloadAndConvert('Abc123def');

  assert.equal(result.sizeBytes, 6 * MB);
  assert.ok(result.filePath.endsWith('.mp3'));
  assert.ok(fs.existsSync(result.filePath));
  assert.deepEqual(fs.readdirSync(path.join(tmpDir, 'downloads')), []);
});

test('downloadAndConvert accepts a file at exactly the 16 MB limit', async () => {
  const { config, svc } = makeConfig();
  mockState.fail = false;
  mockState.sizeBytes = 16 * MB;

  const result = await svc.downloadAndConvert('Abc123def');

  assert.equal(result.sizeBytes, 16 * MB);
  assert.ok(fs.existsSync(result.filePath));
  assert.equal(config.maxAudioMb, 16);
});

test('downloadAndConvert rejects a file over 16 MB with TooLargeError', async () => {
  const { tmpDir, svc } = makeConfig();
  mockState.fail = false;
  mockState.sizeBytes = 16 * MB + 64 * 1024;
  calls.length = 0;

  await assert.rejects(svc.downloadAndConvert('Abc123def'), (err) => {
    assert.ok(err instanceof TooLargeError);
    assert.equal(err.kind, 'too_large');
    assert.match(err.message, /too large to send on WhatsApp/i);
    return true;
  });
  assert.deepEqual(fs.readdirSync(path.join(tmpDir, 'downloads')), []);
  assert.deepEqual(fs.readdirSync(path.join(tmpDir, 'converted')), []);
});

test('downloadAndConvert cleans up the oversized temp file', async () => {
  const { tmpDir, svc } = makeConfig();
  mockState.fail = false;
  mockState.sizeBytes = 20 * MB;
  calls.length = 0;

  await assert.rejects(svc.downloadAndConvert('Abc123def'), TooLargeError);

  const downloads = fs.readdirSync(path.join(tmpDir, 'downloads'));
  const converted = fs.readdirSync(path.join(tmpDir, 'converted'));
  assert.deepEqual(downloads, []);
  assert.deepEqual(converted, []);
});

test('downloadAndConvert surfaces a yt-dlp failure as ConvertError', async () => {
  const { tmpDir, svc } = makeConfig();
  mockState.fail = true;
  calls.length = 0;

  await assert.rejects(svc.downloadAndConvert('Abc123def'), (err) => {
    assert.ok(err instanceof ConvertError);
    assert.equal(err.userFacing, false);
    assert.ok(err.cause instanceof Error);
    return true;
  });
  assert.deepEqual(fs.readdirSync(path.join(tmpDir, 'downloads')), []);
  assert.deepEqual(fs.readdirSync(path.join(tmpDir, 'converted')), []);
});