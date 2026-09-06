import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseCommand } from './utils/parser.js';
import { extractMentionIds } from './utils/validators.js';
import { BotError } from './utils/errors.js';

export const ACCESS_PUBLIC = 'public';
export const ACCESS_OWNER = 'owner';

function accessOf(command) {
  if (typeof command?.access === 'string') {
    const access = command.access.toLowerCase();
    if (access === ACCESS_PUBLIC || access === ACCESS_OWNER) return access;
  }
  if (command?.ownerOnly || command?.adminOnly) return ACCESS_OWNER;
  return ACCESS_PUBLIC;
}

export async function loadCommandsFromDir(dir, logger) {
  const commands = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      commands.push(...(await loadCommandsFromDir(fullPath, logger)));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      try {
        const mod = await import(pathToFileURL(fullPath).href);
        const cmd = mod.default ?? mod;
        if (cmd && typeof cmd.execute === 'function' && typeof cmd.name === 'string') {
          commands.push(cmd);
        } else {
          logger?.debug({ file: entry.name }, 'skipping non-command module');
        }
      } catch (err) {
        logger?.error({ err, file: fullPath }, 'Failed to load command file');
      }
    }
  }
  return commands;
}

export function createCommandManager({ config, logger, services = null }) {
  const registry = new Map();
  const aliases = new Map();
  const manager = { services };

  function register(command) {
    if (!command || typeof command.execute !== 'function') return;
    const names = [command.name, ...(command.aliases ?? [])].filter(Boolean);
    for (const name of names) {
      const key = String(name).toLowerCase();
      if (key === command.name) registry.set(key, command);
      else aliases.set(key, command);
    }
  }

  function find(name) {
    const key = String(name).toLowerCase();
    return registry.get(key) ?? aliases.get(key) ?? null;
  }

  function registerAll(commands) {
    for (const command of commands) register(command);
  }

  function list() {
    return [...registry.values()];
  }

  function buildContext({ message, chat, parsed, context }) {
    const chatId = context?.chatId ?? chat?.id?._serialized ?? message.from ?? null;
    const senderId = context?.senderId ?? message.author ?? message.from ?? null;
    const isGroup = context?.isGroup ?? Boolean(chat?.isGroup);
    return {
      client: manager.services.client,
      config,
      services: manager.services,
      message,
      chat,
      parsed,
      chatId,
      senderId,
      isGroup,
      mentions: extractMentionIds(message),
      reply: async (text, options) => {
        if (!chatId) throw new BotError('Cannot determine chat to reply to.');
        return manager.services.client.sendMessage(chatId, text, options);
      },
      replyChunks: async (texts) => {
        for (const t of texts) await manager.services.client.sendMessage(chatId, t);
      },
    };
  }

  async function execute({ message, chat, context }) {
    const body = typeof message?.body === 'string' ? message.body : '';
    const parsed = parseCommand(body, config.prefix);
    if (!parsed) return { status: 'not_command' };
    if (body.length > config.maxCommandLength) {
      logger.warn({ chatId: message?.from }, 'command ignored: message too long');
      return { status: 'too_long' };
    }

    const command = find(parsed.name);
    const ctx = buildContext({ message, chat, parsed, context });
    if (!command) {
      await ctx.reply(`Unknown command. Try ${config.prefix}menu to see available commands.`);
      try {
        manager.services.db.logCommand({
          command: parsed.name,
          args: parsed.args,
          chatId: ctx.chatId,
          senderId: ctx.senderId,
          status: 'unknown',
        });
      } catch (err) {
        logger.warn({ err }, 'failed to log unknown command');
      }
      logger.info({ command: parsed.name }, 'unknown command');
      return { status: 'unknown' };
    }

    if (accessOf(command) === ACCESS_OWNER) {
      const isOwner = await manager.services.permission.isOwnerIdAsync(ctx.senderId);
      if (!isOwner) {
        await ctx.reply('❌ Owner-only command.');
        try {
          manager.services.db.logCommand({
            command: parsed.name,
            args: parsed.args,
            chatId: ctx.chatId,
            senderId: ctx.senderId,
            status: 'denied',
          });
        } catch (err) {
          logger.warn({ err }, 'failed to log denied command');
        }
        logger.info({ command: parsed.name, senderId: ctx.senderId }, 'owner command denied');
        return { status: 'denied' };
      }
    }

    if (command.groupOnly && !ctx.isGroup) {
      await ctx.reply('This command only works inside groups.');
      return { status: 'denied' };
    }

    const minArgs = command.minArgs ?? 0;
    if (parsed.argList.length < minArgs) {
      await ctx.reply(`Usage:\n${command.usage ?? `${config.prefix}${command.name} <args>`}`);
      return { status: 'missing_args' };
    }

    const started = process.hrtime.bigint();
    try {
      await command.execute(ctx);
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      try {
        manager.services.db.logCommand({
          command: parsed.name,
          args: parsed.args,
          chatId: ctx.chatId,
          senderId: ctx.senderId,
          status: 'ok',
          durationMs,
        });
      } catch (err) {
        logger.warn({ err, command: parsed.name }, 'failed to log successful command');
      }
      logger.info({ command: parsed.name, chatId: ctx.chatId, durationMs }, 'command executed');
      return { status: 'ok' };
    } catch (err) {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      try {
        manager.services.db.logCommand({
          command: parsed.name,
          args: parsed.args,
          chatId: ctx.chatId,
          senderId: ctx.senderId,
          status: 'error',
          durationMs,
        });
      } catch (logErr) {
        logger.warn({ err: logErr, command: parsed.name }, 'failed to log failed command');
      }
      if (err instanceof BotError) {
        if (err.userFacing) {
          await ctx.reply(`⚠️ ${err.message}`).catch(() => {});
        } else {
          logger.error({ err, command: parsed.name }, 'command failed');
          await ctx
            .reply('Something went wrong while processing that command. Try again later.')
            .catch(() => {});
        }
      } else {
        logger.error({ err, command: parsed.name }, 'command crashed');
        await ctx
          .reply('Unexpected error. The issue has been logged. Try again later.')
          .catch(() => {});
      }
      return { status: 'error' };
    }
  }

  manager.register = register;
  manager.registerAll = registerAll;
  manager.find = find;
  manager.list = list;
  manager.execute = execute;
  manager.parse = parseCommand;
  return manager;
}