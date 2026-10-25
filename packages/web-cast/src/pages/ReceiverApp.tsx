import {DisconnectedPlaybackDialog} from '../components/DisconnectedPlaybackDialog';
import {useCallback,useEffect,useRef,useState} from 'react';
import {PlayerManager} from '../player/PlayerManager';
import {initialPlaybackState,type PlaybackState} from '../core/playback-state';
import type {CastMedia} from '../cast/protocol';
import {ReceiverSession,type ReceiverSessionState} from '../cast/ReceiverSession';
import {receiverCapabilities,receiverHost,defaultReceiverName} from '../platform/receiverHost';
import {browserPlatform} from '../platform/browser/browserPlatform';
import {VideoPlayer} from '../components/VideoPlayer';
import {Icon,type IconName} from '../components/Icon';
import {PairingQr} from '../components/PairingQr';
import {FocusDialog} from '../components/FocusDialog';
import {useRemoteNavigation} from '../input/useRemoteNavigation';
import '../receiver.css';

type View='watch'|'connect'|'devices'|'settings';
const read=(key:string,fallback:string)=>{try{return localStorage.getItem(key)||fallback;}catch{return fallback;}};
const save=(key:string,value:string)=>{try{localStorage.setItem(key,value);}catch{/* Storage can be unavailable on an app host. */}};
const initialSession:ReceiverSessionState={status:'offline',name:'Vega receiver',code:'',expiresAt:0,invitation:'',pending:[],phones:[]};

