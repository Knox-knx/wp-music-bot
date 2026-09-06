// codes by: @LouisPy
import { validateSearchQuery } from '../../utils/validators.js';

export default {
  name: 'play',
  aliases: [],
  description: 'Start live voice-call playback of a song in a group.',
  usage: '!play <song name>',
  example: '!play Mast Kalander',
  category: 'Music',
  adminOnly: false,
  groupOnly: false,
  minArgs: 1,
  async execute(ctx) {
    if (!ctx.isGroup || !String(ctx.chatId).endsWith('@g.us')) {
      await ctx.reply('⚠️ Live playback is only available in WhatsApp groups.');
      return;
    }
    const { ok, reason, query } = validateSearchQuery(
      ctx.parsed.args,
      ctx.config.maxCommandLength
    );
    if (!ok) {
      await ctx.reply(`Usage:\n!play <song name>\n\n${reason}`);
      return;
    }
    ctx.services.logger?.debug(
      {
        from: ctx.message?.from,
        author: ctx.message?.author,
        chatId: ctx.chatId,
        isGroup: ctx.isGroup,
      },
      '!play call-target trace'
    );
    if (!ctx.services.voiceCall?.startPlayback) {
      // Live voice calls are unavailable in this build: fall back to the
      // searched song as a regular audio message instead of crashing.
      await ctx.services.music.handleSongRequest({
        client: ctx.client,
        chatId: ctx.chatId,
        query,
        notify: (text) => ctx.reply(text),
      });
      return;
    }
    await ctx.services.voiceCall.startPlayback({
      chatId: ctx.chatId,
      query,
      notify: (text) => ctx.reply(text),
    });
  },
};