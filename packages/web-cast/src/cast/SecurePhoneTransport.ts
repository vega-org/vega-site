type Signal={type:string;transportId?:string;mediaId?:string;sdp?:RTCSessionDescriptionInit;candidate?:RTCIceCandidateInit};
interface PhoneResponse {status:number;headers:Record<string,string>;body:ArrayBuffer}
interface Pending {resolve:(value:PhoneResponse)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>;chunks:Uint8Array[];size:number}
export class SecurePhoneTransport {
 private peer:RTCPeerConnection|null=null;
 private channel:RTCDataChannel|null=null;
 private id='';
 private pending=new Map<string,Pending>();
 private closed=false;
 private rejectOpen?: (error:Error)=>void;
 private answerReceived=false;
 private localCandidates=0;
 private remoteCandidates=0;
 private signalErrors=0;
 private signal:(message:Signal)=>Promise<unknown>;
 private mediaId:string;
 private iceServers:RTCIceServer[];
 constructor(signal:(message:Signal)=>Promise<unknown>,mediaId:string,iceServers:RTCIceServer[]=[]){this.signal=signal;this.mediaId=mediaId;this.iceServers=iceServers;}
 private workerMessage=(event:MessageEvent)=>{
  const data=event.data;
  if(data?.type!=='VEGA_PHONE_FETCH'||data.transportId!==this.id||!event.ports[0])return;
  const port=event.ports[0];
  void this.request(data.url,data.range,data.method).then(result=>{
   const type=result.headers['content-type']||'';
   if(/mpegurl/i.test(type)||/\.m3u8(?:\?|$)/i.test(data.url)){
    const text=new TextDecoder().decode(result.body);
    const rewrite=(uri:string)=>this.url(new URL(uri,data.url).toString());
    const playlist=text.split(/\r?\n/).map(line=>line.startsWith('#')?line.replace(/URI="([^"]+)"/g,(_,uri)=>`URI="${rewrite(uri)}"`):line.trim()?rewrite(line.trim()):line).join('\n');
    result.body=new TextEncoder().encode(playlist).buffer;
    delete result.headers['content-length'];delete result.headers['content-range'];
    result.headers['content-type']='application/vnd.apple.mpegurl';result.status=200;
   }
   port.postMessage(result,[result.body]);
  }).catch(error=>port.postMessage({status:502,headers:{'content-type':'text/plain'},body:new TextEncoder().encode(error.message).buffer})).finally(()=>port.close());
 };
 async open():Promise<void>{
  if(!isSecureContext||!('serviceWorker' in navigator)||typeof RTCPeerConnection==='undefined')throw new Error('Encrypted phone delivery requires WebRTC and service workers in a secure browser.');
  const base=import.meta.env.BASE_URL;
  const registration=await navigator.serviceWorker.register(base+'phone-worker.js',{scope:base,updateViaCache:'none'});
  // ready can resolve to the old active worker while the replacement installs.
  const worker=registration.installing||registration.waiting||registration.active;
  if(!worker)throw new Error('Encrypted delivery worker is unavailable.');
  await new Promise<void>((resolve,reject)=>{
   const cleanup=()=>{clearTimeout(timer);worker.removeEventListener('statechange',changed);};
   const changed=()=>{
    if(worker.state==='activated'){cleanup();resolve();}
    else if(worker.state==='redundant'){cleanup();reject(new Error('Encrypted delivery worker installation failed.'));}
   };
   const timer=setTimeout(()=>{cleanup();reject(new Error('Encrypted delivery worker activation timed out.'));},15_000);
   worker.addEventListener('statechange',changed);changed();
  });
  await new Promise<void>((resolve,reject)=>{
   const cleanup=()=>{clearTimeout(timer);clearInterval(retry);navigator.serviceWorker.removeEventListener('controllerchange',changed);};
   const changed=()=>{if(navigator.serviceWorker.controller?.scriptURL===worker.scriptURL){cleanup();resolve();}};
   const claim=()=>{worker.postMessage({type:'claim'});changed();};
   const timer=setTimeout(()=>{cleanup();reject(new Error(`Encrypted delivery worker could not control this receiver (page: ${location.pathname}, scope: ${new URL(registration.scope).pathname}).`));},10_000);
   const retry=setInterval(claim,500);
   navigator.serviceWorker.addEventListener('controllerchange',changed);claim();
  });
  if(this.closed)throw new Error('Phone delivery closed');
  this.id=crypto.randomUUID();
  navigator.serviceWorker.addEventListener('message',this.workerMessage);
  const peer=this.peer=new RTCPeerConnection({iceServers:this.iceServers});
  peer.onicecandidate=event=>{if(event.candidate){this.localCandidates++;void this.signal({type:'RTC_ICE',transportId:this.id,mediaId:this.mediaId,candidate:event.candidate.toJSON()}).catch(()=>{this.signalErrors++;});}};
  const channel=this.channel=peer.createDataChannel('vega-media-v1',{ordered:true});
  channel.onmessage=event=>this.receive(event.data);
  channel.onclose=()=>this.failPending(new Error('Encrypted phone delivery disconnected'));
  const opened=new Promise<void>((resolve,reject)=>{
   const fail=(error:Error)=>{clearTimeout(timer);this.rejectOpen=undefined;reject(error);};
   const timer=setTimeout(()=>{channel.onopen=null;fail(new Error(`Encrypted phone connection timed out (answer: ${this.answerReceived?'received':'missing'}, ICE: ${peer.iceConnectionState}, candidates: ${this.localCandidates} local / ${this.remoteCandidates} remote, signaling failures: ${this.signalErrors}). Keep both devices on the same Wi-Fi or configure a TURN relay.`));},25_000);
   this.rejectOpen=fail;
   channel.onopen=()=>{clearTimeout(timer);this.rejectOpen=undefined;resolve();};
   channel.onerror=()=>fail(new Error('Encrypted phone connection failed'));
  });
  // Attach a rejection handler immediately while signaling is in flight.
  void opened.catch(()=>{});
  const offer=await peer.createOffer();await peer.setLocalDescription(offer);
  await this.signal({type:'RTC_OFFER',transportId:this.id,mediaId:this.mediaId,sdp:peer.localDescription!.toJSON()});
  await opened;
 }
 private candidates:RTCIceCandidateInit[]=[];
 async receiveSignal(message:Signal):Promise<void>{
  if(message.transportId!==this.id||!this.peer)return;
  if(message.type==='RTC_ANSWER'&&message.sdp){await this.peer.setRemoteDescription(message.sdp);this.answerReceived=true;for(const candidate of this.candidates)await this.peer.addIceCandidate(candidate);this.candidates=[];}
  if(message.type==='RTC_ICE'&&message.candidate){this.remoteCandidates++;if(this.peer.remoteDescription)await this.peer.addIceCandidate(message.candidate);else this.candidates.push(message.candidate);}
 }
 url(source:string):string{
  const url=new URL(import.meta.env.BASE_URL+'phone-media',location.origin);url.searchParams.set('transport',this.id);url.searchParams.set('url',source);return url.toString();
 }
 private request(url:string,range:string|null,method:string):Promise<PhoneResponse>{
  if(this.channel?.readyState!=='open')return Promise.reject(new Error('Encrypted phone delivery is not connected'));
  if(this.pending.size>=8)return Promise.reject(new Error('Too many simultaneous media reads'));
  const id=crypto.randomUUID();
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Phone media read timed out'));},30_000);
   this.pending.set(id,{resolve,reject,timer,chunks:[],size:0});
   try{this.channel!.send(JSON.stringify({type:'READ',id,url,range,method}));}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
  });
 }
 private receive(raw:unknown){
  if(typeof raw!=='string'||raw.length>24_000)return;
  let message;try{message=JSON.parse(raw);}catch{return;}
  const pending=this.pending.get(message.id);if(!pending)return;
  if(message.type==='DATA'&&typeof message.data==='string'){
   const bytes=Uint8Array.from(atob(message.data),char=>char.charCodeAt(0));pending.size+=bytes.length;
   if(pending.size>16*1024*1024){this.finish(message.id,new Error('Phone media response exceeded limit'));return;}
   pending.chunks.push(bytes);
  }else if(message.type==='DONE'){
   const body=new Uint8Array(pending.size);let offset=0;for(const chunk of pending.chunks){body.set(chunk,offset);offset+=chunk.length;}
   clearTimeout(pending.timer);this.pending.delete(message.id);pending.resolve({status:message.status,headers:message.headers||{},body:body.buffer});
  }else if(message.type==='ERROR')this.finish(message.id,new Error(message.message||'Phone media read failed'));
 }
 private finish(id:string,error:Error){const pending=this.pending.get(id);if(pending){clearTimeout(pending.timer);this.pending.delete(id);pending.reject(error);}}
 private failPending(error:Error){for(const id of this.pending.keys())this.finish(id,error);}
 close(){this.closed=true;navigator.serviceWorker?.removeEventListener('message',this.workerMessage);this.rejectOpen?.(new Error('Phone delivery closed'));this.failPending(new Error('Phone delivery closed'));this.channel?.close();this.peer?.close();this.channel=null;this.peer=null;}
}
