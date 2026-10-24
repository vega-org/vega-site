import type { MediaSourceDescriptor, MediaTrack, ExternalSubtitleDescriptor } from '../core/media';
import type { PlaybackState, DiagnosticsStats, PlaybackError } from '../core/playback-state';

export interface PlayerEngineEvents {
  onStateChange?: (state: Partial<PlaybackState>) => void;
  onError?: (error: PlaybackError) => void;
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onTracksChange?: (tracks: { audio: MediaTrack[]; subtitle: MediaTrack[]; video: MediaTrack[] }) => void;
}

export interface PlayerEngine {
  readonly id: string;
  attach(container: HTMLDivElement): void;
  detach(): void;
  load(source: MediaSourceDescriptor): Promise<void>;
  unload(): Promise<void>;
  play(): Promise<void>;
  resumeAudio(): Promise<void>;
  pause(): Promise<void>;
  seek(seconds: number): Promise<void>;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  setPlaybackRate(rate: number): void;
  selectAudioTrack(trackId: number): Promise<void>;
  selectSubtitleTrack(trackId: number): Promise<void>;
  setSubtitleEnabled(enabled: boolean): Promise<void>;
  setSubtitleDelay(seconds: number): void;
  loadExternalSubtitle(subtitle: ExternalSubtitleDescriptor): Promise<number>;
  getAudioTracks(): MediaTrack[];
  getSubtitleTracks(): MediaTrack[];
  getVideoTracks(): MediaTrack[];
  getDiagnostics(): DiagnosticsStats;
  destroy(): Promise<void>;
  setEventListeners(events: PlayerEngineEvents): void;
}
