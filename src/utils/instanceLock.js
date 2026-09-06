import fs from 'node:fs';

const LOCK_TEXT = (pid, startedAt) =>
  `${JSON.stringify({ pid, startedAt: startedAt.toISOString() })}\n`;

export function acquireInstanceLock(lockFilePath) {
  const tryAcquire = () => {
    try {
      const fd = fs.openSync(lockFilePath, 'wx');
      fs.writeSync(fd, LOCK_TEXT(process.pid, new Date()));
      fs.closeSync(fd);
      return { acquired: true };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      return { acquired: false };
    }
  };

  let result = tryAcquire();
  if (!result.acquired) {
    let stale = false;
    try {
      const raw = fs.readFileSync(lockFilePath, 'utf8');
      const data = JSON.parse(raw);
      try {
        process.kill(Number(data.pid), 0);
      } catch (err) {
        if (err.code === 'ESRCH') stale = true;
      }
    } catch {
      stale = true;
    }
    if (stale) {
      try {
        fs.unlinkSync(lockFilePath);
      } catch {
        /* already removed */
      }
      result = tryAcquire();
    }
  }

  if (!result.acquired) {
    let pid = 'unknown';
    try {
      pid = JSON.parse(fs.readFileSync(lockFilePath, 'utf8')).pid;
    } catch {
      /* unreadable lock */
    }
    return { acquired: false, pid };
  }

  return { acquired: true, pid: process.pid };
}

export function releaseInstanceLock(lockFilePath, logger) {
  try {
    fs.unlinkSync(lockFilePath);
    logger?.info('Instance lock released');
  } catch (err) {
    if (err.code !== 'ENOENT') logger?.warn({ err }, 'Failed to remove instance lock');
  }
}