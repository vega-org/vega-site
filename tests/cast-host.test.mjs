import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
const bundle=await build({entryPoints:['src/worker.js'],bundle:true,write:false,format:'esm',platform:'node',external:['cloudflare:workers','node:*'],plugins:[{name:'test-astro-handler',setup(build){build.onResolve({filter:/^@astrojs\/cloudflare\/handler$/},()=>({path:'astro-handler',namespace:'test'}));build.onLoad({filter:/.*/,namespace:'test'},()=>({contents:"export const handle=async request=>new Response('landing:'+new URL(request.url).pathname);"}));}}]});
test('cast subdomain serves the receiver root, worker scope and legacy redirects',async()=>{
 const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-04-03',compatibilityFlags:['nodejs_compat'],bindings:{CAST_PUBLIC_URL:'https://cast.vega-app.in/',CAST_SITE_ORIGIN:'https://vega-app.in'},serviceBindings:{ASSETS:async request=>new Response('asset:'+new URL(request.url).pathname)}});
 try{
  const root=await mf.dispatchFetch('https://cast.vega-app.in/');
  assert.equal(await root.text(),'asset:/cast/');
  assert.equal(root.headers.get('Cross-Origin-Embedder-Policy'),'credentialless');
  const worker=await mf.dispatchFetch('https://cast.vega-app.in/cast/phone-worker.js');
  assert.equal(worker.headers.get('Service-Worker-Allowed'),'/');
  for(const url of ['https://vega-app.in/cast/?test=1','https://cast.vega-app.in/cast/?test=1']){
   const response=await mf.dispatchFetch(url,{redirect:'manual'});
   assert.equal(response.status,308);assert.equal(response.headers.get('Location'),'https://cast.vega-app.in/?test=1');
  }
  const site=await mf.dispatchFetch('https://vega-app.in/');assert.equal(await site.text(),'landing:/');
  const blocked=await mf.dispatchFetch('https://cast.vega-app.in/add-provider');assert.equal(blocked.status,404);
  const api=await mf.dispatchFetch('https://cast.vega-app.in/vega-cast/v1');assert.equal(api.status,405);
 }finally{await mf.dispose();}
});


test('unconfigured self-host does not redirect to Vega and custom domains are configurable',async()=>{
 const make=bindings=>new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-04-03',compatibilityFlags:['nodejs_compat'],bindings,serviceBindings:{ASSETS:async request=>new Response('asset:'+new URL(request.url).pathname)}});
 const plain=make({}),custom=make({CAST_PUBLIC_URL:'https://screen.example/',CAST_SITE_ORIGIN:'https://site.example'});
 try{
  const local=await plain.dispatchFetch('https://self.example/cast/');
  assert.equal(local.status,200);assert.equal(await local.text(),'landing:/cast/');
  const slash=await plain.dispatchFetch('https://self.example/cast',{redirect:'manual'});
  assert.equal(slash.headers.get('Location'),'https://self.example/cast/');
  const root=await custom.dispatchFetch('https://screen.example/');assert.equal(await root.text(),'asset:/cast/');
  const worker=await custom.dispatchFetch('https://screen.example/cast/phone-worker.js');assert.equal(worker.headers.get('Service-Worker-Allowed'),'/');
  const redirect=await custom.dispatchFetch('https://site.example/cast/?keep=1',{redirect:'manual'});
  assert.equal(redirect.headers.get('Location'),'https://screen.example/?keep=1');
  const other=await custom.dispatchFetch('https://other.example/cast/');assert.equal(other.status,200);assert.equal(other.headers.get('Location'),null);
  for(const host of ['vega.8man.in','self.example','vega-app.in.example']){
   for(const path of ['/add-provider','/add-source','/zenda-x']){
    const response=await plain.dispatchFetch(`https://${host}${path}`);
    assert.equal(response.status,200,`${host}${path} must remain available`);
   }
  }
 }finally{await plain.dispose();await custom.dispose();}
});
