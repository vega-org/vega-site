import {cpSync,mkdirSync,readdirSync,rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const source=new URL('../dist-site/',import.meta.url);
const destination=new URL('../../../public/cast/',import.meta.url);
const siteRoot=fileURLToPath(new URL('../../../',import.meta.url));
if(path.relative(siteRoot,fileURLToPath(destination))!==path.join('public','cast'))throw new Error('Invalid generated receiver directory');
// This directory contains generated receiver assets only.
mkdirSync(destination,{recursive:true});
for(const name of readdirSync(destination))rmSync(new URL(name,destination),{recursive:true,force:true});
cpSync(fileURLToPath(source),fileURLToPath(destination),{recursive:true});
console.log('Published reusable receiver build to vega-site/public/cast/');
