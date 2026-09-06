import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  BotError,
  SearchError,
  TooLargeError,
  FfmpegUnavailableError,
  ConvertError,
} from '../utils/errors.js';

const execFileAsync = promisify(execFile);

let ytDlpImpl = null;

async function getYtDlp() {
  if (ytDlpImpl) return ytDlpImpl;
  try {
    const mod = await import('yt-dlp-exec');
    if (typeof mod.ytDlp === 'function') ytDlpImpl = mod.ytDlp;
    else if (typeof mod.default === 'function') ytDlpImpl = mod.default;
    else ytDlpImpl = mod.default?.ytDlp ?? mod;
  } catch (err) {
    throw new BotError('yt-dlp is not installed correctly on this server.', {
      kind: 'ytdlp_unavailable',
      userFacing: false,
      cause: err,
    });
  }
  return ytDlpImpl;
}

export function normalizeSearchResult(entry) {
  const title = (entry.title ?? 'Unknown').trim();
  const duration = Number(entry.duration) || null;
  return {
    id: String(entry.id || entry.display_id || ''),
    title,
    channel: String(entry.channel || entry.uploader || entry.artist || 'Unknown').trim(),
    duration,
    url: entry.webpage_url || `https://www.youtube.com/watch?v=${entry.id}`,
    live: Boolean(entry.live_status && entry.live_status !== 'is_upcoming' && entry.live_status !== 'not_live'),
  };
}

export function pickBestResult(results, maxDurationSeconds) {
  const candidates = results.filter((r) => {
    if (!Number.isFinite(r.duration) || r.duration <= 0) return false;
    if (r.duration > maxDurationSeconds) return false;
    return true;
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.live !== b.live) return a.live ? 1 : -1;
    return a.duration - b.duration;
  });
  return candidates[0];
}

const searchCache = new Map();
const SEARCH_CACHE_TTL = 10 * 60 * 1000;

function toParsedJson(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
}

function extractEntriesFromRaw(raw) {
  const parsed = toParsedJson(raw);
  if (!parsed) return [];
  const entries = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.entries)
      ? parsed.entries
      : [];
  return entries.map(normalizeSearchResult).filter((r) => r.id);
}

function cacheSearch(cacheKey, results, now) {
  searchCache.set(cacheKey, { results, ts: now });
  if (searchCache.size > 200) {
    const firstKey = searchCache.keys().next().value;
    searchCache.delete(firstKey);
  }
}

