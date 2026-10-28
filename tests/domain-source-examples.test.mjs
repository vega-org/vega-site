import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

const bundle=await build({entryPoints:['src/worker.js'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{
  name:'fixture-responses',setup(build){
    build.onResolve({filter:/^@astrojs\/cloudflare\/handler$/},()=>({path:'page',namespace:'fixture'}));
    build.onResolve({filter:/cloudflare\/(handler|cast)\.mjs$/},()=>({path:'cast',namespace:'fixture'}));
    build.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='page'
      ? `export function handle(){return new Response('<p>Add a source you chose.</p><span data-provider-source-example>Zenda-Cross providers</span>',{headers:{'Content-Type':'text/html'}})}`
      : `export const castRequest=()=>new Response('cast');export class CastSession{};export class CastDirectory{};`,loader:'js'}));
  },
}]});
test('official HTML hides source examples in homepage and server islands, community domains retain them',async()=>{
  const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-04-03'});
  try {
    for(const path of ['/','/_server-islands/DocsSection']) {
      const official=await (await mf.dispatchFetch('https://vega-app.in'+path)).text();
      assert.ok(!official.includes('Zenda-Cross'));
      assert.ok(official.includes('Add a source you chose.'));
      const community=await (await mf.dispatchFetch('https://vega.zendax.me'+path)).text();
      assert.ok(community.includes('Zenda-Cross'));
    }
  } finally {await mf.dispose();}
});
