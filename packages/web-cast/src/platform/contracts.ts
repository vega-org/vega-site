export interface PlatformServices {
  isFullscreen(): boolean;
  requestFullscreen(element: HTMLElement): Promise<void>;
  exitFullscreen(): Promise<void>;
  onFullscreenChange(callback: (isFullscreen: boolean) => void): () => void;
  resolveAssetUrl(path: string): string;
}
