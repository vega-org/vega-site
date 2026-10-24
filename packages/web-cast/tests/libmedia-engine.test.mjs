import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// Exercise the real adapter against AVPlayer's public contract. These checks
// cannot establish browser codec support or replace real-media playback tests.
const dataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
async function sourceModule(path, imports = {}) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
  });
  return dataUrl(outputText.replace(/(from\s+)(['"])([^'"]+)\2/g, (_, prefix, _quote, name) => {
    assert.ok(imports[name], `Unexpected runtime dependency: ${name}`);
    return `${prefix}${JSON.stringify(imports[name])}`;
  }));
}

const mockUrl = dataUrl(`
  export const Events = Object.fromEntries([
    'LOADING', 'LOADED', 'PLAYING', 'PAUSED', 'ENDED', 'TIME', 'STREAM_UPDATE',
    'CHANGED', 'ERROR', 'RESUME', 'AUDIO_CONTEXT_RUNNING','STOPPED','TIMEOUT'
  ].map(key => [key, key]));
  export default class AVPlayer {
    static latest;
    constructor() {
      AVPlayer.latest = this;
      this.events = new Map();
      this.streams = [];
      this.audioId = this.videoId = this.subtitleId = -1;
      this.currentTime = 0n;
      this.stats = {};
      this.suspended = false;
      this.resumeCalls = 0;
      this.subtitleEnabled = true;
      this.status = 4;
      this.calls = [];
    }
    on(event, listener) { this.events.set(event, listener); }
    emit(event, ...args) { this.events.get(event)?.(...args); }
    async load(source,options) { this.loadOptions=options; this.streams = structuredClone(AVPlayer.nextStreams); this.emit(Events.LOADED); }
    async play() {
      this.calls.push('play');
      if (this.started) { this.status = 6; this.subtitleEnabled = true; return; }
      this.started = true;
      this.audioId = this.streams.find(s => s.mediaType.toLowerCase() === 'audio')?.id ?? -1;
      this.videoId = this.streams.find(s => s.mediaType.toLowerCase() === 'video')?.id ?? -1;
      this.subtitleId = this.streams.find(s => s.mediaType.toLowerCase() === 'subtitle')?.id ?? -1;
      this.suspended = !!AVPlayer.suspendOnPlay;
      this.status = 6;
      if (this.suspended) this.emit(Events.RESUME);
      this.emit(Events.PLAYING);
    }
    async resume() { this.resumeCalls++; this.suspended = false; this.emit(Events.AUDIO_CONTEXT_RUNNING); }
    isSuspended() { return this.suspended; }
    getStreams() { return this.streams; }
    getExternalSubtitle(){return [];}
    getSelectedAudioStreamId() { return this.audioId; }
    getSelectedVideoStreamId() { return this.videoId; }
    getSelectedSubtitleStreamId() { return this.subtitleId; }
    getDuration() { return 120000n; }
    getStats() { return this.stats; }
    getStatus() { return this.status; }
    isLive() { return false; }
    async pause() { this.calls.push('pause'); this.status = 8; }
    isMSE() { return false; }
    setVolume() {}
    setPlaybackRate() {}
    setRenderMode(mode) {this.renderMode=mode;}
    resize(width,height) { this.resizeCalls=(this.resizeCalls||0)+1;this.viewport=[width,height]; }
    setSubtitleEnable(enabled) { this.calls.push('subtitle-enable:' + enabled); this.subtitleEnabled = enabled; }
    setSubtitleDelay(delay) { this.subtitleDelay = delay; }
    async seek(time) {
      if (!this.started) throw new Error('No selected streams to seek');
      this.calls.push('seek:' + time);
      this.subtitleEnabled = true; // libmedia seek restarts subtitle rendering.
      this.currentTime = time;
    }
    async selectAudio(id) {
      if (!this.started) throw new Error('Cannot switch before playback initializes streams');
      this.calls.push('audio:' + id);
      this.audioId = id;
      this.emit(Events.CHANGED);
    }
    async selectSubtitle(id) {
      if (!this.started) throw new Error('Cannot switch before playback initializes streams');
      this.calls.push('subtitle:' + id);
      this.subtitleId = id;
      this.emit(Events.CHANGED);
    }
    async loadExternalSubtitle() {
      this.streams.push({ id: 902, index: 5, mediaType: 'Subtitle', metadata: { language: 'eng' }, codecparProxy: { codecId: 94225 } });
      this.emit(Events.STREAM_UPDATE);
      return 0;
    }
    async destroy() { this.destroyed = true; }
  }
`);
const { default: MockAVPlayer, Events } = await import(mockUrl);
const errorsUrl = await sourceModule('../../libmedia-engine/src/player/errors.ts');
const playbackStateUrl = await sourceModule('../../libmedia-engine/src/core/playback-state.ts');
const engineUrl = await sourceModule('../../libmedia-engine/src/player/LibmediaEngine.ts', {
  '@libmedia/avplayer': mockUrl,
  '../core/playback-state': playbackStateUrl,
  './errors': errorsUrl,
  './capabilities': dataUrl('export const detectEnvironmentCapabilities = () => ({ webCodecs: true, audioWorklet: true });'),
});
const { LibmediaEngine } = await import(engineUrl);

