import {Component, setIcon} from './pomodoro-strip-obsidian-stub';
export {Component, setIcon, Notice, WorkspaceLeaf} from './pomodoro-strip-obsidian-stub';
Object.assign(HTMLElement.prototype, {
  empty(this:HTMLElement){this.replaceChildren();},
  addClass(this:HTMLElement,...names:string[]){this.classList.add(...names);},
  removeClass(this:HTMLElement,...names:string[]){this.classList.remove(...names);},
  toggleClass(this:HTMLElement,name:string,enabled:boolean){this.classList.toggle(name,enabled);},
});
Object.assign(Component.prototype, {
  registerDomEvent(this:Component,element:EventTarget,type:string,listener:EventListener){element.addEventListener(type,listener);this.register(()=>element.removeEventListener(type,listener));},
  registerEvent(){},registerInterval(this:Component,id:number){this.register(()=>window.clearInterval(id));},
});
export class App {}
export class ItemView extends Component {
  contentEl:HTMLElement;app:any;
  constructor(public leaf:any){super();this.contentEl=leaf.contentEl;this.app=leaf.app;}
  addAction(){return document.createElement('button');}
}
export class MarkdownRenderChild extends Component {constructor(public containerEl:HTMLElement){super();}}
export class TFile {path='';basename='';extension='md';stat={mtime:0,size:0};}
export class Modal extends Component {
  modalEl=document.createElement('div');contentEl=document.createElement('div');titleEl=document.createElement('h2');
  constructor(public app:any){super();this.modalEl.append(this.titleEl,this.contentEl);}open(){document.body.append(this.modalEl);this.load();}close(){this.unload();this.modalEl.remove();}
}
export class FuzzySuggestModal extends Modal {}
export class Setting {constructor(public el:any){}}
export class Menu {addItem(callback:(item:any)=>void){const item:any={setTitle(){return item;},setIcon(){return item;},onClick(){return item;}};callback(item);return this;}showAtMouseEvent(){}showAtPosition(){}}
export const MarkdownRenderer={render:async(_app:any,text:string,el:HTMLElement)=>{el.textContent=text;}};
export class Scope {constructor(public parent?:Scope){}register(){}unregister(){}}
