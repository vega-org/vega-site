import AVPlayer, { Events } from '@libmedia/avplayer';
import {isTorrentSource} from '../delivery/torrentSource';
import type { MediaSourceDescriptor, MediaTrack, ExternalSubtitleDescriptor } from '../core/media';
import type { DiagnosticsStats, PlaybackState, PlaybackStatus } from '../core/playback-state';
import type { PlayerEngine, PlayerEngineEvents } from './PlayerEngine';
import { normalizePlaybackError } from './errors';
import { detectEnvironmentCapabilities } from './capabilities';
import {initialPlaybackState} from '../core/playback-state';

export class LibmediaEngine implements PlayerEngine {
  private readonly options:{wasmBaseUrl?:string};
  constructor(options:{wasmBaseUrl?:string}={}){this.options=options;}
  readonly id = 'libmedia';
  private player: AVPlayer | null = null;
  private container: HTMLDivElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private lastViewport:{player:AVPlayer;width:number;height:number}|null=null;
  private resizeViewport = (): void => {
    if(!this.container||!this.player)return;
    const {clientWidth:width,clientHeight:height}=this.container;
    if(width>0&&height>0){
      if(this.lastViewport?.player===this.player&&this.lastViewport.width===width&&this.lastViewport.height===height)return;
      this.lastViewport={player:this.player,width,height};
      this.player.resize(width,height);
    }
  };
  private events: PlayerEngineEvents = {};
  private currentSource: MediaSourceDescriptor | null = null;
  private torrentInput?: import('../delivery/TorrentInput').TorrentInput;

  private isDestroyed = false;
  private nativeAudioGestureRequired=false;
  private needsAudioGesture():boolean{
    if(!this.player)return false;
    // MSE uses its media element for sound; the shared Web Audio context can
    // remain suspended even while MSE audio is audible.
    return this.player.isMSE()?this.nativeAudioGestureRequired:this.player.isSuspended();
  }
  private currentVolume = 1;
  private isMuted = false;
  private currentPlaybackRate = 1;
  private coverVideo=false;
  setAspectFit(cover:boolean):void{this.coverVideo=cover;this.player?.setRenderMode(cover?1:0);}
  private currentSubtitleDelay = 0;
  private isSubtitleEnabled = true;
  private timelineOperations: Promise<void> = Promise.resolve();
  private sourceGeneration = 0;
  private playbackStatus:PlaybackStatus='idle';
  private progressTimer:ReturnType<typeof setInterval>|null=null;
  private lastProgressAt=0;
  private lastProgressTime=0;

  private emitState(partial:Partial<PlaybackState>):void {
    if(partial.status&&partial.status!==this.playbackStatus){
      this.playbackStatus=partial.status;
      if(partial.status==='playing'){
        this.lastProgressAt=performance.now();
        this.lastProgressTime=Number(this.player?.currentTime??0n);
      }
    }
    this.events.onStateChange?.(partial);
  }

  private inspectProgress(now=performance.now()):void {
    const player=this.player;
    if(!player||!['playing','buffering'].includes(this.playbackStatus))return;
    this.emitState({audioNeedsUserGesture:this.needsAudioGesture()});
    const status=player.getStatus();
    if(status===0||status===7){this.emitState({status:'ended'});return;}
    if(status===8){this.emitState({status:'paused'});return;}
    if(status===9||status===10||player.isSuspended()){
      this.lastProgressAt=now;this.lastProgressTime=Number(player.currentTime);return;
    }
    const time=Number(player.currentTime);
    const advancing=time>this.lastProgressTime;
    if(advancing||time<this.lastProgressTime)this.lastProgressAt=now;
    this.lastProgressTime=time;
    const stalled=now-this.lastProgressAt>=3000;
    this.emitState({
      ...(stalled?{status:'buffering' as const}:advancing?{status:'playing' as const}:{}),
      diagnostics:this.getDiagnostics(),
    });
  }

  private adaptiveAudio?:{player:AVPlayer;list:{lang:string;codec:string;bandwidth?:number}[];selectedIndex:number};
  private adaptiveAudioRequest=0;
  private async refreshAdaptiveAudio():Promise<void>{
    const player=this.player,generation=this.sourceGeneration;
    if(!player||typeof player.isHls!=='function'||(!player.isHls()&&!player.isDash()))return;
    const request=++this.adaptiveAudioRequest;
    const info=await player.getAudioList();
    if(this.player!==player||this.sourceGeneration!==generation||request!==this.adaptiveAudioRequest||!info?.list)return;
    this.adaptiveAudio=info.list.length?{player,...info}:undefined;this.extractTracks();
  }

  private adaptiveSubtitles?:{player:AVPlayer;list:{lang:string;codec:string}[];selectedIndex:number};
  private subtitleListRequest=0;
  private async refreshAdaptiveSubtitles():Promise<void>{
    const player=this.player,generation=this.sourceGeneration;
    if(!player||typeof player.isHls!=='function'||(!player.isHls()&&!player.isDash()))return;
    const request=++this.subtitleListRequest;
    const info=await player.getSubtitleList();
    if(this.player!==player||this.sourceGeneration!==generation||request!==this.subtitleListRequest||!info?.list)return;
    this.adaptiveSubtitles=info.list.length?{player,...info}:undefined;this.extractTracks();
  }

