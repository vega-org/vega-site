/* Same-origin virtual media URLs; bytes arrive only over the paired DTLS channel. */
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{
 if(event.data?.type==='claim')event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(url.origin!==self.location.origin||!url.pathname.endsWith('/phone-media'))return;
 event.respondWith((async()=>{
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
    client.postMessage({type:'VEGA_PHONE_FETCH',transportId:url.searchParams.get('transport'),url:url.searchParams.get('url'),range:event.request.headers.get('Range'),method:event.request.method},[channel.port2]);
   }
  });
 })());
});
