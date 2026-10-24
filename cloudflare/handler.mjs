import {createHash,randomBytes} from 'node:crypto';
const roomPattern=/^[a-f0-9]{32}$/;
const response=(data,status=200)=>Response.json(data,{status,headers:{
  'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type',
  'Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store',
}});
export async function castRequest(request,env){
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS'}});
  if(request.method!=='POST')return response({error:'Use POST'},405);
  try{
    const reader=request.body?.getReader();let size=0;const chunks=[];
    if(!reader)return response({error:'Missing request body'},400);
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65_536){await reader.cancel();return response({error:'Control message is too large'},413);}chunks.push(value);}
    const input=new Uint8Array(size);let offset=0;for(const chunk of chunks){input.set(chunk,offset);offset+=chunk.length;}
    const body=JSON.parse(new TextDecoder().decode(input));
    if(!body||typeof body!=='object'||Array.isArray(body))return response({error:'Invalid control request'},400);
    // CF sets this header at the edge. Hash before storage; ignore forwarded IPs.
    const address=createHash('sha256').update(request.headers.get('CF-Connecting-IP')||'local-development').digest('hex');
    const directory=env.VEGA_CAST_DIRECTORY.getByName(address);
    if(['register','discover','pair'].includes(body.op)&&!await directory.admit(body.op))return response({error:'Too many attempts. Try again shortly.'},429);
    if(body.op==='discover')return response({receivers:await directory.discover()});
    const url=new URL(request.url);
    const identity=body.auth?.receiverId||body.identity?.receiverId||body.receiverId||body.requestId;
    const identityRoom=typeof identity==='string'?identity.split('.')[0]:undefined;
    const requestedRoom=url.searchParams.get('room');
    let room=identityRoom||requestedRoom;
    if(!room&&body.op==='register'&&!body.identity)room=randomBytes(16).toString('hex');
    if(!room||!roomPattern.test(room))return response({error:'Scan the receiver QR code again'},400);
    if(identityRoom&&requestedRoom&&identityRoom!==requestedRoom)return response({error:'Receiver session does not match'},403);
    url.search='';url.searchParams.set('room',room);
    const result=await env.VEGA_CAST_SESSIONS.getByName(room).dispatch(body,address,url.toString(),room);
    if(result.error)return response({error:result.error},result.status);
    if(body.op==='unregister')await directory.remove(body.auth.receiverId);
    if(result.presence){
      // Presence belongs to the receiver's network, even when a remote phone polls.
      await env.VEGA_CAST_DIRECTORY.getByName(result.presence.scope).publish(result.presence);
    }
    return response(result.result);
  }catch{return response({error:'Invalid Vega Cast request'},400);}
}
