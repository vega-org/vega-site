export function isOfficialDomain(hostname:string):boolean {
  const host=hostname.toLowerCase().replace(/\.$/,'');
  return host==='vega-app.in'||host.endsWith('.vega-app.in');
}

export function blocksProviderIntent(url:URL):boolean {
  if(!isOfficialDomain(url.hostname))return false;
  let path:string;
  try{path=decodeURIComponent(url.pathname);}catch{return false;}
  path=path.replace(/\/+/g,'/').replace(/\/index\.html$/,'').replace(/\.html$/,'').replace(/\/$/,'');
  // All three routes render the same provider-source intent launcher.
  return ['/add-provider','/add-source','/zenda-x'].includes(path);
}
