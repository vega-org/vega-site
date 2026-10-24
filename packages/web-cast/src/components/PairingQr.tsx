import {useMemo} from 'react';
import {pairingQr} from '../cast/qr';
export function PairingQr({value}:{value:string}) {
  const path=useMemo(()=>{try{return pairingQr(value).flatMap((row,y)=>row.flatMap((on,x)=>on?[`M${x+4},${y+4}h1v1h-1z`]:[])).join('');}catch{return '';}},[value]);
  if(!path)return <div className="qr-unavailable">Use the pairing code below</div>;
  return <svg className="pairing-qr" viewBox="0 0 65 65" role="img" aria-label="Scan to pair Vega Mobile" shapeRendering="crispEdges"><rect width="65" height="65" fill="white"/><path d={path} fill="#111"/></svg>;
}
