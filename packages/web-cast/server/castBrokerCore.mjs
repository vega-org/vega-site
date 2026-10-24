import {randomBytes, randomInt, createHash, timingSafeEqual} from 'node:crypto';

const id = () => randomBytes(24).toString('base64url');
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const matches = (value, digest) => {
  const a = Buffer.from(hash(value));
  const b = Buffer.from(digest || '');
  return a.length === b.length && timingSafeEqual(a, b);
};
const fail = (message, status = 400) => { throw Object.assign(new Error(message), {status}); };
const cleanName = value => String(value || 'Vega receiver').replace(/[\x00-\x1f]/g, '').slice(0, 64);
const controllerMessages = new Set(['COMMAND', 'LOAD_MEDIA', 'FALLBACK_SOURCE', 'CONTROLLER_DISCONNECT','SERVER_CHANGE_RESULT','RTC_ANSWER','RTC_ICE','RTC_ERROR']);
const receiverMessages = new Set(['STATE', 'ACK', 'PLAYBACK_ERROR', 'FALLBACK_REQUEST', 'CAPABILITIES','DELIVERY_CHANGED','SERVER_CHANGE','RTC_OFFER','RTC_ICE']);
/** Authenticated control messages only. This broker never fetches or relays media. */
export function createCastBrokerCore({initialRecords=[],initialLive=[],initialRequests=[],persist=()=>{},publicUrl,advertise=()=>publicUrl,scopeForAddress=value=>value,ownDeviceName=()=>undefined,idPrefix='',now=Date.now}={}) {
  const discoveryScope=scopeForAddress;
  const records = new Map(initialRecords.map(record=>[record.id,record]));
  const live = new Map(initialLive);
  const requests = new Map(initialRequests);
  const queues = new Map();
  const waiters = new Map();
  const rates = new Map();
  const controllers = new Map();
  const save=()=>persist([...records.values()]);
  const peerKey = auth => `${auth.receiverId}:${auth.kind === 'receiver' ? 'receiver' : auth.controllerId}`;
  const push = (key, message) => {
    const waiting = waiters.get(key);
    if (waiting) { waiters.delete(key); waiting([message]); return; }
    let queue = queues.get(key) || [];
    if (message.type === 'STATE') queue = queue.filter(item => item.type !== 'STATE');
    if (queue.length >= 200) fail('Receiver control queue is full', 429);
    queue.push(message);
    queues.set(key, queue);
  };
  for(const [requestId,request] of requests)if(request.status==='pending'&&request.until>now()){
    push(`${request.receiverId}:receiver`,{type:'PAIR_REQUEST',requestId,name:request.name,confirmation:request.confirmation});
  }
  const authenticate = auth => {
    if(!auth || !['receiver','controller'].includes(auth.kind))fail('Invalid session role',401);
    const record = records.get(auth?.receiverId);
    if (!record) fail('Receiver no longer exists', 401);
    const digest = auth.kind === 'receiver' ? record.tokenHash : record.controllers[auth.controllerId]?.tokenHash;
    if (!matches(auth.token, digest)) fail('Pairing credentials were rejected', 401);
    const session = live.get(record.id);
    if (session && auth.kind === 'receiver') session.lastSeen = now();
    if(auth.kind==='controller'&&controllers.has(peerKey(auth)))controllers.get(peerKey(auth)).lastSeen=now();
    return record;
  };
  const sweep = () => {
    for (const [key, request] of requests) if (request.until < now()) requests.delete(key);
    for (const [key, value] of rates) if (value.until < now()) rates.delete(key);
    for (const [key, session] of live) if (now() - session.lastSeen > 24 * 60 * 60 * 1000) live.delete(key);
    for(const [key,controller] of controllers)if(now()-controller.lastSeen>45_000){
      controllers.delete(key);
      if(live.has(controller.receiverId))push(`${controller.receiverId}:receiver`,{type:'CONTROLLER_DISCONNECT',controllerId:controller.controllerId,reason:'connection-lost'});
    }
  };
  const limit = address => {
    const value = rates.get(address) || {count:0, until:now() + 60_000};
    if (++value.count > 20) fail('Too many pairing attempts. Try again shortly.', 429);
    rates.set(address, value);
  };
  const advertisedUrl=advertise;
  async function dispatch(body, {address = 'local', req} = {}) {
    sweep();
    const {op, auth} = body;
    if (op === 'register') {
      let record;
      let token;
      if (body.identity) {
        record = authenticate({...body.identity, kind:'receiver'});
        token = body.identity.token;
      } else {
        limit(address);
        if (records.size >= 1000) fail('Receiver registration capacity reached', 503);
        token = id();
        record = {id:idPrefix+id(), tokenHash:hash(token), name:cleanName(body.name), controllers:{}};
        records.set(record.id, record);
      }
      record.name=cleanName(ownDeviceName(body,req)||body.name||record.name);
      await save();
      let code;
      do { code = String(randomInt(100000, 1000000)); } while ([...live.values()].some(session => session.code === code));
      const session = {code, expiresAt:now() + 300_000, lastSeen:now(), capabilities:body.capabilities || {},address,discoveryToken:id()};
      live.set(record.id, session);
      return {identity:{receiverId:record.id, token}, name:record.name, code, expiresAt:session.expiresAt,
        serviceUrl:req ? advertisedUrl(req) : publicUrl, rememberedControllers:Object.entries(record.controllers).map(([key, item]) => ({id:key, name:item.name}))};
    }
    if(op==='discover') {
      limit(`discover:${address}`);
      // Network-scoped directory; never return identities, credentials or media.
      const scope=discoveryScope(address);
      return {receivers:[...live.entries()].filter(([,session])=>scope!==null&&now()-session.lastSeen<45_000&&discoveryScope(session.address)===scope)
        .map(([receiverId,session])=>({receiverId,name:records.get(receiverId).name,discoveryToken:session.discoveryToken}))};
    }
    if (op === 'pair') {
      limit(address);
      const entry = [...live.entries()].find(([receiverId, session]) => now()-session.lastSeen<45_000&&(body.discoveryToken
        ? receiverId===body.receiverId&&matches(body.discoveryToken,hash(session.discoveryToken))&&discoveryScope(address)!==null&&discoveryScope(session.address)===discoveryScope(address)
        : session.code===body.code&&session.expiresAt>now()));
      if (!entry) fail('Pairing code expired or receiver is offline', 404);
      if (requests.size >= 1000) fail('Pairing capacity reached', 429);
      const requestId = idPrefix+id();
      const secret = id();
      const confirmation = String(randomInt(1000, 10000));
      requests.set(requestId, {receiverId:entry[0], name:cleanName(body.name || 'Vega Mobile'), secretHash:hash(secret), confirmation, until:now()+120_000, status:'pending',lastNotifiedAt:now()});
      push(`${entry[0]}:receiver`, {type:'PAIR_REQUEST', requestId, name:cleanName(body.name || 'Vega Mobile'), confirmation});
      return {requestId, secret, confirmation};
    }
    if (op === 'pairStatus') {
      const request = requests.get(body.requestId);
      if (!request || !matches(body.secret, request.secretHash)) fail('Pairing request expired', 401);
      // A poll response can be lost when a browser reloads or its connection
      // drops. Keep the authenticated phone's pending request deliverable.
      if(request.status==='pending'&&now()-(request.lastNotifiedAt||0)>=3000){
        const key=`${request.receiverId}:receiver`;
        if(!queues.get(key)?.some(message=>message.type==='PAIR_REQUEST'&&message.requestId===body.requestId)){
          push(key,{type:'PAIR_REQUEST',requestId:body.requestId,name:request.name,confirmation:request.confirmation});
        }
        request.lastNotifiedAt=now();
      }
      return {status:request.status, ...(request.grant ? {grant:request.grant} : {})};
    }
    const record = authenticate(auth);
    if(op==='unregister') {
      if(auth.kind!=='receiver')fail('Only the receiver can remove its identity',403);
      records.delete(record.id);live.delete(record.id);
      for(const key of controllers.keys())if(key.startsWith(`${record.id}:`))controllers.delete(key);
      for(const key of queues.keys())if(key.startsWith(`${record.id}:`))queues.delete(key);
      for(const [key,request] of requests)if(request.receiverId===record.id)requests.delete(key);
      await save();return{ok:true};
    }
    if (op === 'confirm') {
      if (auth.kind !== 'receiver') fail('Only the receiver can confirm pairing', 403);
      const request = requests.get(body.requestId);
      if (!request || request.receiverId !== record.id || request.until < now() || request.status !== 'pending') fail('Pairing request expired');
      if (!body.allow) { request.status = 'rejected'; return {ok:true}; }
      if (Object.keys(record.controllers).length >= 8) fail('Forget a saved phone before pairing another');
      const controllerId = idPrefix+id();
      const token = id();
      record.controllers[controllerId] = {name:request.name, tokenHash:hash(token)};
      request.status = 'approved';
      request.grant = {receiverId:record.id, controllerId, token, name:record.name};
      await save();
      return {ok:true};
    }
    if (op === 'connect') {
      if (auth.kind !== 'controller') fail('Controller credentials required', 403);
      const session = live.get(record.id);
      if (!session || now()-session.lastSeen > 45_000) fail('Receiver is offline', 409);
      controllers.set(peerKey(auth),{receiverId:record.id,controllerId:auth.controllerId,lastSeen:now()});
      push(`${record.id}:receiver`, {type:'CONTROLLER_CONNECTED', controllerId:auth.controllerId, name:record.controllers[auth.controllerId].name});
      return {name:record.name, capabilities:session.capabilities};
    }
    if (op === 'forget') {
      if (auth.kind !== 'receiver') fail('Receiver confirmation required', 403);
      delete record.controllers[body.controllerId];
      controllers.delete(`${record.id}:${body.controllerId}`);
      queues.delete(`${record.id}:${body.controllerId}`);
      await save();
      return {ok:true};
    }
    if (op === 'send') {
      const message = body.message;
      if (!message || typeof message.type !== 'string') fail('Invalid control message');
      if (auth.kind === 'controller') {
        if (!controllerMessages.has(message.type)) fail('Unsupported controller message');
        if(message.type==='CONTROLLER_DISCONNECT')controllers.delete(peerKey(auth));
        push(`${record.id}:receiver`, {...message, controllerId:auth.controllerId});
      } else {
        if (!receiverMessages.has(message.type)) fail('Unsupported receiver message');
        const targets = body.controllerId ? [body.controllerId] : Object.keys(record.controllers);
        for (const controllerId of targets) {
          if (!record.controllers[controllerId]) fail('Phone is no longer paired', 403);
          push(`${record.id}:${controllerId}`, message);
        }
      }
      return {ok:true};
    }
    if (op === 'poll') {
      const key = peerKey(auth);
      if(auth.kind==='controller'&&!controllers.has(key)){
        const session=live.get(record.id);
        if(session&&now()-session.lastSeen<45_000){
          controllers.set(key,{receiverId:record.id,controllerId:auth.controllerId,lastSeen:now()});
          push(`${record.id}:receiver`,{type:'CONTROLLER_CONNECTED',controllerId:auth.controllerId,name:record.controllers[auth.controllerId].name});
        }
      }
      const queued = queues.get(key);
      if (queued?.length) { queues.delete(key); return {messages:queued}; }
      // Reload/reconnect can arrive before the previous HTTP long poll closes.
      // Complete that poll before replacing it, without dropping queued messages.
      const previous=waiters.get(key);
      if(previous){waiters.delete(key);previous([]);}
      return new Promise(resolve => {
        const timer = setTimeout(() => { waiters.delete(key); resolve({messages:[]}); }, 15_000);
        timer.unref?.();
        waiters.set(key, messages => { clearTimeout(timer); resolve({messages}); });
      });
    }
    fail('Unknown Vega Cast operation', 404);
  }
  return {dispatch,waiters,snapshot:()=>({records:[...records.values()],live:[...live],requests:[...requests]})};
}
