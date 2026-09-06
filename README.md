<<<<<<< HEAD
# WhatsApp Bot — Music, Lyrics, Moderation & Advertisement

A production-ready WhatsApp bot built with **Node.js**, **whatsapp-web.js**, **SQLite** and
**yt-dlp**. It can search and send music as audio messages, look up lyrics, moderate groups
(mute / ban / kick / anti-spam) and deliver scheduled advertisements to configured groups.
It can also start a live WhatsApp group voice call and stream a song into it (`!play`),
with automatic fallback to a plain audio message when a live call is unavailable.

> ⚠️ **Copyright & compliance disclaimer**
> This bot downloads audio from public sources for personal, non-commercial use. You are
> **solely responsible** for complying with copyright law and the applicable terms of service
> of every platform you use it with (**including YouTube**). Do not download DRM-protected,
> private, paywalled, or restricted content. WhatsApp may also restrict or ban accounts that
> automate messaging at scale — run this bot with a dedicated number and at your own risk.

---

## Table of contents

1. [Features](#1-features)
2. [Requirements](#2-requirements)
3. [Installation](#3-installation-linux-debianubuntu)
4. [Configuration](#4-configuration)
5. [Running](#5-running)
6. [First login (QR code)](#6-first-login-qr-code)
7. [Commands](#7-commands)
8. [Architecture & project structure](#8-architecture--project-structure)
9. [How the music pipeline works](#9-how-the-music-pipeline-works)
10. [Live voice-call playback (`!play`)](#10-live-voice-call-playback-play)
11. [Production deployment](#11-production-deployment)
12. [Persistence, backup & restart semantics](#12-persistence-backup--restart-semantics)
13. [Health check & logging](#13-health-check--logging)
14. [Testing](#14-testing)
15. [Troubleshooting](#15-troubleshooting)
16. [Updating](#16-updating)
17. [Contributing](#17-contributing)
18. [Legal & compliance](#18-legal--compliance)
19. [License](#19-license)

---

## 1. Features

| Area | What it does |
|---|---|
| 🎵 Music | `!song <name>` (alias `!find`) searches YouTube, downloads the audio stream, converts it to MP3 with FFmpeg, sends it to the chat and cleans up temp files |
| 📞 Live playback | `!play <name>` starts a live WhatsApp group voice call and streams the song as the call's mic; `!stop`, `!pause`, `!resume`, `!skip`, `!playing`, `!voicestatus` control it (auto-falls back to an audio message if a live call cannot be established; groups only) |
| 📝 Lyrics | `!lyrics <name>` / `!lyrics Artist - Title` via LRCLIB (free, keyless) |
| 🛡️ Moderation | `!kick`, `!mute`, `!unmute`, `!ban`, `!unban` — persistent per-group records |
| ⚡ Anti-spam | `!antispam on\|off\|status`; configurable rate limit (delete / warn / mute / kick actions), in-memory tracking with automatic cleanup |
| 🚫 Anti-join ban | Banned users who rejoin are automatically detected and removed (with retry/backoff) |
| 📢 Advertisements | `!setad`, `!adinterval <2-5>`, `!ads`, `!adstatus`, `!adgroups`, `!adtoggle`, `!adstart`, `!adstop` — randomized daily schedule, duplicate-safe |
| 🗄️ Persistence | SQLite (WAL mode) — mutes, bans, ad config, schedules, stats and command logs survive restarts |
| 🔒 Reliability | Single-instance lock, exponential-backoff reconnection, graceful shutdown, structured logging (pino), local HTTP health check |
| 🧪 Tests | ~197 unit tests (`node --test`) covering DB, permissions, parser, anti-spam, ad schedule & delivery, temp mutes, participant notifications, music mocks and voice-call playback |

> **Note:** the in-bot admin panel text mentions `!warn`, but there is currently no `!warn`
> command implemented — warnings exist only as an anti-spam action (`ANTISPAM_ACTION=warn`).
> The command list in section 7 reflects what the bot actually runs (27 commands).

---

## 2. Requirements

- **Node.js 20+** (LTS recommended; Docker image uses Node 22)
- **FFmpeg** (audio conversion)
- **yt-dlp** — bundled automatically by `yt-dlp-exec` (postinstall); a system install also works
- **Chromium/Puppeteer requirements** — the bundled Puppeteer downloads Chrome on `npm install`;
  on a headless server the packages below must be present (see *Installation*)
- A dedicated **WhatsApp account** (scanning the QR links this number to web automation)
- **Linux recommended** (works on macOS/Windows but `--no-sandbox` args and systemd/docs target Linux)

---

## 3. Installation (Linux, Debian/Ubuntu)

```bash
# 1. System packages (FFmpeg + Chromium dependencies)
sudo apt update
sudo apt install -y ffmpeg chromium fonts-liberation ca-certificates

# (Optional) install yt-dlp system-wide — else the bundled copy is used
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
  -o /usr/local/bin/yt-dlp
sudo chmod +x /usr/local/bin/yt-dlp

# 2. Clone the project
git clone <your-repo-url> whatsapp-bot
cd whatsapp-bot

# 3. Install Node dependencies
npm install

# 4. Configure
cp .env.example .env
nano .env          # set OWNER_NUMBERS etc. — see section 4

# 5. Dry-run validation (optional but recommended)
npm run lint
npm test
```

If Puppeteer's Chrome download fails during `npm install` (e.g. behind a proxy), install
Chromium manually and point the bot at it:

```bash
# install chromium via apt (done above), then in .env:
BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
BROWSER_HEADLESS=true
```

---

## 4. Configuration

Copy `.env.example` to `.env`. The bot **fails fast with a clear message** if required
values are invalid. Minimum viable setting:

```env
NODE_ENV=production
BOT_PREFIX=!
OWNER_NUMBERS=919XXXXXXXXX        # comma separated, no '+', no spaces
```

> `OWNER_NUMBERS` is **required in production**. Leave `NODE_ENV=development` if you want to
> skip that check while testing.

Full reference (see `.env.example` for comments):

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `production` | `production` enforces `OWNER_NUMBERS`; `development` relaxes it |
| `BOT_PREFIX` | `!` | Command prefix |
| `OWNER_NUMBERS` | *(required in prod)* | Owner phone numbers, comma separated, no `+`, no spaces |
| `ADMIN_NUMBERS` | *(empty)* | Extra admin numbers (same privileges as owners for ad config) |
| `AUTH_DATA_PATH` | `.wwebjs_auth` | WhatsApp LocalAuth session folder — keep it persistent |
| `DATABASE_PATH` | `./database/bot.sqlite` | SQLite database file |
| `LOCK_FILE` | `./.bot.lock` | Single-instance lock file |
| `TMP_DIR` / `CACHE_DIR` / `LOG_DIR` | `./tmp` / `./cache` / `./logs` | Scratch, media cache and log folders |
| `LOG_LEVEL` / `LOG_PRETTY` | `info` / `false` | `debug\|info\|warn\|error\|silent`; pretty-print for dev |
| `MAX_AUDIO_MB` | `16` | Max audio file size sent to WhatsApp |
| `MAX_AUDIO_DURATION_SECONDS` | `600` | Longest accepted track |
| `DOWNLOAD_TIMEOUT_MS` | `600000` | Timeout per download job (ms) |
| `DOWNLOAD_CONCURRENCY` | `2` | Max simultaneous download jobs |
| `SEARCH_RESULTS` | `5` | YouTube candidates considered per search |
| `LYRICS_API_URL` / `LYRICS_TIMEOUT_MS` | `https://lrclib.net/api` / `15000` | Lyrics backend |
| `ANTISPAM_ENABLED` / `ANTISPAM_WINDOW_SECONDS` / `ANTISPAM_MAX_MESSAGES` | `true` / `10` / `6` | Rate limiting |
| `ANTISPAM_ACTION` | `delete` | `delete \| warn \| mute \| kick` |
| `ANTISPAM_MUTE_SECONDS` | `300` | Temp-mute duration for the `mute` action |
| `ADVERTISEMENTS_ENABLED` / `DEFAULT_ADS_PER_DAY` / `AD_MAX_MESSAGE_LENGTH` | `true` / `2` / `1000` | Ad master switch, ads/day (2–5), max ad length |
| `CACHE_TTL_SECONDS` / `CACHE_MAX_FILES` | `3600` / `20` | Short-lived audio cache TTL and cap |
| `MAX_COMMAND_LENGTH` | `512` | over-long messages are ignored, never executed |
| `HEALTH_HOST` / `HEALTH_PORT` | `127.0.0.1` / `3000` | Local HTTP health endpoint (localhost only) |
| `BROWSER_HEADLESS` / `BROWSER_EXECUTABLE_PATH` / `BROWSER_ARGS` | `true` / *(empty)* / hardened defaults | Puppeteer/Chromium settings |
| `VOICE_CALL_ENABLED` | `false` | Master switch for live `!play` voice calls (`true` in `.env.example`) |
| `VOICE_CALL_START_TIMEOUT_MS` / `VOICE_CALL_CONNECT_TIMEOUT_MS` | `30000` / `30000` | Call create / connect timeouts |
| `VOICE_CALL_MAX_DURATION_SECONDS` | `600` | Hard cap per `!play` playback |
| `VOICE_CALL_STREAM_HOST` / `VOICE_CALL_STREAM_PORT` | `127.0.0.1` / `38980` | Local PCM stream fed to the browser as mic input |
| `MAX_RECONNECT_ATTEMPTS` | `15` | Reconnect cap with exponential backoff |

**Never commit `.env`** — it is gitignored. Commit `.env.example` only.

---

## 5. Running

```bash
npm start          # production
npm run dev        # development (auto-restart on file change)
```

Available npm scripts:

| Script | What it runs |
|---|---|
| `npm start` | `node src/app.js` — production bot |
| `npm run dev` | `node --watch src/app.js` — auto-restart on change |
| `npm test` | `node --test` — full unit suite (external calls mocked) |
| `npm run test:watch` | test suite in watch mode |
| `npm run lint` | `eslint .` |
| `npm run check` | `node --check src/app.js` — syntax check |

Before connecting, the bot validates configuration, acquires a single-instance lock
(`.bot.lock`; a second process exits with *"Another bot instance is already using this
session"*), opens the SQLite database and runs migrations.

---

## 6. First login (QR code)

1. Start the bot: `npm start`
2. Wait for the QR code to be printed in the terminal:
   ```
   [info] Scan this QR code using WhatsApp -> Linked Devices -> Link a Device
   ```
3. In WhatsApp on your phone: **Settings → Linked Devices → Link a Device**
   (if the QR expires, the bot prints a new one automatically)
4. Scan the QR. You should then see:
   ```
   [info] WhatsApp authenticated. Session stored.
   [info] Bot is ready. Session: <number>@c.us
   ```
5. The session is saved into `AUTH_DATA_PATH` (`.wwebjs_auth`). On later restarts the bot
   **skips the QR step** and reuses it.

> Deleting `.wwebjs_auth` (or its Docker volume) **forces re-authentication** — keep it
> persistent for production so you do not need to rescan.

In a group, make the bot a **group admin** for moderation features (delete messages, kick
banned users, remove spam). Music and lyrics work without admin rights.

---

## 7. Commands

Prefix is configurable via `BOT_PREFIX` (default `!`). 27 commands total
(`!find` is an alias of `!song`).

```
╔══════════════════════════════╗
         🎵 WHATSAPP BOT
╚══════════════════════════════╝

🎵 MUSIC
!song <name>          search & send a song as audio
!find <name>          alias for !song
!lyrics <name>        lyrics by title
!lyrics Artist - Title

📞 LIVE PLAYBACK (groups only, needs VOICE_CALL_ENABLED=true)
!play <name>          start a live group voice call and stream the song
                      (auto-falls back to an audio message if a live call
                      cannot be established)
!stop                 stop the live voice-call playback
!pause                pause the live playback
!resume               resume the paused playback
!skip                 stop the current live playback
!playing              show what is currently playing
!voicestatus          voice-call backend status / diagnostics

ℹ️ GENERAL
!menu                 this menu
!help [command]       help for one command (e.g. !help song)
!ping                 liveness check
!stats                bot statistics (admin)

🛡️ ADMIN (group-only moderation, group admin + bot admin required)
!kick @user           remove a user from the group
!mute @user           mute (their messages are auto-deleted)
!unmute @user
!ban @user            ban; auto-removed again if they rejoin
!unban @user
!antispam on|off|status

📢 ADVERTISEMENTS (owner / ADMIN_NUMBERS only)
!setad <message>      configure the ad message
!adinterval <2-5>     ads per day (2-5, schedule is randomized daily)
!ads                  current ad configuration + today's schedule
!adstart / !adstop    enable / disable the ad scheduler
!adstatus             schedule status + targets
!adgroups             list groups & ad toggle state
!adtoggle             disable/enable ads for this group
```

Rules:

- **Music/lyrics**: allowed in DMs and groups, for everyone.
- **Live playback** (`!play` family): groups only; requires `VOICE_CALL_ENABLED=true` and a
  WhatsApp Web account with calling enabled — otherwise the bot sends a normal audio
  message and says so (it never pretends a live call happened).
- **Moderation**: group-only, requires group admin rights **and** the bot to be a group admin.
- **Ad config**: owner / configured admin numbers only (`OWNER_NUMBERS`, `ADMIN_NUMBERS`).
- **Unknown / malformed commands**: answered with a friendly usage hint, never a stack trace.

---

## 8. Architecture & project structure

```
whatsapp-bot/
├── src/
│   ├── app.js                 # bootstrap: config, lock, db, listeners, reconnect, shutdown
│   ├── config.js              # zod-validated environment configuration
│   ├── client.js              # whatsapp-web.js Client factory (LocalAuth)
│   ├── commandManager.js      # registry, aliases, permissions, error handling, logging
│   ├── commands/
│   │   ├── general/           # menu, help, ping
│   │   ├── music/             # song (+find alias), play, stop, pause, resume,
│   │   │                      # skip, playing, lyrics
│   │   ├── admin/             # kick, mute, unmute, ban, unban, setad, adinterval,
│   │   │                      # ads, adstatus, adgroups, adtoggle, adstart, adstop,
│   │   │                      # stats, voicestatus, helpers
│   │   └── moderation/        # antispam
│   ├── services/
│   │   ├── dbService.js       # SQLite access layer (no raw SQL in commands)
│   │   ├── musicService.js    # search → download → convert → send pipeline + cache
│   │   ├── audioService.js    # yt-dlp search/download, ffmpeg convert, size/duration checks
│   │   ├── lyricsService.js   # LRCLIB integration, retries, sanitization
│   │   ├── permissionService.js  # OWNER / ADMIN / GROUP_ADMIN levels
│   │   ├── antiSpamService.js # rate tracking + actions, in-memory cleanup
│   │   ├── adService.js       # ad config, interval validation, daily schedule generation
│   │   └── voiceCallService.js# live group-call streaming + audio-message fallback
│   ├── listeners/
│   │   ├── messageListener.js     # orchestrates moderation → anti-spam → commands
│   │   ├── moderationListener.js  # deletes muted users' messages
│   │   └── participantListener.js # anti-join ban enforcement, group leave/update sync
│   ├── scheduler/adScheduler.js   # node-cron minute tick, slot claiming, failure counters
│   ├── health/server.js           # GET /health, GET /health/ready (localhost only)
│   ├── database/
│   │   ├── schema.js          # migrations (SQLite user_version based)
│   │   └── migrations/        # incremental SQL migrations
│   └── utils/                     # logger, parser, validators, formatter, cleanup,
│                                  # tempMute, instanceLock, groupSync, messageContext,
│                                  # retry, random, errors
├── tests/                    # node --test unit tests (external calls are mocked)
├── database/                 # bot.sqlite (WAL) — persisted, gitignored
├── .wwebjs_auth/             # WhatsApp session — persisted, gitignored
├── .wwebjs_cache/            # WhatsApp Web version cache — gitignored
├── tmp/                      # download/converted scratch space, cleaned on boot/exit
├── cache/                    # short-lived audio cache (TTL-based, size-capped)
├── logs/                     # bot.log / error.log (json lines)
├── patches/                  # patch-package patches (TRACKED — needed by postinstall)
├── deploy/whatsapp-bot.service   # systemd unit example
├── Dockerfile / docker-compose.yml
├── eslint.config.js
└── .env.example              # copy to .env (tracked template; .env itself is ignored)
```

Key design decisions:

- **Command plugins** are plain objects (`{ name, aliases, description, usage, example,
  category, adminOnly, groupOnly, minArgs, execute }`) auto-loaded from `src/commands/`.
  Adding a command = adding one file.
- **All SQL lives in `dbService`**; commands never touch SQLite directly.
- **Downloads** are keyed by video id only (`%(id)s` pattern, `<random>.<videoId>`) — user
  input never reaches the shell or filesystem paths. `ffmpeg`/`yt-dlp` are spawned with
  argument arrays, never string concatenation.
- **Temporary files** live under `tmp/downloads` and `tmp/converted`, are renamed/copied
  with collision-safe names, and are removed after send, on failure, and on shutdown.
- **`patches/` must stay committed** — `npm install` runs `patch-package` (postinstall)
  to apply the `whatsapp-web.js` patch.

---

## 9. How the music pipeline works

```
!song <name>
   └─ search YouTube via yt-dlp (ytsearch)
        └─ pick shortest qualifying result (duration ≤ MAX, not live)
             └─ download bestaudio only
                  └─ FFmpeg → MP3 128kbps, capped at MAX_AUDIO_DURATION_SECONDS
                       └─ validate size ≤ MAX_AUDIO_MB
                            └─ WhatsApp audio message (+ title/artist/duration metadata)
                                 └─ temp file removed, cache copy kept with TTL
```

- Concurrency limited to `DOWNLOAD_CONCURRENCY` jobs (default 2).
- `DOWNLOAD_TIMEOUT_MS` bounds every download; YT/network failures return friendly messages.
- A short-lived cache (`cache/`, default TTL 1h, max 20 files) avoids re-downloading the
  same title repeatedly; stale files are purged on a timer.
- All external calls (search, download, lyrics API) are wrapped so **one failure never
  crashes the bot**.

---

## 10. Live voice-call playback (`!play`)

When `VOICE_CALL_ENABLED=true`, `!play <name>` downloads the track exactly like `!song`
and then, instead of sending a file, starts a **real WhatsApp group voice call** from the
web client and streams the song live as the call's microphone input:

```
!play <name>
   └─ download + convert (same pipeline as !song)
        └─ create group voice call via the page bridge
             └─ stream decoded PCM over local HTTP (127.0.0.1:38980)
                  └─ browser mic receives it (fake-device flags, autoplay allowed)
                       └─ !pause / !resume / !skip / !stop / !playing / !voicestatus
```

- Requires a WhatsApp Web account with calling enabled. If the call cannot be created
  (account without calling, timeout, not a group), the bot **falls back to sending a normal
  audio message in the same group** and tells you — it never claims a live call happened
  when it didn't.
- Group-only: `!play` in a DM is rejected with a friendly error.
- Bounded by `VOICE_CALL_START_TIMEOUT_MS`, `VOICE_CALL_CONNECT_TIMEOUT_MS` and
  `VOICE_CALL_MAX_DURATION_SECONDS`.
- When enabled, these Chromium flags are added automatically:
  `--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream`,
  `--autoplay-policy=no-user-gesture-required`,
  `--unsafely-treat-insecure-origin-as-secure=http://<STREAM_HOST>:<STREAM_PORT>`.

---

## 11. Production deployment

### Recommended: systemd (single server, no containers)

```bash
# 1. Create a dedicated user and layout
sudo useradd --system --home /opt/whatsapp-bot --shell /usr/sbin/nologin whatsappbot
sudo mkdir -p /opt/whatsapp-bot
sudo chown -R whatsappbot:whatsappbot /opt/whatsapp-bot

# 2. Deploy the app (as your user)
#    git clone ... /opt/whatsapp-bot && cd /opt/whatsapp-bot && npm ci --omit=dev
#    cp .env.example .env && nano .env

# 3. Install the unit (edit paths if needed)
sudo cp deploy/whatsapp-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now whatsapp-bot

# 4. First login: watch the QR
sudo journalctl -u whatsapp-bot -f      # scan QR shown in the logs
sudo systemctl status whatsapp-bot      # expect "Bot is ready"
```

The unit restarts on failure, starts after the network is up, runs as a non-root user,
loads `.env`, and keeps auth/database/logs under `/opt/whatsapp-bot`.

### Alternative: Docker Compose

```bash
cp .env.example .env   # fill in OWNER_NUMBERS at least
docker compose up -d --build
docker compose logs -f whatsapp-bot     # scan the QR once
curl -s http://127.0.0.1:3000/health    # {"status":"ok","whatsapp":"ready",...}
```

- The image includes Node 22, FFmpeg, Chromium and its dependencies.
- **Named volumes** persist `.wwebjs_auth`, `database`, `logs`, `tmp`, `cache` across
  rebuilds.
- ⚠️ Because the session lives in a volume, **the bot keeps the exact same WhatsApp login
  even when you rebuild** — that is intentional. To force re-authentication:
  `docker compose down` then `docker volume rm whatsapp-bot_auth_data` (or use a bind mount
  and delete the folder).

### Alternative: PM2

```bash
npm i -g pm2
pm2 start src/app.js --name whatsapp-bot -i 1 --max-memory-restart 512M
pm2 save && pm2 startup     # survive reboots
pm2 logs whatsapp-bot       # scan the QR on first run
```

> Run **exactly one instance** — the bot refuses to start twice against the same session
> (`.bot.lock` single-instance protection).

---

## 12. Persistence, backup & restart semantics

Everything below **survives restarts** (Node restart, container restart, crash):

- WhatsApp session (`AUTH_DATA_PATH`) — QR needed only once
- `muted_users` and `banned_users` records
- Advertisement message, interval, enabled state
- Daily ad schedule (already-sent slots are not resent after a restart)
- Groups (active flag, per-group ad toggle), command/moderation logs, statistics counters

What does *not* persist: in-memory anti-spam counters (by design) and temporary/cache media
files (cleaned on boot and shutdown).

### Backup

Back up these three things (stop the bot first so SQLite WAL checkpoints cleanly):

```bash
# 1. Stop the bot (systemd example)
sudo systemctl stop whatsapp-bot

# 2. Copy session + database + config
cp -r .wwebjs_auth /backup/whatsapp-bot/
cp database/bot.sqlite /backup/whatsapp-bot/
cp .env /backup/whatsapp-bot/env.backup   # secrets — store safely, never commit

# 3. Start again
sudo systemctl start whatsapp-bot
```

To restore: put the three back in place and start the bot — no QR rescan needed.
`tmp/`, `cache/` and `logs/` never need backing up.

---

## 13. Health check & logging

- `GET http://127.0.0.1:3000/health` → `{"status":"ok","whatsapp":"ready|connecting","uptime":N}`
- `GET /health/ready` → `200` when ready, `503` while starting (for orchestration probes)
- The health server binds **localhost only** (`HEALTH_HOST=127.0.0.1`) — behind Docker it is
  published as `127.0.0.1:3000:3000`, and the image has a `HEALTHCHECK` on `/health`.
- Structured JSON logs (pino) to stdout and `logs/bot.log`; errors also go to
  `logs/error.log`. Verbosity via `LOG_LEVEL`; `LOG_PRETTY=true` for human-readable dev output.

---

## 14. Testing

```bash
npm test        # node --test — ~197 tests, no live network calls
npm run test:watch
npm run lint    # eslint
```

Coverage highlights: DB mute/ban/unmute + duplicates, permission levels & bot-admin checks,
command parsing (aliases, case, missing args), anti-spam thresholds/cooldown/cleanup + temp
mutes, ad interval validation (2–5 accepted, 1/6 rejected), duplicate-schedule prevention,
group-join notification parsing, ad-scheduler failure handling, lyrics (escape/404/rate
limit/retry), music search/selection with mocked downloader, and voice-call
playback/fallback plus `!stop|pause|resume|skip|playing|voicestatus` behavior.

All external I/O (YouTube, LRCLIB, WhatsApp client, browser bridge) is mocked —
the suite runs offline.

---

## 15. Troubleshooting

**QR does not appear**
Ensure your terminal supports ANSI (or check the logs — QR is also logged as `qr` event
output only if `LOG_LEVEL=info` shows the *prompt*, not the QR itself; run interactively
with `npm start` and a real TTY). Chromium must be able to start: on bare servers install
`chromium` + dependencies listed in section 3.

**Session expired / "asks for QR again"**
WhatsApp Web sessions can be revoked from the phone (`Linked Devices → Remove`). Delete
`.wwebjs_auth` and scan again. If it keeps looping, see *Reconnect loop* below.

**Chromium startup failure**
Verify a browser runs as the service user. Common fixes:
- Install Chromium package and set `BROWSER_EXECUTABLE_PATH=/usr/bin/chromium`
- Keep `--no-sandbox` in `BROWSER_ARGS` when running as root/inside Docker

**FFmpeg not found**
`sudo apt install ffmpeg`, restart the bot. Without FFmpeg the bot starts but `!song`
replies that audio processing is unavailable.

**Audio download failure**
Usually network/YouTube-side. Check `logs/bot.log` for `audio download failed`; retry later.
`MAX_AUDIO_MB` / `MAX_AUDIO_DURATION_SECONDS` removals produce explicit "too large/too long"
messages. Increase `DOWNLOAD_TIMEOUT_MS` if large tracks time out.

**`!play` falls back to an audio message instead of a live call**
Expected when the account has no web calling yet, when `VOICE_CALL_ENABLED=false`, or when
call setup times out (`VOICE_CALL_*_TIMEOUT_MS`). Check `!voicestatus` output and
`logs/bot.log` for `live playback unavailable`. The fallback message is sent in the same
group, never a DM.

**Bot cannot kick / cannot delete messages**
The bot must be a **group admin**. Also, WhatsApp refuses deleting messages that are
older/not deletable — the bot logs the failure and continues.

**Advertisements not sending**
Check `!ads`/`!adstatus`: is a message configured (`!setad`), is the scheduler enabled
(`!adstart`), are there active target groups (`!adgroups`)? Verify the bot is still in the
group and didn't exceed failing thresholds (a group is automatically disabled after 3
consecutive delivery failures — re-enable with `!adtoggle`).

**Database locked**
The bot uses WAL + `busy_timeout=5000`, so locks are rare. If SQLite reports `SQLITE_BUSY`
repeatedly, you are probably running **two instances** — see below.

**Reconnect loop**
Cap is `MAX_RECONNECT_ATTEMPTS` (default 15) with exponential backoff. If the loop coincides
with QR prompts, the WhatsApp session is being rejected: delete `AUTH_DATA_PATH` and re-login.
If it's a network outage, backoff handles it; the health endpoint reports `connecting`.

**Two bot instances**
The single-instance lock prints *"Another bot instance is already using this session"* and
exits. If a previous process died uncleanly, delete the stale `.bot.lock` file.

**Left-over temp files**
`tmp/downloads` and `tmp/converted` are purged at startup and on graceful shutdown, and each
download removes its own files on success or failure.

---

## 16. Updating

```bash
cd /opt/whatsapp-bot   # or your checkout
git pull
npm ci                 # re-applies patches/ via postinstall
npm run lint && npm test
sudo systemctl restart whatsapp-bot   # or: docker compose up -d --build
```

After updating, verify `curl -s http://127.0.0.1:3000/health` reports `"whatsapp":"ready"`.

---

## 17. Contributing

1. Fork and create a feature branch.
2. A new command = one file under `src/commands/<category>/` exporting
   `{ name, aliases, description, usage, example, category, adminOnly, groupOnly,
   minArgs, execute }` — no other wiring needed (auto-loaded).
3. Keep all SQL inside `src/services/dbService.js`; never touch SQLite from commands.
4. Spawn external tools with argument arrays (never shell strings); keep user input out of
   file paths (key downloads by video id).
5. Add/extend a test under `tests/` (external I/O must be mocked) and run
   `npm run lint && npm test` before opening a PR.

---

## 18. Legal & compliance

- This project does **not** bypass DRM, authentication walls, private content or access
  controls. It only fetches publicly available audio.
- You are responsible for copyright compliance and for the terms of service of YouTube,
  WhatsApp and any other service involved.
- Automated WhatsApp usage can lead to account restrictions — use a dedicated number and
  keep volumes low (rate limits are built in; respect them).

---

## 19. License

MIT — use at your own risk. See `package.json`.
=======
# Whatsapp-music_bot
>>>>>>> c28a1aecc0eb72cb048d91e706382d1288702a9b
# wp-music-bot
