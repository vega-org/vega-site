type Callback = (error?: Error | null, data?: Uint8Array) => void;

/** Ephemeral disk-backed pieces: never accumulate an entire movie in RAM. */
export class TorrentStore {
  private name = `vega-torrent-${crypto.randomUUID()}`;
  private closed = false;
  private database: Promise<IDBDatabase>;
  readonly chunkLength: number;
  readonly length: number;
  constructor(chunkLength: number, options: {length?: number} = {}) {
    this.chunkLength = chunkLength;
    this.length = options.length || 0;
    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('pieces');
      request.onerror = () => reject(new Error('Torrent storage is unavailable'));
      request.onsuccess = () => {
        if (this.closed) {request.result.close(); indexedDB.deleteDatabase(this.name);}
        resolve(request.result);
      };
    });
    // Storage can fail before WebTorrent issues its first operation.
    void this.database.catch(() => {});
  }
  put(index: number, data: Uint8Array, callback: Callback) {
    void this.database.then(database => {
      if (this.closed) throw new Error('Torrent storage closed');
      const transaction = database.transaction('pieces', 'readwrite');
      transaction.objectStore('pieces').put(data, index);
      transaction.oncomplete = () => callback(null);
      transaction.onabort = () => callback(new Error('Torrent storage is full or unavailable'));
    }).catch(error => callback(error));
  }
  get(index: number, options: {offset?: number; length?: number} | Callback, callback?: Callback) {
    const opts = typeof options === 'function' ? {} : options;
    const done = typeof options === 'function' ? options : callback!;
    void this.database.then(database => {
      if (this.closed) throw new Error('Torrent storage closed');
      const request = database.transaction('pieces').objectStore('pieces').get(index);
      request.onerror = () => done(new Error('Torrent piece read failed'));
      request.onsuccess = () => {
        const bytes = request.result as Uint8Array | undefined;
        if (!bytes) {done(new Error('Torrent piece not found')); return;}
        const start = opts.offset || 0;
        done(null, bytes.subarray(start, opts.length === undefined ? undefined : start + opts.length));
      };
    }).catch(error => done(error));
  }
  close(callback: Callback = () => {}) {
    this.closed = true;
    void this.database.then(database => {database.close(); callback(null);}, () => callback(null));
  }
  destroy(callback: Callback = () => {}) {
    this.close(() => {
      const request = indexedDB.deleteDatabase(this.name);
      request.onsuccess = () => callback(null);
      request.onerror = () => callback(new Error('Torrent storage cleanup failed'));
    });
  }
}
