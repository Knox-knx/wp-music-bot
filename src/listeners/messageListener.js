// codes by: @LouisPy
import { createMessageContextResolver } from '../utils/messageContext.js';

const chatCache = new Map();
const CHAT_CACHE_TTL = 5 * 60 * 1000;

export function createMessageListener({
  logger,
  db,
  commandManager,
  moderationListener,
  antiSpam,
  permission,
  contextResolver = null,
}) {
  const context = contextResolver ?? createMessageContextResolver({ logger });

  function getCachedChat(client, chatId) {
    const cached = chatCache.get(chatId);
    const now = Date.now();
    if (cached && now - cached.ts < CHAT_CACHE_TTL) {
      return cached.chat;
    }
    return null;
  }

  function setCachedChat(chatId, chat) {
    chatCache.set(chatId, { chat, ts: Date.now() });
    if (chatCache.size > 500) {
      const firstKey = chatCache.keys().next().value;
      chatCache.delete(firstKey);
    }
  }

  async function handleIncomingMessage(client, message) {
    if (message.fromMe) return { status: 'own' };
    if (message.from === 'status@broadcast') return { status: 'status' };

    const msgCtx = context.basic(message);
    if (!msgCtx.chatId) {
      logger.warn({ from: message.from }, 'message without a usable chat id');
      return { status: 'no_chat' };
    }

    try {
      if (msgCtx.senderId) {
        db.upsertUser(msgCtx.senderId, message._data?.pushName ?? null);
      }
    } catch (err) {
      logger.warn({ err, from: message.from }, 'failed to persist user; continuing to command dispatch');
    }

    if (msgCtx.isGroup) {
      try {
        db.upsertGroup(msgCtx.chatId, null);
        let chat = getCachedChat(client, msgCtx.chatId);
        if (!chat) {
          chat = await context.getChat(message);
          if (chat) setCachedChat(msgCtx.chatId, chat);
        }
        if (chat) {
          db.upsertGroup(msgCtx.chatId, chat.name ?? null);
          const botWid = client.info?.wid?._serialized ?? null;
          const handled = await moderationListener.handleMessage(chat, message, botWid);
          if (handled) return { status: 'muted_user_message' };

          let botAdmin = false;
          try {
            botAdmin = await permission.isBotGroupAdmin(msgCtx.chatId, botWid);
          } catch {
            botAdmin = false;
          }
          const spam = await antiSpam.check({
            chatId: msgCtx.chatId,
            userId: msgCtx.senderId,
            message,
            isBotAdmin: botAdmin,
          });
          if (spam.detected) {
            if (spam.notify) {
              await client.sendMessage(msgCtx.chatId, spam.notify).catch(() => {});
            }
            if (spam.consumed) return { status: 'antispam_consumed' };
          }
        } else {
          logger.warn(
            { chatId: msgCtx.chatId },
            'group chat metadata unavailable; skipping moderation and anti-spam for this message'
          );
        }
      } catch (err) {
        logger.warn(
          { err, chatId: msgCtx.chatId },
          'group handling failed; continuing to command dispatch'
        );
      }
    }

    const result = await commandManager.execute({
      message,
      chat: null,
      context: msgCtx,
    });
    return result;
  }

  return { handleIncomingMessage };
}