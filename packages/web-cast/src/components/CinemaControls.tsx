import {PlayButton,SeekButton,MuteButton,TimeSlider,VolumeSlider} from '@vidstack/react';
import {LuServer} from 'react-icons/lu';
import {PlayIcon,PauseIcon,SeekBackward10Icon,SeekForward10Icon,VolumeHighIcon,MuteIcon,MusicIcon,ClosedCaptionsIcon,FullscreenIcon,FullscreenExitIcon,InfoIcon} from '@vidstack/react/icons';
import type {PlaybackState} from '../core/playback-state';
import {formatTime} from '../utils/formatters';
interface ControlsProps {
 state:PlaybackState;onOpenSpeedMenu:()=>void;
 onOpenServerMenu?:()=>void;changingServer?:boolean;
 onOpenAudioMenu:()=>void;onOpenSubtitleMenu:()=>void;onOpenDiagnostics:()=>void;onToggleFullscreen:()=>void;isFullscreen:boolean;
}
export function CinemaControls(props:ControlsProps){
 const {state}=props;
 const playing=state.status==='playing'||state.status==='buffering';
 return <div className="cinema-controls">
  <div className="timeline-row"><TimeSlider.Root className="vega-slider cinema-timeline" aria-label="Playback position" keyStep={5} shiftKeyMultiplier={2}><TimeSlider.Track className="vega-slider-track"/><TimeSlider.TrackFill className="vega-slider-fill"/><TimeSlider.Progress className="vega-slider-buffer"/><TimeSlider.Thumb className="vega-slider-thumb"/><TimeSlider.Preview className="vega-slider-preview"><TimeSlider.Value/></TimeSlider.Preview></TimeSlider.Root></div>
  <div className="playback-toolbar">
   <PlayButton className="icon-button primary-play" data-primary-play aria-label={playing?'Pause':'Play'}>{playing?<PauseIcon size={26}/>:<PlayIcon size={26}/>}</PlayButton>
   <SeekButton seconds={-10} className="icon-button" aria-label="Back 10 seconds"><SeekBackward10Icon size={24}/></SeekButton>
   <SeekButton seconds={10} className="icon-button" aria-label="Forward 10 seconds"><SeekForward10Icon size={24}/></SeekButton>
   <div className="volume-control"><MuteButton className="icon-button" aria-label={state.isMuted?'Unmute':'Mute'}>{state.isMuted?<MuteIcon size={22}/>:<VolumeHighIcon size={22}/>}</MuteButton><VolumeSlider.Root className="vega-slider vega-volume-slider" aria-label="Volume"><VolumeSlider.Track className="vega-slider-track"/><VolumeSlider.TrackFill className="vega-slider-fill"/><VolumeSlider.Thumb className="vega-slider-thumb"/></VolumeSlider.Root></div>
   <span className="playback-clock">{formatTime(state.currentTime)} <span>/ {formatTime(state.duration)}</span></span><div className="toolbar-spacer"/>
   {props.onOpenServerMenu&&<button className="text-icon-button" aria-label="Change server" aria-haspopup="dialog" disabled={props.changingServer} onClick={props.onOpenServerMenu}><LuServer size={22}/><span>{props.changingServer?'Changing…':'Server'}</span></button>}
   <button className="text-icon-button" onClick={props.onOpenAudioMenu} aria-label="Audio tracks"><MusicIcon size={22}/><span>Audio</span></button>
   <button className={`text-icon-button ${state.selectedSubtitleTrackId!==null&&state.subtitleEnabled?'selected':''}`} onClick={props.onOpenSubtitleMenu} aria-label="Subtitles"><ClosedCaptionsIcon size={22}/><span>Subtitles</span></button>
   <button className="text-icon-button speed-control" aria-label="Playback speed" aria-haspopup="dialog" onClick={props.onOpenSpeedMenu}>{state.playbackRate}x</button>
   <button className="icon-button diagnostics-button" onClick={props.onOpenDiagnostics} aria-label="Playback diagnostics"><InfoIcon size={22}/></button>
   <button className="icon-button" onClick={props.onToggleFullscreen} aria-label={props.isFullscreen?'Exit fullscreen':'Fullscreen'}>{props.isFullscreen?<FullscreenExitIcon size={22}/>:<FullscreenIcon size={22}/>}</button>
  </div>
  <p className="remote-control-hint">Arrows move between controls. OK to adjust. OK or Back to finish.</p>
 </div>;
}
