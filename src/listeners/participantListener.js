const MAX_ATTEMPTS = 3;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function normalizeNotification(notification) {
  const chatId = notification?.chatId ?? notification?.id?.remote ?? null;
  const affected = Array.isArray(notification?.recipientIds)
    ? notification.recipientIds
    : [];
  const single = notification?.id?.participant
    ? [notification.id.participant]
    : [];
  const participants = [...new Set([...affected, ...single])].filter(Boolean);
  const author = notification?.author ?? null;
  return { chatId, participants, author };
}

export function createParticipantListener({ db, logger }) {
  async function removeParticipant(client, chatId, userId) {
    let lastErr = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const chat = await client.getChatById(chatId);
        await chat.removeParticipants([userId]);
        return { removed: true };
      } catch (err) {
        lastErr = err;
        if (attempt < MAX_ATTEMPTS) await sleep(1000 * 2 ** (attempt - 1));
      }
    }
    return { removed: false, error: lastErr };
  }

  async function handleGroupJoin(client, notification, botWid) {
    const { chatId, participants } = normalizeNotification(notification);
    if (!chatId || participants.length === 0) return;
    db.upsertGroup(chatId);

    for (const userId of participants) {
      try {
        if (String(userId) === String(botWid)) continue;
        const bannedGroups = db.isBannedAnywhere(userId);
        if (!bannedGroups.includes(chatId)) continue;
        db.logModeration({
          action: 'banned_user_rejoin_attempt',
          groupId: chatId,
          userId,
          detail: 'attempted to rejoin banned group',
        });
        logger.warn({ chatId, userId }, 'banned user attempted to rejoin');

        const result = await removeParticipant(client, chatId, userId);
        if (result.removed) {
          db.logModeration({
            action: 'banned_user_removed',
            groupId: chatId,
            userId,
            detail: 'auto-removed on rejoin',
          });
          db.incrementSetting('banned_rejoins_handled');
          logger.info({ chatId, userId }, 'banned user removed after rejoin');
        } else {
          db.logModeration({
            action: 'banned_user_removal_failed',
            groupId: chatId,
            userId,
            detail: String(result.error?.message ?? result.error).slice(0, 500),
          });
          logger.warn({ chatId, userId, err: result.error }, 'failed to remove banned user');
        }
      } catch (err) {
        logger.warn({ err, chatId, userId }, 'error handling banned rejoin participant');
      }
    }
  }

  async function handleGroupLeave(notification, botWid) {
    const { chatId, participants, author } = normalizeNotification(notification);
    if (!chatId) return;
    const botLeft =
      participants.some((p) => String(p) === String(botWid)) ||
      (participants.length === 0 && author && String(author) === String(botWid));
    if (!botLeft) return;
    db.markGroupInactive(chatId);
    db.logModeration({ action: 'bot_left_group', groupId: chatId });
    logger.info({ chatId }, 'bot left a group; marked inactive');
  }

  async function handleGroupUpdate(client, notification) {
    const { chatId } = normalizeNotification(notification);
    if (!chatId) return;
    try {
      const chat = await client.getChatById(chatId);
      db.upsertGroup(chatId, chat.name ?? null);
    } catch (err) {
      logger.warn({ err, chatId }, 'group_update: could not fetch chat for name sync');
      db.upsertGroup(chatId, null);
    }
  }

  return { handleGroupJoin, handleGroupLeave, handleGroupUpdate };
}