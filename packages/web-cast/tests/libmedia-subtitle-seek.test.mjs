import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../scripts/patch-libmedia.mjs';
const source=fs.readFileSync(new URL(import.meta.resolve('@libmedia/avplayer')),'utf8');
const begin=source.indexOf('async doSeek(e,t){');
const end=source.indexOf('async seek(e){if(P.pq',begin);
assert.ok(begin>=0&&end>begin,'Expected libmedia seek method');
const method=source.slice(begin,end);
for(const actual of [119000n,121000n])test(`external subtitle seek uses resolved A/V timestamp ${actual} with stale clock`,async()=>{
 const calls=[];
 const Le={DemuxerThread:{seek:async(task,time)=>{calls.push([task,time]);return actual;}},MSEThread:{beforeSeek:async()=>{},afterSeek:async()=>0}};
 const seek=new Function('Le','Q','P','Ce',`return ({${method}}).doSeek`)(Le,{Dh:-1n},{Yz(){},z3(){}},'test');
 const player={useMSE:true,taskId:'video',isHls:()=>true,isDash:()=>false,currentTime:1000n,lastStatus:6,externalSubtitleTasks:[{taskId:'subtitle'}],subtitleRender:{reset(){},start(){}}};
 await seek.call(player,120000n,0);
 assert.deepEqual(calls,[['video',120000n],['subtitle',actual>120000n?actual:120000n]]);
});
