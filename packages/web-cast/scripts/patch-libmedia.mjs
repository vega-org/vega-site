import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const file=fileURLToPath(import.meta.resolve('@libmedia/avplayer'));
const source=fs.readFileSync(file,'utf8');
// libmedia 1.3.1 routes even independently loaded subtitle files through the
// HLS rendition selector. Keep external stream IDs on its existing file path.
const original='async selectSubtitle(e){if(this.isHls()||this.isDash()){';
const patched='async selectSubtitle(e){if((this.isHls()||this.isDash())&&!this.externalSubtitleTasks.some(t=>t.streamId===e)){';
if(!source.includes(patched)){
 if(source.split(original).length!==2)throw new Error('libmedia external subtitle patch does not match this version; review before upgrading');
 fs.writeFileSync(file,source.replace(original,patched));
}

const current=fs.readFileSync(file,'utf8');
const originalInfo='getExternalSubtitle(){return this.externalSubtitleTasks.map((e=>({source:e.source,lang:e.lang,title:e.title})))}';
const patchedInfo='getExternalSubtitle(){return this.externalSubtitleTasks.map((e=>({source:e.source,lang:e.lang,title:e.title,streamId:e.streamId})))}';
if(!current.includes(patchedInfo)){
 if(current.split(originalInfo).length!==2)throw new Error('libmedia external subtitle metadata patch does not match this version');
 fs.writeFileSync(file,current.replace(originalInfo,patchedInfo));
}
