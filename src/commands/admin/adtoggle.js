export default {
  name: 'adtoggle',
  aliases: [],
  description: 'Toggle advertisements on/off.',
  usage: '!adtoggle',
  example: '!adtoggle',
  category: 'Admin',
  adminOnly: true,
  groupOnly: false,
  minArgs: 0,
  async execute(ctx) {
    try {
      const adService = ctx.services.ad ?? ctx.services.adService;
      const current = await adService.isEnabled();
      await adService.setEnabled(!current);
      await ctx.reply(`✅ Advertisements ${!current ? 'enabled' : 'disabled'}.`);
    } catch (err) {
      await ctx.reply('⚠️ Failed to toggle advertisements.');
      ctx.services.logger?.error({ err }, 'adtoggle command failed');
    }
  },
};