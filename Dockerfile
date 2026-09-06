# ── Stage 1: dependencies (build tools available for native modules) ──
FROM node:22-bookworm-slim AS deps
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    g++ \
    make \
    ca-certificates \
    && ln -s /usr/bin/python3 /usr/bin/python \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Stage 2: runtime image ──
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    BROWSER_EXECUTABLE_PATH=/usr/bin/chromium \
    BROWSER_HEADLESS=true \
    HEALTH_HOST=127.0.0.1 \
    HEALTH_PORT=3000 \
    DATABASE_PATH=./database/bot.sqlite \
    TMP_DIR=./tmp \
    CACHE_DIR=./cache \
    LOG_DIR=./logs \
    LOCK_FILE=./.bot.lock
# NOTE: AUTH_DATA_PATH defaults to ./.wwebjs_auth via src/config.js

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    chromium \
    fonts-liberation \
    curl \
    ca-certificates \
    dumb-init \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the installed dependencies (includes the yt-dlp binary from
# the yt-dlp-exec postinstall step of stage 1)
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY src ./src
COPY database ./database
COPY .env.example .env.example

# Non-root user (chromium runs fine with --no-sandbox, already in BROWSER_ARGS)
RUN useradd --create-home --uid 1001 appuser \
    && mkdir -p database logs tmp cache .wwebjs_auth \
    && chown -R appuser:appuser /app

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" || exit 1

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "src/app.js"]