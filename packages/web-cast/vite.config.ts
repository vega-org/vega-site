import { defineConfig, type Plugin,type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {libmediaChunkPlugin} from '@vega/libmedia-engine/assets';
import {createCastBroker} from './server/castBroker.mjs';
import {startLanDiscovery} from './server/lanDiscovery.mjs';

function vegaCastPlugin(): Plugin {
  const broker = createCastBroker({stateFile:path.resolve('.vega-cast/trust.json'), publicUrl:process.env.VEGA_CAST_PUBLIC_URL,trustProxy:process.env.VEGA_CAST_TRUST_PROXY==='1'});
  const mount=(server:Pick<ViteDevServer,'middlewares'|'httpServer'>)=>{
    server.middlewares.use(broker.handler);
    const http=server.httpServer;
    http?.once('listening',()=>{const address=http.address();if(!address||typeof address==='string')return;const stop=startLanDiscovery({port:address.port,publicUrl:process.env.VEGA_CAST_PUBLIC_URL,onError:()=>{}});http.once('close',stop);});
  };
  return {name:'vega-cast-control', configureServer:mount,configurePreviewServer:mount};
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), libmediaChunkPlugin(), vegaCastPlugin()],
  optimizeDeps: {
    exclude: ['@libmedia/avplayer'],
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  preview: {
    port: 5173,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
});
