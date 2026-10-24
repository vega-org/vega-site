import type {PlayerManager} from '../player/PlayerManager';
import type {PlaybackState} from '../core/playback-state';
import type {CastMedia, CastMessage, PairRequest, ReceiverIdentity,CastServerOption} from './protocol';
import {receiverCapabilities, receiverHost, needsPhoneAccess} from '../platform/receiverHost';
import {normalizePlaybackError} from '../player/errors';

export interface ReceiverSessionState {
  status:'offline'|'connecting'|'ready'|'connected'|'error'; name:string; code:string;
  expiresAt:number; invitation:string; error?:string; pending:PairRequest[]; phones:{id:string;name:string}[];
  disconnectedMedia?:{id:string;title:string};
  servers?:CastServerOption[];selectedServerId?:string;canChangeServer?:boolean;changingServer?:boolean;serverError?:string;
}
const storageKey = 'vega.cast.receiver.v1';
export class ReceiverSession {
  private endpoint:string;
  private identity:ReceiverIdentity | null = null;
  private stopped = true;
  private abort:AbortController | null = null;
  private unsubscribe?:()=>void;
  private state:ReceiverSessionState = {status:'offline',name:'Vega receiver',code:'',expiresAt:0,invitation:'',pending:[],phones:[]};
  private listeners = new Set<(state:ReceiverSessionState)=>void>();
  private seen = new Map<string,CastMessage>();
  private media:CastMedia | null = null;
  private controllerId?:string;
  private lastStateAt = 0;
  private lastReportedStatus?:PlaybackState['status'];
  private fallbackIds = new Set<string>();
  private proxyIds = new Set<string>();
  private loadedMediaId?:string;
  private queuedProxyId?:string;
  private serverTimer?:ReturnType<typeof setTimeout>;
  private serverRequest?:string;
  private commands:Promise<void>=Promise.resolve();
  private manager:PlayerManager;
  private onMedia:(media:CastMedia)=>Promise<void>;
  constructor(manager:PlayerManager, onMedia:(media:CastMedia)=>Promise<void>) {
    this.manager=manager;this.onMedia=onMedia;
    this.endpoint = (import.meta.env.VITE_VEGA_CAST_SERVICE_URL || `${location.origin}/vega-cast/v1`).replace(/\/$/,'');
    try { this.identity = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { /* New receiver. */ }
  }
  subscribe(listener:(state:ReceiverSessionState)=>void):()=>void {this.listeners.add(listener);listener(this.state);return()=>{this.listeners.delete(listener);};}
  private update(update:Partial<ReceiverSessionState>) {this.state={...this.state,...update};for(const listener of this.listeners) listener(this.state);}
  private async request(body:Record<string,unknown>, signal?:AbortSignal):Promise<any> {
    const timeout=new AbortController();const timer=signal?undefined:setTimeout(()=>timeout.abort(),20_000);
    try {
      const response = await fetch(this.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:signal||timeout.signal});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Receiver connection failed');return result;
    } finally {if(timer)clearTimeout(timer);}
  }
  private auth() {return {...this.identity,kind:'receiver'};}
  private send(message:CastMessage, controllerId?:string) {return this.request({op:'send',auth:this.auth(),message,controllerId});}
  async start(name:string,useDeviceName=false):Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    this.update({status:'connecting',error:undefined});
    try {
      const registration = await this.request({op:'register',identity:this.identity,name,useDeviceName,capabilities:receiverCapabilities()});
      if(this.stopped)return;
      this.identity=registration.identity;
      try {localStorage.setItem(storageKey,JSON.stringify(this.identity));}catch{/* Pairing still works for this session without persistent browser storage. */}
      const invitation = `vega-cast://pair?server=${encodeURIComponent(registration.serviceUrl || this.endpoint)}&code=${registration.code}`;
      this.update({status:'ready',name:registration.name,code:registration.code,expiresAt:registration.expiresAt,invitation,phones:registration.rememberedControllers || []});
      this.unsubscribe=this.manager.subscribe(state=>{
        if(state.status==='idle'){this.media=null;this.loadedMediaId=undefined;this.updateServers();if(this.state.disconnectedMedia)this.update({disconnectedMedia:undefined});}
        const media=this.media;
        if(state.error&&media?.proxy&&media.delivery!=='phone-proxy'&&this.accessError(state.error)&&this.queuedProxyId!==media.id){
          this.queuedProxyId=media.id;
          this.commands=this.commands.then(()=>this.useProvidedProxy(media,state.error!.category)).then(()=>{}).catch(error=>this.update({error:error instanceof Error?error.message:'Proxy playback failed'})).finally(()=>{if(this.queuedProxyId===media.id)this.queuedProxyId=undefined;});
        }
        if (this.controllerId && (state.status!==this.lastReportedStatus||Date.now()-this.lastStateAt>800)) {this.lastStateAt=Date.now();this.lastReportedStatus=state.status;void this.reportState(state).catch(()=>{});}
      });
      void this.poll();
    } catch(error) {this.stopped=true;this.update({status:'error',error:error instanceof Error ? error.message:'Pairing service unavailable'});}
  }
  private async poll() {
    let delay=1000;
    while(!this.stopped) {
      this.abort=new AbortController();
      try {
        const result=await this.request({op:'poll',auth:this.auth()},this.abort.signal);
        if(this.state.error)this.update({error:undefined});
        delay=1000;
        for(const message of result.messages) {
          if(['PAIR_REQUEST','CONTROLLER_CONNECTED'].includes(message.type))await this.receive(message);
          else {
            // Keep heartbeats/pairing alive while AVPlayer opens a slow source.
            this.commands=this.commands.then(()=>this.stopped?undefined:this.receive(message)).catch(error=>this.update({error:error instanceof Error?error.message:'Playback command failed'}));
          }
        }
      } catch(error) {
        if(this.stopped) return;
        this.update({error:error instanceof Error ? error.message:'Connection interrupted'});
        await new Promise(resolve=>setTimeout(resolve,delay));delay=Math.min(10_000,delay*2);
      }
    }
  }
  async confirm(requestId:string,allow:boolean) {
    await this.request({op:'confirm',auth:this.auth(),requestId,allow});
    this.update({pending:this.state.pending.filter(item=>item.requestId!==requestId)});
  }
  async forget(controllerId:string) {
    await this.request({op:'forget',auth:this.auth(),controllerId});
    this.update({phones:this.state.phones.filter(phone=>phone.id!==controllerId)});
  }

  releaseMedia(){this.media=null;this.loadedMediaId=undefined;this.updateServers();this.update({disconnectedMedia:undefined});}
  private updateServers(){
    if(this.serverTimer)clearTimeout(this.serverTimer);this.serverTimer=undefined;this.serverRequest=undefined;
    const media=this.media;
    const servers=(media?.servers||[]).slice(0,50).filter(item=>typeof item.id==='string'&&typeof item.name==='string').map(item=>({id:item.id,name:item.name.slice(0,80),quality:typeof item.quality==='string'?item.quality:undefined,tags:Array.isArray(item.tags)?item.tags.filter(tag=>typeof tag==='string').slice(0,8):undefined}));
    this.update({servers,selectedServerId:media?.selectedServerId,canChangeServer:!!this.controllerId&&media?.processing!=='remuxed'&&servers.length>1,changingServer:false,serverError:undefined});
  }
  async selectServer(serverId:string){
    if(!this.state.canChangeServer||!this.media||!this.controllerId)throw new Error('Server selection is unavailable');
    if(this.state.changingServer)throw new Error('A server change is already in progress');
    if(!this.state.servers?.some(server=>server.id===serverId))throw new Error('Unknown server');
    if(serverId===this.state.selectedServerId)return;
    const requestId=crypto.randomUUID?.()||`server-${Date.now()}`;
    this.serverRequest=requestId;this.update({changingServer:true,serverError:undefined});
    this.serverTimer=setTimeout(()=>{if(this.serverRequest===requestId){this.serverRequest=undefined;this.update({changingServer:false,serverError:'Mobile did not finish changing server. Try again.'});}},90_000);
    try{await this.send({type:'SERVER_CHANGE',requestId,mediaId:this.media.id,serverId,position:this.manager.getState().currentTime},this.controllerId);}
    catch(error){if(this.serverTimer)clearTimeout(this.serverTimer);this.serverRequest=undefined;this.update({changingServer:false,serverError:error instanceof Error?error.message:'Unable to change server'});throw error;}
  }
  async resolveDisconnect(keepWatching:boolean){
    const prompt=this.state.disconnectedMedia;
    if(!prompt)return;
    this.update({disconnectedMedia:undefined});
    if(this.media?.id!==prompt.id)return;
    if(!keepWatching){this.media=null;await this.manager.unload();}
    else if(['paused','loaded'].includes(this.manager.getState().status))await this.manager.play();
  }

  async refreshCode():Promise<void> {
    if(this.stopped){await this.start(this.state.name);return;}
    const registration=await this.request({op:'register',identity:this.identity,name:this.state.name,capabilities:receiverCapabilities()});
    this.update({code:registration.code,expiresAt:registration.expiresAt,invitation:`vega-cast://pair?server=${encodeURIComponent(registration.serviceUrl || this.endpoint)}&code=${registration.code}`});
  }

  async rename(name:string):Promise<void> {
    const registration=await this.request({op:'register',identity:this.identity,name,capabilities:receiverCapabilities()});
    this.update({name:registration.name,code:registration.code,expiresAt:registration.expiresAt,invitation:`vega-cast://pair?server=${encodeURIComponent(registration.serviceUrl || this.endpoint)}&code=${registration.code}`});
  }
  private async receive(message:CastMessage) {
    if(message.type==='PAIR_REQUEST') {
      if(this.state.pending.some(request=>request.requestId===message.requestId))return;
      this.update({pending:[...this.state.pending,{requestId:message.requestId!,name:message.name!,confirmation:message.confirmation!}]});return;
    }
    if(message.type==='CONTROLLER_CONNECTED') {
      this.controllerId=message.controllerId;
      const phones=this.state.phones.filter(phone=>phone.id!==message.controllerId);
      this.update({status:'connected',error:undefined,disconnectedMedia:undefined,phones:[...phones,{id:message.controllerId!,name:message.name!}]});
      this.updateServers();
      await this.send({type:'CAPABILITIES',capabilities:receiverCapabilities()},message.controllerId);
      await this.reportState(this.manager.getState());return;
    }
    if(message.type==='CONTROLLER_DISCONNECT') {
      if(message.controllerId===this.controllerId){
        this.controllerId=undefined;
        this.updateServers();
        if(message.stopPlayback===true&&this.media?.delivery==='phone-proxy')await this.manager.unload();
        const ongoing=!['idle','ended','error'].includes(this.manager.getState().status);
        this.update({status:'ready',disconnectedMedia:this.media&&this.media.delivery!=='phone-proxy'&&ongoing?{id:this.media.id,title:this.media.title}:undefined});
      }
      return;
    }
    if(message.type==='SERVER_CHANGE_RESULT'){
      if(message.controllerId===this.controllerId&&message.requestId===this.serverRequest){
        if(this.serverTimer)clearTimeout(this.serverTimer);this.serverRequest=undefined;
        this.update({changingServer:false,serverError:message.ok?undefined:String(message.error||'Unable to change server')});
      }
      return;
    }
    if(!message.id) return;
    const prior=this.seen.get(message.id);if(prior) {await this.send(prior,message.controllerId);return;}
    try {
      if(message.type==='LOAD_MEDIA' || message.type==='FALLBACK_SOURCE') {
        if(!message.media || typeof message.media.source?.url!=='string' || !/^(https?:\/\/|file:|content:|\/)/i.test(message.media.source.url)) throw new Error('Invalid media source');
        this.update({disconnectedMedia:undefined});this.media=message.media;this.controllerId=message.controllerId;
        this.updateServers();
        if(needsPhoneAccess(message.media,receiverCapabilities()) && message.media.delivery!=='phone-proxy') {
          if(!await this.useProvidedProxy(message.media,'SOURCE_ACCESS_REQUIRED'))await this.requestFallback('SOURCE_ACCESS_REQUIRED');
        } else {
          await this.loadMedia(message.media);
        }
      } else if(message.type==='COMMAND') {
        const value=Number(message.value);
        switch(message.command) {
          case 'PLAY': await this.manager.play();break;
          case 'PAUSE': await this.manager.pause();break;
          case 'SEEK': if(!Number.isFinite(value)||value<0) throw new Error('Invalid seek'); await this.manager.seek(value);break;
          case 'VOLUME': if(!Number.isFinite(value)) throw new Error('Invalid volume'); this.manager.setVolume(Math.max(0,Math.min(1,value)));break;
          case 'MUTE': this.manager.setMuted(Boolean(message.value));break;
          case 'SPEED': if(!Number.isFinite(value)||value<0.25||value>3) throw new Error('Invalid speed');this.manager.setPlaybackRate(value);break;
          case 'AUDIO': if(!Number.isInteger(value)) throw new Error('Invalid audio track');await this.manager.selectAudioTrack(value);break;
          case 'SUBTITLE': if(!Number.isInteger(value)) throw new Error('Invalid subtitle track');await this.manager.selectSubtitleTrack(value);break;
          case 'SUBTITLE_DELAY': if(!Number.isFinite(value)) throw new Error('Invalid subtitle delay');this.manager.setSubtitleDelay(value);break;
          case 'EXTERNAL_SUBTITLE': if(typeof message.value!=='string'||!/^https?:\/\//i.test(message.value)) throw new Error('Invalid subtitle URL');await this.manager.loadExternalSubtitle({source:message.value});break;
          case 'STOP': await this.manager.unload();break;
          case 'GET_STATE': break;
          default: throw new Error('Unknown playback command');
        }
      }
      const ack={type:'ACK',id:message.id,ok:true};
      this.seen.set(message.id,ack);if(this.seen.size>100)this.seen.delete(this.seen.keys().next().value!);
      await this.send(ack,message.controllerId);await this.reportState(this.manager.getState());
    } catch(error) {await this.send({type:'ACK',id:message.id,ok:false,error:error instanceof Error?error.message:'Playback command failed'},message.controllerId);}
  }
  private accessError(error:{category:string;message:string}){
    if(['PLAYER_ASSET_ERROR','PLAYER_INTERNAL_ERROR'].includes(error.category))return false;
    return ['CORS_BLOCKED','HEADERS_NOT_ALLOWED','NETWORK_ERROR'].includes(error.category)||/open stream failed/i.test(error.message);
  }
  private async useProvidedProxy(media:CastMedia,category:string):Promise<boolean>{
    if(this.media!==media||!this.controllerId||media.delivery==='phone-proxy'||!media.proxy||this.proxyIds.has(media.id))return false;
    if(!/^https?:\/\//i.test(media.proxy.source.url))throw new Error('Invalid phone proxy URL');
    this.proxyIds.add(media.id);if(this.proxyIds.size>100)this.proxyIds.delete(this.proxyIds.values().next().value!);
    const state=this.manager.getState();
    const resume=this.loadedMediaId===media.id;
    const replacement:CastMedia={...media,source:media.proxy.source,subtitles:media.proxy.subtitles||[],delivery:'phone-proxy',attempt:1,
      startPosition:resume&&state.currentTime>0?state.currentTime:media.startPosition,
      audioTrack:resume?state.selectedAudioTrackId??media.audioTrack:media.audioTrack,subtitleTrack:resume?state.selectedSubtitleTrackId??media.subtitleTrack:media.subtitleTrack};
    this.media=replacement;
    // Tell mobile which source is actually in use, rather than treating a
    // registered standby proxy as active playback.
    await this.send({type:'DELIVERY_CHANGED',mediaId:media.id,delivery:'phone-proxy',reason:category},this.controllerId);
    await this.loadMedia(replacement);
    if(resume&&state.subtitleEnabled===false)await this.manager.setSubtitleEnabled(false);
    if(resume&&typeof state.subtitleDelay==='number')this.manager.setSubtitleDelay(state.subtitleDelay);
    return true;
  }
  private async loadMedia(media:CastMedia) {
    if(location.protocol==='https:' && media.source.url.startsWith('http:') && !receiverCapabilities().nativeNetworking) throw new Error('This HTTPS receiver cannot access an insecure phone stream. Use a secure delivery endpoint or an app host.');
    const checkAccess=media.delivery!=='phone-proxy'&&!!media.proxy&&!receiverCapabilities().nativeNetworking;
    const source={id:media.id,title:media.title,source:media.source.url,format:media.source.format==='hls'?'m3u8':media.source.format,headers:media.source.headers,networkRetryCount:checkAccess?0:undefined,startPosition:media.startPosition,audioTrackId:media.audioTrack,subtitleTrackId:media.subtitleTrack,
      externalSubtitles:media.subtitles?.filter(track=>/^https?:\/\//i.test(track.uri)).map(track=>({source:track.uri,lang:track.language,title:track.title}))};
    try{
      if(checkAccess)await this.checkDirectAccess(media);
      if(this.media!==media)return;
      const prepared=receiverHost() ? await receiverHost()!.prepareSource(source):source;
      await this.onMedia(media);if(this.media!==media)return;this.loadedMediaId=media.id;await this.manager.load(prepared);
    }catch(error){
      const normalized=normalizePlaybackError(error);
      if(this.accessError(normalized)&&await this.useProvidedProxy(media,normalized.category))return;
      throw error;
    }
    const error=this.manager.getState().error;
    if(error) {
      if(this.accessError(error)&&await this.useProvidedProxy(media,error.category))return;
      await this.send({type:'PLAYBACK_ERROR',category:error.category,message:error.message,mediaId:media.id},this.controllerId);
      if(media.delivery!=='phone-proxy'||['UNSUPPORTED_AUDIO_CODEC','UNSUPPORTED_CONTAINER'].includes(error.category))await this.requestFallback(error.category);
    }
  }
  private async checkDirectAccess(media:CastMedia):Promise<void>{
    const abort=new AbortController();
    const timer=setTimeout(()=>abort.abort(),10_000);
    try{
      // A real GET checks browser access without HEAD incompatibilities. Servers
      // may ignore Range, so cancel the response body rather than downloading it.
      const response=await fetch(media.source.url,{method:'GET',mode:'cors',headers:{...media.source.headers,Range:'bytes=0-0'},signal:abort.signal});
      try{if(!response.ok)throw new Error(`HTTP ${response.status}`);}
      finally{await response.body?.cancel();}
    }catch(error){
      // Browsers deliberately hide whether an opaque fetch failure was CORS,
      // DNS or another transport failure. Keep that distinction honest.
      throw new Error(`Direct source network access failed: ${error instanceof Error?error.message:String(error)}`);
    }finally{clearTimeout(timer);}
  }
  private async requestFallback(category:string) {
    if(['PLAYER_ASSET_ERROR','PLAYER_INTERNAL_ERROR'].includes(category))return;
    if(!this.media || this.fallbackIds.has(this.media.id)) return;
    const conversionAfterAccessProxy=this.proxyIds.has(this.media.id)&&['UNSUPPORTED_AUDIO_CODEC','UNSUPPORTED_CONTAINER'].includes(category);
    if(this.media.attempt&&!conversionAfterAccessProxy)return;
    this.fallbackIds.add(this.media.id);
    await this.send({type:'FALLBACK_REQUEST',mediaId:this.media.id,category,position:this.manager.getState().currentTime},this.controllerId);
  }
  private reportState(state:PlaybackState) {
    return this.send({type:'STATE',state:{status:state.status,currentTime:state.currentTime,duration:state.duration,volume:state.volume,isMuted:state.isMuted,playbackRate:state.playbackRate,
      selectedAudioTrackId:state.selectedAudioTrackId,selectedSubtitleTrackId:state.selectedSubtitleTrackId,subtitleDelay:state.subtitleDelay,
      audioTracks:state.audioTracks,subtitleTracks:state.subtitleTracks,mediaId:this.media?.id,delivery:this.media?.delivery||'direct',processing:this.media?.processing||'original',error:state.error?{category:state.error.category,message:state.error.message}:null}},this.controllerId);
  }
  stop() {this.stopped=true;this.media=null;this.controllerId=undefined;if(this.serverTimer)clearTimeout(this.serverTimer);this.abort?.abort();this.unsubscribe?.();this.listeners.clear();}
}