const tracks = [
  { id: 30, index: 0, mediaType: 'Video', metadata: {}, codecparProxy: { codecId: 173, width: 1280, height: 720 } },
  { id: 51, index: 1, mediaType: 'Audio', metadata: { language: 'eng', title: 'English' }, codecparProxy: { codecId: 86018, chLayout: { nbChannels: 6 }, sampleRate: 48000 } },
  { id: 72, index: 2, mediaType: 'Subtitle', metadata: { language: 'eng' }, codecparProxy: { codecId: 94225 } },
  { id: 99, index: 3, mediaType: 'Audio', metadata: { language: 'fra' }, codecparProxy: { codecId: 86019, chLayout: { nbChannels: 2 }, sampleRate: 48000 } },
  { id: 110, index: 4, mediaType: 'Attachment', metadata: { title: 'Font' }, codecparProxy: {} },
];

async function loaded(options = {}) {
  MockAVPlayer.nextStreams = options.streams ?? tracks;
  MockAVPlayer.suspendOnPlay = options.suspendOnPlay ?? false;
  const engine = new LibmediaEngine();
  const state = {};
  const errors = [];
  engine.attach({});
  engine.setEventListeners({
    onStateChange: (partial) => Object.assign(state, partial),
    onError: (error) => errors.push(error),
  });
  await engine.load({ id: 'test', source: 'https://test.invalid/sample.mkv', ...options.source });
  return { engine, player: MockAVPlayer.latest, state, errors };
}

test('AVPlayer title-case types expose all media tracks and exclude attachments', async () => {
  const { engine, state, errors } = await loaded();
  assert.deepEqual(state.audioTracks.map(t => t.id), [51, 99]);
  assert.deepEqual(state.subtitleTracks.map(t => t.id), [72]);
  assert.deepEqual(state.videoTracks.map(t => t.id), [30]);
  assert.equal(state.audioTracks[0].channels, 6);
  assert.match(state.audioTracks[0].label, /6ch/);
  assert.equal(state.audioTracks[0].language, 'eng');
  assert.equal(state.selectedAudioTrackId, 51);
  assert.equal(state.audioTracks[0].selected, true);
  assert.equal(state.diagnostics.resolution, '1280x720');
  assert.deepEqual(errors, []);
  await engine.destroy();
});

