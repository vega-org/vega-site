export type TrackType = 'video' | 'audio' | 'subtitle';

export interface MediaTrack {
  id: number;
  index: number;
  type: TrackType;
  label: string;
  language?: string;
  title?: string;
  codec?: string;
  channels?: number;
  sampleRate?: number;
  width?: number;
  height?: number;
  selected: boolean;
}

export interface ExternalSubtitleDescriptor {
  source: string | File;
  lang?: string;
  title?: string;
}

export interface MediaSourceDescriptor {
  id: string;
  title?: string;
  source: string | File;
  format?: 'mkv' | 'mp4' | 'hls' | string;
  headers?: Record<string, string>;
  /** Receiver-owned access recovery can disable the engine's internal retries. */
  networkRetryCount?: number;
  torrent?: import('../delivery/torrentSource').TorrentOptions;
  startPosition?: number;
  audioTrackId?: number;
  subtitleTrackId?: number;
  externalSubtitles?: ExternalSubtitleDescriptor[];
}
