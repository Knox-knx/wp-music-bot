// codes by: @LouisPy
export default {
  name: 'playing',
  aliases: [],
  description: 'Show live playback status.',
  usage: '!playing',
  category: 'Music',
  adminOnly: false,
  groupOnly: false,
  minArgs: 0,
  async execute(ctx) {
    if (!ctx.isGroup) {
      await ctx.reply('⚠️ Live playback is only available in WhatsApp groups.');
      return;
    }
    if (typeof ctx.services.voiceCall?.nowPlaying !== 'function') {
      await ctx.reply('Nothing is currently playing in this group.');
      return;
    }
    try {
      await ctx.services.voiceCall.nowPlaying(ctx.chatId, (text) => ctx.reply(text));
    } catch (err) {
      await ctx.reply('⚠️ Failed to get voice status.');
      ctx.services.logger?.error({ err }, 'playing command failed');
    }
  },
};