test('initial selections use stream IDs after playback initializes, preserving position', async () => {
  const { engine, state, player, errors } = await loaded({
    source: { audioTrackId: 99, subtitleTrackId: 72, startPosition: 23 },
  });
  assert.equal(state.selectedAudioTrackId, 99);
  assert.equal(state.selectedSubtitleTrackId, 72);
  assert.equal(player.currentTime, 23000n);
  assert.deepEqual(errors, []);
  await engine.destroy();
});

test('audio suspension is visible and explicit resume does not reload or seek', async () => {
  const { engine, state, player } = await loaded({ suspendOnPlay: true });
  assert.equal(state.audioNeedsUserGesture, true);
  player.currentTime = 12000n;
  await engine.resumeAudio();
  assert.equal(player.resumeCalls, 1);
  assert.equal(player.currentTime, 12000n);
  assert.equal(state.audioNeedsUserGesture, false);
  await engine.destroy();
});

test('disabling subtitles survives stream updates and can be re-enabled', async () => {
  const { engine, state, player } = await loaded();
  await engine.selectSubtitleTrack(-1);
  player.emit(Events.STREAM_UPDATE);
  assert.equal(state.selectedSubtitleTrackId, null);
  assert.equal(state.subtitleTracks[0].selected, false);
  assert.equal(player.subtitleEnabled, false);
  await engine.setSubtitleEnabled(true);
  assert.equal(state.selectedSubtitleTrackId, 72);
  assert.equal(state.subtitleTracks[0].selected, true);
  await engine.destroy();
});

test('external subtitle success status is not mistaken for its stream ID', async () => {
  const { engine, state, player } = await loaded();
  const id = await engine.loadExternalSubtitle({ source: 'https://test.invalid/subtitle.srt' });
  assert.equal(id, 902);
  assert.equal(state.selectedSubtitleTrackId, 902);
  assert.equal(player.subtitleEnabled, true);
  assert.equal(state.subtitleTracks.find(t => t.id === 902).selected, true);
  await engine.destroy();
});

test('new video-only source clears previous audio/subtitle metadata and destroys old player', async () => {
  const { engine, state, player } = await loaded();
  MockAVPlayer.nextStreams = [tracks[0]];
  await engine.load({ id: 'second', source: 'https://test.invalid/video-only.mp4' });
  assert.equal(player.destroyed, true);
  assert.deepEqual(state.audioTracks, []);
  assert.deepEqual(state.subtitleTracks, []);
  assert.equal(state.selectedAudioTrackId, null);
  assert.equal(state.diagnostics.audioCodec, undefined);
  await engine.destroy();
});

test('metadata extraction failure is surfaced rather than reported as absent tracks', async () => {
  const { engine, state, player, errors } = await loaded();
  player.getStreams = () => { throw new Error('Track metadata unavailable'); };
  player.emit(Events.STREAM_UPDATE);
  assert.match(state.error.message, /Track metadata unavailable/);
  assert.equal(errors.length, 1);
  await engine.destroy();
});

test('diagnostics use real stat fields, convert BigInt counters and preserve a zero clock', async () => {
  const { engine, player } = await loaded();
  player.stats = {
    audioFrameDecodeCount: 20n, audioFrameRenderCount: 18n, audioDecodeErrorPacketCount: 2,
    videoFrameDecodeCount: 30n, videoFrameDropCount: 3,
    bufferReceiveBytes: 1048576n,videoPacketQueueLength:0,audioPacketQueueLength:12,
    videoDecodeFramerate:18,videoRenderFramerate:17,videoEncodeFramerate:24,
    audioCurrentTime: 0n, videoCurrentTime: 40n, audiocodec: 'mp4a.40.2',
  };
  const stats = engine.getDiagnostics();
  assert.equal(stats.audioFrameDecodeCount, 20);
  assert.equal(stats.audioFrameRenderCount, 18);
  assert.equal(stats.audioDecodeErrorPacketCount, 2);
  assert.equal(stats.videoFrameDropCount, 3);
  assert.equal(stats.bufferReceiveBytes,1048576);
  assert.equal(stats.videoPacketQueueLength,0);
  assert.equal(stats.audioPacketQueueLength,12);
  assert.equal(stats.videoDecodeFramerate,18);
  assert.equal(stats.videoRenderFramerate,17);
  assert.equal(stats.videoEncodeFramerate,24);
  assert.equal(stats.audioCurrentTime, 0);
  assert.equal(stats.avSyncDiffMs, 40);
  assert.equal(stats.audioCodec, 'mp4a.40.2');
  assert.equal(stats.decoderPath, 'unknown'); // API availability is not decoder evidence.
  assert.equal(stats.isHardwareAccelerated, null);
  await engine.destroy();
});

