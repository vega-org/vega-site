import {test, expect} from '@playwright/test';
import {existsSync, readFileSync, mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

function tracker(page) {
  const peers = new Map();
  return page.routeWebSocket('wss://tracker.vega.test/announce', socket => {
    socket.onMessage(data => {
      const message = JSON.parse(String(data));
      if (message.action !== 'announce') return;
      peers.set(message.peer_id, {socket, hash: message.info_hash});
      if (message.answer) {
        peers.get(message.to_peer_id)?.socket.send(JSON.stringify({action:'announce', info_hash:message.info_hash, peer_id:message.peer_id, answer:message.answer, offer_id:message.offer_id}));
        return;
      }
      socket.send(JSON.stringify({action:'announce',info_hash:message.info_hash,interval:1,complete:1,incomplete:1}));
      for (const offer of message.offers || []) for (const [id, peer] of peers) {
        if (id !== message.peer_id && peer.hash === message.info_hash) peer.socket.send(JSON.stringify({action:'announce',info_hash:message.info_hash,peer_id:message.peer_id,offer:offer.offer,offer_id:offer.offer_id}));
      }
    });
    socket.onClose(() => {for (const [id, peer] of peers) if (peer.socket === socket) peers.delete(id);});
  });
}

test('unsupported torrent fails cleanly and HTTP still plays without importing WebTorrent', async ({page}, info) => {
  test.setTimeout(60_000);
  const ffmpeg = fileURLToPath(new URL('../../../../../vega-desktop/src-tauri/resources/ffmpeg-sidecar/ffmpeg.exe', import.meta.url));
  test.skip(!existsSync(ffmpeg), 'Synthetic media generator is unavailable');
  const file = info.outputPath('owned.mp4'); mkdirSync(path.dirname(file), {recursive:true});
  const generated = spawnSync(ffmpeg, ['-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-t','6','-c:v','libx264','-preset','ultrafast','-g','24','-pix_fmt','yuv420p','-movflags','+faststart',file]);
  expect(generated.status).toBe(0);
  await page.route('**/owned.mp4', route => route.fulfill({contentType:'video/mp4',body:readFileSync(file)}));
  const errors = []; const torrentModules = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {if (/webtorrent.*(?:min|dist)/i.test(request.url())) torrentModules.push(request.url());});
  await page.goto('/tests/browser/torrent.html');
  await page.waitForFunction(() => window.torrentTest);
  await page.evaluate(async () => {
    window.savedRTC = window.RTCPeerConnection;
    window.RTCPeerConnection = undefined;
    try {await window.torrentTest.engine.load({id:'bad',source:'magnet:?xt=urn:btih:0123456789012345678901234567890123456789'});} catch {}
    window.RTCPeerConnection = window.savedRTC;
  });
  expect(await page.evaluate(() => window.torrentTest.state.error.category)).toBe('TORRENT_UNSUPPORTED');
  await page.evaluate(() => window.torrentTest.engine.load({id:'http',source:new URL('/owned.mp4',location.href).href}));
  await expect.poll(() => page.evaluate(() => window.torrentTest.state.currentTime), {timeout:20_000}).toBeGreaterThan(1);
  expect(torrentModules).toEqual([]);
  await page.evaluate(() => window.torrentTest.engine.destroy());
  expect(errors).toEqual([]);
});

