import type { PlaybackError } from '../core/playback-state';

export function normalizePlaybackError(error: unknown): PlaybackError {
  const timestamp = Date.now();
  const rawDetails = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
  const msg = error instanceof Error ? error.message : String(error);
  const lowerMsg = msg.toLowerCase();

  let category: PlaybackError['category'] = 'UNKNOWN_ERROR';
  let recoverable = false;

  if (/webtorrent is unsupported/.test(lowerMsg)) {
    category='TORRENT_UNSUPPORTED';
  } else if (/torrent/.test(lowerMsg)) {
    category='TORRENT_ERROR'; recoverable=true;
  } else if (/chunkloaderror|loading chunk .*failed|failed to fetch dynamically imported module/.test(lowerMsg)) {
    category='PLAYER_ASSET_ERROR';
  } else if (/\bret:\s*-2097152\b/.test(lowerMsg)) {
    // libmedia cheap/error.ts: REQUEST_ERROR = -(1 << 21). This is a
    // worker/IPC request failure, not evidence of an unsupported container.
    category='PLAYER_INTERNAL_ERROR';
  } else if (/forbidden.*header|unsafe.*header|header.*not allowed|refused to set.*header/.test(lowerMsg)) {
    category = 'HEADERS_NOT_ALLOWED';
    recoverable = true;
  } else if (lowerMsg.includes('cors') || lowerMsg.includes('cross-origin')) {
    category = 'CORS_BLOCKED';
    recoverable = true;
  } else if (lowerMsg.includes('network') || lowerMsg.includes('failed to fetch') || lowerMsg.includes('offline') || lowerMsg.includes('timeout') || lowerMsg.includes('http')) {
    category = 'NETWORK_ERROR';
    recoverable = true;
  } else if (lowerMsg.includes('format') || lowerMsg.includes('container') || lowerMsg.includes('demux') || lowerMsg.includes('open stream failed')) {
    category = 'UNSUPPORTED_CONTAINER';
    recoverable = false;
  } else if (lowerMsg.includes('video') && (lowerMsg.includes('codec') || lowerMsg.includes('decode'))) {
    category = 'UNSUPPORTED_VIDEO_CODEC';
    recoverable = true;
  } else if (lowerMsg.includes('audio') && (lowerMsg.includes('codec') || lowerMsg.includes('decode'))) {
    category = 'UNSUPPORTED_AUDIO_CODEC';
    recoverable = true;
  } else if (lowerMsg.includes('decode') || lowerMsg.includes('decoder')) {
    category = 'DECODER_FAILURE';
    recoverable = true;
  } else if (lowerMsg.includes('seek')) {
    category = 'SEEK_FAILURE';
    recoverable = true;
  }

  return {
    category,
    message: msg || 'An unknown playback error occurred',
    recoverable,
    timestamp,
    rawDetails,
  };
}
