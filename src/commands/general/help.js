export default {
  name: 'help',
  aliases: [],
  description: 'Show help for a specific command or the full command list.',
  usage: '!help [command]',
  example: '!help song',
  category: 'General',
  adminOnly: false,
  groupOnly: false,
  minArgs: 0,
  async execute(ctx) {
    const target = ctx.parsed.argList[0];
    if (!target) {
      const commands = ctx.services.commands
        .filter((c) => !c.hidden)
        .map((c) => `!${c.name} — ${c.description}`)
        .join('\n');
      await ctx.reply(`🤖 COMMAND HELP\n\n${commands}`);
      return;
    }
    const command = ctx.services.commandManager.find(target);
    if (!command) {
      await ctx.reply(`No command named "${target}". Try !help to list commands.`);
      return;
    }
    const lines = [
      `🎵 ${command.name.toUpperCase()}`,
      '',
      'Usage:',
      command.usage ?? `${ctx.config.prefix}${command.name} <args>`,
    ];
    if (command.example) {
      lines.push('', 'Example:', command.example);
    }
    lines.push('', 'Description:', command.description ?? 'No description.');
    if (command.category) lines.push('', `Category: ${command.category}`);
    await ctx.reply(lines.join('\n'));
  },
};