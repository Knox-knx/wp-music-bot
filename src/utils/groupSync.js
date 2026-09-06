// codes by: @LouisPy
export function createGroupSync({
  getClient,
  db,
  logger,
  shouldContinue = () => true,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  maxAttempts = 5,
  retryBaseMs = 1000,
  initialDelayMs = 0,
}) {
  async function run() {
    if (typeof shouldContinue === 'function' && !shouldContinue()) {
      return { ok: false, attempts: 0, activeGroups: 0 };
    }
    const client = typeof getClient === 'function' ? getClient() : null;
    if (!client) return { ok: false, attempts: 0, activeGroups: 0 };

    // Give WhatsApp Web a moment after 'ready' before touching the
    // Chat collection: the page reports ready while LazyModules are still
    // hydrating, and an immediate getChats() races that load.
    if (initialDelayMs > 0) {
      await sleep(initialDelayMs);
      if (typeof shouldContinue === 'function' && !shouldContinue()) {
        return { ok: false, attempts: 0, activeGroups: 0 };
      }
      if (typeof getClient === 'function' && getClient() !== client) {
        logger?.warn('group sync aborted: client changed during initial delay');
        return { ok: false, attempts: 0, activeGroups: 0, error: new Error('client-changed') };
      }
    }

    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (typeof shouldContinue === 'function' && !shouldContinue()) {
        return { ok: false, attempts: attempt - 1, activeGroups: 0 };
      }
      // Abort if the client was replaced while retrying (e.g. reconnect).
      if (typeof getClient === 'function' && getClient() !== client) {
        logger?.warn('group sync aborted: client changed mid-retry');
        return { ok: false, attempts: attempt - 1, activeGroups: 0, error: new Error('client-changed') };
      }
      try {
        const chats = await client.getChats();
        if (typeof getClient === 'function' && getClient() !== client) {
          logger?.warn('group sync aborted: client changed during fetch');
          return { ok: false, attempts: attempt, activeGroups: 0, error: new Error('client-changed') };
        }
        let activeGroups = 0;
        for (const chat of chats ?? []) {
          if (typeof shouldContinue === 'function' && !shouldContinue()) break;
          if (!chat?.isGroup) continue;
          const id = chat.id?._serialized ?? chat.id;
          if (!id) continue;
          try {
            db.upsertGroup(id, chat.name ?? null);
            activeGroups += 1;
          } catch (err) {
            logger?.warn({ err, chatId: id }, 'group sync upsert failed');
          }
        }
        return { ok: true, attempts: attempt, activeGroups };
      } catch (err) {
        lastErr = err;
        logger?.warn({ err, attempt }, 'group sync attempt failed');
        if (attempt < maxAttempts) {
          await sleep(retryBaseMs * 2 ** (attempt - 1));
        }
      }
    }
    return { ok: false, attempts: maxAttempts, activeGroups: 0, error: lastErr };
  }

  return { run };
}
