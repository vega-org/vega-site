import {LibmediaEngine} from '@vega/libmedia-engine';
import {TorrentInput} from '@vega/libmedia-engine/torrent-input';
import {selectTorrentFile} from '@vega/libmedia-engine/torrent-source';

// Test peers are on one host. Avoid external STUN availability affecting this
// controlled transfer; production keeps WebTorrent's normal ICE configuration.
const NativeRTC = window.RTCPeerConnection;
window.RTCPeerConnection = class extends NativeRTC {
  constructor(configuration?: RTCConfiguration) {super({...configuration, iceServers: []});}
};

const engine = new LibmediaEngine();
engine.attach(document.querySelector('#player')!);
const state: Record<string, unknown> = {};
engine.setEventListeners({onStateChange: next => Object.assign(state, next)});
Object.assign(window, {torrentTest: {engine, state, TorrentInput, selectTorrentFile, webtorrent: () => import('webtorrent/dist/webtorrent.min.js')}});
