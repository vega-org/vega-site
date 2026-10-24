export const CAST_PROTOCOL_VERSION = 1;
export interface ReceiverCapabilities {
  securePhoneDelivery?:boolean;
  host: 'browser' | 'native';
  nativeNetworking: boolean;
  customHeaders: boolean;
  browserSecurity: boolean;
}
export interface CastMedia {
  processing?:'original'|'remuxed';
  servers?:CastServerOption[];
  selectedServerId?:string;
  id: string;
  title: string;
  subtitle?: string;
  artwork?: string;
  providerStream?: {
    server:string;link:string;type:string;quality?:string;tag?:string;tags?:string[];
    headers?:unknown;subtitles?:{uri:string;language:string;title:string;type:string}[];
    skip?:{title?:string;from:number;to:number}[];
  };
  source: {url:string; format?:string; headers?:Record<string,string>};
  proxy?: {secure?:boolean;iceServers?:RTCIceServer[];source:{url:string;format?:string};subtitles?:{uri:string;language?:string;title?:string;type?:string}[]};
  audioTrack?:number;
  subtitleTrack?:number;
  subtitles?: {uri:string; language?:string; title?:string; type?:string}[];
  startPosition?: number;
  delivery?: 'direct' | 'phone-proxy';
  attempt?: number;
}
export interface CastServerOption {id:string;name:string;quality?:string;tags?:string[]}
export interface CastMessage {
  type: string;
  id?: string;
  controllerId?: string;
  requestId?: string;
  name?: string;
  confirmation?: string;
  command?: string;
  value?: unknown;
  media?: CastMedia;
  [key:string]: unknown;
}
export interface ReceiverIdentity {receiverId:string; token:string}
export interface PairRequest {requestId:string; name:string; confirmation:string}
