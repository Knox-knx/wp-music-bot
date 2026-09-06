import pkg from 'whatsapp-web.js';

const { Client, LocalAuth } = pkg;

function resolveConfig(arg) {
  if (!arg) return {};
  // app.js passes { config }; tests or other callers may pass the config directly.
  if (arg.config && typeof arg.config === 'object') return arg.config;
  return arg;
}

const createClient = (arg) => {
  const config = resolveConfig(arg);
  const browser = config.browser ?? {};
  const puppeteerArgs =
    Array.isArray(browser.args) && browser.args.length > 0
      ? browser.args
      : ['--no-sandbox', '--disable-setuid-sandbox'];
  const client = new Client({
    authStrategy: new LocalAuth({
      dataPath: config.authDataPath || '.wwebjs_auth',
    }),
    puppeteer: {
      headless: browser.headless ?? true,
      executablePath: browser.executablePath || undefined,
      args: puppeteerArgs,
    },
    restartOnAuthFailure: true,
    authTimeoutMs: config.authTimeoutMs || config.authTimeout || 60000,
    qrMaxRetries: config.qrMaxRetries ?? 5,
  });

  return client;
};

export { createClient };
