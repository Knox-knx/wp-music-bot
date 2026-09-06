import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickBestResult, normalizeSearchResult, createAudioService } from '../src/services/audioService.js';
import { createSilentLogger } from '../src/utils/logger.js';
import { parseConfig } from '../src/config.js';

const config = parseConfig({
  NODE_ENV: 'test',
  OWNER_NUMBERS: '919111111111',
  MAX_AUDIO_DURATION_SECONDS: '600',
});

const results = [
  normalizeSearchResult({
    id: 'vid1',
    title: 'Believer (Official)',
    channel: 'Imagine Dragons',
    duration: 204,
    webpage_url: 'https://youtu.be/vid1',
  }),
  normalizeSearchResult({
    id: 'vid2',
    title: 'Believer (Live)',
    channel: 'FanCam',
    duration: 900,
    live_status: 'is_live',
    webpage_url: 'https://youtu.be/vid2',
  }),
  normalizeSearchResult({
    id: 'vid3',
    title: 'Believer Remix',
    channel: 'Someone',
    duration: 320,
    webpage_url: 'https://youtu.be/vid3',
  }),
];

test('pickBestResult prefers the shortest qualifying track', () => {
  const best = pickBestResult(results, 600);
  assert.equal(best.id, 'vid1');
});

test('pickBestResult rejects tracks over the duration limit', () => {
  const best = pickBestResult(results, 300);
  assert.equal(best.id, 'vid1');
  assert.ok(best.duration <= 300);
});

test('pickBestResult returns null when all tracks are too long', () => {
  const best = pickBestResult(results, 100);
  assert.equal(best, null);
});

test('pickBestResult returns null for empty results', () => {
  assert.equal(pickBestResult([], 600), null);
});

test('normalizeSearchResult handles missing fields safely', () => {
  const r = normalizeSearchResult({ id: 'abi2' });
  assert.equal(r.id, 'abi2');
  assert.equal(r.title, 'Unknown');
  assert.equal(r.duration, null);
  assert.equal(r.live, false);
});

test('audio service pickBest uses config duration', () => {
  const svc = createAudioService({ config, logger: createSilentLogger() });
  const best = svc.pickBest([results[1]]);
  assert.equal(best, null);
});