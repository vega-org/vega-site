import http from 'node:http';
import assert from 'node:assert/strict';
const origin=new URL(process.env.CAST_SITE_TEST_URL||'http://127.0.0.1:4322');
const get=(host,path)=>new Promise((resolve,reject)=>{
 const request=http.get({hostname:origin.hostname,port:origin.port,path,headers:{Host:host}},response=>{
  let body='';response.setEncoding('utf8');response.on('data',chunk=>body+=chunk);response.on('end',()=>resolve({status:response.statusCode,body}));
 });request.on('error',reject);
});
for(const host of ['vega-app.in','www.vega-app.in']){
 const guide=await get(host,'/guide/adding-providers');
 assert.equal(guide.status,200);
 assert.equal(/Zenda-Cross/i.test(guide.body),false);
 assert.match(guide.body,/Enter the URL or username of a provider source you chose/);
 for(const path of ['/add-provider','/add-provider.html','/add-provider/index.html','/%61dd-provider','/add-source','/zenda-x']){
  const response=await get(host,path);
  assert.equal(response.status,404,host+path);
  assert.equal(/intent:|vega:\/\/add-source/.test(response.body),false);
 }
}
const community=await get('vega.8man.in','/guide/adding-providers');
assert.equal(community.status,200);assert.match(community.body,/Zenda-Cross/);
const intent=await get('vega.8man.in','/add-provider');
assert.equal(intent.status,200);assert.match(intent.body,/intent:/);
console.log('Official-domain guide filtering and installer blocking passed; other-domain behavior preserved.');
