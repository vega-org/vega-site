import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';

// Run against `npm run preview -- --host 127.0.0.1 --port 4322` after build.
const origin=process.env.CAST_SITE_TEST_URL||'http://127.0.0.1:4322';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext();
try{
 await context.addInitScript(()=>localStorage.setItem('vega.cast.environment','browser'));
 const page=await context.newPage();
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const registered=page.waitForResponse(response=>{
  try{return new URL(response.url()).pathname==='/vega-cast/v1'&&response.request().postDataJSON()?.op==='register';}catch{return false;}
 });
 const document=await page.goto(origin+'/cast/');
 assert.equal(document.status(),200);
 assert.equal(document.headers()['cross-origin-embedder-policy'],'credentialless');
 const receiver=await (await registered).json();
 assert.match(receiver.serviceUrl,/room=/);
 const request=async body=>{
  const response=await fetch(receiver.serviceUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;
 };
 const pairing=await request({op:'pair',code:receiver.code,name:'Smoke test mobile'});
 await page.getByRole('button',{name:'Confirm & remember',exact:true}).click();
 const approved=await request({op:'pairStatus',requestId:pairing.requestId,secret:pairing.secret});
 assert.equal(approved.status,'approved');
 const auth={...approved.grant,kind:'controller'};
 await request({op:'connect',auth});
 await request({op:'send',auth,message:{type:'COMMAND',id:'volume-smoke',command:'VOLUME',value:.35}});
 let matched=false;
 for(let i=0;i<4&&!matched;i++){
  const poll=await request({op:'poll',auth});
  matched=poll.messages.some(message=>message.type==='STATE'&&message.state.volume===.35);
 }
 assert.equal(matched,true,'Receiver should report the mobile volume change');
 assert.deepEqual(errors,[]);
 await page.screenshot({path:'.cast-test-build/site-receiver.png'});
 console.log('Hosted receiver assets, isolation headers, pairing confirmation and two-way mobile commands passed.');
}finally{await context.close();await browser.close();}