test('startup does not clear the subtitle cues initialized by AVPlayer', async () => {
  const { engine, player } = await loaded();
  assert.equal(player.calls.includes('subtitle-enable:true'), false);
  await engine.destroy();
});

test('audio switching flushes both pipelines at the same position and restores playback', async () => {
  const { engine, player, state } = await loaded();
  player.currentTime = 37000n;
  player.calls = [];
  await engine.selectAudioTrack(99);
  assert.deepEqual(player.calls, ['pause', 'audio:99', 'seek:37000', 'play']);
  assert.equal(state.selectedAudioTrackId, 99);
  assert.equal(player.currentTime, 37000n);
  assert.equal(state.status, 'playing');
  await engine.destroy();
});

test('switching audio while paused preserves the paused state', async () => {
  const { engine, player, state } = await loaded();
  await engine.pause();
  player.currentTime = 16000n;
  player.calls = [];
  await engine.selectAudioTrack(99);
  assert.deepEqual(player.calls, ['audio:99', 'seek:16000']);
  assert.equal(state.status, 'paused');
  await engine.destroy();
});

test('rapid switch and seek commands cannot overlap a decoder transition', async () => {
  const { engine, player } = await loaded();
  let release;
  const switched = new Promise(resolve => { release = resolve; });
  player.selectAudio = async (id) => {
    player.calls.push('audio-start');
    await switched;
    player.audioId = id;
    player.calls.push('audio-end');
  };
  player.currentTime = 20000n;
  player.calls = [];
  const changing = engine.selectAudioTrack(99);
  const seeking = engine.seek(50);
  const pausing = engine.pause();
  await new Promise(setImmediate);
  assert.deepEqual(player.calls, ['pause', 'audio-start']);
  release();
  await Promise.all([changing, seeking, pausing]);
  assert.deepEqual(player.calls, ['pause', 'audio-start', 'audio-end', 'seek:20000', 'play', 'seek:50000', 'pause']);
  assert.equal(player.currentTime, 50000n);
  assert.equal(player.getStatus(), 8);
  await engine.destroy();
});

test('subtitle switching refills cues without a second queue-clearing enable call', async () => {
  const { engine, player, state } = await loaded({ streams: [
    ...tracks,
    { id: 88, index: 5, mediaType: 'Subtitle', metadata: { language: 'fra' }, codecparProxy: { codecId: 94225 } },
  ] });
  player.currentTime = 45000n;
  player.calls = [];
  await engine.selectSubtitleTrack(88);
  assert.deepEqual(player.calls, ['pause', 'subtitle:88', 'seek:45000', 'play']);
  assert.equal(state.selectedSubtitleTrackId, 88);
  await engine.destroy();
});

test('disabled subtitles stay off after seeking and changing audio', async () => {
  const { engine, player, state } = await loaded();
  await engine.setSubtitleEnabled(false);
  await engine.seek(12);
  await engine.selectAudioTrack(99);
  assert.equal(player.subtitleEnabled, false);
  assert.equal(state.subtitleEnabled, false);
  assert.equal(state.selectedSubtitleTrackId, null);
  await engine.destroy();
});

