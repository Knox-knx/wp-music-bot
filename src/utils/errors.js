// codes by: @LouisPy
export class BotError extends Error {
  constructor(message, { kind = 'bot_error', userFacing = true, cause = null } = {}) {
    super(message);
    this.name = 'BotError';
    this.kind = kind;
    this.userFacing = userFacing;
    if (cause) this.cause = cause;
  }
}

export class NoResultsError extends BotError {
  constructor(message = 'No results found. Try a different spelling or title.') {
    super(message, { kind: 'no_results' });
  }
}

export class TooLongError extends BotError {
  constructor(message = 'That track is longer than the configured maximum duration.') {
    super(message, { kind: 'too_long' });
  }
}

export class TooLargeError extends BotError {
  constructor(
    message = 'The audio file is too large to send on WhatsApp. Please try a shorter/smaller track.'
  ) {
    super(message, { kind: 'too_large' });
  }
}

export class FfmpegUnavailableError extends BotError {
  constructor() {
    super('FFmpeg is not installed on the server. Audio processing is unavailable.', {
      kind: 'ffmpeg_unavailable',
      userFacing: false,
    });
  }
}

export class SearchError extends BotError {
  constructor(message = 'Music search failed. Try again later.', cause = null) {
    super(message, { kind: 'search_failed', userFacing: false, cause });
  }
}

export class DownloadError extends BotError {
  constructor(message = 'Audio download failed. Try again later.', cause = null) {
    super(message, { kind: 'download_failed', userFacing: false, cause });
  }
}

export class ConvertError extends BotError {
  constructor(message = 'Audio conversion failed. Try again later.', cause = null) {
    super(message, { kind: 'convert_failed', userFacing: false, cause });
  }
}

export class LyricsError extends BotError {
  constructor(message = 'Lyrics service is unavailable. Try again later.', cause = null) {
    super(message, { kind: 'lyrics_failed', userFacing: false, cause });
  }
}

export class PermissionError extends BotError {
  constructor(message) {
    super(message, { kind: 'permission_denied' });
  }
}