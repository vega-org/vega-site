import {CheckIcon,PlaybackSpeedCircleIcon,XMarkIcon} from '@vidstack/react/icons';
export function PlaybackSpeedMenu({rate,onSelect,onClose}:{rate:number;onSelect:(rate:number)=>void;onClose:()=>void}) {
 return <div className="track-modal-overlay" onClick={onClose}><div className="track-modal speed-menu" role="dialog" aria-modal="true" aria-label="Playback speed" onClick={event=>event.stopPropagation()}>
  <div className="track-modal-header"><div className="track-modal-title"><PlaybackSpeedCircleIcon size={22}/><span>Playback speed</span></div><button className="track-close-btn" onClick={onClose} aria-label="Close playback speed menu"><XMarkIcon size={20}/></button></div>
  <div className="track-list" role="radiogroup" aria-label="Playback speed options">{[0.5,0.75,1,1.25,1.5,1.75,2].map(value=><button key={value} role="radio" aria-checked={rate===value} className={`track-item-btn ${rate===value?'active':''}`} onClick={()=>{onSelect(value);onClose();}}><span className="track-item-title">{value===1?'Normal':`${value}x`}</span>{value===1&&<span className="track-item-detail">1x</span>}{rate===value&&<CheckIcon size={20}/>}</button>)}</div>
 </div></div>;
}
