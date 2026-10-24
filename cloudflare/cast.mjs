import {DurableObject} from 'cloudflare:workers';
import {createCastBrokerCore} from '../packages/web-cast/server/castBrokerCore.mjs';

// One object per receiver, not a global control-message bottleneck. Only trust,
// expiring pairing handoffs and liveness are durable; media queues are transient.
export class CastSession extends DurableObject {
  constructor(ctx,env){
    super(ctx,env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS session_state (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
    const row=ctx.storage.sql.exec('SELECT value FROM session_state WHERE id=1').toArray()[0];
    this.saved=row?JSON.parse(row.value):{};
  }
  async dispatch(body,address,serviceUrl,room){
    if(!this.broker){
      this.broker=createCastBrokerCore({
        initialRecords:this.saved.records||[],initialLive:this.saved.live||[],initialRequests:this.saved.requests||[],
        idPrefix:room+'.',advertise:()=>this.serviceUrl,scopeForAddress:value=>value,
      });
    }
    this.serviceUrl=serviceUrl;
    try{
      const result=await this.broker.dispatch(body,{address,req:{}});
      const snapshot=this.broker.snapshot();
      this.ctx.storage.sql.exec('INSERT OR REPLACE INTO session_state (id,value) VALUES (1,?)',JSON.stringify(snapshot));
      // Publish only presence metadata, never tokens, stream URLs or headers.
      const record=snapshot.records[0];
      const session=snapshot.live.find(([id])=>id===record?.id)?.[1];
      const presence=record&&session?{receiverId:record.id,name:record.name,discoveryToken:session.discoveryToken,scope:session.address,lastSeen:session.lastSeen}:null;
      return {result,presence};
    }catch(error){return {error:error.message||'Vega Cast request failed',status:error.status||400};}
  }
}

// A separate directory per observed network. No global list of receivers.
export class CastDirectory extends DurableObject {
  constructor(ctx,env){
    super(ctx,env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS receivers (id TEXT PRIMARY KEY, value TEXT NOT NULL, until_ms INTEGER NOT NULL)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS limits (name TEXT PRIMARY KEY, count INTEGER NOT NULL, until_ms INTEGER NOT NULL)');
  }
  admit(kind){
    const now=Date.now();
    this.ctx.storage.sql.exec('DELETE FROM limits WHERE until_ms < ?',now);
    const row=this.ctx.storage.sql.exec('SELECT count FROM limits WHERE name=?',kind).toArray()[0];
    if(row?.count>=20)return false;
    this.ctx.storage.sql.exec('INSERT INTO limits(name,count,until_ms) VALUES (?,1,?) ON CONFLICT(name) DO UPDATE SET count=count+1',kind,now+60_000);
    return true;
  }
  publish(presence){
    const now=Date.now();
    this.ctx.storage.sql.exec('DELETE FROM receivers WHERE until_ms < ?',now);
    if(presence.lastSeen+45_000<=now)return;
    const {receiverId,name,discoveryToken}=presence;
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO receivers (id,value,until_ms) VALUES (?,?,?)',receiverId,JSON.stringify({receiverId,name,discoveryToken}),presence.lastSeen+45_000);
  }
  remove(id){this.ctx.storage.sql.exec('DELETE FROM receivers WHERE id=?',id);}
  discover(){
    this.ctx.storage.sql.exec('DELETE FROM receivers WHERE until_ms < ?',Date.now());
    return this.ctx.storage.sql.exec('SELECT value FROM receivers ORDER BY id LIMIT 100').toArray().map(row=>JSON.parse(row.value));
  }
}
