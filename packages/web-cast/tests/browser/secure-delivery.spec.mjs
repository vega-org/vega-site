import {test,expect} from '@playwright/test';
import {existsSync} from 'node:fs';
test.skip(!existsSync(new URL('./secure-sender.generated.js',import.meta.url)),'Secure integration test needs the sibling mobile checkout.');

test('real WebRTC delivery supports range seeks, HLS references and rejects unregistered resources',async({page})=>{
 test.setTimeout(60_000);
 const bytes=Buffer.alloc(1024*1024);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
 const reads=[];
 await page.route('**/test-phone/**',async route=>{
  const request=route.request(),url=new URL(request.url());reads.push(url.pathname);
  if(url.pathname.endsWith('master.m3u8'))return route.fulfill({contentType:'application/vnd.apple.mpegurl',body:'#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:4,\nsegment.ts\n#EXT-X-ENDLIST\n'});
  if(url.pathname.endsWith('key.bin'))return route.fulfill({body:'a-test-key'});
  if(url.pathname.endsWith('segment.ts'))return route.fulfill({body:'a-test-segment'});
  const range=/bytes=(\d+)-(\d*)/.exec(request.headers().range||'');
  const start=range?Number(range[1]):0,end=Math.min(range?.[2]?Number(range[2]):bytes.length-1,bytes.length-1);
  await route.fulfill({status:206,headers:{'content-type':'video/x-matroska','content-range':`bytes ${start}-${end}/${bytes.length}`,'accept-ranges':'bytes'},body:bytes.subarray(start,end+1)});
 });
 await page.goto('/tests/browser/secure-delivery.html');
 await page.waitForFunction(()=>window.secureTest);
 // Simulate an existing installation whose active worker cannot handle claim.
 await page.route('**/phone-worker.js',route=>route.fulfill({contentType:'text/javascript',body:"self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));"}));
 await page.evaluate(async()=>{await navigator.serviceWorker.register('/phone-worker.js',{scope:'/'});await navigator.serviceWorker.ready;});
 await page.unroute('**/phone-worker.js');
 await page.evaluate(()=>window.secureTest.start());
 // Reopening a receiver must reuse the worker without another reload prompt.
 await page.evaluate(()=>window.secureTest.connection.close());
 await page.reload();
 await page.waitForFunction(()=>window.secureTest);
 await page.evaluate(()=>window.secureTest.start());
 const result=await page.evaluate(async()=>{
  const connection=window.secureTest.connection;
  const seek=await fetch(connection.url('video.mkv'),{headers:{Range:'bytes=65536-69631'}});
  const data=new Uint8Array(await seek.arrayBuffer());
  const large=await fetch(connection.url('video.mkv'),{headers:{Range:'bytes=0-1048575'}});
  const largeBytes=new Uint8Array(await large.arrayBuffer());
  const repeated=[];
  for(const start of [800000,0,500000]){
   const response=await fetch(connection.url('video.mkv'),{headers:{Range:`bytes=${start}-${start+2047}`}});
   const bytes=new Uint8Array(await response.arrayBuffer());repeated.push({start,length:bytes.length,first:bytes[0]});
  }
  const playlist=await (await fetch(connection.url('master.m3u8'))).text();
  const segmentUrl=playlist.split('\n').find(line=>line.startsWith('http'));
  const segment=await (await fetch(segmentUrl)).text();
  const keyUrl=/URI="([^"]+)"/.exec(playlist)[1];
  const key=await (await fetch(keyUrl)).text();
  const bad=await fetch(connection.url('private-file'));
  const result={status:seek.status,range:seek.headers.get('content-range'),length:data.length,first:data[0],last:data.at(-1),largeLength:largeBytes.length,largeLast:largeBytes.at(-1),repeated,playlist,segment,key,badStatus:bad.status};
  connection.close();return result;
 });
 expect(result.status).toBe(206);expect(result.range).toBe(`bytes 65536-69631/${bytes.length}`);
 expect(result.length).toBe(4096);expect(result.first).toBe(65536%251);expect(result.last).toBe(69631%251);
 expect(result.largeLength).toBe(512*1024);expect(result.largeLast).toBe((512*1024-1)%251);
 for(const item of result.repeated){expect(item.length).toBe(2048);expect(item.first).toBe(item.start%251);}
 expect(result.playlist).toContain('/phone-media?transport=');
 expect(result.segment).toBe('a-test-segment');expect(result.key).toBe('a-test-key');
 expect(result.badStatus).toBe(502);expect(reads).not.toContain('/test-phone/private-file');
});
