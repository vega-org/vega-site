export interface EnvironmentCapabilities {
  webCodecs: boolean;
  videoDecoder: boolean;
  audioDecoder: boolean;
  mse: boolean;
  sharedArrayBuffer: boolean;
  crossOriginIsolated: boolean;
  webgl: boolean;
  webgpu: boolean;
  audioContext: boolean;
  audioWorklet: boolean;
}

export function detectEnvironmentCapabilities(): EnvironmentCapabilities {
  const hasWindow = typeof window !== 'undefined';
  const hasNavigator = typeof navigator !== 'undefined';

  const webgl = (() => {
    if (!hasWindow || typeof document === 'undefined') return false;
    try {
      const canvas = document.createElement('canvas');
      return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
    } catch {
      return false;
    }
  })();

  const webgpu = hasNavigator && 'gpu' in navigator && !!navigator.gpu;
  const videoDecoder = hasWindow && typeof (window as unknown as { VideoDecoder?: unknown }).VideoDecoder === 'function';
  const audioDecoder = hasWindow && typeof (window as unknown as { AudioDecoder?: unknown }).AudioDecoder === 'function';
  const webCodecs = videoDecoder && audioDecoder;
  const mse = hasWindow && typeof window.MediaSource === 'function';
  const sharedArrayBuffer = hasWindow && typeof window.SharedArrayBuffer === 'function';
  const crossOriginIsolated = hasWindow && !!window.crossOriginIsolated;
  const audioContext = hasWindow && (typeof window.AudioContext === 'function' || typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext === 'function');
  const audioWorklet = hasWindow && typeof AudioWorkletNode === 'function';

  return {
    webCodecs,
    videoDecoder,
    audioDecoder,
    mse,
    sharedArrayBuffer,
    crossOriginIsolated,
    webgl,
    webgpu,
    audioContext,
    audioWorklet,
  };
}
