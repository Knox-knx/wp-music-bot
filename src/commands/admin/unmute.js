import { resolveTarget } from './helpers.js';
import { normalizeWhatsAppNumber } from '../../utils/validators.js';

export default {
  name: 'unmute',
  aliases: [],
  description: 'Unmute a user in the group.',
  usage: '!unmute @user',
  example: '!unmute @user',
  category: 'Moderation',
  adminOnly: true,
  groupOnly: true,
  minArgs: 1,
  async execute(ctx) {
    const mention = resolveTarget(ctx) ?? ctx.message?.mentionedIds?.[0] ?? null;
    const raw = mention ?? ctx.parsed.argList[0];
    const userId = normalizeWhatsAppNumber(raw);
    if (!userId) {
      await ctx.reply('⚠️ Please mention a user to unmute.');
      return;
    }
    try {
      ctx.services.db.unmuteUser(ctx.chatId, userId);
      await ctx.reply(`✅ User ${userId} unmuted.`);
    } catch (err) {
      await ctx.reply('⚠️ Failed to unmute user.');
      ctx.services.logger?.error({ err }, 'unmute command failed');
    }
  },
};