  private activeAudioTrackId: number | null = null;
  private activeSubtitleTrackId: number | null = null;
  private cachedTracks: { audio: MediaTrack[]; subtitle: MediaTrack[]; video: MediaTrack[] } = {
    audio: [],
    subtitle: [],
    video: [],
  };

  attach(container: HTMLDivElement): void {
    this.resizeObserver?.disconnect();
    this.container = container;
    if(typeof ResizeObserver!=='undefined'){
      this.resizeObserver = new ResizeObserver(this.resizeViewport);
      this.resizeObserver.observe(container);
    }
    if(typeof window!=='undefined')window.addEventListener('resize',this.resizeViewport);
    this.resizeViewport();
  }

  detach(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver=null;
    if(typeof window!=='undefined')window.removeEventListener('resize',this.resizeViewport);
    this.container = null;
  }

  setEventListeners(events: PlayerEngineEvents): void {
    this.events = events;
  }

  async load(source: MediaSourceDescriptor): Promise<void> {
    if(this.isDestroyed)throw new Error('Player engine has been destroyed');
    const generation=++this.sourceGeneration;
    const superseded=()=>generation!==this.sourceGeneration||this.isDestroyed;
    if (!this.container) {
      throw new Error('Cannot load media: player container is not attached');
    }

    // Clean up any previous player instance
    await this.cleanupPlayer();
    if(superseded())return;

    this.currentSource = source;
    this.emitState({
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
      qualities:[],selectedQualityId:null,qualityChanging:false,
    });

    try {
      let input: Parameters<AVPlayer['load']>[0] = source.source;
      if (isTorrentSource(source.source, source.format)) {
        const {TorrentInput} = await import('../delivery/TorrentInput');
        if (superseded()) return;
        const torrent = this.torrentInput = new TorrentInput(source.source, source.torrent);
        await torrent.open();
        if (superseded()) {await torrent.stop(); return;}
        input = torrent;
      }
      const caps = detectEnvironmentCapabilities();

      this.player = new AVPlayer({
        container: this.container,
        enableWebCodecs: caps.webCodecs,
        enableHardware: true,
        // In 1.3.1, non-shared-memory demux workers send serialized packets,
        // but SubtitleRender.pull() reads them as local memory pointers.
        // Disable that auxiliary-worker path; libmedia's shared-memory thread
        // pipelines remain available when the library supports them.
        enableWorker: false,
        enableAudioWorklet: caps.audioWorklet,
        wasmBaseUrl: this.options.wasmBaseUrl ?? 'https://cdn.jsdelivr.net/gh/zhaohappy/libmedia@1.3.1/dist',
      });

      this.setupPlayerEvents(generation);
      this.player.setRenderMode(this.coverVideo?1:0);

      // Configure load options
      const loadOptions: Record<string, unknown> = {};
      if(source.networkRetryCount!=null)loadOptions.ioLoaderOptions={retryCount:source.networkRetryCount};

      if (source.format && !this.torrentInput) {
        // Libmedia selects its HLS loader using the extension, including for
        // prepared blob URLs which no longer have a .m3u8 pathname.
        loadOptions.ext = /^(hls|mpegurl)$/i.test(source.format) ? 'm3u8' : source.format;
      }

      if (source.headers && Object.keys(source.headers).length > 0) {
        loadOptions.http = {
          headers: source.headers,
        };
      }

      if (source.externalSubtitles && source.externalSubtitles.length > 0) {
        loadOptions.externalSubtitles = source.externalSubtitles.map((s) => ({
          source: s.source,
          lang: s.lang,
          title: s.title,
        }));
      }

      // Load media source
      await this.player.load(input, loadOptions);
      if(superseded())return;

      // Extract tracks once file is analyzed
      this.extractTracks();
      void this.refreshQualities().catch(()=>{});
      void this.refreshAdaptiveAudio().catch(()=>{});
      void this.refreshAdaptiveSubtitles().catch(()=>{});

      // Restore volume & rate before playback starts.
      this.player.setVolume(this.isMuted ? 0 : this.currentVolume);
      this.player.setPlaybackRate(this.currentPlaybackRate);

      // Default streams and renderers must exist before switching tracks.
      await this.play();
      if(superseded())return;
      this.resizeViewport();

      if (source.startPosition && source.startPosition > 0) {
        await this.seek(source.startPosition);
        if(superseded())return;
      }

      // Respect initial audio track request
      if (typeof source.audioTrackId === 'number') {
        try {
          await this.selectAudioTrack(source.audioTrackId);
          if(superseded())return;
        } catch {
          // Ignore track switch error on load
        }
      }

      // Respect initial subtitle track request
      if (typeof source.subtitleTrackId === 'number') {
        try {
          await this.selectSubtitleTrack(source.subtitleTrackId);
          if(superseded())return;
        } catch {
          // Ignore track switch error on load
        }
      }

      // Enabling again would clear the subtitle queue that play() just filled.
      if (!this.isSubtitleEnabled) this.player.setSubtitleEnable(false);
      this.applySubtitleDelay();
    } catch (err) {
      if(superseded())return;
      await this.torrentInput?.stop(); this.torrentInput=undefined;
      const normalizedError = normalizePlaybackError(err);
      this.events.onError?.(normalizedError);
      this.emitState({
        status: 'error',
        error: normalizedError,
      });
      throw err;
    }
  }

