import type { MediaTrack } from './media';

export type PlaybackStatus =
  | 'idle'
  | 'loading'
  | 'loaded'
  | 'playing'
  | 'paused'
  | 'seeking'
  | 'buffering'
  | 'ended'
  | 'error';

export interface DiagnosticsStats {
  streamStartTimes?:{type:string;id:number;startSeconds:number|null}[];
  subtitleDelaySeconds?:number;
  externalSubtitleSelected?:boolean;
  videoCodec?: string;
  audioCodec?: string;
  resolution?: string;
  frameRate?: number;
  decoderPath?: 'webcodecs' | 'mse' | 'wasm' | 'unknown';
  isHardwareAccelerated?: boolean | null;
  currentTime: number;
  duration: number;
  buffered: number;
  videoFrameDecodeCount?: number;
  videoFrameDropCount?: number;
  videoFrameRenderCount?: number;
  videoDecodeFramerate?: number;
  videoRenderFramerate?: number;
  videoEncodeFramerate?: number;
  videoPacketQueueLength?: number;
  audioPacketQueueLength?: number;
  bufferReceiveBytes?: number;
  videoStutter?: number;
  audioStutter?: number;
  videoFrameDecodeIntervalMax?: number;
  audioFrameDecodeCount?: number;
  audioFrameRenderCount?: number;
  audioDecodeErrorPacketCount?: number;
  audioSampleRate?: number;
  audioChannels?: number;
  audioCurrentTime?: number;
  videoCurrentTime?: number;
  avSyncDiffMs?: number | null;
}

export interface PlaybackError {
  category:
    | 'PLAYER_ASSET_ERROR'
    | 'PLAYER_INTERNAL_ERROR'
    | 'CORS_BLOCKED'
    | 'HEADERS_NOT_ALLOWED'
    | 'NETWORK_ERROR'
    | 'UNSUPPORTED_CONTAINER'
    | 'UNSUPPORTED_VIDEO_CODEC'
    | 'UNSUPPORTED_AUDIO_CODEC'
    | 'DECODER_FAILURE'
    | 'SEEK_FAILURE'
    | 'UNKNOWN_ERROR';
  message: string;
  recoverable: boolean;
  timestamp: number;
  rawDetails?: string;
}

export interface VideoQuality {id:number;label:string;width:number;height:number;bandwidth?:number;frameRate?:number;codec?:string}

export interface PlaybackState {
  qualities:VideoQuality[];
  selectedQualityId:number|null;
  qualityChanging:boolean;
  trackSwitching:{type:"audio"|"subtitle";id:number}|null;
  status: PlaybackStatus;
  currentTime: number;
  duration: number;
  buffered: number;
  volume: number;
  isMuted: boolean;
  audioNeedsUserGesture: boolean;
  playbackRate: number;
  videoTracks: MediaTrack[];
  audioTracks: MediaTrack[];
  subtitleTracks: MediaTrack[];
  selectedAudioTrackId: number | null;
  selectedSubtitleTrackId: number | null;
  subtitleEnabled: boolean;
  subtitleDelay: number;
  diagnostics: DiagnosticsStats;
  error: PlaybackError | null;
}

export const initialPlaybackState: PlaybackState = {
  trackSwitching:null,qualities:[],selectedQualityId:null,qualityChanging:false,
  status: 'idle',
  currentTime: 0,
  duration: 0,
  buffered: 0,
  volume: 1,
  isMuted: false,
  audioNeedsUserGesture: false,
  playbackRate: 1,
  videoTracks: [],
  audioTracks: [],
  subtitleTracks: [],
  selectedAudioTrackId: null,
  selectedSubtitleTrackId: null,
  subtitleEnabled: true,
  subtitleDelay: 0,
  diagnostics: {
    currentTime: 0,
    duration: 0,
    buffered: 0,
    decoderPath: 'unknown',
    isHardwareAccelerated: null,
  },
  error: null,
};
