import { resolveTarget } from './helpers.js';
import { normalizeWhatsAppNumber } from '../../utils/validators.js';

export default {
  name: 'unban',
  aliases: [],
  description: 'Unban a user from the bot.',
  usage: '!unban <user>',
  example: '!unban @user',
  category: 'Admin',
  adminOnly: true,
  groupOnly: false,
  minArgs: 1,
  async execute(ctx) {
    const mention = resolveTarget(ctx) ?? ctx.message?.mentionedIds?.[0] ?? null;
    const raw = mention ?? ctx.parsed.argList[0];
    const userId = normalizeWhatsAppNumber(raw);
    if (!userId) {
      await ctx.reply('⚠️ Please mention a user to unban.');
      return;
    }
    try {
      ctx.services.db.unbanUser(ctx.chatId, userId);
      await ctx.reply(`✅ User ${userId} unbanned.`);
    } catch (err) {
      await ctx.reply('⚠️ Failed to unban user.');
      ctx.services.logger?.error({ err }, 'unban command failed');
    }
  },
};
