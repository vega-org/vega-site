import {CheckIcon,XMarkIcon} from '@vidstack/react/icons';
import type {VideoQuality} from '../core/playback-state';
export function QualityMenu({qualities,selected,onSelect,onClose}:{qualities:VideoQuality[];selected:number|null;onSelect:(id:number)=>void;onClose:()=>void}){
 return <div className="track-modal-overlay" onClick={onClose}><div className="track-modal" role="dialog" aria-modal="true" aria-label="Video quality" onClick={event=>event.stopPropagation()}>
  <div className="track-modal-header"><div className="track-modal-title">Quality</div><button className="track-close-btn" onClick={onClose} aria-label="Close quality menu"><XMarkIcon size={20}/></button></div>
  <div className="track-list" role="radiogroup" aria-label="Video quality options">{qualities.map(quality=><button key={quality.id} role="radio" aria-checked={selected===quality.id} className={`track-item-btn ${selected===quality.id?'active':''}`} onClick={()=>{onSelect(quality.id);onClose();}}><span className="track-item-title">{quality.label}</span><span className="track-item-detail">{[quality.width&&quality.height?`${quality.width} × ${quality.height}`:'',quality.bandwidth?`${(quality.bandwidth/1e6).toFixed(1)} Mbps`:'',quality.frameRate?`${quality.frameRate} fps`:''].filter(Boolean).join(' · ')}</span>{selected===quality.id&&<CheckIcon size={20}/>}</button>)}</div>
 </div></div>;
}
