// codes by: @LouisPy
export default {
  name: 'adgroups',
  aliases: [],
  description: 'Show ad groups.',
  usage: '!adgroups',
  example: '!adgroups',
  category: 'Admin',
  adminOnly: true,
  groupOnly: false,
  minArgs: 0,
  async execute(ctx) {
    try {
      const adService = ctx.services.ad ?? ctx.services.adService;
      const groups = await adService.getActiveGroups();
      if (groups.length === 0) {
        await ctx.reply('No active ad groups.');
        return;
      }
      const lines = groups.map((g) => `🔹 ${g.name} (${g.id.slice(0, 8)}...)`).join('\n');
      await ctx.reply(`📢 Active ad groups:\n${lines}`);
    } catch (err) {
      ctx.services.logger?.error({ err }, 'adgroups command failed');
      await ctx.reply('⚠️ Failed to get ad groups.');
    }
  },
};