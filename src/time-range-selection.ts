import {clockLabel} from './task-time';
export type SelectedTimeRange={start:number;end:number};
const clamp=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,value));
export function timeRangeMinute(x:number,left:number,width:number):number {
 if(![x,left,width].every(Number.isFinite)||width<=0)throw Error('时间选择范围无效');
 return clamp(Math.round((x-left)/width*1440/15)*15,0,1440);
}
export function draggedTimeRange(anchor:number,current:number):SelectedTimeRange {
 if(![anchor,current].every(Number.isFinite))throw Error('时间选择无效');
 const start=clamp(Math.min(anchor,current),0,1425),end=clamp(Math.max(anchor,current),0,1439);
 return {start,end:end>start?end:Math.min(1439,start+30)};
}
export function parseTimeMinute(value:string):number|undefined {
 const match=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);return match?Number(match[1])*60+Number(match[2]):undefined;
}
export type TimeRangeControl={refresh():void;destroy():void};

/** Preview locally during the gesture. Native time inputs change only on release. */
export function mountTimeRangePicker(parent:HTMLElement,start:HTMLInputElement,end:HTMLInputElement,bindEscape?:(cancel:()=>void)=>()=>void):TimeRangeControl {
 const document=parent.ownerDocument;
 const create=(tag:string,cls:string,text?:string)=>{const el=document.createElement(tag);el.className=cls;if(text)el.textContent=text;return el;};
 const root=create('div','ts-time-range-picker'),heading=create('div','ts-time-range-heading'),caption=create('span','ts-time-range-caption','拖动选择时间'),summary=create('span','ts-time-range-summary');
 heading.append(caption,summary);root.append(heading);
 const track=create('div','ts-time-range-track');track.setAttribute('aria-label','拖动选择具体时间');
 const selection=create('div','ts-time-range-selection');track.append(selection);
 const handles=([['start','开始时间'],['end','结束时间']] as const).map(([edge,label])=>{const handle=create('button','ts-time-range-handle') as HTMLButtonElement;handle.type='button';handle.dataset.edge=edge;handle.setAttribute('role','slider');handle.setAttribute('aria-label',label);handle.setAttribute('aria-valuemin','0');handle.setAttribute('aria-valuemax','1439');track.append(handle);return handle;});
 root.append(track);const ticks=create('div','ts-time-range-ticks');for(const hour of [0,6,12,18,24])ticks.append(create('span','',String(hour).padStart(2,'0')+':00'));root.append(ticks);parent.append(root);
 let preview:SelectedTimeRange|undefined,gesture:{pointer:number;anchor:number;edge?:'start'|'end';win:Window}|undefined,destroyed=false,releaseEscape:(()=>void)|undefined,migrationObserver:MutationObserver|undefined;
 const current=()=>{const from=parseTimeMinute(start.value),to=parseTimeMinute(end.value);return from===undefined?undefined:{start:from,end:to!==undefined&&to>from?to:Math.min(1439,from+30)};};
 const paint=()=>{
  if(destroyed)return;const range=preview||current();selection.hidden=!range;handles.forEach(handle=>handle.hidden=!range);
  summary.textContent=range?`${clockLabel(range.start)} – ${clockLabel(range.end)} · ${range.end-range.start} 分钟`:'00:00 – 24:00';
  if(!range)return;selection.style.left=range.start/1440*100+'%';selection.style.width=(range.end-range.start)/1440*100+'%';
  handles.forEach((handle,i)=>{const minute=i?range.end:range.start;handle.style.left=minute/1440*100+'%';handle.setAttribute('aria-valuenow',String(minute));handle.setAttribute('aria-valuetext',clockLabel(minute));handle.disabled=start.disabled||end.disabled;});
 };
 const commit=(range:SelectedTimeRange)=>{
  const values=[clockLabel(range.start),clockLabel(range.end)],inputs=[start,end],changed=inputs.filter((input,i)=>input.value!==values[i]);
  inputs.forEach((input,i)=>input.value=values[i]);
  for(const input of changed){const event=input.ownerDocument.createEvent('Event');event.initEvent('input',true,false);input.dispatchEvent(event);}paint();
 };
 const cleanup=()=>{
  const previous=gesture;gesture=undefined;preview=undefined;const release=releaseEscape;releaseEscape=undefined;const observer=migrationObserver;migrationObserver=undefined;
  try{release?.();}finally{
   observer?.disconnect();root.classList.remove('is-selecting');const win=previous?.win;
   win?.removeEventListener('pointermove',move);win?.removeEventListener('pointerup',up);win?.removeEventListener('pointercancel',cancel);win?.removeEventListener('blur',cancel);win?.removeEventListener('keydown',escape,true);
   if(previous)try{if(track.hasPointerCapture?.(previous.pointer))track.releasePointerCapture(previous.pointer);}catch{/* The owning window may already have closed. */}
  }
 };
 const cancel=(event?:Event)=>{if((event?.type==='pointercancel'||event?.type==='lostpointercapture')&&gesture&&(event as PointerEvent).pointerId!==gesture.pointer)return;cleanup();paint();};
 const escape=(event:KeyboardEvent)=>{if(event.key!=='Escape'||!gesture)return;event.preventDefault();event.stopPropagation();cancel();};
 const position=(event:PointerEvent)=>{if(gesture&&gesture.win!==track.ownerDocument.defaultView)return;const box=track.getBoundingClientRect();if(![event.clientX,box.left,box.width].every(Number.isFinite)||box.width<=0)return;return timeRangeMinute(event.clientX,box.left,box.width);};
 const move=(event:PointerEvent)=>{if(!gesture||event.pointerId!==gesture.pointer)return;event.preventDefault();const at=position(event);if(at===undefined){cancel();return;}const old=preview||current();
  preview=gesture.edge&&old?gesture.edge==='start'?{start:Math.min(at,old.end-1),end:old.end}:{start:old.start,end:clamp(at,old.start+1,1439)}:draggedTimeRange(gesture.anchor,at);paint();};
 const up=(event:PointerEvent)=>{if(!gesture||event.pointerId!==gesture.pointer)return;move(event);if(!gesture)return;const range=preview;cleanup();if(range)commit(range);else paint();};
 const down=(event:PointerEvent)=>{if(gesture&&gesture.win!==track.ownerDocument.defaultView)cancel();if(destroyed||gesture||event.isPrimary===false||event.button!==0||start.disabled||end.disabled)return;const box=track.getBoundingClientRect();if(box.width<=0)return;
  const anchor=position(event);if(anchor===undefined)return;event.preventDefault();const target=event.target as HTMLElement,edge=target.closest<HTMLElement>('.ts-time-range-handle')?.dataset.edge as 'start'|'end'|undefined;
  const win=track.ownerDocument.defaultView;if(!win)return;
  gesture={pointer:event.pointerId,anchor,edge,win};preview=edge?current():draggedTimeRange(anchor,anchor);root.classList.add('is-selecting');paint();releaseEscape=bindEscape?.(cancel);
  win.addEventListener('pointermove',move);win.addEventListener('pointerup',up);win.addEventListener('pointercancel',cancel);win.addEventListener('blur',cancel);win.addEventListener('keydown',escape,true);
  // Adoption can happen before the browser establishes pointer capture. Observe
  // only while selecting; idle controls never watch workspace DOM mutations.
  const Observer=win.MutationObserver;if(Observer){migrationObserver=new Observer(()=>{if(gesture&&(gesture.win!==track.ownerDocument.defaultView||root.isConnected===false))cancel();});migrationObserver.observe(track.ownerDocument,{childList:true,subtree:true});}
  try{track.setPointerCapture?.(event.pointerId);}catch{/* Synthetic pointers and a closing window can have no active pointer. */}
 };
 const input=()=>{if(gesture)cleanup();paint();};
 const keyboard=(event:KeyboardEvent)=>{const target=event.target as HTMLElement,edge=target.dataset.edge,range=current();if(!range||!edge||start.disabled||end.disabled)return;
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;event.preventDefault();const step=event.shiftKey?1:15,direction=['ArrowLeft','ArrowDown'].includes(event.key)?-1:1;
  const value=event.key==='Home'?0:event.key==='End'?1439:(edge==='start'?range.start:range.end)+direction*step;
  commit(edge==='start'?{start:clamp(value,0,range.end-1),end:range.end}:{start:range.start,end:clamp(value,range.start+1,1439)});
 };
 track.addEventListener('pointerdown',down);track.addEventListener('lostpointercapture',cancel);track.addEventListener('keydown',keyboard);start.addEventListener('input',input);end.addEventListener('input',input);paint();
 return {refresh:input,destroy(){if(destroyed)return;cleanup();destroyed=true;track.removeEventListener('pointerdown',down);track.removeEventListener('lostpointercapture',cancel);track.removeEventListener('keydown',keyboard);start.removeEventListener('input',input);end.removeEventListener('input',input);root.remove();}};
}
