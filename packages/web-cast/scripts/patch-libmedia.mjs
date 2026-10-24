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

// Use the same resolved seek timestamp as the A/V pipelines. currentTime is
// read from asynchronously updated render statistics and may still be stale.
const seekSource=fs.readFileSync(file,'utf8');
const oldSeek='for(let e=0;e<this.externalSubtitleTasks.length;e++)await Le.DemuxerThread.seek(this.externalSubtitleTasks[e].taskId,this.currentTime,8);this.subtitleRender&&(this.subtitleRender.reset(),this.subtitleRender.start())}async seek(e)';
const newSeek='for(let subtitleIndex=0;subtitleIndex<this.externalSubtitleTasks.length;subtitleIndex++)await Le.DemuxerThread.seek(this.externalSubtitleTasks[subtitleIndex].taskId,a>=BigInt(0)?a>e?a:e:e,8);this.subtitleRender&&(this.subtitleRender.reset(),this.subtitleRender.start())}async seek(e)';
if(!seekSource.includes(newSeek)){
 if(seekSource.split(oldSeek).length!==2)throw new Error('libmedia external subtitle seek patch does not match this version');
 fs.writeFileSync(file,seekSource.replace(oldSeek,newSeek));
}
