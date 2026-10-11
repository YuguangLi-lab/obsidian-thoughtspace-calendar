import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import type {App} from 'obsidian';
import {planTasks} from '../src/task-planner-model';
import {CALENDAR_TASK_DRAG_TYPE,startCalendarTaskDrag,readCalendarTaskDrag,canReadCalendarTaskDrag,endCalendarTaskDrag} from '../src/calendar-task-drag';
const app=()=>({}) as App;
const task=(body='09:00 - 10:00 Read #task ⏳ 2026-10-11 📅 2026-10-13 ^reading',path='Notes/private.md')=>planTasks('- [ ] '+body,path,'Journal')[0];
function transfer(){const values=new Map<string,string>();return{effectAllowed:'none' as DataTransfer['effectAllowed'],get types(){return [...values.keys()];},setData(type:string,value:string){values.set(type,value);},getData(type:string){return values.get(type)||'';},values};}

test('external drag carries opaque token only and coexists with existing quadrant MIME',()=>{
 const owner=app(),data=transfer(),original=task();data.setData('application/x-thoughtspace-task','quadrant-token');startCalendarTaskDrag(owner,original,data);
 assert.equal(data.getData('application/x-thoughtspace-task'),'quadrant-token');assert.match(data.getData(CALENDAR_TASK_DRAG_TYPE),/^[\da-f-]{36}$/);assert.equal(data.types.length,2);
 assert.ok(![...data.values.values()].some(value=>value.includes(original.path)||value.includes(original.source)));assert.equal(data.effectAllowed,'move');assert.equal(readCalendarTaskDrag(owner,data)?.sourceSnapshot,original.source);
});
test('protected dragover accepts types with empty data, drop requires the matching token',()=>{
 const owner=app(),data=transfer();startCalendarTaskDrag(owner,task(),data);const protectedData={types:data.types,getData:()=>''};
 assert.equal(canReadCalendarTaskDrag(owner,protectedData),true);assert.equal(readCalendarTaskDrag(owner,protectedData),undefined);assert.ok(readCalendarTaskDrag(owner,data));
 data.setData(CALENDAR_TASK_DRAG_TYPE,'forged');assert.equal(readCalendarTaskDrag(owner,data),undefined);
});
test('drag snapshots cannot cross App instances or be reused after dragend',()=>{
 const owner=app(),other=app(),data=transfer();startCalendarTaskDrag(owner,task(),data);assert.equal(readCalendarTaskDrag(other,data),undefined);assert.equal(canReadCalendarTaskDrag(other,data),false);
 endCalendarTaskDrag(owner);assert.equal(readCalendarTaskDrag(owner,data),undefined);assert.equal(canReadCalendarTaskDrag(owner,data),false);
});
test('a session expires after two minutes and clock rollback invalidates it',()=>{
 const realNow=Date.now;let now=1000;Date.now=()=>now;
 try{const owner=app(),data=transfer();startCalendarTaskDrag(owner,task(),data);now+=119999;assert.ok(readCalendarTaskDrag(owner,data));now++;assert.equal(readCalendarTaskDrag(owner,data),undefined);
 now=1000;startCalendarTaskDrag(owner,task(),data);now=999;assert.equal(canReadCalendarTaskDrag(owner,data),false);
 }finally{Date.now=realNow;}
});
test('drag mapping selects scheduled then due then diary day or the unscheduled inbox',()=>{
 for(const [source,path,date,role]of [
  ['09:00 - 10:00 Read ⏳ 2026-10-11 📅 2026-10-13','Notes/a.md','2026-10-11','scheduled'],
  ['09:00 - 10:00 Read 📅 2026-10-13','Notes/a.md','2026-10-13','due'],
  ['09:00 - 10:00 Read','Journal/2026/10/2026-10-11.md','2026-10-11','day'],
  ['09:00 - 10:00 Read','Notes/a.md','','unscheduled'],
 ]){const owner=app(),data=transfer();startCalendarTaskDrag(owner,task(source,path),data);const value=readCalendarTaskDrag(owner,data)!;assert.equal(value.date,date);assert.equal(value.dateRole,role);assert.equal(value.startMinute,540);assert.equal(value.endMinute,600);assert.equal(value.text,'Read');}
});
test('snapshot remains stable when original task or a returned copy is edited',()=>{
 const owner=app(),data=transfer(),original=task();startCalendarTaskDrag(owner,original,data);const source=original.source;original.source='changed externally';original.scheduled='2026-10-20';
 const first=readCalendarTaskDrag(owner,data)!;assert.equal(first.sourceSnapshot,source);first.sourceSnapshot='mutated consumer';assert.equal(readCalendarTaskDrag(owner,data)?.sourceSnapshot,source);assert.equal(readCalendarTaskDrag(owner,data)?.date,'2026-10-11');
});
test('completed, invalid, or failed drag startup leaves no active session',()=>{
 const owner=app(),data=transfer();startCalendarTaskDrag(owner,task(),data);assert.throws(()=>startCalendarTaskDrag(owner,{...task(),checked:true},data),/已完成/);assert.equal(canReadCalendarTaskDrag(owner,data),false);
 assert.throws(()=>startCalendarTaskDrag(owner,{...task(),line:-1},data),/无效/);
 startCalendarTaskDrag(owner,task(),data);const broken={...data,setData(){throw Error('transfer closed');}};assert.throws(()=>startCalendarTaskDrag(owner,task(),broken),/transfer closed/);assert.equal(canReadCalendarTaskDrag(owner,data),false);
});

const code=buildSync({entryPoints:['src/task-planner-view.ts'],bundle:true,write:false,format:'cjs',platform:'node',external:['obsidian']}).outputFiles[0].text;
function dragPanel(){
 class Component{};const module={exports:{} as any};new Function('require','module','exports',code)((id:string)=>{if(id==='obsidian')return{MarkdownRenderChild:Component,Modal:Component,Notice:Component,TFile:Component,setIcon(){}};throw Error(id);},module,module.exports);
 const panel=Object.create(module.exports.TaskPanel.prototype);panel.app=app();panel.el={addClass(){},removeClass(){},querySelectorAll:()=>[]};panel.render=()=>{};
 const row:any={draggable:false,addClass(){},querySelector:()=>({createSpan:()=>({})})};return{panel,row};
}
test('list and quadrant rows carry both drag tokens while interactive controls remain protected',()=>{
 for(const quadrant of [undefined,'q1']){
  const {panel,row}=dragPanel();panel.bindTaskDrag(row,task(),quadrant);assert.equal(row.draggable,true);const data=transfer();let prevented=false;
  row.onpointerdown({target:{closest:()=>({})}});row.ondragstart({dataTransfer:data,preventDefault(){prevented=true;},stopPropagation(){}});assert.equal(prevented,true);assert.equal(data.types.length,0);
  row.onpointerdown({target:{closest:()=>null}});row.ondragstart({dataTransfer:data,preventDefault(){throw Error('valid drag prevented');},stopPropagation(){}});
  assert.match(data.getData(CALENDAR_TASK_DRAG_TYPE),/^[\da-f-]{36}$/);assert.match(data.getData('application/x-thoughtspace-task'),/^[\da-f-]{36}$/);assert.ok(panel.drag);row.ondragend({stopPropagation(){}});assert.equal(panel.drag,undefined);
 }
});
test('completed row cannot start a calendar or quadrant drag',()=>{
 const {panel,row}=dragPanel();panel.bindTaskDrag(row,{...task(),checked:true},'q1');assert.equal(row.draggable,false);assert.equal(row.ondragstart,undefined);
});
