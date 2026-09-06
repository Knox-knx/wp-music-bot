// codes by: @LouisPy
export default {
  name: 'adstop',
  aliases: [],
  description: 'Stop sending ads.',
  usage: '!adstop',
  example: '!adstop',
  category: 'Admin',
  adminOnly: true,
  groupOnly: false,
  minArgs: 0,
  async execute(ctx) {
    try {
      ctx.services.adScheduler.stop();
      await ctx.reply('✅ Ad scheduler stopped.');
    } catch (err) {
      await ctx.reply('⚠️ Failed to stop ad scheduler.');
      ctx.services.logger?.error({ err }, 'adstop command failed');
    }
  },
};