import {Icon} from './Icon';
import React from 'react';
import type { MediaTrack } from '../core/media';
import {formatLanguage} from '../utils/formatters';

interface AudioTrackMenuProps {
  tracks: MediaTrack[];
  selectedId: number | null;
  onSelectTrack: (trackId: number) => void;
  onClose: () => void;
}

export const AudioTrackMenu: React.FC<AudioTrackMenuProps> = ({
  tracks,
  selectedId,
  onSelectTrack,
  onClose,
}) => {
  return (
    <div className="track-modal-overlay" onClick={onClose}>
      <div className="track-modal" role="dialog" aria-modal="true" aria-label="Audio tracks" onClick={(e) => e.stopPropagation()}>
        <div className="track-modal-header">
          <div className="track-modal-title">
            <Icon name="audio" size={20}/>
            <span>Audio Tracks ({tracks.length})</span>
          </div>
          <button className="track-close-btn" onClick={onClose} aria-label="Close audio tracks menu">
            <Icon name="close" size={18}/>
          </button>
        </div>

        <div className="track-list">
          {tracks.length === 0 ? (
            <div className="track-empty-state">No audio tracks detected</div>
          ) : (
            tracks.map((track) => {
              const isSelected = track.id === selectedId || track.selected;
              return (
                <button
                  key={track.id}
                  className={`track-item-btn ${isSelected ? 'active' : ''}`}
                  onClick={() => {
                    onSelectTrack(track.id);
                    onClose();
                  }}
                >
                  <div className="track-item-info">
                    <span className="track-item-title">{formatLanguage(track.language)}</span>
                    <span className="track-item-detail">{track.title||track.label}</span>
                    <div className="track-item-tags">
                      {track.language && <span className="track-badge lang">{track.language.toUpperCase()}</span>}
                      {track.channels && <span className="track-badge">{track.channels} channels</span>}
                      {track.sampleRate && <span className="track-badge">{Math.round(track.sampleRate / 1000)} kHz</span>}
                    </div>
                  </div>
                  {isSelected && (
                    <span className="track-selected-mark">
                      <Icon name="check" size={20}/>
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
