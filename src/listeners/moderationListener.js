export function createModerationListener({ db, permission, logger }) {
  async function handleMessage(chat, message, botWid) {
    if (!chat?.isGroup) return false;
    const chatId = chat.id._serialized;
    const senderId = message.author ?? message.from;
    if (!senderId) return false;
    if (!db.isMuted(chatId, senderId)) return false;

    let deleted = false;
    try {
      const botAdmin = await permission.isBotGroupAdmin(chatId, botWid);
      if (botAdmin && typeof message.delete === 'function') {
        await message.delete(true);
        deleted = true;
      }
    } catch (err) {
      logger.warn({ err, chatId, senderId }, 'failed to delete muted user message');
    }

    db.logModeration({
      action: deleted ? 'muted_message_deleted' : 'muted_message_blocked',
      groupId: chatId,
      userId: senderId,
      detail: deleted ? 'deleted' : 'delete unsupported',
    });
    db.incrementSetting('muted_deletions');
    logger.info({ chatId, senderId, deleted }, 'muted user message handled');
    return true;
  }

  return { handleMessage };
}