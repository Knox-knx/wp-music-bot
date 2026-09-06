// codes by: @LouisPy
import { resolveTarget } from './helpers.js';
import { normalizeWhatsAppNumber } from '../../utils/validators.js';

export default {
  name: 'mute',
  aliases: [],
  description: 'Mute a user in the group.',
  usage: '!mute @user',
  example: '!mute @user',
  category: 'Moderation',
  adminOnly: true,
  groupOnly: true,
  minArgs: 1,
  async execute(ctx) {
    const mention = resolveTarget(ctx) ?? ctx.message?.mentionedIds?.[0] ?? null;
    const raw = mention ?? ctx.parsed.argList[0];
    const userId = normalizeWhatsAppNumber(raw);
    if (!userId) {
      await ctx.reply('⚠️ Please mention a user to mute.');
      return;
    }
    try {
      ctx.services.db.muteUser(ctx.chatId, userId, ctx.senderId);
      await ctx.reply(`🔇 User ${userId} muted.`);
    } catch (err) {
      await ctx.reply('⚠️ Failed to mute user.');
      ctx.services.logger?.error({ err }, 'mute command failed');
    }
  },
};