test('a rejected track change is reported and does not block subsequent controls', async () => {
  const { engine, player, state } = await loaded();
  player.selectAudio = async () => { throw new Error('Audio decoder could not reopen'); };
  await engine.selectAudioTrack(99);
  assert.match(state.error.message, /Audio decoder could not reopen/);
  assert.equal(state.status, 'playing');
  assert.equal(state.selectedAudioTrackId, 51);
  await engine.seek(10);
  assert.equal(player.currentTime, 10000n);
  assert.equal(state.error, null);
  await engine.destroy();
});

test('an ignored subtitle selection is reported instead of displaying a false selection', async () => {
  const { engine, player, state } = await loaded({ streams: [
    ...tracks,
    { id: 88, index: 5, mediaType: 'Subtitle', metadata: {}, codecparProxy: { codecId: 94214 } },
  ] });
  player.selectSubtitle = async () => {};
  await engine.selectSubtitleTrack(88);
  assert.match(state.error.message, /codec 94214.*libmedia did not confirm/);
  assert.equal(state.selectedSubtitleTrackId, 72);
  await engine.destroy();
});

test('unload releases the active player and allows playback to start again with live listeners', async () => {
  const {engine,player,state}=await loaded();
  await engine.unload();
  assert.equal(player.destroyed,true);
  assert.equal(state.status,'idle');
  assert.deepEqual(state.audioTracks,[]);
  await engine.load({id:'reopen',source:'https://test.invalid/reopen.mkv'});
  assert.equal(state.status,'playing');
  assert.equal(state.selectedAudioTrackId,51);
  await engine.destroy();
});

test('unloading an opening source prevents its delayed completion from restarting playback',async()=>{
 const original=MockAVPlayer.prototype.load;
 let release;
 MockAVPlayer.prototype.load=async function(){this.streams=structuredClone(tracks);await new Promise(resolve=>{release=resolve;});this.emit(Events.LOADED);};
 const engine=new LibmediaEngine();const state={};engine.attach({});engine.setEventListeners({onStateChange:next=>Object.assign(state,next)});
 try{
  const loading=engine.load({id:'slow',source:'https://test.invalid/slow.mkv'});
  await new Promise(setImmediate);
  await engine.unload();release();await loading;
  assert.equal(state.status,'idle');assert.equal(state.error,null);
 }finally{MockAVPlayer.prototype.load=original;await engine.destroy();}
});

test('errors from a superseded source cannot replace the new source state',async()=>{
 const original=MockAVPlayer.prototype.load;
 let reject;
 MockAVPlayer.prototype.load=async function(){await new Promise((_,fail)=>{reject=fail;});};
 const engine=new LibmediaEngine();const state={};engine.attach({});engine.setEventListeners({onStateChange:next=>Object.assign(state,next)});
 try{
  const old=engine.load({id:'old',source:'https://test.invalid/old.mkv'});
  await new Promise(setImmediate);MockAVPlayer.prototype.load=original;MockAVPlayer.nextStreams=tracks;
  await engine.load({id:'new',source:'https://test.invalid/new.mkv'});
  reject(new Error('Old source failed late'));await old;
  assert.equal(state.status,'playing');assert.equal(state.error,null);assert.equal(state.selectedAudioTrackId,51);
 }finally{MockAVPlayer.prototype.load=original;await engine.destroy();}
});

