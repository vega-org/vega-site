import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const source=ts.transpileModule(readFileSync(new URL('../src/lib/github.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
let version=0;
async function fixture(fail=false) {
  const calls=[];
  globalThis.fetch=async url=>{
    const path=new URL(url).pathname;calls.push(path);
    if(path.startsWith('/orgs/'))return Response.json([{name:'mobile',size:1,stargazers_count:10},{name:'desktop',size:1,stargazers_count:20},{name:'empty',size:0,stargazers_count:2}]);
    if(fail&&path.includes('/desktop/'))return new Response('',{status:503});
    if(path.endsWith('/commits'))return Response.json([{}],{headers:{link:`<${url}&page=5>; rel="last"`}});
    if(path.endsWith('/releases'))return Response.json(path.includes('/empty/')?[]:[{assets:[{download_count:7}]}]);
    throw Error(path);
  };
  const module=await import(`data:text/javascript;base64,${Buffer.from(source+`\n//${++version}`).toString('base64')}`);
  return {module,calls};
}
test('organization totals include all repos and reuse a single cached repository list',async()=>{
  const {module,calls}=await fixture();
  assert.equal(await module.getOrganizationStars('vega-org'),32);
  assert.deepEqual(await module.getOrganizationStats('vega-org'),{totalStars:32,totalDownloads:14,totalCommits:10});
  await module.getOrganizationStats('vega-org');
  assert.equal(calls.filter(path=>path.startsWith('/orgs/')).length,1);
  assert.equal(calls.filter(path=>path.endsWith('/commits')).length,2);
  assert.equal(calls.length,6);
});
test('failed repositories do not produce misleading partial totals',async()=>{
  const {module}=await fixture(true);
  assert.deepEqual(await module.getOrganizationStats('vega-org'),{totalStars:32,totalDownloads:null,totalCommits:null});
});
