import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const file=fileURLToPath(import.meta.resolve('@libmedia/avplayer'));
const source=fs.readFileSync(file,'utf8');
// Text cues may contain ASS overrides (e.g. SRT {\an8}). Use libmedia's
// own ASS text parser instead of declaring the whole cue a literal fragment.
const subtitleFile=path.join(path.dirname(file),'630.avplayer.js');
let subtitle=fs.readFileSync(subtitleFile,'utf8');
const plainText='Text:{raw:e,combined:e,parsed:[{tags:[],text:e,drawing:[]}]}}}webvtt2AssEvent';
const parsedText='Text:(0,u.r)(e.replace(/\\r?\\n/g,"\\\\N"))}}webvtt2AssEvent';
if(!subtitle.includes(parsedText)){
 if(subtitle.split(plainText).length!==2)throw new Error('libmedia subtitle override patch does not match this version');
 subtitle=subtitle.replace(plainText,parsedText);
 fs.writeFileSync(subtitleFile,subtitle);
}
// MKV LanguageIETF takes precedence over legacy Language. Some muxers only
// write LanguageIETF, which 1.3.1 otherwise discards as an unknown element.
const matroskaFile=path.join(path.dirname(file),'573.avplayer.js');
let matroska=fs.readFileSync(matroskaFile,'utf8');
const languageField='2274716:{type:7,filedName:"language"}';
const ietfField=languageField+',2274717:{type:7,filedName:"languageIETF"}';
const languageMetadata='t.language&&(d.metadata.language=t.language)';
const ietfMetadata='(t.languageIETF||t.language)&&(d.metadata.language=t.languageIETF||t.language)';
if(!matroska.includes(ietfField)){
 if(matroska.split(languageField).length!==2)throw new Error('libmedia MKV language field patch does not match this version');
 matroska=matroska.replace(languageField,ietfField);
}
if(!matroska.includes(ietfMetadata)){
 if(matroska.split(languageMetadata).length!==2)throw new Error('libmedia MKV language metadata patch does not match this version');
 matroska=matroska.replace(languageMetadata,ietfMetadata);
}
fs.writeFileSync(matroskaFile,matroska);
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
