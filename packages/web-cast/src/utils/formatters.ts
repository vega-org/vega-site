export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');

  if (hrs > 0) {
    const hh = String(hrs).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

export function formatBitrate(bps?: number): string {
  if (!bps || bps <= 0) return 'N/A';
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`;
  return `${(bps / 1_000).toFixed(0)} kbps`;
}

/** Use language metadata, rather than guessing a language from a release title. */
export function formatLanguage(language?:string):string {
  const raw=language?.trim().replace(/_/g,'-');
  if(!raw||raw==='und')return 'Unknown language';
  if(raw==='mul')return 'Multiple languages';
  const aliases:Record<string,string>={eng:'en',hin:'hi',tam:'ta',tel:'te',mal:'ml',kan:'kn',ben:'bn',mar:'mr',sin:'si',fra:'fr',fre:'fr',deu:'de',ger:'de',spa:'es',por:'pt',jpn:'ja',kor:'ko',zho:'zh',chi:'zh',ara:'ar',rus:'ru',ita:'it'};
  const parts=raw.split('-');parts[0]=aliases[parts[0].toLowerCase()]||parts[0].toLowerCase();
  const tag=parts.join('-');
  try {return new Intl.DisplayNames(['en'],{type:'language'}).of(tag)||raw.toUpperCase();}
  catch {return raw.toUpperCase();}
}
