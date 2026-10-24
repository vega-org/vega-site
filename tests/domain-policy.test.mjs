import test from 'node:test';
import assert from 'node:assert/strict';
import {isOfficialDomain,blocksProviderIntent} from '../src/lib/domainPolicy.ts';

test('official domain matching includes subdomains without matching lookalike hosts',()=>{
 for(const host of ['vega-app.in','www.vega-app.in','cast.vega-app.in','VEGA-APP.IN.'])assert.equal(isOfficialDomain(host),true);
 for(const host of ['vega.8man.in','localhost','not-vega-app.in','vega-app.in.evil.test'])assert.equal(isOfficialDomain(host),false);
});
test('official hosts block installer routes including static HTML and encoded aliases',()=>{
 for(const path of ['/add-provider','/add-provider/?url=x','/add-provider.html','/add-provider/index.html','/%61dd-provider','/add-source/','/zenda-x']){
  assert.equal(blocksProviderIntent(new URL('https://vega-app.in'+path)),true,path);
  assert.equal(blocksProviderIntent(new URL('https://vega.8man.in'+path)),false,path);
 }
 for(const path of ['/cast/','/guide/adding-providers','/add-provider-example','/'])assert.equal(blocksProviderIntent(new URL('https://vega-app.in'+path)),false,path);
});