test('real WebRTC torrent pieces support reads, seeking, cancellation and libmedia playback', async ({page}, info) => {
  test.setTimeout(90_000);
  const ffmpeg = fileURLToPath(new URL('../../../../../vega-desktop/src-tauri/resources/ffmpeg-sidecar/ffmpeg.exe', import.meta.url));
  test.skip(!existsSync(ffmpeg), 'Synthetic media generator is unavailable');
  const file=info.outputPath('owned.mp4');mkdirSync(path.dirname(file),{recursive:true});
  expect(spawnSync(ffmpeg,['-loglevel','error','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-t','8','-c:v','libx264','-preset','ultrafast','-g','24','-pix_fmt','yuv420p','-movflags','+faststart',file]).status).toBe(0);
  const bytes=readFileSync(file);
  await page.route('**/owned.mp4',route=>route.fulfill({contentType:'video/mp4',body:bytes}));
  await tracker(page);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/tests/browser/torrent.html');await page.waitForFunction(()=>window.torrentTest);
  const result=await page.evaluate(async()=>{
    const {default:WebTorrent}=await window.torrentTest.webtorrent();
    const {TorrentInput}=window.torrentTest;
    const bytes=new Uint8Array(await(await fetch('/owned.mp4')).arrayBuffer());
    const client=new WebTorrent({dht:false,lsd:false,webSeeds:false});client.on('error',()=>{});
    window.torrentTest.seed=client;
    const torrent=await new Promise(resolve=>client.seed(new File([bytes],'owned.mp4'),{announce:['wss://tracker.vega.test/announce'],private:true},resolve));
    const magnet='magnet:?xt=urn:btih:'+torrent.infoHash;
    window.torrentTest.magnet=magnet;
    const input=new TorrentInput(magnet,{announce:['wss://tracker.vega.test/announce']},30000,5000);
    await input.open();
    const buffer=new Uint8Array(4096);const first=await input.read(buffer);
    const firstMatches=buffer.subarray(0,first).every((v,i)=>v===bytes[i]);
    await input.seek(20000n);const count=await input.read(buffer);
    const seekMatches=buffer.subarray(0,count).every((v,i)=>v===bytes[i+20000]);
    await input.stop();
    const canceled=new TorrentInput('magnet:?xt=urn:btih:0123456789012345678901234567890123456789',{announce:[]},15000);
    const opening=canceled.open().then(()=>false,()=>true);await canceled.stop();const cancelRejected=await opening;
    const timeout=new TorrentInput('magnet:?xt=urn:btih:0123456789012345678901234567890123456789',{announce:[]},100);
    const timeoutMessage=await timeout.open().then(()=>'',error=>error.message);
    await window.torrentTest.engine.load({id:'torrent',source:magnet,torrent:{announce:['wss://tracker.vega.test/announce']}});
    return {firstMatches,seekMatches,cancelRejected,timeoutMessage,torrentBytes:Array.from(torrent.torrentFile)};
  });
  expect(result.firstMatches).toBe(true);expect(result.seekMatches).toBe(true);expect(result.cancelRejected).toBe(true);expect(result.timeoutMessage).toContain('metadata timed out');
  await expect.poll(()=>page.evaluate(()=>window.torrentTest.state.currentTime),{timeout:20_000}).toBeGreaterThan(1);
  await page.evaluate(async()=>{await window.torrentTest.engine.seek(4);});
  await expect.poll(()=>page.evaluate(()=>window.torrentTest.state.currentTime),{timeout:15000}).toBeGreaterThanOrEqual(4);
  await page.route('**/owned.torrent',route=>route.fulfill({contentType:'application/x-bittorrent',body:Buffer.from(result.torrentBytes)}));
  await page.evaluate(()=>window.torrentTest.engine.load({id:'metainfo',source:new URL('/owned.torrent',location.href).href}));
  await expect.poll(()=>page.evaluate(()=>window.torrentTest.state.currentTime),{timeout:20_000}).toBeGreaterThan(1);
  // Replacing a pending magnet with HTTP must cancel metadata discovery now,
  // not wait for the metadata timeout or leak an old player into the new load.
  await page.evaluate(async()=>{
    const pending=window.torrentTest.engine.load({id:'pending',source:'magnet:?xt=urn:btih:0123456789012345678901234567890123456789',torrent:{announce:[]}}).catch(()=>{});
    await new Promise(resolve=>setTimeout(resolve,50));
    await window.torrentTest.engine.load({id:'http',source:new URL('/owned.mp4',location.href).href});
    await pending;
  });
  await expect.poll(()=>page.evaluate(()=>window.torrentTest.state.currentTime),{timeout:20_000}).toBeGreaterThan(1);
  await page.evaluate(async()=>{await window.torrentTest.engine.unload();await new Promise(resolve=>window.torrentTest.seed.destroy(resolve));});
  await expect.poll(()=>page.evaluate(async()=> (await indexedDB.databases()).filter(database=>database.name?.startsWith('vega-torrent-')).length)).toBe(0);
  expect(errors).toEqual([]);
});

test('torrent packs require an unambiguous video selection',async({page})=>{
  await page.goto('/tests/browser/torrent.html');await page.waitForFunction(()=>window.torrentTest);
  const result=await page.evaluate(()=>{
    const select=window.torrentTest.selectTorrentFile;
    const files=[{name:'episode1.mkv',path:'pack/episode1.mkv',length:100},{name:'episode2.mkv',path:'pack/episode2.mkv',length:100}];
    let ambiguous='';try{select(files);}catch(error){ambiguous=error.message;}
    return {ambiguous,index:select(files,{fileIndex:1}).name,path:select(files,{fileName:'pack/episode1.mkv'}).name};
  });
  expect(result.ambiguous).toContain('multiple videos');expect(result.index).toBe('episode2.mkv');expect(result.path).toBe('episode1.mkv');
});

