// codes by: @LouisPy
export function parseCommand(body, prefix) {
  if (typeof body !== 'string' || typeof prefix !== 'string') return null;
  if (!body.startsWith(prefix)) return null;
  const content = body.slice(prefix.length).trim();
  if (!content) return null;
  const parts = content.split(/\s+/);
  const name = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');
  const argList = args ? args.split(',') : [];
  return { name, args, argList };
}