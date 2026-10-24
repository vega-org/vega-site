import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const dataUrl=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const hostSource=await readFile(new URL('../src/platform/receiverHost.ts',import.meta.url),'utf8');
const host=dataUrl(ts.transpileModule(hostSource,{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText);
const errorsSource=await readFile(new URL('../src/player/errors.ts',import.meta.url),'utf8');
const errors=dataUrl(ts.transpileModule(errorsSource,{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText);
const source=await readFile(new URL('../src/cast/ReceiverSession.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText
 .replace('import.meta.env.VITE_VEGA_CAST_SERVICE_URL','undefined')
 .replace(/from ['"]\.\.\/platform\/receiverHost['"]/g,'from '+JSON.stringify(host))
 .replace(/from ['"]\.\.\/player\/errors['"]/g,'from '+JSON.stringify(errors));
const {ReceiverSession}=await import(dataUrl(compiled));
function fixture(onLoad){
 globalThis.window={};
 globalThis.location={origin:'http://receiver.test',protocol:'http:'};
 globalThis.localStorage={getItem:()=>null};
 globalThis.fetch=async()=>({ok:true,json:async()=>({})});
 const calls=[];let state={status:'playing',currentTime:123,duration:600};
 const manager={getState:()=>state,load:async source=>{calls.push(['load',source]);onLoad?.(source,partial=>{state={...state,...partial};});},unload:async()=>{calls.push(['unload']);state={...state,status:'idle'};},play:async()=>{calls.push(['play']);state={...state,status:'playing'};}};
 const session=new ReceiverSession(manager,async()=>{});
 let snapshot;session.subscribe(next=>{snapshot=next;});
 return{session,calls,snapshot:()=>snapshot,setState:partial=>{state={...state,...partial};}};
}
const load=(session,delivery='direct',id='movie')=>session.receive({type:'LOAD_MEDIA',id:'load-'+id,controllerId:'phone',media:{id,title:'Movie',delivery,source:{url:'https://example.invalid/video.mkv'}}});
test('direct disconnect offers a choice without pausing, reloading or resetting the clock',async()=>{
 const f=fixture();await load(f.session);
 await f.session.receive({type:'CONTROLLER_DISCONNECT',controllerId:'phone'});
 assert.equal(f.snapshot().disconnectedMedia.id,'movie');
 await f.session.resolveDisconnect(true);
 assert.equal(f.snapshot().disconnectedMedia,undefined);
 assert.deepEqual(f.calls.map(call=>call[0]),['load']);
});
test('closing disconnected direct playback unloads the player; continuing paused playback resumes it',async()=>{
 const f=fixture();await load(f.session);
 await f.session.receive({type:'CONTROLLER_DISCONNECT',controllerId:'phone'});
 await f.session.resolveDisconnect(false);
 assert.deepEqual(f.calls.map(call=>call[0]),['load','unload']);
 const paused=fixture();await load(paused.session);paused.setState({status:'paused'});
 await paused.session.receive({type:'CONTROLLER_DISCONNECT',controllerId:'phone'});
 await paused.session.resolveDisconnect(true);
 assert.deepEqual(paused.calls.map(call=>call[0]),['load','play']);
});
test('phone-proxy, inactive media and unrelated controllers do not show the independent-playback prompt',async()=>{
 const proxied=fixture();await load(proxied.session,'phone-proxy');
 await proxied.session.receive({type:'CONTROLLER_DISCONNECT',controllerId:'phone'});
 assert.equal(proxied.snapshot().disconnectedMedia,undefined);
 const unrelated=fixture();await load(unrelated.session);
 await unrelated.session.receive({type:'CONTROLLER_DISCONNECT',controllerId:'other'});
 assert.equal(unrelated.snapshot().disconnectedMedia,undefined);
 unrelated.setState({status:'ended'});
 await unrelated.session.receive({type:'CONTROLLER_DISCONNECT',controllerId:'phone'});
 assert.equal(unrelated.snapshot().disconnectedMedia,undefined);
});
test('new media, local playback and reconnection dismiss stale disconnect choices',async()=>{
 const f=fixture();await load(f.session);
 await f.session.receive({type:'CONTROLLER_DISCONNECT',controllerId:'phone'});
 await load(f.session,'direct','next');
 await f.session.resolveDisconnect(false);
 assert.deepEqual(f.calls.map(call=>call[0]),['load','load']);
 await f.session.receive({type:'CONTROLLER_DISCONNECT',controllerId:'phone'});
 f.session.releaseMedia();
 assert.equal(f.snapshot().disconnectedMedia,undefined);
 await load(f.session);
 await f.session.receive({type:'CONTROLLER_DISCONNECT',controllerId:'phone'});
 await f.session.receive({type:'CONTROLLER_CONNECTED',controllerId:'phone',name:'Phone'});
 assert.equal(f.snapshot().disconnectedMedia,undefined);
});
const dualMedia={id:'dual',title:'Movie',delivery:'direct',startPosition:120,source:{url:'https://origin.example/movie.mkv',format:'mkv'},proxy:{source:{url:'http://192.168.1.2:8000/stream/ready',format:'mkv'},subtitles:[{uri:'http://192.168.1.2:8000/subtitle/ready',language:'en'}]}};
const dualLoad=(session,media=dualMedia)=>session.receive({type:'LOAD_MEDIA',id:'dual-load',controllerId:'phone',media});
test('provided proxy stays unused when direct playback succeeds',async()=>{
 const f=fixture();await dualLoad(f.session);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0][1].source,dualMedia.source.url);
 assert.equal(f.session.media.delivery,'direct');
});
test('receiver selects the provided proxy for browser-forbidden headers without trying the original or borrowing old playback time',async()=>{
 const f=fixture();await dualLoad(f.session,{...dualMedia,source:{...dualMedia.source,headers:{Cookie:'provider-cookie'}}});
 assert.equal(f.calls.length,1);assert.equal(f.calls[0][1].source,dualMedia.proxy.source.url);
 assert.equal(f.calls[0][1].startPosition,120);
 assert.equal(f.session.media.delivery,'phone-proxy');
 assert.equal(f.calls[0][1].headers,undefined);
});
test('CORS failure switches automatically to the supplied proxy once',async()=>{
 const f=fixture((source,update)=>update(source.source===dualMedia.source.url?{status:'error',currentTime:0,error:{category:'CORS_BLOCKED',message:'CORS blocked'}}:{status:'playing',error:null}));
 await dualLoad(f.session);
 assert.deepEqual(f.calls.map(call=>call[1].source),[dualMedia.source.url,dualMedia.proxy.source.url]);
 assert.equal(f.calls[1][1].startPosition,120);
 assert.equal(f.calls[1][1].externalSubtitles[0].source,dualMedia.proxy.subtitles[0].uri);
});
test('proxy replacement preserves active playback position and selected tracks',async()=>{
 const f=fixture();await dualLoad(f.session);
 f.setState({currentTime:250,selectedAudioTrackId:2,selectedSubtitleTrackId:4});
 await f.session.useProvidedProxy(f.session.media,'NETWORK_ERROR');
 const replacement=f.calls[1][1];
 assert.equal(replacement.startPosition,250);assert.equal(replacement.audioTrackId,2);assert.equal(replacement.subtitleTrackId,4);
 await f.session.receive({type:'CONTROLLER_DISCONNECT',controllerId:'phone'});
 assert.equal(f.snapshot().disconnectedMedia,undefined);
});
test('failed proxy is not retried and codec failures do not select an access proxy',async()=>{
 const failed=fixture((source,update)=>update({status:'error',currentTime:0,error:{category:'NETWORK_ERROR',message:'Failed to fetch'}}));
 await dualLoad(failed.session);assert.equal(failed.calls.length,2);
 const codec=fixture((source,update)=>update({status:'error',error:{category:'UNSUPPORTED_VIDEO_CODEC',message:'Video codec unsupported'}}));
 await dualLoad(codec.session);assert.equal(codec.calls.length,1);
});
test('a thrown header-access failure also switches to the supplied proxy',async()=>{
 const f=fixture((source,update)=>{if(source.source===dualMedia.source.url)throw new Error('Refused to set unsafe header');update({status:'playing',error:null});});
 await dualLoad(f.session);
 assert.equal(f.calls.length,2);assert.equal(f.calls[1][1].source,dualMedia.proxy.source.url);
});
test('access proxy can request one existing audio conversion fallback without looping',async()=>{
 const f=fixture((source,update)=>update({status:'error',error:{category:'UNSUPPORTED_AUDIO_CODEC',message:'Unsupported audio codec'}}));
 const messages=[];f.session.send=async message=>{messages.push(message);return {};};
 await dualLoad(f.session,{...dualMedia,source:{...dualMedia.source,headers:{Cookie:'provider-cookie'}}});
 assert.equal(messages.filter(message=>message.type==='FALLBACK_REQUEST').length,1);
 await f.session.receive({type:'FALLBACK_SOURCE',id:'converted',controllerId:'phone',media:{...dualMedia,delivery:'phone-proxy',attempt:1,source:{url:'http://phone.test/converted.mp4',format:'mp4'}}});
 assert.equal(messages.filter(message=>message.type==='FALLBACK_REQUEST').length,1);
});
const serverMedia={...dualMedia,processing:'original',servers:[{id:'server-0',name:'Alpha',quality:'1080p'},{id:'server-1',name:'Beta',quality:'720p'}],selectedServerId:'server-0'};
test('receiver requests a known alternate server with its authoritative position',async()=>{
 const f=fixture();await dualLoad(f.session,serverMedia);
 assert.equal(f.snapshot().canChangeServer,true);
 const messages=[];f.session.send=async message=>{messages.push(message);return {};};
 await f.session.selectServer('server-1');
 assert.equal(messages[0].type,'SERVER_CHANGE');assert.equal(messages[0].serverId,'server-1');assert.equal(messages[0].position,123);
 assert.equal(f.snapshot().changingServer,true);
 await f.session.receive({type:'SERVER_CHANGE_RESULT',controllerId:'phone',requestId:messages[0].requestId,ok:false,error:'Server unavailable'});
 assert.equal(f.snapshot().changingServer,false);assert.equal(f.snapshot().serverError,'Server unavailable');
 f.session.stop();
});
test('server selection is disabled for remuxed and disconnected media, while raw proxy remains eligible',async()=>{
 const f=fixture();await dualLoad(f.session,{...serverMedia,processing:'remuxed',delivery:'phone-proxy'});
 assert.equal(f.snapshot().canChangeServer,false);await assert.rejects(()=>f.session.selectServer('server-1'),/unavailable/);
 await f.session.receive({type:'LOAD_MEDIA',id:'raw-load',controllerId:'phone',media:{...serverMedia,delivery:'phone-proxy'}});
 assert.equal(f.snapshot().canChangeServer,true);
 await assert.rejects(()=>f.session.selectServer('untrusted-url'),/Unknown server/);
 await f.session.receive({type:'CONTROLLER_DISCONNECT',controllerId:'phone'});
 assert.equal(f.snapshot().canChangeServer,false);
 f.session.stop();
});
test('replacement source clears the pending server choice and selects the new server',async()=>{
 const f=fixture();await dualLoad(f.session,serverMedia);
 await f.session.selectServer('server-1');
 await f.session.receive({type:'LOAD_MEDIA',id:'next-server',controllerId:'phone',media:{...serverMedia,id:'replacement',selectedServerId:'server-1',startPosition:123}});
 assert.equal(f.snapshot().changingServer,false);assert.equal(f.snapshot().selectedServerId,'server-1');
 f.session.stop();
});

test('rapid status changes reach mobile even inside the position update throttle',async()=>{
 const f=fixture();
 let update;
 const sent=[];
 f.session.manager.subscribe=callback=>{update=callback;return()=>{};};
 f.session.request=async()=>({identity:{},name:'Receiver',code:'123456',expiresAt:0});
 f.session.poll=async()=>{};
 f.session.send=async message=>{sent.push(message);};
 await f.session.start('Receiver');
 assert.equal(typeof update,'function');
 f.session.controllerId='phone';
 const state={status:'playing',currentTime:10,duration:120};
 update(state);
 update({...state,currentTime:11});
 update({...state,status:'buffering'});
 update({...state,status:'ended'});
 assert.deepEqual(sent.map(message=>message.state.status),['playing','buffering','ended']);
 f.session.stop();
});

test('worker chunk failures are player asset errors and never request a media proxy or conversion',async()=>{
 const {normalizePlaybackError}=await import(errors);
 const failure=normalizePlaybackError(new Error('ChunkLoadError: Loading chunk 573 failed. (missing: http://localhost:5173/573.avplayer.js)'));
 assert.equal(failure.category,'PLAYER_ASSET_ERROR');
 assert.equal(failure.recoverable,false);
 const f=fixture((source,update)=>update({status:'error',error:failure}));
 const messages=[];f.session.send=async message=>{messages.push(message);};
 await dualLoad(f.session);
 assert.equal(f.calls.length,1);
 assert.equal(f.session.media.delivery,'direct');
 assert.equal(messages.some(message=>['FALLBACK_REQUEST','DELIVERY_CHANGED'].includes(message.type)),false);
 assert.equal(messages.find(message=>message.type==='PLAYBACK_ERROR').category,'PLAYER_ASSET_ERROR');
});

test('libmedia IPC request failure is not treated as container or source access failure',async()=>{
 const {normalizePlaybackError}=await import(errors);
 const failure=normalizePlaybackError(new Error('open stream failed, ret: -2097152, taskId: test'));
 assert.equal(failure.category,'PLAYER_INTERNAL_ERROR');
 const f=fixture((source,update)=>update({status:'error',error:failure}));
 const messages=[];f.session.send=async message=>{messages.push(message);};
 await dualLoad(f.session);
 assert.equal(f.calls.length,1);
 assert.equal(messages.some(message=>['FALLBACK_REQUEST','DELIVERY_CHANGED'].includes(message.type)),false);
});

test('a failed browser access check switches to proxy after one fetch without opening direct media',async()=>{
 const f=fixture();const requests=[];
 f.session.send=async()=>{};
 globalThis.fetch=async(url,options)=>{requests.push({url,options});throw new TypeError('Failed to fetch');};
 await dualLoad(f.session);
 assert.equal(requests.length,1);
 assert.equal(requests[0].url,dualMedia.source.url);
 assert.equal(requests[0].options.headers.Range,'bytes=0-0');
 assert.equal(requests[0].options.mode,'cors');
 assert.equal(f.calls.length,1);
 assert.equal(f.calls[0][1].source,dualMedia.proxy.source.url);
 assert.equal(f.session.media.delivery,'phone-proxy');
});

test('successful access probe cancels its body and disables engine retries for direct casting',async()=>{
 const f=fixture();let canceled=0;
 f.session.send=async()=>{};
 globalThis.fetch=async()=>({ok:true,status:200,body:{cancel:async()=>{canceled++;}}});
 await dualLoad(f.session);
 assert.equal(canceled,1);
 assert.equal(f.calls[0][1].source,dualMedia.source.url);
 assert.equal(f.calls[0][1].networkRetryCount,0);
});

test('repeated pairing notifications keep one confirmation dialog request',async()=>{
 const f=fixture();const message={type:'PAIR_REQUEST',requestId:'pair-one',name:'Phone',confirmation:'1234'};
 await f.session.receive(message);await f.session.receive(message);
 assert.equal(f.snapshot().pending.length,1);
});

test('HTTPS receiver permits browser-managed HTTP phone delivery instead of rejecting before permission',async()=>{
 const f=fixture();globalThis.location={origin:'https://receiver.test',protocol:'https:'};
 await dualLoad(f.session,{...dualMedia,source:{...dualMedia.source,headers:{Cookie:'provider-cookie'}}});
 assert.equal(f.calls.length,1);
 assert.equal(f.calls[0][1].source,dualMedia.proxy.source.url);
 assert.equal(f.session.media.delivery,'phone-proxy');
});