  async play(): Promise<void> {
    await this.runTimelineOperation(async (player) => {
      if (player.isSuspended()) await player.resume();
      try {
        await player.play();
        if (!this.isSubtitleEnabled) player.setSubtitleEnable(false);
        this.extractTracks();
      void this.refreshQualities().catch(()=>{});
      void this.refreshAdaptiveAudio().catch(()=>{});
      void this.refreshAdaptiveSubtitles().catch(()=>{});
        this.emitState({
          status: 'playing',
          audioNeedsUserGesture: this.needsAudioGesture(),
          diagnostics: this.getDiagnostics(),
        });
      } catch (err) {
        this.emitState({ status: 'error' });
        throw err;
      }
    });
  }

  async unload(): Promise<void> {
    const generation=++this.sourceGeneration;
    await this.cleanupPlayer();
    if(generation!==this.sourceGeneration)return;
    this.currentSource=null;
    this.emitState({...initialPlaybackState,volume:this.currentVolume,isMuted:this.isMuted,playbackRate:this.currentPlaybackRate,subtitleEnabled:this.isSubtitleEnabled,subtitleDelay:this.currentSubtitleDelay});
  }

  async resumeAudio(): Promise<void> {
    if (!this.player) return;
    try {
      const player=this.player;
      await player.resume();
      // resume() races the browser operation against a 100ms timer. Give the
      // actual context state time to settle instead of requiring another click.
      if(!player.isMSE())for(let attempt=0;attempt<20&&player.isSuspended()&&this.player===player;attempt++)await new Promise(resolve=>setTimeout(resolve,50));
      if(this.player!==player)return;
      this.nativeAudioGestureRequired=false;
      this.emitState({ audioNeedsUserGesture: this.needsAudioGesture() });
    } catch (err) {
      const error = normalizePlaybackError(err);
      this.events.onError?.(error);
      this.emitState({ error });
    }
  }

  async pause(): Promise<void> {
    await this.runTimelineOperation(async (player) => {
      await player.pause();
      this.emitState({ status: 'paused' });
    });
  }

  async seek(seconds: number): Promise<void> {
    await this.runTimelineOperation(async (player) => {
      const wasPaused = player.getStatus() === 8; // AVPlayerStatus.PAUSED
      this.emitState({ status: 'seeking', error: null });
      const ms = BigInt(Math.max(0, Math.floor(seconds * 1000)));
      await player.seek(ms);
      // AVPlayer's seek restarts subtitle rendering, including when disabled.
      if (!this.isSubtitleEnabled) player.setSubtitleEnable(false);
      this.emitState({
        status: wasPaused ? 'paused' : 'playing',
        currentTime: Number(player.currentTime) / 1000,
        diagnostics: this.getDiagnostics(),
      });
    });
  }

