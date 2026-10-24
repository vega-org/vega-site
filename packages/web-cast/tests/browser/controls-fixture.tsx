import React from 'react';
import {createRoot} from 'react-dom/client';
import {VideoPlayer} from '../../src/components/VideoPlayer';
import {initialPlaybackState} from '../../src/core/playback-state';
import {useRemoteNavigation} from '../../src/input/useRemoteNavigation';
import {ReceiverSession} from '../../src/cast/ReceiverSession';
import {DisconnectedPlaybackDialog} from '../../src/components/DisconnectedPlaybackDialog';
import '../../src/index.css';
import '../../src/receiver.css';
const listeners=new Set();
const calls=[];
let state={...initialPlaybackState,status:'paused',duration:120,currentTime:30,buffered:80};
const update=partial=>{state={...state,...partial};for(const fn of listeners)fn(state);};
const manager={
 getState:()=>state,
 load:async()=>{calls.push(['load']);update({status:'playing'});},
 unload:async()=>{calls.push(['unload']);update({status:'idle'});},
 attach(){},detach(){},subscribe(fn){listeners.add(fn);fn(state);return()=>listeners.delete(fn);},
 play(){calls.push(['play']);update({status:'playing'});return Promise.resolve();},
 resumeAudio(){calls.push(['resume-audio']);update({audioNeedsUserGesture:false});return Promise.resolve();},
 pause(){calls.push(['pause']);update({status:'paused'});return Promise.resolve();},
 togglePlay(){return state.status==='playing'?this.pause():this.play();},
 seek(time){calls.push(['seek',time]);update({currentTime:time});return Promise.resolve();},
 seekRelative(delta){return this.seek(state.currentTime+delta);},
 setMuted(value){calls.push(['mute',value]);update({isMuted:value});},
 toggleMute(){this.setMuted(!state.isMuted);},
 setVolume(value){calls.push(['volume',value]);update({volume:value});},
 setPlaybackRate(value){calls.push(['rate',value]);update({playbackRate:value});},
 selectQuality(id){calls.push(['quality',id]);update({selectedQualityId:id});return Promise.resolve();},
 selectAudioTrack(id){calls.push(['audio',id]);update({trackSwitching:{type:'audio',id}});return new Promise(resolve=>setTimeout(()=>{update({selectedAudioTrackId:id,trackSwitching:null});resolve();},window.controlTest?.switchDelay||0));},
 selectSubtitleTrack(id){calls.push(['subtitle',id]);update({trackSwitching:{type:'subtitle',id}});return new Promise(resolve=>setTimeout(()=>{update({selectedSubtitleTrackId:id,subtitleEnabled:id!==-1,trackSwitching:null});resolve();},window.controlTest?.switchDelay||0));},
};
const receiver=new ReceiverSession(manager,async()=>{});
receiver.send=async message=>{if(message.type==='SERVER_CHANGE')calls.push(['server-change',message.serverId,message.position]);return {ok:true};};
function Fixture(){
 const [receiverState,setReceiverState]=React.useState({});
 useRemoteNavigation(()=>{if(receiverState.disconnectedMedia)void receiver.resolveDisconnect(true);});
 const [current,setCurrent]=React.useState(state);
 React.useEffect(()=>manager.subscribe(setCurrent),[]);
 React.useEffect(()=>receiver.subscribe(setReceiverState),[]);
 return <div className="receiver-app"><div style={{height:540,width:960}}><VideoPlayer playerManager={manager} state={current} title="Control test" onExit={()=>calls.push(['exit'])} servers={receiverState.servers} selectedServerId={receiverState.selectedServerId} canChangeServer={receiverState.canChangeServer} changingServer={receiverState.changingServer} serverError={receiverState.serverError} onSelectServer={id=>{void receiver.selectServer(id);}}/></div>{receiverState.disconnectedMedia&&<DisconnectedPlaybackDialog onContinue={()=>{void receiver.resolveDisconnect(true);}} onClose={()=>{void receiver.resolveDisconnect(false);}}/>}</div>;
}
window.controlTest={calls,update,getState:()=>state,disconnect:async()=>{await receiver.receive({type:'LOAD_MEDIA',id:'remote-load',controllerId:'phone',media:{id:'remote',title:'Movie',delivery:'direct',source:{url:'https://example.invalid/video.mkv'}}});await receiver.receive({type:'CONTROLLER_DISCONNECT',controllerId:'phone'});}};
window.controlTest.loadServers=(processing='original',delivery='direct')=>receiver.receive({type:'LOAD_MEDIA',id:'servers-'+processing+delivery,controllerId:'phone',media:{id:'servers',title:'Movie',processing,delivery,source:{url:'https://example.invalid/video.mkv'},servers:[{id:'server-0',name:'Alpha',quality:'1080p'},{id:'server-1',name:'Beta',quality:'720p'}],selectedServerId:'server-0'}});
window.controlTest.disconnectController=()=>receiver.receive({type:'CONTROLLER_DISCONNECT',controllerId:'phone'});
createRoot(document.getElementById('test-root')).render(<React.StrictMode><Fixture/></React.StrictMode>);
