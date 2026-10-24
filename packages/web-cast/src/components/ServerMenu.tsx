import {LuServer} from 'react-icons/lu';
import {CheckIcon,XMarkIcon} from '@vidstack/react/icons';
import type {CastServerOption} from '../cast/protocol';
export function ServerMenu({servers,selectedId,onSelect,onClose}:{servers:CastServerOption[];selectedId?:string;onSelect:(id:string)=>void;onClose:()=>void}){
 return <div className="track-modal-overlay" onClick={onClose}><div className="track-modal" role="dialog" aria-modal="true" aria-label="Servers" onClick={event=>event.stopPropagation()}>
  <div className="track-modal-header"><div className="track-modal-title"><LuServer size={22}/><span>Server</span></div><button className="track-close-btn" aria-label="Close server menu" onClick={onClose}><XMarkIcon size={20}/></button></div>
  <div className="track-list">{servers.map(server=><button key={server.id} className={`track-item-btn ${selectedId===server.id?'active':''}`} onClick={()=>{onSelect(server.id);onClose();}}><div className="track-item-info"><span className="track-item-title">{server.name}</span><span className="track-item-detail">{[server.quality,...server.tags||[]].filter(Boolean).join(' · ')}</span></div>{selectedId===server.id&&<CheckIcon size={20}/>}</button>)}</div>
 </div></div>;
}
