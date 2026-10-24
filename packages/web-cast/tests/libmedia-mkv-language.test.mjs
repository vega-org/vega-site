import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../scripts/patch-libmedia.mjs';

const source=fs.readFileSync(new URL('573.avplayer.js',import.meta.resolve('@libmedia/avplayer')),'utf8');
const field=/2274717:(\{type:7,filedName:"[^"]+"\})/.exec(source);
assert.ok(field,'Installed MKV parser must recognize LanguageIETF');
const descriptor=new Function(`return (${field[1]})`)();
const assignment=/\(t\.languageIETF\|\|t\.language\)&&\(d\.metadata\.language=t\.languageIETF\|\|t\.language\)/.exec(source);
assert.ok(assignment,'Installed demuxer must expose the preferred language');
const expose=new Function('t',`const d={metadata:{}};${assignment[0]};return d.metadata.language;`);

test('MKV subtitle with only LanguageIETF exposes English, as in the supplied sample',()=>{
 const track={};track[descriptor.filedName]=Buffer.from('en').toString('utf8');
 assert.equal(expose(track),'en');
});
test('MKV IETF language overrides legacy language while legacy-only tracks remain supported',()=>{
 assert.equal(expose({language:'eng',languageIETF:'en-GB'}),'en-GB');
 assert.equal(expose({language:'hin'}),'hin');
 assert.equal(expose({}),undefined);
});
