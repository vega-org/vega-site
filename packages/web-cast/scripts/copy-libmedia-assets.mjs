import './patch-libmedia.mjs';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'node:url';

const srcDir = path.dirname(fileURLToPath(import.meta.resolve('@libmedia/avplayer')));
const publicDir = 'public';
const publicAssetsDir = 'public/assets';

if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
if (!fs.existsSync(publicAssetsDir)) fs.mkdirSync(publicAssetsDir, { recursive: true });

const files = fs.readdirSync(srcDir);
let count = 0;
for (const file of files) {
  if (file.endsWith('.avplayer.js') && file !== 'avplayer.js') {
    fs.copyFileSync(path.join(srcDir, file), path.join(publicDir, file));
    fs.copyFileSync(path.join(srcDir, file), path.join(publicAssetsDir, file));
    count++;
  }
}

console.log(`Copied ${count} chunk files to public/ and public/assets/`);
