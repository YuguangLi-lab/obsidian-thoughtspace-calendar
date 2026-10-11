/** Restore a rebuilt task filter only while focus is still vacant. */
export function preserveTaskFilterFocus(root:HTMLElement){
 const doc=root.ownerDocument,active=doc.activeElement as HTMLInputElement|HTMLSelectElement|null;
 if(!active||!root.contains(active)||!active.matches('.ts-task-tools input,.ts-task-tools select,.ts-task-group-select'))return ()=>{};
 const label=active.getAttribute('aria-label'),tag=active.tagName;
 const start=tag==='INPUT'?(active as HTMLInputElement).selectionStart:null,end=tag==='INPUT'?(active as HTMLInputElement).selectionEnd:null;
 const direction=tag==='INPUT'?(active as HTMLInputElement).selectionDirection:null;
 return ()=>{
  if(!label||active.isConnected||doc.activeElement!==doc.body)return;
  const next=Array.from(root.querySelectorAll<HTMLInputElement|HTMLSelectElement>('input[aria-label],select[aria-label]')).find(el=>el.tagName===tag&&el.getAttribute('aria-label')===label);
  if(!next||next.disabled||next.closest('details:not([open])')||!next.getClientRects().length)return;
  next.focus({preventScroll:true});if(tag==='INPUT'&&start!==null&&end!==null)(next as HTMLInputElement).setSelectionRange(start,end,direction||undefined);
 };
}

/** Keep keyboard navigation in the task list after a completed row disappears. */
export function preserveTaskRowFocus(root:HTMLElement,rowSelector='.ts-task-row',fallbackSelector='button[data-filter][aria-pressed=true]'){
 const doc=root.ownerDocument,active=doc.activeElement as HTMLElement|null;
 const row=active?.closest<HTMLElement>(rowSelector);
 if(!active||!row||!root.contains(row))return ()=>{};
 const rows=Array.from(root.querySelectorAll<HTMLElement>(rowSelector));
 const index=rows.indexOf(row),path=row.dataset.path,line=row.dataset.line;
 const label=active.getAttribute('aria-label'),checkbox=active.matches('input[type=checkbox]');
 return ()=>{
  // Never steal focus from an editor or another control the user has chosen.
  if(active.isConnected||doc.activeElement!==doc.body)return;
  const current=Array.from(root.querySelectorAll<HTMLElement>(rowSelector));
  const nextRow=current.find(el=>el.dataset.path===path&&el.dataset.line===line)||current[Math.min(index,current.length-1)];
  let next:HTMLElement|undefined;
  if(checkbox)next=nextRow?.querySelector<HTMLInputElement>('input[type=checkbox]:not(:disabled)')||undefined;
  else if(label)next=Array.from(nextRow?.querySelectorAll<HTMLElement>('[aria-label]')||[]).find(el=>el.getAttribute('aria-label')===label&&!el.matches(':disabled'));
  next??=root.querySelector<HTMLButtonElement>(fallbackSelector)||undefined;
  if(next?.getClientRects().length)next.focus({preventScroll:true});
 };
}
