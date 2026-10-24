import type { PlatformServices } from '../contracts';

export class BrowserPlatform implements PlatformServices {
  isFullscreen(): boolean {
    if (typeof document === 'undefined') return false;
    return !!(
      document.fullscreenElement ||
      (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement
    );
  }

  async requestFullscreen(element: HTMLElement): Promise<void> {
    if (element.requestFullscreen) {
      await element.requestFullscreen();
    } else if ((element as unknown as { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen) {
      await (element as unknown as { webkitRequestFullscreen: () => Promise<void> }).webkitRequestFullscreen();
    }
  }

  async exitFullscreen(): Promise<void> {
    if (document.exitFullscreen) {
      await document.exitFullscreen();
    } else if ((document as unknown as { webkitExitFullscreen?: () => Promise<void> }).webkitExitFullscreen) {
      await (document as unknown as { webkitExitFullscreen: () => Promise<void> }).webkitExitFullscreen();
    }
  }

  onFullscreenChange(callback: (isFullscreen: boolean) => void): () => void {
    const handler = () => {
      callback(this.isFullscreen());
    };
    document.addEventListener('fullscreenchange', handler);
    document.addEventListener('webkitfullscreenchange', handler);
    return () => {
      document.removeEventListener('fullscreenchange', handler);
      document.removeEventListener('webkitfullscreenchange', handler);
    };
  }

  resolveAssetUrl(path: string): string {
    // Relative asset resolution avoiding hardcoded absolute roots
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('blob:')) {
      return path;
    }
    return new URL(path, window.location.href).toString();
  }
}

export const browserPlatform = new BrowserPlatform();
