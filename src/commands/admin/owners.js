// codes by: @LouisPy
import { BOT_CREDITS_FOOTER } from '../../utils/credits.js';

export default {
  name: 'owners',
  aliases: ['ownerlist', 'ownercommands', 'adminlist', 'admincommands', 'ownerhelp'],
  description: 'Show the full owner command list and how owner/admin checks work.',
  usage: '!owners',
  example: '!owners',
  category: 'Admin',
  adminOnly: true,
  groupOnly: false,
  minArgs: 0,
  async execute(ctx) {
    const prefix = ctx.config?.prefix ?? '!';
    const manager = ctx.services?.commandManager;
    const all = manager?.list?.() ?? ctx.services?.commands ?? [];

    const ownerCmds = all.filter((c) => !c.hidden && (c.adminOnly || c.ownerOnly || c.access === 'owner'));
    ownerCmds.sort((a, b) => String(a.category ?? '').localeCompare(String(b.category ?? '')) || String(a.name).localeCompare(String(b.name)));

    const byCategory = new Map();
    for (const cmd of ownerCmds) {
      const cat = cmd.category ?? 'Admin';
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat).push(cmd);
    }

    const lines = ['🛡️ OWNER COMMAND LIST', ''];
    if (ownerCmds.length === 0) {
      lines.push('No owner commands registered.');
    } else {
      for (const [cat, cmds] of byCategory) {
        lines.push(`— ${String(cat).toUpperCase()} —`);
        for (const cmd of cmds) {
          lines.push(`${prefix}${cmd.name} — ${cmd.description ?? 'No description.'}`);
        }
        lines.push('');
      }
    }

    lines.push(
      'HOW OWNER/ADMIN CHECK WORKS',
      `• Owner  = number listed in OWNER_NUMBERS (.env). Checked via ${prefix}myrole.`,
      `• Admin  = number listed in ADMIN_NUMBERS (.env) OR group admin in this group.`,
      `• Check yourself anytime with: ${prefix}myrole`,
      `• Check one command with: ${prefix}help <command> (shows Owner-only / Public).`,
      '',
      BOT_CREDITS_FOOTER
    );

    await ctx.reply(lines.join('\n'));
  },
};
