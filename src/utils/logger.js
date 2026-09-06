import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';

export function createLogger({ level = 'info', logDir = null, pretty = false }) {
  const streams = [];

  if (pretty) {
    streams.push({
      stream: pino.transport({
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
      }),
    });
  } else {
    streams.push({ stream: process.stdout });
  }

  if (logDir) {
    fs.mkdirSync(logDir, { recursive: true });
    streams.push({
      stream: pino.destination({
        dest: path.join(logDir, 'bot.log'),
        append: true,
        mkdir: true,
      }),
    });
    streams.push({
      stream: pino.destination({
        dest: path.join(logDir, 'error.log'),
        append: true,
        mkdir: true,
        sync: true,
      }),
      level: 'error',
    });
  }

  const logger = pino({ level, base: { service: 'whatsapp-bot' } }, pino.multistream(streams));
  logger.childFor = (module) => logger.child({ module });
  return logger;
}

export function createSilentLogger() {
  return pino({ level: 'silent' });
}