  setVolume(volume: number): void {
    this.currentVolume = Math.max(0, Math.min(volume, 2));
    if (!this.isMuted && this.player) {
      this.player.setVolume(this.currentVolume);
    }
    this.emitState({
      volume: this.currentVolume,
      isMuted: this.isMuted,
    });
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.player) {
      this.player.setVolume(muted ? 0 : this.currentVolume);
    }
    this.emitState({
      isMuted: muted,
      volume: this.currentVolume,
    });
  }

  setPlaybackRate(rate: number): void {
    this.currentPlaybackRate = rate;
    if (this.player) {
      this.player.setPlaybackRate(rate);
    }
    this.emitState({ playbackRate: rate });
  }

  private async refreshQualities():Promise<void>{
    const player=this.player,generation=this.sourceGeneration;
    if(!player||typeof player.isHls!=='function'||(!player.isHls()&&!player.isDash()))return;
    const info=await player.getVideoList();
    if(this.player!==player||this.sourceGeneration!==generation||!info)return;
    this.emitState({qualities:info.list.map((entry,id)=>({id,label:entry.height?`${entry.height}p`:entry.width?`${entry.width}px`:`Quality ${id+1}`,width:entry.width,height:entry.height,bandwidth:entry.bandwidth,frameRate:entry.frameRate,codec:entry.codec})),selectedQualityId:info.selectedIndex>=0?info.selectedIndex:null});
  }

  async selectQuality(id:number):Promise<void>{
    await this.runTimelineOperation(async player=>{
      const info=await player.getVideoList();
      if(!Number.isInteger(id)||!info?.list[id])throw new Error('Video quality is unavailable');
      if(info.selectedIndex===id)return;
      this.emitState({qualityChanging:true});
      try{await player.selectVideo(id,true);await this.refreshQualities();}
      finally{this.emitState({qualityChanging:false});}
    });
  }

  async selectAudioTrack(trackId: number): Promise<void> {
    await this.runTimelineOperation(async (player) => {
      if(typeof player.isHls==='function'&&(player.isHls()||player.isDash())){
        const info=await player.getAudioList();
        if(info?.list?.length){
          if(!Number.isInteger(trackId)||!info.list[trackId])throw new Error(`Audio rendition ${trackId} is unavailable`);
          if(info.selectedIndex!==trackId){
            // Smooth switching waits for a future segment boundary and may not
            // complete while a VOD source is starved or paused. Libmedia's
            // immediate VOD path seeks/reconnects the rendition at current time.
            this.emitState({status:'buffering',error:null});
            try{await player.selectAudio(trackId,player.isLive());}
            finally{if(this.player===player)this.emitState({status:player.getStatus()===8?'paused':'playing'});}
          }
          await this.refreshAdaptiveAudio();this.applySubtitleDelay(player);
          if(this.adaptiveAudio?.selectedIndex!==trackId)throw new Error(`Audio rendition ${trackId} was not selected by libmedia`);
          return;
        }
      }
      if (player.getSelectedAudioStreamId() === trackId) return;
      if (!this.cachedTracks.audio.some((track) => track.id === trackId)) {
        throw new Error(`Audio track ${trackId} is unavailable`);
      }
      await this.changeTrackAtCurrentTime(player, async () => {
        await player.selectAudio(trackId);
        if (player.getSelectedAudioStreamId() !== trackId) {
          throw new Error(`Audio track ${trackId} was not selected by libmedia`);
        }
      });
    });
  }

  async selectSubtitleTrack(trackId: number): Promise<void> {
    await this.runTimelineOperation(async (player) => {
      if (trackId < 0) {
        player.setSubtitleEnable(false);
        this.isSubtitleEnabled = false;
      } else if((player.getExternalSubtitle() as {streamId?:number}[]).some(track=>track.streamId===trackId)){
        // Libmedia switches the external demux task and seeks it to the active
        // clock itself. A full A/V seek here is unnecessary and disruptive.
        if(player.getSelectedSubtitleStreamId()!==trackId)await player.selectSubtitle(trackId);
        if(player.getSelectedSubtitleStreamId()!==trackId)throw new Error(`External subtitle track ${trackId} was not selected by libmedia`);
        if(!this.isSubtitleEnabled)player.setSubtitleEnable(true);
        this.isSubtitleEnabled=true;
        this.applySubtitleDelay(player);
      } else if(typeof player.isHls==='function'&&(player.isHls()||player.isDash())){
        // The loader list can arrive after the initial demuxed tracks. Resolve
        // against the current playlist rather than treating stream IDs as indices.
        const previous=this.cachedTracks.subtitle.find(track=>track.id===trackId);
        const wasRendition=this.adaptiveSubtitles?.player===player;
        const info=await player.getSubtitleList();
        if(!info?.list?.length){
          if(player.getSelectedSubtitleStreamId()===trackId){
            if(!this.isSubtitleEnabled)player.setSubtitleEnable(true);
            this.isSubtitleEnabled=true;
          }else throw new Error('This HLS source has no selectable subtitle renditions; the requested track is not a registered external subtitle.');
        }else{
          let index=wasRendition?trackId:-1;
          if(!wasRendition&&previous?.language){
            const matches=info.list.map((entry,id)=>({entry,id})).filter(({entry})=>entry.lang.toLowerCase()===previous.language!.toLowerCase());
            if(matches.length===1)index=matches[0].id;
          }
          if(!Number.isInteger(index)||!info.list[index]){
            await this.refreshAdaptiveSubtitles();
            throw new Error('Subtitle rendition list changed. Select the language again.');
          }
          if(info.selectedIndex!==index)await player.selectSubtitle(index);
          if(!this.isSubtitleEnabled)player.setSubtitleEnable(true);
          this.isSubtitleEnabled=true;
          await this.refreshAdaptiveSubtitles();
          if(this.adaptiveSubtitles?.selectedIndex!==index)throw new Error(`Subtitle rendition ${index} was not selected by libmedia`);
        }
      } else {
        const track = this.cachedTracks.subtitle.find((entry) => entry.id === trackId);
        if (!track) throw new Error(`Subtitle track ${trackId} is unavailable`);
        if (player.getSelectedSubtitleStreamId() === trackId) {
          if(!this.isSubtitleEnabled)player.setSubtitleEnable(true);
          this.isSubtitleEnabled=true;this.extractTracks();this.emitState({subtitleEnabled:true});return;
        }
        await this.changeTrackAtCurrentTime(player, async () => {
          await player.selectSubtitle(trackId);
          if (player.getSelectedSubtitleStreamId() !== trackId) {
            throw new Error(`Subtitle track ${trackId} (codec ${track.codec ?? 'unknown'}) could not be selected; libmedia did not confirm the track change`);
          }
          this.isSubtitleEnabled = true;
        });
      }
      this.extractTracks();
      void this.refreshQualities().catch(()=>{});
      void this.refreshAdaptiveAudio().catch(()=>{});
      void this.refreshAdaptiveSubtitles().catch(()=>{});
      this.applySubtitleDelay(player);
      this.emitState({ subtitleEnabled: this.isSubtitleEnabled });
    });
  }

  async setSubtitleEnabled(enabled: boolean): Promise<void> {
    if (!enabled) {
      await this.selectSubtitleTrack(-1);
    } else {
      const id = this.adaptiveSubtitles?.player===this.player?this.adaptiveSubtitles!.selectedIndex:this.player?.getSelectedSubtitleStreamId() ?? -1;
      const trackId = id >= 0 ? id : this.cachedTracks.subtitle[0]?.id;
      if (trackId != null) await this.selectSubtitleTrack(trackId);
    }
  }

  private subtitleTimelineOffset(player=this.player):number{
    if(!player||typeof player.isHls!=='function'||!player.isHls())return 0;
    const external=(player.getExternalSubtitle() as {streamId?:number}[]).some(track=>track.streamId===player.getSelectedSubtitleStreamId());
    if(!external)return 0;
    const streams=player.getStreams();
    const selected=streams.find(stream=>stream.id===player.getSelectedAudioStreamId())||streams.find(stream=>stream.id===player.getSelectedVideoStreamId());
    const start=selected?.startTime,base=selected?.timeBase;
    if(start==null||start===-9223372036854775808n||!base?.den)return 0;
    const seconds=Number(start)*base.num/base.den;
    return Number.isFinite(seconds)?seconds:0;
  }

  private applySubtitleDelay(player=this.player):void{
    if(player)player.setSubtitleDelay(Math.round((this.currentSubtitleDelay+this.subtitleTimelineOffset(player))*1000));
  }

  setSubtitleDelay(seconds: number): void {
    this.currentSubtitleDelay = seconds;
    if (this.player) {
      this.applySubtitleDelay();
    }
    this.emitState({ subtitleDelay: seconds });
  }

  async loadExternalSubtitle(subtitle: ExternalSubtitleDescriptor): Promise<number> {
    if (!this.player) {
      throw new Error('Player is not initialized');
    }
    const existingIds = new Set(this.player.getStreams().map((stream) => stream.id));
    const result = await this.player.loadExternalSubtitle({
      source: subtitle.source,
      lang: subtitle.lang,
      title: subtitle.title,
    });
    // AVPlayer 1.3.1 returns a status (0), not the appended stream's ID.
    if (result < 0) throw new Error(`External subtitle load failed (${result})`);
    const stream = this.player.getStreams().find((entry) =>
      !existingIds.has(entry.id) && entry.mediaType.toLowerCase() === 'subtitle');
    if (!stream) throw new Error('No new subtitle track was added; the subtitle may already be loaded');
    this.extractTracks();
    await this.selectSubtitleTrack(stream.id);
    return stream.id;
  }

  getAudioTracks(): MediaTrack[] {
    return this.cachedTracks.audio;
  }

  getSubtitleTracks(): MediaTrack[] {
    return this.cachedTracks.subtitle;
  }

  getVideoTracks(): MediaTrack[] {
    return this.cachedTracks.video;
  }

  getDiagnostics(): DiagnosticsStats {
    if (!this.player) {
      return {
        currentTime: 0,
        duration: 0,
        buffered: 0,
        decoderPath: 'unknown',
        isHardwareAccelerated: null,
      };
    }

    const durationMs = Number(this.player.getDuration());
    const duration = durationMs > 0 ? durationMs / 1000 : 0;
    const currentMs = Number(this.player.currentTime);
    const currentTime = currentMs > 0 ? currentMs / 1000 : 0;

    let decoderPath: DiagnosticsStats['decoderPath'] = 'unknown';
    try {
      if (this.player.isMSE()) {
        decoderPath = 'mse';
      }
    } catch {
      decoderPath = 'unknown';
    }

    let statsObj: ReturnType<AVPlayer['getStats']> | null = null;
    try {
      statsObj = this.player.getStats();
    } catch {
      statsObj = null;
    }

    // Video stream info
    const activeVideo = this.cachedTracks.video.find((v) => v.selected) || this.cachedTracks.video[0];
    const activeAudio = this.cachedTracks.audio.find((a) => a.selected) || this.cachedTracks.audio[0];

    const resolution = activeVideo?.width && activeVideo?.height
      ? `${activeVideo.width}x${activeVideo.height}`
      : undefined;
    const count = (value: number | bigint | undefined): number | undefined =>
      value == null ? undefined : Number(value);
    const audioTime = activeAudio && statsObj?.audioCurrentTime != null
      && statsObj.audioCurrentTime >= 0n ? Number(statsObj.audioCurrentTime) : undefined;
    const videoTime = activeVideo && statsObj?.videoCurrentTime != null
      && statsObj.videoCurrentTime >= 0n ? Number(statsObj.videoCurrentTime) : undefined;

    const streamStartTimes=this.player.getStreams().filter(stream=>['audio','video','subtitle'].includes(stream.mediaType.toLowerCase())).map(stream=>{
      const value=stream.startTime;
      const seconds=value==null||value===-9223372036854775808n||!stream.timeBase?.den?null:Number(value)*stream.timeBase.num/stream.timeBase.den;
      return {type:stream.mediaType.toLowerCase(),id:stream.id,startSeconds:seconds!=null&&Number.isFinite(seconds)?seconds:null};
    });
    const externalSubtitleSelected=(this.player.getExternalSubtitle() as {streamId?:number}[]).some(track=>track.streamId===this.player!.getSelectedSubtitleStreamId());
    return {
      streamStartTimes,externalSubtitleSelected,subtitleDelaySeconds:this.currentSubtitleDelay,subtitleTimelineOffsetSeconds:this.subtitleTimelineOffset(),
      currentTime,
      duration,
      buffered: 0, // No buffered-range measurement is currently integrated.
      decoderPath,
      // Truthful: WebCodecs hardware decoding is not guaranteed by API existence alone
      isHardwareAccelerated: null,
      videoCodec: statsObj?.videocodec || activeVideo?.codec,
      audioCodec: statsObj?.audiocodec || activeAudio?.codec,
      resolution,
      audioChannels: activeAudio?.channels,
      audioSampleRate: activeAudio?.sampleRate,
      videoFrameDecodeCount: count(statsObj?.videoFrameDecodeCount),
      videoFrameDropCount: count(statsObj?.videoFrameDropCount),
      videoFrameRenderCount: count(statsObj?.videoFrameRenderCount),
      videoDecodeFramerate: count(statsObj?.videoDecodeFramerate),
      videoRenderFramerate: count(statsObj?.videoRenderFramerate),
      videoEncodeFramerate: count(statsObj?.videoEncodeFramerate),
      videoPacketQueueLength: count(statsObj?.videoPacketQueueLength),
      audioPacketQueueLength: count(statsObj?.audioPacketQueueLength),
      bufferReceiveBytes: count(statsObj?.bufferReceiveBytes),
      videoStutter: count(statsObj?.videoStutter),
      audioStutter: count(statsObj?.audioStutter),
      videoFrameDecodeIntervalMax: count(statsObj?.videoFrameDecodeIntervalMax),
      audioFrameDecodeCount: count(statsObj?.audioFrameDecodeCount),
      audioFrameRenderCount: count(statsObj?.audioFrameRenderCount),
      audioDecodeErrorPacketCount: count(statsObj?.audioDecodeErrorPacketCount),
      audioCurrentTime: audioTime == null ? undefined : audioTime / 1000,
      videoCurrentTime: videoTime == null ? undefined : videoTime / 1000,
      avSyncDiffMs: audioTime != null && videoTime != null ? videoTime - audioTime : null,
    };
  }

  getCurrentSource(): MediaSourceDescriptor | null {
    return this.currentSource;
  }

  getSubtitleDelay(): number {
    return this.currentSubtitleDelay;
  }

  async destroy(): Promise<void> {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.sourceGeneration++;
    this.detach();
    await this.cleanupPlayer();
    this.events = {};
  }

  private async cleanupPlayer(): Promise<void> {
    const torrent=this.torrentInput;this.torrentInput=undefined;
    await torrent?.stop();
    if(this.progressTimer!==null){clearInterval(this.progressTimer);this.progressTimer=null;}
    await this.timelineOperations;
    const player=this.player;
    if (player) {
      try {
        await player.destroy();
      } catch {
        // Player may already be stopped
      }
    }
    if(this.player!==player)return;
    this.player=null;this.nativeAudioGestureRequired=false;
    this.adaptiveAudio=undefined;this.adaptiveSubtitles=undefined;
    this.activeAudioTrackId = null;
    this.activeSubtitleTrackId = null;
    this.cachedTracks = { audio: [], subtitle: [], video: [] };
  }

  private setupPlayerEvents(generation:number): void {
    if (!this.player) return;
    const player=this.player;
    const current=()=>this.player===player&&generation===this.sourceGeneration&&!this.isDestroyed;
    this.progressTimer=setInterval(()=>{if(current())this.inspectProgress();},1000);

    this.player.on(Events.LOADING, () => {
      if(!current())return;
      this.emitState({ status: 'loading' });
    });

    this.player.on(Events.LOADED, () => {
      if(!current())return;
      this.extractTracks();
      void this.refreshQualities().catch(()=>{});
      void this.refreshAdaptiveAudio().catch(()=>{});
      void this.refreshAdaptiveSubtitles().catch(()=>{});
      const durationMs = Number(this.player?.getDuration() ?? 0);
      this.emitState({
        status: 'loaded',
        duration: durationMs > 0 ? durationMs / 1000 : 0,
      });
    });

    this.player.on(Events.PLAYING, () => {
      if(!current())return;
      this.extractTracks();
      void this.refreshQualities().catch(()=>{});
      void this.refreshAdaptiveAudio().catch(()=>{});
      void this.refreshAdaptiveSubtitles().catch(()=>{});
      this.emitState({
        status: 'playing',
        audioNeedsUserGesture: this.needsAudioGesture(),
      });
    });

    this.player.on(Events.RESUME, () => {
      if(!current())return;
      if(player.isMSE())this.nativeAudioGestureRequired=true;
      this.emitState({ audioNeedsUserGesture: this.needsAudioGesture() });
    });

    this.player.on(Events.AUDIO_CONTEXT_RUNNING, () => {
      if(!current())return;
      this.emitState({ audioNeedsUserGesture: false });
    });

    this.player.on(Events.PAUSED, () => {
      if(!current())return;
      this.emitState({ status: 'paused' });
    });

    this.player.on(Events.ENDED, () => {
      if(!current())return;
      this.emitState({ status: 'ended' });
    });

    this.player.on(Events.STOPPED,()=>{if(current())this.emitState({status:'ended'});});
    this.player.on(Events.TIMEOUT,()=>{
      if(current()&&['playing','buffering'].includes(this.playbackStatus))this.emitState({status:'buffering'});
    });

    this.player.on(Events.TIME, (pts: bigint) => {
      if(!current())return;
      const curSec = Number(pts) / 1000;
      const durSec = Number(this.player?.getDuration() ?? 0) / 1000;
      this.events.onTimeUpdate?.(curSec, durSec);
      this.emitState({
        currentTime: curSec,
        duration: durSec,
        diagnostics: this.getDiagnostics(),
      });
    });

    this.player.on(Events.STREAM_UPDATE, () => {
      if(!current())return;
      this.extractTracks();
      void this.refreshQualities().catch(()=>{});
      void this.refreshAdaptiveAudio().catch(()=>{});
      void this.refreshAdaptiveSubtitles().catch(()=>{});
    });

    this.player.on(Events.CHANGED, () => {
      if(!current())return;
      this.extractTracks();
      void this.refreshQualities().catch(()=>{});
      void this.refreshAdaptiveAudio().catch(()=>{});
      void this.refreshAdaptiveSubtitles().catch(()=>{});
    });

    this.player.on(Events.ERROR, (error: Error) => {
      if(!current())return;
      const normalized = normalizePlaybackError(error);
      this.events.onError?.(normalized);
      this.emitState({
        status: 'error',
        error: normalized,
      });
    });
  }

  private extractTracks(): void {
    if (!this.player) return;

    try {
      const streams = this.player.getStreams();
      if (!Array.isArray(streams)) return;

      const activeAudioId = this.player.getSelectedAudioStreamId();
      const activeSubtitleId = this.player.getSelectedSubtitleStreamId();
      const activeVideoId = this.player.getSelectedVideoStreamId();

      this.activeAudioTrackId = activeAudioId >= 0 ? activeAudioId : null;
      this.activeSubtitleTrackId = this.isSubtitleEnabled && activeSubtitleId >= 0 ? activeSubtitleId : null;

      const audio: MediaTrack[] = [];
      const subtitle: MediaTrack[] = [];
      const video: MediaTrack[] = [];

      streams.forEach((s) => {
        const metadata = s.metadata || {};
        const lang = metadata.language || metadata.lang || '';
        const title = metadata.title || metadata.handler_name || '';
        const codecpar = s.codecparProxy;
        // AVPlayer 1.3.1 returns "Audio", "Video" and "Subtitle".
        const mediaType = s.mediaType.toLowerCase();

        if (mediaType === 'audio') {
          const channels = codecpar.chLayout?.nbChannels;
          const trackLabel = this.buildAudioLabel(s.index, title, lang, {
            channels,
            sampleRate: codecpar.sampleRate,
          });
          audio.push({
            id: s.id,
            index: s.index,
            type: 'audio',
            label: trackLabel,
            language: lang,
            title,
            codec: codecpar.codecId ? String(codecpar.codecId) : undefined,
            channels,
            sampleRate: codecpar.sampleRate,
            selected: s.id === this.activeAudioTrackId,
          });
        } else if (mediaType === 'subtitle') {
          const trackLabel = this.buildSubtitleLabel(s.index, title, lang);
          subtitle.push({
            id: s.id,
            index: s.index,
            type: 'subtitle',
            label: trackLabel,
            language: lang,
            title,
            codec: codecpar.codecId ? String(codecpar.codecId) : undefined,
            selected: s.id === this.activeSubtitleTrackId,
          });
        } else if (mediaType === 'video') {
          video.push({
            id: s.id,
            index: s.index,
            type: 'video',
            label: `Video #${s.index + 1} (${codecpar.width || '?'}x${codecpar.height || '?'})`,
            width: codecpar.width,
            height: codecpar.height,
            codec: codecpar.codecId ? String(codecpar.codecId) : undefined,
            selected: s.id === activeVideoId,
          });
        }
      });

      if(this.adaptiveAudio?.player===this.player){
        const renditions=this.adaptiveAudio;
        this.activeAudioTrackId=renditions.selectedIndex>=0?renditions.selectedIndex:null;
        audio.splice(0,audio.length,...renditions.list.map((entry,index):MediaTrack=>({
          id:index,index,type:'audio',language:entry.lang||undefined,
          label:entry.lang||`Audio ${index+1}`,codec:entry.codec||undefined,
          selected:index===this.activeAudioTrackId,
        })));
      }
      if(this.adaptiveSubtitles?.player===this.player){
        const renditions=this.adaptiveSubtitles;
        this.activeSubtitleTrackId=this.isSubtitleEnabled&&renditions.selectedIndex>=0?renditions.selectedIndex:null;
        const externalIds=new Set((this.player.getExternalSubtitle() as {streamId?:number}[]).map(track=>track.streamId));
        const externalTracks=subtitle.filter(track=>externalIds.has(track.id));
        const externalSelected=externalIds.has(activeSubtitleId)&&this.isSubtitleEnabled;
        if(externalSelected)this.activeSubtitleTrackId=activeSubtitleId;
        subtitle.splice(0,subtitle.length,...renditions.list.map((entry,index):MediaTrack=>({
          id:index,index,type:'subtitle',language:entry.lang||undefined,label:entry.lang||`Subtitle ${index+1}`,
          codec:entry.codec||undefined,selected:!externalSelected&&index===this.activeSubtitleTrackId,
        })),...externalTracks);
      }
      this.cachedTracks = { audio, subtitle, video };
      this.events.onTracksChange?.(this.cachedTracks);
      this.emitState({
        audioTracks: audio,
        subtitleTracks: subtitle,
        videoTracks: video,
        selectedAudioTrackId: this.activeAudioTrackId,
        selectedSubtitleTrackId: this.activeSubtitleTrackId,
        diagnostics: this.getDiagnostics(),
      });
    } catch (err) {
      // A metadata integration failure must not look like a source without tracks.
      const error = normalizePlaybackError(err);
      this.events.onError?.(error);
      this.emitState({ error });
    }
  }

  private runTimelineOperation(operation: (player: AVPlayer) => Promise<void>): Promise<void> {
    const player = this.player;
    const generation=this.sourceGeneration;
    if (!player) return Promise.resolve();
    const pending = this.timelineOperations.then(async () => {
      if (this.player !== player || this.isDestroyed || generation!==this.sourceGeneration) return;
      await operation(player);
    });
    this.timelineOperations = pending.catch((err) => {
      const error = normalizePlaybackError(err);
      this.events.onError?.(error);
      this.emitState({ error });
    });
    return this.timelineOperations;
  }

  private async changeTrackAtCurrentTime(player: AVPlayer, change: () => Promise<void>): Promise<void> {
    const wasPlaying = player.getStatus() === 6; // AVPlayerStatus.PLAYED
    if (wasPlaying) await player.pause();
    const position = player.currentTime;
    this.emitState({ status: 'buffering', error: null });
    try {
      await change();
      // selectAudio in 1.3.1 can reconnect without flushing queued media.
      // Public seek resets both decoders/renderers and refills subtitle cues.
      if (!player.isLive()) await player.seek(position);
    } finally {
      this.applySubtitleDelay(player);
      if (wasPlaying) await player.play();
      // Both seek() and unpausing restart libmedia's subtitle loop.
      if (!this.isSubtitleEnabled) player.setSubtitleEnable(false);
      this.extractTracks();
      void this.refreshQualities().catch(()=>{});
      void this.refreshAdaptiveAudio().catch(()=>{});
      void this.refreshAdaptiveSubtitles().catch(()=>{});
      this.emitState({
        status: wasPlaying ? 'playing' : 'paused',
        subtitleEnabled: this.isSubtitleEnabled,
        audioNeedsUserGesture: this.needsAudioGesture(),
        diagnostics: this.getDiagnostics(),
      });
    }
  }

  private buildAudioLabel(
    index: number,
    title: string,
    language: string,
    codecpar: { channels?: number; sampleRate?: number },
  ): string {
    const parts: string[] = [];
    if (title) parts.push(title);
    else if (language) parts.push(language.toUpperCase());
    else parts.push(`Audio Track ${index + 1}`);

    const extra: string[] = [];
    if (language && title) extra.push(language.toUpperCase());
    if (codecpar.channels) extra.push(`${codecpar.channels}ch`);
    if (codecpar.sampleRate) extra.push(`${Math.round(codecpar.sampleRate / 1000)}kHz`);

    return extra.length > 0 ? `${parts.join(' ')} (${extra.join(', ')})` : parts.join(' ');
  }

  private buildSubtitleLabel(index: number, title: string, language: string): string {
    if (title && language) return `${title} [${language.toUpperCase()}]`;
    if (title) return title;
    if (language) return `Subtitle [${language.toUpperCase()}]`;
    return `Subtitle Track ${index + 1}`;
  }
}
