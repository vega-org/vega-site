import {useEffect,useRef} from 'react';
import {startGamepadNavigation} from './gamepadNavigation';
/** DOM geometry keeps remote focus independent of a TV SDK or UI framework. */
export function useRemoteNavigation(onBack:()=>void) {
  const backRef=useRef(onBack);
  useEffect(()=>{backRef.current=onBack;},[onBack]);
  useEffect(()=>{
    const root=document.documentElement;
    const tv=/webos|web0s|tizen|smart-tv|smarttv|android.*tv|aftb|aftm|aftt|vega.?os/i.test(navigator.userAgent);
    root.dataset.navigationMode=root.dataset.navigationMode||(tv?'remote':'pointer');
    const pointer=(event:PointerEvent)=>{
      if(event.pointerType==='mouse'||event.pointerType==='touch')root.dataset.navigationMode='pointer';
    };
    const click=(event:MouseEvent)=>{
      if(root.dataset.navigationMode==='remote')return;
      const button=(event.target as HTMLElement).closest('button');
      queueMicrotask(()=>{if(button===document.activeElement)button?.blur();});
    };
    const gamepad=()=>{root.dataset.navigationMode='remote';};
    document.addEventListener('pointerdown',pointer,true);
    document.addEventListener('click',click,true);
    window.addEventListener('gamepadconnected',gamepad);
    let editing:HTMLElement|null=null;
    let okHeld=false;
    const navigationKeys=new Set<string>();
    const finishEditing=()=>{editing?.removeAttribute('data-remote-editing');editing=null;};
    const focusout=(event:FocusEvent)=>{if(event.target===editing)finishEditing();};
    const keydown=(event:KeyboardEvent)=>{
      if(event.defaultPrevented)return;
      if(event.key==='Select'||event.keyCode===23||tv)root.dataset.navigationMode='remote';
      if(event.key==='Tab')root.dataset.navigationMode='keyboard';
      const active=document.activeElement as HTMLElement|null;
      if(root.dataset.navigationMode!=='remote'&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)&&active?.closest('.video-player-wrapper'))return;
      if(root.dataset.navigationMode!=='remote'&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)&&!document.querySelector('[role="dialog"]'))return;
      const adjustable=!!active?.closest('.cinema-controls')&&active.matches('[role="slider"],input[type="range"],select');
      const isBack=event.key==='Escape'||event.key==='BrowserBack'||[4,10009,461].includes(event.keyCode);
      const isOk=event.key==='Enter'||event.key==='Select'||event.keyCode===23;
      const exitTarget=active?.getAttribute('data-remote-exit');
      if(exitTarget&&(isOk||isBack)){
        navigationKeys.add(event.key);
        event.preventDefault();event.stopPropagation();
        if(isOk){if(okHeld||event.repeat)return;okHeld=true;}
        document.getElementById(exitTarget)?.focus();
        return;
      }
      const button=active?.matches('button:not(:disabled)')&&!active.closest('[inert],[aria-hidden="true"]');
      if(isOk&&(okHeld||adjustable||button)){
        navigationKeys.add(event.key);
        // Opening a menu immediately moves focus. Do not let a held OK press
        // activate its newly focused Close button (native Enter repeats clicks).
        if(okHeld||event.repeat){event.preventDefault();event.stopPropagation();return;}
        okHeld=true;
        // Vidstack buttons listen to keydown, while regular buttons use the
        // browser's Enter activation. Preserve that first press for both kinds.
        if(button&&!adjustable&&event.key==='Enter')return;
        event.preventDefault();event.stopPropagation();
        if(adjustable){if(editing===active)finishEditing();else{finishEditing();editing=active;active!.setAttribute('data-remote-editing','true');}}
        else active!.click();
        return;
      }
      if(adjustable&&isBack&&editing===active){
        navigationKeys.add(event.key);
        event.preventDefault();event.stopPropagation();finishEditing();
        return;
      }
      if(isBack){event.preventDefault();backRef.current();return;}
      if(adjustable&&editing===active)return;
      if(event.key==='Tab') {
        const dialogs=[...document.querySelectorAll<HTMLElement>('[role="dialog"]')];
        const dialog=dialogs[dialogs.length-1];
        if(dialog){const elements=[...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]')].filter(element=>element.getClientRects().length>0&&element.tabIndex!==-1);const index=elements.indexOf(active!);if(event.shiftKey&&index<=0){event.preventDefault();elements[elements.length-1]?.focus();}else if(!event.shiftKey&&(index===elements.length-1||index<0)){event.preventDefault();elements[0]?.focus();}}
        return;
      }
      if(!adjustable&&active?.matches('textarea,select,[contenteditable="true"],input:not([type="range"])'))return;
      if(!adjustable&&active?.matches('input[type="range"],[role="slider"]')&&['ArrowLeft','ArrowRight'].includes(event.key))return;
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
      const dialogs=[...document.querySelectorAll<HTMLElement>('[role="dialog"]')];
      const scope=dialogs[dialogs.length-1]||document;
      const candidates=[...scope.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]')].filter(element=>element.tabIndex!==-1&&element.getClientRects().length>0&&(element===active||!element.contains(active))&&!element.matches('[data-media-player]')&&!element.closest('[aria-hidden="true"],[inert]'));
      if(!candidates.length)return;
      navigationKeys.add(event.key);
      event.preventDefault();event.stopPropagation();
      if(!active||!candidates.includes(active)){candidates[0].focus();return;}
      const r=active.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
      const horizontal=event.key==='ArrowLeft'||event.key==='ArrowRight',direction=event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:1;
      const scored=candidates.filter(element=>element!==active).map(element=>{const box=element.getBoundingClientRect();const dx=box.x+box.width/2-x,dy=box.y+box.height/2-y;return{element,along:(horizontal?dx:dy)*direction,across:Math.abs(horizontal?dy:dx),aligned:horizontal?box.top<r.bottom&&box.bottom>r.top:box.left<r.right&&box.right>r.left};}).filter(item=>item.along>4).sort((a,b)=>Number(b.aligned)-Number(a.aligned)||(a.aligned&&b.aligned?a.along-b.along:(a.along+a.across*3)-(b.along+b.across*3)));
      scored[0]?.element.focus();
    };
    const keyup=(event:KeyboardEvent)=>{
      if(event.key==='Enter'||event.key==='Select'||event.keyCode===23)okHeld=false;
      // Focus changes on keydown. Its keyup arrives at the NEW control, and
      // Vidstack sliders commit an arrow adjustment on keyup even without
      // receiving keydown. Consume both halves of a navigation press.
      if(navigationKeys.delete(event.key)){event.preventDefault();event.stopPropagation();}
    };
    const blur=()=>{okHeld=false;navigationKeys.clear();finishEditing();};
    // Capture before slider/select handlers consume arrows for value changes.
    document.addEventListener('keydown',keydown,true);
    document.addEventListener('keyup',keyup,true);
    document.addEventListener('focusout',focusout,true);
    window.addEventListener('blur',blur);
    const stopGamepad=startGamepadNavigation();
    return()=>{stopGamepad();document.removeEventListener('pointerdown',pointer,true);document.removeEventListener('click',click,true);window.removeEventListener('gamepadconnected',gamepad);finishEditing();document.removeEventListener('keydown',keydown,true);document.removeEventListener('keyup',keyup,true);document.removeEventListener('focusout',focusout,true);window.removeEventListener('blur',blur);};
  },[]);
}
