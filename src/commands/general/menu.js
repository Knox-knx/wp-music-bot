// codes by: @LouisPy
import { buildMainMenu } from '../../utils/formatter.js';

export default {
  name: 'menu',
  aliases: ['mainmenu', 'commands'],
  description: 'Show the main menu.',
  usage: '!menu',
  example: '!menu',
  category: 'General',
  adminOnly: false,
  groupOnly: false,
  minArgs: 0,
  async execute(ctx) {
    const sender = ctx.senderId ?? ctx.message?.author ?? ctx.message?.from;
    const showAdmin = await ctx.services.permission.isOwnerIdAsync(sender);
    await ctx.reply(buildMainMenu({ showAdmin }));
  },
};