export function createAudioService({ config, logger }) {
  const downloadsDir = path.join(config.tmpDir, 'downloads');
  const convertedDir = path.join(config.tmpDir, 'converted');

  let ffmpegChecked = false;

  async function assertFfmpeg() {
    if (ffmpegChecked) return true;
    try {
      await execFileAsync('ffmpeg', ['-version'], { timeout: 5_000 });
      ffmpegChecked = true;
      return true;
    } catch {
      throw new FfmpegUnavailableError();
    }
  }

  function uniqueBase(prefix) {
    return `${prefix}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`;
  }

  async function search(query, limit = config.searchResults) {
    const cacheKey = `${query}:${limit}`;
    const cached = searchCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.ts < SEARCH_CACHE_TTL) {
      return cached.results;
    }
    const ytDlp = await getYtDlp();
    let raw;
    try {
      raw = await ytDlp(
        `ytsearch${Math.max(1, Math.min(10, limit))}:${query.slice(0, 400)}`,
        {
          dumpSingleJson: true,
          skipDownload: true,
          noPlaylist: true,
          quiet: true,
          noWarnings: true,
          // Without this, ONE unavailable/private video in the result set
          // makes yt-dlp exit(1) and the whole search fails with no audio.
          ignoreErrors: true,
          socketTimeout: 30,
          addHeader: [
            'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer: https://www.youtube.com/',
          ],
          // NOTE: yt-dlp sleep values are in SECONDS (not ms).
          sleepInterval: 1,
        },
        { timeout: Math.min(config.downloadTimeoutMs, 60_000) }
      );
    } catch (err) {
      // yt-dlp may still print a usable JSON payload on stdout even when it
      // exits non-zero (e.g. one entry errored). Salvage entries when possible.
      const salvaged = extractEntriesFromRaw(err?.stdout) ?? extractEntriesFromRaw(err?.output);
      if (salvaged && salvaged.length > 0) {
        logger?.warn({ query }, 'yt-dlp search exited non-zero; using partial results');
        cacheSearch(cacheKey, salvaged, now);
        return salvaged;
      }
      throw new SearchError(null, err);
    }
    const results = extractEntriesFromRaw(raw);
    cacheSearch(cacheKey, results, now);
    return results;
  }

  async function downloadAndConvert(videoId, { _maxRetries = 0 } = {}) {
    await assertFfmpeg();
    if (!/^[A-Za-z0-9_-]{5,40}$/.test(String(videoId))) {
      throw new ConvertError('Invalid video identifier.');
    }
    fs.mkdirSync(downloadsDir, { recursive: true });
    fs.mkdirSync(convertedDir, { recursive: true });
    const ytDlp = await getYtDlp();
    const base = uniqueBase(videoId);
    const outPattern = path.join(downloadsDir, `${base}.%(ext)s`);
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const baseOptions = {
      extractAudio: true,
      audioFormat: 'mp3',
      audioQuality: 0,
      noPlaylist: true,
      quiet: true,
      noWarnings: true,
      output: outPattern,
      retries: 3,
      // NOTE: yt-dlp sleep values are in SECONDS. 1000 here used to make
      // every download sleep ~16 minutes and always hit the timeout,
      // so no audio was ever sent.
      sleepInterval: 1,
      concatPlaylist: 'never',
      jsRuntimes: 'node',
      addHeader: [
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer: https://www.youtube.com/',
      ],
      socketTimeout: 30,
    };
    // YouTube frequently 403s the default (web) media hosts for server IPs.
    // Retry with the android player client, which serves from hosts that
    // accept plain downloads (verified: default 403 -> android OK).
    const optionAttempts = [
      baseOptions,
      { ...baseOptions, extractorArgs: 'youtube:player_client=android' },
    ];

    let downloaded = false;
    let lastErr = null;
    for (const options of optionAttempts) {
      try {
        await ytDlp(videoUrl, options, {
          timeout: Math.min(config.downloadTimeoutMs, 120_000),
        });
        downloaded = true;
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        cleanupPartial(base);
        logger?.warn(
          { videoId, playerClient: options.extractorArgs ?? 'default' },
          'audio download attempt failed; trying next player client'
        );
      }
    }
    if (!downloaded) {
      cleanupPartial(base);
      throw new ConvertError(undefined, lastErr);
    }

    try {
      const produced = fs
        .readdirSync(downloadsDir)
        .filter((f) => f.startsWith(`${base}.`))
        .map((f) => path.join(downloadsDir, f));
      if (produced.length === 0) {
        throw new BotError('Download produced no output file.', {
          kind: 'download_produced_nothing',
          userFacing: false,
        });
      }
      const source = produced.find((p) => p.endsWith('.mp3')) ?? produced[0];
      const size = fs.statSync(source).size;
      if (size > config.maxAudioBytes) {
        fs.unlinkSync(source);
        throw new TooLargeError();
      }
      const target = path.join(convertedDir, `${base}.mp3`);
      fs.renameSync(source, target);
      cleanupPartial(base);
      logger.info({ bytes: size, videoId }, 'audio converted');
      return { filePath: target, sizeBytes: size };
    } catch (err) {
      cleanupPartial(base);
      if (err instanceof TooLargeError) throw err;
      if (err instanceof BotError) throw err;
      throw new ConvertError(undefined, err);
    }
  }

  function cleanupPartial(base) {
    try {
      for (const f of fs.readdirSync(downloadsDir)) {
        if (f.startsWith(`${base}.`)) fs.unlinkSync(path.join(downloadsDir, f));
      }
    } catch {
      /* best effort */
    }
  }

  function removeFile(filePath) {
    try {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
      logger?.warn({ err }, 'Failed to remove temporary audio file');
    }
  }

  return {
    search,
    pickBest: (results) => pickBestResult(results, config.maxAudioDurationSeconds),
    downloadAndConvert,
    removeFile,
    dirs: { downloadsDir, convertedDir },
  };
}