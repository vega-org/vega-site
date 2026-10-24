import {handle} from '@astrojs/cloudflare/handler';
import {castRequest} from '../cloudflare/handler.mjs';
import {blocksProviderIntent} from './lib/domainPolicy';
export {CastSession,CastDirectory} from '../cloudflare/cast.mjs';

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    // Keep the receiver document inside its encrypted-delivery worker scope.
    if(url.pathname==='/cast'){url.pathname='/cast/';return Response.redirect(url.toString(),308);}
    if(blocksProviderIntent(url))return new Response('Not found',{status:404,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex'}});
    if(url.pathname==='/vega-cast/v1')return castRequest(request,env);
    const response=await handle(request,env,ctx);
    if(url.pathname==='/cast'||url.pathname.startsWith('/cast/')){
      const headers=new Headers(response.headers);
      headers.set('Cross-Origin-Opener-Policy','same-origin');
      headers.set('Cross-Origin-Embedder-Policy','credentialless');
      return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
    }
    return response;
  },
};
