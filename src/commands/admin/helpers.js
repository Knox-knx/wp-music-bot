export function resolveTarget(ctx) {
  if (Array.isArray(ctx?.mentionedIds) && ctx.mentionedIds.length > 0) {
    return ctx.mentionedIds[0] ?? null;
  }
  if (Array.isArray(ctx?.mentions) && ctx.mentions.length > 0) {
    const first = ctx.mentions[0];
    if (typeof first === 'string') return first;
    if (first && typeof first === 'object') {
      return first.id?._serialized || first.id || null;
    }
    return null;
  }
  return null;
}

export function isSelfTarget(ctx, userId) {
  const botId =
    ctx?.client?.info?.wid?._serialized ?? ctx?.client?.info?.wid ?? null;
  if (!botId || userId === null || userId === undefined) return false;
  return normalizeWhatsAppNumber(botId) === normalizeWhatsAppNumber(userId);
}

export function normalizeNumberId(id) {
  return String(id).split('@')[0].trim();
}

export function normalizeWhatsAppNumber(value) {
  if (value === null || value === undefined) return '';
  let s = String(value).trim();
  const at = s.indexOf('@');
  if (at >= 0) s = s.slice(0, at);
  const colon = s.indexOf(':');
  if (colon >= 0) s = s.slice(0, colon);
  return s.replace(/\D+/g, '');
}