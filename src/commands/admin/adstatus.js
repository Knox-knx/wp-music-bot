// codes by: @LouisPy
export default {
  name: 'adstatus',
  aliases: [],
  description: 'Show ad scheduler status.',
  usage: '!adstatus',
  example: '!adstatus',
  category: 'Admin',
  adminOnly: true,
  groupOnly: false,
  minArgs: 0,
  async execute(ctx) {
    try {
      const enabled = ctx.services.adScheduler.isEnabled();
      await ctx.reply(`📅 Ad scheduler ${enabled ? 'running' : 'stopped'}`);
    } catch (err) {
      await ctx.reply('⚠️ Failed to get ad scheduler status.');
      ctx.services.logger?.error({ err }, 'adstatus command failed');
    }
  },
};