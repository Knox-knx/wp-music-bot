import { BotError } from '../../utils/errors.js';

export default {
  name: 'adinterval',
  aliases: [],
  description: 'Set the ad interval (2-5 per day).',
  usage: '!adinterval <2-5>',
  example: '!adinterval 3',
  category: 'Admin',
  adminOnly: true,
  groupOnly: false,
  minArgs: 1,
  async execute(ctx) {
    try {
      const adService = ctx.services.ad ?? ctx.services.adService;
      const n = Number(ctx.parsed.argList[0]);
      await adService.setInterval(n);
      await ctx.reply(`✅ Ad interval set to ${n} per day.`);
    } catch (err) {
      if (err instanceof BotError) {
        await ctx.reply(`⚠️ ${err.message}`);
      } else {
        await ctx.reply('⚠️ Failed to set ad interval.');
        ctx.services.logger?.error({ err }, 'adinterval command failed');
      }
    }
  },
};