export default {
  name: 'resume',
  aliases: [],
  description: 'Resume the live voice-call playback in the group.',
  usage: '!resume',
  category: 'Music',
  adminOnly: false,
  groupOnly: false,
  minArgs: 0,
  async execute(ctx) {
    if (!ctx.isGroup) {
      await ctx.reply('⚠️ Live playback is only available in WhatsApp groups.');
      return;
    }
    if (typeof ctx.services.voiceCall?.resume !== 'function') {
      await ctx.reply('Nothing is currently playing in this group.');
      return;
    }
    await ctx.services.voiceCall.resume(ctx.chatId, (text) => ctx.reply(text));
  },
};