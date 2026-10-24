import {createPortal} from 'react-dom';
import {useEffect,useRef,type ReactNode} from 'react';
import {Icon} from './Icon';
export function FocusDialog({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}){
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(document.documentElement.dataset.navigationMode!=='remote')return;const previous=document.activeElement as HTMLElement|null;(ref.current?.querySelector<HTMLElement>('[data-dialog-primary]')||ref.current?.querySelector<HTMLElement>('button,input'))?.focus();return()=>previous?.focus();},[]);
  const dialog=<div className="dialog-backdrop" onClick={onClose}><div className="focus-dialog" ref={ref} role="dialog" aria-modal="true" aria-label={title} onClick={event=>event.stopPropagation()} onKeyDown={event=>{if(event.key!=='Tab')return;const items=[...ref.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,a[href]')];const index=items.indexOf(document.activeElement as HTMLElement);if(event.shiftKey&&index===0){event.preventDefault();items.at(-1)?.focus();}else if(!event.shiftKey&&index===items.length-1){event.preventDefault();items[0]?.focus();}}}><div className="dialog-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close"/></button></div>{children}</div></div>;
  return document.fullscreenElement?createPortal(dialog,document.fullscreenElement):dialog;
}
