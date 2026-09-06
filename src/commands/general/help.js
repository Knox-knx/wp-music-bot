// codes by: @LouisPy
import { BOT_CREDITS_FOOTER } from '../../utils/credits.js';

function accessLabel(command) {
  if (command?.access === 'owner' || command?.ownerOnly || command?.adminOnly) return '🔒 Owner-only';
  return '🌍 Public';
}

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
    const prefix = ctx.config?.prefix ?? '!';
    const target = ctx.parsed.argList[0];
    if (!target) {
      const commands = ctx.services.commands
        .filter((c) => !c.hidden)
        .map((c) => `${prefix}${c.name} — ${c.description} [${c.adminOnly || c.ownerOnly || c.access === 'owner' ? 'Owner' : 'Public'}]`)
        .join('\n');
      await ctx.reply(
        `🤖 COMMAND HELP\n\n${commands}\n\n👑 Owner commands: ${prefix}owners\n🔍 Check your role: ${prefix}myrole\n\n${BOT_CREDITS_FOOTER}`
      );
      return;
    }
    const command = ctx.services.commandManager.find(target);
    if (!command) {
      await ctx.reply(`No command named "${target}". Try ${prefix}help to list commands.\n\n${BOT_CREDITS_FOOTER}`);
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
    lines.push('', `Access: ${accessLabel(command)}`);
    lines.push('', `How to check: ${prefix}myrole (yours) / ${prefix}owners (owner list)`);
    lines.push('', BOT_CREDITS_FOOTER);
    await ctx.reply(lines.join('\n'));
  },
};