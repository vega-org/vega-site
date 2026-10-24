import {useEffect} from 'react';
import {createScope} from 'maverick.js';
import {TimeRange,useMediaContext,type MediaProviderAdapter} from '@vidstack/react';
import type {PlayerManager} from '../player/PlayerManager';
import type {PlaybackState} from '../core/playback-state';

/** Adapt the existing owner of playback to Vidstack UI, without a second decoder. */
export function LibmediaControlsBridge({manager}:{manager:PlayerManager}) {
 const ctx=useMediaContext();
 useEffect(()=>{
  if(!ctx)return;
  // Vega owns visibility and remote focus. Vidstack's independent idle timer
  // otherwise blurs visible buttons and consumes the next OK to restore focus.
  const couldIdle=ctx.player.controls.canIdle;
  ctx.player.controls.canIdle=false;
  let ready=false;
  let acceptingCommands=false;
  let disposed=false;
  let previous:PlaybackState|undefined;
  const provider:MediaProviderAdapter={
   // Vidstack bundles Maverick's Scope type with its own private symbol. This isolated
   // scope is only disposed by Vidstack; it never carries player signals or context.
   scope:createScope() as unknown as MediaProviderAdapter['scope'],type:'libmedia',currentSrc:null,
   setup(){ctx.notify('provider-setup',provider);},
   play:()=>acceptingCommands?manager.play():Promise.resolve(),pause:()=>acceptingCommands?manager.pause():Promise.resolve(),
   setMuted:value=>{if(acceptingCommands)manager.setMuted(value);},setVolume:value=>{if(acceptingCommands)manager.setVolume(value);},
   setPlaybackRate:value=>{if(acceptingCommands)manager.setPlaybackRate(value);},
   setCurrentTime:value=>{if(acceptingCommands)void manager.seek(value);},
   async loadSource(){/* Sources are exclusively loaded by PlayerManager. */},
  };
  ctx.notify('provider-change',provider);
  provider.setup();
  ctx.notify('media-type-change','video');
  ctx.notify('stream-type-change','on-demand');
  const unsubscribe=manager.subscribe(state=>{
   const seekable=new TimeRange(0,Math.max(0,state.duration));
   const buffered=new TimeRange(0,Math.max(0,state.buffered));
   if(state.status==='idle'||state.status==='loading'){
    if(previous?.status!==state.status){ready=false;acceptingCommands=false;ctx.notify('load-start');}
   }else if(!ready&&state.status!=='error'){
    ready=true;
    // Notify readiness without delegate.ready's stored/default preferences: the
    // manager already owns position, mute, volume, rate and autoplay policy.
    ctx.notify('can-play',{duration:state.duration,seekable,buffered,provider});
    queueMicrotask(()=>{if(!disposed&&ready)acceptingCommands=true;});
   }
   if(previous?.duration!==state.duration)ctx.notify('duration-change',state.duration);
   if(previous?.currentTime!==state.currentTime)ctx.notify('time-change',state.currentTime);
   if(previous?.buffered!==state.buffered||previous?.duration!==state.duration)ctx.notify('progress',{buffered,seekable});
   if(previous?.volume!==state.volume||previous?.isMuted!==state.isMuted)ctx.notify('volume-change',{volume:state.volume,muted:state.isMuted});
   if(previous?.playbackRate!==state.playbackRate)ctx.notify('rate-change',state.playbackRate);
   if(previous?.status!==state.status){
    if(state.status==='playing'){ctx.notify('play');ctx.notify('playing');}
    else if(state.status==='paused')ctx.notify('pause');
    else if(state.status==='buffering')ctx.notify('waiting');
    else if(state.status==='seeking')ctx.notify('seeking',state.currentTime);
    else if(state.status==='ended')ctx.notify('end');
    if(previous?.status==='seeking'&&state.status!=='seeking')ctx.notify('seeked',state.currentTime);
   }
   previous=state;
  });
  return()=>{disposed=true;unsubscribe();ctx.notify('provider-change',null);ctx.player.controls.canIdle=couldIdle;};
 },[ctx,manager]);
 return null;
}
