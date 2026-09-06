import { chunkText } from '../../utils/formatter.js';
import { parseLyricsQuery, validateSearchQuery } from '../../utils/validators.js';

export default {
  name: 'lyrics',
  aliases: [],
  description: 'Search and display lyrics for a song.',
  usage: '!lyrics <song name> or !lyrics <Artist> - <Title>',
  example: '!lyrics Imagine Dragons - Believer',
  category: 'Music',
  adminOnly: false,
  groupOnly: false,
  minArgs: 1,
  async execute(ctx) {
    const { ok, query } = validateSearchQuery(ctx.parsed.args, 512);
    if (!ok) {
      await ctx.reply(
        'Usage:\n!lyrics <song name>\n!lyrics <Artist> - <Title>\n\nPlease provide a song name.'
      );
      return;
    }
    ctx.services.db.incrementSetting('lyrics_requests');

    const { artist, title } = parseLyricsQuery(query);
    const result = await ctx.services.lyrics.getLyrics({ title, artist });

    if (!result.found) {
      await ctx.reply(
        `🔍 No lyrics found for "${title}".\nTry the format: !lyrics Artist - Title`
      );
      return;
    }

    const header = `🎵 LYRICS\n\n${result.title} — ${result.artist}\n\n`;
    const chunks = chunkText(result.lyrics, 3800).map((part) => header + part);
    await ctx.replyChunks(chunks);
  },
};