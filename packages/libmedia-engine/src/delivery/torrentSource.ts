export function isTorrentSource(source: unknown, format?: string): source is string {
  return typeof source === 'string' && (/^magnet:\?/i.test(source) || /^https?:\/\/[^#?]+\.torrent(?:[?#]|$)/i.test(source) || format === 'torrent');
}

export interface TorrentOptions {fileIndex?: number; fileName?: string; announce?: string[]}

export interface TorrentFileInfo {name: string; path: string; length: number}
export function selectTorrentFile<T extends TorrentFileInfo>(files: T[], options: TorrentOptions = {}): T {
  if (options.fileIndex !== undefined) {
    if (!Number.isInteger(options.fileIndex) || !files[options.fileIndex]) throw new Error('Torrent file index is invalid');
    return files[options.fileIndex];
  }
  if (options.fileName) {
    const matches = files.filter(file => file.path === options.fileName || file.name === options.fileName);
    if (matches.length !== 1) throw new Error('Torrent file name is missing or ambiguous');
    return matches[0];
  }
  const videos = files.filter(file => /\.(mkv|mp4|m4v|webm|mov|avi|ts)$/i.test(file.name) && !/(?:^|[\W_])sample(?:[\W_]|$)/i.test(file.name));
  if (!videos.length) throw new Error('Torrent contains no supported video files');
  if (videos.length > 1) throw new Error('Torrent contains multiple videos. The provider must specify a torrent file index or file name.');
  return videos[0];
}
