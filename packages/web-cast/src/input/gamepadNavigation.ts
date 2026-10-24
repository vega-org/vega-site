/** Standard browser gamepads share one layout; unknown layouts are not guessed. */
export function startGamepadNavigation():()=>void {
 let frame=0,stopped=false;
 const held=new Map<string,number>();
 const send=(key:string,down:boolean,repeat=false)=>{
  if(down)document.documentElement.dataset.navigationMode='remote';
  const target=document.activeElement instanceof HTMLElement?document.activeElement:document.body;
  const event=new KeyboardEvent(down?'keydown':'keyup',{key,bubbles:true,cancelable:true,repeat});
  target.dispatchEvent(event);
  // Synthetic Enter has no browser default activation. Preserve custom player
  // handlers, then activate an ordinary focused button/link exactly once.
  if(down&&!repeat&&!event.defaultPrevented&&key==='Enter'&&target.matches('button:not(:disabled),a[href]'))target.click();
  if(down&&!event.defaultPrevented&&target instanceof HTMLInputElement&&target.type==='range'&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(key)){
   const direction=key==='ArrowLeft'||key==='ArrowDown'?-1:1;
   const step=Number(target.step)||1;
   target.value=String(Math.max(Number(target.min)||0,Math.min(Number(target.max)||100,Number(target.value)+direction*step)));
   target.dispatchEvent(new Event('input',{bubbles:true}));target.dispatchEvent(new Event('change',{bubbles:true}));
  }
 };
 const release=()=>{for(const key of held.keys())send(key,false);held.clear();};
 const poll=(now:number)=>{
  if(stopped)return;
  const keys=new Set<string>();
  if(!document.hidden&&document.hasFocus()){
   for(const pad of navigator.getGamepads?.()||[]){
    if(!pad?.connected||pad.mapping!=='standard')continue;
    const pressed=(index:number)=>!!pad.buttons[index]?.pressed;
    const x=pad.axes[0]||0,y=pad.axes[1]||0;
    if(pressed(14)||x<-.55)keys.add('ArrowLeft');
    if(pressed(15)||x>.55)keys.add('ArrowRight');
    if(pressed(12)||y<-.55)keys.add('ArrowUp');
    if(pressed(13)||y>.55)keys.add('ArrowDown');
    if(pressed(0))keys.add('Enter');
    if(pressed(1))keys.add('Escape');
   }
  }
  for(const key of held.keys())if(!keys.has(key)){send(key,false);held.delete(key);}
  for(const key of keys){
   const due=held.get(key);
   if(due===undefined){send(key,true);held.set(key,now+400);}
   else if(key.startsWith('Arrow')&&now>=due){send(key,true,true);held.set(key,now+120);}
  }
  frame=requestAnimationFrame(poll);
 };
 frame=requestAnimationFrame(poll);
 window.addEventListener('blur',release);
 return()=>{stopped=true;cancelAnimationFrame(frame);window.removeEventListener('blur',release);release();};
}
