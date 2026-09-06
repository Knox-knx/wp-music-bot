// codes by: @LouisPy
export default {
  name: 'ping',
  aliases: [],
  description: 'Check if the bot is responsive.',
  usage: '!ping',
  example: '!ping',
  category: 'General',
  adminOnly: false,
  groupOnly: false,
  minArgs: 0,
  async execute(ctx) {
    await ctx.reply('🏓 Pong!');
  },
};