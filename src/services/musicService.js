// codes by: @LouisPy
import fs from 'node:fs';
import pLimit from 'p-limit';
import wweb from 'whatsapp-web.js';
import {
  BotError,
  NoResultsError,
  TooLongError,
} from '../utils/errors.js';
import { formatDuration } from '../utils/formatter.js';

const { MessageMedia } = wweb;

const AUDIO_RETENTION_MS = 2 * 60 * 1000;

export function createMusicService({ config, logger, audioService, db }) {
  const limit = pLimit(config.downloadConcurrency);
  const pendingDeletions = new Map();

  function scheduleDeletion(filePath) {
    const existing = pendingDeletions.get(filePath);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      pendingDeletions.delete(filePath);
      try {
        fs.unlinkSync(filePath);
        logger.info({ filePath }, 'audio auto-deleted after retention period');
      } catch {
        /* already gone */
      }
    }, AUDIO_RETENTION_MS);
    timer.unref();
    pendingDeletions.set(filePath, timer);
  }

  function stopCleanup() {
    for (const timer of pendingDeletions.values()) clearTimeout(timer);
    pendingDeletions.clear();
  }

  async function handleSongRequest({ client, chatId, query, notify }) {
    const trimmed = query.trim();
    if (!trimmed) throw new BotError('Please provide a song name.');

    const safeNotify = async (text) => {
      if (typeof notify !== 'function') return;
      try {
        await notify(text);
      } catch (err) {
        logger.warn({ err, chatId }, 'song progress notification failed; continuing');
      }
    };

    await limit(async () => {
      await safeNotify('🔎 Searching for the track...');
      const results = await audioService.search(trimmed);
      const best = audioService.pickBest(results);
      if (!best) {
        const anyLong = results.some((r) => Number.isFinite(r.duration) && r.duration > config.maxAudioDurationSeconds);
        if (anyLong) throw new TooLongError();
        throw new NoResultsError();
      }

      await safeNotify(
        [
          '🎵 Song Found',
          '',
          `Title: ${best.title}`,
          `Artist/Channel: ${best.channel}`,
          `Duration: ${formatDuration(best.duration)}`,
          'Source: YouTube',
          '',
          '⬇️ Downloading...',
        ].join('\n')
      );

      const { filePath } = await audioService.downloadAndConvert(best.id);

      try {
        await sendAudio(client, chatId, filePath, best);
      } finally {
        scheduleDeletion(filePath);
      }
      try {
        db?.incrementSetting('songs_processed');
      } catch (err) {
        logger.warn({ err }, 'failed to increment songs_processed; continuing');
      }
      logger.info({ chatId, query: trimmed }, 'audio sent');
    });
  }

  async function sendAudio(client, chatId, filePath, meta) {
    if (!filePath || !fs.existsSync(filePath)) {
      throw new BotError('The downloaded audio file is missing. Please try again.', {
        kind: 'audio_missing',
      });
    }
    let media;
    try {
      media = MessageMedia.fromFilePath(filePath);
    } catch (err) {
      throw new BotError('Could not prepare the audio file. Please try again.', {
        kind: 'audio_prepare_failed',
        cause: err,
      });
    }
    const caption = meta
      ? `🎵 ${meta.title}\n👤 ${meta.channel}\n⏱️ ${formatDuration(meta.duration)}`
      : undefined;
    try {
      await client.sendMessage(chatId, media, { caption, sendAudioAsVoice: false });
    } catch (err) {
      throw new BotError('Failed to send the audio on WhatsApp. Please try again later.', {
        kind: 'audio_send_failed',
        cause: err,
      });
    }
  }

  return {
    handleSongRequest,
    stopCleanup,
  };
}