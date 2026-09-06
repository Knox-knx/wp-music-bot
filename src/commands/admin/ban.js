// codes by: @LouisPy
import { resolveTarget } from './helpers.js';
import { normalizeWhatsAppNumber } from '../../utils/validators.js';

export default {
  name: 'ban',
  aliases: [],
  description: 'Ban a user from the bot.',
  usage: '!ban <user>',
  example: '!ban @user',
  category: 'Admin',
  adminOnly: true,
  groupOnly: false,
  minArgs: 1,
  async execute(ctx) {
    const mention = resolveTarget(ctx) ?? ctx.message?.mentionedIds?.[0] ?? null;
    const raw = mention ?? ctx.parsed.argList[0];
    const userId = normalizeWhatsAppNumber(raw);
    if (!userId) {
      await ctx.reply('⚠️ Please mention a user to ban.');
      return;
    }
    try {
      ctx.services.db.banUser(ctx.chatId, userId, ctx.senderId);
    } catch (err) {
      await ctx.reply('⚠️ Failed to ban user.');
      ctx.services.logger?.error({ err }, 'ban command failed');
      return;
    }
    // Best effort: also remove the user from the group when we can.
    if (ctx.isGroup) {
      try {
        const chat = await ctx.client.getChatById(ctx.chatId);
        await chat.removeParticipants([mention ?? `${userId}@c.us`]);
      } catch (err) {
        ctx.services.logger?.warn({ err, chatId: ctx.chatId }, 'ban: group removal unavailable');
        await ctx.reply(
          `⛔ User ${userId} banned, but group information is temporarily unavailable so they could not be removed right now.`
        );
        return;
      }
    }
    await ctx.reply(`✅ User ${userId} banned and removed.`);
  },
};
