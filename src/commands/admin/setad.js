// codes by: @LouisPy
import { BotError } from '../../utils/errors.js';

export default {
  name: 'setad',
  aliases: [],
  description: 'Set the advertisement message.',
  usage: '!setad <message>',
  example: '!setad Hello welcome to our group!',
  category: 'Admin',
  adminOnly: true,
  groupOnly: false,
  minArgs: 1,
  async execute(ctx) {
    try {
      const adService = ctx.services.ad ?? ctx.services.adService;
      const cleaned = await adService.saveAd({
        message: ctx.parsed.argList.join(' '),
        createdBy: ctx.message?.from,
      });
      await ctx.reply(`✅ Advertisement set: "${cleaned}"`);
    } catch (err) {
      if (err instanceof BotError) {
        await ctx.reply(`⚠️ ${err.message}`);
      } else {
        await ctx.reply('⚠️ Failed to set advertisement.');
        ctx.services.logger?.error({ err }, 'setad command failed');
      }
    }
  },
};