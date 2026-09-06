// codes by: @LouisPy
import axios from 'axios';
import { LyricsError } from '../utils/errors.js';
import { withRetry } from '../utils/retry.js';

function stripSyncedTimestamps(line) {
  return line.replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, '').trim();
}

function sanitizeLyrics(text, maxChars = 40_000) {
  if (!text) return '';
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .slice(0, maxChars)
    .trim();
}

function convertSyncedToPlain(synced) {
  return synced
    .split('\n')
    .map(stripSyncedTimestamps)
    .filter(String)
    .join('\n');
}

export function createApiFallbackChain() {
  return [
    { name: 'lrclib', url: 'https://lrclib.net/api' },
    { name: 'musixmatch', url: 'https://api.musixmatch.com/ws/1.1' },
  ];
}

export function createLyricsService({ config, logger, fetcher = null }) {
  const http = fetcher ?? axios.create({ timeout: config.lyrics.timeoutMs });

  async function fetchFromApi(path, params) {
    const apiChain = createApiFallbackChain();
    let lastErr = null;

    for (const currentApi of apiChain) {
      try {
        const response = await withRetry(
          () => http.get(`${currentApi.url}${path}`, { params }),
          { maxAttempts: 3, backoffBase: 500, maxDelay: 10_000 }
        );
        return response;
      } catch (err) {
        // "Not found" is a definitive answer, not a reason to try the next provider.
        if (err?.response?.status === 404) throw err;
        lastErr = err;
      }
    }
    throw lastErr instanceof LyricsError ? lastErr : new LyricsError(undefined, lastErr);
  }

  function extractLyrics(entry) {
    if (!entry) return null;
    if (entry.plainLyrics) return entry.plainLyrics;
    if (entry.syncedLyrics) return convertSyncedToPlain(entry.syncedLyrics);
    return null;
  }

  async function getLyrics({ title, artist }) {
    logger.info({ title, artist }, 'lyrics request');
    if (!title) return { found: false };

    let response;
    try {
      response = await fetchFromApi('/search', {
        track_name: title,
        ...(artist ? { artist_name: artist } : {}),
      });
    } catch (err) {
      if (err?.response?.status === 404) return { found: false };
      throw err instanceof LyricsError ? err : new LyricsError(undefined, err);
    }

    if (response.status === 404 || !Array.isArray(response.data)) {
      return { found: false };
    }

    for (const entry of response.data) {
      const lyrics = extractLyrics(entry);
      if (lyrics) {
        return {
          found: true,
          title: entry.trackName || title,
          artist: entry.artistName || artist || 'Unknown',
          lyrics: sanitizeLyrics(lyrics),
        };
      }
    }
    return { found: false };
  }

  return { getLyrics };
}