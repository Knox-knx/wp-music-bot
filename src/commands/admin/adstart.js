export default {
  name: 'adstart',
  aliases: [],
  description: 'Start sending ads.',
  usage: '!adstart',
  example: '!adstart',
  category: 'Admin',
  adminOnly: true,
  groupOnly: false,
  minArgs: 0,
  async execute(ctx) {
    try {
      ctx.services.adScheduler.start();
      await ctx.reply('✅ Ad scheduler started.');
    } catch (err) {
      await ctx.reply('⚠️ Failed to start ad scheduler.');
      ctx.services.logger?.error({ err }, 'adstart command failed');
    }
  },
};