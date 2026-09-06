export function sanitizeText(text, maxLength) {
  if (typeof text !== 'string') return '';
  const cleaned = text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim();
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) : cleaned;
}

export function validateSearchQuery(raw, maxLength) {
  const query = sanitizeText(raw, maxLength || 512);
  if (!query) return { ok: false, reason: 'Please provide a song name.' };
  if (query.length < 1) return { ok: false, reason: 'Please provide a song name.' };
  return { ok: true, query };
}

export function parseSafeInt(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number.parseInt(String(value).trim(), 10);
  return Number.isInteger(n) ? n : null;
}

export function isValidAdInterval(n) {
  return Number.isInteger(n) && n >= 2 && n <= 5;
}

export function normalizeNumberId(id) {
  return String(id).split('@')[0].trim();
}

/**
 * Canonical form of a WhatsApp phone number for identity comparison.
 * Handles: "919876543210", "919876543210@c.us", "919876543210:5@c.us"
 * (device suffix), "1409…@lid" (privacy lid) and "@s.whatsapp.net".
 * Keeps only digits after stripping the device suffix and server part.
 */
export function normalizeWhatsAppNumber(value) {
  if (value === null || value === undefined) return '';
  let s = String(value).trim();
  const at = s.indexOf('@');
  if (at >= 0) s = s.slice(0, at);
  const colon = s.indexOf(':');
  if (colon >= 0) s = s.slice(0, colon);
  return s.replace(/\D+/g, '');
}

export function maskNumberId(id) {
  const digits = normalizeWhatsAppNumber(id);
  if (!digits) return 'unknown';
  if (digits.length <= 6) return `${digits.slice(0, 2)}***`;
  return `${digits.slice(0, 2)}***${digits.slice(-3)}`;
}

export function isGroupId(id) {
  return String(id).endsWith('@g.us');
}

export function extractMentionIds(message) {
  if (!message) return [];
  if (Array.isArray(message.mentionedIds) && message.mentionedIds.length > 0) {
    return message.mentionedIds;
  }
  if (Array.isArray(message.mentions)) {
    return message.mentions
      .map((m) => (m && (m.id?._serialized || m.id)) || m)
      .filter(Boolean);
  }
  return [];
}

export function parseLyricsQuery(raw) {
  const cleaned = sanitizeText(raw, 512);
  const sep = cleaned.includes(' - ') ? cleaned.indexOf(' - ') : cleaned.indexOf('-');
  if (sep > 0) {
    return {
      artist: cleaned.slice(0, sep).trim(),
      title: cleaned.slice(sep + (cleaned[sep + 1] === ' ' ? 3 : 1)).trim(),
    };
  }
  return { artist: null, title: cleaned };
}