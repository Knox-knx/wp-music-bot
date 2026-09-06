// codes by: @LouisPy
const SETTING_PREFIX = 'antispam_';

export function createAntiSpamService({
  config,
  logger,
  db,
  now = () => Date.now(),
  actions = null,
}) {
  const tracker = new Map();
  const windowMs = config.antispam.windowSeconds * 1000;
  const maxTrackedMessages = config.antispam.maxMessages + 3;
  let cleanupTimer = null;

  function keyFor(chatId, userId) {
    return `${chatId}:${userId}`;
  }

  function isEnabledForGroup(chatId) {
    const raw = db.getSetting(`${SETTING_PREFIX}${chatId}`, null);
    if (raw === null) return config.antispam.enabled;
    return raw === '1' || raw === 'true';
  }

  function pushMessage(chatId, userId, ts, message) {
    const key = keyFor(chatId, userId);
    let entry = tracker.get(key);
    if (!entry) {
      entry = { times: [], messages: [], lastActionAt: 0 };
      tracker.set(key, entry);
    }
    entry.times.push(ts);
    entry.times = entry.times.filter((t) => ts - t <= windowMs);
    entry.messages.push(message);
    entry.messages = entry.messages.slice(-maxTrackedMessages);
    return entry;
  }

  function cooldownActive(entry, ts) {
    return entry.lastActionAt > 0 && ts - entry.lastActionAt < windowMs;
  }

  async function deleteMessages(messages) {
    const unique = new Map();
    for (const message of messages) {
      if (!message?.delete) continue;
      const id = message.id?.id || message;
      if (!unique.has(id)) unique.set(id, message);
    }
    const results = await Promise.allSettled(
      [...unique.values()].map((m) => m.delete(true))
    );
    return results.filter((r) => r.status === 'fulfilled').length;
  }

  async function handleSpam({ chatId, userId, entry, message, ts, isBotAdmin }) {
    const action = config.antispam.action;
    entry.lastActionAt = ts;
    db.incrementSetting('antispam_actions');
    db.logModeration({ action: 'antispam', groupId: chatId, userId, detail: action });
    logger.warn({ chatId, userId, action }, 'anti-spam triggered');

    const base = { detected: true, action };
    let consumed = false;

    if (action === 'delete' || action === 'mute') {
      if (isBotAdmin) {
        const deleted = await deleteMessages([...entry.messages, message]);
        if (deleted > 0) consumed = true;
      }
      entry.messages = [];
      if (action === 'mute') {
        const minutes = Math.max(
          1,
          Math.round(config.antispam.muteSeconds / 60)
        );
        actions?.onMute?.(chatId, userId, config.antispam.muteSeconds);
        return {
          ...base,
          consumed,
          notify: `🔇 Temporarily muted for ${minutes} minute(s) due to spam.`,
        };
      }
      return { ...base, consumed, notify: null };
    }

    if (action === 'warn') {
      return {
        ...base,
        consumed: false,
        notify: '🛑 Please slow down. You are sending messages too quickly.',
      };
    }

    if (action === 'kick') {
      let kicked = false;
      if (actions?.kick) {
        try {
          await actions.kick(chatId, userId);
          kicked = true;
        } catch (err) {
          logger.warn({ err }, 'anti-spam: failed to kick user');
        }
      }
      return {
        ...base,
        consumed: true,
        notify: kicked ? '👢 Removed for spam.' : '⚠️ Spam detected.',
      };
    }

    return { detected: true, action: 'none', consumed: false, notify: null };
  }

  function cleanup() {
    const ts = now();
    for (const [key, entry] of tracker.entries()) {
      const latest = entry.times.length ? entry.times[entry.times.length - 1] : 0;
      if (ts - Math.max(latest, entry.lastActionAt) > windowMs * 2) {
        tracker.delete(key);
      }
    }
    if (tracker.size > 5000) {
      const sorted = [...tracker.entries()].sort((a, b) => {
        const la = a[1].times.length ? a[1].times[a[1].times.length - 1] : 0;
        const lb = b[1].times.length ? b[1].times[b[1].times.length - 1] : 0;
        return la - lb;
      });
      for (const [key] of sorted.slice(0, tracker.size - 5000)) {
        tracker.delete(key);
      }
    }
  }

  function startCleanup() {
    if (cleanupTimer) return;
    cleanupTimer = setInterval(cleanup, 60_000);
    cleanupTimer.unref();
  }

  function stopCleanup() {
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }

  async function check({ chatId, userId, message, isBotAdmin }) {
    if (!isEnabledForGroup(chatId)) return { detected: false, consumed: false };
    const ts = now();
    const entry = pushMessage(chatId, userId, ts, message);
    const count = entry.times.length;
    if (count > config.antispam.maxMessages) {
      if (!cooldownActive(entry, ts)) {
        return handleSpam({ chatId, userId, entry, message, ts, isBotAdmin });
      }
      return { detected: true, consumed: false, action: 'cooldown' };
    }
    return { detected: false, consumed: false, count };
  }

  startCleanup();

  return {
    check,
    isEnabledForGroup,
    stopCleanup,
    _tracker: tracker,
  };
}