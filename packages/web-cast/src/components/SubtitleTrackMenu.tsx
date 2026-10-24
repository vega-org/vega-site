import {Icon} from './Icon';
import React, { useRef } from 'react';
import type { MediaTrack } from '../core/media';
import {formatLanguage} from '../utils/formatters';

interface SubtitleTrackMenuProps {
  tracks: MediaTrack[];
  selectedId: number | null;
  subtitleEnabled: boolean;
  subtitleDelay: number;
  onSelectTrack: (trackId: number) => void;
  onToggleEnabled: (enabled: boolean) => void;
  onSetDelay: (delaySeconds: number) => void;
  onLoadExternalSubtitle: (file: File) => void;
  onClose: () => void;
}

export const SubtitleTrackMenu: React.FC<SubtitleTrackMenuProps> = ({
  tracks,
  selectedId,
  subtitleEnabled,
  subtitleDelay,
  onSelectTrack,
  onToggleEnabled,
  onSetDelay,
  onLoadExternalSubtitle,
  onClose,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onLoadExternalSubtitle(file);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="track-modal-overlay" onClick={onClose}>
      <div className="track-modal" role="dialog" aria-modal="true" aria-label="Subtitle tracks" onClick={(e) => e.stopPropagation()}>
        <div className="track-modal-header">
          <div className="track-modal-title">
            <Icon name="subtitles" size={20}/>
            <span>Subtitles</span>
          </div>
          <button className="track-close-btn" onClick={onClose} aria-label="Close subtitles menu">
            <Icon name="close" size={18}/>
          </button>
        </div>

        {/* Master enable switch */}
        <div className="subtitle-toggle-row">
          <span>Show Subtitles</span>
          <button
            className={`toggle-switch ${subtitleEnabled ? 'active' : ''}`}
            onClick={() => onToggleEnabled(!subtitleEnabled)}
            aria-label="Toggle subtitle display"
          >
            <span className="toggle-slider" />
          </button>
        </div>

        {/* Delay synchronization controls */}
        <div className="subtitle-delay-section">
          <div className="subtitle-delay-header">
            <span>Subtitle Timing Sync:</span>
            <span className="delay-value">
              {subtitleDelay >= 0 ? `+${subtitleDelay.toFixed(2)}s` : `${subtitleDelay.toFixed(2)}s`}
            </span>
          </div>
          <div className="subtitle-delay-buttons">
            <button className="delay-btn" onClick={() => onSetDelay(Number((subtitleDelay - 0.5).toFixed(2)))}>
              -0.5s
            </button>
            <button className="delay-btn" onClick={() => onSetDelay(Number((subtitleDelay - 0.1).toFixed(2)))}>
              -0.1s
            </button>
            <button className="delay-btn reset" onClick={() => onSetDelay(0)}>
              Sync (0s)
            </button>
            <button className="delay-btn" onClick={() => onSetDelay(Number((subtitleDelay + 0.1).toFixed(2)))}>
              +0.1s
            </button>
            <button className="delay-btn" onClick={() => onSetDelay(Number((subtitleDelay + 0.5).toFixed(2)))}>
              +0.5s
            </button>
          </div>
        </div>

        <div className="track-list">
          {/* Off option */}
          <button
            className={`track-item-btn ${selectedId === null || !subtitleEnabled ? 'active' : ''}`}
            onClick={() => {
              onSelectTrack(-1);
            }}
          >
            <div className="track-item-info">
              <span className="track-item-title">Off</span>
              <span className="track-subtitle-desc">Disable subtitle display</span>
            </div>
            {(selectedId === null || !subtitleEnabled) && (
              <span className="track-selected-mark">
                <Icon name="check" size={20}/>
              </span>
            )}
          </button>

          {/* Embedded Subtitles */}
          {tracks.map((track) => {
            const isSelected = subtitleEnabled && (track.id === selectedId || track.selected);
            return (
              <button
                key={track.id}
                className={`track-item-btn ${isSelected ? 'active' : ''}`}
                onClick={() => {
                  onSelectTrack(track.id);
                }}
              >
                <div className="track-item-info">
                  <span className="track-item-title">{formatLanguage(track.language)}</span>
                  <span className="track-item-detail">{track.title||track.label}</span>
                  <div className="track-item-tags">
                    {track.language && <span className="track-badge lang">{track.language.toUpperCase()}</span>}
                    {track.codec && <span className="track-badge">Codec {track.codec}</span>}
                  </div>
                </div>
                {isSelected && (
                  <span className="track-selected-mark">
                    <Icon name="check" size={20}/>
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* External Subtitle Loader */}
        <div className="external-sub-section">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".srt,.vtt,.ass"
            style={{ display: 'none' }}
          />
          <button
            className="external-sub-btn"
            onClick={() => fileInputRef.current?.click()}
          >
            <Icon name="file" size={20}/>
            <span>Load External Subtitle (.srt, .vtt, .ass)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
