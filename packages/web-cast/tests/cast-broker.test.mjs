import test from 'node:test';
import assert from 'node:assert/strict';
import {createCastBroker} from '../server/castBroker.mjs';

async function paired(broker){
 const registration=await broker.dispatch({op:'register',name:'Test receiver',capabilities:{host:'browser',nativeNetworking:false}});
 const receiver={...registration.identity,kind:'receiver'};
 const request=await broker.dispatch({op:'pair',code:registration.code,name:'Test phone'});
 const pending=await broker.dispatch({op:'poll',auth:receiver});
 assert.equal(pending.messages[0].confirmation,request.confirmation);
 assert.equal((await broker.dispatch({op:'pairStatus',requestId:request.requestId,secret:request.secret})).status,'pending');
 await broker.dispatch({op:'confirm',auth:receiver,requestId:request.requestId,allow:true});
 const grant=(await broker.dispatch({op:'pairStatus',requestId:request.requestId,secret:request.secret})).grant;
 const controller={...grant,kind:'controller'};
 await broker.dispatch({op:'connect',auth:controller});
 await broker.dispatch({op:'poll',auth:receiver});
 return{registration,receiver,controller};
}
test('pairing requires receiver approval and private commands preserve provider headers',async()=>{
 const broker=createCastBroker();const {receiver,controller}=await paired(broker);
 const media={id:'sample',source:{url:'https://example.invalid/video.mkv',format:'mkv',headers:{Referer:'https://example.invalid/',Cookie:'test-only'}},subtitles:[{uri:'https://example.invalid/captions.srt'}]};
 await broker.dispatch({op:'send',auth:controller,message:{type:'LOAD_MEDIA',id:'load-1',media}});
 const messages=(await broker.dispatch({op:'poll',auth:receiver})).messages;
 assert.deepEqual(messages[0].media,media);assert.equal(messages[0].controllerId,controller.controllerId);
 await broker.dispatch({op:'send',auth:receiver,controllerId:controller.controllerId,message:{type:'ACK',id:'load-1',ok:true}});
 assert.equal((await broker.dispatch({op:'poll',auth:controller})).messages[0].ok,true);
});
test('tokens cannot be forged or used with another session role',async()=>{
 const broker=createCastBroker();const {receiver,controller}=await paired(broker);
 await assert.rejects(()=>broker.dispatch({op:'poll',auth:{...receiver,token:'wrong'}}),/credentials/);
 await assert.rejects(()=>broker.dispatch({op:'send',auth:{...controller,kind:'other'},message:{type:'STATE'}}),/role/);
 await assert.rejects(()=>broker.dispatch({op:'confirm',auth:controller,requestId:'missing',allow:true}),/receiver/);
 await assert.rejects(()=>broker.dispatch({op:'send',auth:controller,message:{type:'STATE'}}),/Unsupported/);
});
test('remembered controller reconnects without another code, revocation takes effect immediately',async()=>{
 const broker=createCastBroker();const {receiver,controller,registration}=await paired(broker);
 await broker.dispatch({op:'register',identity:registration.identity,name:'Reopened receiver'});
 assert.equal((await broker.dispatch({op:'connect',auth:controller})).name,'Reopened receiver');
 await broker.dispatch({op:'forget',auth:receiver,controllerId:controller.controllerId});
 await assert.rejects(()=>broker.dispatch({op:'connect',auth:controller}),/credentials/);
});
test('expired codes cannot pair and another receiver cannot approve a request',async()=>{
 let time=1;const broker=createCastBroker({now:()=>time});
 const first=await broker.dispatch({op:'register',name:'First'});
 const second=await broker.dispatch({op:'register',name:'Second'});
 const request=await broker.dispatch({op:'pair',code:first.code});
 await assert.rejects(()=>broker.dispatch({op:'confirm',auth:{...second.identity,kind:'receiver'},requestId:request.requestId,allow:true}),/expired/);
 time+=300_001;
 await assert.rejects(()=>broker.dispatch({op:'pair',code:first.code}),/expired/);
});
test('state messages coalesce while discrete controls stay ordered',async()=>{
 const broker=createCastBroker();const {receiver,controller}=await paired(broker);
 for(const currentTime of [1,2,3])await broker.dispatch({op:'send',auth:receiver,message:{type:'STATE',state:{currentTime}}});
 const messages=(await broker.dispatch({op:'poll',auth:controller})).messages;
 assert.equal(messages.length,1);assert.equal(messages[0].state.currentTime,3);
});
test('nearby receiver selection needs confirmation and never exposes credentials',async()=>{
 let time=1;const broker=createCastBroker({now:()=>time});
 const receiver=await broker.dispatch({op:'register',name:'Living room'},{address:'192.168.1.10'});
 const directory=await broker.dispatch({op:'discover'},{address:'192.168.1.50'});
 assert.equal(directory.receivers.length,1);
 assert.deepEqual(Object.keys(directory.receivers[0]).sort(),['discoveryToken','name','receiverId']);
 const nearby=directory.receivers[0];
 assert.equal((await broker.dispatch({op:'discover'},{address:'192.168.2.50'})).receivers.length,0);
 await assert.rejects(()=>broker.dispatch({op:'pair',receiverId:nearby.receiverId,discoveryToken:nearby.discoveryToken},{address:'192.168.2.50'}),/offline|expired/);
 await assert.rejects(()=>broker.dispatch({op:'pair',receiverId:nearby.receiverId,discoveryToken:'wrong'},{address:'192.168.1.50'}),/offline|expired/);
 const request=await broker.dispatch({op:'pair',receiverId:nearby.receiverId,discoveryToken:nearby.discoveryToken},{address:'192.168.1.50'});
 assert.equal((await broker.dispatch({op:'pairStatus',requestId:request.requestId,secret:request.secret})).status,'pending');
 await broker.dispatch({op:'confirm',auth:{...receiver.identity,kind:'receiver'},requestId:request.requestId,allow:true});
 const approved=await broker.dispatch({op:'pairStatus',requestId:request.requestId,secret:request.secret});
 assert.equal(approved.status,'approved');
 assert.equal((await broker.dispatch({op:'connect',auth:{...approved.grant,kind:'controller'}})).name,'Living room');
 time+=45_001;
 assert.equal((await broker.dispatch({op:'discover'},{address:'192.168.1.50'})).receivers.length,0);
});
test('public discovery is scoped to the observed address and refreshed identities invalidate discovery tokens',async()=>{
 const broker=createCastBroker();
 const registration=await broker.dispatch({op:'register',name:'Desktop'},{address:'203.0.113.10'});
 const first=(await broker.dispatch({op:'discover'},{address:'203.0.113.10'})).receivers[0];
 assert.equal((await broker.dispatch({op:'discover'},{address:'203.0.113.20'})).receivers.length,0);
 await broker.dispatch({op:'register',identity:registration.identity},{address:'203.0.113.10'});
 await assert.rejects(()=>broker.dispatch({op:'pair',receiverId:first.receiverId,discoveryToken:first.discoveryToken},{address:'203.0.113.10'}),/offline|expired/);
});
test('forwarded requests need explicit trusted-proxy configuration for discovery',async()=>{
 const {createServer}=await import('node:http');
 for(const trustProxy of [false,true]){
  const broker=createCastBroker({trustProxy});const server=createServer(broker.handler);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
   const endpoint='http://127.0.0.1:'+server.address().port+'/vega-cast/v1';
   const post=async(op,address)=>{const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':address},body:JSON.stringify({op,name:'Test'})});assert.equal(response.status,200);return response.json();};
   await post('register','203.0.113.1');
   assert.equal((await post('discover','203.0.113.1')).receivers.length,trustProxy?1:0);
   assert.equal((await post('discover','203.0.113.2')).receivers.length,0);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 }
});
test('local receivers default to their device hostname without renaming remote devices or custom names',async()=>{
 const {hostname}=await import('node:os');
 const broker=createCastBroker();
 const req={socket:{remoteAddress:'127.0.0.1'},headers:{host:'localhost:5173'}};
 const local=await broker.dispatch({op:'register',name:'Windows PC',useDeviceName:true},{req});
 assert.equal(local.name,hostname());
 const custom=await broker.dispatch({op:'register',identity:local.identity,name:'Living room'},{req});
 assert.equal(custom.name,'Living room');
 const remote=await broker.dispatch({op:'register',name:'Android device',useDeviceName:true},{req:{socket:{remoteAddress:'203.0.113.10'},headers:{host:'cast.example'}}});
 assert.equal(remote.name,'Android device');
});
test('loss of controller heartbeats notifies the receiver without issuing STOP',async()=>{
 let time=1;const broker=createCastBroker({now:()=>time});
 const {receiver,controller}=await paired(broker);
 time+=30_000;
 await broker.dispatch({op:'send',auth:receiver,message:{type:'STATE',state:{currentTime:30}}});
 time+=16_000;
 const messages=(await broker.dispatch({op:'poll',auth:receiver})).messages;
 assert.deepEqual(messages,[{type:'CONTROLLER_DISCONNECT',controllerId:controller.controllerId,reason:'connection-lost'}]);
 // A returning phone's next authenticated poll restores control and dismisses
 // the receiver's stale disconnected prompt through CONTROLLER_CONNECTED.
 await broker.dispatch({op:'poll',auth:controller});
 const reconnected=(await broker.dispatch({op:'poll',auth:receiver})).messages;
 assert.equal(reconnected[0].type,'CONTROLLER_CONNECTED');
});
test('server change requests and results are private and role-restricted',async()=>{
 const broker=createCastBroker();const {receiver,controller}=await paired(broker);
 await broker.dispatch({op:'send',auth:receiver,controllerId:controller.controllerId,message:{type:'SERVER_CHANGE',requestId:'switch',mediaId:'movie',serverId:'server-1',position:120}});
 const request=(await broker.dispatch({op:'poll',auth:controller})).messages[0];
 assert.equal(request.type,'SERVER_CHANGE');assert.equal(request.serverId,'server-1');
 await assert.rejects(()=>broker.dispatch({op:'send',auth:controller,message:request}),/Unsupported/);
 await broker.dispatch({op:'send',auth:controller,message:{type:'SERVER_CHANGE_RESULT',requestId:'switch',ok:false,error:'Unavailable'}});
 const result=(await broker.dispatch({op:'poll',auth:receiver})).messages[0];
 assert.equal(result.type,'SERVER_CHANGE_RESULT');assert.equal(result.controllerId,controller.controllerId);
});

test('pending pairing notification is redelivered after a lost poll without flooding the queue',async()=>{
 let time=1000;const broker=createCastBroker({now:()=>time});
 const registration=await broker.dispatch({op:'register',name:'Receiver'});
 const auth={...registration.identity,kind:'receiver'};
 const pair=await broker.dispatch({op:'pair',code:registration.code,name:'Phone'});
 // Simulate a response that the server delivered but the browser never received.
 await broker.dispatch({op:'poll',auth});
 time+=3001;
 await broker.dispatch({op:'pairStatus',requestId:pair.requestId,secret:pair.secret});
 time+=3001;
 await broker.dispatch({op:'pairStatus',requestId:pair.requestId,secret:pair.secret});
 const messages=(await broker.dispatch({op:'poll',auth})).messages;
 assert.equal(messages.length,1);
 assert.equal(messages[0].requestId,pair.requestId);
 await broker.dispatch({op:'confirm',auth,requestId:pair.requestId,allow:true});
 time+=3001;
 assert.equal((await broker.dispatch({op:'pairStatus',requestId:pair.requestId,secret:pair.secret})).status,'approved');
});
