export default {
  name: 'pause',
  aliases: [],
  description: 'Pause the live voice-call playback in the group.',
  usage: '!pause',
  category: 'Music',
  adminOnly: false,
  groupOnly: false,
  minArgs: 0,
  async execute(ctx) {
    if (!ctx.isGroup) {
      await ctx.reply('⚠️ Live playback is only available in WhatsApp groups.');
      return;
    }
    if (typeof ctx.services.voiceCall?.pause !== 'function') {
      await ctx.reply('Nothing is currently playing in this group.');
      return;
    }
    await ctx.services.voiceCall.pause(ctx.chatId, (text) => ctx.reply(text));
  },
};