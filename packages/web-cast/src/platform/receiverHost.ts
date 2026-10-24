import type {ReceiverCapabilities, CastMedia} from '../cast/protocol';
import type {MediaSourceDescriptor} from '../core/media';

export interface ReceiverHost {
  name: string;
  deviceName?: string;
  capabilities: ReceiverCapabilities;
  prepareSource(source: MediaSourceDescriptor): Promise<MediaSourceDescriptor>;
}

export function defaultReceiverName():string {
  const device=window.vegaCastHost?.deviceName?.trim();
  if(device)return device.slice(0,64);
  // Browsers do not expose the OS device name. Local Node receivers can resolve
  // their own hostname at registration; hosted browsers use an honest fallback.
  const agent=navigator.userAgent;
  if(/webOS|web0S/i.test(agent))return 'LG TV';
  if(/Tizen/i.test(agent))return 'Samsung TV';
  if(/Android.*TV|AFT/i.test(agent))return 'Android TV';
  if(/Windows/i.test(agent))return 'Windows PC';
  if(/Macintosh|Mac OS X/i.test(agent))return 'Mac';
  if(/Android/i.test(agent))return 'Android device';
  if(/Linux/i.test(agent))return 'Linux PC';
  return 'Web receiver';
}
declare global { interface Window { vegaCastHost?: ReceiverHost } }

/** Native hosts install this bridge. A UI preference cannot change browser security. */
export function receiverHost(): ReceiverHost | undefined {
  const host = window.vegaCastHost;
  return host?.capabilities.nativeNetworking && typeof host.prepareSource === 'function' ? host : undefined;
}
export function receiverCapabilities(): ReceiverCapabilities {
  return receiverHost()?.capabilities ?? {host:'browser', nativeNetworking:false, customHeaders:false, browserSecurity:true};
}
export function needsPhoneAccess(media:CastMedia, caps:ReceiverCapabilities): boolean {
  if(/^(file:|content:|\/)|^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/)/i.test(media.source.url))return true;
  const restricted = Object.keys(media.source.headers || {}).some(key => /^(cookie|cookie2|origin|referer|user-agent|host|connection|content-length|accept-encoding|sec-.*|proxy-.*)$/i.test(key));
  return restricted&&!(caps.nativeNetworking&&caps.customHeaders);
}
