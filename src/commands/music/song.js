import { validateSearchQuery } from '../../utils/validators.js';

export async function executeSongRequest(ctx) {
  const { ok, reason, query } = validateSearchQuery(
    ctx.parsed.args,
    ctx.config.maxCommandLength
  );
  if (!ok) {
    await ctx.reply(`Usage:\n!song <song name>\n\n${reason}`);
    return;
  }
  await ctx.services.music.handleSongRequest({
    client: ctx.client,
    chatId: ctx.chatId,
    query,
    notify: (text) => ctx.reply(text),
  });
}

export default {
  name: 'song',
  aliases: ['find'],
  description: 'Search and send a song as an audio message.',
  usage: '!song <song name>',
  example: '!song Imagine Dragons Believer',
  category: 'Music',
  adminOnly: false,
  groupOnly: false,
  minArgs: 1,
  execute: executeSongRequest,
};