test('renderer follows viewport changes and releases its observer on destroy', async () => {
  const previous=globalThis.ResizeObserver;
  let observer;
  globalThis.ResizeObserver=class {
    constructor(callback){this.callback=callback;observer=this;}
    observe(target){this.target=target;}
    disconnect(){this.disconnected=true;}
  };
  const engine=new LibmediaEngine();
  try {
    const container={clientWidth:960,clientHeight:540};
      engine.setAspectFit(true);
    MockAVPlayer.nextStreams=tracks;
    engine.attach(container);
    await engine.load({id:'viewport',source:'https://test.invalid/video.mkv'});
    const player=MockAVPlayer.latest;
      assert.equal(player.renderMode,1);
    assert.deepEqual(player.viewport,[960,540]);
      const resizeCalls=player.resizeCalls;
      observer.callback();
      assert.equal(player.resizeCalls,resizeCalls,'Unchanged dimensions must not trigger a ResizeObserver feedback loop');
    container.clientWidth=2048;container.clientHeight=1024;
    observer.callback();
    assert.deepEqual(player.viewport,[2048,1024]);
    container.clientWidth=0;observer.callback();
    assert.deepEqual(player.viewport,[2048,1024]);
    await engine.destroy();
    assert.equal(observer.disconnected,true);
  } finally {await engine.destroy();globalThis.ResizeObserver=previous;}
});

test('frozen playback becomes buffering and recovers only on advancing media time',async()=>{
 const {engine,player,state,errors}=await loaded();
 const start=engine.lastProgressAt;
 engine.inspectProgress(start+2000);
 assert.equal(state.status,'playing');
 engine.inspectProgress(start+3100);
 assert.equal(state.status,'buffering');
 assert.deepEqual(errors,[]);
 player.emit(Events.TIME,0n);
 assert.equal(state.status,'buffering');
 player.currentTime=1000n;
 engine.inspectProgress(start+4100);
 assert.equal(state.status,'playing');
 await engine.destroy();
 assert.equal(engine.progressTimer,null);
});

test('pause, seek, audio gesture and fatal errors are not mistaken for a stall',async()=>{
 const {engine,player,state}=await loaded();
 await engine.pause();
 engine.inspectProgress(engine.lastProgressAt+10000);
 assert.equal(state.status,'paused');
 await engine.play();
 player.suspended=true;
 engine.inspectProgress(engine.lastProgressAt+10000);
 assert.equal(state.status,'playing');
 player.suspended=false;player.status=9;
 engine.inspectProgress(engine.lastProgressAt+10000);
 assert.equal(state.status,'playing');
 player.status=6;player.emit(Events.ERROR,new Error('decoder failed'));
 engine.inspectProgress(engine.lastProgressAt+10000);
 assert.equal(state.status,'error');
 await engine.destroy();
});

test('stopped and timeout events and silent terminal status update playback',async()=>{
 const {engine,player,state}=await loaded();
 player.emit(Events.TIMEOUT);
 assert.equal(state.status,'buffering');
 player.emit(Events.STOPPED);
 assert.equal(state.status,'ended');
 await engine.play();player.status=7;
 engine.inspectProgress();
 assert.equal(state.status,'ended');
 await engine.destroy();
});

test('receiver retry policy is passed to the libmedia public loader options',async()=>{
 const {engine,player}=await loaded({source:{networkRetryCount:0}});
 assert.deepEqual(player.loadOptions.ioLoaderOptions,{retryCount:0});
 await engine.destroy();
});


test('HLS quality uses rendition indices, libmedia smooth switching and preserves the timeline',async()=>{
 const {engine,player,state}=await loaded();
 player.isHls=()=>true;player.isDash=()=>false;
 let selectedIndex=0;
 player.getVideoList=async()=>({list:[{width:1280,height:720,frameRate:24,codec:'avc1',bandwidth:2000000},{width:1920,height:1080,frameRate:24,codec:'avc1',bandwidth:5000000}],selectedIndex});
 player.selectVideo=async(id,smooth)=>{assert.equal(smooth,true);selectedIndex=id;};
 player.currentTime=45000n;
 await engine.refreshQualities();
 assert.deepEqual(state.qualities.map(q=>q.label),['720p','1080p']);
 await engine.selectQuality(1);
 assert.equal(state.selectedQualityId,1);assert.equal(player.currentTime,45000n);assert.equal(state.qualityChanging,false);
 await engine.selectQuality(99);assert.match(state.error.message,/unavailable/);
 player.selectVideo=async()=>{throw new Error('switch failed');};
 await engine.selectQuality(0);assert.match(state.error.message,/switch failed/);
 assert.equal(state.qualityChanging,false);
 await engine.destroy();
});


