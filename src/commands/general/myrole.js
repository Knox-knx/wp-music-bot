// codes by: @LouisPy
import { BOT_CREDITS_FOOTER } from '../../utils/credits.js';

const ROLE_LABEL = {
  OWNER: '👑 OWNER',
  ADMIN: '🛡️ ADMIN (configured)',
  GROUP_ADMIN: '🛡️ GROUP ADMIN',
  USER: '👤 USER',
};

export default {
  name: 'myrole',
  aliases: ['role', 'whoami', 'mystatus', 'checkadmin', 'checkowner', 'myperm', 'checkrole'],
  description: 'Check your own owner/admin role and learn how the bot checks permissions.',
  usage: '!myrole [@user]',
  example: '!myrole',
  category: 'General',
  adminOnly: false,
  groupOnly: false,
  minArgs: 0,
  async execute(ctx) {
    const prefix = ctx.config?.prefix ?? '!';
    const permission = ctx.services?.permission;

    const selfId = ctx.senderId ?? ctx.message?.author ?? ctx.message?.from ?? null;
    const targetRaw = ctx.parsed?.argList?.[0] ?? null;
    // Only owners/admins may inspect another user's role; everyone may check themselves.
    const wantsOther = Boolean(targetRaw);
    let targetId = selfId;
    let isSelf = true;

    if (wantsOther) {
      const ownLevel = permission?.getLevel
        ? await permission.getLevel(ctx.chatId, selfId).catch(() => 'USER')
        : 'USER';
      const canInspect = ownLevel === 'OWNER' || ownLevel === 'ADMIN';
      if (!canInspect) {
        await ctx.reply(`⚠️ Only owners/admins can check other users. Your own check:\nUse ${prefix}myrole (without @user).\n\n${BOT_CREDITS_FOOTER}`);
        return;
      }
      const { normalizeWhatsAppNumber } = await import('../../utils/validators.js');
      const digits = normalizeWhatsAppNumber(targetRaw);
      targetId = digits ? `${digits}@c.us` : targetRaw;
      isSelf = false;
    }

    let level = 'USER';
    let isOwner = false;
    let isConfiguredAdmin = false;
    let isGroupAdmin = false;
    try {
      isOwner = permission?.isOwnerIdAsync
        ? await permission.isOwnerIdAsync(targetId)
        : Boolean(permission?.isOwnerId?.(targetId));
      isConfiguredAdmin = Boolean(permission?.isConfiguredAdminId?.(targetId));
      if (ctx.chatId && permission?.isGroupAdmin) {
        try {
          isGroupAdmin = await permission.isGroupAdmin(ctx.chatId, targetId);
        } catch {
          isGroupAdmin = false;
        }
      }
      level = permission?.getLevel ? await permission.getLevel(ctx.chatId, targetId) : isOwner ? 'OWNER' : 'USER';
    } catch (err) {
      ctx.services?.logger?.warn?.({ err }, 'myrole: permission check failed');
    }

    const who = isSelf ? 'Your role' : `Role for ${targetRaw}`;
    const lines = [
      `🔍 ${who}: ${ROLE_LABEL[level] ?? level}`,
      '',
      `• Owner (OWNER_NUMBERS): ${isOwner ? '✅ yes' : '❌ no'}`,
      `• Configured admin (ADMIN_NUMBERS): ${isConfiguredAdmin ? '✅ yes' : '❌ no'}`,
      `• Group admin (this group): ${isGroupAdmin ? '✅ yes' : '❌ no'}`,
      '',
      'HOW TO CHECK OWNER/ADMIN:',
      `• Yourself: ${prefix}myrole`,
      `• Another user (owner/admin only): ${prefix}myrole @user`,
      `• Full owner command list (owner only): ${prefix}owners`,
      `• One command access level: ${prefix}help <command>`,
      `• Full menu: ${prefix}menu`,
      '',
      ' Owners = OWNER_NUMBERS in .env. Admins = ADMIN_NUMBERS in .env + WhatsApp group admins.',
      '',
      BOT_CREDITS_FOOTER,
    ];
    await ctx.reply(lines.join('\n'));
  },
};
