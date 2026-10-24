import './patch-libmedia.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const sourceDir=path.dirname(fileURLToPath(import.meta.resolve('@libmedia/avplayer')));
export function copyLibmediaAssets(publicDir){
 for(const dir of [publicDir,path.join(publicDir,'assets')]){
  fs.mkdirSync(dir,{recursive:true});
  for(const file of fs.readdirSync(sourceDir)){
   if(file.endsWith('.avplayer.js'))fs.copyFileSync(path.join(sourceDir,file),path.join(dir,file));
  }
 }
}

// libmedia resolves lazy chunks beside import.meta.url, including Vite's
// node_modules URL in development. Serve only known chunk basenames.
export function libmediaChunkPlugin(){
 return {name:'vega-libmedia-chunks',configureServer(server){
  server.middlewares.use((req,res,next)=>{
   const name=req.url?.split('?')[0].split('/').pop();
   if(!name||!/^\d+\.avplayer\.js$/.test(name))return next();
   const file=path.join(sourceDir,name);
   if(!fs.existsSync(file))return next();
   res.setHeader('Content-Type','application/javascript');
   res.setHeader('Cross-Origin-Resource-Policy','cross-origin');
   fs.createReadStream(file).pipe(res);
  });
 }};
}
