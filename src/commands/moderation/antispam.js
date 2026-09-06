// codes by: @LouisPy
export default {
  name: 'antispam',
  aliases: [],
  description: 'Enable, disable or show anti-spam for this group.',
  usage: '!antispam on|off|status',
  example: '!antispam on',
  category: 'Moderation',
  adminOnly: true,
  groupOnly: true,
  minArgs: 1,
  async execute(ctx) {
    const setting = ctx.parsed.argList[0].toLowerCase();
    const key = `antispam_${ctx.chatId}`;
    if (setting === 'on') {
      ctx.services.db.setSetting(key, '1');
      await ctx.reply('🛡️ Anti-spam enabled for this group.');
    } else if (setting === 'off') {
      ctx.services.db.setSetting(key, '0');
      await ctx.reply('🛡️ Anti-spam disabled for this group.');
    } else if (setting === 'status') {
      const enabled = ctx.services.antiSpam.isEnabledForGroup(ctx.chatId);
      await ctx.reply(
        `🛡️ Anti-spam for this group: ${enabled ? 'enabled' : 'disabled'}.\nWindow: ${ctx.config.antispam.windowSeconds}s, limit: ${ctx.config.antispam.maxMessages} messages, action: ${ctx.config.antispam.action}.`
      );
    } else {
      await ctx.reply('Usage:\n!antispam on|off|status');
    }
  },
};