test('HLS alternate audio uses rendition indices and survives demux track refreshes',async()=>{
 const {engine,player,state}=await loaded();
 try{
  player.isHls=()=>true;player.isDash=()=>false;
  let selectedIndex=0;
  player.getAudioList=async()=>({list:[{lang:'eng',codec:'aac'},{lang:'hin',codec:'aac'},{lang:'tam',codec:'aac'}],selectedIndex});
  const switches=[];
  player.selectAudio=async(id,smooth)=>{switches.push([id,smooth]);selectedIndex=id;};
  player.currentTime=45000n;
  await engine.refreshAdaptiveAudio();
  assert.deepEqual(state.audioTracks.map(track=>[track.id,track.language]),[[0,'eng'],[1,'hin'],[2,'tam']]);
  assert.equal(state.selectedAudioTrackId,0);
  engine.extractTracks();assert.equal(state.audioTracks.length,3);
  await engine.selectAudioTrack(2);
  assert.deepEqual(switches,[[2,false]]);assert.equal(state.selectedAudioTrackId,2);
  assert.equal(player.currentTime,45000n);
  await engine.selectAudioTrack(99);assert.match(state.error.message,/rendition 99 is unavailable/);
 }finally{await engine.destroy();}
});


test('HLS subtitle rendition switches use playlist indices instead of demux IDs',async()=>{
 const {engine,player,state}=await loaded();
 try{
  player.isHls=()=>true;player.isDash=()=>false;
  let selectedIndex=0;
  player.getSubtitleList=async()=>({list:[{lang:'eng',codec:'webvtt'},{lang:'hin',codec:'webvtt'}],selectedIndex});
  const switches=[];player.selectSubtitle=async id=>{switches.push(id);selectedIndex=id;};
  await engine.refreshAdaptiveSubtitles();
  assert.deepEqual(state.subtitleTracks.map(track=>track.id),[0,1]);
  await engine.selectSubtitleTrack(1);
  assert.deepEqual(switches,[1]);assert.equal(state.selectedSubtitleTrackId,1);
  await engine.selectSubtitleTrack(-1);assert.equal(state.selectedSubtitleTrackId,null);
  await engine.selectSubtitleTrack(1);assert.equal(state.selectedSubtitleTrackId,1);
  assert.equal(state.subtitleEnabled,true);
 }finally{await engine.destroy();}
});


test('late HLS subtitle lists resolve demux IDs by language before selecting a rendition',async()=>{
 const {engine,player,state}=await loaded();
 try{
  player.isHls=()=>true;player.isDash=()=>false;
  let selectedIndex=0;const calls=[];
  player.getSubtitleList=async()=>({list:[{lang:'hin',codec:'webvtt'},{lang:'eng',codec:'webvtt'}],selectedIndex});
  player.selectSubtitle=async id=>{calls.push(id);selectedIndex=id;};
  await engine.selectSubtitleTrack(72);
  assert.deepEqual(calls,[1]);assert.equal(state.selectedSubtitleTrackId,1);
 }finally{await engine.destroy();}
});

test('embedded-only HLS subtitles report the loader limitation without sending a stream ID as a rendition index',async()=>{
 const {engine,player,state}=await loaded();
 try{
  player.isHls=()=>true;player.isDash=()=>false;
  player.getSubtitleList=async()=>({list:[],selectedIndex:-1});player.getExternalSubtitle=()=>[];
  player.streams.push({...tracks[2],id:14});
  engine.extractTracks();const calls=[];player.selectSubtitle=async id=>calls.push(id);
  await engine.selectSubtitleTrack(14);
  assert.deepEqual(calls,[]);assert.match(state.error.message,/no selectable subtitle renditions/);
 }finally{await engine.destroy();}
});


