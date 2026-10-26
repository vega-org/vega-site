/// <reference path="./webtorrent.d.ts" />
import AVPlayer from '@libmedia/avplayer';
import {selectTorrentFile, type TorrentOptions, type TorrentFileInfo} from './torrentSource';
import {TorrentStore} from './TorrentStore';

interface TorrentFile extends TorrentFileInfo {stream(options: {start: number; end: number}): ReadableStream<Uint8Array>}
interface Torrent {
  files: TorrentFile[];
  on(event: string, listener: (error: Error) => void): void;
}
interface Client {
  add(source: string | Uint8Array, options: Record<string, unknown>, ready: (torrent: Torrent) => void): Torrent;
  on(event: string, listener: (error: Error) => void): void;
  destroy(callback?: () => void): void;
}
interface Constructor {new(options: Record<string, unknown>): Client; WEBRTC_SUPPORT: boolean}
type IOBuffer = Parameters<InstanceType<typeof AVPlayer.IOLoader.CustomIOLoader>['read']>[0];
const EOF = -(1 << 20);
const DEFAULT_TRACKERS = ['wss://tracker.openwebtorrent.com', 'wss://tracker.btorrent.xyz'];

// This is transport only. Libmedia still owns demuxing, decoding and clocks.
export class TorrentInput extends AVPlayer.IOLoader.CustomIOLoader {
  private controller = new AbortController();
  private client?: Client;
  private file?: TorrentFile;
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private remainder?: Uint8Array;
  private position = 0;
  private failure?: Error;
  private readGeneration = 0;
  private source: string;
  private options: TorrentOptions;
  private metadataTimeout: number;
  private readTimeout: number;
  constructor(source: string, options: TorrentOptions = {}, metadataTimeout = 30_000, readTimeout = 30_000) {
    super(); this.source=source; this.options=options; this.metadataTimeout=metadataTimeout; this.readTimeout=readTimeout;
  }
  get ext() {return this.file?.name.split('.').pop()?.toLowerCase() || '';}
  get name() {return this.file?.name || 'Torrent';}
  get flags() {return 1; /* SEEKABLE */}

