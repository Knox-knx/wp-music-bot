// codes by: @LouisPy
import fs from 'node:fs';
import path from 'node:path';

export function ensureDirectories(config) {
  const dirs = [
    path.join(config.tmpDir, 'downloads'),
    path.join(config.tmpDir, 'converted'),
    path.join(config.tmpDir, 'failed'),
    config.cacheDir,
    config.logDir,
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function purgeDirectory(dir, { maxAgeMs = null, except = null } = {}) {
  if (!fs.existsSync(dir)) return 0;
  const now = Date.now();
  let removed = 0;
  for (const entry of fs.readdirSync(dir)) {
    if (except && except.includes(entry)) continue;
    const filePath = path.join(dir, entry);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
      if (maxAgeMs === null || now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(filePath);
        removed += 1;
      }
    } catch {
      /* race with concurrent cleanup */
    }
  }
  return removed;
}

export function purgeStaleCache(cacheDir, ttlSeconds) {
  if (!fs.existsSync(cacheDir)) return 0;
  return purgeDirectory(cacheDir, { maxAgeMs: ttlSeconds * 1000 });
}

export function cleanupTmp(config) {
  const downloads = path.join(config.tmpDir, 'downloads');
  const converted = path.join(config.tmpDir, 'converted');
  purgeDirectory(downloads);
  purgeDirectory(converted);
}

export function findOldestCacheFile(cacheDir) {
  if (!fs.existsSync(cacheDir)) return null;
  const entries = fs
    .readdirSync(cacheDir)
    .filter((f) => f.endsWith('.mp3'))
    .map((f) => {
      const p = path.join(cacheDir, f);
      return { path: p, mtime: fs.statSync(p).mtimeMs };
    })
    .sort((a, b) => a.mtime - b.mtime);
  return entries.length ? entries[0].path : null;
}

export function countCacheFiles(cacheDir) {
  if (!fs.existsSync(cacheDir)) return 0;
  return fs.readdirSync(cacheDir).filter((f) => f.endsWith('.mp3')).length;
}