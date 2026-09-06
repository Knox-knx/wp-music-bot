import { formatStats } from '../../utils/formatter.js';

export default {
  name: 'stats',
  aliases: [],
  description: 'Show bot statistics.',
  usage: '!stats',
  example: '!stats',
  category: 'System',
  adminOnly: true,
  groupOnly: false,
  minArgs: 0,
  async execute(ctx) {
    try {
      const stats = ctx.services.db.stats();
      const startedAt = Number(ctx.services.config?.startTime);
      const uptimeSeconds = Number.isFinite(startedAt) ? (Date.now() - startedAt) / 1000 : 0;
      await ctx.reply(formatStats(stats, uptimeSeconds));
    } catch (err) {
      await ctx.reply('⚠️ Failed to get stats.');
      ctx.services.logger?.error({ err }, 'stats command failed');
    }
  },
};