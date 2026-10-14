export {Notice} from './large-calendar-obsidian-stub';
const icons:Record<string,string>={timer:'<circle cx="12" cy="14" r="8"/><path d="M10 2h4M12 10v4m6-8 2-2"/>',coffee:'<path d="M4 8h12v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3zM16 8h2a3 3 0 0 1 0 6h-2M6 2v3m4-3v3m4-3v3"/>',check:'<path d="m5 12 4 4L19 6"/>',play:'<path d="m8 5 11 7-11 7z"/>',pause:'<path d="M8 5v14M16 5v14"/>','arrow-up-right':'<path d="M7 17 17 7M7 7h10v10"/>','arrow-right':'<path d="M4 12h16m-7-7 7 7-7 7"/>','rotate-ccw':'<path d="M3 4v6h6M3 10a9 9 0 1 1 2 8"/>','skip-forward':'<path d="m5 4 10 8-10 8zM19 4v16"/>',armchair:'<path d="M5 10V6a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v4M3 10h4v7h10v-7h4v10H3zM6 20v2m12-2v2"/>'};
Object.assign(icons,{'clock-3':'<circle cx="12" cy="12" r="9"/><path d="M12 6v6h4"/>',hourglass:'<path d="M6 2h12M6 22h12M6 2v5l6 5-6 5v5M18 2v5l-6 5 6 5v5"/>','circle-dot':'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/>','calendar-days':'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18M7 15h2m4 0h2m-8 3h2m4 0h2"/>',minus:'<path d="M5 12h14"/>',plus:'<path d="M5 12h14M12 5v14"/>',square:'<rect x="5" y="5" width="14" height="14" rx="2"/>'});
export function setIcon(el:HTMLElement,name:string){el.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">'+(icons[name]||icons.timer)+'</svg>';el.dataset.icon=name;}
function create(parent:HTMLElement,tag:string,value:any={}){const options=typeof value==='string'?{cls:value}:value;const el=document.createElement(tag);if(options.cls)el.className=options.cls;if(options.text)el.textContent=options.text;if(options.type)el.setAttribute('type',options.type);if(options.value!==undefined)(el as HTMLInputElement).value=String(options.value);for(const[k,v]of Object.entries(options.attr||{}))el.setAttribute(k,String(v));parent.append(el);return el;}
Object.assign(HTMLElement.prototype,{createDiv(this:HTMLElement,o:any){return create(this,'div',o);},createSpan(this:HTMLElement,o:any){return create(this,'span',o);},createEl(this:HTMLElement,t:string,o:any){return create(this,t,o);},setText(this:HTMLElement,t:string){this.textContent=t;}});
export class Component{
 private children=new Set<Component>();private cleanups:(()=>void)[]=[];
 load(){(this as any).onload?.();}unload(){(this as any).onunload?.();for(const child of this.children)child.unload();this.children.clear();for(const cleanup of this.cleanups.splice(0))cleanup();}
 addChild<T extends Component>(child:T){this.children.add(child);child.load();return child;}
 removeChild<T extends Component>(child:T){child.unload();this.children.delete(child);return child;}
 register(cleanup:()=>void){this.cleanups.push(cleanup);}
}
export class WorkspaceLeaf{}
export class ItemView extends Component {contentEl=document.getElementById('root')!;constructor(public leaf:any){super();}}
