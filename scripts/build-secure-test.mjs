import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
const sender=new URL('../../vega-mobile/src/lib/remote/secureCastDelivery.ts',import.meta.url);
if(!existsSync(sender)){
 console.log('Mobile checkout absent; run secure-delivery integration tests with vega-mobile beside vega-site.');
 process.exit(0);
}
await build({
 entryPoints:[fileURLToPath(sender)],bundle:true,format:'esm',platform:'browser',
 outfile:fileURLToPath(new URL('../packages/web-cast/tests/browser/secure-sender.generated.js',import.meta.url)),
 plugins:[{name:'browser-peer-test',setup(build){
  build.onResolve({filter:/^react-native-webrtc$/},()=>({path:'peer',namespace:'test'}));
  build.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const RTCPeerConnection=globalThis.RTCPeerConnection; export const RTCSessionDescription=globalThis.RTCSessionDescription; export const RTCIceCandidate=globalThis.RTCIceCandidate;',loader:'js'}));
 }}],
});
