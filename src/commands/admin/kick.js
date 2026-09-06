// codes by: @LouisPy
import { resolveTarget } from './helpers.js';
import { normalizeWhatsAppNumber } from '../../utils/validators.js';

export default {
  name: 'kick',
  aliases: [],
  description: 'Kick a user from the group.',
  usage: '!kick @user',
  example: '!kick @user',
  category: 'Moderation',
  adminOnly: true,
  groupOnly: true,
  minArgs: 1,
  async execute(ctx) {
    const mention = resolveTarget(ctx) ?? ctx.message?.mentionedIds?.[0] ?? null;
    const raw = mention ?? ctx.parsed.argList[0];
    const userId = normalizeWhatsAppNumber(raw);
    if (!userId) {
      await ctx.reply('⚠️ Please mention a user to kick.');
      return;
    }
    let chat;
    try {
      chat = await ctx.client.getChatById(ctx.chatId);
    } catch (err) {
      ctx.services.logger?.warn({ err, chatId: ctx.chatId }, 'kick: group lookup failed');
      await ctx.reply(
        '⛔ Group information is temporarily unavailable on WhatsApp. Please try again in a few moments.'
      );
      return;
    }
    try {
      await chat.removeParticipants([mention ?? `${userId}@c.us`]);
      await ctx.reply(`✅ User removed: ${userId}`);
    } catch (err) {
      await ctx.reply('⚠️ Failed to kick user. The bot may need administrator privileges.');
      ctx.services.logger?.error({ err }, 'kick command failed');
    }
  },
};
