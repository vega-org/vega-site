import {createSocket} from 'node:dgram';
import {networkInterfaces} from 'node:os';
export const CAST_SEARCH_TARGET='urn:vega:service:cast:1';
/** Native phones discover the control service. Browsers do not scan the LAN. */
export function startLanDiscovery({port,publicUrl,onError=()=>{}}){
 const socket=createSocket({type:'udp4',reuseAddr:true});
 const seen=new Map();let closed=false;
 const close=()=>{if(closed)return;closed=true;try{socket.close();}catch{}};
 socket.on('error',error=>{onError(error);close();});
 socket.on('message',(packet,peer)=>{
  const text=packet.toString('utf8');
  if(packet.length>4096||!/^M-SEARCH \* HTTP\/1\.1\r?\n/i.test(text)||!/^MAN:\s*"ssdp:discover"\s*$/im.test(text))return;
  const target=/^ST:\s*(.*?)\s*$/im.exec(text)?.[1];
  if(target!==CAST_SEARCH_TARGET&&target!=='ssdp:all')return;
  if(Date.now()-(seen.get(peer.address)||0)<1000)return;
  if(seen.size>1000)seen.clear();seen.set(peer.address,Date.now());
  const interfaces=Object.values(networkInterfaces()).flat().filter(value=>value&&value.family==='IPv4'&&!value.internal);
  const address=interfaces.find(value=>value.address.split('.').slice(0,3).join('.')===peer.address.split('.').slice(0,3).join('.'))?.address;
  if(!publicUrl&&!address)return;
  const serviceUrl=publicUrl||`http://${address}:${port}/vega-cast/v1`;
  if(/[\r\n]/.test(serviceUrl))return;
  const response=Buffer.from(`HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=30\r\nST: ${CAST_SEARCH_TARGET}\r\nUSN: vega-cast-control\r\nLOCATION: ${serviceUrl}\r\nX-VEGA-CAST-SERVICE: ${serviceUrl}\r\n\r\n`);
  socket.send(response,peer.port,peer.address,error=>{if(error)onError(error);});
 });
 socket.bind(1900,'0.0.0.0',()=>{
  for(const iface of Object.values(networkInterfaces()).flat())if(iface?.family==='IPv4'&&!iface.internal){try{socket.addMembership('239.255.255.250',iface.address);}catch(error){onError(error);}}
  socket.unref();
 });
 return close;
}
