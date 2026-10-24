import {handle} from '@astrojs/cloudflare/handler';
import {castRequest} from '../cloudflare/handler.mjs';
import {blocksProviderIntent} from './lib/domainPolicy';
export {CastSession,CastDirectory} from '../cloudflare/cast.mjs';

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    // Domains belong to deployment configuration, never the reusable receiver.
    let castUrl=null,siteOrigin=null;
    try{if(env.CAST_PUBLIC_URL)castUrl=new URL(env.CAST_PUBLIC_URL);}catch{}
    try{if(env.CAST_SITE_ORIGIN)siteOrigin=new URL(env.CAST_SITE_ORIGIN).origin;}catch{}
    const castHost=!!castUrl&&url.origin===castUrl.origin&&castUrl.pathname==='/';
    const legacyPage=['/cast','/cast/','/cast/index.html'].includes(url.pathname);
    if(castUrl&&legacyPage&&(url.origin===siteOrigin||castHost)){
      const destination=new URL(castUrl);destination.search=url.search;
      if(destination.toString()!==url.toString())return Response.redirect(destination.toString(),308);
    }
    // Keep the receiver document inside its encrypted-delivery worker scope.
    if(url.pathname==='/cast'){url.pathname='/cast/';return Response.redirect(url.toString(),308);}
    if(blocksProviderIntent(url))return new Response('Not found',{status:404,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex'}});
    if(url.pathname==='/vega-cast/v1')return castRequest(request,env);
    const response=castHost&&url.pathname==='/'?await env.ASSETS.fetch(new Request(new URL('/cast/',url),request)):await handle(request,env,ctx);
    if(castHost||url.pathname==='/cast'||url.pathname.startsWith('/cast/')){
      const headers=new Headers(response.headers);
      if(castHost&&url.pathname==='/cast/phone-worker.js')headers.set('Service-Worker-Allowed','/');
      headers.set('Cross-Origin-Opener-Policy','same-origin');
      headers.set('Cross-Origin-Embedder-Policy','credentialless');
      return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
    }
    return response;
  },
};
