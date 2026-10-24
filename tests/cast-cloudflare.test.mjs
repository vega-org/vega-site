import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const bundle=await build({entryPoints:['cloudflare/test-entry.mjs'],bundle:true,write:false,format:'esm',platform:'node',external:['cloudflare:workers','node:*']});
const script=bundle.outputFiles[0].text;
const options={modules:true,script,compatibilityDate:'2026-04-03',compatibilityFlags:['nodejs_compat'],durableObjects:{VEGA_CAST_SESSIONS:{className:'CastSession',useSQLite:true},VEGA_CAST_DIRECTORY:{className:'CastDirectory',useSQLite:true}}};
const request=async(mf,body,{ip='203.0.113.10',url='https://vega.test/vega-cast/v1'}={})=>{
 const result=await mf.dispatchFetch(url,{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':ip},body:JSON.stringify(body)});
 return {status:result.status,...await result.json()};
};
async function paired(mf){
 const receiver=await request(mf,{op:'register',name:'Living room',capabilities:{host:'browser',browserSecurity:true}});
 assert.equal(receiver.status,200);
 assert.match(receiver.serviceUrl,/room=[a-f0-9]{32}/);
 const pair=await request(mf,{op:'pair',code:receiver.code,name:'Phone'},{url:receiver.serviceUrl,ip:'203.0.113.99'});
 assert.equal(pair.status,200);
 const auth={...receiver.identity,kind:'receiver'};
 const queued=await request(mf,{op:'poll',auth});
 assert.equal(queued.messages[0].confirmation,pair.confirmation);
 assert.equal((await request(mf,{op:'confirm',auth,requestId:pair.requestId,allow:true})).status,200);
 const approval=await request(mf,{op:'pairStatus',requestId:pair.requestId,secret:pair.secret});
 assert.equal(approval.status,'approved');
 return {receiver,auth,controller:{...approval.grant,kind:'controller'}};
}

test('Cloudflare runtime pairs across networks, restricts discovery and transports private commands',async()=>{
 const mf=new Miniflare(options);
 try{
  const {receiver,auth,controller}=await paired(mf);
  const nearby=await request(mf,{op:'discover'});
  assert.equal(nearby.receivers.length,1);
  assert.equal(nearby.receivers[0].name,'Living room');
  assert.equal(JSON.stringify(nearby).includes(receiver.identity.token),false);
  assert.deepEqual((await request(mf,{op:'discover'},{ip:'203.0.113.11'})).receivers,[]);
  await request(mf,{op:'connect',auth:controller});
  const source={url:'https://media.invalid/movie.mkv',headers:{Authorization:'secret-source-token'}};
  await request(mf,{op:'send',auth:controller,message:{type:'LOAD_MEDIA',id:'one',media:{id:'movie',source}}});
  const received=await request(mf,{op:'poll',auth});
  assert.deepEqual(received.messages.find(item=>item.type==='LOAD_MEDIA').media.source,source);
  assert.equal((await request(mf,{op:'send',auth:controller,message:{type:'STATE'}})).status,400);
  assert.equal((await request(mf,{op:'poll',auth:{...auth,token:'forged'}})).status,401);
  await request(mf,{op:'forget',auth,controllerId:controller.controllerId});
  assert.equal((await request(mf,{op:'connect',auth:controller})).status,401);
 }finally{await mf.dispose();}
});

test('receiver trust survives a runtime restart without persisting stream messages',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'vega-cast-cloudflare-'));
 let mf=new Miniflare({...options,durableObjectsPersist:directory});
 try{
  const {receiver,controller}=await paired(mf);
  await request(mf,{op:'send',auth:controller,message:{type:'LOAD_MEDIA',media:{source:{url:'https://private.invalid/not-persisted',headers:{Cookie:'private-cookie'}}}}});
  await mf.dispose();mf=new Miniflare({...options,durableObjectsPersist:directory});
  const restored=await request(mf,{op:'register',identity:receiver.identity,name:'Living room'});
  assert.equal(restored.status,200);
  assert.equal(restored.rememberedControllers[0].id,controller.controllerId);
  assert.equal((await request(mf,{op:'connect',auth:controller})).status,200);
  const state=await request(mf,{op:'poll',auth:{...receiver.identity,kind:'receiver'}});
  assert.equal(state.messages.some(message=>message.type==='LOAD_MEDIA'),false);
 }finally{
  await mf.dispose();
  assert.equal(path.dirname(directory),path.resolve(tmpdir()));
  assert.ok(path.basename(directory).startsWith('vega-cast-cloudflare-'));
  await rm(directory,{recursive:true,force:true});
 }
});
