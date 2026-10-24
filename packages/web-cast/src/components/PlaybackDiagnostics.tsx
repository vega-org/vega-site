import {Icon} from './Icon';
import React, {useEffect,useRef,useState} from 'react';
import type { PlaybackState } from '../core/playback-state';
import { formatTime } from '../utils/formatters';

interface PlaybackDiagnosticsProps {
  state: PlaybackState;
  onClose: () => void;
}

export const PlaybackDiagnostics: React.FC<PlaybackDiagnosticsProps> = ({ state, onClose }) => {
  const diag = state.diagnostics;
  const latest=useRef(state);latest.current=state;
  const samples=useRef<{elapsedMs:number;status:string;playbackRate:number;diagnostics:PlaybackState['diagnostics']}[]>([]);
  const [receiveMbps,setReceiveMbps]=useState<number|null>(null);
  const [copyStatus,setCopyStatus]=useState('Copy report');
  const [reportText,setReportText]=useState('');
  useEffect(()=>{
    const start=performance.now();
    const capture=()=>{
      const current=latest.current;
      const sample={elapsedMs:Math.round(performance.now()-start),status:current.status,playbackRate:current.playbackRate,diagnostics:{...current.diagnostics}};
      const previous=samples.current.at(-1);
      const bytes=sample.diagnostics.bufferReceiveBytes,oldBytes=previous?.diagnostics.bufferReceiveBytes;
      const delta=bytes!=null&&oldBytes!=null?bytes-oldBytes:-1;
      setReceiveMbps(previous&&delta>=0&&sample.elapsedMs>previous.elapsedMs?delta*8/(sample.elapsedMs-previous.elapsedMs)/1000:null);
      samples.current=[...samples.current.slice(-29),sample];
    };
    capture();const timer=window.setInterval(capture,1000);
    return()=>window.clearInterval(timer);
  },[]);
  const copyReport=async()=>{
    // Deliberately exclude source URLs, headers and device/session credentials.
    const text=JSON.stringify({samplePeriod:'up to 30 seconds while diagnostics are open',samples:samples.current},null,2);
    try{await navigator.clipboard.writeText(text);setCopyStatus('Copied');}
    catch{setReportText(text);setCopyStatus('Select report below');}
  };

  const activeAudio = state.audioTracks.find((t) => t.id === state.selectedAudioTrackId) || state.audioTracks[0];
  const activeSubtitle = state.subtitleTracks.find((t) => t.id === state.selectedSubtitleTrackId);

  return (
    <div className="diagnostics-overlay" onClick={onClose}>
      <div className="diagnostics-modal" role="dialog" aria-modal="true" aria-label="Playback diagnostics" onClick={(e) => e.stopPropagation()}>
        <div className="diagnostics-header">
          <div className="diagnostics-title">
            <Icon name="info" size={20}/>
            <span>Live Playback Diagnostics</span>
          </div>
          <button className="track-close-btn" onClick={()=>{void copyReport();}}>{copyStatus}</button>
          <button className="track-close-btn" onClick={onClose} aria-label="Close diagnostics">
            <Icon name="close" size={18}/>
          </button>
        </div>

        <div className="diagnostics-grid">
          {/* Decoder & Engine */}
          <div className="diag-card">
            <span className="diag-label">Engine & Pipeline</span>
            <div className="diag-value highlight">libmedia (AVPlayer)</div>
            <div className="diag-sub">
              Path: <strong>{diag.decoderPath?.toUpperCase() ?? 'UNKNOWN'}</strong>
            </div>
            <div className="diag-sub">
              Hardware Acceleration:{' '}
              {diag.isHardwareAccelerated === null
                ? 'Unverified (API does not disclose HW tier)'
                : diag.isHardwareAccelerated
                ? 'Active'
                : 'Disabled'}
            </div>
          </div>

          {/* Status & Position */}
          <div className="diag-card">
            <span className="diag-label">Playback Status</span>
            <div className="diag-value capitalize">{state.status}</div>
            <div className="diag-sub">
              Position: {formatTime(state.currentTime)} / {formatTime(state.duration)} ({state.currentTime.toFixed(2)}s)
            </div>
            <div className="diag-sub">Speed: {state.playbackRate}x | Volume: {Math.round(state.volume * 100)}%</div>
          </div>

          {/* Video Metrics */}
          <div className="diag-card">
            <span className="diag-label">Video Stream</span>
            <div className="diag-value">{diag.resolution || 'Resolution Unknown'}</div>
            <div className="diag-sub">Codec: {diag.videoCodec || 'N/A'}</div>
            <div className="diag-sub">Source / decode / render FPS: {diag.videoEncodeFramerate ?? 'N/A'} / {diag.videoDecodeFramerate ?? 'N/A'} / {diag.videoRenderFramerate ?? 'N/A'}</div>
            <div className="diag-sub">Longest decode interval: {diag.videoFrameDecodeIntervalMax ?? 'N/A'} ms | Video stalls: {diag.videoStutter ?? 'N/A'}</div>
            <div className="diag-sub">
              Frames Decoded: {diag.videoFrameDecodeCount ?? 'N/A'} | Discarded:{' '}
              <span className={diag.videoFrameDropCount ? 'text-warning' : ''}>
                {diag.videoFrameDropCount ?? 'N/A'}
              </span>
            </div>
          </div>

          {/* Audio Metrics */}
          <div className="diag-card">
            <span className="diag-label">Network & Queues</span>
            <div className="diag-value">{receiveMbps==null?'Measuring…':`${receiveMbps.toFixed(2)} Mbps`}</div>
            <div className="diag-sub">Received during last sample; reads may arrive in bursts.</div>
            <div className="diag-sub">Total received: {diag.bufferReceiveBytes==null?'N/A':`${(diag.bufferReceiveBytes/1048576).toFixed(1)} MiB`}</div>
            <div className="diag-sub">Queued packets — video: {diag.videoPacketQueueLength ?? 'N/A'} | audio: {diag.audioPacketQueueLength ?? 'N/A'}</div>
            <div className="diag-sub">Audio stalls: {diag.audioStutter ?? 'N/A'}</div>
          </div>
          <div className="diag-card">
            <span className="diag-label">Audio Stream</span>
            <div className="diag-value">
              {activeAudio ? (activeAudio.channels ? `${activeAudio.channels} Channels` : 'Channels unknown') : 'No Audio'}
            </div>
            <div className="diag-sub">Codec: {diag.audioCodec || 'N/A'}</div>
            <div className="diag-sub">
              Audio output: {state.audioNeedsUserGesture ? 'Waiting for user gesture' : 'No gesture requested'}
            </div>
            <div className="diag-sub">
              Sample Rate: {diag.audioSampleRate ? `${diag.audioSampleRate} Hz` : 'N/A'}
            </div>
            <div className="diag-sub">
              Frames Decoded: {diag.audioFrameDecodeCount ?? 'N/A'}
            </div>
            <div className="diag-sub">
              Frames Rendered: {diag.audioFrameRenderCount ?? 'N/A'} | Decode Errors: {diag.audioDecodeErrorPacketCount ?? 'N/A'}
            </div>
          </div>

          {/* Timing & Synchronization */}
          <div className="diag-card">
            <span className="diag-label">A/V Clocks & Sync</span>
            <div className="diag-value">
              {diag.avSyncDiffMs !== null && diag.avSyncDiffMs !== undefined
                ? `${diag.avSyncDiffMs >= 0 ? '+' : ''}${diag.avSyncDiffMs.toFixed(1)} ms`
                : 'Unavailable'}
            </div>
            <div className="diag-sub">
              Video Clock: {diag.videoCurrentTime != null ? `${diag.videoCurrentTime.toFixed(2)}s` : 'N/A'}
            </div>
            <div className="diag-sub">
              Audio Clock: {diag.audioCurrentTime != null ? `${diag.audioCurrentTime.toFixed(2)}s` : 'N/A'}
            </div>
          </div>

          {/* Active Tracks Summary */}
          <div className="diag-card">
            <span className="diag-label">Active Tracks</span>
            <div className="diag-sub">
              Audio: <strong>{activeAudio?.label || 'None'}</strong>
            </div>
            <div className="diag-sub">
              Subtitle:{' '}
              <strong>
                {state.subtitleEnabled && activeSubtitle ? activeSubtitle.label : 'Disabled (Off)'}
              </strong>
            </div>
            <div className="diag-sub">
              Subtitle Delay: <strong>{state.subtitleDelay.toFixed(2)}s</strong>
            </div>
          </div>
        </div>
        {reportText&&<textarea readOnly aria-label="Playback report" value={reportText} onFocus={event=>event.currentTarget.select()}/>}

        {/* Error Details if any */}
        {state.error && (
          <div className="diag-error-box">
            <div className="diag-error-title">
              ⚠️ Error [{state.error.category}]: {state.error.message}
            </div>
            {state.error.rawDetails && (
              <pre className="diag-error-stack">{state.error.rawDetails}</pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
