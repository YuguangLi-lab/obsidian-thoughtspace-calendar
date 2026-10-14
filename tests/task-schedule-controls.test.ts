import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {planTasks} from '../src/task-planner-model';

class ElementStub extends EventTarget {
 children:ElementStub[]=[];style:any={};dataset:any={};className='';textContent='';hidden=false;disabled=false;value='';type='';attrs=new Map<string,string>();
 onsubmit?:((event:any)=>any);onclick?:((event?:any)=>any);oninput?:((event?:any)=>any);
 constructor(public ownerDocument:any,public tagName='div'){super();}
 classList={add:(...names:string[])=>this.addClass(...names),remove:()=>{}};
 append(...children:ElementStub[]){this.children.push(...children);}
 createEl(tag:string,args:any={}){const el=new ElementStub(this.ownerDocument,tag);el.className=args.cls||'';el.textContent=args.text||'';el.type=args.type||'';el.value=args.value||'';for(const [name,value]of Object.entries(args.attr||{}))el.setAttribute(name,String(value));this.append(el);return el;}
 createDiv(args:any={}){return this.createEl('div',typeof args==='string'?{cls:args}:args);}
 createSpan(args:any={}){return this.createEl('span',typeof args==='string'?{cls:args}:args);}
 addClass(...names:string[]){this.className=[this.className,...names].filter(Boolean).join(' ');}
 setAttribute(name:string,value:string){this.attrs.set(name,value);}
 setText(text:string){this.textContent=text;}
 empty(){this.children=[];this.textContent='';}
 querySelectorAll(selector:string):ElementStub[]{const match=(el:ElementStub)=>selector.split(',').some(part=>part.startsWith('.')?el.className.split(' ').includes(part.slice(1)):el.tagName===part);return this.children.flatMap(child=>[...(match(child)?[child]:[]),...child.querySelectorAll(selector)]);}
 contains(el:ElementStub):boolean{return this===el||this.children.some(child=>child.contains(el));}
 getBoundingClientRect(){return {left:0,width:240};}
 closest(selector:string){return this.className===selector.slice(1)?this:null;}
 remove(){}
 focus(){this.ownerDocument.activeElement=this;}
 dispatchEvent(event:Event){const result=super.dispatchEvent(event);if(event.type==='input')this.oninput?.(event);return result;}
}
function moduleHost(entry:string){
 const win:any=new EventTarget();win.Event=Event;const document:any={defaultView:win,querySelector:()=>null,createEvent:()=>{const event:any=new Event('input',{bubbles:true});event.initEvent=()=>{};return event;}};document.createElement=(tag:string)=>new ElementStub(document,tag);
 class Modal {modalEl=new ElementStub(document);contentEl=new ElementStub(document);titleEl=new ElementStub(document);scope={};didClose=false;constructor(public app:any){}open(){(this as any).onOpen?.();}close(){this.didClose=true;(this as any).onClose?.();}setTitle(text:string){this.titleEl.setText(text);}}
 class Scope{register(){}}
 const code=buildSync({entryPoints:[entry],bundle:true,write:false,format:'cjs',platform:'node',external:['obsidian']}).outputFiles[0].text,module={exports:{} as any};
 new Function('require','module','exports',code)((id:string)=>{if(id==='obsidian')return{Modal,Scope};throw Error(id);},module,module.exports);
 const app={keymap:{pushScope(){},popScope(){}}};return {module:module.exports,app,win};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const original=()=>planTasks('- [ ] 09:07 - 10:07 Read #work ⏳ 2026-10-11 ^reading','Tasks.md','Journal')[0];
const submit=(form:ElementStub)=>form.onsubmit!({preventDefault(){}});
function sideModal(update:()=>Promise<any>){const host=moduleHost('src/task-schedule-view.ts'),modal=new host.module.TaskScheduleModal(host.app,{all:()=>[original()],update},original(),'2026-10-11');modal.open();const form=modal.contentEl.querySelectorAll('form')[0] as ElementStub;return {...host,modal,form,inputs:form.querySelectorAll('input'),buttons:form.querySelectorAll('button')};}

test('side-task schedule failure stays visible and preserves editable exact minutes',async()=>{
 const h=sideModal(async()=>{throw Error('保存失败：文件已变化');});h.inputs.find(input=>input.attrs.get('aria-label')==='开始时间')!.value='11:13';h.inputs.find(input=>input.attrs.get('aria-label')==='结束时间（可选）')!.value='12:29';
 submit(h.form);await tick();assert.equal(h.modal.didClose,false);assert.equal(h.form.querySelectorAll('.ts-schedule-error')[0].textContent,'保存失败：文件已变化');assert.equal(h.inputs.every(input=>!input.disabled),true);
 assert.equal(h.inputs.find(input=>input.attrs.get('aria-label')==='开始时间')!.value,'11:13');h.modal.close();
});
test('fifty task forms reject duplicate submission during a pending save and close once',async()=>{
 for(let i=0;i<50;i++){let count=0,release!:()=>void;const pending=new Promise<void>(resolve=>release=resolve),h=sideModal(async()=>{count++;await pending;});submit(h.form);submit(h.form);assert.equal(count,1);assert.equal(h.inputs.every(input=>input.disabled),true);assert.equal(h.form.querySelectorAll('.ts-time-range-handle').every(handle=>handle.disabled),true);release();await tick();assert.equal(h.modal.didClose,true);}
});
test('calendar-task schedule failure and retry do not duplicate a successful write',async()=>{
 const host=moduleHost('src/calendar-task-modal.ts');let attempts=0,writes=0,changed=0;
 const modal=new host.module.CalendarTaskScheduleModal({app:host.app,scheduleTask:async()=>{attempts++;if(attempts===1)throw Error('暂时无法保存');writes++;},changed(){changed++;}}, {text:'Read',date:'2026-10-11',source:'Tasks.md',startMinute:547,endMinute:607},new Date(2026,9,11));modal.open();
 const form=modal.contentEl.querySelectorAll('form')[0] as ElementStub;await submit(form);assert.equal(form.querySelectorAll('.tsc-error')[0].textContent,'暂时无法保存');assert.equal(form.querySelectorAll('input').every(input=>!input.disabled),true);
 await submit(form);assert.equal(attempts,2);assert.equal(writes,1);assert.equal(changed,1);assert.equal(modal.didClose,true);
});