  private async wait<T>(operation: Promise<T>, timeout: number, message: string): Promise<T> {
    const signal = this.controller.signal;
    if (signal.aborted) throw new Error('Torrent playback canceled');
    let timer: ReturnType<typeof setTimeout>;
    let abort: () => void;
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        abort = () => reject(new Error('Torrent playback canceled'));
        signal.addEventListener('abort', abort, {once: true});
        timer = setTimeout(() => reject(new Error(message)), timeout);
      })]);
    } finally {
      clearTimeout(timer!);
      signal.removeEventListener('abort', abort!);
    }
  }

  async open(): Promise<number> {
    if (this.file && !this.controller.signal.aborted) return 0;
    try {
      if (typeof RTCPeerConnection !== 'function' || typeof RTCDataChannel === 'undefined') throw new Error('WebTorrent is unsupported on this device: WebRTC data channels are unavailable');
      if (typeof indexedDB === 'undefined') throw new Error('WebTorrent is unsupported on this device: temporary piece storage is unavailable');
      const module = await this.wait(import('webtorrent/dist/webtorrent.min.js'), 15_000, 'Unable to load the WebTorrent component');
      if (this.controller.signal.aborted) throw new Error('Torrent playback canceled');
      const WebTorrent = module.default as Constructor;
      if (!WebTorrent.WEBRTC_SUPPORT) throw new Error('WebTorrent is unsupported on this device');
      // No DHT/native sockets or HTTP web seeds. Only WebRTC peers are used.
      this.client = new WebTorrent({dht: false, lsd: false, webSeeds: false, maxConns: 12});
      let rejectMetadata: (error: Error) => void = () => {};
      const fail = (error: Error) => {
        this.failure = new Error(`Torrent playback failed: ${error.message}`);
        rejectMetadata(this.failure);
        void this.reader?.cancel(this.failure).catch(() => {});
      };
      this.client.on('error', fail);
      let source: string | Uint8Array = this.source;
      if (!/^magnet:/i.test(this.source)) {
        const url = new URL(this.source);
        if (!/^https?:$/.test(url.protocol)) throw new Error('Invalid torrent source URL');
        const response = await this.wait(fetch(url, {signal: this.controller.signal, credentials: 'omit'}), this.metadataTimeout, 'Torrent file request timed out');
        if (!response.ok) throw new Error(`Torrent file HTTP ${response.status}`);
        // Bound untrusted .torrent downloads, including chunked responses.
        const reader = response.body?.getReader();
        if (!reader) throw new Error('Torrent file response is empty');
        const chunks: Uint8Array[] = []; let size = 0;
        try {
          for (;;) {
            const result = await this.wait(reader.read(), this.metadataTimeout, 'Torrent file request timed out');
            if (result.done) break;
            size += result.value.length;
            if (size > 4 * 1024 * 1024) throw new Error('Torrent metadata exceeds 4 MB');
            chunks.push(result.value);
          }
        } finally {void reader.cancel().catch(() => {});}
        source = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) {source.set(chunk, offset); offset += chunk.length;}
      }
      const torrent = await this.wait(new Promise<Torrent>((resolve, reject) => {
        rejectMetadata = reject;
        const torrent = this.client!.add(source, {
          announce: (this.options.announce || DEFAULT_TRACKERS).filter(url => /^wss:\/\//i.test(url)),
          deselect: true, destroyStoreOnDestroy: true, storeCacheSlots: 8, store: TorrentStore,
        }, resolve);
        torrent.on('error', fail);
      }), this.metadataTimeout, 'Torrent metadata timed out. No reachable WebRTC peers; ordinary BitTorrent peers cannot connect to this player.');
      const selection = {...this.options};
      if (selection.fileIndex === undefined && /^magnet:/i.test(this.source)) {
        const index = new URL(this.source).searchParams.get('so');
        if (index && /^\d+$/.test(index)) selection.fileIndex = Number(index);
      }
      this.file = selectTorrentFile(torrent.files, selection);
      if (!Number.isSafeInteger(this.file.length) || this.file.length <= 0) throw new Error('Torrent video size is invalid');
      return 0;
    } catch (error) {
      await this.stop();
      throw new Error(`Torrent playback failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async read(buffer: IOBuffer): Promise<number> {
    if (this.failure) throw this.failure;
    if (this.controller.signal.aborted) return EOF;
    if (!this.file) throw new Error('Torrent source is not open');
    if (this.position >= this.file.length) return EOF;
    const generation = this.readGeneration;
    try {
      if (!this.remainder?.length) {
        this.reader ||= this.file.stream({start: this.position, end: this.file.length - 1}).getReader();
        const chunk = await this.wait(this.reader.read(), this.readTimeout, 'Torrent stalled: no video pieces received for 30 seconds');
        if (generation !== this.readGeneration || this.controller.signal.aborted) return EOF;
        if (this.failure) throw this.failure;
        if (chunk.done) {
          if (this.position < this.file.length) throw new Error('Torrent stream ended before the video finished');
          return EOF;
        }
        this.remainder = chunk.value;
      }
      const size = Math.min(buffer.length, this.remainder.length);
      buffer.set(this.remainder.subarray(0, size));
      this.remainder = this.remainder.subarray(size);
      this.position += size;
      return size;
    } catch (error) {
      // Canceling the previous range during a seek must not destroy the
      // newly opened range (or the torrent client serving it).
      if (generation !== this.readGeneration || this.controller.signal.aborted) return EOF;
      this.failure = error instanceof Error ? error : new Error(String(error));
      await this.stop(); throw this.failure;
    }
  }
  async seek(position: bigint): Promise<number> {
    if (this.failure) throw this.failure;
    if (!this.file || position < 0n || position > BigInt(this.file.length)) return -1;
    this.readGeneration++;
    void this.reader?.cancel().catch(() => {});
    this.reader = undefined; this.remainder = undefined; this.position = Number(position);
    return 0;
  }
  async size(): Promise<bigint> {return BigInt(this.file?.length || 0);}
  async stop(): Promise<void> {
    this.controller.abort(); this.readGeneration++;
    void this.reader?.cancel().catch(() => {}); this.reader = undefined; this.remainder = undefined;
    const client = this.client; this.client = undefined;
    try {client?.destroy();} catch { /* An already failed client may be destroyed. */ }
  }
}
