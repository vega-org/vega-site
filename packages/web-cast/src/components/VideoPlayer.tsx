import {ServerMenu} from './ServerMenu';
import type {CastServerOption} from '../cast/protocol';
import {PlaybackSpeedMenu} from './PlaybackSpeedMenu';
import {MediaPlayer} from '@vidstack/react';
import {LibmediaControlsBridge} from './LibmediaControlsBridge';
import '@vidstack/react/player/styles/base.css';
import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { PlayerManager } from '../player/PlayerManager';
import type { PlaybackState } from '../core/playback-state';
import { CinemaControls as PlayerControls } from './CinemaControls';
import {Icon} from './Icon';
import { AudioTrackMenu } from './AudioTrackMenu';
import { SubtitleTrackMenu } from './SubtitleTrackMenu';
import { PlaybackDiagnostics } from './PlaybackDiagnostics';
import { browserPlatform } from '../platform/browser/browserPlatform';

interface VideoPlayerProps {
  playerManager: PlayerManager;
  state: PlaybackState;
  onRetry?: () => void;
  title?:string;
  subtitle?:string;
  onExit?:()=>void;
  active?:boolean;
  servers?:CastServerOption[];selectedServerId?:string;canChangeServer?:boolean;changingServer?:boolean;serverError?:string;onSelectServer?:(id:string)=>void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ playerManager, state, onRetry, title, subtitle, onExit, active=true,servers=[],selectedServerId,canChangeServer=false,changingServer=false,serverError,onSelectServer }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showSpeedMenu,setShowSpeedMenu]=useState(false);
  const [showServerMenu,setShowServerMenu]=useState(false);
  useEffect(()=>{if(!canChangeServer&&showServerMenu)setShowServerMenu(false);},[canChangeServer,showServerMenu]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isControlsVisible, setIsControlsVisible] = useState(true);
  const hideControlsTimerRef = useRef<number | null>(null);

  // Attach container to player engine
  useEffect(() => {
    if (containerRef.current) {
      playerManager.attach(containerRef.current);
    }
    return () => {
      playerManager.detach();
    };
  }, [playerManager]);

  // Fullscreen tracking
  useEffect(() => {
    return browserPlatform.onFullscreenChange((fs) => {
      setIsFullscreen(fs);
    });
  }, []);

  const handleToggleFullscreen = useCallback(async () => {
    if (!wrapperRef.current) return;
    if (browserPlatform.isFullscreen()) {
      await browserPlatform.exitFullscreen();
    } else {
      await browserPlatform.requestFullscreen(wrapperRef.current);
    }
  }, []);

  // Keyboard navigation & controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if(!active||e.defaultPrevented)return;
      if(e.key==='Escape'||e.key==='BrowserBack'||[4,10009,461].includes(e.keyCode)) {
        if(showAudioMenu||showSubtitleMenu||showDiagnostics||showSpeedMenu||showServerMenu){e.preventDefault();setShowAudioMenu(false);setShowSubtitleMenu(false);setShowDiagnostics(false);setShowSpeedMenu(false);setShowServerMenu(false);}return;
      }
      // Don't intercept typing in inputs/textareas
      const target = e.target as HTMLElement;
      if(target.closest('.focus-dialog'))return;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      if(showAudioMenu||showSubtitleMenu||showDiagnostics||showSpeedMenu||showServerMenu)return;
      if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
        if(!isControlsVisible){e.preventDefault();setIsControlsVisible(true);requestAnimationFrame(()=>wrapperRef.current?.querySelector<HTMLButtonElement>('[data-primary-play]')?.focus());}
        return;
      }
      setIsControlsVisible(true);
      if(e.key===' '&&target.closest('button,select'))return;
      if(e.key==='MediaPlayPause'||[179,10252].includes(e.keyCode)){e.preventDefault();void playerManager.togglePlay();return;}
      if(e.key==='MediaPlay'||e.keyCode===415){e.preventDefault();void playerManager.play();return;}
      if(e.key==='MediaPause'||e.keyCode===19){e.preventDefault();void playerManager.pause();return;}
      if(e.key==='MediaStop'||e.keyCode===413){e.preventDefault();onExit?.();return;}

      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          playerManager.togglePlay();
          break;
        case 'ArrowLeft':
        case 'j':
          e.preventDefault();
          playerManager.seekRelative(-10);
          break;
        case 'ArrowRight':
        case 'l':
          e.preventDefault();
          playerManager.seekRelative(10);
          break;
        case 'ArrowUp':
          e.preventDefault();
          playerManager.setVolume(Math.min(1.5, state.volume + 0.05));
          break;
        case 'ArrowDown':
          e.preventDefault();
          playerManager.setVolume(Math.max(0, state.volume - 0.05));
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          playerManager.toggleMute();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          handleToggleFullscreen();
          break;
        case 'd':
        case 'D':
          e.preventDefault();
          setShowDiagnostics((prev) => !prev);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [playerManager, state.volume, handleToggleFullscreen, active, showAudioMenu, showSubtitleMenu, showDiagnostics, showSpeedMenu, showServerMenu, isControlsVisible, onExit]);

  // Auto-hide controls when playing and inactive
  const resetHideTimer = useCallback(() => {
    setIsControlsVisible(true);
    if (hideControlsTimerRef.current) {
      window.clearTimeout(hideControlsTimerRef.current);
    }
    if (state.status === 'playing') {
      hideControlsTimerRef.current = window.setTimeout(() => {
        if(!wrapperRef.current?.contains(document.activeElement))setIsControlsVisible(false);
      }, 3500);
    }
  }, [state.status]);

  const isLoading = state.status === 'loading';
  const isBuffering = state.status === 'buffering';
  const isError = state.status === 'error';
  const subtitleCodec=state.subtitleTracks.find(track=>track.id===state.selectedSubtitleTrackId)?.codec;
  const plainSubtitles=!!subtitleCodec&&['94210','94213','94216','94225','94226','text','srt','subrip','webvtt'].includes(subtitleCodec.toLowerCase());

  useEffect(()=>{
    if(!active||state.status!=='playing'||showAudioMenu||showSubtitleMenu||showDiagnostics||showSpeedMenu||showServerMenu){setIsControlsVisible(true);return;}
    const timer=window.setTimeout(()=>{
      if(!wrapperRef.current?.contains(document.activeElement))setIsControlsVisible(false);
    },4500);
    return()=>window.clearTimeout(timer);
  },[active,state.status,showAudioMenu,showSubtitleMenu,showDiagnostics,showSpeedMenu,showServerMenu,isControlsVisible]);
  useEffect(()=>()=>{if(hideControlsTimerRef.current)window.clearTimeout(hideControlsTimerRef.current);},[]);
  useEffect(()=>{
    if(!showAudioMenu&&!showSubtitleMenu&&!showDiagnostics&&!showSpeedMenu&&!showServerMenu)return;
    const previous=document.activeElement as HTMLElement|null;
    (wrapperRef.current?.querySelector<HTMLElement>('.track-modal .track-item-btn.active')||wrapperRef.current?.querySelector<HTMLElement>('.track-modal button,.diagnostics-modal button'))?.focus();
    return()=>{if(previous&&!previous.matches(':disabled'))previous.focus();else wrapperRef.current?.querySelector<HTMLElement>('[data-primary-play]')?.focus();};
  },[showAudioMenu,showSubtitleMenu,showDiagnostics,showSpeedMenu,showServerMenu]);

  return (
    <div
      ref={wrapperRef}
      className={`video-player-wrapper ${isFullscreen ? 'fullscreen' : ''} ${!isControlsVisible && state.status === 'playing' ? 'hide-cursor' : ''}`}
      onMouseMove={resetHideTimer}
      onClick={resetHideTimer}
    >
      <MediaPlayer className="vega-media-player" title={title} viewType="video" keyDisabled load="eager" storage={null} playsInline><LibmediaControlsBridge manager={playerManager}/>
      {/* libmedia Canvas/Video Mount Container */}
      <div ref={containerRef} className="media-canvas-container" data-subtitle-style={plainSubtitles?'plain':undefined} />

      <div className={`cinema-header ${isControlsVisible?'visible':'hidden'}`} aria-hidden={!isControlsVisible} inert={!isControlsVisible}>
        {onExit&&<button className="icon-button" onClick={onExit} aria-label="Back to Vega Cast"><Icon name="back"/></button>}
        <div><h2>{title||'Vega player'}</h2>{subtitle&&<p>{subtitle}</p>}</div>
        
      </div>

      {state.audioNeedsUserGesture && !isError && (
        <div className="player-overlay-center">
          <button className="error-retry-btn" onClick={() => playerManager.resumeAudio()}>
            Enable audio
          </button>
          <span className="spinner-text">Browser requires a click or remote selection to start audio.</span>
        </div>
      )}

      {/* Loading & Buffering Spinner */}
      {(isLoading || isBuffering) && (
        <div className="player-overlay-center">
          <div className="spinner-orbit" />
          <span className="spinner-text">
            {isLoading ? 'Demuxing & analyzing streams...' : 'Buffering media...'}
          </span>
        </div>
      )}

      {/* Error Banner / Retry Overlay */}
      {isError && state.error && (
        <div className="player-overlay-center error-overlay">
          <div className="error-icon">⚠️</div>
          <div className="error-category">{state.error.category}</div>
          <div className="error-message">{state.error.message}</div>
          {onRetry && (
            <button className="error-retry-btn" onClick={onRetry}>
              Retry Source
            </button>
          )}
        </div>
      )}

      {!isError && state.error && (
        <div className="player-operation-error" role="alert">
          {state.error.message}
        </div>
      )}

      {/* Primary Floating Controls Bar */}
      <div className={`controls-wrapper ${isControlsVisible ? 'visible' : 'hidden'}`} aria-hidden={!isControlsVisible} inert={!isControlsVisible}>
        <PlayerControls
          state={state}
          onOpenSpeedMenu={()=>setShowSpeedMenu(true)}
          onOpenServerMenu={canChangeServer&&servers.length>1?()=>setShowServerMenu(true):undefined} changingServer={changingServer}
          onOpenAudioMenu={() => setShowAudioMenu(true)}
          onOpenSubtitleMenu={() => setShowSubtitleMenu(true)}
          onOpenDiagnostics={() => setShowDiagnostics(true)}
          onToggleFullscreen={handleToggleFullscreen}
          isFullscreen={isFullscreen}
        />
      </div>

      {/* Audio Track Selector Modal */}
      {showAudioMenu && (
        <AudioTrackMenu
          tracks={state.audioTracks}
          selectedId={state.selectedAudioTrackId}
          onSelectTrack={(id) => playerManager.selectAudioTrack(id)}
          onClose={() => setShowAudioMenu(false)}
        />
      )}

      {/* Subtitle Track Selector Modal */}
      {showSubtitleMenu && (
        <SubtitleTrackMenu
          tracks={state.subtitleTracks}
          selectedId={state.selectedSubtitleTrackId}
          subtitleEnabled={state.subtitleEnabled}
          subtitleDelay={state.subtitleDelay}
          onSelectTrack={(id) => playerManager.selectSubtitleTrack(id)}
          onToggleEnabled={(en) => playerManager.setSubtitleEnabled(en)}
          onSetDelay={(delay) => playerManager.setSubtitleDelay(delay)}
          onLoadExternalSubtitle={(file) => {
            void playerManager.loadExternalSubtitle({ source: file, title: file.name });
          }}
          onClose={() => setShowSubtitleMenu(false)}
        />
      )}

      {showSpeedMenu&&<PlaybackSpeedMenu rate={state.playbackRate} onSelect={rate=>playerManager.setPlaybackRate(rate)} onClose={()=>setShowSpeedMenu(false)}/>}
      {showServerMenu&&canChangeServer&&<ServerMenu servers={servers} selectedId={selectedServerId} onSelect={id=>onSelectServer?.(id)} onClose={()=>setShowServerMenu(false)}/>}
      {serverError&&<div className="player-operation-error" role="alert">{serverError}</div>}
      {/* Diagnostics HUD */}
      {showDiagnostics && (
        <PlaybackDiagnostics state={state} onClose={() => setShowDiagnostics(false)} />
      )}
      </MediaPlayer>
    </div>
  );
};
