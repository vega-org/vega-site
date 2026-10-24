import {createCastBrokerCore} from './castBrokerCore.mjs';
import {readFileSync, writeFileSync, mkdirSync, renameSync} from 'node:fs';
import {dirname} from 'node:path';
import {networkInterfaces,hostname} from 'node:os';
import {isIP} from 'node:net';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), {status}); };
const lanAddresses=()=>Object.values(networkInterfaces()).flat().filter(item=>item&&item.family==='IPv4'&&!item.internal).map(item=>item.address);
const preferredLanAddress=()=>{const values=lanAddresses();return values.find(value=>value.startsWith('192.168.'))||values.find(value=>/^(10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value))||values[0];};
const discoveryScope=value=>{
  if(value==='unscoped-proxy')return null;
  let address=String(value||'').replace(/^::ffff:/,'');
  if(address==='::1'||address.startsWith('127.'))address=preferredLanAddress()||address;
  // Local services group IPv4 /24 peers. Public services group only the exact
  // observed address (typically a household NAT), never a global receiver list.
  return /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address)?`lan:${address.split('.').slice(0,3).join('.')}`:`peer:${address}`;
};

export function createCastBroker({stateFile,publicUrl,trustProxy=false,now=Date.now}={}) {
 let initialRecords=[];
 if(stateFile){try{initialRecords=JSON.parse(readFileSync(stateFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw new Error('Cannot read Vega Cast trust store');}}
 const persist=records=>{if(!stateFile)return;mkdirSync(dirname(stateFile),{recursive:true});writeFileSync(stateFile+'.tmp',JSON.stringify(records),{mode:0o600});renameSync(stateFile+'.tmp',stateFile);};
  const advertisedUrl = req => {
    if (publicUrl) return publicUrl.replace(/\/$/, '');
    let hostname = String(req.headers.host || 'localhost:5173');
    if (/^(localhost|127\.0\.0\.1)(:|$)/.test(hostname)) {
      const addresses=Object.values(networkInterfaces()).flat().filter(item=>item&&item.family==='IPv4'&&!item.internal).map(item=>item.address);
      const address=addresses.find(value=>/^192\.168\./.test(value))||addresses.find(value=>/^(10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value))||addresses[0];
      if (address) hostname = hostname.replace(/^(localhost|127\.0\.0\.1)/, address);
    }
    return `${req.socket.encrypted ? 'https' : 'http'}://${hostname}/vega-cast/v1`;
  };
 const core=createCastBrokerCore({initialRecords,persist,publicUrl,advertise:advertisedUrl,scopeForAddress:discoveryScope,now,ownDeviceName:(body,req)=>{
      const peer=String(req?.socket.remoteAddress||'').replace(/^::ffff:/,'');
      const target=String(req?.headers.host||'').replace(/:\d+$/,'');
      const localTarget=target==='localhost'||target==='[::1]'||target.startsWith('127.')||lanAddresses().includes(target);
      const ownDevice=localTarget&&(peer==='::1'||peer.startsWith('127.')||lanAddresses().includes(peer));
      return body.useDeviceName&&ownDevice&&!req?.headers['x-forwarded-for']?hostname():body.name;

 }});
 const {dispatch,waiters}=core;
  const handler = async (req, res, next) => {
    if (!req.url?.split('?')[0].endsWith('/vega-cast/v1')) return next ? next() : (res.writeHead(404), res.end());
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    try {
      let input = '';
      for await (const chunk of req) {
        input += chunk;
        if (Buffer.byteLength(input) > 65_536) fail('Control message is too large', 413);
      }
      const body=JSON.parse(input);
      const key=body.op==='poll'&&body.auth?peerKey(body.auth):null;
      const previousWaiter=key?waiters.get(key):null;
      const forwarded=String(req.headers['x-forwarded-for']||'').split(',')[0].trim();
      // Enable only behind a controlled proxy that overwrites forwarded headers.
      // Without that configuration, QR still works but proxied requests cannot
      // share the reverse proxy's address as a household discovery directory.
      const address=forwarded?(trustProxy&&isIP(forwarded)?forwarded:'unscoped-proxy'):req.socket.remoteAddress;
      const operation=dispatch(body,{address,req});
      const ownWaiter=key&&!previousWaiter?waiters.get(key):null;
      if(key&&ownWaiter)res.once('close',()=>{if(waiters.get(key)===ownWaiter){waiters.delete(key);ownWaiter([]);}});
      const result = await operation;
      if (!res.destroyed) { res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify(result)); }
    } catch (error) {
      if (!res.destroyed) { res.writeHead(error.status || 400, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:error.message || 'Vega Cast request failed'})); }
    }
  };
  return {handler, dispatch};
}
