/* Same-origin virtual media URLs; bytes arrive only over the paired DTLS channel. */
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{
 if(event.data?.type==='claim')event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(url.origin!==self.location.origin||!(/\/phone-media(?:\/subtitle\.(?:srt|vtt|ass|ssa|ttml))?$/.test(url.pathname)))return;
 event.respondWith((async()=>{
  const requestChunk=async range=>{
  const clients=await self.clients.matchAll({type:'window'});
  return new Promise(resolve=>{
   let finished=false;
   const ports=[];
   const finish=response=>{if(finished)return;finished=true;clearTimeout(timer);ports.forEach(port=>port.close());resolve(response);};
   const timer=setTimeout(()=>finish(new Response('Encrypted phone connection unavailable',{status:504})),35_000);
   for(const client of clients){
    const channel=new MessageChannel();ports.push(channel.port1);
    channel.port1.onmessage=({data})=>{
     if(!data||!Number.isInteger(data.status))return;
     finish(new Response(event.request.method==='HEAD'?null:data.body,{status:data.status,headers:{...data.headers,'Cache-Control':'no-store'}}));
    };
    client.postMessage({type:'VEGA_PHONE_FETCH',transportId:url.searchParams.get('transport'),url:url.searchParams.get('url'),range,method:event.request.method},[channel.port2]);
   }
  });
  };
  const requested=event.request.headers.get('Range');
  const first=await requestChunk(requested);
  const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(first.headers.get('Content-Range')||'');
  if(event.request.method!=='GET'||first.status!==206||!match)return first;
  const start=Number(match[1]),initialEnd=Number(match[2]),total=Number(match[3]);
  const wanted=requested&&/^bytes=(\d+)-(\d*)$/.exec(requested);
  const end=Math.min(wanted?.[2]?Number(wanted[2]):total-1,total-1);
  if(initialEnd>=end)return first;
  // Continue bounded phone reads without exposing a short response to libmedia.
  const headers=new Headers(first.headers);
  headers.set('Content-Range',`bytes ${start}-${end}/${total}`);
  headers.set('Content-Length',String(end-start+1));
  let next=start,current=first,cancelled=false;
  const body=new ReadableStream({
   async pull(controller){
    try{
     if(!current)current=await requestChunk(`bytes=${next}-${end}`);
     if(cancelled)return;
     const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(current.headers.get('Content-Range')||'');
     if(current.status!==206||!range||Number(range[1])!==next||Number(range[3])!==total||Number(range[2])>end)throw new Error('Phone media returned an inconsistent byte range');
     const bytes=new Uint8Array(await current.arrayBuffer());
     if(bytes.length!==Number(range[2])-next+1||!bytes.length)throw new Error('Phone media response ended before its declared byte range');
     next+=bytes.length;current=null;controller.enqueue(bytes);
     if(next>end)controller.close();
    }catch(error){controller.error(error);}
   },
   cancel(){cancelled=true;void current?.body?.cancel();}
  });
  return new Response(body,{status:206,headers});
 })());
});
