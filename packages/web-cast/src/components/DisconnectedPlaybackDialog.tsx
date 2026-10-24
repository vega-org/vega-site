import {FocusDialog} from './FocusDialog';
export function DisconnectedPlaybackDialog({onContinue,onClose}:{onContinue:()=>void;onClose:()=>void}){
 return <FocusDialog title="Mobile disconnected" onClose={onContinue}><p className="dialog-description">Continue watching on this screen?</p><div className="dialog-actions"><button data-dialog-primary className="accent-button" onClick={onContinue}>Continue watching</button><button className="quiet-button" onClick={onClose}>Close playback</button></div></FocusDialog>;
}
