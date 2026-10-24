import type { MediaSourceDescriptor, ExternalSubtitleDescriptor } from '../core/media';
import { initialPlaybackState, type PlaybackState } from '../core/playback-state';
import type { PlayerEngine } from './PlayerEngine';
import { LibmediaEngine } from './LibmediaEngine';
import { normalizePlaybackError } from './errors';

export type StateListener = (state: PlaybackState) => void;

export class PlayerManager {
  private engine: PlayerEngine;
  private state: PlaybackState = { ...initialPlaybackState };
  private listeners: Set<StateListener> = new Set();
  private loadSequence = 0;

  constructor(engine?: PlayerEngine) {
    this.engine = engine || new LibmediaEngine();
    this.initEngineEvents();
  }

  attach(container: HTMLDivElement): void {
    this.engine.attach(container);
  }

  detach(): void {
    this.engine.detach();
  }

  getState(): PlaybackState {
    return this.state;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async load(source: MediaSourceDescriptor): Promise<void> {
    const seq = ++this.loadSequence;

    this.updateState({
      trackSwitching:null,qualities:[],selectedQualityId:null,qualityChanging:false,
      status: 'loading',
      currentTime: 0,
      duration: 0,
      buffered: 0,
      error: null,
      audioTracks: [],
      subtitleTracks: [],
      videoTracks: [],
      selectedAudioTrackId: null,
      selectedSubtitleTrackId: null,
      audioNeedsUserGesture: false,
    });

    try {
      await this.engine.load(source);
      if (this.loadSequence !== seq) {
        // Outdated load request superseded by newer one
        return;
      }
    } catch {
      if (this.loadSequence === seq) {
        // Error state already populated via event listener
      }
    }
  }

  async play(): Promise<void> {
    await this.engine.play();
  }

  async unload():Promise<void> {this.loadSequence++;await this.engine.unload();}

  setMuted(muted:boolean):void {this.engine.setMuted(muted);}

  async selectQuality(id:number):Promise<void>{
    try{await this.engine.selectQuality(id);}catch(error){this.updateState({error:normalizePlaybackError(error)});}
  }

  async resumeAudio(): Promise<void> {
    await this.engine.resumeAudio();
  }

  async pause(): Promise<void> {
    await this.engine.pause();
  }

  async togglePlay(): Promise<void> {
    if (this.state.status === 'playing'||this.state.status === 'buffering') {
      await this.pause();
    } else {
      await this.play();
    }
  }

  async seek(seconds: number): Promise<void> {
    const clamped = Math.max(0, Math.min(seconds, this.state.duration || seconds));
    await this.engine.seek(clamped);
  }

  async seekRelative(deltaSeconds: number): Promise<void> {
    const target = (this.state.currentTime || 0) + deltaSeconds;
    await this.seek(target);
  }

  setVolume(volume: number): void {
    this.engine.setVolume(volume);
    if(volume>0&&this.state.isMuted)this.engine.setMuted(false);
  }

  toggleMute(): void {
    this.engine.setMuted(!this.state.isMuted);
  }

  setPlaybackRate(rate: number): void {
    this.engine.setPlaybackRate(rate);
  }

  private async switchTrack(type:'audio'|'subtitle',id:number,operation:()=>Promise<void>):Promise<void>{
    const pending={type,id};const source=this.loadSequence;
    this.updateState({trackSwitching:pending,error:null});
    try{await operation();}catch(error){if(source===this.loadSequence)this.updateState({error:normalizePlaybackError(error)});}
    finally{if(this.state.trackSwitching===pending)this.updateState({trackSwitching:null});}
  }

  async selectAudioTrack(trackId: number): Promise<void> {
    await this.switchTrack('audio',trackId,()=>this.engine.selectAudioTrack(trackId));
  }

  async selectSubtitleTrack(trackId: number): Promise<void> {
    await this.switchTrack('subtitle',trackId,()=>this.engine.selectSubtitleTrack(trackId));
  }

  async setSubtitleEnabled(enabled: boolean): Promise<void> {
    await this.switchTrack('subtitle',enabled?this.state.selectedSubtitleTrackId??0:-1,()=>this.engine.setSubtitleEnabled(enabled));
  }

  setSubtitleDelay(seconds: number): void {
    this.engine.setSubtitleDelay(seconds);
  }

  async loadExternalSubtitle(subtitle: ExternalSubtitleDescriptor): Promise<number> {
    try {
      return await this.engine.loadExternalSubtitle(subtitle);
    } catch (error) {
      this.updateState({ error: normalizePlaybackError(error) });
      return -1;
    }
  }

  getDiagnostics() {
    return this.engine.getDiagnostics();
  }

  async destroy(): Promise<void> {
    this.listeners.clear();
    await this.engine.destroy();
  }

  private initEngineEvents(): void {
    this.engine.setEventListeners({
      onStateChange: (partial) => {
        this.updateState(partial);
      },
      onTimeUpdate: (currentTime, duration) => {
        this.updateState({
          currentTime,
          duration: duration > 0 ? duration : this.state.duration,
        });
      },
      onTracksChange: (tracks) => {
        this.updateState({
          audioTracks: tracks.audio,
          subtitleTracks: tracks.subtitle,
          videoTracks: tracks.video,
        });
      },
      onError: (error) => {
        this.updateState({ error });
      },
    });
  }

  private updateState(partial: Partial<PlaybackState>): void {
    this.state = {
      ...this.state,
      ...partial,
      diagnostics: {
        ...this.state.diagnostics,
        ...(partial.diagnostics || {}),
      },
    };
    this.notify();
  }

  private notify(): void {
    this.listeners.forEach((fn) => fn(this.state));
  }
}
