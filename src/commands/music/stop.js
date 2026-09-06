// codes by: @LouisPy
export default {
  name: 'stop',
  aliases: ['stopmusic'],
  description: 'Stop the live voice-call playback in the group.',
  usage: '!stop',
  category: 'Music',
  adminOnly: false,
  groupOnly: false,
  minArgs: 0,
  async execute(ctx) {
    if (!ctx.isGroup) {
      await ctx.reply('⚠️ Live playback is only available in WhatsApp groups.');
      return;
    }
    if (typeof ctx.services.voiceCall?.stop !== 'function') {
      await ctx.reply('Nothing is currently playing in this group.');
      return;
    }
    await ctx.services.voiceCall.stop(ctx.chatId, (text) => ctx.reply(text));
  },
};