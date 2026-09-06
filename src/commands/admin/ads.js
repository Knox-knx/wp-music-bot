export default {
  name: 'ads',
  aliases: [],
  description: 'Show ad status.',
  usage: '!ads',
  example: '!ads',
  category: 'Admin',
  adminOnly: true,
  groupOnly: false,
  minArgs: 0,
  async execute(ctx) {
    try {
      const adService = ctx.services.ad ?? ctx.services.adService;
      const config = await adService.getAdConfig();
      const enabled = await adService.isEnabled();
      await ctx.reply(
        `📢 Advertisements ${enabled ? 'enabled' : 'disabled'}\nMessage: ${config.message ? '(set)' : '(not set)'}\nTimes per day: ${config.timesPerDay}`
      );
    } catch (err) {
      await ctx.reply('⚠️ Failed to get ad status.');
      ctx.services.logger?.error({ err }, 'ads command failed');
    }
  },
};