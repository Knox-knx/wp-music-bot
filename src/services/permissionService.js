// codes by: @LouisPy
import { normalizeNumberId, normalizeWhatsAppNumber } from '../utils/validators.js';

const CACHE_TTL_MS = 30_000;
const LID_CACHE_TTL_MS = 60 * 60 * 1000;

export function createPermissionService({ config, getChat, logger, resolveWidNumber = null }) {
  const owners = new Set(config.ownerNumbers.map(normalizeWhatsAppNumber));
  const admins = new Set(config.adminNumbers.map(normalizeWhatsAppNumber));
  const chatCache = new Map();
  const lidCache = new Map();

  function isOwnerId(serializedId) {
    return owners.has(normalizeWhatsAppNumber(serializedId));
  }

  function isConfiguredAdminId(serializedId) {
    return admins.has(normalizeWhatsAppNumber(serializedId));
  }

  async function resolveLidToOwner(serializedId) {
    const canon = normalizeWhatsAppNumber(serializedId);
    if (!canon) return false;
    const cached = lidCache.get(canon);
    if (cached && Date.now() - cached.ts < LID_CACHE_TTL_MS) {
      return cached.isOwner;
    }
    let isOwner = false;
    if (typeof resolveWidNumber === 'function') {
      try {
        const pn = await resolveWidNumber(serializedId);
        if (pn) isOwner = owners.has(normalizeWhatsAppNumber(pn));
      } catch (err) {
        logger?.debug({ err }, 'lid to phone number resolution failed');
      }
    }
    lidCache.set(canon, { ts: Date.now(), isOwner });
    return isOwner;
  }

  async function isOwnerIdAsync(serializedId) {
    if (isOwnerId(serializedId)) return true;
    if (String(serializedId).toLowerCase().endsWith('@lid')) {
      return resolveLidToOwner(serializedId);
    }
    return false;
  }

  async function getChatAndCache(chatId) {
    const cached = chatCache.get(chatId);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached;
    let chat = null;
    try {
      chat = await getChat(chatId);
    } catch (err) {
      logger?.warn({ err, chatId }, 'chat lookup failed; group metadata unavailable');
    }
    const participants = Array.isArray(chat?.participants) ? chat.participants : [];
    const entry = {
      ts: Date.now(),
      chat,
      unavailable: !chat,
      adminIds: new Set(
        participants
          .filter((p) => p.isAdmin)
          .map((p) => p.id?._serialized || p.id)
      ),
      participantIds: new Set(participants.map((p) => normalizeNumberId(p.id?._serialized || p.id))),
    };
    chatCache.set(chatId, entry);
    return entry;
  }

  function invalidateChat(chatId) {
    chatCache.delete(chatId);
  }

  async function isGroupAdmin(chatId, serializedId) {
    const entry = await getChatAndCache(chatId);
    return entry.adminIds.has(serializedId);
  }

  function isParticipant(chatId, userId) {
    const entry = chatCache.get(chatId);
    if (!entry) return null;
    return entry.participantIds.has(normalizeNumberId(userId));
  }

  async function isBotGroupAdmin(chatId, botWid) {
    if (!botWid) return false;
    const entry = await getChatAndCache(chatId);
    return entry.adminIds.has(String(botWid));
  }

  async function getLevel(chatId, serializedId) {
    if (await isOwnerIdAsync(serializedId)) return 'OWNER';
    if (isConfiguredAdminId(serializedId)) return 'ADMIN';
    if (chatId && (await isGroupAdmin(chatId, serializedId))) return 'GROUP_ADMIN';
    return 'USER';
  }

  async function canManage({ chatId, senderId, isGroup }) {
    if ((await isOwnerIdAsync(senderId)) || isConfiguredAdminId(senderId)) {
      return { ok: true, reason: null };
    }
    if (!isGroup) {
      return {
        ok: false,
        reason: 'This command requires administrator privileges. Only configured admins can use it here.',
      };
    }
    const entry = await getChatAndCache(chatId);
    if (entry.unavailable) {
      return {
        ok: false,
        reason:
          'Group information is temporarily unavailable on WhatsApp. Please try again in a few moments.',
      };
    }
    if (!entry.adminIds.has(senderId)) {
      return {
        ok: false,
        reason: 'You need to be a group admin (or configured as a bot admin) to use this command.',
      };
    }
    return { ok: true, reason: null };
  }

  async function canModerate({ chatId, senderId, isGroup, botWid }) {
    const manage = await canManage({ chatId, senderId, isGroup });
    if (!manage.ok) return manage;
    if (!isGroup) {
      return { ok: false, reason: 'Moderation commands only work inside groups.' };
    }
    try {
      const botAdmin = await isBotGroupAdmin(chatId, botWid);
      if (!botAdmin) {
        return {
          ok: false,
          reason: 'The bot needs administrator privileges in this group to moderate.',
        };
      }
    } catch (err) {
      logger?.warn({ err, chatId }, 'Failed to fetch group admin state');
      return {
        ok: false,
        reason: 'Could not verify bot permission state for this group. Try again later.',
      };
    }
    return { ok: true, reason: null };
  }

  return {
    isOwnerId,
    isOwnerIdAsync,
    isConfiguredAdminId,
    isGroupAdmin,
    isBotGroupAdmin,
    isParticipant,
    getLevel,
    canManage,
    canModerate,
    invalidateChat,
  };
}