test('external subtitle files on HLS select their stream ID without requiring playlist renditions',async()=>{
 const {engine,player,state}=await loaded();
 try{
  player.isHls=()=>true;player.isDash=()=>false;
  player.getSubtitleList=async()=>({list:[],selectedIndex:-1});
  player.getExternalSubtitle=()=>[{source:'https://test.invalid/sub.srt',streamId:14}];
  player.streams.push({...tracks[2],id:14});engine.extractTracks();
  const calls=[];player.selectSubtitle=async id=>{calls.push(id);player.subtitleId=id;};
  await engine.selectSubtitleTrack(14);
  assert.deepEqual(calls,[14]);assert.equal(state.selectedSubtitleTrackId,14);
  assert.equal(player.calls.some(call=>String(call).startsWith('seek')),false);
  assert.equal(player.calls.includes('pause'),false);
 }finally{await engine.destroy();}
});


test('MSE audio does not request permission because an unused shared AudioContext is suspended',async()=>{
 const {engine,player,state}=await loaded();
 try{
  player.isMSE=()=>true;player.suspended=true;
  player.emit(Events.PLAYING);assert.equal(state.audioNeedsUserGesture,false);
  player.emit(Events.RESUME);assert.equal(state.audioNeedsUserGesture,true);
  player.resume=async()=>{};await engine.resumeAudio();
  assert.equal(state.audioNeedsUserGesture,false);
  player.emit(Events.PLAYING);assert.equal(state.audioNeedsUserGesture,false);
 }finally{await engine.destroy();}
});

test('audio resume waits for delayed browser context activation without asking for another click',async()=>{
 const {engine,player,state}=await loaded();
 try{
  player.suspended=true;player.emit(Events.RESUME);
  player.resume=async()=>{setTimeout(()=>{player.suspended=false;},120);};
  await engine.resumeAudio();assert.equal(state.audioNeedsUserGesture,false);
 }finally{await engine.destroy();}
});


test('VOD HLS audio switching does not wait for the smooth future-segment path',async()=>{
 const {engine,player,state}=await loaded();
 try{
  player.isHls=()=>true;player.isDash=()=>false;player.isLive=()=>false;
  let selectedIndex=0;
  player.getAudioList=async()=>({list:[{lang:'eng',codec:'aac'},{lang:'hin',codec:'aac'}],selectedIndex});
  player.selectAudio=async(id,smooth)=>{
   if(smooth)await new Promise(()=>{});
   selectedIndex=id;
  };
  await engine.selectAudioTrack(1);
  assert.equal(state.selectedAudioTrackId,1);assert.equal(state.status,'playing');
 }finally{await engine.destroy();}
});


test('zero-based external subtitles compensate HLS audio timestamp origin without changing manual delay',async()=>{
 const {engine,player,state}=await loaded();
 try{
  player.isHls=()=>true;player.isDash=()=>false;
  player.streams.find(stream=>stream.id===51).startTime=126000n;
  player.streams.find(stream=>stream.id===51).timeBase={num:1,den:90000};
  player.streams.find(stream=>stream.id===72).startTime=39289n;
  player.getExternalSubtitle=()=>[{streamId:72,source:'https://test.invalid/sub.srt'}];
  engine.setSubtitleDelay(0);assert.equal(player.subtitleDelay,1400);
  assert.equal(state.subtitleDelay,0);
  engine.setSubtitleDelay(0.5);assert.equal(player.subtitleDelay,1900);
  await engine.seek(120);assert.equal(player.subtitleDelay,1900);
  player.getExternalSubtitle=()=>[];
  engine.setSubtitleDelay(0.5);assert.equal(player.subtitleDelay,500);
  player.getExternalSubtitle=()=>[{streamId:72}];player.isHls=()=>false;
  engine.setSubtitleDelay(0);assert.equal(player.subtitleDelay,0);
 }finally{await engine.destroy();}
});
