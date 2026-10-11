function create(parent:HTMLElement,tag:string,options:any={}) {
  const el=document.createElement(tag);
  if(options.cls) el.className=options.cls;
  if(options.text) el.textContent=options.text;
  if(options.type) (el as HTMLInputElement).type=options.type;
  if(options.value) (el as HTMLInputElement).value=options.value;
  if(options.placeholder) (el as HTMLInputElement).placeholder=options.placeholder;
  for(const [key,value] of Object.entries(options.attr??{})) el.setAttribute(key,String(value));
  parent.append(el); return el;
}
Object.assign(HTMLElement.prototype,{
  empty(){this.replaceChildren();},
  createDiv(options:any){return create(this,'div',options);},
  createSpan(options:any){return create(this,'span',options);},
  createEl(tag:string,options:any){return create(this,tag,options);},
  addClass(...names:string[]){this.classList.add(...names);},
  toggleClass(name:string,enabled:boolean){this.classList.toggle(name,enabled);}
});
export class App {}
export class WorkspaceLeaf {}
export class ItemView {
  contentEl=document.getElementById('root')!;
  cleanups:(()=>void)[]=[];
  constructor(public leaf:any){}
  register(fn:()=>void){this.cleanups.push(fn);}
  registerDomEvent(target:any,type:string,listener:any){target.addEventListener(type,listener);this.register(()=>target.removeEventListener(type,listener));}
}
export class Modal {
  modalEl:HTMLElement; contentEl:HTMLElement;
  constructor(public app:any){this.modalEl=create(document.body,'div',{cls:'modal'});this.modalEl.setAttribute('role','dialog');this.contentEl=create(this.modalEl,'div',{cls:'modal-content'});}
  setTitle(text:string){const title=document.createElement('h2');title.textContent=text;this.modalEl.prepend(title);}
  open(){(this as any).onOpen?.();}
  close(){(this as any).onClose?.();this.modalEl.remove();}
}
export class Notice {constructor(message:string){(window as any).lastNotice=message;}}
// Small independent outline drawings for the isolated preview; production uses Obsidian icons.
const previewIcons:Record<string,string>={
 'chevron-left':'<path d="m14 6-6 6 6 6"/>',
 'chevron-right':'<path d="m10 6 6 6-6 6"/>',
 'plus':'<path d="M12 5v14M5 12h14"/>',
 'circle':'<circle cx="12" cy="12" r="8"/>',
 'circle-check':'<circle cx="12" cy="12" r="8"/><path d="m8 12 3 3 5-6"/>',
 'clock':'<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
 'link':'<path d="m9 15 6-6M8 13l-2 2a3 3 0 0 0 4 4l3-3M16 11l2-2a3 3 0 0 0-4-4l-3 3"/>',
 'file-text':'<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6"/>',
 'file-plus-2':'<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 15h6M12 12v6"/>',
 'refresh-cw':'<path d="M19 9a8 8 0 1 0 0 6M19 3v6h-6"/>',
 'calendar-cog':'<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4m8-4v4M4 10h16"/><circle cx="12" cy="15" r="2"/>',
 'calendar-range':'<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4m8-4v4M4 10h16M8 15h8"/>',
 'settings':'<circle cx="12" cy="12" r="4"/><path d="M12 3v3m0 12v3M3 12h3m12 0h3M6 6l2 2m8 8 2 2M6 18l2-2m8-8 2-2"/>'
};
export function setIcon(el:HTMLElement,name:string){el.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">'+(previewIcons[name]??'<path d="M4 6h16M4 12h16M4 18h16"/>')+'</svg>';el.dataset.icon=name;}