export function ReceiverApp(){
 const [runtime,setRuntime]=useState<{manager:PlayerManager;session:ReceiverSession}|null>(null);
 const [state,setState]=useState<PlaybackState>(initialPlaybackState);
 const [session,setSession]=useState(initialSession);
 const [view,setView]=useState<View>('watch');
 const [media,setMedia]=useState<CastMedia|null>(null);
 const [name,setName]=useState(()=>read('vega.cast.name',defaultReceiverName()));
 const automaticName=useRef(!read('vega.cast.name',''));
 const [clock,setClock]=useState(Date.now());
 const [localFile,setLocalFile]=useState<File|null>(null);
 const [notice,setNotice]=useState('');
 const fileRef=useRef<HTMLInputElement>(null);
 const showMedia=useCallback(async(next:CastMedia)=>{setMedia(next);await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));},[]);
 useEffect(()=>{
  const manager=new PlayerManager();const receiver=new ReceiverSession(manager,showMedia);
  const unsubscribe=manager.subscribe(next=>{setState(next);if(next.status==='idle')setMedia(null);});
  const stop=receiver.subscribe(next=>{setSession(next);if(automaticName.current&&(next.status==='ready'||next.status==='connected'))setName(next.name);});setRuntime({manager,session:receiver});
  return()=>{stop();unsubscribe();receiver.stop();void manager.destroy();};
 },[showMedia]);
 useEffect(()=>{if(runtime)void runtime.session.start(name,automaticName.current&&!window.vegaCastHost?.deviceName);},[runtime,name]);
 useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{if(!media&&browserPlatform.isFullscreen())void browserPlatform.exitFullscreen().catch(()=>{});},[media]);
 const exitPlayer=useCallback(()=>{runtime?.session.releaseMedia();setMedia(null);void runtime?.manager.unload();},[runtime]);
 const back=useCallback(()=>{const pending=session.pending[0];if(pending){void runtime?.session.confirm(pending.requestId,false).catch(error=>setNotice(error.message));return;}if(session.disconnectedMedia){void runtime?.session.resolveDisconnect(true).catch(error=>setNotice(error.message));return;}if(media)exitPlayer();else setView('watch');},[media,exitPlayer,session.pending,session.disconnectedMedia,runtime]);
 useRemoteNavigation(back);
 const openFile=async(file:File)=>{
  if(!runtime)return;runtime.session.releaseMedia();setLocalFile(file);setNotice('');
  const next:CastMedia={id:crypto.randomUUID?.()||`local-${Date.now()}`,title:file.name.replace(/\.[^.]+$/,''),subtitle:'Local playback',source:{url:''}};
  await showMedia(next);await runtime.manager.load({id:next.id,title:next.title,source:file});
 };
 const retry=()=>{if(localFile)void openFile(localFile);else setNotice('Choose the stream again in Vega Mobile.');};
 const caps=receiverCapabilities();
 const connected=session.status==='connected';
 const expires=Math.max(0,Math.ceil((session.expiresAt-clock)/1000));
 const request=session.pending[0];
 const nav:{id:View;icon:IconName;label:string}[]=[{id:'watch',icon:'home',label:'Watch'},{id:'connect',icon:'cast',label:'Connect'},{id:'devices',icon:'phone',label:'Devices'},{id:'settings',icon:'settings',label:'Settings'}];
 const act=(work:Promise<unknown>|undefined)=>{void work?.catch(error=>setNotice(error instanceof Error?error.message:'Action failed'));};
 return <div className="receiver-app" onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();const file=event.dataTransfer.files[0];if(file)void openFile(file);}}>
  <div className="receiver-shell" aria-hidden={!!media} inert={!!media}>
   <aside className="receiver-sidebar"><button className="vega-brand" onClick={()=>setView('watch')} aria-label="Vega Cast home"><span className="vega-brand-icon" aria-hidden="true"/><span>Vega Cast</span></button><nav aria-label="Main navigation">{nav.map(item=><button key={item.id} className={`nav-item ${view===item.id?'active':''}`} onClick={()=>setView(item.id)} aria-current={view===item.id?'page':undefined}><Icon name={item.icon}/><span>{item.label}</span>{item.id==='devices'&&session.phones.length>0&&<small>{session.phones.length}</small>}</button>)}</nav></aside>
   <div className="receiver-main">
    <header className="receiver-header"><div className="header-breadcrumb"><strong>{nav.find(item=>item.id===view)?.label}</strong></div><div className="header-right"><button className={`connection-pill ${connected?'connected':''}`} onClick={()=>setView('connect')}><i/>{connected?'Mobile connected':session.status==='ready'?'Ready to connect':'This screen'}<span>{name}</span></button><time>{new Date(clock).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time></div></header>
    {notice&&<div className="receiver-notice" role="alert">{notice}<button onClick={()=>setNotice('')} aria-label="Dismiss"><Icon name="close" size={16}/></button></div>}
    {view==='watch'&&<main className="watch-view"><div className="home-heading"><h1>Vega Cast</h1><p>Open a file or connect Vega Mobile.</p></div><div className="watch-actions"><button className="watch-card local-card" onClick={()=>fileRef.current?.click()}><span className="card-icon"><Icon name="file" size={28}/></span><strong>Open file</strong><span className="card-description">Choose a video from this device.</span></button><button className="watch-card connect-card" onClick={()=>setView('connect')}><span className="card-icon"><Icon name="cast" size={28}/></span><strong>Connect mobile</strong><span className="card-description">Pair with Vega Mobile.</span></button></div></main>}
    {view==='connect'&&<main className="connect-view"><div className="page-intro"><h1>Connect mobile</h1><p>Open <strong>Play on → Vega Cast</strong> in Vega Mobile.<br/>Select this receiver from the list, or scan the QR code.</p><div className="pairing-steps"><div><b>01</b><span>Connect your phone</span></div><div><b>02</b><span>Confirm the matching code here</span></div><div><b>03</b><span>Choose something to watch</span></div></div><div className="privacy-line"><Icon name="check" size={17}/> Only phones you approve can control this screen.</div></div><section className="pairing-card" aria-label="Receiver pairing"><div className="pairing-device"><Icon name="screen"/><strong>{name}</strong><span className="live-dot"/></div>{session.invitation?<PairingQr value={session.invitation}/>:<div className="pairing-placeholder"><Icon name="cast" size={48}/><span>{session.status==='error'?'Connection unavailable':'Connecting receiver…'}</span></div>}<p className="pairing-code-label">SELECT THIS RECEIVER OR SCAN TO CONNECT</p><p className="pairing-expiry">{expires>0?`QR expires in ${Math.floor(expires/60)}:${String(expires%60).padStart(2,'0')}`:'Refresh the QR code to connect'}</p><button className="quiet-button" onClick={()=>act(runtime?.session.refreshCode())}>Refresh QR code</button>{session.error&&<p className="pairing-error" role="alert">{session.error}</p>}<div className="paired-footnote"><Icon name="phone" size={16}/>{connected?'Mobile connected.':'Your trusted phones reconnect without pairing again.'}</div></section></main>}
    {view==='devices'&&<main className="settings-view"><h1>Devices</h1><p>These phones have permission to control this receiver.</p><div className="device-list">{session.phones.length?session.phones.map(phone=><div className="device-row" key={phone.id}><span className="device-icon"><Icon name="phone"/></span><div><strong>{phone.name}</strong><span>Paired device</span></div><button className="quiet-button" onClick={()=>act(runtime?.session.forget(phone.id))}>Forget</button></div>):<div className="empty-devices"><Icon name="phone" size={40}/><h2>No paired devices</h2><p>Pair a phone once to see it here.</p><button className="accent-button" onClick={()=>setView('connect')}>Connect Vega Mobile</button></div>}</div></main>}
    {view==='settings'&&<main className="settings-view"><h1>Settings</h1><div className="setting-panel"><label htmlFor="receiver-name">Receiver name</label><p>Shown in Vega Mobile when you connect.</p><div className="setting-input-row"><input id="receiver-name" data-remote-exit="save-receiver-name" maxLength={64} value={name} onChange={event=>{automaticName.current=false;setName(event.target.value);}}/><button id="save-receiver-name" className="accent-button" onClick={()=>{save('vega.cast.name',name);act(runtime?.session.rename(name));setNotice('Receiver name saved.');}}>Save</button></div></div><div className="setting-panel"><span className="eyebrow">SOURCE ACCESS</span><h2>{caps.nativeNetworking?'App-managed networking':'Browser web security enabled'}</h2><p>{caps.nativeNetworking?'The installed host bridge handles source access and request headers.':'The receiver tries direct playback. Vega Mobile can offer its delivery server when browser rules prevent access.'}</p><span className="setting-tag">{receiverHost()?.name||'Standard browser'}</span></div></main>}
    
   </div>
  </div>
  {runtime&&<div className={`receiver-player-shell ${media?'active':'standby'}`} aria-hidden={!media} inert={!media}><VideoPlayer playerManager={runtime.manager} state={state} title={media?.title} subtitle={media?.subtitle} onExit={exitPlayer} onRetry={retry} active={!!media} servers={session.servers} selectedServerId={session.selectedServerId} canChangeServer={session.canChangeServer} changingServer={session.changingServer} serverError={session.serverError} onSelectServer={id=>act(runtime.session.selectServer(id))}/></div>}
  <input ref={fileRef} className="sr-only" tabIndex={-1} type="file" accept="video/*,.mkv,.webm,.m3u8" onChange={event=>{const file=event.target.files?.[0];if(file)void openFile(file);event.target.value='';}}/>
  {session.disconnectedMedia&&<DisconnectedPlaybackDialog onContinue={()=>act(runtime?.session.resolveDisconnect(true))} onClose={()=>act(runtime?.session.resolveDisconnect(false))}/>}
  {request&&<FocusDialog title="Allow this phone to connect?" onClose={()=>act(runtime?.session.confirm(request.requestId,false))}><p className="dialog-description">{request.name} wants to control this screen. Confirm that the same number appears on your phone.</p><div className="confirmation-code">{request.confirmation}</div><div className="dialog-actions"><button className="quiet-button" onClick={()=>act(runtime?.session.confirm(request.requestId,false))}>Decline</button><button className="accent-button" onClick={()=>act(runtime?.session.confirm(request.requestId,true))}>Confirm & remember</button></div></FocusDialog>}
 </div>;
}
