# WhatsApp Bot

**WhatsApp Bot** is a production-ready automation bot for WhatsApp built with Node.js 20+, whatsapp-web.js, SQLite, and yt-dlp with FFmpeg. It runs as a single long-lived process, connects through WhatsApp Web with a one-time QR login, and exposes everything through simple chat commands with a configurable prefix (default `!`).

Music is the core. `!song` searches YouTube, picks the shortest qualifying result, downloads best-quality audio only, converts it to MP3, enforces size and duration limits, sends it as a WhatsApp audio message, and cleans up temp files automatically. A short-lived cache avoids re-downloading repeat requests, downloads are concurrency-limited with per-job timeouts, and every failure returns a friendly chat message instead of crashing the bot.

`!play` takes it further with live group-call playback: the bot starts a real WhatsApp group voice call and streams the track as microphone input, with `!pause`, `!resume`, `!skip`, `!stop`, `!playing`, and `!voicestatus` controls. If the account has no web calling or setup times out, it honestly falls back to a normal audio message. Lyrics come from the free, keyless LRCLIB API via `!lyrics`.

For group owners, the bot adds moderation (`!kick`, `!mute`, `!unmute`, `!ban`, `!unban`) with persistent records and automatic re-removal of banned users who rejoin, plus configurable anti-spam with delete, warn, mute, or kick actions. The advertisement engine (`!setad`, `!adinterval`, `!adstart`, and more) sends 2–5 messages a day on a randomized, duplicate-safe schedule with per-group opt-out.

Under the hood: 27 auto-loaded command plugins, all SQL isolated in one service layer, argument-array process spawning, single-instance lock, exponential-backoff reconnects, graceful shutdown, structured JSON logging, localhost health endpoints, and around 197 offline unit tests with external I/O mocked. Deployment fits systemd, Docker Compose, or PM2. Commands are permission-aware: music and lyrics work for everyone in DMs and groups, moderation needs group-admin rights with the bot as admin, and ad settings are restricted to configured owner numbers, with unknown input answered by friendly usage hints.

Setup is `npm install`, copy `.env.example` to `.env`, set owner numbers, `npm start`, and scan the QR code once. Note: you are responsible for copyright compliance and WhatsApp automation limits — run it on a dedicated number.
