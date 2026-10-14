import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {planTasks} from '../src/task-planner-model';
const code=buildSync({entryPoints:['src/day-timeline-view.ts'],bundle:true,write:false,format:'cjs',platform:'node',external:['obsidian']}).outputFiles[0].text;
function transfer(){const values=new Map<string,string>();return {effectAllowed:'none',dropEffect:'none',get types(){return [...values.keys()];},setData:(type:string,value:string)=>values.set(type,value),getData:(type:string)=>values.get(type)||''};}
function timeline(source='- [ ] 09:07 - 10:07 Read #work ⏳ 2026-10-11 ^read'){
 const module={exports:{} as any},notices:string[]=[];class Base{};class Notice{constructor(text:string){notices.push(text);}}
 new Function('require','module','exports',code)((id:string)=>{if(id==='obsidian')return new Proxy({Notice,setIcon(){}},{get:(target,key)=>Reflect.get(target,key)||Base});throw Error(id);},module,module.exports);
 const rows:any[]=[];let tasks=planTasks(source,'Tasks.md','Journal'),renders=0;const calls:any[]=[];
 const el:any={addClass(){},removeClass(){},empty(){},querySelectorAll:()=>[],ownerDocument:{defaultView:globalThis}},view=Object.create(module.exports.DayTimeline.prototype);
 Object.assign(view,{app:{},el,body:el,active:true,day:'2026-10-11',planner:{ready:async()=>{},all:()=>tasks,update:async(task:any,change:any)=>calls.push({task,change})},renderContents:()=>renders++,preserveFocus:()=>()=>{}});
 const row:any={draggable:false,title:'',addClass(){},removeClass(){},hasClass:()=>false,contains:()=>false,createSpan:()=>({remove(){},setText(){}})};rows.push(row);
 return {view,row,tasks:()=>tasks,setTasks:(text:string)=>tasks=planTasks(text,'Tasks.md','Journal'),calls,notices,renders:()=>renders};
}
const event=(data:any)=>({dataTransfer:data,target:{closest:()=>null},preventDefault(){},stopPropagation(){}});
test('timeline task drags use an opaque calendar token and reject completed or interactive sources',()=>{
 const h=timeline();h.view.bindTaskDrag(h.row,h.tasks()[0]);assert.equal(h.row.draggable,true);const data=transfer();h.row.onpointerdown(event(data));h.row.ondragstart(event(data));
 assert.match(data.getData('application/x-thoughtspace-calendar-task'),/^[\da-f-]{36}$/);assert.equal(data.types.length,1);assert.equal(h.view.dragging,true);
 h.row.ondragend(event(data));assert.equal(h.view.dragging,false);
 const done=timeline('- [x] Done ⏳ 2026-10-11');done.view.bindTaskDrag(done.row,done.tasks()[0]);assert.equal(done.row.draggable,false);
 const interactive=timeline();interactive.view.bindTaskDrag(interactive.row,interactive.tasks()[0]);interactive.row.onpointerdown({...event(data),target:{closest:()=>({})}});let prevented=false;
 interactive.row.ondragstart({...event(transfer()),preventDefault(){prevented=true;}});assert.equal(prevented,true);
});
test('timeline drop preserves source duration and block metadata via the current index',async()=>{
 const h=timeline(),data=transfer();h.view.bindTaskDrag(h.row,h.tasks()[0]);h.row.onpointerdown(event(data));h.row.ondragstart(event(data));const target={...h.row};h.view.bindDropTarget(target,660);
 target.ondrop(event(data));await new Promise(resolve=>setImmediate(resolve));assert.equal(h.calls.length,1);assert.equal(h.calls[0].task.source,h.tasks()[0].source);assert.deepEqual(h.calls[0].change,{scheduled:'2026-10-11',time:{start:'11:00',end:'12:00'}});
});
test('untimed drops use thirty minutes and stale source drops never write a replacement task',async()=>{
 const h=timeline('- [ ] Read ⏳ 2026-10-11'),data=transfer();h.view.bindTaskDrag(h.row,h.tasks()[0]);h.row.onpointerdown(event(data));h.row.ondragstart(event(data));const target={...h.row};h.view.bindDropTarget(target,720);target.ondrop(event(data));await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(h.calls[0].change.time,{start:'12:00',end:'12:30'});
 const stale=timeline(),old=transfer();stale.view.bindTaskDrag(stale.row,stale.tasks()[0]);stale.row.onpointerdown(event(old));stale.row.ondragstart(event(old));stale.setTasks('- [ ] Replacement ⏳ 2026-10-11');const other={...stale.row};stale.view.bindDropTarget(other,720);other.ondrop(event(old));await new Promise(resolve=>setImmediate(resolve));assert.equal(stale.calls.length,0);assert.match(stale.notices.join(' '),/原文已变化/);
});
test('task-index notifications defer redraw while a source gesture is active',()=>{
 const h=timeline(),data=transfer();h.view.bindTaskDrag(h.row,h.tasks()[0]);h.row.onpointerdown(event(data));h.row.ondragstart(event(data));h.view.render();assert.equal(h.renders(),0);assert.equal(h.view.deferredRender,true);h.row.ondragend(event(data));assert.equal(h.renders(),1);
});
test('a pending timeline drop batches prior and index refreshes until the save settles',async()=>{
 const h=timeline();let release!:()=>void;const waiting=new Promise<void>(resolve=>release=resolve);
 h.view.planner.update=async()=>{h.view.render();h.view.render();await waiting;};
 const data=transfer();h.view.bindTaskDrag(h.row,h.tasks()[0]);h.row.onpointerdown(event(data));h.row.ondragstart(event(data));h.view.render();const target={...h.row};h.view.bindDropTarget(target,660);target.ondrop(event(data));
 await new Promise(resolve=>setImmediate(resolve));assert.equal(h.view.dropSaving,true);assert.equal(h.renders(),0);release();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.view.dropSaving,false);assert.equal(h.renders(),1);
});
test('unloading a second timeline cannot invalidate the active source token',async()=>{
 const h=timeline(),data=transfer();h.view.bindTaskDrag(h.row,h.tasks()[0]);h.row.onpointerdown(event(data));h.row.ondragstart(event(data));
 const other=Object.create(Object.getPrototypeOf(h.view));Object.assign(other,{app:h.view.app,el:h.view.el,active:true,dragging:false,externalDragging:false,deferredRender:false});other.onunload();
 const target={...h.row};h.view.bindDropTarget(target,660);target.ondrop(event(data));await new Promise(resolve=>setImmediate(resolve));assert.equal(h.calls.length,1);
});
test('fifty failed drops reset the save gate and permit exactly one fresh retry',async()=>{
 const h=timeline();let attempts=0;h.view.planner.update=async()=>{attempts++;if(attempts%2)throw Error('暂时无法保存');};
 for(let i=0;i<50;i++)for(let attempt=0;attempt<2;attempt++){
  const data=transfer();h.view.bindTaskDrag(h.row,h.tasks()[0]);h.row.onpointerdown(event(data));h.row.ondragstart(event(data));const target={...h.row};h.view.bindDropTarget(target,660);target.ondrop(event(data));target.ondrop(event(data));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(h.view.dropSaving,false);
 }
 assert.equal(attempts,100);assert.equal(h.notices.length,50);
});
