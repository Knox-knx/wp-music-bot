// codes by: @LouisPy
import { z } from 'zod';

const booleanFromString = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => ['true', '1', 'yes'].includes(v));

const numberList = z
  .string()
  .optional()
  .default('')
  .transform((s) => s.split(',').map((n) => n.trim()).filter(Boolean));

const positiveInt = (max, fallback) =>
  z.coerce.number().int().min(1).max(max).default(fallback);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  BOT_PREFIX: z.string().min(1).max(3).default('!'),
  OWNER_NUMBERS: numberList,
  ADMIN_NUMBERS: numberList,
  DATABASE_PATH: z.string().min(1).default('./database/bot.sqlite'),
  AUTH_DATA_PATH: z.string().min(1).default('.wwebjs_auth'),
  LOCK_FILE: z.string().min(1).default('./.bot.lock'),
  TMP_DIR: z.string().min(1).default('./tmp'),
  CACHE_DIR: z.string().min(1).default('./cache'),
  LOG_DIR: z.string().min(1).default('./logs'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  LOG_PRETTY: booleanFromString.default('false'),
  MAX_AUDIO_MB: z.coerce.number().int().min(1).max(64).default(16),
  MAX_AUDIO_DURATION_SECONDS: z.coerce.number().int().min(10).max(3600).default(600),
  DOWNLOAD_TIMEOUT_MS: positiveInt(3_600_000, 600_000),
  DOWNLOAD_CONCURRENCY: positiveInt(5, 2),
  SEARCH_RESULTS: positiveInt(10, 5),
  LYRICS_API_URL: z.string().url().default('https://lrclib.net/api'),
  LYRICS_TIMEOUT_MS: positiveInt(60_000, 15_000),
  ANTISPAM_ENABLED: booleanFromString.default('true'),
  ANTISPAM_WINDOW_SECONDS: positiveInt(300, 10),
  ANTISPAM_MAX_MESSAGES: positiveInt(100, 6),
  ANTISPAM_ACTION: z.enum(['delete', 'warn', 'mute', 'kick']).default('delete'),
  ANTISPAM_MUTE_SECONDS: positiveInt(86_400, 300),
  ADVERTISEMENTS_ENABLED: booleanFromString.default('true'),
  DEFAULT_ADS_PER_DAY: z.coerce.number().int().min(2).max(5).default(2),
  AD_MAX_MESSAGE_LENGTH: positiveInt(4096, 1000),
  CACHE_TTL_SECONDS: positiveInt(86_400, 3600),
  CACHE_MAX_FILES: positiveInt(500, 20),
  MAX_COMMAND_LENGTH: positiveInt(4096, 512),
  HEALTH_HOST: z.string().min(1).default('127.0.0.1'),
  HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  BROWSER_HEADLESS: booleanFromString.default('true'),
  BROWSER_EXECUTABLE_PATH: z.string().optional().default(''),
  BROWSER_ARGS: z
    .string()
    .default(
      '--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage,--disable-gpu,--disable-extensions,--disable-background-networking,--disable-sync,--disable-translate,--hide-scrollbars,--mute-audio,--no-first-run,--disable-default-apps,--disable-background-timer-throttling,--disable-renderer-backgrounding,--disable-features=TranslateUI,BlinkGenPropertyTrees'
    )
    .transform((s) => s.split(',').map((a) => a.trim()).filter(Boolean)),
  VOICE_CALL_ENABLED: booleanFromString.default('false'),
  VOICE_CALL_CONNECT_TIMEOUT_MS: positiveInt(120_000, 30_000),
  VOICE_CALL_START_TIMEOUT_MS: positiveInt(120_000, 30_000),
  VOICE_CALL_MAX_DURATION_SECONDS: positiveInt(3_600, 600),
  VOICE_CALL_STREAM_PORT: z.coerce.number().int().min(1024).max(65535).default(38980),
  VOICE_CALL_STREAM_HOST: z.string().min(1).default('127.0.0.1'),
  MAX_RECONNECT_ATTEMPTS: positiveInt(100, 15),
});

const VOICE_CALL_BROWSER_ARGS = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
];

