import { BotError } from '../utils/errors.js';
import { createSeededRandom, hashString } from '../utils/random.js';
import { isValidAdInterval } from '../utils/validators.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export function formatLocalDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function dayStartMs(dateStr) {
  return new Date(`${dateStr}T00:00:00`).getTime();
}

export function slotSendAt(dateStr, slot, count) {
  const start = dayStartMs(dateStr);
  const windowSize = DAY_MS / count;
  const lo = start + slot * windowSize;
  const hi = lo + windowSize - 60_000;
  const rand = createSeededRandom(hashString(`${dateStr}:${slot}`));
  return Math.floor(lo + rand() * (hi - lo));
}

export function createSchedule(dateStr, count) {
  const slots = [];
  for (let slot = 0; slot < count; slot += 1) {
    slots.push({ playDate: dateStr, slot, sendAt: slotSendAt(dateStr, slot, count) });
  }
  return slots;
}

export function validateInterval(n) {
  if (!isValidAdInterval(n)) {
    throw new BotError('Ad interval must be a whole number between 2 and 5.');
  }
  return n;
}

export function createAdService({ config, logger, db }) {
  function getAdConfig() {
    const ad = db.getAdvertisement();
    if (!ad) {
      return {
        message: null,
        enabled: config.ads.enabled,
        timesPerDay: config.ads.defaultPerDay,
      };
    }
    return {
      message: ad.message,
      enabled: Boolean(ad.enabled),
      timesPerDay: Number(ad.times_per_day),
    };
  }

  function saveAd({ message, createdBy }) {
    const cleaned = String(message ?? '').trim().slice(0, config.ads.maxMessageLength);
    if (!cleaned) {
      throw new BotError('Advertisement message cannot be empty.');
    }
    const current = db.getAdInterval();
    db.saveAdvertisement({ message: cleaned, timesPerDay: current, createdBy });
    logger.info({ createdBy }, 'advertisement content saved');
    return cleaned;
  }

  function setInterval(value) {
    const n = validateInterval(value);
    db.setAdInterval(n);
    logger.info({ timesPerDay: n }, 'advertisement interval updated');
  }

  function setEnabled(enabled) {
    db.setAdEnabled(enabled);
    logger.info({ enabled }, 'advertisements set enabled');
  }

  function isEnabled() {
    return db.getAdsEnabled();
  }

  function ensureDailySchedule(dateStr = formatLocalDate(new Date())) {
    const count = getAdConfig().timesPerDay;
    if (!db.hasCompleteSchedule(dateStr, count)) {
      const slots = createSchedule(dateStr, count);
      for (const slot of slots) {
        db.insertScheduleSlot(slot.playDate, slot.slot, slot.sendAt);
      }
      logger.info({ dateStr, count }, 'daily ad schedule ensured');
    }
    return db.getScheduleSlots(dateStr);
  }

  function countSentToday(dateStr = formatLocalDate(new Date())) {
    const start = dayStartMs(dateStr);
    return db.countAdsSentOnDay(start, start + DAY_MS);
  }

  function getDueSlots(dateStr, nowTimestamp) {
    return db.getDueSlots(dateStr, nowTimestamp);
  }

  function claimSlot(slot) {
    const result = db.claimSlot(slot.id);
    return result.claimed;
  }

  function completeSlot(slot, results) {
    const byStatus = results.reduce(
      (acc, r) => {
        acc[r.status === 'sent' ? 'sent' : 'failed'] += 1;
        return acc;
      },
      { sent: 0, failed: 0 }
    );
    db.updateDelivery(slot.id, byStatus.failed === 0 ? 'sent' : 'partial', null);
    if (byStatus.failed === 0) {
      db.markSlotDelivered(slot.id);
    } else {
      db.recordDelivery({ scheduleId: slot.id, groupId: null, status: 'failed', error: null });
    }
    logger.info(
      { slotId: slot.id, sent: byStatus.sent, failed: byStatus.failed },
      'advertising slot sent'
    );
  }

  function getActiveGroups() {
    return db.getActiveAdGroups();
  }

  return {
    getAdConfig,
    saveAd,
    setInterval,
    setEnabled,
    isEnabled,
    ensureDailySchedule,
    countSentToday,
    getDueSlots,
    claimSlot,
    completeSlot,
    getActiveGroups,
  };
}