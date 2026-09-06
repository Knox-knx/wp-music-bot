import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLyricsService } from '../src/services/lyricsService.js';
import { parseConfig } from '../src/config.js';
import { createSilentLogger } from '../src/utils/logger.js';

const config = parseConfig({
  NODE_ENV: 'test',
  OWNER_NUMBERS: '919111111111',
});

function fakeFetcher(behavior) {
  return {
    get: behavior,
  };
}

test('returns lyrics from plainLyrics', async () => {
  const fetcher = fakeFetcher(async () => ({
    data: [
      {
        trackName: 'Believer',
        artistName: 'Imagine Dragons',
        plainLyrics: 'First things first\nI\'ma say all the words',
      },
    ],
  }));
  const svc = createLyricsService({ config, logger: createSilentLogger(), fetcher });
  const result = await svc.getLyrics({ title: 'Believer', artist: 'Imagine Dragons' });
  assert.equal(result.found, true);
  assert.equal(result.title, 'Believer');
  assert.match(result.lyrics, /First things first/);
});

test('converts synced lyrics to plain text', async () => {
  const fetcher = fakeFetcher(async () => ({
    data: [
      {
        trackName: 'Believer',
        artistName: 'Imagine Dragons',
        syncedLyrics: '[00:01.00]First things first\n[00:04.50]I\'ma say all the words',
      },
    ],
  }));
  const svc = createLyricsService({ config, logger: createSilentLogger(), fetcher });
  const result = await svc.getLyrics({ title: 'Believer' });
  assert.equal(result.found, true);
  assert.ok(!result.lyrics.includes('['));
  assert.match(result.lyrics, /First things first/);
});

test('returns found:false when the API has no results', async () => {
  const fetcher = fakeFetcher(async () => ({ data: [] }));
  const svc = createLyricsService({ config, logger: createSilentLogger(), fetcher });
  const result = await svc.getLyrics({ title: 'zzzznonexistent' });
  assert.equal(result.found, false);
});

test('returns found:false on 404', async () => {
  const fetcher = fakeFetcher(async () => {
    const err = new Error('Not found');
    err.response = { status: 404 };
    throw err;
  });
  const svc = createLyricsService({ config, logger: createSilentLogger(), fetcher });
  const result = await svc.getLyrics({ title: 'missing' });
  assert.equal(result.found, false);
});

test('thrown API errors are wrapped', async () => {
  const fetcher = fakeFetcher(async () => {
    throw new Error('network down');
  });
  const svc = createLyricsService({ config, logger: createSilentLogger(), fetcher });
  await assert.rejects(() => svc.getLyrics({ title: 'x' }), /Lyrics service is unavailable/);
});

test('retries once on 5xx then succeeds', async () => {
  let calls = 0;
  const fetcher = fakeFetcher(async () => {
    calls += 1;
    if (calls === 1) {
      const err = new Error('Server error');
      err.response = { status: 500 };
      throw err;
    }
    return { data: [{ trackName: 'T', artistName: 'A', plainLyrics: 'hello' }] };
  });
  const svc = createLyricsService({ config, logger: createSilentLogger(), fetcher });
  const result = await svc.getLyrics({ title: 'T' });
  assert.equal(result.found, true);
  assert.equal(calls, 2);
});

test('sanitizes control characters from lyrics', async () => {
  const fetcher = fakeFetcher(async () => ({
    data: [{ trackName: 'T', artistName: 'A', plainLyrics: 'line1\x00line2\x1f' }],
  }));
  const svc = createLyricsService({ config, logger: createSilentLogger(), fetcher });
  const result = await svc.getLyrics({ title: 'T' });
  assert.ok(!result.lyrics.includes('\x00'));
  assert.ok(!result.lyrics.includes('\x1f'));
});