export function withVoiceCallBrowserArgs(args, { enabled, host, port }) {
  if (!enabled) return args;
  const secureOrigin = `--unsafely-treat-insecure-origin-as-secure=http://${host}:${port}`;
  const extra = [...VOICE_CALL_BROWSER_ARGS, secureOrigin];
  const merged = [...args];
  for (const arg of extra) {
    const base = arg.split('=')[0];
    if (!merged.some((existing) => existing.split('=')[0] === base)) {
      merged.push(arg);
    }
  }
  return merged;
}

export function parseConfig(env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Configuration validation failed: ${issues}`);
  }
  const v = parsed.data;
  if (v.NODE_ENV === 'production' && v.OWNER_NUMBERS.length === 0) {
    throw new Error(
      'Configuration validation failed: OWNER_NUMBERS is required in production mode.'
    );
  }
  return {
    nodeEnv: v.NODE_ENV,
    prefix: v.BOT_PREFIX,
    ownerNumbers: v.OWNER_NUMBERS,
    adminNumbers: v.ADMIN_NUMBERS,
    dbPath: v.DATABASE_PATH,
    authDataPath: v.AUTH_DATA_PATH,
    lockFile: v.LOCK_FILE,
    tmpDir: v.TMP_DIR,
    cacheDir: v.CACHE_DIR,
    logDir: v.LOG_DIR,
    logLevel: v.LOG_LEVEL,
    logPretty: v.LOG_PRETTY,
    maxAudioMb: v.MAX_AUDIO_MB,
    maxAudioBytes: v.MAX_AUDIO_MB * 1024 * 1024,
    maxAudioDurationSeconds: v.MAX_AUDIO_DURATION_SECONDS,
    downloadTimeoutMs: v.DOWNLOAD_TIMEOUT_MS,
    downloadConcurrency: v.DOWNLOAD_CONCURRENCY,
    searchResults: v.SEARCH_RESULTS,
    antispam: {
      enabled: v.ANTISPAM_ENABLED,
      windowSeconds: v.ANTISPAM_WINDOW_SECONDS,
      maxMessages: v.ANTISPAM_MAX_MESSAGES,
      action: v.ANTISPAM_ACTION,
      muteSeconds: v.ANTISPAM_MUTE_SECONDS,
    },
    ads: {
      enabled: v.ADVERTISEMENTS_ENABLED,
      defaultPerDay: v.DEFAULT_ADS_PER_DAY,
      maxMessageLength: v.AD_MAX_MESSAGE_LENGTH,
    },
    lyrics: { apiUrl: v.LYRICS_API_URL, timeoutMs: v.LYRICS_TIMEOUT_MS },
    cache: { ttlSeconds: v.CACHE_TTL_SECONDS, maxFiles: v.CACHE_MAX_FILES },
    maxCommandLength: v.MAX_COMMAND_LENGTH,
    health: { host: v.HEALTH_HOST, port: v.HEALTH_PORT },
    browser: {
      headless: v.BROWSER_HEADLESS,
      executablePath: v.BROWSER_EXECUTABLE_PATH || null,
      args: withVoiceCallBrowserArgs(v.BROWSER_ARGS, {
        enabled: v.VOICE_CALL_ENABLED,
        host: v.VOICE_CALL_STREAM_HOST,
        port: v.VOICE_CALL_STREAM_PORT,
      }),
    },
    voiceCall: {
      enabled: v.VOICE_CALL_ENABLED,
      connectTimeoutMs: v.VOICE_CALL_CONNECT_TIMEOUT_MS,
      startTimeoutMs: v.VOICE_CALL_START_TIMEOUT_MS,
      maxDurationSeconds: v.VOICE_CALL_MAX_DURATION_SECONDS,
      streamHost: v.VOICE_CALL_STREAM_HOST,
      streamPort: v.VOICE_CALL_STREAM_PORT,
    },
    maxReconnectAttempts: v.MAX_RECONNECT_ATTEMPTS,
  };
}

export function loadConfig(env = process.env) {
  return parseConfig(env);
}

export function isProduction(config) {
  return config.nodeEnv === 'production';
}
