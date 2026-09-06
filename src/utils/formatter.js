export function boxLine(char = '═', width = 30) {
  return `╔${char.repeat(width)}╗`;
}

export function buildMainMenu({ showAdmin }) {
  const lines = [
    '╔══════════════════════════════╗',
    '         🎵 WHATSAPP BOT',
    '╚══════════════════════════════╝',
    '',
    '🎵 MUSIC',
    '!song <name>',
    '!find <name>',
    '!play <name>',
    '!lyrics <name>',
    '!lyrics Artist - Title',
    '',
    'ℹ️ GENERAL',
    '!menu',
    '!help [command]',
    '!ping',
    '!stats',
  ];
  if (showAdmin) {
    lines.push('', '🛡️ ADMIN', ...buildAdminPanel(false).split('\n').filter(Boolean));
  }
  return lines.join('\n');
}

export function buildAdminPanel(header = true) {
  const lines = [
    '📢 ADVERTISEMENT',
    '!setad <message>',
    '!adinterval <2-5>',
    '!ads',
    '!adstart',
    '!adstop',
    '!adstatus',
    '!adgroups',
    '!adtoggle',
    '',
    '👥 MODERATION',
    '!kick @user',
    '!mute @user',
    '!unmute @user',
    '!ban @user',
    '!unban @user',
    '!warn @user',
    '!antispam on|off|status',
    '',
    '📊 SYSTEM',
    '!stats',
  ];
  return header ? `🛡️ ADMIN PANEL\n${lines.join('\n')}` : lines.join('\n');
}

export function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return 'Unknown';
  const seconds = Math.round(totalSeconds);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function chunkText(text, maxLength = 4000) {
  if (!text) return [];
  if (text.length <= maxLength) return [text];
  const parts = [];
  let current = '';
  const lines = text.split('\n');
  for (const line of lines) {
    if (current.length + line.length + 1 > maxLength) {
      parts.push(current.trimEnd());
      current = line;
    } else {
      current += (current ? '\n' : '') + line;
    }
    if (current.length >= maxLength) {
      parts.push(current.trimEnd());
      current = '';
    }
  }
  if (current) parts.push(current.trimEnd());
  return parts;
}

export function formatStats(stats, uptimeSeconds) {
  const up = Math.floor(uptimeSeconds);
  const h = Math.floor(up / 3600);
  const m = Math.floor((up % 3600) / 60);
  const s = up % 60;
  const uptime = `${h}h ${m}m ${s}s`;
  return [
    '🤖 BOT STATUS',
    '',
    `Uptime: ${uptime}`,
    `Groups: ${stats.groupsActive}`,
    `Users seen: ${stats.users}`,
    `Commands processed: ${stats.commands}`,
    `Songs processed: ${stats.songsProcessed}`,
    `Lyrics requests: ${stats.lyricsRequests}`,
    `Muted users: ${stats.muted}`,
    `Banned users: ${stats.banned}`,
    `Moderation events: ${stats.moderationEvents}`,
    `Ads sent today: ${stats.adsSentToday}`,
  ].join('\n');
}

export function formatSchedulePreview(slots) {
  if (!slots || slots.length === 0) return 'No schedule generated yet.';
  return slots
    .map(
      (s) =>
        `${new Date(s.send_at).toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
        })} — ${s.status}`
    )
    .join('\n');
}